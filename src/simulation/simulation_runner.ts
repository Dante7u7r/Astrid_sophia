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

import { safeInvoke as invoke } from "./tauri_mock";
import { listen } from "@tauri-apps/api/event";
import { TelemetryPanel } from "../ui/telemetry_panel";
import { createMcuRuntime, runCycles, type McuRuntime } from "./mcu-runtime";
import { dispatchAnalogTrigger } from "./mcu-spice-bridge";
import { STANDARD_8051_DEFINITION } from "./mcu-8051";
import { ATMEGA328P_DEFINITIONS } from "./mcu-avr";
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

let interactiveMcuRuntimes: Record<string, { runtime: McuRuntime; type: string; pins: string[] }> | null = null;

let unlistenStream: (() => void) | null = null;

/** Latch del paso temporal dt. Se actualiza en cada llamada a
 *  startInteractiveTransient() y es consumido por executeCycleWithInterrupts()
 *  dentro del closure asíncrono del listener IPC. */
let currentDt: number = 1e-4;

// ==========================================================================
// Co-simulación cycle-accurate (MCU Interrupt Engine)
// ==========================================================================

/** Ejecuta el avance cycle-accurate de los runtimes MCU sincronizado
 *  con el dt del frame analógico entrante.
 *
 *  Fase 1 — Inyección de interrupciones: si el frame contiene un
 *  triggerEvent (cruce de umbral detectado por el solver analógico
 *  en Rust), se despacha el vector de interrupción al runtime MCU
 *  destino a través de dispatchAnalogTrigger().
 *
 *  Fase 2 — Avance de ciclo: para cada MCU activa, se convierten dt
 *  segundos en ciclos de reloj usando la frecuencia nominal del núcleo
 *  (8051 → 12MHz, AVR → 16MHz) y se ejecutan mediante runCycles().
 *
 *  @param frame       Frame analógico entrante (puede traer triggerEvent).
 *  @param mcuRuntimes Registro de runtypes MCU activos.
 *  @param dt          Paso temporal en segundos (settings.dt ≈ 100µs). */
function executeCycleWithInterrupts(
  frame: SimulationFrame,
  mcuRuntites: Record<string, { runtime: McuRuntime; type: string; pins: string[] }>,
  dt: number,
): void {
  // Fase 1: Inyectar interrupción analógica si el frame trae trigger
  if (frame.triggerEvent) {
    dispatchAnalogTrigger(frame.triggerEvent, mcuRuntites);
  }

  // Fase 2: Avanzar cada MCU en dt ciclos de reloj
  for (const entry of Object.values(mcuRuntites)) {
    const clockSpeed = entry.type === 'mcu_avr' ? 16e6 : 12e6;
    const cyclesToRun = Math.round(dt * clockSpeed);
    runCycles(entry.runtime, Math.min(cyclesToRun, 200_000));
  }
}

// ==========================================================================
// Factory: creación del runner con inyección de callbacks
// ==========================================================================

export function createSimulationRunner(callbacks: SimulationRunnerCallbacks): SimulationRunner {
  return {
    async startInteractiveTransient(
      netlist: CircuitNetlist,
      settings: Readonly<{ dt: number; tMax: number }>,
    ): Promise<void> {
      // ENMIENDA 2: Blindaje de doble listener
      if (unlistenStream) {
        unlistenStream();
        unlistenStream = null;
      }

      // Actualizar latch dt para el closure asíncrono
      currentDt = settings.dt;

      callbacks.onSimulationStateChanged(true);

      // Inicializar runtimes MCU para co-simulación
      const mcuRuntimes: Record<string, { runtime: McuRuntime; type: string; pins: string[] }> = {};
      for (const comp of netlist.components) {
        if (comp.type === 'mcu_8051' || comp.type === 'mcu_avr') {
          const def = comp.type === 'mcu_avr' ? ATMEGA328P_DEFINITIONS : STANDARD_8051_DEFINITION;
          const runtime = createMcuRuntime({
            definition: def,
            firmware: comp.firmware,
          });
          runtime.pendingInterruptVector = null;
          runtime.globalInterruptEnable = true;
          mcuRuntimes[comp.id] = { runtime, type: comp.type, pins: [...comp.pins] };
        }
      }
      interactiveMcuRuntimes = mcuRuntimes;

      // Registrar listener IPC para frames analógicos entrantes
      unlistenStream = await listen<SimulationFrame>('sim-frame-update', (event) => {
        const frame = event.payload;

        // Paso 1: Avance cycle-accurate de los MCUs ANTES de notificar a la UI
        if (interactiveMcuRuntimes) {
          executeCycleWithInterrupts(frame, interactiveMcuRuntimes, currentDt);
        }

        // Paso 2: Notificar a la UI (el callback recibirá pines ya sincronizados)
        callbacks.onFrameReceived(frame);

        if (frame.isFinal) {
          callbacks.onSimulationComplete(frame.time);
        }
      });

      // Registrar listener IPC para errores de simulación
      listen<string>('sim-frame-error', (event) => {
        callbacks.onSimulationError(event.payload);
      });

      // Arrancar el backend Rust
      try {
        await invoke('start_interactive_transient', { netlist, settings });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        TelemetryPanel.logError(errorMsg);
        callbacks.onSimulationStateChanged(false);
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

        // ENMIENDA 3: Limpiar runtimes y desregistrar stream
        interactiveMcuRuntimes = null;
        if (unlistenStream) {
          unlistenStream();
          unlistenStream = null;
        }
      }
    },

    isSimulationActive(): boolean {
      return unlistenStream !== null;
    },

    async destroy(): Promise<void> {
      await this.stopInteractiveTransient();
    },

    getInteractiveMcuRuntimes() {
      return interactiveMcuRuntimes as Readonly<
        Record<string, { readonly runtime: McuRuntime; readonly type: string; readonly pins: readonly string[] }>
      > | null;
    },
  };
}
