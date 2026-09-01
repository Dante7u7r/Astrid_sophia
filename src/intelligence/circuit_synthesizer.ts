import type { ComponentInstance, WireInstance } from "../canvas_orchestrator";
import { CURRENT_CIRCUIT_FILE_VERSION, type CircuitFileData } from "../persistence/circuit_file";

/**
 * CircuitSynthesizer — Asistente de Síntesis y Dimensionamiento de Circuitos
 *
 * Proporciona calculadoras científicas de ingeniería electrónica con mapeo a series
 * comerciales normalizadas estándar (E12, E24, E96):
 * - Filtros Activos de 2º orden Sallen-Key y MFB (Butterworth, Chebyshev, Bessel).
 * - Auto-polarización estable por divisor de tensión para BJT / MOSFET.
 * - Reguladores de tensión Zener Shunt.
 * - Temporizador 555 en modo astable y monoestable.
 * - Redes atenuadoras pasivas de RF (T y Pi) con impedancia adaptada.
 */

// Series estándar de décadas normalizadas EIA
export const E12_BASE = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
export const E24_BASE = [
  1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0,
  3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1,
];
export const E96_BASE = [
  1.00, 1.02, 1.05, 1.07, 1.10, 1.13, 1.15, 1.18, 1.21, 1.24, 1.27, 1.30,
  1.33, 1.37, 1.40, 1.43, 1.47, 1.50, 1.54, 1.58, 1.62, 1.65, 1.69, 1.74,
  1.78, 1.82, 1.87, 1.91, 1.96, 2.00, 2.05, 2.10, 2.15, 2.21, 2.26, 2.32,
  2.37, 2.43, 2.49, 2.55, 2.61, 2.67, 2.74, 2.80, 2.87, 2.94, 3.01, 3.09,
  3.16, 3.24, 3.32, 3.40, 3.48, 3.57, 3.65, 3.74, 3.83, 3.92, 4.02, 4.12,
  4.22, 4.32, 4.42, 4.53, 4.64, 4.75, 4.87, 4.99, 5.11, 5.23, 5.36, 5.49,
  5.62, 5.76, 5.90, 6.04, 6.19, 6.34, 6.49, 6.65, 6.81, 6.98, 7.15, 7.32,
  7.50, 7.68, 7.87, 8.06, 8.25, 8.45, 8.66, 8.87, 9.09, 9.31, 9.53, 9.76,
];

export type StandardSeries = "E12" | "E24" | "E96";

/**
 * Encuentra el valor normalizado comercial más próximo en la serie seleccionada (E12, E24, E96).
 */
export function findNearestStandardValue(value: number, series: StandardSeries = "E24"): number {
  if (!Number.isFinite(value) || value <= 0) return value;

  const baseValues = series === "E12" ? E12_BASE : series === "E96" ? E96_BASE : E24_BASE;
  const decade = Math.floor(Math.log10(value));
  const normVal = value / Math.pow(10, decade);

  let bestBase = baseValues[0];
  let minDiff = Infinity;

  // Evaluar base en la década actual y en la siguiente/anterior
  for (const base of baseValues) {
    const diff = Math.abs(normVal - base);
    if (diff < minDiff) {
      minDiff = diff;
      bestBase = base;
    }
  }

  // Comprobar borde superior (ej: 9.8 -> 10.0 en siguiente década)
  if (Math.abs(normVal - 10.0) < minDiff) {
    return Math.pow(10, decade + 1);
  }

  return Number((bestBase * Math.pow(10, decade)).toPrecision(3));
}

// -------------------------------------------------------------
// 1. SÍNTESIS DE FILTROS ACTIVOS SALLEN-KEY (2DO ORDEN)
// -------------------------------------------------------------

export type FilterApproximation = "butterworth" | "chebyshev_05db" | "bessel";
export type FilterType = "lowpass" | "highpass" | "bandpass";

export interface SallenKeySynthesisResult {
  readonly filterType: FilterType;
  readonly approximation: FilterApproximation;
  readonly targetCutoffHz: number;
  readonly r1_theoretical: number;
  readonly r2_theoretical: number;
  readonly c1_theoretical: number;
  readonly c2_theoretical: number;
  readonly r1_standard: number;
  readonly r2_standard: number;
  readonly c1_standard: number;
  readonly c2_standard: number;
  readonly actualCutoffHz: number;
  readonly qFactor: number;
  readonly dcGain: number;
}

