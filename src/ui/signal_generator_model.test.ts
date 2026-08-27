import { describe, expect, it } from "vitest";
import {
  calculateSignalMetrics,
  evaluateSignalPoint,
  formatFrequency,
  formatVoltage,
  voltsRmsToDbm50,
  dbm50ToVoltsRms,
  GENERATOR_PRESETS,
  type SignalGeneratorParams,
} from "./signal_generator_model";

describe("SignalGeneratorModel — Síntesis y Métricas", () => {
  const baseSineParams: SignalGeneratorParams = {
    waveType: "sine",
    frequency: 1000,
    amplitude: 5,
    offset: 0,
    dutyCycle: 0.5,
    phase: 0,
    modFrequency: 100,
    modIndex: 0.5,
    enabled: true,
  };

  it("evalúa correctamente onda senoidal en t = 0, t = T/4, t = T/2, t = 3T/4", () => {
    const T = 1 / 1000;
    expect(evaluateSignalPoint(0, baseSineParams)).toBeCloseTo(0, 4);
    expect(evaluateSignalPoint(T / 4, baseSineParams)).toBeCloseTo(5, 4);
    expect(evaluateSignalPoint(T / 2, baseSineParams)).toBeCloseTo(0, 4);
    expect(evaluateSignalPoint((3 * T) / 4, baseSineParams)).toBeCloseTo(-5, 4);
  });

  it("evalúa correctamente onda cuadrada con 50% y 75% duty cycle", () => {
    const squareParams: SignalGeneratorParams = {
      ...baseSineParams,
      waveType: "square",
      dutyCycle: 0.5,
    };
    const T = 1 / 1000;
    expect(evaluateSignalPoint(0.1 * T, squareParams)).toBe(5);
    expect(evaluateSignalPoint(0.6 * T, squareParams)).toBe(-5);

    const square75: SignalGeneratorParams = {
      ...squareParams,
      dutyCycle: 0.75,
    };
    expect(evaluateSignalPoint(0.7 * T, square75)).toBe(5);
    expect(evaluateSignalPoint(0.8 * T, square75)).toBe(-5);
  });

  it("evalúa correctamente señal continua DC", () => {
    const dcParams: SignalGeneratorParams = {
      ...baseSineParams,
      waveType: "dc",
      offset: 3.3,
    };
    expect(evaluateSignalPoint(0, dcParams)).toBe(3.3);
    expect(evaluateSignalPoint(0.005, dcParams)).toBe(3.3);
  });

  it("retorna 0 si la salida del generador está deshabilitada", () => {
    const disabledParams: SignalGeneratorParams = {
      ...baseSineParams,
      enabled: false,
    };
    expect(evaluateSignalPoint(0.001, disabledParams)).toBe(0);
    const metrics = calculateSignalMetrics(disabledParams);
    expect(metrics.vpp).toBe(0);
    expect(metrics.vrms).toBe(0);
  });

  it("calcula métricas teóricas exactas (Vpp, Vrms, Vmax, Vmin)", () => {
    const metricsSine = calculateSignalMetrics(baseSineParams);
    expect(metricsSine.vpp).toBeCloseTo(10, 4);
    expect(metricsSine.vmax).toBeCloseTo(5, 4);
    expect(metricsSine.vmin).toBeCloseTo(-5, 4);
    expect(metricsSine.vrms).toBeCloseTo(5 / Math.SQRT2, 4);
    expect(metricsSine.period).toBeCloseTo(0.001, 6);

    const triangleParams: SignalGeneratorParams = {
      ...baseSineParams,
      waveType: "triangle",
    };
    const metricsTri = calculateSignalMetrics(triangleParams);
    expect(metricsTri.vrms).toBeCloseTo(5 / Math.sqrt(3), 4);
  });

  it("formatea unidades de frecuencia y tensión de manera legible", () => {
    expect(formatFrequency(50)).toBe("50 Hz");
    expect(formatFrequency(1500)).toBe("1.50 kHz");
    expect(formatFrequency(10_000_000)).toBe("10 MHz");

    expect(formatVoltage(5)).toBe("5.00 V");
    expect(formatVoltage(0.05)).toBe("50.0 mV");
  });

  it("contiene los presets requeridos con parámetros válidos", () => {
    expect(GENERATOR_PRESETS.length).toBeGreaterThanOrEqual(5);
    const audio1k = GENERATOR_PRESETS.find((p) => p.id === "audio_1khz_1vpp");
    expect(audio1k).toBeDefined();
    expect(audio1k?.params.frequency).toBe(1000);
    expect(audio1k?.params.amplitude).toBe(0.5);
  });

  it("convierte con precisión entre Vrms y dBm a 50 ohmios", () => {
    // 1 Vrms en 50 ohms -> P = 1/50 = 20 mW = 13.01 dBm
    const dbm = voltsRmsToDbm50(1.0);
    expect(dbm).toBeCloseTo(13.01, 2);

    const vrms = dbm50ToVoltsRms(13.0103);
    expect(vrms).toBeCloseTo(1.0, 3);

    // 0 dBm -> 1 mW en 50 ohms = 0.2236 Vrms
    expect(dbm50ToVoltsRms(0)).toBeCloseTo(0.2236, 3);
  });

  it("calcula métricas teniendo en cuenta la impedancia de 50 ohms", () => {
    const params50Ohm: SignalGeneratorParams = {
      ...baseSineParams,
      outputImpedance: "50_ohm",
    };
    const metrics = calculateSignalMetrics(params50Ohm);
    // Vpp cae a la mitad (5V en vez de 10V)
    expect(metrics.vpp).toBeCloseTo(5, 4);
    expect(metrics.dbm50).toBeDefined();
  });

  it("evalúa modulación en frecuencia FM y barrido Sweep", () => {
    const fmParams: SignalGeneratorParams = {
      ...baseSineParams,
      waveType: "fm",
      frequency: 10_000,
      modFrequency: 500,
      fmDeviation: 2000,
    };
    const valFm = evaluateSignalPoint(0.001, fmParams);
    expect(valFm).toBeGreaterThanOrEqual(-5.0);
    expect(valFm).toBeLessThanOrEqual(5.0);

    const sweepParams: SignalGeneratorParams = {
      ...baseSineParams,
      waveType: "sweep",
      sweepStartFreq: 100,
      sweepEndFreq: 1000,
      sweepTime: 0.1,
    };
    const valSweep = evaluateSignalPoint(0.05, sweepParams);
    expect(valSweep).toBeGreaterThanOrEqual(-5.0);
    expect(valSweep).toBeLessThanOrEqual(5.0);

    const noiseParams: SignalGeneratorParams = {
      ...baseSineParams,
      waveType: "noise",
    };
    const valNoise = evaluateSignalPoint(0.0123, noiseParams);
    expect(valNoise).toBeGreaterThanOrEqual(-5.0);
    expect(valNoise).toBeLessThanOrEqual(5.0);
  });
});
