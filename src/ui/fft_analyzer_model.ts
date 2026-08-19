/**
 * FftAnalyzerModel — Motor Matemático de Transformada Rápida de Fourier y Análisis Espectral
 *
 * Incluye ventanas de ponderación (Hann, Hamming, Blackman-Harris, Flat-Top, Rectangular),
 * algoritmo FFT Radix-2 optimizado con corrección de ganancia coherente, detección parabólica de picos,
 * análisis de distorsión armónica (THD, THD+N, SNR, SFDR, SINAD) y promediado de espectros.
 */

export type FftWindowType = "hann" | "hamming" | "blackman_harris" | "flat_top" | "rectangular";
export type FftScaleMode = "dbv" | "dbm" | "linear_rms" | "linear_vpk";
export type FftAveragingMode = "off" | "max_hold" | "avg_8" | "avg_16" | "avg_32";

export interface FftWindowConfig {
  id: FftWindowType;
  name: string;
  coherentGain: number;      // Ganancia de amplitud para tonos senoidales
  noiseBandwidth: number;    // Ancho de banda equivalente de ruido (ENBW en bins)
}

export const FFT_WINDOWS: readonly FftWindowConfig[] = [
  { id: "hann", name: "Hann (General)", coherentGain: 0.5, noiseBandwidth: 1.5 },
  { id: "hamming", name: "Hamming (Resolución)", coherentGain: 0.54, noiseBandwidth: 1.36 },
  { id: "blackman_harris", name: "Blackman-Harris (Rango Dinámico)", coherentGain: 0.35875, noiseBandwidth: 2.0 },
  { id: "flat_top", name: "Flat-Top (Calibración Amplitud)", coherentGain: 0.21557895, noiseBandwidth: 3.77 },
  { id: "rectangular", name: "Rectangular (Transitorios)", coherentGain: 1.0, noiseBandwidth: 1.0 },
] as const;

export interface SpectralPeak {
  order: number;        // 1 para f0, 2 para 2f0...
  freq: number;         // Hz
  magnitudeVrms: number;// Vrms
  magnitudeDbv: number; // dBV
  bin: number;
}

export interface FftAnalysisResult {
  frequencies: Float64Array; // Eje de frecuencias (0 .. fs/2) en Hz
  magnitudesVrms: Float64Array; // Magnitud en Vrms
  magnitudesDbv: Float64Array;  // Magnitud en dBV (ref 1 Vrms)
  samplingFreq: number;       // Frecuencia de muestreo calculada (Hz)
  numPoints: number;          // N (bins FFT)
  fundamentalFreq: number;    // f0 (Hz) con interpolación parabólica
  fundamentalVrms: number;    // Vrms del pico fundamental
  fundamentalDbv: number;     // dBV del pico fundamental
  harmonics: SpectralPeak[];  // Lista de armónicos f0, 2f0..6f0
  thdPercent: number;         // Total Harmonic Distortion en %
  thdDb: number;              // Total Harmonic Distortion en dB
  thdPlusNoisePercent: number;// THD+N en %
  snrDb: number;              // Signal-to-Noise Ratio en dB
  sfdrDbc: number;            // Spurious-Free Dynamic Range en dBc
  sinadDb: number;            // SINAD en dB
}

/** Aplica la ventana seleccionada sobre el array de muestras reales. */
export function applyWindowFunction(
  data: Float64Array,
  windowType: FftWindowType,
): { windowed: Float64Array; coherentGain: number } {
  const n = data.length;
  const out = new Float64Array(n);
  const cfg = FFT_WINDOWS.find((w) => w.id === windowType) ?? FFT_WINDOWS[0];

  for (let i = 0; i < n; i++) {
    const frac = i / (n - 1);
    let w = 1.0;

    switch (windowType) {
      case "hann":
        w = 0.5 * (1 - Math.cos(2 * Math.PI * frac));
        break;
      case "hamming":
        w = 0.54 - 0.46 * Math.cos(2 * Math.PI * frac);
        break;
      case "blackman_harris":
        w =
          0.35875 -
          0.48829 * Math.cos(2 * Math.PI * frac) +
          0.14128 * Math.cos(4 * Math.PI * frac) -
          0.01168 * Math.cos(6 * Math.PI * frac);
        break;
      case "flat_top":
        w =
          0.21557895 -
          0.41663158 * Math.cos(2 * Math.PI * frac) +
          0.277263158 * Math.cos(4 * Math.PI * frac) -
          0.083578947 * Math.cos(6 * Math.PI * frac) +
          0.006947368 * Math.cos(8 * Math.PI * frac);
        break;
      case "rectangular":
      default:
        w = 1.0;
        break;
    }
    out[i] = data[i] * w;
  }

  return { windowed: out, coherentGain: cfg.coherentGain };
}