export function synthesizeSallenKeyFilter(
  type: FilterType,
  approx: FilterApproximation,
  cutoffFreqHz: number,
  desiredC1Farads = 10e-9, // 10 nF por defecto
): SallenKeySynthesisResult {
  if (type === "bandpass") {
    throw new RangeError("La topología Sallen-Key paso banda todavía no tiene una síntesis validada.");
  }
  if (!Number.isFinite(cutoffFreqHz) || cutoffFreqHz <= 0) {
    throw new RangeError("La frecuencia de corte debe ser finita y mayor que cero.");
  }
  if (!Number.isFinite(desiredC1Farads) || desiredC1Farads <= 0) {
    throw new RangeError("C1 debe ser finito y mayor que cero.");
  }
  const fc = Math.max(1, cutoffFreqHz);
  const omegaC = 2 * Math.PI * fc;

  // Factores Q según aproximación polinómica
  let q = 0.7071; // Butterworth
  if (approx === "chebyshev_05db") q = 0.8637;
  else if (approx === "bessel") q = 0.5773;

  const c1 = desiredC1Farads;
  let c2 = c1;
  let r1 = 0;
  let r2 = 0;

  if (type === "lowpass") {
    // Diseño con componentes iguales de resistencia: R1 = R2 = R, C1 = 2Q / (omega * R), C2 = 1 / (2Q * omega * R)
    // Con C1 dado: C2 = C1 / (4 * Q^2)
    c2 = c1 / (4 * q * q);
    const r = 1 / (omegaC * Math.sqrt(c1 * c2));
    r1 = r;
    r2 = r;
  } else if (type === "highpass") {
    // Paso Alto: C1 = C2 = C, R1 = 1 / (2 * Q * omega * C), R2 = 2 * Q / (omega * C)
    c2 = c1;
    r1 = 1 / (2 * q * omegaC * c1);
    r2 = (2 * q) / (omegaC * c1);
  }

  const r1_std = findNearestStandardValue(r1, "E24");
  const r2_std = findNearestStandardValue(r2, "E24");
  const c1_std = findNearestStandardValue(c1, "E12");
  const c2_std = findNearestStandardValue(c2, "E12");

  const actualCutoff = 1 / (2 * Math.PI * Math.sqrt(r1_std * r2_std * c1_std * c2_std));

  return {
    filterType: type,
    approximation: approx,
    targetCutoffHz: fc,
    r1_theoretical: r1,
    r2_theoretical: r2,
    c1_theoretical: c1,
    c2_theoretical: c2,
    r1_standard: r1_std,
    r2_standard: r2_std,
    c1_standard: c1_std,
    c2_standard: c2_std,
    actualCutoffHz: actualCutoff,
    qFactor: q,
    dcGain: 1.0,
  };
}

// -------------------------------------------------------------
// 2. AUTO-POLARIZACIÓN ESTABLE BJT (DIVISOR DE TENSIÓN)
// -------------------------------------------------------------

export interface BjtBiasSynthesisResult {
  readonly vcc: number;
  readonly icTargetAmps: number;
  readonly vceTargetVolts: number;
  readonly beta: number;
  readonly rc_theoretical: number;
  readonly re_theoretical: number;
  readonly r1_theoretical: number;
  readonly r2_theoretical: number;
  readonly rc_standard: number;
  readonly re_standard: number;
  readonly r1_standard: number;
  readonly r2_standard: number;
  readonly actualIcAmps: number;
  readonly actualVceVolts: number;
  readonly stabilityFactor: number;
}

export function synthesizeBjtVoltageDividerBias(
  vcc: number,
  icTargetAmps: number,
  vceTargetVolts: number,
  beta = 100,
): BjtBiasSynthesisResult {
  const ic = Math.max(1e-5, icTargetAmps);
  const vce = Math.max(0.5, Math.min(vcc - 1, vceTargetVolts));
  const vbe = 0.7; // Tensión estándar silicio

  // Regla de diseño industrial: Ve ~ 0.1 * Vcc o 1.0V para estabilidad térmica
  const ve = Math.max(1.0, vcc * 0.1);
  const re = ve / ic;
  const rc = (vcc - vce - ve) / ic;

  // Tensión de base: Vb = Ve + Vbe
  const vb = ve + vbe;
  const ib = ic / beta;

  // Corriente de sangrado del divisor: I_bleed >= 10 * Ib para insensibilidad a Beta
  const iBleed = 10 * ib;
  const r2 = vb / iBleed;
  const r1 = (vcc - vb) / (iBleed + ib);

  const rc_std = findNearestStandardValue(rc, "E24");
  const re_std = findNearestStandardValue(re, "E24");
  const r1_std = findNearestStandardValue(r1, "E24");
  const r2_std = findNearestStandardValue(r2, "E24");

  // Recalcular punto de operación con componentes estándar (Thevenin en base)
  const vth = vcc * (r2_std / (r1_std + r2_std));
  const rth = (r1_std * r2_std) / (r1_std + r2_std);
  const actualIb = Math.max(0, (vth - vbe) / (rth + (beta + 1) * re_std));
  const actualIc = actualIb * beta;
  const actualVce = Math.max(0, vcc - actualIc * (rc_std + re_std));
  const stabilityFactor = 1 + rth / re_std; // S <= 10 es excelente

  return {
    vcc,
    icTargetAmps: ic,
    vceTargetVolts: vce,
    beta,
    rc_theoretical: rc,
    re_theoretical: re,
    r1_theoretical: r1,
    r2_theoretical: r2,
    rc_standard: rc_std,
    re_standard: re_std,
    r1_standard: r1_std,
    r2_standard: r2_std,
    actualIcAmps: actualIc,
    actualVceVolts: actualVce,
    stabilityFactor,
  };
}

// -------------------------------------------------------------
// 3. REGULADOR DE TENSIÓN ZENER SHUNT
// -------------------------------------------------------------

export interface ZenerRegulatorSynthesisResult {
  readonly vinMin: number;
  readonly vinMax: number;
  readonly vZener: number;
  readonly maxLoadCurrentAmps: number;
  readonly rs_theoretical: number;
  readonly rs_standard: number;
  readonly rs_powerWatts: number;
  readonly zener_maxPowerWatts: number;
  readonly isSafe: boolean;
}

