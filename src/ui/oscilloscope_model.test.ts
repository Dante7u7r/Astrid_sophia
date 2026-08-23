import { describe, expect, it } from "vitest";
import type { TimeStepResult } from "./oscilloscope_panel";
import {
  calculateOscilloscopeMetrics,
  calculateAutoFitSettings,
  calculateAutoFitForValues,
  buildTyTracePoints,
  interpolateSincTrace,
  findTriggerStartIndex,
  findTimeIndex,
  normalizeTriggerChannel,
  normalizeTriggerEdge,
  selectTraceSampleIndices,
  searchNextCrossing,
  searchNextPeak,
  calculateWaveformHistogram,
  evaluateMaskTest,
  type MaskToleranceDefinition,
} from "./oscilloscope_model";

function point(time: number, voltage: number): TimeStepResult {
  return {
    time,
    nodeVoltages: { "1": voltage },
    branchCurrents: {},
  };
}

describe("oscilloscope_model", () => {
  it("normaliza canal y flanco de trigger", () => {
    expect(normalizeTriggerChannel("ch3")).toBe("ch3");
    expect(normalizeTriggerChannel("bad")).toBe("ch1");
    expect(normalizeTriggerEdge("falling")).toBe("falling");
    expect(normalizeTriggerEdge("bad")).toBe("rising");
  });

  it("calcula metricas basicas de una senal", () => {
    const metrics = calculateOscilloscopeMetrics([
      point(0, -1),
      point(0.25, 0),
      point(0.5, 1),
      point(0.75, 0),
      point(1, -1),
    ], "1");

    expect(metrics.vpp).toBe(2);
    expect(metrics.vrms).toBeCloseTo(Math.sqrt(3 / 5));
    expect(metrics.freq).toBe(1);
  });

  it("devuelve ceros sin muestras", () => {
    expect(calculateOscilloscopeMetrics([], "1")).toMatchObject({ vpp: 0, vrms: 0, freq: 0 });
  });

  it("encuentra el inicio de trigger por flanco y respeta ventana completa", () => {
    const results = [
      point(0, -1),
      point(0.1, 0),
      point(0.2, 1),
      point(0.3, 0),
      point(0.4, -1),
      point(0.5, 0),
      point(0.6, 1),
    ];

    expect(findTriggerStartIndex(results, "1", "rising", 0)).toBe(2);
    expect(findTriggerStartIndex(results, "1", "falling", 0)).toBe(4);
    expect(findTriggerStartIndex(results, null, "rising", 0)).toBe(0);

    // Fallback a ventana rodante cuando hay tiempo suficiente pero no cruce con ventana completa
    const noCrossingResults = Array.from({ length: 20 }, (_, i) => point(i * 0.05, 5));
    const rollStart = findTriggerStartIndex(noCrossingResults, "1", "rising", 0, 0.05);
    expect(noCrossingResults[rollStart].time).toBeCloseTo(0.45, 2);
  });

  it("construye puntos T-Y dentro de la ventana visible", () => {
    const points = buildTyTracePoints([
      point(0, 0),
      point(0.05, 1),
      point(0.11, 2),
    ], "1", { width: 100, height: 80 }, { voltsPerDiv: 1, offsetPixels: 0, timeDivValue: 0.01 });

    expect(points).toEqual([
      { x: 0, y: 40 },
      { x: 50, y: 30 },
    ]);
  });

  it("reduce trazas extensas conservando extremos por bucket", () => {
    const results = Array.from({ length: 10_000 }, (_, index) => point(index / 10_000, 0));
    results[5_123] = point(0.5123, 25);

    const points = buildTyTracePoints(
      results,
      "1",
      { width: 100, height: 80 },
      { voltsPerDiv: 1, offsetPixels: 0, timeDivValue: 0.1 },
    );

    expect(points.length).toBeLessThanOrEqual(200);
    expect(points.some((tracePoint) => tracePoint.y === -210)).toBe(true);
  });

  it("selecciona una cantidad acotada de muestras XY incluyendo extremos", () => {
    const indices = selectTraceSampleIndices(1_000_000, 2_000);

    expect(indices).toHaveLength(2_000);
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(999_999);
  });

  it("auto-escala una señal periódica usando valores disponibles en la interfaz", () => {
    const settings = calculateAutoFitSettings([
      point(0, -2),
      point(0.00025, 0),
      point(0.0005, 2),
      point(0.00075, 0),
      point(0.001, -2),
    ], "1");

    expect(settings).toEqual({ voltsPerDiv: 1, timeDivValue: 0.0002, centerVoltage: 0 });
  });

  it("auto-escala sin desbordar el máximo de la interfaz y conserva el nivel DC", () => {
    const settings = calculateAutoFitSettings([
      point(0, 0),
      point(0.5, 100),
    ], "1");

    expect(settings.voltsPerDiv).toBe(20);
    expect(settings.timeDivValue).toBe(0.1);
    expect(settings.centerVoltage).toBe(50);
  });

  it("aplica acoplamiento AC, GND e inversion de traza", () => {
    // Señal con componente DC de 10V y rizado de +/-1V (9V a 11V)
    const pointsDc = [
      point(0, 9),
      point(0.05, 11),
    ];

    // 1. Acoplamiento DC: y centrado en 40 - (10/1)*10 = -60 (fuera de pantalla hacia arriba)
    const dcTrace = buildTyTracePoints(pointsDc, "1", { width: 100, height: 80 }, { voltsPerDiv: 1, offsetPixels: 0, timeDivValue: 0.01 }, 0, { coupling: "dc" });
    expect(dcTrace[0].y).toBeLessThan(0);

    // 2. Acoplamiento AC: resta el promedio (10V) -> 9V pasa a -1V, 11V pasa a +1V
    const acTrace = buildTyTracePoints(pointsDc, "1", { width: 100, height: 80 }, { voltsPerDiv: 1, offsetPixels: 0, timeDivValue: 0.01 }, 0, { coupling: "ac" });
    // at t=0, v=-1V -> y = 40 - (-1/1)*10 = 50
    // at t=0.05, v=+1V -> y = 40 - (1/1)*10 = 30
    expect(acTrace[0].y).toBeCloseTo(50);
    expect(acTrace[1].y).toBeCloseTo(30);

    // 3. Acoplamiento GND: siempre en centro 0V (y = 40)
    const gndTrace = buildTyTracePoints(pointsDc, "1", { width: 100, height: 80 }, { voltsPerDiv: 1, offsetPixels: 0, timeDivValue: 0.01 }, 0, { coupling: "gnd" });
    expect(gndTrace[0].y).toBe(40);
    expect(gndTrace[1].y).toBe(40);

    // 4. Inversion (INV): invierte signo
    const invTrace = buildTyTracePoints(pointsDc, "1", { width: 100, height: 80 }, { voltsPerDiv: 1, offsetPixels: 0, timeDivValue: 0.01 }, 0, { coupling: "ac", invert: true });
    expect(invTrace[0].y).toBeCloseTo(30); // antes era 50
    expect(invTrace[1].y).toBeCloseTo(50); // antes era 30
  });

  it("calcula auto-fit desde un vector arbitrario de valores (canal Math)", () => {
    const mathValues = [-5, 0, 5, 0, -5];
    const settings = calculateAutoFitForValues(mathValues);
    expect(settings.voltsPerDiv).toBe(2);
    expect(settings.centerVoltage).toBe(0);
  });

  it("busca y navega cruces por umbral (searchNextCrossing)", () => {
    const results = [
      point(0, -1),
      point(0.1, 0.5), // Cruce subida en i=1
      point(0.2, 1.0),
      point(0.3, -0.5), // Cruce bajada en i=3
      point(0.4, 0.8), // Cruce subida en i=4
    ];

    expect(searchNextCrossing(results, "1", 0, "rising", 0)).toBe(1);
    expect(searchNextCrossing(results, "1", 0, "falling", 1)).toBe(3);
    expect(searchNextCrossing(results, "1", 0, "both", 2)).toBe(3);
    expect(searchNextCrossing(results, "1", 0, "rising", 3)).toBe(4);
    expect(searchNextCrossing(results, "1", 0, "rising", 4)).toBeNull();
  });

  it("busca y navega picos maximos y minimos (searchNextPeak)", () => {
    const results = [
      point(0, 0),
      point(0.1, 2.5), // Pico max en i=1
      point(0.2, 0),
      point(0.3, -3.0), // Pico min en i=3
      point(0.4, 1.0),
    ];

    expect(searchNextPeak(results, "1", "max", 0)).toBe(1);
    expect(searchNextPeak(results, "1", "min", 1)).toBe(3);
    expect(searchNextPeak(results, "1", "both", 0)).toBe(1);
    expect(searchNextPeak(results, "1", "both", 2)).toBe(3);
  });

  it("realiza busqueda binaria de tiempo exacto (findTimeIndex)", () => {
    const results = [
      point(0.0, 0),
      point(0.02, 1),
      point(0.04, 2),
      point(0.06, 3),
      point(0.08, 4),
    ];

    expect(findTimeIndex(results, -0.01)).toBe(0);
    expect(findTimeIndex(results, 0.04)).toBe(2);
    expect(findTimeIndex(results, 0.055)).toBe(3);
    expect(findTimeIndex(results, 0.10)).toBe(4);
  });

  it("calcula histograma de amplitud y funcion de densidad de probabilidad (PDF)", () => {
    const results = [
      point(0, 1),
      point(1, 2),
      point(2, 3),
      point(3, 4),
      point(4, 5),
    ];

    const hist = calculateWaveformHistogram(results, "1", 5);
    expect(hist.totalSamples).toBe(5);
    expect(hist.minV).toBe(1);
    expect(hist.maxV).toBe(5);
    expect(hist.mean).toBe(3);
    expect(hist.median).toBe(3);
    expect(hist.counts.reduce((a, b) => a + b, 0)).toBe(5);
    expect(hist.probabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1.0);
  });

  it("evalua pruebas de mascara (Mask Testing) detectando violaciones de tolerancia", () => {
    const results = [
      point(0.0, 5.0),
      point(0.1, 5.1), // Dentro de ±0.5V
      point(0.2, 5.8), // VIOLACION (> 5.5V)
      point(0.3, 4.9), // Dentro
    ];

    const mask = {
      centerPoints: [
        { time: 0.0, voltage: 5.0 },
        { time: 0.1, voltage: 5.0 },
        { time: 0.2, voltage: 5.0 },
        { time: 0.3, voltage: 5.0 },
      ],
      deltaV: 0.5,
    };

    const evalResult = evaluateMaskTest(results, "1", mask);
    expect(evalResult.passed).toBe(false);
    expect(evalResult.totalSamples).toBe(4);
    expect(evalResult.violationCount).toBe(1);
    expect(evalResult.violationIndices).toEqual([2]);
    expect(evalResult.violationPoints[0].voltage).toBe(5.8);
  });

  it("calcula metricas de pulso y transitorios (riseTime, fallTime, posWidth)", () => {
    // Generar un pulso cuadrado de 0V a 5V con flancos lineales
    const pulseResults = [
      point(0.0, 0.0),
      point(0.001, 0.0),
      point(0.002, 5.0), // Flanco de subida rápido
      point(0.005, 5.0),
      point(0.006, 0.0), // Flanco de bajada rápido
      point(0.008, 0.0),
    ];

    const metrics = calculateOscilloscopeMetrics(pulseResults, "1");
    expect(metrics.vpp).toBe(5.0);
    expect(metrics.riseTime).toBeDefined();
    expect(metrics.riseTime).toBeGreaterThan(0);
    expect(metrics.riseTime).toBeLessThan(0.002);
    expect(metrics.fallTime).toBeDefined();
    expect(metrics.fallTime).toBeGreaterThan(0);
    expect(metrics.fallTime).toBeLessThan(0.002);
    expect(metrics.posWidth).toBeDefined();
    expect(metrics.posWidth).toBeCloseTo(0.004, 2);
  });

  it("reconstruye curvas suaves mediante interpolacion sinc", () => {
    const rawPoints = [
      { x: 0, y: 0 },
      { x: 20, y: 50 },
      { x: 40, y: 100 },
      { x: 60, y: 50 },
      { x: 80, y: 0 },
    ];

    const interpolated = interpolateSincTrace(rawPoints, 20);
    expect(interpolated.length).toBe(20);
    expect(interpolated[0].x).toBe(0);
    expect(interpolated[19].x).toBe(80);
    // El punto medio debe estar cerca del pico
    const midPoint = interpolated[Math.floor(interpolated.length / 2)];
    expect(midPoint.y).toBeGreaterThan(20);
  });
});
