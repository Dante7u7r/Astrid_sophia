import type { TimeStepResult } from "../ui/oscilloscope_panel";
import { formatSpiceValue } from "./spice_value_parser";

export interface EyeTracePoint {
  tRel: number;   // Tiempo relativo respecto al inicio de la ventana [0..2 UI]
  voltage: number;
}

export interface EyeTraceSlice {
  sliceIndex: number;
  points: EyeTracePoint[];
}

export interface JitterAnalysisResult {
  tieSamples: number[];
  tieRms: number;             // Time Interval Error RMS (s)
  tiePkPk: number;            // TIE Peak-to-Peak (s)
  periodJitterSamples: number[];
  periodJitterRms: number;    // Period Jitter RMS (s)
  periodJitterPkPk: number;   // Period Jitter Peak-to-Peak (s)
  cycleToCycleJitterRms: number; // Cycle-to-Cycle Jitter RMS (s)
  cycleToCycleJitterMax: number; // Cycle-to-Cycle Jitter Max (s)
  randomJitterRms: number;    // RJ (Gaussian sigma) (s)
  deterministicJitter: number;// DJ (Peak-to-Peak) (s)
  totalJitter: number;        // TJ = DJ + 14.069 * RJ (at BER = 10^-12) (s)
}

export interface EyeMaskDefinition {
  name: string;
  // Polígono normalizado de la máscara central: arreglo de [tNorm (0..2 UI), vNorm (0..1 donde 0=Vmin, 1=Vmax)]
  centralPolygon: Array<[number, number]>;
}

export interface EyeDiagramOptions {
  thresholdVoltage?: number; // Voltaje de cruce para recuperación de reloj (default: 50% rango)
  forcedUnitInterval?: number; // UI forzado en segundos (si no se especifica, se detecta automáticamente)
  uiSpan?: number;            // Cantidad de UIs a mostrar (default: 2)
  mask?: EyeMaskDefinition;
}

export interface EyeDiagramResult {
  node: string;
  unitInterval: number;       // Período de bit UI (s)
  baudRate: number;           // Velocidad en Baudios / bps (Hz)
  vMin: number;               // Voltaje mínimo de señal
  vMax: number;               // Voltaje máximo de señal
  eyeHeight: number;          // Altura de apertura de ojo (V) en t = 0.5 UI o 1.0 UI
  eyeWidth: number;           // Ancho de apertura de ojo (s)
  eyeWidthUi: number;         // Ancho de apertura en fracción de UI (0..1)
  eyeAmplitude: number;       // Amplitud media (Mean High - Mean Low)
  qualityFactorQ: number;     // Factor de calidad SNR del ojo (Q-factor)
  extinctionRatioDb: number;  // Relación de extinción en dB
  slices: EyeTraceSlice[];
  jitter: JitterAnalysisResult;
  maskViolationsCount: number;
}

/**
 * Máscara hexagonal estándar para pruebas de cumplimiento de eye diagram.
 */
export const STANDARD_HEX_EYE_MASK: EyeMaskDefinition = {
  name: "Estándar Hexagonal Telecom",
  centralPolygon: [
    [0.75, 0.5],
    [0.85, 0.7],
    [1.15, 0.7],
    [1.25, 0.5],
    [1.15, 0.3],
    [0.85, 0.3],
  ],
};

/**
 * Calcula el Eye Diagram completo y análisis de Jitter (TIE, Period, Cycle-to-Cycle).
 */
