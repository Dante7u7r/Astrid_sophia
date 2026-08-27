/**
 * SignalGeneratorModel — Modelo Matemático de Síntesis de Señales y Presets
 *
 * Provee funciones deterministas para evaluación de formas de onda analógicas,
 * cálculo de parámetros RMS/Pico y presets de señales de laboratorio.
 */

export type GeneratorWaveType = "sine" | "square" | "triangle" | "sawtooth" | "pulse" | "am" | "fm" | "sweep" | "noise" | "dc";
export type OutputImpedance = "high_z" | "50_ohm";

export interface SignalGeneratorParams {
  waveType: GeneratorWaveType;
  frequency: number;       // Hz (frecuencia central / portadora)
  amplitude: number;       // V (amplitud pico en bornes abiertos)
  offset: number;          // V (tensión continua offset)
  dutyCycle: number;       // 0.01 .. 0.99 (50% por defecto)
  phase: number;           // Grados (0 .. 360)
  modFrequency: number;    // Hz (para modulación AM / FM)
  modIndex: number;        // 0.0 .. 1.0 (índice de modulación AM)
  fmDeviation?: number;    // Hz (desviación de frecuencia para FM, ej: 500 Hz)
  sweepStartFreq?: number; // Hz (frecuencia inicial para Sweep)
  sweepEndFreq?: number;   // Hz (frecuencia final para Sweep)
  sweepTime?: number;      // s (duración del ciclo de barrido, ej: 0.1 s)
  outputImpedance?: OutputImpedance; // 50 ohm vs High-Z
  enabled: boolean;        // Salida activa o en espera
}

export interface WaveformMetrics {
  vpp: number;             // Voltaje Pico a Pico (V)
  vrms: number;            // Voltaje Eficaz RMS (V)
  vavg: number;            // Voltaje Promedio (V)
  vmax: number;            // Voltaje Máximo (V)
  vmin: number;            // Voltaje Mínimo (V)
  period: number;          // Período T (s)
  dbm50?: number;          // Potencia en dBm sobre carga de 50 ohms
}

export interface SignalPreset {
  id: string;
  name: string;
  description: string;
  category: "audio" | "clock" | "power" | "rf" | "test";
  params: Partial<SignalGeneratorParams>;
}

export const GENERATOR_PRESETS: readonly SignalPreset[] = [
  {
    id: "audio_1khz_1vpp",
    name: "Audio 1 kHz (1.0 Vpp)",
    description: "Tono estándar de calibración de audio profesional y bancos de prueba",
    category: "audio",
    params: { waveType: "sine", frequency: 1000, amplitude: 0.5, offset: 0, phase: 0 },
  },
  {
    id: "ttl_clock_1mhz",
    name: "Clock TTL 1 MHz (0-5V)",
    description: "Señal de reloj para lógica TTL de 5V estándar (Duty 50%)",
    category: "clock",
    params: { waveType: "square", frequency: 1_000_000, amplitude: 2.5, offset: 2.5, dutyCycle: 0.5 },
  },
  {
    id: "cmos_clock_10mhz",
    name: "Clock CMOS 10 MHz (0-3.3V)",
    description: "Reloj para microcontroladores y lógica LVCMOS 3.3V",
    category: "clock",
    params: { waveType: "square", frequency: 10_000_000, amplitude: 1.65, offset: 1.65, dutyCycle: 0.5 },
  },
  {
    id: "mains_50hz_230v",
    name: "Red Eléctrica 50 Hz (230 Vrms)",
    description: "Línea de red europea/internacional (325.3 Vpk)",
    category: "power",
    params: { waveType: "sine", frequency: 50, amplitude: 325.27, offset: 0, phase: 0 },
  },
  {
    id: "mains_60hz_120v",
    name: "Red Eléctrica 60 Hz (120 Vrms)",
    description: "Línea de red americana/nacional (169.7 Vpk)",
    category: "power",
    params: { waveType: "sine", frequency: 60, amplitude: 169.7, offset: 0, phase: 0 },
  },
  {
    id: "smps_ripple_100khz",
    name: "Rizado SMPS 100 kHz (50 mVpp)",
    description: "Simulación de rizado de conmutación en fuentes DC de 5V",
    category: "power",
    params: { waveType: "sawtooth", frequency: 100_000, amplitude: 0.025, offset: 5.0 },
  },
  {
    id: "audio_sweep_20_20k",
    name: "Barrido Audio 20 Hz - 20 kHz",
    description: "Chirp logarítmico para caracterización de respuesta acústica y filtros",
    category: "audio",
    params: { waveType: "sweep", frequency: 1000, amplitude: 1.0, offset: 0, sweepStartFreq: 20, sweepEndFreq: 20_000, sweepTime: 0.5 },
  },
  {
    id: "am_carrier_100khz",
    name: "AM 100 kHz (1 kHz Mod)",
    description: "Portadora modulada en amplitud al 80%",
    category: "rf",
    params: { waveType: "am", frequency: 100_000, amplitude: 4, offset: 0, modFrequency: 1000, modIndex: 0.8 },
  },
] as const;

