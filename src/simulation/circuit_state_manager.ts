// ==========================================================================
// CIRCUIT STATE MANAGER — Contenedor de estado reactivo del circuito
// ==========================================================================
// Responsabilidades:
//   1. Centralizar el estado mutable de los datos eléctricos del circuito
//      (voltajes de nodo, mapeo pin→nodo) y los objetos de soporte
//      periférico (actuadores, audio) que responden a frames analógicos.
//   2. Exponer una API inmutable de solo lectura hacia la capa de
//      presentación (UI y canvas), protegiendo el hilo de renderizado
//      frente a mutaciones concurrentes desde los solvers.
//   3. Proveer mutadores semánticos con nombre explícito para que toda
//      transición de estado sea trazable y esté tipada.
//
// Patrón: Contenedor de estado (no Store de eventos — innecesario para
// vanilla TS sin framework reactivo). La reactividad se logra mediante
// llamadas explícitas a updateCanvasRendering() desde los closures.
//
// Dependencias:
//   - ActuatorHistoryManager (actuator_helpers.ts) — estados de actuadores
//   - AudioOrchestrator (audio_orchestrator.ts) — síntesis de audio PWM
//   - SimulationFrame (simulation_runner.ts) — tipo de frame entrante
//
// Sin dependencias circulares:
//   state_manager → actuator_helpers, audio_orchestrator, simulation_runner
//   main.ts → state_manager  (nunca al revés)
// ==========================================================================

import { ActuatorHistoryManager } from "../ui/actuator_helpers";
import { AudioOrchestrator } from "../ui/audio_orchestrator";
import type {
  ComponentInstance,
  PinInstance,
  Point2D,
  WireInstance,
} from "../canvas_orchestrator";
import { type SimulationFrame } from "./simulation_runner";
import { resetRuntime } from "./mcu-runtime";
import { globalComponentRegistry } from "../components/registry";

interface DemoLoadOscilloscopeState {
  transientResults: unknown[];
  acSweepResults: unknown | null;
  sweepTime: number;
  draw?: () => void;
}

interface DemoLoadOrchestratorState {
  components: ComponentInstance[];
  wires: WireInstance[];
  selectedComponent: ComponentInstance | null;
  selectedComponents: ComponentInstance[];
  selectedWire: WireInstance | null;
  activePinForWire: PinInstance | null;
  tempWireEnd: Point2D | null;
  selectionStart: Point2D | null;
  selectionEnd: Point2D | null;
}

// ==========================================================================
// VoltageSnapshot — Instantánea de voltajes para el inspector de tiempo
// (scrub del osciloscopio sobre resultados transitorios).
// ==========================================================================

export interface VoltageSnapshot {
  readonly time: number;
  readonly nodeVoltages: Readonly<Record<string, number>>;
  readonly branchCurrents: Readonly<Record<string, number>>;
}

// ==========================================================================
// CircuitStateManager — Clase contenedora de estado
// ==========================================================================
// El estado interno (_liveVoltages, _pinToNodeMap) es privado. Los getters
// exponen la referencia interna bajo el tipo Readonly<T> — no se hace copia
// defensiva porque el perfil de uso es reemplazo total (nunca mutación
// parcial). Los objetos actuatorHistory y audioOrchestrator se exponen
// como propiedades públicas de solo lectura para preservar sus APIs nativas
// sin envoltorios redundantes.
// ==========================================================================

export class CircuitStateManager {
  // --- Sub-objetos de soporte (expuestos para respetar sus APIs nativas) ---
  readonly actuatorHistory: ActuatorHistoryManager;
  readonly audioOrchestrator: AudioOrchestrator;

  // --- Estado encapsulado (privado, mutado solo a través de métodos) ---
  private _liveVoltages: Record<string, number> = {};
  private _liveCurrents: Record<string, number> = {};
  private _pinToNodeMap: Record<string, string> = {};

  constructor() {
    this.actuatorHistory = new ActuatorHistoryManager();
    this.audioOrchestrator = new AudioOrchestrator();
  }

  // ========================================================================
  // GETTERS — Acceso de solo lectura al estado
  // ========================================================================

  /** Mapa nodo → voltaje DC actual */
  getVoltageMap(): Readonly<Record<string, number>> {
    return this._liveVoltages;
  }

  /** Mapa rama → corriente actual */
  getCurrentMap(): Readonly<Record<string, number>> {
    return this._liveCurrents;
  }

  /** Voltaje de un nodo específico, o undefined si no existe */
  getNodeVoltage(nodeId: string): number | undefined {
    return this._liveVoltages[nodeId];
  }

