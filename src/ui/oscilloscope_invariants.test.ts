import { describe, it, expect } from "vitest";
import {
  findTriggerStartIndex,
  buildTyTracePoints,
  calculateOscilloscopeMetrics,
} from "./oscilloscope_model";
import type { TimeStepResult } from "./oscilloscope_panel";

describe("Oscilloscope Invariants & Resilience Engine", () => {
  const dimensions = { width: 800, height: 600 };

  it("Invariant 1: In Auto-Roll and Trigger modes with full window, horizontal coverage is 100%", () => {
    // 2.0 seconds of 100Hz square wave (20,000 samples at dt = 0.1ms)
    const dt = 0.0001;
    const count = 20000;
    const results: TimeStepResult[] = [];
    for (let i = 0; i < count; i++) {
      const t = i * dt;
      const val = (Math.floor(t * 100 * 2) % 2 === 0) ? 5.0 : -5.0;
      results.push({
        time: t,
        nodeVoltages: { "1": val },
        branchCurrents: {},
      });
    }

    // Timebase 20 ms/div -> Window = 200 ms (0.2s)
    const timeDiv = 0.02;
    const startIndex = findTriggerStartIndex(results, "1", "rising", 0.0, timeDiv);

    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(startIndex).toBeLessThan(results.length - 2);

    const points = buildTyTracePoints(
      results,
      "1",
      dimensions,
      { voltsPerDiv: 1.0, offsetPixels: 0, timeDivValue: timeDiv },
      startIndex,
    );

    expect(points.length).toBeGreaterThan(10);
    // Primer punto en el borde izquierdo (x = 0)
    expect(points[0].x).toBeCloseTo(0, 1);
    // Último punto en el borde derecho (x = width)
    expect(points[points.length - 1].x).toBeCloseTo(dimensions.width, 1);

    // Ningún punto debe ser NaN ni Infinito
    for (const pt of points) {
      expect(Number.isFinite(pt.x)).toBe(true);
      expect(Number.isFinite(pt.y)).toBe(true);
      expect(pt.x).toBeGreaterThanOrEqual(0);
      expect(pt.x).toBeLessThanOrEqual(dimensions.width + 1);
    }
  });

  it("Invariant 2: Pure DC flat signals never freeze and cover 100% of the grid", () => {
    // Pure 5.0V DC signal without crossings (5000 samples from t=0 to t=0.5s)
    const dt = 0.0001;
    const count = 5000;
    const results: TimeStepResult[] = [];
    for (let i = 0; i < count; i++) {
      results.push({
        time: i * dt,
        nodeVoltages: { "1": 5.0 },
        branchCurrents: {},
      });
    }

    // Window = 100 ms (0.1s)
    const timeDiv = 0.01;
    const startIndex = findTriggerStartIndex(results, "1", "rising", 0.0, timeDiv);

    expect(startIndex).toBeGreaterThan(0);
    const points = buildTyTracePoints(
      results,
      "1",
      dimensions,
      { voltsPerDiv: 2.0, offsetPixels: 0, timeDivValue: timeDiv },
      startIndex,
    );

    expect(points.length).toBeGreaterThan(5);
    expect(points[0].x).toBeCloseTo(0, 1);
    expect(points[points.length - 1].x).toBeCloseTo(dimensions.width, 1);
    // Traza horizontal plana
    for (const pt of points) {
      expect(pt.y).toBeCloseTo(points[0].y, 1);
    }
  });

  it("Invariant 3: Out-of-bounds trigger levels gracefully fallback to rolling window without crashing", () => {
    // Signal oscillates between 0V and 3.3V, but trigger is set to 50.0V (impossible crossing)
    const results: TimeStepResult[] = [];
    for (let i = 0; i < 3000; i++) {
      const t = i * 0.0001;
      results.push({
        time: t,
        nodeVoltages: { "1": 1.65 + 1.65 * Math.sin(2 * Math.PI * 1000 * t) },
        branchCurrents: {},
      });
    }

    const timeDiv = 0.005; // 50 ms window
    const startIndex = findTriggerStartIndex(results, "1", "rising", 50.0, timeDiv);

    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(startIndex).toBeLessThan(results.length);

    const points = buildTyTracePoints(
      results,
      "1",
      dimensions,
      { voltsPerDiv: 1.0, offsetPixels: 0, timeDivValue: timeDiv },
      startIndex,
    );

    expect(points.length).toBeGreaterThan(0);
    expect(points[0].x).toBeCloseTo(0, 1);
  });

  it("Invariant 4: Metrics calculation is resilient to noise, flatlines, single-samples and zero crossings", () => {
    // Empty result
    const mEmpty = calculateOscilloscopeMetrics([], "1");
    expect(mEmpty.vpp).toBe(0);
    expect(mEmpty.freq).toBe(0);

    // Single sample
    const mSingle = calculateOscilloscopeMetrics([{ time: 0, nodeVoltages: { "1": 12.0 }, branchCurrents: {} }], "1");
    expect(mSingle.vpp).toBe(0);
    expect(mSingle.vavg).toBe(12);

    // 1000 Hz Sine Wave 10Vpp (offset 0)
    const sineResults: TimeStepResult[] = [];
    for (let i = 0; i < 2000; i++) {
      const t = i * 0.00001;
      sineResults.push({
        time: t,
        nodeVoltages: { "1": 5.0 * Math.sin(2 * Math.PI * 1000 * t) },
        branchCurrents: {},
      });
    }

    const mSine = calculateOscilloscopeMetrics(sineResults, "1");
    expect(mSine.vpp).toBeCloseTo(10.0, 0.5);
    expect(mSine.vrms).toBeCloseTo(3.535, 0.5); // 5 / sqrt(2)
    expect(mSine.vavg).toBeCloseTo(0.0, 0.5);
    expect(mSine.freq).toBeCloseTo(1000, 10);
  });
});
