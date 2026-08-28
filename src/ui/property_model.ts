import type { ComponentInstance } from "../canvas_orchestrator";
import { parseSpiceValue, formatSpiceValue } from "../simulation/spice_value_parser";

export const DEDICATED_VALUE_EDITORS = new Set<ComponentInstance["type"]>([
  "dmm",
  "ldr",
  "thermistor",
  "opamp",
  "opamp_ideal",
  "comparator_ideal",
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
  unitSymbol: string;
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
  showSnapSeries: boolean;
}

export interface EngineeringBadgeResult {
  valid: boolean;
  badgeText: string;
  baseValue?: number;
  isExpression?: boolean;
  error?: string;
}

export interface PinTelemetry {
  pinIndex: number;
  pinName: string;
  nodeId: string;
  voltage: number;
  current?: number;
}

export interface SmallSignalParameters {
  gm?: number;   // Transconductancia (A/V o S)
  rpi?: number;  // Resistencia dinámica de entrada r_pi (Ohms)
  ro?: number;   // Resistencia dinámica de salida r_o (Ohms)
  rd?: number;   // Resistencia dinámica del diodo r_d (Ohms)
}

export interface ComponentOperatingPoint {
  vDrop: number;
  iBranch: number;
  power: number;
  powerRatio?: number;
  isOverloaded?: boolean;
  region?: string;
  smallSignal?: SmallSignalParameters;
  pins: PinTelemetry[];
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
      showSnapSeries: false,
    };
  }
  if (type === "mcu_8051" || type === "mcu_avr") {
    return {
      showValueGroup: false,
      showUnitGroup: false,
      valueLabel: "Valor Nominal",
      showSliderControls: false,
      showSnapSeries: false,
    };
  }
  if (type === "arduino_uno" || type === "esp32" || type === "raspberry_pi_pico") {
    return {
      showValueGroup: true,
      showUnitGroup: false,
      valueLabel: "Modo de Simulacion (0-3)",
      showSliderControls: false,
      showSnapSeries: false,
    };
  }
  if (type === "ground") {
    return {
      showValueGroup: false,
      showUnitGroup: false,
      valueLabel: "Referencia 0 V",
      showSliderControls: false,
      showSnapSeries: false,
    };
  }
  if (type === "net_label") {
    return {
      showValueGroup: true,
      showUnitGroup: false,
      valueLabel: "Nombre de Red",
      showSliderControls: false,
      showSnapSeries: false,
    };
  }
  if (type === "text_note") {
    return {
      showValueGroup: true,
      showUnitGroup: false,
      valueLabel: "Contenido de la Nota",
      showSliderControls: false,
      showSnapSeries: false,
    };
  }
  if (DEDICATED_VALUE_EDITORS.has(type)) {
    return {
      showValueGroup: false,
      showUnitGroup: false,
      valueLabel: "Valor Nominal",
      showSliderControls: false,
      showSnapSeries: false,
    };
  }
  const isPassiveWithSeries = type === "resistor" || type === "capacitor" || type === "inductor" || type === "potentiometer";
  return {
    showValueGroup: true,
    showUnitGroup: true,
    valueLabel: "Valor Nominal",
    showSliderControls: false,
    showSnapSeries: isPassiveWithSeries,
  };
}