  /** Mapa pinKey → nodeId (traducción terminal físico → nodo eléctrico) */
  getPinToNodeMap(): Readonly<Record<string, string>> {
    return this._pinToNodeMap;
  }

  /** NodeId de un pin específico, o undefined si no está mapeado */
  getPinNode(pinKey: string): string | undefined {
    return this._pinToNodeMap[pinKey];
  }

  // ========================================================================
  // MUTADORES — Transiciones de estado controladas
  // ========================================================================

  /** Reemplaza el mapa de voltajes y corrientes a partir de un frame de simulación */
  setVoltagesFromFrame(frame: SimulationFrame): void {
    // Spread para garantizar un nuevo objeto — evita retener referencias
    // al frame subyacente que puede ser reutilizado por el runner.
    this._liveVoltages = { ...frame.nodeVoltages };
    this._liveCurrents = { ...frame.branchCurrents };
  }

  /** Reemplaza el mapa de voltajes y corrientes desde un snapshot plano */
  setVoltagesFromSnapshot(nodeVoltages: Record<string, number>, branchCurrents: Record<string, number> = {}): void {
    this._liveVoltages = { ...nodeVoltages };
    this._liveCurrents = { ...branchCurrents };
  }

  /** Reemplaza el mapa pin→nodo (se produce en cada extracción de netlist) */
  setPinToNodeMap(map: Record<string, string>): void {
    this._pinToNodeMap = { ...map };
  }

  /** Limpia el mapa de voltajes y corrientes (p. ej. al vaciar el lienzo) */
  clearVoltages(): void {
    this._liveVoltages = {};
    this._liveCurrents = {};
  }

  /** Reset completo: voltajes, corrientes, mapa de pines, historial de actuadores y audio */
  resetAll(): void {
    this._liveVoltages = {};
    this._liveCurrents = {};
    this._pinToNodeMap = {};
    this.actuatorHistory.clear();
    this.audioOrchestrator.stopAll();
  }

  /**
   * Limpia de forma explícita y absoluta todo el historial del osciloscopio,
   * resetea los estados de los pines de todos los microcontroladores,
   * limpia el netlist extraído y pone a cero todos los vectores de voltaje.
   */
  prepareForDemoLoad(
    oscilloscopePanel: DemoLoadOscilloscopeState | null,
    orchestrator: DemoLoadOrchestratorState | null,
  ): void {
    // 1. Limpiar de forma explícita y absoluta todo el historial del osciloscopio
    if (oscilloscopePanel) {
      oscilloscopePanel.transientResults = [];
      oscilloscopePanel.acSweepResults = null;
      oscilloscopePanel.sweepTime = 0.0;
      if (typeof oscilloscopePanel.draw === "function") {
        oscilloscopePanel.draw();
      }
    }

    // 2. Resetear los estados de los pines/registros del microcontrolador
    if (orchestrator && Array.isArray(orchestrator.components)) {
      for (const comp of orchestrator.components) {
        if (comp.mcuRuntime) {
          resetRuntime(comp.mcuRuntime);
        }
      }
    }

    // 3. Poner a cero todos los vectores de voltaje y configuraciones
    this._liveVoltages = {};
    this._pinToNodeMap = {};
    this.actuatorHistory.clear();
    this.audioOrchestrator.stopAll();

    // 4. Limpiar el netlist extraído vaciando componentes y cables del orchestrator
    if (orchestrator) {
      orchestrator.components = [];
      orchestrator.wires = [];
      orchestrator.selectedComponent = null;
      orchestrator.selectedComponents = [];
      orchestrator.selectedWire = null;
      orchestrator.activePinForWire = null;
      orchestrator.tempWireEnd = null;
      orchestrator.selectionStart = null;
      orchestrator.selectionEnd = null;
    }
  }

  // ========================================================================
  // HELPER DE PRESENTACIÓN — Construye el diccionario pinKey→voltaje
  // ========================================================================
  // Itera el mapa pinToNodeMap y resuelve cada pinKey a su voltaje activo.
  // Esto evita el bucle inline que antes residía en updateCanvasRendering(),
  // centralizando la lógica de traducción en el gestor de estado.
  // ========================================================================

  buildPinVoltageMap(): Record<string, number> {
    const pinVoltageMap: Record<string, number> = {};
    for (const [pinKey, nodeId] of Object.entries(this._pinToNodeMap)) {
      if (this._liveVoltages[nodeId] !== undefined) {
        pinVoltageMap[pinKey] = this._liveVoltages[nodeId];
      }
    }
    return pinVoltageMap;
  }

