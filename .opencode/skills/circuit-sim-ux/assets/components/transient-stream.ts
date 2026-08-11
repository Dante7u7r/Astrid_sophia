/**
 * transient-stream.ts
 *
 * Gestión del listener de streaming transitorio interactivo. Vive como
 * archivo propio (paralelo a src/simulation/fallback_solver.ts) porque su
 * responsabilidad es distinta a la del solver: aquí solo se gestiona el
 * ciclo de vida del listener de Tauri (`sim-frame-update`) y el estado de
 * "¿hay un stream corriendo, y cuál fue el último frame recibido?" — no
 * contiene álgebra lineal ni lógica de circuito.
 *
 * Contrato con el backend Rust (src-tauri/src/lib.rs):
 *
 *   pub struct SimulationFrame {
 *       pub time: f64,
 *       pub node_voltages: HashMap<String, f64>,
 *       pub branch_currents: HashMap<String, f64>,
 *       pub frame_index: u64,
 *       pub is_final: bool,
 *   }
 *
 * Tras serializar a JSON vía window.emit, HashMap<String,f64> llega al
 * lado TS como un objeto plano (Record<string, number>), no como un Map
 * — JSON no tiene un tipo Map nativo. SimulationFrame de abajo refleja
 * eso explícitamente para que no haya sorpresas de tipo en runtime.
 *
 * Convención de keys (decisión de diseño, ver SKILL.md de esta skill si
 * quieres cambiarla):
 *   - node_voltages: key = NetId tal como lo produce NetGraph.snapshot()
 *     (ej. "N$1", "VCC"). El backend Rust necesita nombrar sus nodos MNA
 *     con esos mismos strings para que esto calce — si tu mna_solver.rs
 *     actualmente nombra nodos con otro esquema (ej. índices numéricos
 *     de matriz), hace falta un paso de traducción en el backend o un
 *     mapa NetId<->índice de nodo MNA en algún punto del pipeline. Esto
 *     no lo puede resolver el lado TS solo.
 *   - branch_currents: key = WireId (id del wire tal como vive en
 *     WireInstance del canvas_orchestrator) — porque la corriente es
 *     propiedad de la rama (el wire), no del nodo. Ver
 *     references/simulation-feedback.md, sección "Probes interactivos",
 *     para la justificación de esta distinción conceptual.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface SimulationFrame {
  time: number;
  /** key = NetId (ej. "N$1", "VCC"), value = voltaje en voltios */
  node_voltages: Record<string, number>;
  /** key = WireId, value = corriente con signo en amperios */
  branch_currents: Record<string, number>;
  frame_index: number;
  is_final: boolean;
}

export type TransientStreamStatus = "idle" | "running" | "stopped" | "error";

export interface TransientStreamState {
  status: TransientStreamStatus;
  latestFrame: SimulationFrame | null;
  /** Historial acotado de frames recientes, útil para scrubbing de timeline sin tener que pedirle todo el historial al backend. Ver maxBufferedFrames. */
  frameBuffer: SimulationFrame[];
  errorMessage: string | null;
}

export interface TransientStreamOptions {
  /** Cuántos frames recientes mantener en memoria en el lado TS para scrubbing. Frames más viejos se descartan — el backend Rust es la fuente de verdad del historial completo si necesitas más. */
  maxBufferedFrames?: number;
  onFrame?: (frame: SimulationFrame) => void;
  onFinal?: (frame: SimulationFrame) => void;
  onError?: (message: string) => void;
}

/**
 * Crea y arranca un listener para el evento "sim-frame-update". Llamar
 * justo antes (o inmediatamente después) de invocar el comando Tauri
 * `start_interactive_transient`, para no perder los primeros frames si
 * el backend empieza a emitir más rápido de lo esperado.
 *
 * Devuelve un objeto con `state` (referencia mutable simple, no reactiva
 * por sí sola — envuélvela en useState/useSyncExternalStore si necesitas
 * que React re-renderice en cada frame; emitir un evento de React en
 * cada frame de una simulación rápida puede saturar el render loop, así
 * que considera throttling en el wrapper de React, no aquí) y `dispose()`
 * para des-suscribirse — SIEMPRE llamar dispose() al desmontar el
 * componente o al detener la simulación, o el listener sigue vivo y
 * sigue recibiendo eventos de una simulación que el usuario cree detenida.
 */
export async function createTransientStreamListener(
  options: TransientStreamOptions = {}
): Promise<{ state: TransientStreamState; dispose: () => void }> {
  const maxBufferedFrames = options.maxBufferedFrames ?? 600;

  const state: TransientStreamState = {
    status: "idle",
    latestFrame: null,
    frameBuffer: [],
    errorMessage: null,
  };

  let unlisten: UnlistenFn | null = null;

  unlisten = await listen<SimulationFrame>("sim-frame-update", (event) => {
    const frame = event.payload;
    state.status = "running";
    state.latestFrame = frame;
    state.frameBuffer.push(frame);
    if (state.frameBuffer.length > maxBufferedFrames) {
      state.frameBuffer.shift();
    }

    options.onFrame?.(frame);

    if (frame.is_final) {
      state.status = "stopped";
      options.onFinal?.(frame);
    }
  });

  const dispose = () => {
    unlisten?.();
    unlisten = null;
  };

  return { state, dispose };
}

/**
 * Invoca el comando `stop_interactive_transient`. Separado de dispose()
 * arriba a propósito: dispose() solo des-suscribe el listener de eventos
 * en el lado TS (limpieza de memoria/UI), mientras que esta función le
 * dice al backend Rust que detenga el hilo de simulación (limpieza de
 * recursos/CPU del lado Rust). Llama ambas al detener una simulación por
 * acción del usuario; dispose() sola basta al desmontar un componente
 * mientras la simulación ya terminó por sí misma (is_final === true).
 */
export async function stopTransientSimulation(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    await invoke<void>("stop_interactive_transient");
  } catch (err) {
    // Si el comando Tauri retorna Err(String), invoke() lanza con ese
    // string como mensaje — ver classifySimulationError en
    // simulation-error.ts para interpretar errores de convergencia vs.
    // errores de "no había nada corriendo" (no fatal, ignorar).
    console.warn("stop_interactive_transient falló:", err);
  }
}

/**
 * Lee la corriente de un wire específico desde un SimulationFrame, dado
 * su WireId. Paralelo a `colorForNet` en voltage-color-scale.ts pero para
 * branch_currents en vez de node_voltages — separados en archivos
 * distintos a propósito porque viven conceptualmente con sus respectivos
 * consumidores (color de voltaje vs. lectura de frame de streaming), no
 * porque haya una razón técnica fuerte para la división.
 *
 * Devuelve 0 (no undefined) si el wire no aparece en el frame, porque el
 * consumidor típico (CurrentFlowAnimation) ya trata 0A / por-debajo-del-
 * umbral como "no animar" — undefined obligaría a cada caller a manejar
 * un caso extra sin beneficio real.
 */
export function currentForWire(wireId: string, frame: SimulationFrame | null): number {
  if (!frame) return 0;
  return frame.branch_currents[wireId] ?? 0;
}