export function synthesizeZenerRegulator(
  vinMin: number,
  vinMax: number,
  vZener: number,
  maxLoadCurrentAmps: number,
  minZenerCurrentAmps = 0.005, // 5 mA corriente de codo Iz_min
): ZenerRegulatorSynthesisResult {
  const ilMax = Math.max(1e-4, maxLoadCurrentAmps);
  const izMin = Math.max(1e-4, minZenerCurrentAmps);

  // Resistencia serie para garantizar Iz_min con Vin_min y carga máxima
  const rs = (vinMin - vZener) / (ilMax + izMin);
  const rs_std = findNearestStandardValue(rs, "E24");

  // Potencia en RS en el peor caso (Vin_max)
  const vDropRsMax = vinMax - vZener;
  const rsPower = (vDropRsMax * vDropRsMax) / rs_std;

  // Potencia máxima en el Zener (Vin_max sin carga conectada)
  const izMax = vDropRsMax / rs_std;
  const zenerPower = vZener * izMax;

  const isSafe = [vinMin, vinMax, vZener, ilMax, izMin, rs_std, rsPower, zenerPower]
    .every(Number.isFinite)
    && vinMin > vZener
    && vinMax >= vinMin
    && vZener > 0
    && rs_std > 0
    && rsPower > 0
    && zenerPower > 0;

  return {
    vinMin,
    vinMax,
    vZener,
    maxLoadCurrentAmps: ilMax,
    rs_theoretical: rs,
    rs_standard: rs_std,
    rs_powerWatts: rsPower,
    zener_maxPowerWatts: zenerPower,
    isSafe,
  };
}

// -------------------------------------------------------------
// 4. TEMPORIZADOR 555 ASTABLE
// -------------------------------------------------------------

export interface Timer555AstableResult {
  readonly targetFreqHz: number;
  readonly targetDutyPercent: number;
  readonly ra_standard: number;
  readonly rb_standard: number;
  readonly c_standard: number;
  readonly actualFreqHz: number;
  readonly actualDutyPercent: number;
}

export function synthesizeTimer555Astable(
  targetFreqHz: number,
  targetDutyPercent = 60, // En 555 clásico Duty siempre es > 50%
  desiredCFarads = 100e-9, // 100 nF
): Timer555AstableResult {
  const f = Math.max(0.1, targetFreqHz);
  const duty = Math.max(51, Math.min(99, targetDutyPercent)) / 100;
  const c = desiredCFarads;

  // f = 1.44 / ((Ra + 2Rb) * C), Duty = (Ra + Rb) / (Ra + 2Rb)
  // Rb = (1 - Duty) * 1.44 / (f * C)
  // Ra = (2*Duty - 1) * 1.44 / (f * C)
  const totalR = 1.44 / (f * c);
  const rb = (1 - duty) * totalR;
  const ra = (2 * duty - 1) * totalR;

  const ra_std = findNearestStandardValue(Math.max(100, ra), "E24");
  const rb_std = findNearestStandardValue(Math.max(100, rb), "E24");
  const c_std = findNearestStandardValue(c, "E12");

  const actualFreq = 1.44 / ((ra_std + 2 * rb_std) * c_std);
  const actualDuty = ((ra_std + rb_std) / (ra_std + 2 * rb_std)) * 100;

  return {
    targetFreqHz: f,
    targetDutyPercent: duty * 100,
    ra_standard: ra_std,
    rb_standard: rb_std,
    c_standard: c_std,
    actualFreqHz: actualFreq,
    actualDutyPercent: actualDuty,
  };
}

// -------------------------------------------------------------
// 5. ATENUADORES PASIVOS RF (REDES T Y PI)
// -------------------------------------------------------------

export interface AttenuatorSynthesisResult {
  readonly z0: number;
  readonly attenuationDb: number;
  readonly type: "T" | "PI";
  readonly r1_series_std: number; // R1 en T (serie) o R1 en PI (shunt)
  readonly r2_shunt_std: number;  // R2 en T (shunt) o R2 en PI (serie)
}

export function synthesizeRfAttenuator(
  attenuationDb: number,
  z0 = 50,
  type: "T" | "PI" = "PI",
): AttenuatorSynthesisResult {
  const attDb = Math.max(0.1, attenuationDb);
  const k = Math.pow(10, attDb / 20); // Relación de tensión V_in / V_out

  let r1 = 0;
  let r2 = 0;

  if (type === "T") {
    // Red T: R_series = Z0 * (k - 1) / (k + 1), R_shunt = Z0 * 2k / (k^2 - 1)
    r1 = z0 * ((k - 1) / (k + 1));
    r2 = z0 * ((2 * k) / (k * k - 1));
  } else {
    // Red Pi: R_shunt = Z0 * (k + 1) / (k - 1), R_series = Z0 * (k^2 - 1) / (2k)
    r1 = z0 * ((k + 1) / (k - 1));
    r2 = z0 * ((k * k - 1) / (2 * k));
  }

  const r1_std = findNearestStandardValue(r1, "E96");
  const r2_std = findNearestStandardValue(r2, "E96");

  return {
    z0,
    attenuationDb: attDb,
    type,
    r1_series_std: r1_std,
    r2_shunt_std: r2_std,
  };
}

// -------------------------------------------------------------
// 6. GENERADORES PROCEDURALES DE ESQUEMÁTICOS COMPLETOS
// -------------------------------------------------------------

export interface SynthesizedCircuitPackage {
  readonly title: string;
  readonly description: string;
  readonly circuit: CircuitFileData;
}

function createWire(
  id: string,
  fromComp: string,
  fromPin: number,
  toComp: string,
  toPin: number,
  points: { x: number; y: number }[],
): WireInstance {
  return {
    id,
    from: { componentId: fromComp, pinIndex: fromPin },
    to: { componentId: toComp, pinIndex: toPin },
    points,
  };
}