  /**
   * Sincroniza en tiempo real las corrientes de rama de todos los componentes
   * y cables, y actualiza los actuadores visuales (como el brillo del LED).
   */
  syncComponentCurrentsAndActuators(
    components: readonly ComponentInstance[],
    wires: readonly WireInstance[],
  ): void {
    const pinVoltages = this.buildPinVoltageMap();
    const branchCurrents: Record<string, number> = { ...this._liveCurrents };

    for (const comp of components) {
      const pins = globalComponentRegistry.getPins(comp);
      const voltagesRecord: Record<number, number | undefined> = {};
      for (const pin of pins) {
        voltagesRecord[pin.pinIndex] = pinVoltages[`${comp.id}:${pin.pinIndex}`];
      }

      // Si el componente tiene corriente de rama externa (ej. fuentes independientes de Rust)
      if (branchCurrents[comp.id] !== undefined) {
        const iVal = branchCurrents[comp.id];
        if (branchCurrents[`${comp.id}:0`] === undefined) branchCurrents[`${comp.id}:0`] = -iVal;
        if (branchCurrents[`${comp.id}:1`] === undefined) branchCurrents[`${comp.id}:1`] = iVal;
        if (branchCurrents[`${comp.id}:I`] === undefined) branchCurrents[`${comp.id}:I`] = iVal;
      }

      const behavior = globalComponentRegistry.evaluateLiveBehavior(comp, voltagesRecord);
      if (behavior) {
        if (behavior.glowLevel !== undefined) comp.glowLevel = behavior.glowLevel;
        if (behavior.relayClosed !== undefined) comp.relayClosed = behavior.relayClosed;
        if (behavior.buzzerLevel !== undefined) comp.buzzerLevel = behavior.buzzerLevel;

        if (behavior.branchCurrents) {
          for (const [pinIdxStr, current] of Object.entries(behavior.branchCurrents)) {
            const pinIdx = Number(pinIdxStr);
            branchCurrents[`${comp.id}:${pinIdx}`] = current;
          }
          const primaryI = behavior.branchCurrents[0];
          if (primaryI !== undefined) {
            branchCurrents[comp.id] = primaryI;
            branchCurrents[`${comp.id}:I`] = primaryI;
          }
        }
      }
    }

    // Propagación KCL a lo largo de componentes de 2 terminales y cables enlazados
    for (let iter = 0; iter < 4; iter++) {
      // 1. Propagar a través de los cables
      for (const wire of wires) {
        const fromKey = `${wire.from.componentId}:${wire.from.pinIndex}`;
        const toKey = `${wire.to.componentId}:${wire.to.pinIndex}`;
        let wireI = branchCurrents[wire.id] ?? branchCurrents[`${wire.id}:I`];

        if (wireI === undefined) {
          if (branchCurrents[fromKey] !== undefined) {
            wireI = branchCurrents[fromKey];
          } else if (branchCurrents[toKey] !== undefined) {
            wireI = -branchCurrents[toKey];
          }
        }

        if (wireI !== undefined) {
          branchCurrents[wire.id] = wireI;
          branchCurrents[`${wire.id}:I`] = wireI;
          if (branchCurrents[fromKey] === undefined) {
            branchCurrents[fromKey] = wireI;
          }
          if (branchCurrents[toKey] === undefined) {
            branchCurrents[toKey] = -wireI;
          }
        }
      }

      // 2. Propagar a través de componentes de 2 terminales (resistencia, capacitor, bobina, diodo, led)
      for (const comp of components) {
        const pins = globalComponentRegistry.getPins(comp);
        if (pins.length === 2) {
          const k0 = `${comp.id}:0`;
          const k1 = `${comp.id}:1`;
          const i0 = branchCurrents[k0];
          const i1 = branchCurrents[k1];

          if (i0 !== undefined && i1 === undefined) {
            branchCurrents[k1] = -i0;
            branchCurrents[comp.id] = i0;
            branchCurrents[`${comp.id}:I`] = i0;
          } else if (i1 !== undefined && i0 === undefined) {
            branchCurrents[k0] = -i1;
            branchCurrents[comp.id] = -i1;
            branchCurrents[`${comp.id}:I`] = -i1;
          }
        }
      }
    }

    this._liveCurrents = branchCurrents;
  }
}

// ==========================================================================
// Factory — Mantiene el patrón del resto de submódulos importables
// ==========================================================================

export function createCircuitStateManager(): CircuitStateManager {
  return new CircuitStateManager();
}
