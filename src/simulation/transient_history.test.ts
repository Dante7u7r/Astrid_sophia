import { describe, expect, it } from "vitest";
import { appendLiveTransientSample, lttbDownsample } from "./transient_history";

const sample = (time: number) => ({
  time,
  nodeVoltages: { "1": time },
  branchCurrents: {},
});

describe("transient_history", () => {
  it("mantiene acotado el historial interactivo y conserva las muestras recientes", () => {
    const results = Array.from({ length: 10 }, (_, index) => sample(index));

    appendLiveTransientSample(results, sample(10), 10);

    expect(results).toHaveLength(10);
    expect(results[0].time).toBe(1);
    expect(results[results.length - 1]?.time).toBe(10);
  });

  it("rechaza limites que no pueden formar una serie temporal", () => {
    expect(() => appendLiveTransientSample([], sample(0), 1)).toThrow(RangeError);
  });

  it("aplica subsampliado adaptativo LTTB conservando extremos y picos", () => {
    const rawData = Array.from({ length: 100 }, (_, i) => ({
      x: i,
      y: i === 50 ? 100 : i % 2 === 0 ? 5 : -5, // Pico sobresaliente en x=50
    }));

    const downsampled = lttbDownsample(rawData, 10);

    expect(downsampled).toHaveLength(10);
    expect(downsampled[0].x).toBe(0);
    expect(downsampled[downsampled.length - 1].x).toBe(99);
    // Verificar que el pico importante (x=50, y=100) no fue descartado por aliasing
    expect(downsampled.some(p => p.x === 50 && p.y === 100)).toBe(true);
  });
});