function createDefaultCircuitFile(
  components: ComponentInstance[],
  wires: WireInstance[],
): CircuitFileData {
  return {
    version: CURRENT_CIRCUIT_FILE_VERSION,
    components,
    wires,
    viewport: { zoom: 1.0, offsetX: 0, offsetY: 0 },
    simSettings: { dt: 1e-6, tolerance: 1e-4, maxIterations: 100, transientDuration: 0.01 },
    activeAnalysisMode: "TRAN",
    probes: { ch1ProbeNode: null, ch2ProbeNode: null, ch3ProbeNode: null, ch4ProbeNode: null },
    sparPorts: [],
    oscilloscope: {
      channelsEnabled: [true, true, false, false],
      voltsPerDiv: [1, 1, 1, 1],
      offsets: [0, 0, 0, 0],
      timeDivValue: 0.001,
      isXyMode: false,
      isCursorsEnabled: false,
      triggerChannel: "ch1",
      triggerEdge: "rising",
      triggerLevel: 0,
      cursorT1: 0.25,
      cursorT2: 0.75,
      cursorV1: 0,
      cursorV2: 0,
    },
  };
}

export function generateSallenKeySchematic(
  cutoffHz = 1000,
  type: FilterType = "lowpass",
  approx: FilterApproximation = "butterworth",
): SynthesizedCircuitPackage {
  const synth = synthesizeSallenKeyFilter(type, approx, cutoffHz);

  const frequencyElements: ComponentInstance[] = type === "lowpass"
    ? [
      { id: "R1", type: "resistor", value: synth.r1_standard, x: 280, y: 300, rotation: 0 },
      { id: "R2", type: "resistor", value: synth.r2_standard, x: 400, y: 300, rotation: 0 },
      { id: "C1", type: "capacitor", value: synth.c1_standard, x: 400, y: 180, rotation: 0 },
      { id: "C2", type: "capacitor", value: synth.c2_standard, x: 500, y: 380, rotation: 90 },
    ]
    : [
      { id: "C1", type: "capacitor", value: synth.c1_standard, x: 280, y: 300, rotation: 0 },
      { id: "C2", type: "capacitor", value: synth.c2_standard, x: 400, y: 300, rotation: 0 },
      { id: "R1", type: "resistor", value: synth.r1_standard, x: 400, y: 180, rotation: 0 },
      { id: "R2", type: "resistor", value: synth.r2_standard, x: 500, y: 380, rotation: 90 },
    ];

  const components: ComponentInstance[] = [
    {
      id: "V1",
      type: "vsource",
      value: 2,
      amplitude: 2,
      frequency: Math.max(10, Math.round(synth.actualCutoffHz / 2)),
      x: 160,
      y: 300,
      rotation: 0,
      waveType: "sine",
      acMag: 1.0,
      acPhase: 0,
    },
    { id: "GND1", type: "ground", value: 0, x: 160, y: 420, rotation: 0 },
    { id: "NET_VIN", type: "net_label", value: "NET_VIN", x: 200, y: 260, rotation: 0, terminalType: "test_point" },
    ...frequencyElements,
    { id: "GND2", type: "ground", value: 0, x: 500, y: 460, rotation: 0 },
    { id: "U1", type: "opamp_ideal", value: 0, x: 540, y: 300, rotation: 0, openLoopGain: 200000 },
    { id: "NET_VOUT", type: "net_label", value: "NET_VOUT", x: 660, y: 300, rotation: 0, terminalType: "test_point" },
  ];

  const firstSeriesElement = type === "lowpass" ? "R1" : "C1";
  const secondSeriesElement = type === "lowpass" ? "R2" : "C2";
  const feedbackElement = type === "lowpass" ? "C1" : "R1";
  const shuntElement = type === "lowpass" ? "C2" : "R2";
  const wires: WireInstance[] = [
    createWire("W1", "V1", 0, firstSeriesElement, 0, [{ x: 160, y: 300 }, { x: 240, y: 300 }]),
    createWire("W2", "V1", 1, "GND1", 0, [{ x: 160, y: 340 }, { x: 160, y: 400 }]),
    createWire("W3", firstSeriesElement, 1, secondSeriesElement, 0, [{ x: 320, y: 300 }, { x: 360, y: 300 }]),
    createWire("W4", firstSeriesElement, 1, feedbackElement, 0, [{ x: 320, y: 300 }, { x: 340, y: 300 }, { x: 340, y: 180 }, { x: 360, y: 180 }]),
    createWire("W5", secondSeriesElement, 1, "U1", 0, [{ x: 440, y: 300 }, { x: 500, y: 285 }]),
    createWire("W6", secondSeriesElement, 1, shuntElement, 0, [{ x: 440, y: 300 }, { x: 500, y: 340 }]),
    createWire("W7", shuntElement, 1, "GND2", 0, [{ x: 500, y: 420 }, { x: 500, y: 440 }]),
    createWire("W8", "U1", 2, feedbackElement, 1, [{ x: 580, y: 300 }, { x: 620, y: 300 }, { x: 620, y: 180 }, { x: 440, y: 180 }]),
    createWire("W9", "U1", 2, "U1", 1, [{ x: 580, y: 300 }, { x: 600, y: 300 }, { x: 600, y: 340 }, { x: 480, y: 340 }, { x: 480, y: 315 }, { x: 500, y: 315 }]),
    createWire("W10", "U1", 2, "NET_VOUT", 0, [{ x: 580, y: 300 }, { x: 660, y: 300 }]),
    createWire("W11", "V1", 0, "NET_VIN", 0, [{ x: 160, y: 300 }, { x: 200, y: 260 }]),
  ];

  return {
    title: `Filtro Sallen-Key ${type.toUpperCase()} (${approx}) - ${Math.round(synth.actualCutoffHz)} Hz`,
    description: `Filtro activo Sallen-Key ${type === "lowpass" ? "paso bajas" : "paso altas"} de 2º orden, con seguidor ideal y valores comerciales E24/E12.`,
    circuit: createDefaultCircuitFile(components, wires),
  };
}