export function calculateEyeDiagram(
  transientResults: readonly TimeStepResult[],
  node: string,
  options: EyeDiagramOptions = {},
): EyeDiagramResult | null {
  const n = transientResults.length;
  if (n < 32 || !node) return null;

  // 1. Extraer rango dinámico
  let vMin = Infinity;
  let vMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = transientResults[i].nodeVoltages[node] ?? 0;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  const vRange = vMax - vMin;
  if (vRange < 1e-4) return null;

  const threshold = options.thresholdVoltage ?? (vMin + 0.5 * vRange);

  // 2. Detectar todos los cruces de umbral (transiciones de subida y bajada)
  const crossings: number[] = [];
  for (let i = 1; i < n; i++) {
    const v0 = transientResults[i - 1].nodeVoltages[node] ?? 0;
    const v1 = transientResults[i].nodeVoltages[node] ?? 0;
    const t0 = transientResults[i - 1].time;
    const t1 = transientResults[i].time;

    if ((v0 <= threshold && v1 > threshold) || (v0 >= threshold && v1 < threshold)) {
      const frac = Math.abs(v1 - v0) > 1e-15 ? (threshold - v0) / (v1 - v0) : 0;
      crossings.push(t0 + frac * (t1 - t0));
    }
  }

  if (crossings.length < 4) return null;

  // 3. Estimar Unit Interval (UI) / Clock Recovery
  let unitInterval = options.forcedUnitInterval ?? 0;
  if (unitInterval <= 0) {
    // Calcular diferencias entre cruces consecutivos
    const intervals: number[] = [];
    for (let i = 1; i < crossings.length; i++) {
      const dt = crossings[i] - crossings[i - 1];
      if (dt > 1e-15) intervals.push(dt);
    }
    if (intervals.length === 0) return null;

    // Encontrar el mínimo intervalo común (Unit Interval)
    intervals.sort((a, b) => a - b);
    const minInterval = intervals[0];
    const candidateUIs = intervals.filter((dt) => dt <= 1.8 * minInterval);
    const sumUi = candidateUIs.reduce((sum, val) => sum + val, 0);
    unitInterval = sumUi / candidateUIs.length;
  }

  if (unitInterval <= 0 || !Number.isFinite(unitInterval)) return null;

  const baudRate = 1 / unitInterval;
  const uiSpan = options.uiSpan ?? 2; // Ventana de 2 UI
  const windowDuration = uiSpan * unitInterval;

  // 4. Plegado de trazas en rodajas (Eye Slicing / Folding con alineación de fase)
  const slices: EyeTraceSlice[] = [];
  const tRef = crossings[0];
  const tStart = transientResults[0].time;
  const tEnd = transientResults[n - 1].time;

  // Encontrar el primer múltiplo de UI antes de tStart relativo a tRef
  const firstWindowIndex = Math.floor((tStart - tRef) / unitInterval);
  const lastWindowIndex = Math.floor((tEnd - tRef) / unitInterval) - (uiSpan - 1);

  for (let w = firstWindowIndex; w <= lastWindowIndex; w++) {
    const sliceStart = tRef + w * unitInterval;
    const sliceEnd = sliceStart + windowDuration;
    const points: EyeTracePoint[] = [];

    for (let i = 0; i < n; i++) {
      const t = transientResults[i].time;
      if (t >= sliceStart && t <= sliceEnd) {
        const tRel = t - sliceStart;
        const v = transientResults[i].nodeVoltages[node] ?? 0;
        points.push({ tRel, voltage: v });
      }
    }

    if (points.length >= 2) {
      slices.push({ sliceIndex: w, points });
    }
  }

  // 5. Análisis de Jitter (TIE, Period, Cycle-to-Cycle, RJ, DJ, TJ)
  const jitter = calculateJitterAnalysisFromCrossings(crossings, unitInterval);

  // 6. Apertura de Ojo (Eye Height & Width) en el centro de los símbolos (t = 0.5 UI o 1.5 UI)
  const centerPositions = [0.5 * unitInterval, 1.5 * unitInterval];
  const centerTol = 0.08 * unitInterval;

  const highSamples: number[] = [];
  const lowSamples: number[] = [];

  for (const slice of slices) {
    for (const pt of slice.points) {
      const isNearCenter = centerPositions.some((cp) => Math.abs(pt.tRel - cp) <= centerTol);
      if (isNearCenter) {
        if (pt.voltage >= threshold) {
          highSamples.push(pt.voltage);
        } else {
          lowSamples.push(pt.voltage);
        }
      }
    }
  }

  let eyeHeight = 0;
  let eyeAmplitude = vRange;
  let qualityFactorQ = 0;
  let extinctionRatioDb = 0;

  if (highSamples.length > 0 && lowSamples.length > 0) {
    const meanHigh = highSamples.reduce((a, b) => a + b, 0) / highSamples.length;
    const meanLow = lowSamples.reduce((a, b) => a + b, 0) / lowSamples.length;
    const minHigh = Math.min(...highSamples);
    const maxLow = Math.max(...lowSamples);

    eyeHeight = Math.max(0, minHigh - maxLow);
    eyeAmplitude = Math.max(0, meanHigh - meanLow);

    const varHigh = highSamples.reduce((acc, v) => acc + Math.pow(v - meanHigh, 2), 0) / highSamples.length;
    const varLow = lowSamples.reduce((acc, v) => acc + Math.pow(v - meanLow, 2), 0) / lowSamples.length;
    const sigmaHigh = Math.sqrt(varHigh);
    const sigmaLow = Math.sqrt(varLow);

    const denom = sigmaHigh + sigmaLow;
    qualityFactorQ = denom > 1e-9 ? eyeAmplitude / denom : 10.0;

    if (meanLow > 1e-6 && meanHigh > meanLow) {
      extinctionRatioDb = 10 * Math.log10(meanHigh / meanLow);
    }
  }

  // Ancho de ojo = UI - Total Jitter
  const eyeWidth = Math.max(0, unitInterval - jitter.totalJitter);
  const eyeWidthUi = Math.max(0, Math.min(1.0, eyeWidth / unitInterval));

  // 7. Prueba de máscara (Eye Mask Testing)
  let maskViolationsCount = 0;
  if (options.mask) {
    const poly = options.mask.centralPolygon;
    for (const slice of slices) {
      for (const pt of slice.points) {
        const tNorm = pt.tRel / unitInterval;
        const vNorm = (pt.voltage - vMin) / vRange;
        if (isPointInsidePolygon(tNorm, vNorm, poly)) {
          maskViolationsCount++;
        }
      }
    }
  }

  return {
    node,
    unitInterval,
    baudRate,
    vMin,
    vMax,
    eyeHeight,
    eyeWidth,
    eyeWidthUi,
    eyeAmplitude,
    qualityFactorQ,
    extinctionRatioDb,
    slices,
    jitter,
    maskViolationsCount,
  };
}

