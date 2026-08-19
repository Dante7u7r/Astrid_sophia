import { describe, expect, it } from "vitest";
import type { TimeStepResult } from "./oscilloscope_panel";
import {
  calculateOscilloscopeMetrics,
  calculateAutoFitSettings,
  buildTyTracePoints,
  findTriggerStartIndex,
  normalizeTriggerChannel,
  normalizeTriggerEdge,
  selectTraceSampleIndices,
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

  it("encuentra el inicio de trigger por flanco", () => {
    const results = [
      point(0, -1),
      point(0.1, 0),
      point(0.2, 1),
      point(0.3, 0),
      point(0.4, -1),
    ];

    expect(findTriggerStartIndex(results, "1", "rising", 0)).toBe(2);
    expect(findTriggerStartIndex(results, "1", "falling", 0)).toBe(4);
    expect(findTriggerStartIndex(results, null, "rising", 0)).toBe(0);
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
    expect(settings.timeDivValue).toBe(0.2);
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
});
