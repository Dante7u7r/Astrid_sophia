/**
 * voltage-color-scale.ts
 *
 * Mapeo de voltaje -> color HSL. Ver references/simulation-feedback.md,
 * sección "Color-coding de voltaje" para la justificación de por qué
 * usamos hue continuo en vez de buckets discretos, y por qué el rango
 * (fijo vs auto) es una decisión de producto explícita, no un detalle
 * de implementación a ignorar.
 *
 * INTEGRACIÓN CON ASTRYD SOPHIA:
 * `SimulationFrame.node_voltages` (definido en transient-stream.ts) es un
 * `Record<string, number>` tras la serialización JSON del
 * `HashMap<String,f64>` de Rust — las funciones de este archivo aceptan
 * ese shape directamente, no piden que conviertas a array primero.
 */

import type { SimulationFrame } from "./transient-stream";
import type { NetId } from "./net-graph";

export interface VoltageColorScaleConfig {
  mode: "fixed" | "auto";
  // Solo relevante si mode === "fixed". Si mode === "auto", estos se
  // recalculan por simulación a partir de los datos reales (ver
  // computeAutoRange).
  fixedMin: number;
  fixedMax: number;
}

export const DEFAULT_VOLTAGE_SCALE: VoltageColorScaleConfig = {
  mode: "fixed",
  fixedMin: -5,
  fixedMax: 5,
};

/**
 * Dado el mapa de voltajes de nodo de un SimulationFrame, calcula un
 * rango simétrico razonable para modo "auto". Simétrico (en vez de
 * min/max exactos) porque un circuito con voltajes 0V a 9V se lee mejor
 * con escala -9 a 9 centrada en 0 (donde 0V cae en el verde neutro) que
 * con escala 0-9 donde el "azul" nunca aparece y pierdes la mitad
 * útil de la escala de color.
 */
export function computeAutoRange(
  nodeVoltages: SimulationFrame["node_voltages"]
): { min: number; max: number } {
  const voltages = Object.values(nodeVoltages);
  if (voltages.length === 0) return { min: -5, max: 5 };
  const maxAbs = Math.max(...voltages.map((v) => Math.abs(v)), 0.001);
  return { min: -maxAbs, max: maxAbs };
}

/**
 * Resuelve el color de un net específico directamente desde un
 * SimulationFrame, dado su NetId (el mismo que produce
 * NetGraph.snapshot().netOfPin / NetGraph.getVoltageKey()). Devuelve un
 * color neutro si el net no aparece en el frame (caso típico: net
 * recién creado en el editor que aún no ha sido simulado, o un id que
 * no coincide entre el lado TS y el naming de nodos MNA en Rust — si ves
 * esto pasar para nets que SÍ deberían tener datos, es señal de que la
 * convención de naming entre snapshot() y mna_solver.rs no está
 * alineada, ver nota en transient-stream.ts).
 */
export function colorForNet(
  netId: NetId,
  frame: SimulationFrame | null,
  range: { min: number; max: number }
): string {
  if (!frame) return "var(--component-neutral, #666)";
  const voltage = frame.node_voltages[netId];
  if (voltage === undefined) return "var(--component-neutral, #666)";
  return voltageToColor(voltage, range);
}

/**
 * Convierte un voltaje a un color HSL string, dado el rango activo.
 * hue: 240 (azul) en el extremo negativo -> 120 (verde) en el centro
 * -> 0 (rojo) en el extremo positivo. Esto da una transición azul->verde->rojo
 * que es perceptualmente más informativa que azul->rojo directo (donde el
 * punto medio sería un magenta poco intuitivo).
 */
export function voltageToColor(
  voltage: number,
  range: { min: number; max: number }
): string {
  const { min, max } = range;
  const clamped = Math.max(min, Math.min(max, voltage));
  const normalized = (clamped - min) / (max - min || 1); // 0..1

  // 0 -> hue 240 (azul), 0.5 -> hue 120 (verde), 1 -> hue 0 (rojo)
  const hue = 240 - normalized * 240;
  const saturation = 75;
  // Lightness ligeramente más alta cerca del centro para que el "neutro"
  // no se vea apagado/oscuro — ajuste perceptual, no esencial pero mejora
  // bastante la legibilidad en fondos oscuros típicos de apps de EDA.
  const lightness = 45 + (1 - Math.abs(normalized - 0.5) * 2) * 5;

  return `hsl(${hue.toFixed(1)}, ${saturation}%, ${lightness}%)`;
}

/**
 * Trunca un voltaje a una cantidad de cifras significativas consistente
 * con la tolerancia de convergencia del solver — ver anti-patrón de
 * "falsa precisión" en el reference doc. Ajusta sigFigs si tu solver
 * tiene una tolerancia distinta a la asumida aquí (1e-6 relativo típico).
 */
export function formatVoltageForDisplay(voltage: number, sigFigs = 4): string {
  if (voltage === 0) return "0 V";
  const magnitude = Math.floor(Math.log10(Math.abs(voltage)));
  const factor = Math.pow(10, sigFigs - 1 - magnitude);
  const rounded = Math.round(voltage * factor) / factor;
  return `${rounded} V`;
}
