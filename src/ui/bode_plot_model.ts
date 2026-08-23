/**
 * BodePlotModel — Motor Matemático de Respuesta en Frecuencia y Diagrama de Bode
 *
 * Procesa barridos AC (magnitud y fase), realiza desenredo de fase (phase unwrapping)
 * y extrae analíticamente frecuencia de corte a -3 dB, ancho de banda, frecuencia de cruce de ganancia (0 dB),
 * margen de fase (PM) y margen de ganancia (GM).
 */

export interface BodePoint {
  readonly freq: number;       // Frecuencia en Hz
  readonly magDb: number;      // Magnitud en dB: 20 * log10(|Vout|) o 20 * log10(|Vout/Vin|)
  readonly phaseDeg: number;   // Fase en grados (-180 a +180 o desenredada)
  readonly magLinear: number;  // Magnitud lineal en V o V/V
}

export type StabilityQuality = "stable" | "marginal" | "unstable";

export interface NyquistPoint {
  readonly freq: number;
  readonly real: number; // Re(G(jω))
  readonly imag: number; // Im(G(jω))
  readonly magLinear: number;
  readonly phaseDeg: number;
}

export interface BodeAnalysisMetrics {
  readonly dcGainDb: number;            // Ganancia en baja frecuencia (DC) en dB
  readonly maxGainDb: number;           // Pico máximo de ganancia en dB
  readonly cutoffFreq3dB: number | null;// Frecuencia a -3 dB respecto a la ganancia nominal (Hz)
  readonly bandwidthHz: number | null;  // Ancho de banda (Hz)
  readonly gainCrossoverFreq: number | null; // Frecuencia donde la ganancia cruza 0 dB (Hz)
  readonly phaseMarginDeg: number | null;    // Margen de fase: 180 + fase(f_0dB) en grados
  readonly phaseCrossoverFreq: number | null;// Frecuencia donde la fase cruza -180° (Hz)
  readonly gainMarginDb: number | null;      // Margen de ganancia: -magDb(f_-180°) en dB
  readonly isStable: boolean;                // Estabilidad con realimentación unitaria (PM > 0)
  readonly stabilityQuality: StabilityQuality; // Calidad del diseño (estable >=45°, marginal, inestable)
}

export interface BodeDataSet {
  readonly points: readonly BodePoint[];
  readonly nyquistPoints: readonly NyquistPoint[];
  readonly metrics: BodeAnalysisMetrics;
}

/**
 * Desenredo de fase para evitar discontinuidades de +-360° en curvas continuas.
 */
export function unwrapPhase(phasesDeg: readonly number[]): number[] {
  if (phasesDeg.length === 0) return [];
  const result = [phasesDeg[0]];
  for (let i = 1; i < phasesDeg.length; i++) {
    let diff = phasesDeg[i] - phasesDeg[i - 1];
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;
    result.push(result[i - 1] + diff);
  }
  return result;
}

/**
 * Procesa un barrido AC de frecuencias, magnitudes y fases en un conjunto Bode analizado.
 */