/**
 * Convierte tensión eficaz (Vrms) a potencia en dBm sobre carga normalizada de 50 ohmios.
 */
export function voltsRmsToDbm50(vrms: number): number {
  if (vrms <= 0 || !Number.isFinite(vrms)) return -100;
  const pWatts = (vrms * vrms) / 50.0;
  return 10.0 * Math.log10(pWatts / 0.001);
}

/**
 * Convierte potencia en dBm (50 ohmios) a tensión eficaz (Vrms).
 */
export function dbm50ToVoltsRms(dbm: number): number {
  const pWatts = Math.pow(10, (dbm - 30.0) / 10.0);
  return Math.sqrt(pWatts * 50.0);
}

/**
 * Evalúa el valor instantáneo de la señal en el instante de tiempo t (en segundos).
 */
export function evaluateSignalPoint(t: number, params: SignalGeneratorParams): number {
  if (!params.enabled) return 0;
  if (params.waveType === "dc") return params.offset;

  const f = Math.max(1e-6, params.frequency);
  const phaseRad = ((params.phase || 0) * Math.PI) / 180;
  const period = 1 / f;
  const timeInPeriod = ((t % period) + period) % period;
  const normalizedPhase = timeInPeriod / period; // 0 .. 1

  const amp = params.amplitude;
  const offset = params.offset;
  const duty = Math.max(0.01, Math.min(0.99, params.dutyCycle || 0.5));

  switch (params.waveType) {
    case "sine": {
      return offset + amp * Math.sin(2 * Math.PI * f * t + phaseRad);
    }
    case "square": {
      const shiftedNorm = ((normalizedPhase + (params.phase || 0) / 360) % 1 + 1) % 1;
      return offset + (shiftedNorm < duty ? amp : -amp);
    }
    case "pulse": {
      const shiftedNorm = ((normalizedPhase + (params.phase || 0) / 360) % 1 + 1) % 1;
      return offset + (shiftedNorm < duty ? amp : 0);
    }
    case "triangle": {
      const shiftedNorm = ((normalizedPhase + (params.phase || 0) / 360) % 1 + 1) % 1;
      if (shiftedNorm < duty) {
        return offset - amp + (2 * amp * (shiftedNorm / duty));
      } else {
        return offset + amp - (2 * amp * ((shiftedNorm - duty) / (1 - duty)));
      }
    }
    case "sawtooth": {
      const shiftedNorm = ((normalizedPhase + (params.phase || 0) / 360) % 1 + 1) % 1;
      return offset - amp + (2 * amp * shiftedNorm);
    }
    case "am": {
      const modF = Math.max(0.1, params.modFrequency || 100);
      const modIdx = Math.max(0, Math.min(1.0, params.modIndex ?? 0.5));
      const envelope = 1 + modIdx * Math.sin(2 * Math.PI * modF * t);
      return offset + amp * envelope * Math.sin(2 * Math.PI * f * t + phaseRad);
    }
    case "fm": {
      const modF = Math.max(0.1, params.modFrequency || 100);
      const dev = params.fmDeviation ?? f * 0.2; // Desviación en Hz
      // Fase acumulada = 2*pi*fc*t - (dev/modF)*cos(2*pi*modF*t)
      const fmPhase = 2 * Math.PI * f * t - (dev / modF) * Math.cos(2 * Math.PI * modF * t);
      return offset + amp * Math.sin(fmPhase + phaseRad);
    }
    case "sweep": {
      const fStart = Math.max(1, params.sweepStartFreq ?? (f * 0.1));
      const fEnd = Math.max(fStart, params.sweepEndFreq ?? (f * 2));
      const tSweep = Math.max(1e-4, params.sweepTime ?? 0.1);
      const tInSweep = ((t % tSweep) + tSweep) % tSweep;
      // Barrido lineal: chirp phase
      const sweepPhase = 2 * Math.PI * (fStart * tInSweep + ((fEnd - fStart) / (2 * tSweep)) * tInSweep * tInSweep);
      return offset + amp * Math.sin(sweepPhase + phaseRad);
    }
    case "noise": {
      // Generador PRNG determinista con transformación Box-Muller
      const seed = Math.sin(t * 1e6) * 43758.5453;
      const u1 = Math.max(1e-6, Math.abs(seed - Math.floor(seed)));
      const u2 = Math.abs(Math.cos(t * 1e5));
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const clampedZ = Math.max(-3, Math.min(3, z)) / 3;
      return offset + amp * clampedZ;
    }
    default:
      return offset;
  }
}

