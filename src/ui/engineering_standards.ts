// ==========================================================================
// ENGINEERING STANDARDS — Series Normalizadas (E12/E24) y Presets EDA
// ==========================================================================

import type { ComponentInstance } from "../canvas_orchestrator";

export const STANDARD_SERIES_E12 = [
  1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2,
] as const;

export const STANDARD_SERIES_E24 = [
  1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0,
  3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1,
] as const;

/**
 * Ajusta cualquier valor físico al valor comercial normalizado más cercano en la serie E12 o E24.
 * Funciona para cualquier orden de magnitud (p. ej. pF, nF, µF, Ω, kΩ, MΩ, µH, mH).
 */
export function snapToStandardValue(val: number, series: "E12" | "E24" = "E24"): number {
  if (!Number.isFinite(val) || val <= 0) return val;

  const standardValues: readonly number[] = series === "E12" ? STANDARD_SERIES_E12 : STANDARD_SERIES_E24;
  const decadePower = Math.floor(Math.log10(val));
  const decade = Math.pow(10, decadePower);
  const normalized = val / decade;

  let closest: number = standardValues[0];
  let minDiff = Math.abs(normalized - closest);

  for (let i = 1; i < standardValues.length; i++) {
    const diff = Math.abs(normalized - standardValues[i]);
    if (diff < minDiff) {
      minDiff = diff;
      closest = standardValues[i];
    }
  }

  // Comprobar si está más cerca del 10.0 (siguiente década)
  const diffToNextDecade = Math.abs(normalized - 10.0);
  if (diffToNextDecade < minDiff) {
    return 10.0 * decade;
  }

  // Redondear a 4 cifras significativas para evitar errores de coma flotante
  return Number((closest * decade).toPrecision(4));
}

export interface ComponentPreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly values: Partial<ComponentInstance>;
}

