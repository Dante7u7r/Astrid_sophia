import { describe, expect, it } from "vitest";
import type { TimeStepResult } from "./oscilloscope_panel";
import {
  calculateOscilloscopeMetrics,
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
    expect(calculateOscilloscopeMetrics([], "1")).toEqual({ vpp: 0, vrms: 0, freq: 0 });
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
});