/**
 * Calcula las métricas clave de la señal (Vpp, Vrms, Vavg, Vmax, Vmin, período).
 */
export function calculateSignalMetrics(params: SignalGeneratorParams): WaveformMetrics {
  if (!params.enabled) {
    return { vpp: 0, vrms: 0, vavg: 0, vmax: 0, vmin: 0, period: 0 };
  }

  const f = Math.max(1e-6, params.frequency);
  const period = 1 / f;
  const amp = params.amplitude;
  const offset = params.offset;
  const duty = Math.max(0.01, Math.min(0.99, params.dutyCycle || 0.5));

  if (params.waveType === "dc") {
    return {
      vpp: 0,
      vrms: Math.abs(offset),
      vavg: offset,
      vmax: offset,
      vmin: offset,
      period: Infinity,
    };
  }

  let vpp = amp * 2;
  let vmax = offset + amp;
  let vmin = offset - amp;
  let vavg = offset;
  let vrms = 0;

  switch (params.waveType) {
    case "sine":
      vrms = Math.sqrt(Math.pow(amp / Math.SQRT2, 2) + Math.pow(offset, 2));
      break;

    case "square":
      vavg = offset + amp * (2 * duty - 1);
      vrms = Math.sqrt(Math.pow(amp, 2) + Math.pow(offset, 2) + 2 * offset * amp * (2 * duty - 1));
      break;

    case "pulse":
      vpp = amp;
      vmax = offset + amp;
      vmin = offset;
      vavg = offset + amp * duty;
      vrms = Math.sqrt(Math.pow(offset, 2) + (Math.pow(amp, 2) + 2 * offset * amp) * duty);
      break;

    case "triangle":
    case "sawtooth":
      vrms = Math.sqrt(Math.pow(amp / Math.sqrt(3), 2) + Math.pow(offset, 2));
      break;

    case "am": {
      const m = params.modIndex ?? 0.5;
      const carrierRms = amp / Math.SQRT2;
      vrms = Math.sqrt(Math.pow(carrierRms, 2) * (1 + Math.pow(m, 2) / 2) + Math.pow(offset, 2));
      vmax = offset + amp * (1 + m);
      vmin = offset - amp * (1 + m);
      vpp = 2 * amp * (1 + m);
      break;
    }

    default:
      vrms = Math.abs(offset);
      break;
  }

  const effectiveVrms = params.outputImpedance === "50_ohm" ? vrms / 2.0 : vrms;
  const dbm50 = voltsRmsToDbm50(effectiveVrms);

  return {
    vpp: Number.isFinite(vpp) ? (params.outputImpedance === "50_ohm" ? vpp / 2 : vpp) : 0,
    vrms: Number.isFinite(effectiveVrms) ? effectiveVrms : 0,
    vavg: Number.isFinite(vavg) ? (params.outputImpedance === "50_ohm" ? vavg / 2 : vavg) : 0,
    vmax: Number.isFinite(vmax) ? (params.outputImpedance === "50_ohm" ? vmax / 2 : vmax) : 0,
    vmin: Number.isFinite(vmin) ? (params.outputImpedance === "50_ohm" ? vmin / 2 : vmin) : 0,
    period: Number.isFinite(period) ? period : 0,
    dbm50: Number.isFinite(dbm50) ? dbm50 : -100,
  };
}

/** Formatea una frecuencia a texto legible con unidades (Hz, kHz, MHz). */
export function formatFrequency(hz: number): string {
  if (hz >= 1_000_000) return `${(hz / 1_000_000).toFixed(hz % 1_000_000 === 0 ? 0 : 3)} MHz`;
  if (hz >= 1_000) return `${(hz / 1_000).toFixed(hz % 1_000 === 0 ? 0 : 2)} kHz`;
  return `${hz.toFixed(hz % 1 === 0 ? 0 : 2)} Hz`;
}

/** Formatea una tensión a texto legible con unidades (V, mV). */
export function formatVoltage(volts: number): string {
  const abs = Math.abs(volts);
  if (abs < 1 && abs > 0) return `${(volts * 1000).toFixed(1)} mV`;
  return `${volts.toFixed(2)} V`;
}