/**
 * Calcula el análisis de Jitter detallado a partir de cruces de umbral temporales.
 */
function calculateJitterAnalysisFromCrossings(
  crossings: readonly number[],
  unitInterval: number,
): JitterAnalysisResult {
  const tieSamples: number[] = [];
  const periodJitterSamples: number[] = [];
  const cycleToCycleSamples: number[] = [];

  const t0 = crossings[0];

  // 1. Time Interval Error (TIE)
  for (let k = 0; k < crossings.length; k++) {
    const actualTime = crossings[k];
    const bitIndex = Math.round((actualTime - t0) / unitInterval);
    const idealTime = t0 + bitIndex * unitInterval;
    const tie = actualTime - idealTime;
    tieSamples.push(tie);
  }

  // TIE RMS y Pk-Pk
  let sumTieSq = 0;
  let minTie = Infinity;
  let maxTie = -Infinity;
  for (const tie of tieSamples) {
    sumTieSq += tie * tie;
    if (tie < minTie) minTie = tie;
    if (tie > maxTie) maxTie = tie;
  }
  const tieRms = tieSamples.length > 0 ? Math.sqrt(sumTieSq / tieSamples.length) : 0;
  const tiePkPk = tieSamples.length > 0 ? maxTie - minTie : 0;

  // 2. Period Jitter
  let sumPeriodSq = 0;
  let minPeriodJ = Infinity;
  let maxPeriodJ = -Infinity;

  for (let k = 1; k < crossings.length; k++) {
    const period = crossings[k] - crossings[k - 1];
    const bitSpan = Math.max(1, Math.round(period / unitInterval));
    const periodPerBit = period / bitSpan;
    const pj = periodPerBit - unitInterval;
    periodJitterSamples.push(pj);

    sumPeriodSq += pj * pj;
    if (pj < minPeriodJ) minPeriodJ = pj;
    if (pj > maxPeriodJ) maxPeriodJ = pj;
  }
  const periodJitterRms = periodJitterSamples.length > 0 ? Math.sqrt(sumPeriodSq / periodJitterSamples.length) : 0;
  const periodJitterPkPk = periodJitterSamples.length > 0 ? maxPeriodJ - minPeriodJ : 0;

  // 3. Cycle-to-Cycle Jitter
  let sumCcSq = 0;
  let maxCc = 0;
  for (let k = 1; k < periodJitterSamples.length; k++) {
    const cc = Math.abs(periodJitterSamples[k] - periodJitterSamples[k - 1]);
    cycleToCycleSamples.push(cc);
    sumCcSq += cc * cc;
    if (cc > maxCc) maxCc = cc;
  }
  const cycleToCycleJitterRms = cycleToCycleSamples.length > 0 ? Math.sqrt(sumCcSq / cycleToCycleSamples.length) : 0;
  const cycleToCycleJitterMax = maxCc;

  // 4. Descomposición RJ / DJ / TJ (Dual-Dirac Tail-fitting simplificado)
  // RJ RMS = TIE RMS * factor de aleatoriedad
  const randomJitterRms = tieRms * 0.707;
  const deterministicJitter = Math.max(0, tiePkPk - 2.5 * randomJitterRms);
  // TJ a BER = 10^-12 (Q = 7.034 => 14.069 sigma)
  const totalJitter = deterministicJitter + 14.069 * randomJitterRms;

  return {
    tieSamples,
    tieRms,
    tiePkPk,
    periodJitterSamples,
    periodJitterRms,
    periodJitterPkPk,
    cycleToCycleJitterRms,
    cycleToCycleJitterMax,
    randomJitterRms,
    deterministicJitter,
    totalJitter,
  };
}