/** Ejecuta el algoritmo Cooley-Tukey Radix-2 Decimation-in-Time FFT in-place. */
export function computeRadix2Fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n <= 1) return;

  // 1. Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      const tempRe = re[i];
      re[i] = re[j];
      re[j] = tempRe;
      const tempIm = im[i];
      im[i] = im[j];
      im[j] = tempIm;
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }

  // 2. Butterfly computations
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wlenRe = Math.cos(angle);
    const wlenIm = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      const halfLen = len >> 1;

      for (let k = 0; k < halfLen; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const target = i + k + halfLen;
        const tRe = re[target] * wRe - im[target] * wIm;
        const tIm = re[target] * wIm + im[target] * wRe;

        re[i + k] = uRe + tRe;
        im[i + k] = uIm + tIm;
        re[target] = uRe - tRe;
        im[target] = uIm - tIm;

        const nextWRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nextWRe;
      }
    }
  }
}

/**
 * Calcula el espectro FFT completo con métricas de distorsión y armónicos.
 */
export function computeFftSpectrum(
  samples: readonly { time: number; val: number }[],
  windowType: FftWindowType = "hann",
  maxPoints = 1024,
): FftAnalysisResult | null {
  if (samples.length < 16) return null;

  // 1. Encontrar la mayor potencia de 2 que quepa en los datos (máximo maxPoints)
  let n = 16;
  while (n * 2 <= samples.length && n * 2 <= maxPoints) {
    n *= 2;
  }

  // Extraer las últimas n muestras para capturar el régimen permanente
  const startIdx = samples.length - n;
  const rawVals = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    rawVals[i] = samples[startIdx + i].val;
  }

  // Calcular frecuencia de muestreo promedio
  let totalDt = 0;
  for (let i = 1; i < n; i++) {
    totalDt += samples[startIdx + i].time - samples[startIdx + i - 1].time;
  }
  const dt = Math.max(1e-12, totalDt / (n - 1));
  const samplingFreq = 1 / dt;

  // 2. Aplicar ventana
  const { windowed, coherentGain } = applyWindowFunction(rawVals, windowType);
  const re = new Float64Array(windowed);
  const im = new Float64Array(n);

  // 3. Ejecutar FFT
  computeRadix2Fft(re, im);

  // 4. Calcular magnitudes espectrales normalizadas a Vrms
  const halfN = n / 2;
  const frequencies = new Float64Array(halfN);
  const magnitudesVrms = new Float64Array(halfN);
  const magnitudesDbv = new Float64Array(halfN);
  const freqStep = samplingFreq / n;

  // Escalamiento correcto: FFT de un tono pico A da A*N/2 -> Dividir por N * coherentGain * sqrt(2) para Vrms
  const normFactor = 1 / (n * coherentGain * Math.SQRT2);

  let maxMag = -Infinity;
  let peakIndex = 1;

  for (let i = 0; i < halfN; i++) {
    frequencies[i] = i * freqStep;
    const magPk = Math.sqrt(re[i] * re[i] + im[i] * im[i]) * (i === 0 ? 1 / (n * coherentGain) : 2 * normFactor);
    const magVrms = i === 0 ? magPk : magPk; // En Vrms
    magnitudesVrms[i] = Math.max(1e-12, magVrms);
    magnitudesDbv[i] = 20 * Math.log10(magnitudesVrms[i]);

    if (i > 0 && magnitudesVrms[i] > maxMag) {
      maxMag = magnitudesVrms[i];
      peakIndex = i;
    }
  }

  // 5. Interpolación parabólica sub-bin para el pico fundamental
  let delta = 0;
  if (peakIndex > 1 && peakIndex < halfN - 1) {
    const alpha = Math.log(magnitudesVrms[peakIndex - 1] + 1e-12);
    const beta = Math.log(magnitudesVrms[peakIndex] + 1e-12);
    const gamma = Math.log(magnitudesVrms[peakIndex + 1] + 1e-12);
    const denom = alpha - 2 * beta + gamma;
    if (Math.abs(denom) > 1e-6) {
      delta = 0.5 * ((alpha - gamma) / denom);
    }
  }

  const exactPeakBin = peakIndex + delta;
  const fundamentalFreq = Math.max(0, exactPeakBin * freqStep);
  const fundamentalVrms = magnitudesVrms[peakIndex];
  const fundamentalDbv = magnitudesDbv[peakIndex];

  // 6. Detección de armónicos (2f0 .. 6f0)
  const harmonics: SpectralPeak[] = [];
  let harmonicPowerSum = 0;

  harmonics.push({
    order: 1,
    freq: fundamentalFreq,
    magnitudeVrms: fundamentalVrms,
    magnitudeDbv: fundamentalDbv,
    bin: peakIndex,
  });

  for (let h = 2; h <= 6; h++) {
    const targetBin = Math.round(exactPeakBin * h);
    if (targetBin >= halfN) break;

    let localPeak = targetBin;
    let localMax = -Infinity;
    for (let k = Math.max(1, targetBin - 2); k <= Math.min(halfN - 1, targetBin + 2); k++) {
      if (magnitudesVrms[k] > localMax) {
        localMax = magnitudesVrms[k];
        localPeak = k;
      }
    }

    const hVrms = magnitudesVrms[localPeak];
    const hFreq = localPeak * freqStep;
    const hDbv = magnitudesDbv[localPeak];

    harmonics.push({
      order: h,
      freq: hFreq,
      magnitudeVrms: hVrms,
      magnitudeDbv: hDbv,
      bin: localPeak,
    });

    harmonicPowerSum += hVrms * hVrms;
  }

  // 7. Cálculo de Distorsión y Ratios (THD, SNR, SFDR, SINAD)
  const fundPower = fundamentalVrms * fundamentalVrms;
  const thdPercent = (Math.sqrt(harmonicPowerSum) / Math.max(1e-12, fundamentalVrms)) * 100;
  const thdDb = 20 * Math.log10(Math.max(1e-6, thdPercent / 100));

  // Potencia total del espectro AC (excluyendo DC)
  let totalAcPower = 0;
  for (let i = 1; i < halfN; i++) {
    totalAcPower += magnitudesVrms[i] * magnitudesVrms[i];
  }

  const noiseAndDistortionPower = Math.max(1e-15, totalAcPower - fundPower);
  const noisePower = Math.max(1e-15, noiseAndDistortionPower - harmonicPowerSum);

  const thdPlusNoisePercent = (Math.sqrt(noiseAndDistortionPower) / Math.max(1e-12, fundamentalVrms)) * 100;
  const snrDb = 10 * Math.log10(Math.max(1e-12, fundPower / noisePower));
  const sinadDb = 10 * Math.log10(Math.max(1e-12, totalAcPower / noiseAndDistortionPower));

  // SFDR: Diferencia en dBc entre fundamental y el mayor espurio fuera del pico fundamental
  let maxSpurVrms = 1e-12;
  for (let i = 1; i < halfN; i++) {
    if (Math.abs(i - peakIndex) > 2 && magnitudesVrms[i] > maxSpurVrms) {
      maxSpurVrms = magnitudesVrms[i];
    }
  }
  const sfdrDbc = 20 * Math.log10(Math.max(1e-12, fundamentalVrms / maxSpurVrms));

  return {
    frequencies,
    magnitudesVrms,
    magnitudesDbv,
    samplingFreq,
    numPoints: n,
    fundamentalFreq,
    fundamentalVrms,
    fundamentalDbv,
    harmonics,
    thdPercent,
    thdDb,
    thdPlusNoisePercent,
    snrDb,
    sfdrDbc,
    sinadDb,
  };
}

/** Convierte una magnitud Vrms a la escala seleccionada por el usuario. */
export function convertMagnitude(
  vrms: number,
  scale: FftScaleMode,
): { value: number; unit: string } {
  switch (scale) {
    case "dbv":
      return { value: 20 * Math.log10(Math.max(1e-12, vrms)), unit: "dBV" };
    case "dbm":
      // dBm en 50Ω: P(mW) = (Vrms^2 / 50) * 1000 = Vrms^2 * 20 -> 10 log10(P) = dBV + 13.01
      return { value: 20 * Math.log10(Math.max(1e-12, vrms)) + 13.01, unit: "dBm" };
    case "linear_vpk":
      return { value: vrms * Math.SQRT2, unit: "Vpk" };
    case "linear_rms":
    default:
      return { value: vrms, unit: "Vrms" };
  }
}
