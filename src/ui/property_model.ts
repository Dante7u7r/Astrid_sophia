import type { ComponentInstance } from "../canvas_orchestrator";

export const DEDICATED_VALUE_EDITORS = new Set<ComponentInstance["type"]>([
  "dmm",
  "ldr",
  "thermistor",
  "opamp",
  "switch",
  "transformer",
  "x",
]);

export const ACTUATOR_MODEL_EDITORS = new Set<ComponentInstance["type"]>([
  "lamp",
  "relay",
  "buzzer",
]);

export interface UnitDisplayConfig {
  label: string;
  min: string;
  max: string;
}

export interface LiveMutation {
  componentId: string;
  field: string;
  value: number;
}

export interface ValueEditorPresentation {
  showValueGroup: boolean;
  showUnitGroup: boolean;
  valueLabel: string;
  showSliderControls: boolean;
}

export function finiteOr(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getValueEditorPresentation(type: ComponentInstance["type"]): ValueEditorPresentation {
  if (ACTUATOR_MODEL_EDITORS.has(type)) {
    return {
      showValueGroup: true,
      showUnitGroup: false,
      valueLabel: "Modelo electrico",
      showSliderControls: false,
    };
  }
  if (type === "mcu_8051" || type === "mcu_avr") {
    return {
      showValueGroup: false,
      showUnitGroup: false,
      valueLabel: "Valor Nominal",
      showSliderControls: true,
    };
  }
  if (type === "arduino_uno" || type === "esp32" || type === "raspberry_pi_pico") {
    return {
      showValueGroup: true,
      showUnitGroup: false,
      valueLabel: "Modo de Simulacion (0-3)",
      showSliderControls: true,
    };
  }
  if (DEDICATED_VALUE_EDITORS.has(type)) {
    return {
      showValueGroup: false,
      showUnitGroup: false,
      valueLabel: "Valor Nominal",
      showSliderControls: true,
    };
  }
  return {
    showValueGroup: true,
    showUnitGroup: true,
    valueLabel: "Valor Nominal",
    showSliderControls: true,
  };
}

export function getUnitDisplayConfig(type: ComponentInstance["type"]): UnitDisplayConfig {
  switch (type) {
    case "resistor":
      return { label: "Ohmios (Ohm)", min: "1", max: "10000" };
    case "potentiometer":
      return { label: "Resistencia Total (Ohm)", min: "10", max: "1000000" };
    case "capacitor":
      return { label: "Faradios (F)", min: "0.000000001", max: "0.001" };
    case "inductor":
      return { label: "Henrios (H)", min: "0.000001", max: "1" };
    case "diode":
      return { label: "Unidad Exponencial", min: "0", max: "2" };
    case "npn":
    case "pnp":
      return { label: "Beta Ganancia (beta)", min: "10", max: "500" };
    case "nmos":
    case "pmos":
      return { label: "Tension Umbral (Vt)", min: "-3", max: "3" };
    case "vsource":
      return { label: "Voltios (V)", min: "-50", max: "50" };
    case "isource":
      return { label: "Amperios (A)", min: "-5", max: "5" };
    case "transformer":
      return { label: "Inductancia Mutua (H)", min: "0.000001", max: "1" };
    default:
      return { label: "Valor Nominal", min: "0", max: "100" };
  }
}

export function supportsLiveMutation(type: ComponentInstance["type"]): boolean {
  return ["resistor", "vsource", "isource", "switch", "opamp"].includes(type);
}

export function clampSwitchProperties(component: ComponentInstance, values: {
  stateChecked?: boolean;
  ron?: string;
  roff?: string;
  vth?: string;
  vh?: string;
}): void {
  component.switchState = values.stateChecked ?? false;
  component.switchRon = Math.max(1e-6, finiteOr(values.ron ?? "", 0.01));
  component.switchRoff = Math.max(
    component.switchRon,
    finiteOr(values.roff ?? "", 1e9),
  );
  component.switchVth = finiteOr(values.vth ?? "", 0.5);
  component.switchVh = Math.max(0, finiteOr(values.vh ?? "", 0.05));
}

export function clampTransformerProperties(component: ComponentInstance, values: {
  l1?: string;
  l2?: string;
  k?: string;
}): void {
  component.primaryInductance = Math.max(1e-9, finiteOr(values.l1 ?? "", 1e-3));
  component.secondaryInductance = Math.max(1e-9, finiteOr(values.l2 ?? "", 1e-3));
  component.couplingCoefficient = Math.min(
    0.9999,
    Math.max(0, finiteOr(values.k ?? "", 0.9)),
  );
  component.value = component.primaryInductance;
}

export function buildLiveMutations(
  component: ComponentInstance,
  nominalValue: number,
): LiveMutation[] {
  const mutations: LiveMutation[] = [];

  if (component.type !== "switch" && component.type !== "opamp") {
    mutations.push({ componentId: component.id, field: "value", value: nominalValue });
  }
  if (component.amplitude !== undefined) {
    mutations.push({ componentId: component.id, field: "amplitude", value: component.amplitude });
  }
  if (component.frequency !== undefined) {
    mutations.push({ componentId: component.id, field: "frequency", value: component.frequency });
  }
  if (component.offset !== undefined) {
    mutations.push({ componentId: component.id, field: "offset", value: component.offset });
  }
  if (component.dutyCycle !== undefined) {
    mutations.push({ componentId: component.id, field: "duty_cycle", value: component.dutyCycle });
  }
  if (component.switchRon !== undefined) {
    mutations.push({ componentId: component.id, field: "switch_ron", value: component.switchRon });
  }
  if (component.switchRoff !== undefined) {
    mutations.push({ componentId: component.id, field: "switch_roff", value: component.switchRoff });
  }
  if (component.switchVth !== undefined) {
    mutations.push({ componentId: component.id, field: "switch_vth", value: component.switchVth });
  }
  if (component.switchVh !== undefined) {
    mutations.push({ componentId: component.id, field: "switch_vh", value: component.switchVh });
  }
  if (component.type === "switch") {
    mutations.push({
      componentId: component.id,
      field: "switch_state",
      value: component.switchState ? 1 : 0,
    });
  }
  if (component.type === "opamp") {
    mutations.push({ componentId: `${component.id}__vos`, field: "value", value: component.offsetVoltage ?? 0.002 });
    mutations.push({ componentId: component.id, field: "value", value: component.openLoopGain ?? 100000.0 });
  }

  return mutations;
}