export function processAcSweepData(
  frequencies: readonly number[],
  amplitudes: readonly number[],
  phasesDeg: readonly number[],
  refAmplitude = 1.0,
): BodeDataSet {
  if (frequencies.length === 0 || amplitudes.length === 0) {
    return {
      points: [],
      nyquistPoints: [],
      metrics: {
        dcGainDb: 0,
        maxGainDb: 0,
        cutoffFreq3dB: null,
        bandwidthHz: null,
        gainCrossoverFreq: null,
        phaseMarginDeg: null,
        phaseCrossoverFreq: null,
        gainMarginDb: null,
        isStable: true,
        stabilityQuality: "stable",
      },
    };
  }

  const unwrappedPhases = unwrapPhase(phasesDeg);
  const points: BodePoint[] = [];

  for (let i = 0; i < frequencies.length; i++) {
    const freq = frequencies[i];
    const rawAmp = amplitudes[i] ?? 0;
    const magLinear = Math.max(1e-15, rawAmp / Math.max(1e-15, refAmplitude));
    const magDb = 20 * Math.log10(magLinear);
    const phaseDeg = unwrappedPhases[i] ?? (phasesDeg[i] ?? 0);

    points.push({
      freq,
      magDb,
      phaseDeg,
      magLinear: rawAmp,
    });
  }

  // Extracción de Métricas
  const dcGainDb = points[0].magDb;
  let maxGainDb = -Infinity;
  for (const pt of points) {
    if (pt.magDb > maxGainDb) maxGainDb = pt.magDb;
  }

  // Frecuencia de corte a -3 dB respecto a la ganancia de baja frecuencia
  const target3dB = dcGainDb - 3.0103;
  let cutoffFreq3dB: number | null = null;
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    if ((p1.magDb >= target3dB && p2.magDb <= target3dB) || (p1.magDb <= target3dB && p2.magDb >= target3dB)) {
      // Interpolación logarítmica en frecuencia
      const t = (target3dB - p1.magDb) / (p2.magDb - p1.magDb);
      const logF1 = Math.log10(p1.freq);
      const logF2 = Math.log10(p2.freq);
      cutoffFreq3dB = Math.pow(10, logF1 + t * (logF2 - logF1));
      break;
    }
  }

  // Frecuencia de cruce de ganancia (0 dB) y Margen de Fase
  let gainCrossoverFreq: number | null = null;
  let phaseMarginDeg: number | null = null;
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    if ((p1.magDb >= 0 && p2.magDb <= 0) || (p1.magDb <= 0 && p2.magDb >= 0)) {
      const t = (0 - p1.magDb) / (p2.magDb - p1.magDb);
      const logF1 = Math.log10(p1.freq);
      const logF2 = Math.log10(p2.freq);
      gainCrossoverFreq = Math.pow(10, logF1 + t * (logF2 - logF1));
      const interpolatedPhase = p1.phaseDeg + t * (p2.phaseDeg - p1.phaseDeg);
      phaseMarginDeg = 180 + interpolatedPhase;
      break;
    }
  }

  // Frecuencia de cruce de fase (-180°) y Margen de Ganancia
  let phaseCrossoverFreq: number | null = null;
  let gainMarginDb: number | null = null;
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    if ((p1.phaseDeg >= -180 && p2.phaseDeg <= -180) || (p1.phaseDeg <= -180 && p2.phaseDeg >= -180)) {
      const t = (-180 - p1.phaseDeg) / (p2.phaseDeg - p1.phaseDeg);
      const logF1 = Math.log10(p1.freq);
      const logF2 = Math.log10(p2.freq);
      phaseCrossoverFreq = Math.pow(10, logF1 + t * (logF2 - logF1));
      const interpolatedMag = p1.magDb + t * (p2.magDb - p1.magDb);
      gainMarginDb = -interpolatedMag;
      break;
    }
  }

  const nyquistPoints: NyquistPoint[] = [];
  for (const pt of points) {
    const phaseRad = (pt.phaseDeg * Math.PI) / 180;
    const real = pt.magLinear * Math.cos(phaseRad);
    const imag = pt.magLinear * Math.sin(phaseRad);
    nyquistPoints.push({
      freq: pt.freq,
      real,
      imag,
      magLinear: pt.magLinear,
      phaseDeg: pt.phaseDeg,
    });
  }

  const isStable = phaseMarginDeg === null || phaseMarginDeg > 0;
  let stabilityQuality: StabilityQuality = "stable";
  if (phaseMarginDeg !== null) {
    if (phaseMarginDeg <= 0 || (gainMarginDb !== null && gainMarginDb <= 0)) {
      stabilityQuality = "unstable";
    } else if (phaseMarginDeg < 45 || (gainMarginDb !== null && gainMarginDb < 6)) {
      stabilityQuality = "marginal";
    } else {
      stabilityQuality = "stable";
    }
  }

  return {
    points,
    nyquistPoints,
    metrics: {
      dcGainDb,
      maxGainDb,
      cutoffFreq3dB,
      bandwidthHz: cutoffFreq3dB,
      gainCrossoverFreq,
      phaseMarginDeg,
      phaseCrossoverFreq,
      gainMarginDb,
      isStable,
      stabilityQuality,
    },
  };
}

/**
 * Genera datos teóricos de un filtro RC Paso Bajo para pruebas o presets de laboratorio:
 * H(s) = 1 / (1 + s R C), fc = 1 / (2 * pi * R * C)
 */
export function generateRcLowPassBode(
  rOhms: number,
  cFarads: number,
  fStart = 1,
  fEnd = 1e6,
  pointsPerDecade = 20,
): BodeDataSet {
  const fc = 1 / (2 * Math.PI * rOhms * cFarads);
  const decades = Math.log10(fEnd / fStart);
  const totalPoints = Math.max(10, Math.round(decades * pointsPerDecade));
  const frequencies: number[] = [];
  const amplitudes: number[] = [];
  const phasesDeg: number[] = [];

  for (let i = 0; i <= totalPoints; i++) {
    const logF = Math.log10(fStart) + (i / totalPoints) * decades;
    const f = Math.pow(10, logF);
    const wRatio = f / fc;
    const mag = 1 / Math.sqrt(1 + wRatio * wRatio);
    const phase = -Math.atan(wRatio) * (180 / Math.PI);

    frequencies.push(f);
    amplitudes.push(mag);
    phasesDeg.push(phase);
  }

  return processAcSweepData(frequencies, amplitudes, phasesDeg, 1.0);
}
