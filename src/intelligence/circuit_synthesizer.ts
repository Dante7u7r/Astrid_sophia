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
  } else {
    // Paso Banda
    c2 = c1;
    r1 = q / (omegaC * c1);
    r2 = 1 / (q * omegaC * c1);
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

  return {
    vinMin,
    vinMax,
    vZener,
    maxLoadCurrentAmps: ilMax,
    rs_theoretical: rs,
    rs_standard: rs_std,
    rs_powerWatts: rsPower,
    zener_maxPowerWatts: zenerPower,
    isSafe: rs_std > 0 && vinMin > vZener,
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