/**
 * Prueba de pertenencia de punto en polígono (Ray Casting algorithm).
 */
function isPointInsidePolygon(x: number, y: number, polygon: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Exporta el reporte de diagrama de ojo y jitter a formato CSV.
 */
export function exportEyeDiagramReportToCsv(
  result: EyeDiagramResult,
  metadata: { circuitName?: string } = {},
): string {
  const rows: string[] = [
    `# Reporte de Diagrama de Ojo y Análisis de Jitter - Biaani`,
    `# Circuito: ${metadata.circuitName || "Circuito Mixto/Digital"}`,
    `# Nodo Analizado: V(${result.node})`,
    `# Velocidad (Baud Rate): ${formatSpiceValue(result.baudRate)}bps (${(result.unitInterval * 1e9).toFixed(3)} ns/UI)`,
    `#`,
    `Parámetro,Valor,Unidad,ValorFormateado,Descripción`,
    `eye_height,${result.eyeHeight},V,"${formatSpiceValue(result.eyeHeight)}V","Apertura vertical del ojo"`,
    `eye_width,${result.eyeWidth},s,"${formatSpiceValue(result.eyeWidth)}s","Apertura horizontal del ojo"`,
    `eye_width_ui,${result.eyeWidthUi},UI,"${(result.eyeWidthUi * 100).toFixed(1)}%","Apertura horizontal en fracción de UI"`,
    `eye_amplitude,${result.eyeAmplitude},V,"${formatSpiceValue(result.eyeAmplitude)}V","Amplitud media del ojo"`,
    `q_factor,${result.qualityFactorQ},,"${result.qualityFactorQ.toFixed(2)}","Factor de calidad SNR del ojo (Q)"`,
    `extinction_ratio,${result.extinctionRatioDb},dB,"${result.extinctionRatioDb.toFixed(2)} dB","Relación de extinción"`,
    `tie_rms,${result.jitter.tieRms},s,"${formatSpiceValue(result.jitter.tieRms)}s","TIE (Time Interval Error) RMS"`,
    `tie_pkpk,${result.jitter.tiePkPk},s,"${formatSpiceValue(result.jitter.tiePkPk)}s","TIE Peak-to-Peak (Total Jitter medido)"`,
    `period_jitter_rms,${result.jitter.periodJitterRms},s,"${formatSpiceValue(result.jitter.periodJitterRms)}s","Jitter de Período RMS"`,
    `cycle_to_cycle_rms,${result.jitter.cycleToCycleJitterRms},s,"${formatSpiceValue(result.jitter.cycleToCycleJitterRms)}s","Jitter Ciclo a Ciclo RMS"`,
    `random_jitter_rj,${result.jitter.randomJitterRms},s,"${formatSpiceValue(result.jitter.randomJitterRms)}s","Jitter Aleatorio (RJ Gaussian Sigma)"`,
    `deterministic_jitter_dj,${result.jitter.deterministicJitter},s,"${formatSpiceValue(result.jitter.deterministicJitter)}s","Jitter Determinístico (DJ)"`,
    `total_jitter_tj,${result.jitter.totalJitter},s,"${formatSpiceValue(result.jitter.totalJitter)}s","Jitter Total TJ (BER=10^-12)"`,
    `mask_violations,${result.maskViolationsCount},,"${result.maskViolationsCount}","Violaciones de máscara"`,
  ];

  return rows.join("\r\n");
}
