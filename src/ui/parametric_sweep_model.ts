import type { ComponentInstance } from "../canvas_orchestrator";
import { formatSpiceValue } from "../simulation/spice_value_parser";

export type ParametricParameter =
  | "value"
  | "amplitude"
  | "frequency"
  | "offset"
  | "duty_cycle"
  | "w"
  | "l"
  | "wiper"
  | "temperature";

export interface ParametricTarget {
  componentId: string;
  parameter: ParametricParameter;
  label: string;
  unit: string;
  min: number;
  max: number;
  current: number;
  isLog: boolean;
  step?: number;
}

export interface SweepSettings {
  min: number;
  max: number;
  steps: number;
  isLog: boolean;
}

/**
 * Retorna los parámetros barribles disponibles para un componente dado.
 */
export function getAvailableParametersForComponent(component: ComponentInstance): ParametricTarget[] {
  const type = (component.type || "").toLowerCase();
  const id = component.id;
  const numVal = typeof component.value === "number" ? component.value : parseFloat(String(component.value)) || 1.0;

  switch (type) {
    case "resistor":
    case "resistor_us":
      return [
        {
          componentId: id,
          parameter: "value",
          label: `Resistencia (${id})`,
          unit: "Ω",
          min: Math.max(1, numVal * 0.1),
          max: Math.max(10, numVal * 10),
          current: numVal,
          isLog: true,
        },
      ];

    case "capacitor":
    case "polarized_capacitor":
      return [
        {
          componentId: id,
          parameter: "value",
          label: `Capacitancia (${id})`,
          unit: "F",
          min: Math.max(1e-12, numVal * 0.1),
          max: Math.max(1e-6, numVal * 10),
          current: numVal,
          isLog: true,
        },
      ];

    case "inductor":
      return [
        {
          componentId: id,
          parameter: "value",
          label: `Inductancia (${id})`,
          unit: "H",
          min: Math.max(1e-9, numVal * 0.1),
          max: Math.max(1e-3, numVal * 10),
          current: numVal,
          isLog: true,
        },
      ];

    case "dc_voltage":
    case "vsource":
    case "battery":
      return [
        {
          componentId: id,
          parameter: "value",
          label: `Voltaje DC (${id})`,
          unit: "V",
          min: Math.min(-10, numVal - 5),
          max: Math.max(15, numVal + 5),
          current: numVal,
          isLog: false,
        },
      ];

    case "ac_voltage":
    case "signal_generator":
      return [
        {
          componentId: id,
          parameter: "amplitude",
          label: `Amplitud (${id})`,
          unit: "V",
          min: 0.1,
          max: 20.0,
          current: (component as unknown as { amplitude?: number }).amplitude ?? 5.0,
          isLog: false,
        },
        {
          componentId: id,
          parameter: "frequency",
          label: `Frecuencia (${id})`,
          unit: "Hz",
          min: 10,
          max: 1_000_000,
          current: (component as unknown as { frequency?: number }).frequency ?? 1000.0,
          isLog: true,
        },
        {
          componentId: id,
          parameter: "offset",
          label: `Offset DC (${id})`,
          unit: "V",
          min: -10,
          max: 10,
          current: (component as unknown as { offset?: number }).offset ?? 0.0,
          isLog: false,
        },
      ];

    case "nmos":
    case "pmos":
    case "nmos_bsim3":
    case "pmos_bsim3":
    case "bsim3":
      return [
        {
          componentId: id,
          parameter: "w",
          label: `Ancho de Canal W (${id})`,
          unit: "m",
          min: 180e-9,
          max: 100e-6,
          current: (component as unknown as { w?: number }).w ?? 10e-6,
          isLog: true,
        },
        {
          componentId: id,
          parameter: "l",
          label: `Longitud de Canal L (${id})`,
          unit: "m",
          min: 180e-9,
          max: 10e-6,
          current: (component as unknown as { l?: number }).l ?? 180e-9,
          isLog: true,
        },
      ];

    case "potentiometer":
      return [
        {
          componentId: id,
          parameter: "wiper",
          label: `Cursor / Wiper (${id})`,
          unit: "%",
          min: 0.01,
          max: 0.99,
          current: (component as unknown as { wiper?: number }).wiper ?? 0.5,
          isLog: false,
          step: 0.01,
        },
      ];

    default:
      return [
        {
          componentId: id,
          parameter: "value",
          label: `Valor (${id})`,
          unit: "",
          min: Math.max(0.01, numVal * 0.1),
          max: Math.max(10, numVal * 10),
          current: numVal,
          isLog: false,
        },
      ];
  }
}

/**
 * Genera un arreglo de valores discretos de barrido paramétrico (Lineal o Logarítmico).
 */
export function generateSweepValues(settings: SweepSettings): number[] {
  const count = Math.max(2, Math.min(20, Math.round(settings.steps)));
  const { min, max, isLog } = settings;

  if (min >= max) return [min];

  const values: number[] = [];

  if (isLog && min > 0 && max > 0) {
    const logMin = Math.log10(min);
    const logMax = Math.log10(max);
    const step = (logMax - logMin) / (count - 1);
    for (let i = 0; i < count; i++) {
      values.push(Math.pow(10, logMin + i * step));
    }
  } else {
    const step = (max - min) / (count - 1);
    for (let i = 0; i < count; i++) {
      values.push(min + i * step);
    }
  }

  return values;
}

/**
 * Formatea un valor paramétrico para visualización amigable en UI y leyendas de osciloscopio.
 */
export function formatParametricValue(value: number, parameter: ParametricParameter, unit = ""): string {
  if (parameter === "wiper") {
    return `${(value * 100).toFixed(0)}%`;
  }
  if (parameter === "w" || parameter === "l") {
    if (value < 1e-6) return `${(value * 1e9).toFixed(0)} nm`;
    if (value < 1e-3) return `${(value * 1e6).toFixed(2)} µm`;
    return `${(value * 1e3).toFixed(2)} mm`;
  }
  const formatted = formatSpiceValue(value);
  return unit ? `${formatted}${unit}` : formatted;
}
