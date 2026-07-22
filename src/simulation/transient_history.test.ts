import { describe, expect, it } from "vitest";
import { appendLiveTransientSample } from "./transient_history";

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
});
