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
import { type CircuitNetlist, invalidateTopologicalCache } from "./netlist_extractor";
import {
  cancelFeedbackRun,
  completeFeedbackRun,
  failFeedbackRun,
  recordConvergence,
  type FeedbackRunHandle,
} from "../feedback/instrumentation";
import { type TimeStepResult } from "../ui/oscilloscope_panel";

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
  /** Lote de pasos transitorios calculados con resolución de física completa */
  readonly batchSteps?: ReadonlyArray<TimeStepResult>;
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

export type InteractiveMutationField =
  | "value"
  | "amplitude"
  | "frequency"
  | "offset"
  | "duty_cycle"
  | "switch_state"
  | "switch_ron"
  | "switch_roff"
  | "switch_vth"
  | "switch_vh";

export interface ComponentMutationPayload {
  readonly componentId: string;
  readonly field: InteractiveMutationField;
  readonly value: number;
  readonly runId?: number;
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
      disablePacing?: boolean;
      speedMultiplier?: number;
    }>,
    ownerTabId: string,
    feedbackRun?: FeedbackRunHandle,
  ): Promise<void>;
  /** Ajusta la velocidad de simulación en caliente sobre la marcha */
  setSimulationSpeed(speed: number): Promise<void>;
  /** Aplica una mutación de parámetro en caliente (hot-patching) sobre
   *  un componente durante la simulación activa sin reiniciar el análisis. */
  mutateComponent(
    componentId: string,
    field: InteractiveMutationField,
    value: number,
  ): Promise<void>;
  /** Retorna el identificador de corrida activo o null si está inactivo. */
  getActiveRunId(): number | null;
  /** Detiene la simulación, desregistra el stream IPC, limpia los
   *  runtimes MCU y notifica el cambio de estado. */
  stopInteractiveTransient(): Promise<void>;
  /** Pausa temporalmente la simulación interactiva sin destruir estados de energía. */
  pauseInteractiveTransient(): Promise<void>;
  /** Reanuda la simulación interactiva pausada. */
  resumeInteractiveTransient(): Promise<void>;
  /** Avanza un número discreto de pasos o frames cuando la simulación está pausada. */
  stepInteractiveTransient(steps?: number): Promise<void>;
  /** Indica si la simulación activa se encuentra actualmente pausada. */
  isSimulationPaused(): boolean;
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

let nextRunId = 1;

// ==========================================================================
// Factory: creación del runner con inyección de callbacks
// ==========================================================================

