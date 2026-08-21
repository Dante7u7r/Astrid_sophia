import { describe, it, expect, vi } from "vitest";
import { drawSignalGeneratorPreview } from "./signal_generator_renderer";
import type { RenderGeneratorOptions } from "./signal_generator_renderer";

function createMockContext(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    roundRect: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 25 })),
    setLineDash: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe("SignalGeneratorRenderer", () => {
  const options: RenderGeneratorOptions = {
    width: 400,
    height: 200,
    params: {
      type: "sine",
      amplitude: 5,
      frequency: 1000,
      offset: 0,
      phase: 0,
      dutyCycle: 0.5,
      modFrequency: 100,
      modIndex: 0.8,
      noiseRms: 0,
      outputEnabled: true,
      impedance: "high_z",
      outputNodeA: "1",
      outputNodeB: "0",
    },
    metrics: {
      vPeak: 5,
      vPeakToPeak: 10,
      vRms: 3.535,
      vAvg: 0,
      periodSeconds: 0.001,
      thdPercent: 0.01,
    },
    phaseOffsetTime: 0,
  };

  it("no falla con dimensiones nulas o minúsculas", () => {
    const ctx = createMockContext();
    drawSignalGeneratorPreview(ctx, { ...options, width: 5, height: 5 });
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 5, 5);
  });

  it("renderiza retícula fósforo, guías y forma de onda", () => {
    const ctx = createMockContext();
    drawSignalGeneratorPreview(ctx, options);

    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalled();
  });
});