export function getUnitDisplayConfig(type: ComponentInstance["type"]): UnitDisplayConfig {
  switch (type) {
    case "resistor":
      return { label: "Ohmios (Ω)", unitSymbol: "Ω", min: "1", max: "10000000" };
    case "potentiometer":
      return { label: "Resistencia Total (Ω)", unitSymbol: "Ω", min: "10", max: "10000000" };
    case "capacitor":
      return { label: "Faradios (F)", unitSymbol: "F", min: "0.000000000001", max: "1" };
    case "inductor":
      return { label: "Henrios (H)", unitSymbol: "H", min: "0.000000001", max: "100" };
    case "diode":
    case "zener_diode":
    case "schottky_diode":
      return { label: "Unidad Exponencial", unitSymbol: "", min: "0", max: "2" };
    case "npn":
    case "pnp":
      return { label: "Ganancia de Corriente Directa (hFE / β)", unitSymbol: "", min: "1", max: "2000" };
    case "nmos":
    case "pmos":
    case "bsim3nmos":
    case "bsim3pmos":
    case "bsim4nmos":
    case "bsim4pmos":
      return { label: "Tensión de Umbral (Vth, V)", unitSymbol: "V", min: "-10", max: "10" };
    case "vsource":
    case "power_port":
      return { label: "Voltios (V)", unitSymbol: "V", min: "-1000", max: "1000" };
    case "isource":
      return { label: "Amperios (A)", unitSymbol: "A", min: "-100", max: "100" };
    case "transformer":
      return { label: "Inductancia Primaria (H)", unitSymbol: "H", min: "0.000001", max: "100" };
    case "ground":
      return { label: "Referencia 0 V", unitSymbol: "V", min: "0", max: "0" };
    case "and_gate":
    case "or_gate":
    case "not_gate":
    case "nand_gate":
    case "nor_gate":
    case "xor_gate":
      return { label: "Nivel Lógico Alto VOH (V)", unitSymbol: "V", min: "0.8", max: "24" };
    case "opto":
      return { label: "Ratio de Transferencia de Corriente (CTR)", unitSymbol: "", min: "0.01", max: "100" };
    case "njf":
    case "pjf":
      return { label: "Tensión de Estrangulamiento (Vp / Vto, V)", unitSymbol: "V", min: "-20", max: "20" };
    case "net_label":
      return { label: "Identificador de Red", unitSymbol: "", min: "0", max: "0" };
    case "text_note":
      return { label: "Texto de Documentación", unitSymbol: "", min: "0", max: "0" };
    default:
      return { label: "Valor Nominal", unitSymbol: "", min: "0", max: "100" };
  }
}

/**
 * Formatea un badge de interpretación de ingeniería en tiempo real.
 * Si el usuario teclea `4.7k` para resistor -> `4.7 kΩ = 4,700 Ω`
 * Si teclea `{R_LOAD}` -> `Expresión Paramétrica`
 */
export function formatEngineeringBadge(
  rawInput: string,
  type: ComponentInstance["type"]
): EngineeringBadgeResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { valid: false, badgeText: "Introduce un valor", error: "Campo vacío" };
  }

  if (type === "net_label") {
    return {
      valid: true,
      badgeText: `Puerto / Red: ${trimmed.toUpperCase()}`,
    };
  }
  if (type === "text_note") {
    return {
      valid: true,
      badgeText: `Nota (${trimmed.length} caracteres)`,
    };
  }
  if (type === "ground") {
    return {
      valid: true,
      badgeText: "Referencia Global (0 V)",
    };
  }

  // Detectar expresiones paramétricas entre llaves {expr}
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const expr = trimmed.slice(1, -1).trim();
    return {
      valid: true,
      badgeText: `Expresión: ${expr}`,
      isExpression: true,
    };
  }

  const unitConfig = getUnitDisplayConfig(type);
  const symbol = unitConfig.unitSymbol;

  const parsed = parseSpiceValue(trimmed);
  if (!parsed.valid || parsed.value === undefined || !Number.isFinite(parsed.value)) {
    return {
      valid: false,
      badgeText: "Formato no válido (ej. 10k, 100n, 4.7u, 1Meg)",
      error: parsed.error || "Sintaxis numérica SPICE inválida",
    };
  }

  const num = parsed.value;
  const formattedSpice = formatSpiceValue(num);

  let secondaryText = "";
  if (Math.abs(num) >= 1000 || (Math.abs(num) < 1 && num !== 0)) {
    if (Math.abs(num) >= 1000 && Math.abs(num) <= 1e9) {
      secondaryText = ` = ${num.toLocaleString("en-US")} ${symbol}`.trimEnd();
    } else {
      secondaryText = ` = ${num.toExponential(3)} ${symbol}`.trimEnd();
    }
  }

  const mainText = symbol ? `${formattedSpice} ${symbol}` : formattedSpice;
  return {
    valid: true,
    badgeText: `${mainText}${secondaryText}`,
    baseValue: num,
  };
}

