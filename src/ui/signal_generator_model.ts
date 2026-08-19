/**
 * SignalGeneratorModel — Modelo Matemático de Síntesis de Señales y Presets
 *
 * Provee funciones deterministas para evaluación de formas de onda analógicas,
 * cálculo de parámetros RMS/Pico y presets de señales de laboratorio.
 */

export type GeneratorWaveType = "sine" | "square" | "triangle" | "sawtooth" | "pulse" | "am" | "dc";

export interface SignalGeneratorParams {
  waveType: GeneratorWaveType;
  frequency: number;       // Hz
  amplitude: number;       // V (amplitud pico)
  offset: number;          // V (tensión continua offset)
  dutyCycle: number;       // 0.01 .. 0.99 (50% por defecto)
  phase: number;           // Grados (0 .. 360)
  modFrequency: number;    // Hz (para modulación AM)
  modIndex: number;        // 0.0 .. 1.0 (para modulación AM)
  enabled: boolean;        // Salida activa o en espera
}

export interface WaveformMetrics {
  vpp: number;             // Voltaje Pico a Pico (V)
  vrms: number;            // Voltaje Eficaz RMS (V)
  vavg: number;            // Voltaje Promedio (V)
  vmax: number;            // Voltaje Máximo (V)
  vmin: number;            // Voltaje Mínimo (V)
  period: number;          // Período T (s)
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
    id: "sine_1khz",
    name: "1 kHz Senoidal (5 Vpk)",
    description: "Tono de referencia estándar para pruebas de audio y filtros",
    category: "audio",
    params: { waveType: "sine", frequency: 1000, amplitude: 5, offset: 0, phase: 0 },
  },
  {
    id: "clock_10mhz",
    name: "10 MHz Clock (TTL 3.3V)",
    description: "Señal de reloj digital CMOS/TTL con offset de 1.65V",
    category: "clock",
    params: { waveType: "square", frequency: 10_000_000, amplitude: 1.65, offset: 1.65, dutyCycle: 0.5 },
  },
  {
    id: "mains_60hz",
    name: "60 Hz AC (120 Vrms)",
    description: "Red eléctrica de corriente alterna (170 Vpk)",
    category: "power",
    params: { waveType: "sine", frequency: 60, amplitude: 169.7, offset: 0, phase: 0 },
  },
  {
    id: "audio_440hz",
    name: "440 Hz (Nota La4)",
    description: "Frecuencia patrón de afinación musical",
    category: "audio",
    params: { waveType: "sine", frequency: 440, amplitude: 2.5, offset: 0, phase: 0 },
  },
  {
    id: "pwm_10khz_75",
    name: "PWM 10 kHz (Duty 75%)",
    description: "Control de modulación por ancho de pulsos para drivers y potencia",
    category: "test",
    params: { waveType: "square", frequency: 10_000, amplitude: 2.5, offset: 2.5, dutyCycle: 0.75 },
  },
  {
    id: "ramp_100hz",
    name: "Rampa 100 Hz (Lineal)",
    description: "Diente de sierra lineal para barridos de osciloscopio y moduladores",
    category: "test",
    params: { waveType: "sawtooth", frequency: 100, amplitude: 5, offset: 0 },
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

  return {
    vpp: Number.isFinite(vpp) ? vpp : 0,
    vrms: Number.isFinite(vrms) ? vrms : 0,
    vavg: Number.isFinite(vavg) ? vavg : 0,
    vmax: Number.isFinite(vmax) ? vmax : 0,
    vmin: Number.isFinite(vmin) ? vmin : 0,
    period: Number.isFinite(period) ? period : 0,
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