export function generateBjtAmplifierSchematic(
  vcc = 12,
  icAmps = 0.002,
  vceVolts = 6,
  beta = 100,
): SynthesizedCircuitPackage {
  const synth = synthesizeBjtVoltageDividerBias(vcc, icAmps, vceVolts, beta);

  const components: ComponentInstance[] = [
    { id: "VCC", type: "vsource", value: vcc, amplitude: vcc, x: 160, y: 180, rotation: 0 },
    { id: "GND_VCC", type: "ground", value: 0, x: 160, y: 260, rotation: 0 },
    { id: "VIN", type: "vsource", value: 0.02, amplitude: 0.02, frequency: 1000, x: 160, y: 380, rotation: 0, waveType: "sine" },
    { id: "GND_IN", type: "ground", value: 0, x: 160, y: 460, rotation: 0 },
    { id: "NET_VIN", type: "net_label", value: "NET_VIN", x: 200, y: 380, rotation: 0, terminalType: "test_point" },
    { id: "C_IN", type: "capacitor", value: 10e-6, x: 260, y: 380, rotation: 0 },
    { id: "R1", type: "resistor", value: synth.r1_standard, x: 360, y: 240, rotation: 90 },
    { id: "R2", type: "resistor", value: synth.r2_standard, x: 360, y: 440, rotation: 90 },
    { id: "GND_R2", type: "ground", value: 0, x: 360, y: 520, rotation: 0 },
    { id: "Q1", type: "npn", value: "2N3904", x: 460, y: 380, rotation: 0 },
    { id: "RC", type: "resistor", value: synth.rc_standard, x: 480, y: 240, rotation: 90 },
    { id: "RE", type: "resistor", value: synth.re_standard, x: 480, y: 460, rotation: 90 },
    { id: "CE", type: "capacitor", value: 100e-6, x: 560, y: 460, rotation: 90 },
    { id: "GND_E", type: "ground", value: 0, x: 480, y: 540, rotation: 0 },
    { id: "GND_CE", type: "ground", value: 0, x: 560, y: 540, rotation: 0 },
    { id: "C_OUT", type: "capacitor", value: 10e-6, x: 580, y: 340, rotation: 0 },
    { id: "RL", type: "resistor", value: 10000, x: 680, y: 420, rotation: 90 },
    { id: "GND_L", type: "ground", value: 0, x: 680, y: 500, rotation: 0 },
    { id: "NET_VOUT", type: "net_label", value: "NET_VOUT", x: 720, y: 340, rotation: 0, terminalType: "test_point" },
  ];

  const wires: WireInstance[] = [
    createWire("W1", "VIN", 0, "C_IN", 0, [{ x: 160, y: 380 }, { x: 220, y: 380 }]),
    createWire("W2", "VIN", 1, "GND_IN", 0, [{ x: 160, y: 420 }, { x: 160, y: 440 }]),
    createWire("W3", "VCC", 1, "GND_VCC", 0, [{ x: 160, y: 220 }, { x: 160, y: 240 }]),
    createWire("W4", "VCC", 0, "R1", 0, [{ x: 160, y: 180 }, { x: 360, y: 180 }, { x: 360, y: 200 }]),
    createWire("W5", "VCC", 0, "RC", 0, [{ x: 360, y: 180 }, { x: 480, y: 180 }, { x: 480, y: 200 }]),
    createWire("W6", "C_IN", 1, "Q1", 0, [{ x: 300, y: 380 }, { x: 420, y: 380 }]),
    createWire("W7", "R1", 1, "Q1", 0, [{ x: 360, y: 280 }, { x: 360, y: 380 }, { x: 420, y: 380 }]),
    createWire("W8", "R2", 0, "Q1", 0, [{ x: 360, y: 400 }, { x: 360, y: 380 }]),
    createWire("W9", "R2", 1, "GND_R2", 0, [{ x: 360, y: 480 }, { x: 360, y: 500 }]),
    createWire("W10", "RC", 1, "Q1", 1, [{ x: 480, y: 280 }, { x: 480, y: 340 }]),
    createWire("W11", "Q1", 1, "C_OUT", 0, [{ x: 480, y: 340 }, { x: 540, y: 340 }]),
    createWire("W12", "Q1", 2, "RE", 0, [{ x: 480, y: 420 }, { x: 480, y: 420 }]),
    createWire("W13", "Q1", 2, "CE", 0, [{ x: 480, y: 420 }, { x: 560, y: 420 }]),
    createWire("W14", "RE", 1, "GND_E", 0, [{ x: 480, y: 500 }, { x: 480, y: 520 }]),
    createWire("W15", "CE", 1, "GND_CE", 0, [{ x: 560, y: 500 }, { x: 560, y: 520 }]),
    createWire("W16", "C_OUT", 1, "RL", 0, [{ x: 620, y: 340 }, { x: 680, y: 340 }, { x: 680, y: 380 }]),
    createWire("W17", "RL", 1, "GND_L", 0, [{ x: 680, y: 460 }, { x: 680, y: 480 }]),
    createWire("W18", "C_OUT", 1, "NET_VOUT", 0, [{ x: 620, y: 340 }, { x: 720, y: 340 }]),
  ];

  return {
    title: `Amplificador BJT Emisor Común (Ic = ${(synth.actualIcAmps * 1000).toFixed(1)} mA)`,
    description: `Amplificador clase A con autopolarización por divisor de tensión estable (S = ${synth.stabilityFactor.toFixed(1)}).`,
    circuit: createDefaultCircuitFile(components, wires),
  };
}

