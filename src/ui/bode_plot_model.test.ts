import { describe, it, expect } from "vitest";
import {
  unwrapPhase,
  processAcSweepData,
  generateRcLowPassBode,
} from "./bode_plot_model";

describe("BodePlotModel — Tests Unitarios", () => {
  it("unwrapPhase desenreda saltos bruscos de +-360° en la fase", () => {
    const rawPhases = [170, 175, -179, -170];
    const unwrapped = unwrapPhase(rawPhases);

    expect(unwrapped[0]).toBe(170);
    expect(unwrapped[1]).toBe(175);
    // De 175 a -179 es un salto de 6° hacia adelante (181°), desenredado da 181°
    expect(unwrapped[2]).toBe(181);
    expect(unwrapped[3]).toBe(190);
  });

  it("unwrapPhase maneja arrays vacíos limpiamente", () => {
    expect(unwrapPhase([])).toEqual([]);
  });

  it("generateRcLowPassBode calcula correctamente un filtro RC (1k, 100nF)", () => {
    const r = 1000;
    const c = 100e-9;
    const expectedFc = 1 / (2 * Math.PI * r * c); // ~1591.55 Hz

    const result = generateRcLowPassBode(r, c, 10, 100000, 30);

    expect(result.points.length).toBeGreaterThan(50);
    expect(result.metrics.dcGainDb).toBeCloseTo(0, 1);
    expect(result.metrics.cutoffFreq3dB).not.toBeNull();
    // La frecuencia de corte numérica debe estar a menos del 2% de la teórica
    expect(result.metrics.cutoffFreq3dB!).toBeCloseTo(expectedFc, -1);
    expect(result.metrics.isStable).toBe(true);
  });

  it("processAcSweepData maneja casos vacíos sin lanzar excepciones", () => {
    const emptyResult = processAcSweepData([], [], []);
    expect(emptyResult.points).toHaveLength(0);
    expect(emptyResult.metrics.cutoffFreq3dB).toBeNull();
    expect(emptyResult.metrics.isStable).toBe(true);
  });

  it("processAcSweepData extrae margen de fase y margen de ganancia", () => {
    const frequencies = [10, 100, 1000, 10000, 100000];
    const amplitudes = [10, 5, 1, 0.2, 0.01]; // Pasa por 1 (0 dB) en 1000 Hz
    const phasesDeg = [-10, -45, -90, -135, -180]; // Pasa por -180° en 100 kHz

    const result = processAcSweepData(frequencies, amplitudes, phasesDeg, 1.0);

    expect(result.metrics.gainCrossoverFreq).toBeCloseTo(1000, 0);
    // En 1000 Hz la fase es -90°, por lo que PM = 180 + (-90) = 90°
    expect(result.metrics.phaseMarginDeg).toBeCloseTo(90, 0);
    expect(result.metrics.phaseCrossoverFreq).toBeCloseTo(100000, 0);
    // En 100 kHz la amplitud es 0.01 (-40 dB), por lo que GM = -(-40) = +40 dB
    expect(result.metrics.gainMarginDb).toBeCloseTo(40, 0);
    expect(result.metrics.isStable).toBe(true);
    expect(result.metrics.stabilityQuality).toBe("stable");
    expect(result.nyquistPoints.length).toBe(frequencies.length);
    expect(result.nyquistPoints[0].real).toBeGreaterThan(0);
  });
});
