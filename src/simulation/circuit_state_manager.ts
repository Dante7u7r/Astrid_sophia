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
import { type SimulationFrame } from "./simulation_runner";

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

  /** Reemplaza el mapa de voltajes a partir de un frame de simulación */
  setVoltagesFromFrame(frame: SimulationFrame): void {
    // Spread para garantizar un nuevo objeto — evita retener referencias
    // al frame subyacente que puede ser reutilizado por el runner.
    this._liveVoltages = { ...frame.nodeVoltages };
  }

  /** Reemplaza el mapa de voltajes desde un snapshot plano */
  setVoltagesFromSnapshot(nodeVoltages: Record<string, number>): void {
    this._liveVoltages = { ...nodeVoltages };
  }

  /** Reemplaza el mapa pin→nodo (se produce en cada extracción de netlist) */
  setPinToNodeMap(map: Record<string, string>): void {
    this._pinToNodeMap = { ...map };
  }

  /** Limpia solo el mapa de voltajes (p. ej. al vaciar el lienzo) */
  clearVoltages(): void {
    this._liveVoltages = {};
  }

  /** Reset completo: voltajes, mapa de pines, historial de actuadores y audio */
  resetAll(): void {
    this._liveVoltages = {};
    this._pinToNodeMap = {};
    this.actuatorHistory.clear();
    this.audioOrchestrator.stopAll();
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
}

// ==========================================================================
// Factory — Mantiene el patrón del resto de submódulos importables
// ==========================================================================

export function createCircuitStateManager(): CircuitStateManager {
  return new CircuitStateManager();
}