export function supportsLiveMutation(type: ComponentInstance["type"]): boolean {
  return [
    "resistor",
    "vsource",
    "isource",
    "switch",
    "opamp",
    "opamp_ideal",
    "comparator_ideal",
    "net_label",
    "and_gate",
    "or_gate",
    "not_gate",
    "nand_gate",
    "nor_gate",
    "xor_gate",
  ].includes(type);
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

  if (component.type !== "switch" && component.type !== "opamp" && component.type !== "opamp_ideal" && component.type !== "comparator_ideal" && component.type !== "net_label") {
    mutations.push({ componentId: component.id, field: "value", value: nominalValue });
  }
  if (component.type === "net_label") {
    const netName = String(component.label || component.value || component.id).trim().toUpperCase();
    if (component.terminalType === "power" || component.voltage !== undefined) {
      const sourceId = `V_PWR_${netName.replace(/[^A-Z0-9_]/gi, "_")}`;
      mutations.push({ componentId: sourceId, field: "value", value: component.voltage ?? nominalValue });
    } else if (component.terminalType === "generator") {
      const sourceId = `V_SIG_${component.id}`;
      mutations.push({ componentId: sourceId, field: "value", value: component.amplitude ?? nominalValue });
    }
  }
  if (component.amplitude !== undefined) {
    const sourceId = component.type === "net_label" ? `V_SIG_${component.id}` : component.id;
    mutations.push({ componentId: sourceId, field: "amplitude", value: component.amplitude });
  }
  if (component.frequency !== undefined) {
    const sourceId = component.type === "net_label" ? `V_SIG_${component.id}` : component.id;
    mutations.push({ componentId: sourceId, field: "frequency", value: component.frequency });
  }
  if (component.offset !== undefined) {
    const sourceId = component.type === "net_label" ? `V_SIG_${component.id}` : component.id;
    mutations.push({ componentId: sourceId, field: "offset", value: component.offset });
  }
  if (component.dutyCycle !== undefined) {
    const sourceId = component.type === "net_label" ? `V_SIG_${component.id}` : component.id;
    mutations.push({ componentId: sourceId, field: "duty_cycle", value: component.dutyCycle });
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
  if (component.type === "opamp" || component.type === "opamp_ideal" || component.type === "comparator_ideal") {
    mutations.push({ componentId: `${component.id}__vos`, field: "value", value: component.offsetVoltage ?? 0.002 });
    mutations.push({ componentId: component.id, field: "value", value: component.openLoopGain ?? 100000.0 });
  }

  return mutations;
}

/**
 * Calcula la telemetría del punto de operación (.OP) y parámetros de pequeña señal
 * a partir de las tensiones de nodos y corrientes de rama calculadas por el solver.
 */
export function calculateComponentOperatingPoint(
  comp: ComponentInstance,
  pinNodes: Array<{ pinIndex: number; pinName: string; nodeId: string }>,
  nodeVoltages: Record<string, number>,
  branchCurrents: Record<string, number>
): ComponentOperatingPoint | null {
  if (pinNodes.length === 0) return null;
  if (comp.type === "net_label" || comp.type === "text_note" || comp.type === "ground") {
    return null;
  }

  const pins: PinTelemetry[] = pinNodes.map(p => ({
    pinIndex: p.pinIndex,
    pinName: p.pinName,
    nodeId: p.nodeId,
    voltage: nodeVoltages[p.nodeId] ?? 0.0,
  }));

  // Caída de tensión
  let vDrop = 0;
  if (comp.type === "npn" || comp.type === "pnp") {
    // Pin 0: B, Pin 1: C, Pin 2: E
    const vc = pins[1]?.voltage ?? 0;
    const ve = pins[2]?.voltage ?? 0;
    vDrop = Math.abs(vc - ve);
  } else if (comp.type === "nmos" || comp.type === "pmos") {
    // Pin 0: G, Pin 1: D, Pin 2: S
    const vd = pins[1]?.voltage ?? 0;
    const vs = pins[2]?.voltage ?? 0;
    vDrop = Math.abs(vd - vs);
  } else {
    const v1 = pins[0]?.voltage ?? 0;
    const v2 = pins[1]?.voltage ?? 0;
    vDrop = Math.abs(v1 - v2);
  }

  // Corriente de rama
  const branchKey = comp.id.toUpperCase();
  let iBranch = branchCurrents[branchKey] ?? 0;
  if (iBranch === 0 && comp.type === "resistor") {
    const rVal = Number(comp.value) || 1;
    const v1 = pins[0]?.voltage ?? 0;
    const v2 = pins[1]?.voltage ?? 0;
    if (rVal > 0) iBranch = (v1 - v2) / rVal;
  }

  const absI = Math.abs(iBranch);
  const power = vDrop * absI;
  const powerRating = comp.powerRating ?? 0.25;
  const powerRatio = powerRating > 0 ? power / powerRating : undefined;
  const isOverloaded = powerRatio !== undefined && powerRatio > 1.0;

  // Clasificación de región de operación para transistores
  let region: string | undefined;
  let smallSignal: SmallSignalParameters | undefined;

  const VT = 0.02585; // Tensión térmica a 300 K (27 °C)

  if (comp.type === "npn" || comp.type === "pnp") {
    // Pin 0: Base, Pin 1: Colector, Pin 2: Emisor
    const vb = pins[0]?.voltage ?? 0;
    const vc = pins[1]?.voltage ?? 0;
    const ve = pins[2]?.voltage ?? 0;

    const vbe = comp.type === "npn" ? (vb - ve) : (ve - vb);
    const vce = comp.type === "npn" ? (vc - ve) : (ve - vc);
    const bf = comp.bjtBf ?? (Number(comp.value) || 100);
    const vaf = comp.bjtVaf ?? 100;

    if (vbe < 0.5) {
      region = "Corte (Cut-off)";
    } else if (vce < 0.2) {
      region = "Saturación (Saturation)";
    } else {
      region = "Activa Directa (Forward Active)";
      const ic = Math.max(1e-9, absI);
      const gm = ic / VT;
      const rpi = bf / gm;
      const ro = (vaf + Math.abs(vce)) / ic;
      smallSignal = { gm, rpi, ro };
    }
  } else if (comp.type === "nmos" || comp.type === "pmos" || comp.type === "bsim3nmos" || comp.type === "bsim3pmos" || comp.type === "bsim4nmos" || comp.type === "bsim4pmos") {
    // Pin 0: Gate, Pin 1: Drain, Pin 2: Source
    const vg = pins[0]?.voltage ?? 0;
    const vd = pins[1]?.voltage ?? 0;
    const vs = pins[2]?.voltage ?? 0;

    const isN = comp.type === "nmos" || comp.type === "bsim3nmos" || comp.type === "bsim4nmos";
    const vgs = isN ? (vg - vs) : (vs - vg);
    const vds = isN ? (vd - vs) : (vs - vd);
    const vth = comp.mosVth ?? (isN ? 1.5 : -1.5);

    const vov = vgs - Math.abs(vth);
    if (vov <= 0) {
      region = "Corte (Sub-threshold)";
    } else if (vds < vov) {
      region = "Triodo / Óhmica (Linear)";
      const id = Math.max(1e-9, absI);
      const gm = (2 * id) / Math.max(1e-3, vov);
      smallSignal = { gm };
    } else {
      region = "Saturación / Pellizco (Active Saturation)";
      const id = Math.max(1e-9, absI);
      const gm = (2 * id) / Math.max(1e-3, vov);
      const ro = 100 / id;
      smallSignal = { gm, ro };
    }
  } else if (comp.type === "njf" || comp.type === "pjf") {
    // Pin 0: Gate, Pin 1: Drain, Pin 2: Source
    const vg = pins[0]?.voltage ?? 0;
    const vd = pins[1]?.voltage ?? 0;
    const vs = pins[2]?.voltage ?? 0;

    const isN = comp.type === "njf";
    const vgs = isN ? (vg - vs) : (vs - vg);
    const vds = isN ? (vd - vs) : (vs - vd);
    const vp = comp.jfetVto ?? (isN ? -2.5 : 2.5);
    const beta = comp.jfetBeta ?? 0.0012;

    const vdiff = isN ? (vgs - vp) : (vp - vgs);
    if (vdiff <= 0) {
      region = "Corte (Pinch-off Cutoff)";
    } else if (vds < vdiff) {
      region = "Región Óhmica / Lineal";
      const gm = 2 * beta * vds;
      smallSignal = { gm };
    } else {
      region = "Saturación JFET (Pellizco)";
      const gm = 2 * beta * vdiff;
      const ro = 100 / Math.max(1e-9, absI);
      smallSignal = { gm, ro };
    }
  } else if (comp.type === "diode" || comp.type === "led" || comp.type === "zener_diode" || comp.type === "schottky_diode") {
    // Pin 0: Ánodo, Pin 1: Cátodo
    const vAnode = pins[0]?.voltage ?? 0;
    const vCathode = pins[1]?.voltage ?? 0;
    const vd = vAnode - vCathode;
    const vz = comp.diodeBv ?? (comp.type === "zener_diode" ? (Number(comp.value) || 5.1) : undefined);
    const eta = comp.diodeN ?? (comp.type === "schottky_diode" ? 1.05 : 1.75);

    if (vd < -0.1) {
      if (vz && vd <= -vz) {
        region = "Ruptura Zener / Avalancha";
        const rd = comp.diodeRs ?? 0.5;
        smallSignal = { rd };
      } else {
        region = "Polarización Inversa (Reverse Bias)";
      }
    } else if (vd >= (comp.type === "schottky_diode" ? 0.2 : 0.5)) {
      region = "Conducción Directa (Forward Bias)";
      const id = Math.max(1e-6, absI);
      const rd = (eta * VT) / id + (comp.diodeRs ?? 0.5);
      smallSignal = { rd };
    } else {
      region = "Zona de No Conducción (Off)";
    }
  }

  return {
    vDrop,
    iBranch: absI,
    power,
    powerRatio,
    isOverloaded,
    region,
    smallSignal,
    pins,
  };
}

export interface BatchSelectionSummary {
  isMultiple: boolean;
  count: number;
  isHomogeneous: boolean;
  primaryType: string;
  typeLabel: string;
  hasMixedValues: boolean;
  sharedValue?: number | string;
  hasMixedTolerances: boolean;
  sharedTolerance?: number;
  hasMixedPowerRatings: boolean;
  sharedPowerRating?: number;
  hasMixedVoltageRatings: boolean;
  sharedVoltageRating?: number;
  ids: string[];
}

export function analyzeBatchSelection(components: ComponentInstance[]): BatchSelectionSummary {
  if (!components || components.length === 0) {
    return {
      isMultiple: false,
      count: 0,
      isHomogeneous: false,
      primaryType: "",
      typeLabel: "",
      hasMixedValues: false,
      hasMixedTolerances: false,
      hasMixedPowerRatings: false,
      hasMixedVoltageRatings: false,
      ids: [],
    };
  }

  const count = components.length;
  const isMultiple = count > 1;
  const first = components[0];
  const primaryType = first.type;
  const isHomogeneous = components.every(c => c.type === primaryType);
  const ids = components.map(c => c.id);

  const TYPE_NAMES: Record<string, string> = {
    resistor: "Resistores",
    capacitor: "Capacitores",
    inductor: "Inductores",
    diode: "Diodos",
    led: "LEDs",
    npn: "Transistores NPN",
    pnp: "Transistores PNP",
    nmos: "MOSFETs Canal N",
    pmos: "MOSFETs Canal P",
    vsource: "Fuentes de Tensión",
    isource: "Fuentes de Corriente",
    opamp: "Amplificadores Operacionales",
  };

  const typeLabel = isHomogeneous
    ? (TYPE_NAMES[primaryType] || `Componentes (${primaryType})`)
    : "Componentes Mixtos";

  const firstVal = first.expression || first.value;
  const allSameVal = components.every(c => (c.expression || c.value) === firstVal);
  const hasMixedValues = !allSameVal;
  const sharedValue = allSameVal ? firstVal : undefined;

  const firstTol = first.tolerance;
  const allSameTol = components.every(c => c.tolerance === firstTol);
  const hasMixedTolerances = !allSameTol;
  const sharedTolerance = allSameTol ? firstTol : undefined;

  const firstPwr = first.powerRating;
  const allSamePwr = components.every(c => c.powerRating === firstPwr);
  const hasMixedPowerRatings = !allSamePwr;
  const sharedPowerRating = allSamePwr ? firstPwr : undefined;

  const firstVolt = first.voltageRating;
  const allSameVolt = components.every(c => c.voltageRating === firstVolt);
  const hasMixedVoltageRatings = !allSameVolt;
  const sharedVoltageRating = allSameVolt ? firstVolt : undefined;

  return {
    isMultiple,
    count,
    isHomogeneous,
    primaryType,
    typeLabel,
    hasMixedValues,
    sharedValue,
    hasMixedTolerances,
    sharedTolerance,
    hasMixedPowerRatings,
    sharedPowerRating,
    hasMixedVoltageRatings,
    sharedVoltageRating,
    ids,
  };
}

export function formatComponentSpiceCard(
  comp: ComponentInstance,
  pinNodes: { pinName: string; nodeId: string }[] = [],
): string {
  const n1 = pinNodes[0]?.nodeId ?? "N1";
  const n2 = pinNodes[1]?.nodeId ?? "N2";
  const valStr = comp.expression ? comp.expression : formatSpiceValue(Number(comp.value) || 0);

  switch (comp.type) {
    case "resistor": {
      const parts = [`R_${comp.id}`, n1, n2, valStr];
      if (comp.tolerance !== undefined) parts.push(`tol=${comp.tolerance}%`);
      if (comp.powerRating !== undefined) parts.push(`pwr=${comp.powerRating}W`);
      if (comp.tc1 !== undefined) parts.push(`tc1=${comp.tc1}e-6`);
      if (comp.esr !== undefined) parts.push(`esl=${formatSpiceValue(comp.esr)}H`);
      return parts.join(" ");
    }
    case "capacitor": {
      const parts = [`C_${comp.id}`, n1, n2, valStr];
      if (comp.esr !== undefined && comp.esr > 0) parts.push(`esr=${formatSpiceValue(comp.esr)}`);
      if (comp.voltageRating !== undefined) parts.push(`vmax=${comp.voltageRating}V`);
      if (comp.initialCondition !== undefined) parts.push(`IC=${comp.initialCondition}V`);
      return parts.join(" ");
    }
    case "inductor": {
      const parts = [`L_${comp.id}`, n1, n2, valStr];
      if (comp.dcResistance !== undefined && comp.dcResistance > 0) parts.push(`dcr=${comp.dcResistance}`);
      if (comp.isat !== undefined) parts.push(`isat=${comp.isat}A`);
      if (comp.initialCondition !== undefined) parts.push(`IC=${comp.initialCondition}A`);
      return parts.join(" ");
    }
    case "diode":
    case "zener_diode":
    case "led":
    case "schottky_diode": {
      const mName = comp.modelName || `D_${comp.id}_MOD`;
      const modelCard = `.MODEL ${mName} D (IS=${comp.diodeIs ?? "1e-14"} RS=${comp.diodeRs ?? "0.1"} N=${comp.diodeN ?? "1.0"}${comp.diodeBv ? ` BV=${comp.diodeBv}` : ""})`;
      const line = `D_${comp.id} ${n1} ${n2} ${mName}`;
      return `${line}\n${modelCard}`;
    }
    case "npn":
    case "pnp": {
      const nB = pinNodes[0]?.nodeId ?? "B";
      const nC = pinNodes[1]?.nodeId ?? "C";
      const nE = pinNodes[2]?.nodeId ?? "E";
      const mName = comp.modelName || `Q_${comp.id}_MOD`;
      const typeStr = comp.type.toUpperCase();
      const modelCard = `.MODEL ${mName} ${typeStr} (IS=${comp.bjtIs ?? "1e-14"} BF=${comp.bjtBf ?? comp.value ?? 100} VAF=${comp.bjtVaf ?? 100})`;
      const line = `Q_${comp.id} ${nC} ${nB} ${nE} ${mName}`;
      return `${line}\n${modelCard}`;
    }
    case "nmos":
    case "pmos": {
      const nG = pinNodes[0]?.nodeId ?? "G";
      const nD = pinNodes[1]?.nodeId ?? "D";
      const nS = pinNodes[2]?.nodeId ?? "S";
      const mName = comp.modelName || `M_${comp.id}_MOD`;
      const typeStr = comp.type === "nmos" ? "NMOS" : "PMOS";
      const modelCard = `.MODEL ${mName} ${typeStr} (VTO=${comp.mosVth ?? 1.0} KP=1e-3)`;
      const line = `M_${comp.id} ${nD} ${nG} ${nS} ${nS} ${mName}`;
      return `${line}\n${modelCard}`;
    }
    case "vsource": {
      if (comp.waveType && comp.waveType !== "dc") {
        return `V_${comp.id} ${n1} ${n2} SINE(${comp.offset ?? 0} ${comp.amplitude ?? 5} ${comp.frequency ?? 1000} 0 0 ${comp.phase ?? 0})`;
      }
      return `V_${comp.id} ${n1} ${n2} DC ${valStr}`;
    }
    case "isource": {
      return `I_${comp.id} ${n1} ${n2} DC ${valStr}`;
    }
    default:
      return `${comp.id} ${pinNodes.map(p => p.nodeId).join(" ") || "0 0"} ${valStr}`;
  }
}