export const COMPONENT_PRESETS: Record<string, readonly ComponentPreset[]> = {
  resistor: [
    {
      id: "pullup_10k",
      label: "📌 Pull-Up / Pull-Down (10 kΩ, 1%, 1/4W)",
      description: "Estándar para líneas I2C, SPI, botones y reset de microcontroladores.",
      values: { value: 10000, tolerance: 1, powerRating: 0.25 },
    },
    {
      id: "led_limit_5v",
      label: "💡 Limitador LED 5V (220 Ω, 5%, 1/4W)",
      description: "Corriente nominal ≈ 15-20 mA para LEDs estándar con lógica de 5V.",
      values: { value: 220, tolerance: 5, powerRating: 0.25 },
    },
    {
      id: "led_limit_3v3",
      label: "💡 Limitador LED 3.3V (100 Ω, 5%, 1/4W)",
      description: "Para microcontroladores de 3.3V (ESP32, ARM Cortex, RP2040).",
      values: { value: 100, tolerance: 5, powerRating: 0.25 },
    },
    {
      id: "rf_term_50",
      label: "📡 Terminación RF (50 Ω, 0.1%, 1W)",
      description: "Adaptación de impedancia característica para líneas de transmisión RF.",
      values: { value: 50, tolerance: 0.1, powerRating: 1.0 },
    },
    {
      id: "current_shunt_01",
      label: "⚡ Shunt de Corriente (0.1 Ω, 1%, 5W)",
      description: "Medición de corriente de baja pérdida en etapas de potencia.",
      values: { value: 0.1, tolerance: 1, powerRating: 5.0 },
    },
    {
      id: "precision_div_100k",
      label: "⚖️ Divisor de Precisión (100 kΩ, 0.1%, 1/4W)",
      description: "Acondicionamiento de señal para ADC con bajo consumo.",
      values: { value: 100000, tolerance: 0.1, powerRating: 0.25 },
    },
  ],
  capacitor: [
    {
      id: "decoupling_100n",
      label: "🛡️ Desacoplo IC (100 nF, 50V, MLCC)",
      description: "Filtro de alta frecuencia junto a los pines de alimentación de circuitos integrados.",
      values: { value: 1e-7, voltageRating: 50, esr: 0.05, dielectricType: "ceramic" },
    },
    {
      id: "bulk_470u",
      label: "🔋 Filtro Fuente Bulk (470 µF, 35V, Electrolítico)",
      description: "Filtrado de rizado para fuentes lineales y conmutadas.",
      values: { value: 4.7e-4, voltageRating: 35, esr: 0.12, dielectricType: "electrolytic" },
    },
    {
      id: "power_1000u",
      label: "⚡ Reservorio de Potencia (1000 µF, 50V, Electrolítico)",
      description: "Etapas de potencia y filtros de alta corriente.",
      values: { value: 1e-3, voltageRating: 50, esr: 0.08, dielectricType: "electrolytic" },
    },
    {
      id: "audio_bypass_10u",
      label: "🎵 Bypass Audio / Analógico (10 µF, 25V, Tántalo)",
      description: "Bajo ESR y alta estabilidad para desacoplo de audio de alta fidelidad.",
      values: { value: 1e-5, voltageRating: 25, esr: 0.02, dielectricType: "tantalum" },
    },
    {
      id: "crystal_load_22p",
      label: "⏱️ Carga de Cristal Oscilador (22 pF, 50V, C0G/NP0)",
      description: "Capacitor de carga para resonadores de cuarzo en MCUs.",
      values: { value: 2.2e-11, voltageRating: 50, esr: 0.01, dielectricType: "ceramic" },
    },
    {
      id: "snubber_100n_400v",
      label: "⚡ Snubber / Filtro Red (100 nF, 400V, Film)",
      description: "Protección de transitorios en conmutación de alta tensión.",
      values: { value: 1e-7, voltageRating: 400, esr: 0.2, dielectricType: "film" },
    },
  ],
  inductor: [
    {
      id: "emi_choke_100u",
      label: "🛡️ Choke EMI (100 µH, DCR=0.2 Ω, Isat=1.5 A)",
      description: "Supresión de ruido de alta frecuencia en líneas de alimentación.",
      values: { value: 1e-4, dcResistance: 0.2, currentRating: 1.5 },
    },
    {
      id: "buck_power_10u",
      label: "⚡ Convertidor Buck DC-DC (10 µH, DCR=0.03 Ω, Isat=4.0 A)",
      description: "Inductor de potencia de alta eficiencia para reguladores conmutados.",
      values: { value: 1e-5, dcResistance: 0.03, currentRating: 4.0 },
    },
    {
      id: "rf_choke_1m",
      label: "📡 Choke RF (1 mH, DCR=1.5 Ω, Isat=0.3 A)",
      description: "Bloqueo de RF para polarización de transistores y mezcladores.",
      values: { value: 1e-3, dcResistance: 1.5, currentRating: 0.3 },
    },
  ],
  diode: [
    {
      id: "signal_1n4148",
      label: "⚡ Señal Rápida (1N4148, Vf=0.7V, If=200mA)",
      description: "Conmutación de alta velocidad (trr=4ns) para lógica y protecciones.",
      values: { value: 0.7, forwardVoltage: 0.7, maxCurrent: 200, modelName: "1N4148" },
    },
    {
      id: "rectifier_1n4007",
      label: "🔌 Rectificador de Red (1N4007, 1000V, 1A)",
      description: "Puente rectificador y fuentes de alimentación generales.",
      values: { value: 0.7, forwardVoltage: 0.7, maxCurrent: 1000, modelName: "1N4007" },
    },
    {
      id: "schottky_1n5819",
      label: "⚡ Schottky Baja Caída (1N5819, Vf=0.35V, 1A)",
      description: "Rectificación de alta frecuencia y protección contra polaridad inversa.",
      values: { value: 0.35, forwardVoltage: 0.35, maxCurrent: 1000, modelName: "1N5819" },
    },
    {
      id: "zener_3v3",
      label: "⚖️ Zener Regulador 3.3V (1N4728A)",
      description: "Referencia de tensión y fijación de nivel para lógica de 3.3V.",
      values: { value: 0.7, forwardVoltage: 0.7, maxCurrent: 500, modelName: "1N4728A", diodeBv: 3.3 },
    },
    {
      id: "zener_5v1",
      label: "⚖️ Zener Regulador 5.1V (1N4733A)",
      description: "Estabilizador y abrazadera de tensión para buses de 5V.",
      values: { value: 0.7, forwardVoltage: 0.7, maxCurrent: 500, modelName: "1N4733A", diodeBv: 5.1 },
    },
    {
      id: "zener_12v",
      label: "⚖️ Zener Regulador 12V (1N4742A)",
      description: "Protección y fuentes de polarización en 12V.",
      values: { value: 0.7, forwardVoltage: 0.7, maxCurrent: 500, modelName: "1N4742A", diodeBv: 12.0 },
    },
  ],
};