export function createSimulationRunner(callbacks: SimulationRunnerCallbacks): SimulationRunner {
  let activeContext: SimulationRunContext | null = null;
  let coSimulationWorker: Worker | null = null;
  let unlistenStream: (() => void) | null = null;
  let unlistenError: (() => void) | null = null;
  let currentDt = 1e-4;
  let isPaused: boolean = false;
  let lifecycleEpoch = 0;

  const releaseLocalResources = (): void => {
    isPaused = false;
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
    if (context.feedbackRun) {
      recordConvergence(context.feedbackRun, { method: "interactive-transient" });
      completeFeedbackRun(context.feedbackRun, {
        pointCount: Math.max(1, Math.round(finalTime / currentDt) + 1),
        converged: true,
      });
    }
    activeContext = null;
    releaseLocalResources();
    callbacks.onSimulationStateChanged(false, context);
    callbacks.onSimulationComplete(finalTime, context);
  };

  const failSimulation = (
    error: unknown,
    context: SimulationRunContext,
    phase: "iteration" | "ipc",
  ): void => {
    if (activeContext?.runId !== context.runId) return;
    const message = error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error) ?? String(error);
    if (context.feedbackRun) failFeedbackRun(context.feedbackRun, error, phase);
    activeContext = null;
    releaseLocalResources();
    callbacks.onSimulationStateChanged(false, context);
    callbacks.onSimulationError(message, context);
  };

  return {
    async startInteractiveTransient(
      netlist: CircuitNetlist,
      settings: Readonly<{
        dt: number;
        tMax: number;
        tolerance?: number;
        maxIterations?: number;
        disablePacing?: boolean;
        speedMultiplier?: number;
      }>,
      ownerTabId: string,
      feedbackRun?: FeedbackRunHandle,
    ): Promise<void> {
      if (!Number.isFinite(settings.dt) || settings.dt <= 0) {
        throw new RangeError("El paso temporal interactivo debe ser finito y mayor que cero.");
      }
      if (!Number.isFinite(settings.tMax) || settings.tMax < 0) {
        throw new RangeError("La duración interactiva debe ser finita y no negativa (0 activa modo continuo).");
      }

      const startEpoch = ++lifecycleEpoch;

      // Desacoplar inmediatamente la corrida previa evita aceptar frames mientras
      // el backend confirma la cancelación.
      if (activeContext) {
        const previousContext = activeContext;
        activeContext = null;
        if (previousContext.feedbackRun) cancelFeedbackRun(previousContext.feedbackRun, "replaced");
        releaseLocalResources();
        callbacks.onSimulationStateChanged(false, previousContext);
        await invoke("stop_interactive_transient", { runId: previousContext.runId });
        if (startEpoch !== lifecycleEpoch) return;
      }

      const context: SimulationRunContext = {
        runId: nextRunId,
        ownerTabId,
        feedbackRun,
      };
      nextRunId += 1;
      activeContext = context;
      isPaused = false;

      // Actualizar latch dt para el closure asíncrono
      currentDt = settings.dt;

      callbacks.onSimulationStateChanged(true, context);

      const hasMcus = netlist.components.some(
        (c) => c.type.startsWith("mcu_") || c.type === "arduino_uno" || Boolean(c.firmware),
      );

      let runWorker: Worker | null = null;
      if (hasMcus) {
        // Crear el worker de co-simulación digital
        runWorker = new Worker(
          new URL('./co_simulation_worker.ts', import.meta.url),
          { type: 'module' }
        );
        coSimulationWorker = runWorker;

        // Mapear firmwares de componentes
        const firmware: Record<string, Uint8Array> = {};
        for (const comp of netlist.components) {
          if (comp.firmware) {
            firmware[comp.id] = comp.firmware;
          }
        }

        // Inicializar runtimes MCU en el worker
        runWorker.postMessage({
          type: "init_interactive",
          netlist,
          firmware,
        });

        // Manejar respuestas del worker
        runWorker.onmessage = (e) => {
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
      } else {
        coSimulationWorker = null;
      }

      // Registrar listener IPC para frames analógicos entrantes. Cada cleanup se
      // conserva localmente hasta confirmar que esta corrida sigue siendo la activa.
      let streamCleanup: (() => void) | null = null;
      try {
        streamCleanup = await listen<SimulationFrame>('sim-frame-update', (event) => {
        const frame = event.payload;
        if (
          frame.runId !== context.runId
          || activeContext?.runId !== context.runId
        ) {
          return;
        }

        // Delegar procesamiento del MCU al Web Worker
        if (runWorker) {
          runWorker.postMessage({
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
      } catch (error: unknown) {
        failSimulation(error, context, "ipc");
        throw error;
      }
      if (startEpoch !== lifecycleEpoch || activeContext?.runId !== context.runId) {
        streamCleanup();
        runWorker?.terminate();
        return;
      }
      unlistenStream = streamCleanup;

      // Registrar listener IPC para errores de simulación
      let errorCleanup: (() => void) | null = null;
      try {
        errorCleanup = await listen<SimulationStreamError>('sim-frame-error', (event) => {
        if (
          event.payload.runId !== context.runId
          || activeContext?.runId !== context.runId
        ) {
          return;
        }
        failSimulation(event.payload.error, context, "iteration");
        void invoke("stop_interactive_transient", { runId: context.runId }).catch((error: unknown) => {
          TelemetryPanel.logError(error instanceof Error ? error.message : String(error));
        });
        });
      } catch (error: unknown) {
        failSimulation(error, context, "ipc");
        throw error;
      }
      if (startEpoch !== lifecycleEpoch || activeContext?.runId !== context.runId) {
        errorCleanup();
        if (unlistenStream === streamCleanup) {
          streamCleanup();
          unlistenStream = null;
        }
        runWorker?.terminate();
        if (coSimulationWorker === runWorker) coSimulationWorker = null;
        return;
      }
      unlistenError = errorCleanup;

      // Arrancar el backend Rust
      try {
        await invoke('start_interactive_transient', {
          netlist,
          settings: { dt: settings.dt, tMax: settings.tMax },
          runId: context.runId,
          tolerance: settings.tolerance ?? 1e-6,
          maxIterations: settings.maxIterations ?? 100,
          disablePacing: settings.disablePacing ?? false,
          speedMultiplier: settings.speedMultiplier ?? 1.0,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        TelemetryPanel.logError(errorMsg);
        failSimulation(err, context, "ipc");
        throw err;
      }
    },

    async setSimulationSpeed(speed: number): Promise<void> {
      try {
        await invoke('set_interactive_simulation_speed', {
          speed: Math.max(0.01, speed),
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        TelemetryPanel.logError(`[Simulation Speed] Error al ajustar velocidad: ${errorMsg}`);
      }
    },

    async stopInteractiveTransient(): Promise<void> {
      lifecycleEpoch += 1;
      const context = activeContext;
      if (context && activeContext?.runId === context.runId) {
        activeContext = null;
        if (context.feedbackRun) cancelFeedbackRun(context.feedbackRun, "user");
        releaseLocalResources();
        callbacks.onSimulationStateChanged(false, context);
      } else {
        releaseLocalResources();
      }
      try {
        await invoke(
          'stop_interactive_transient',
          context ? { runId: context.runId } : {},
        );
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        TelemetryPanel.logError(errorMsg);
      }
    },

    async pauseInteractiveTransient(): Promise<void> {
      const context = activeContext;
      if (!context) return;
      try {
        await invoke('pause_interactive_transient', { runId: context.runId });
        if (activeContext?.runId === context.runId) isPaused = true;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        TelemetryPanel.logError(`[Simulation Pause] Error al pausar simulación: ${errorMsg}`);
      }
    },

    async resumeInteractiveTransient(): Promise<void> {
      const context = activeContext;
      if (!context) return;
      try {
        await invoke('resume_interactive_transient', { runId: context.runId });
        if (activeContext?.runId === context.runId) isPaused = false;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        TelemetryPanel.logError(`[Simulation Resume] Error al reanudar simulación: ${errorMsg}`);
      }
    },

    async stepInteractiveTransient(steps: number = 1): Promise<void> {
      const context = activeContext;
      if (!context) return;
      try {
        await invoke('step_interactive_transient', {
          runId: context.runId,
          steps: Math.max(1, steps),
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        TelemetryPanel.logError(`[Simulation Step] Error en avance de paso: ${errorMsg}`);
      }
    },

    isSimulationPaused(): boolean {
      return isPaused;
    },

    async mutateComponent(
      componentId: string,
      field: InteractiveMutationField,
      value: number,
    ): Promise<void> {
      invalidateTopologicalCache();
      if (!activeContext) return;
      try {
        await invoke("inject_live_mutation", {
          mutation: {
            componentId,
            field,
            value,
            runId: activeContext.runId,
          },
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        TelemetryPanel.logError(`[Hot-Patching] Error al mutar ${componentId}.${field}: ${errorMsg}`);
      }
    },

    getActiveRunId(): number | null {
      return activeContext ? activeContext.runId : null;
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
