// ==========================================================================
// SIMULATION RUNNER — Motor de simulación transitoria interactiva
// ==========================================================================
// Responsabilidades:
//   1. Gestionar el ciclo de vida de la simulación streaming Tauri v2 IPC
//      (start/stop/destroy) con blindaje de doble listener.
//   2. Mantener el registro de runtimes MCU activos (co-simulación mixta)
//      y ejecutar el avance cycle-accurate sincronizado con dt analógico.
//   3. Exponer un pipeline de Inversión de Control mediante callbacks
//      (onFrameReceived, onSimulationError, etc.) para desacoplar
//      completamente el motor de la capa de UI (main.ts, osciloscopio,
//      canvas, actuadores).
//
// Flujo de co-simulación (ciclo exacto):
//   Rust IPC 'sim-frame-update' → SimulationRunner
//     ├── 1. executeCycleWithInterrupts(): inyecta triggers analógicos
//     │      como vectores de interrupción en los runtimes MCU (8051 12MHz
//     │      / AVR 16MHz) y avanza sus registros de ciclo en dt.
//     └── 2. callbacks.onFrameReceived(): notifica a la UI con el frame
//            ya sincronizado (pines MCU actualizados).
// ==========================================================================

import { safeInvoke as invoke, safeListen as listen } from "./tauri_mock";
import { TelemetryPanel } from "../ui/telemetry_panel";
import { type McuRuntime } from "./mcu-runtime";
import { type AnalogEventTrigger } from "./mcu-types";
import { type CircuitNetlist } from "./netlist_extractor";

// ==========================================================================
// Interfaces públicas
// ==========================================================================

/** Cuadro (frame) de resultados analógicos transmitido por el solver Rust
 *  vía el canal IPC 'sim-frame-update' de Tauri v2. */
export interface SimulationFrame {
  readonly time: number;
  readonly nodeVoltages: Readonly<Record<string, number>>;
  readonly branchCurrents: Readonly<Record<string, number>>;
  readonly frameIndex: number;
  readonly isFinal: boolean;
  /** Evento de interrupción analógica (cruce de umbral) o null.
   *  Se despacha al runtime MCU antes de notificar a la UI. */
  readonly triggerEvent: AnalogEventTrigger | null;
}

/** Pipeline de notificación asíncrona hacia la capa de UI.
 *  Todos los métodos son síncronos; la UI decide si actualiza
 *  el DOM, el canvas, el osciloscopio o los actuadores. */
export interface SimulationRunnerCallbacks {
  /** Se invoca por cada frame analógico recibido, después de que
   *  executeCycleWithInterrupts() haya sincronizado los MCUs. */
  onFrameReceived: (frame: SimulationFrame) => void;
  /** Se invoca cuando el backend Rust reporta un error en el
   *  canal 'sim-frame-error'. */
  onSimulationError: (error: string) => void;
  /** Se invoca cuando se recibe el frame con isFinal = true. */
  onSimulationComplete: (finalTime: number) => void;
  /** Se invoca al iniciar (active=true) y al detener (active=false)
   *  la simulación, permitiendo a la UI sincronizar flags como
   *  orchestrator.simulationActive. */
  onSimulationStateChanged: (active: boolean) => void;
}

/** Interfaz pública del runner. */
export interface SimulationRunner {
  /** Inicia la simulación transitoria interactiva con el netlist dado.
   *  Antes de registrar un nuevo listener IPC, libera cualquier
   *  listener previo (blindaje de doble registro — Enmienda 2). */
  startInteractiveTransient(
    netlist: CircuitNetlist,
    settings: Readonly<{ dt: number; tMax: number }>,
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

// ==========================================================================
// Factory: creación del runner con inyección de callbacks
// ==========================================================================

export function createSimulationRunner(callbacks: SimulationRunnerCallbacks): SimulationRunner {
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

  const completeSimulation = (finalTime: number): void => {
    callbacks.onSimulationComplete(finalTime);
    callbacks.onSimulationStateChanged(false);
    releaseLocalResources();
  };

  return {
    async startInteractiveTransient(
      netlist: CircuitNetlist,
      settings: Readonly<{ dt: number; tMax: number }>,
    ): Promise<void> {
      // ENMIENDA 2: Blindaje de doble listener
      if (unlistenStream) {
        releaseLocalResources();
      }

      // Actualizar latch dt para el closure asíncrono
      currentDt = settings.dt;

      callbacks.onSimulationStateChanged(true);

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
        if (data.type === "frame_processed") {
          callbacks.onFrameReceived(data.frame);
          if (data.frame.isFinal) {
            completeSimulation(data.frame.time);
          }
        }
      };

      // Registrar listener IPC para frames analógicos entrantes
      unlistenStream = await listen<SimulationFrame>('sim-frame-update', (event) => {
        const frame = event.payload;

        // Delegar procesamiento del MCU al Web Worker
        if (coSimulationWorker) {
          coSimulationWorker.postMessage({
            type: "process_frame",
            frame,
            dt: currentDt
          });
        } else {
          callbacks.onFrameReceived(frame);
          if (frame.isFinal) {
            completeSimulation(frame.time);
          }
        }
      });

      // Registrar listener IPC para errores de simulación
      unlistenError = await listen<string>('sim-frame-error', (event) => {
        callbacks.onSimulationError(event.payload);
      });

      // Arrancar el backend Rust
      try {
        await invoke('start_interactive_transient', { netlist, settings });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        TelemetryPanel.logError(errorMsg);
        callbacks.onSimulationStateChanged(false);
        releaseLocalResources();
        callbacks.onSimulationError(errorMsg);
        throw err;
      }
    },

    async stopInteractiveTransient(): Promise<void> {
      try {
        await invoke('stop_interactive_transient');
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        TelemetryPanel.logError(errorMsg);
      } finally {
        callbacks.onSimulationStateChanged(false);

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