export function generateZenerRegulatorSchematic(
  vinMin = 15,
  vinMax = 20,
  vZener = 5.1,
  maxLoadCurrentAmps = 0.05,
): SynthesizedCircuitPackage {
  const synth = synthesizeZenerRegulator(vinMin, vinMax, vZener, maxLoadCurrentAmps);
  if (!synth.isSafe) {
    throw new RangeError(
      "No se puede generar el regulador Zener: se requiere Vin máx. ≥ Vin mín. > Vz y valores finitos positivos.",
    );
  }

  const components: ComponentInstance[] = [
    { id: "VIN", type: "vsource", value: (vinMin + vinMax) / 2, amplitude: (vinMin + vinMax) / 2, x: 160, y: 300, rotation: 0 },
    { id: "GND_IN", type: "ground", value: 0, x: 160, y: 400, rotation: 0 },
    { id: "NET_VIN", type: "net_label", value: "NET_VIN", x: 200, y: 300, rotation: 0, terminalType: "test_point" },
    { id: "RS", type: "resistor", value: synth.rs_standard, x: 300, y: 300, rotation: 0 },
    { id: "D_ZENER", type: "zener_diode", value: vZener, diodeBv: vZener, x: 440, y: 380, rotation: 90 },
    { id: "GND_Z", type: "ground", value: 0, x: 440, y: 460, rotation: 0 },
    { id: "RL", type: "resistor", value: findNearestStandardValue(vZener / synth.maxLoadCurrentAmps, "E24"), x: 560, y: 380, rotation: 90 },
    { id: "GND_L", type: "ground", value: 0, x: 560, y: 460, rotation: 0 },
    { id: "NET_VOUT", type: "net_label", value: "NET_VOUT", x: 620, y: 300, rotation: 0, terminalType: "test_point" },
  ];

  const wires: WireInstance[] = [
    createWire("W1", "VIN", 0, "RS", 0, [{ x: 160, y: 300 }, { x: 260, y: 300 }]),
    createWire("W2", "VIN", 1, "GND_IN", 0, [{ x: 160, y: 340 }, { x: 160, y: 380 }]),
    // Cátodo (pin 1) al nodo regulado y ánodo (pin 0) a tierra: polarización Zener inversa.
    createWire("W3", "RS", 1, "D_ZENER", 1, [{ x: 340, y: 300 }, { x: 440, y: 300 }, { x: 440, y: 420 }]),
    createWire("W4", "RS", 1, "RL", 0, [{ x: 440, y: 300 }, { x: 560, y: 300 }, { x: 560, y: 340 }]),
    createWire("W5", "D_ZENER", 0, "GND_Z", 0, [{ x: 440, y: 340 }, { x: 440, y: 440 }]),
    createWire("W6", "RL", 1, "GND_L", 0, [{ x: 560, y: 420 }, { x: 560, y: 440 }]),
    createWire("W7", "RS", 1, "NET_VOUT", 0, [{ x: 560, y: 300 }, { x: 620, y: 300 }]),
  ];

  return {
    title: `Regulador Zener Shunt (${vZener} V - ${(maxLoadCurrentAmps * 1000).toFixed(0)} mA)`,
    description: `Regulador de tensión con RS = ${synth.rs_standard} Ω y disipación calculada Pz = ${synth.zener_maxPowerWatts.toFixed(2)} W; las potencias nominales deben seleccionarse con margen.`,
    circuit: createDefaultCircuitFile(components, wires),
  };
}

export function generateTimer555Schematic(
  freqHz = 1000,
  dutyPercent = 60,
): SynthesizedCircuitPackage {
  const synth = synthesizeTimer555Astable(freqHz, dutyPercent);

  const components: ComponentInstance[] = [
    { id: "VCC", type: "vsource", value: 5, amplitude: 5, x: 160, y: 220, rotation: 0 },
    { id: "GND_VCC", type: "ground", value: 0, x: 160, y: 300, rotation: 0 },
    { id: "RA", type: "resistor", value: synth.ra_standard, x: 300, y: 220, rotation: 90 },
    { id: "RB", type: "resistor", value: synth.rb_standard, x: 300, y: 340, rotation: 90 },
    { id: "C1", type: "capacitor", value: synth.c_standard, x: 300, y: 460, rotation: 90 },
    { id: "GND_C", type: "ground", value: 0, x: 300, y: 540, rotation: 0 },
    {
      id: "NOTE_MODEL",
      type: "text_note",
      value: "Equivalente conductual del 555: la fuente PULSE reproduce f y duty; RA/RB/C documentan el diseño.",
      x: 470,
      y: 180,
      rotation: 0,
      noteTheme: "warning" as const,
    },
    {
      id: "V_OUT",
      type: "vsource",
      value: 0,
      amplitude: 5,
      offset: 0,
      frequency: synth.actualFreqHz,
      dutyCycle: synth.actualDutyPercent / 100,
      waveType: "pulse",
      x: 500,
      y: 340,
      rotation: 0,
    },
    { id: "GND_OUT", type: "ground", value: 0, x: 500, y: 440, rotation: 0 },
    { id: "R_LOAD", type: "resistor", value: 10_000, x: 620, y: 380, rotation: 90 },
    { id: "GND_LOAD", type: "ground", value: 0, x: 620, y: 460, rotation: 0 },
    { id: "NET_PULSE", type: "net_label", value: "NET_PULSE", x: 720, y: 340, rotation: 0, terminalType: "test_point" },
  ];

  const wires: WireInstance[] = [
    createWire("W1", "VCC", 0, "RA", 0, [{ x: 160, y: 220 }, { x: 300, y: 220 }, { x: 300, y: 180 }]),
    createWire("W2", "VCC", 1, "GND_VCC", 0, [{ x: 160, y: 260 }, { x: 160, y: 280 }]),
    createWire("W3", "RA", 1, "RB", 0, [{ x: 300, y: 260 }, { x: 300, y: 300 }]),
    createWire("W4", "RB", 1, "C1", 0, [{ x: 300, y: 380 }, { x: 300, y: 420 }]),
    createWire("W5", "C1", 1, "GND_C", 0, [{ x: 300, y: 500 }, { x: 300, y: 520 }]),
    createWire("W6", "V_OUT", 0, "R_LOAD", 0, [{ x: 500, y: 340 }, { x: 620, y: 340 }]),
    createWire("W7", "V_OUT", 1, "GND_OUT", 0, [{ x: 500, y: 380 }, { x: 500, y: 420 }]),
    createWire("W8", "R_LOAD", 1, "GND_LOAD", 0, [{ x: 620, y: 420 }, { x: 620, y: 440 }]),
    createWire("W9", "V_OUT", 0, "NET_PULSE", 0, [{ x: 500, y: 340 }, { x: 720, y: 340 }]),
  ];

  return {
    title: `Equivalente conductual 555 astable (${Math.round(synth.actualFreqHz)} Hz, ${Math.round(synth.actualDutyPercent)}% D)`,
    description: `Fuente PULSE simulable con la frecuencia calculada y red RA/RB/C de referencia. No representa el circuito interno ni un macromodelo transistor-level del NE555.`,
    circuit: createDefaultCircuitFile(components, wires),
  };
}

