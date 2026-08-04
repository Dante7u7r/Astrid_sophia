// ==========================================================================
// SIMULATION RUNNER — Motor de simulación transitoria interactiva
// ==========================================================================
// Responsabilidades:
//   1. Gestionar el ciclo de vida de la simulación streaming Tauri v2 IPC
//      (start/stop/destroy) con blindaje de doble listener.
//   2. Coordinar el runtime MCU experimental con el paso analógico. El
//      runtime actual no implementa semántica completa de ISA ni periféricos.
//   3. Exponer un pipeline de Inversión de Control mediante callbacks
//      (onFrameReceived, onSimulationError, etc.) para desacoplar
//      completamente el motor de la capa de UI (main.ts, osciloscopio,
//      canvas, actuadores).
//
// Flujo de co-simulación experimental:
//   Rust IPC 'sim-frame-update' → SimulationRunner
//     ├── 1. executeCycleWithInterrupts(): inyecta triggers analógicos
//     │      como vectores de interrupción en los runtimes MCU (8051 12MHz
//     │      / AVR 16MHz) y avanza un contador temporal aproximado.
//     └── 2. callbacks.onFrameReceived(): notifica a la UI con el frame
//            ya sincronizado (pines MCU actualizados).
// ==========================================================================

import { safeInvoke as invoke, safeListen as listen } from "./tauri_mock";
import { TelemetryPanel } from "../ui/telemetry_panel";
import { type McuRuntime } from "./mcu-runtime";
import { type AnalogEventTrigger } from "./mcu-types";
import { type CircuitNetlist } from "./netlist_extractor";
import {
  cancelFeedbackRun,
  completeFeedbackRun,
  failFeedbackRun,
  recordConvergence,
  type FeedbackRunHandle,
} from "../feedback/instrumentation";

// ==========================================================================
// Interfaces públicas
// ==========================================================================

/** Cuadro (frame) de resultados analógicos transmitido por el solver Rust
 *  vía el canal IPC 'sim-frame-update' de Tauri v2. */
export interface SimulationFrame {
  readonly runId: number;
  readonly time: number;
  readonly nodeVoltages: Readonly<Record<string, number>>;
  readonly branchCurrents: Readonly<Record<string, number>>;
  readonly frameIndex: number;
  readonly isFinal: boolean;
  /** Evento de interrupción analógica (cruce de umbral) o null.
   *  Se despacha al runtime MCU antes de notificar a la UI. */
  readonly triggerEvent: AnalogEventTrigger | null;
}

export interface SimulationRunContext {
  readonly runId: number;
  readonly ownerTabId: string;
  readonly feedbackRun?: FeedbackRunHandle;
}

interface SimulationStreamError {
  readonly runId: number;
  readonly error: unknown;
}

/** Pipeline de notificación asíncrona hacia la capa de UI.
 *  Todos los métodos son síncronos; la UI decide si actualiza
 *  el DOM, el canvas, el osciloscopio o los actuadores. */
export interface SimulationRunnerCallbacks {
  /** Se invoca por cada frame analógico recibido, después de que
   *  executeCycleWithInterrupts() haya sincronizado los MCUs. */
  onFrameReceived: (frame: SimulationFrame, context: SimulationRunContext) => void;
  /** Se invoca cuando el backend Rust reporta un error en el
   *  canal 'sim-frame-error'. */
  onSimulationError: (error: string, context: SimulationRunContext) => void;
  /** Se invoca cuando se recibe el frame con isFinal = true. */
  onSimulationComplete: (finalTime: number, context: SimulationRunContext) => void;
  /** Se invoca al iniciar (active=true) y al detener (active=false)
   *  la simulación, permitiendo a la UI sincronizar flags como
   *  orchestrator.simulationActive. */
  onSimulationStateChanged: (active: boolean, context: SimulationRunContext) => void;
}

/** Interfaz pública del runner. */
export interface SimulationRunner {
  /** Inicia la simulación transitoria interactiva con el netlist dado.
   *  Antes de registrar un nuevo listener IPC, libera cualquier
   *  listener previo (blindaje de doble registro — Enmienda 2). */
  startInteractiveTransient(
    netlist: CircuitNetlist,
    settings: Readonly<{
      dt: number;
      tMax: number;
      tolerance?: number;
      maxIterations?: number;
    }>,
    ownerTabId: string,
    feedbackRun?: FeedbackRunHandle,
  ): Promise<void>;
  /** Detiene la simulación, desregistra el stream IPC, limpia los
   *  runtimes MCU y notifica el cambio de estado. */
  stopInteractiveTransient(): Promise<void>;
  /** Retorna true si hay un listener IPC activo. */
  isSimulationActive(): boolean;
  /** Libera todos los recursos: stop + limpieza de runtimes. */
  destroy(): Promise<void>;
  /** Expone el mapa de runtimes MCU activos para consulta externa
   *  (ej. dispatch de interrupciones desde el callback). */
  getInteractiveMcuRuntimes():
    | Readonly<Record<string, { readonly runtime: McuRuntime; readonly type: string; readonly pins: readonly string[] }>>
    | null;
}

// ==========================================================================
// Estado interno del módulo (privado, cero exportación)
// ==========================================================================

let coSimulationWorker: Worker | null = null;

let unlistenStream: (() => void) | null = null;
let unlistenError: (() => void) | null = null;

/** Latch del paso temporal dt. Se actualiza en cada llamada a
 *  startInteractiveTransient() y es consumido por el listener IPC. */
let currentDt: number = 1e-4;
let nextRunId = 1;

// ==========================================================================
// Factory: creación del runner con inyección de callbacks
// ==========================================================================

