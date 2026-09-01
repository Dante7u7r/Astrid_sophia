import { describe, expect, it } from "vitest";
import type { TimeStepResult } from "./oscilloscope_panel";
import { buildTyTracePoints } from "./oscilloscope_model";

function sample(time: number, voltage: number): TimeStepResult {
  return { time, nodeVoltages: { "1": voltage, "2": voltage / 2 }, branchCurrents: {} };
}

describe("oscilloscope trace cache", () => {
  it("reutiliza la traza cuando los datos y parámetros son idénticos", () => {
    const results = Array.from({ length: 200 }, (_, index) => sample(index * 1e-3, Math.sin(index / 10)));
    const dimensions = { width: 320, height: 200 };
    const scale = { voltsPerDiv: 1, offsetPixels: 0, timeDivValue: 0.02 };

    const first = buildTyTracePoints(results, "1", dimensions, scale);
    const second = buildTyTracePoints(results, "1", dimensions, scale);

    expect(second).toBe(first);
  });

  it("invalida la entrada cuando cambia la escala o crece el buffer", () => {
    const results = Array.from({ length: 200 }, (_, index) => sample(index * 1e-3, index));
    const dimensions = { width: 320, height: 200 };
    const scale = { voltsPerDiv: 1, offsetPixels: 0, timeDivValue: 0.02 };
    const first = buildTyTracePoints(results, "1", dimensions, scale);

    const rescaled = buildTyTracePoints(results, "1", dimensions, { ...scale, voltsPerDiv: 2 });
    results.push(sample(0.2, 500));
    const appended = buildTyTracePoints(results, "1", dimensions, scale);

    expect(rescaled).not.toBe(first);
    expect(appended).not.toBe(first);
  });

  it("invalida la entrada si se reemplaza el extremo del buffer sin cambiar su longitud", () => {
    const results = Array.from({ length: 200 }, (_, index) => sample(index * 1e-3, index));
    const dimensions = { width: 320, height: 200 };
    const scale = { voltsPerDiv: 1, offsetPixels: 0, timeDivValue: 0.02 };
    const first = buildTyTracePoints(results, "1", dimensions, scale);

    results[results.length - 1] = sample(0.199, 999);
    const rebuilt = buildTyTracePoints(results, "1", dimensions, scale);

    expect(rebuilt).not.toBe(first);
  });

  it("preserva selección LTTB para señales diferenciales", () => {
    const results = Array.from({ length: 5_000 }, (_, index) => sample(index * 1e-5, 0));
    results[2_500] = {
      time: 0.025,
      nodeVoltages: { "1": 20, "2": -20 },
      branchCurrents: {},
    };

    const points = buildTyTracePoints(
      results,
      "V(1,2)",
      { width: 160, height: 160 },
      { voltsPerDiv: 1, offsetPixels: 0, timeDivValue: 0.005 },
    );

    expect(points.some((point) => point.y < -200)).toBe(true);
  });
});