export function generateRfAttenuatorSchematic(
  attenuationDb = 10,
  z0 = 50,
  type: "T" | "PI" = "PI",
): SynthesizedCircuitPackage {
  const synth = synthesizeRfAttenuator(attenuationDb, z0, type);

  const networkComponents: ComponentInstance[] = type === "T"
    ? [
      { id: "R1", type: "resistor", value: synth.r1_series_std, x: 300, y: 300, rotation: 0 },
      { id: "R2", type: "resistor", value: synth.r2_shunt_std, x: 400, y: 380, rotation: 90 },
      { id: "R3", type: "resistor", value: synth.r1_series_std, x: 500, y: 300, rotation: 0 },
      { id: "RL", type: "resistor", value: z0, x: 620, y: 380, rotation: 90 },
      { id: "GND_ATT1", type: "ground", value: 0, x: 400, y: 460, rotation: 0 },
      { id: "GND_L", type: "ground", value: 0, x: 620, y: 460, rotation: 0 },
    ]
    : [
      { id: "R1", type: "resistor", value: synth.r1_series_std, x: 280, y: 380, rotation: 90 },
      { id: "R2", type: "resistor", value: synth.r2_shunt_std, x: 420, y: 300, rotation: 0 },
      { id: "R3", type: "resistor", value: synth.r1_series_std, x: 540, y: 380, rotation: 90 },
      { id: "RL", type: "resistor", value: z0, x: 660, y: 380, rotation: 90 },
      { id: "GND_ATT1", type: "ground", value: 0, x: 280, y: 460, rotation: 0 },
      { id: "GND_ATT2", type: "ground", value: 0, x: 540, y: 460, rotation: 0 },
      { id: "GND_L", type: "ground", value: 0, x: 660, y: 460, rotation: 0 },
    ];

  const components: ComponentInstance[] = [
    { id: "V_RF", type: "vsource", value: 1.0, amplitude: 1.0, frequency: 10e6, x: 160, y: 300, rotation: 0, waveType: "sine", sourceResistance: z0 },
    { id: "GND_RF", type: "ground", value: 0, x: 160, y: 400, rotation: 0 },
    { id: "NET_VIN", type: "net_label", value: "NET_VIN", x: 220, y: 300, rotation: 0, terminalType: "test_point" },
    ...networkComponents,
    { id: "NET_VOUT", type: "net_label", value: "NET_VOUT", x: 740, y: 300, rotation: 0, terminalType: "test_point" },
  ];

  const wires: WireInstance[] = type === "T" ? [
    createWire("W1", "V_RF", 0, "R1", 0, [{ x: 160, y: 300 }, { x: 260, y: 300 }]),
    createWire("W2", "V_RF", 1, "GND_RF", 0, [{ x: 160, y: 340 }, { x: 160, y: 380 }]),
    createWire("W3", "R1", 1, "R2", 0, [{ x: 340, y: 300 }, { x: 400, y: 340 }]),
    createWire("W4", "R1", 1, "R3", 0, [{ x: 340, y: 300 }, { x: 460, y: 300 }]),
    createWire("W5", "R2", 1, "GND_ATT1", 0, [{ x: 400, y: 420 }, { x: 400, y: 440 }]),
    createWire("W6", "R3", 1, "RL", 0, [{ x: 540, y: 300 }, { x: 620, y: 340 }]),
    createWire("W7", "RL", 1, "GND_L", 0, [{ x: 620, y: 420 }, { x: 620, y: 440 }]),
    createWire("W8", "V_RF", 0, "NET_VIN", 0, [{ x: 160, y: 300 }, { x: 220, y: 300 }]),
    createWire("W9", "R3", 1, "NET_VOUT", 0, [{ x: 540, y: 300 }, { x: 740, y: 300 }]),
  ] : [
    createWire("W1", "V_RF", 0, "R1", 0, [{ x: 160, y: 300 }, { x: 280, y: 340 }]),
    createWire("W2", "V_RF", 1, "GND_RF", 0, [{ x: 160, y: 340 }, { x: 160, y: 380 }]),
    createWire("W3", "V_RF", 0, "R2", 0, [{ x: 160, y: 300 }, { x: 380, y: 300 }]),
    createWire("W4", "R1", 1, "GND_ATT1", 0, [{ x: 280, y: 420 }, { x: 280, y: 440 }]),
    createWire("W5", "R2", 1, "R3", 0, [{ x: 460, y: 300 }, { x: 540, y: 340 }]),
    createWire("W6", "R2", 1, "RL", 0, [{ x: 460, y: 300 }, { x: 660, y: 340 }]),
    createWire("W7", "R3", 1, "GND_ATT2", 0, [{ x: 540, y: 420 }, { x: 540, y: 440 }]),
    createWire("W8", "RL", 1, "GND_L", 0, [{ x: 660, y: 420 }, { x: 660, y: 440 }]),
    createWire("W9", "V_RF", 0, "NET_VIN", 0, [{ x: 160, y: 300 }, { x: 220, y: 300 }]),
    createWire("W10", "R2", 1, "NET_VOUT", 0, [{ x: 460, y: 300 }, { x: 740, y: 300 }]),
  ];

  return {
    title: `Atenuador RF Red ${type} (-${attenuationDb} dB @ ${z0} Ω)`,
    description: `Atenuador pasivo simétrico adaptado con resistencias normalizadas E96 (R1=${synth.r1_series_std} Ω, R2=${synth.r2_shunt_std} Ω).`,
    circuit: createDefaultCircuitFile(components, wires),
  };
}