export function createSimulationRunner(callbacks: SimulationRunnerCallbacks): SimulationRunner {
  let activeContext: SimulationRunContext | null = null;

  const releaseLocalResources = (): void => {
    if (coSimulationWorker) {
      coSimulationWorker.terminate();
      coSimulationWorker = null;
    }

    if (unlistenStream) {
      unlistenStream();
      unlistenStream = null;
    }

    if (unlistenError) {
      unlistenError();
      unlistenError = null;
    }
  };

  const completeSimulation = (
    finalTime: number,
    context: SimulationRunContext,
  ): void => {
    if (activeContext?.runId !== context.runId) return;
    callbacks.onSimulationComplete(finalTime, context);
    if (context.feedbackRun) {
      recordConvergence(context.feedbackRun, { method: "interactive-transient" });
      completeFeedbackRun(context.feedbackRun, {
        pointCount: Math.max(1, Math.round(finalTime / currentDt) + 1),
        converged: true,
      });
    }
    callbacks.onSimulationStateChanged(false, context);
    activeContext = null;
    releaseLocalResources();
  };

  return {
    async startInteractiveTransient(
      netlist: CircuitNetlist,
      settings: Readonly<{
        dt: number;
        tMax: number;
        tolerance?: number;
        maxIterations?: number;
      }>,
      ownerTabId: string,
      feedbackRun?: FeedbackRunHandle,
    ): Promise<void> {
      // ENMIENDA 2: Blindaje de doble listener
      if (activeContext) {
        const previousContext = activeContext;
        if (previousContext.feedbackRun) cancelFeedbackRun(previousContext.feedbackRun, "replaced");
        await invoke("stop_interactive_transient", { runId: previousContext.runId });
        callbacks.onSimulationStateChanged(false, previousContext);
        releaseLocalResources();
      }

      const context: SimulationRunContext = {
        runId: nextRunId,
        ownerTabId,
        feedbackRun,
      };
      nextRunId += 1;
      activeContext = context;

      // Actualizar latch dt para el closure asíncrono
      currentDt = settings.dt;

      callbacks.onSimulationStateChanged(true, context);

      // Crear el worker de co-simulación
      coSimulationWorker = new Worker(
        new URL('./co_simulation_worker.ts', import.meta.url),
        { type: 'module' }
      );

      // Mapear firmwares de componentes
      const firmware: Record<string, Uint8Array> = {};
      for (const comp of netlist.components) {
        if (comp.firmware) {
          firmware[comp.id] = comp.firmware;
        }
      }

      // Inicializar runtimes MCU en el worker
      coSimulationWorker.postMessage({
        type: "init_interactive",
        netlist,
        firmware
      });

      // Manejar respuestas del worker
      coSimulationWorker.onmessage = (e) => {
        const data = e.data;
        if (
          data.type === "frame_processed"
          && data.frame.runId === context.runId
          && activeContext?.runId === context.runId
        ) {
          callbacks.onFrameReceived(data.frame, context);
          if (data.frame.isFinal) {
            completeSimulation(data.frame.time, context);
          }
        }
      };

      // Registrar listener IPC para frames analógicos entrantes
      unlistenStream = await listen<SimulationFrame>('sim-frame-update', (event) => {
        const frame = event.payload;
        if (
          frame.runId !== context.runId
          || activeContext?.runId !== context.runId
        ) {
          return;
        }

        // Delegar procesamiento del MCU al Web Worker
        if (coSimulationWorker) {
          coSimulationWorker.postMessage({
            type: "process_frame",
            frame,
            dt: currentDt
          });
        } else {
          callbacks.onFrameReceived(frame, context);
          if (frame.isFinal) {
            completeSimulation(frame.time, context);
          }
        }
      });

      // Registrar listener IPC para errores de simulación
      unlistenError = await listen<SimulationStreamError>('sim-frame-error', (event) => {
        if (
          event.payload.runId !== context.runId
          || activeContext?.runId !== context.runId
        ) {
          return;
        }
        const error = typeof event.payload.error === "string"
          ? event.payload.error
          : JSON.stringify(event.payload.error);
        if (context.feedbackRun) failFeedbackRun(context.feedbackRun, error, "iteration");
        callbacks.onSimulationError(error, context);
      });

      // Arrancar el backend Rust
      try {
        await invoke('start_interactive_transient', {
          netlist,
          settings: { dt: settings.dt, tMax: settings.tMax },
          runId: context.runId,
          tolerance: settings.tolerance ?? 1e-6,
          maxIterations: settings.maxIterations ?? 100,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        TelemetryPanel.logError(errorMsg);
        if (context.feedbackRun) failFeedbackRun(context.feedbackRun, err, "ipc");
        if (activeContext?.runId === context.runId) {
          callbacks.onSimulationStateChanged(false, context);
          activeContext = null;
          releaseLocalResources();
          callbacks.onSimulationError(errorMsg, context);
        }
        throw err;
      }
    },

    async stopInteractiveTransient(): Promise<void> {
      const context = activeContext;
      try {
        await invoke(
          'stop_interactive_transient',
          context ? { runId: context.runId } : {},
        );
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        TelemetryPanel.logError(errorMsg);
      } finally {
        if (context && activeContext?.runId === context.runId) {
          if (context.feedbackRun) cancelFeedbackRun(context.feedbackRun, "user");
          callbacks.onSimulationStateChanged(false, context);
          activeContext = null;
        }

        // ENMIENDA 3: Limpiar runtimes y desregistrar streams
        releaseLocalResources();
      }
    },

    isSimulationActive(): boolean {
      return unlistenStream !== null;
    },

    async destroy(): Promise<void> {
      await this.stopInteractiveTransient();
    },

    getInteractiveMcuRuntimes() {
      return null;
    },
  };
}