export function generateMcuBlinkSchematic(
  mcuType: "mcu_8051" | "mcu_avr" | "esp32" = "mcu_8051",
): SynthesizedCircuitPackage {
  const pinout = mcuType === "mcu_8051"
    ? { vcc: 39, gnd: 19, output: 20, volts: 5, outputY: 480, vccY: 100, gndY: 480, label: "P2.0" }
    : mcuType === "mcu_avr"
      ? { vcc: 6, gnd: 7, output: 18, volts: 5, outputY: 340, vccY: 280, gndY: 300, label: "PB5/SCK" }
      : { vcc: 0, gnd: 13, output: 29, volts: 3.3, outputY: 440, vccY: 160, gndY: 420, label: "GPIO2" };
  const esp32Blink = mcuType === "esp32"
    ? `int ledPin = 2;
void setup() { pinMode(ledPin, OUTPUT); }
void loop() {
  digitalWrite(ledPin, HIGH);
  delay(500);
  digitalWrite(ledPin, LOW);
  delay(500);
}`
    : undefined;

  const components: ComponentInstance[] = [
    {
      id: "MCU1",
      type: mcuType,
      value: mcuType.toUpperCase(),
      x: 360,
      y: 300,
      rotation: 0,
      ...(esp32Blink ? { esp32SourceCode: esp32Blink } : {}),
    },
    { id: "VCC", type: "vsource", value: pinout.volts, amplitude: pinout.volts, x: 160, y: pinout.vccY, rotation: 0 },
    { id: "GND_VCC", type: "ground", value: 0, x: 160, y: pinout.vccY + 100, rotation: 0 },
    { id: "GND_MCU", type: "ground", value: 0, x: 280, y: pinout.gndY + 80, rotation: 0 },
    { id: "R_LED", type: "resistor", value: 330, x: 520, y: pinout.outputY, rotation: 0 },
    { id: "LED1", type: "led", value: "LED", ledColor: "green", x: 620, y: pinout.outputY, rotation: 0 },
    { id: "GND_LED", type: "ground", value: 0, x: 700, y: pinout.outputY + 80, rotation: 0 },
    { id: "NET_PULSE", type: "net_label", value: "NET_PULSE", x: 560, y: pinout.outputY - 60, rotation: 0, terminalType: "test_point" },
    ...(mcuType === "esp32" ? [] : [{
      id: "NOTE_FIRMWARE",
      type: "text_note" as const,
      value: `Plantilla cableada: cargue firmware para conmutar ${pinout.label}.`,
      x: 530,
      y: 180,
      rotation: 0,
      noteTheme: "warning" as const,
    }]),
  ];

  const wires: WireInstance[] = [
    createWire("W1", "VCC", 1, "GND_VCC", 0, [{ x: 160, y: 260 }, { x: 160, y: 280 }]),
    createWire("W2", "VCC", 0, "MCU1", pinout.vcc, [{ x: 160, y: pinout.vccY }, { x: 300, y: pinout.vccY }]),
    createWire("W3", "MCU1", pinout.gnd, "GND_MCU", 0, [{ x: 300, y: pinout.gndY }, { x: 280, y: pinout.gndY + 60 }]),
    createWire("W4", "MCU1", pinout.output, "R_LED", 0, [{ x: 420, y: pinout.outputY }, { x: 480, y: pinout.outputY }]),
    createWire("W5", "R_LED", 1, "LED1", 0, [{ x: 560, y: pinout.outputY }, { x: 580, y: pinout.outputY }]),
    createWire("W6", "LED1", 1, "GND_LED", 0, [{ x: 660, y: pinout.outputY }, { x: 700, y: pinout.outputY + 60 }]),
    createWire("W7", "MCU1", pinout.output, "NET_PULSE", 0, [{ x: 420, y: pinout.outputY }, { x: 560, y: pinout.outputY - 60 }]),
  ];

  return {
    title: `${mcuType === "esp32" ? "Demo" : "Plantilla"} ${mcuType.toUpperCase()} Blink LED`,
    description: mcuType === "esp32"
      ? `ESP32 alimentado a 3.3 V con sketch restringido Blink precargado, salida ${pinout.label}, resistencia y LED conectados.`
      : `${mcuType.toUpperCase()} con alimentación, tierra y salida ${pinout.label} cableadas. Requiere cargar firmware compatible antes de simular el parpadeo.`,
    circuit: createDefaultCircuitFile(components, wires),
  };
}
