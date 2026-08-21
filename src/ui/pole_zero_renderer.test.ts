import { describe, it, expect, vi } from "vitest";
import { drawPoleZeroPlot } from "./pole_zero_renderer";
import type { StabilityAnalysisResult } from "../simulation/tauri_commands";

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
    stroke: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 25 })),
    setLineDash: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe("PoleZeroRenderer", () => {
  it("no falla con dimensiones nulas o mínimas", () => {
    const ctx = createMockContext();
    drawPoleZeroPlot(ctx, 10, 10, null);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 10, 10);
  });

  it("renderiza plano S sin polos ni ceros cuando result es null", () => {
    const ctx = createMockContext();
    drawPoleZeroPlot(ctx, 400, 400, null);
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalled();
  });

  it("dibuja polos (X), ceros (O) y leyenda de estabilidad", () => {
    const ctx = createMockContext();
    const result: StabilityAnalysisResult = {
      isStable: true,
      phaseMargin: 65,
      gainMargin: 18,
      poles: [
        { re: -100, im: 200 },
        { re: -100, im: -200 },
      ],
      zeros: [
        { re: -50, im: 0 },
      ],
      dominantPole: { re: -100, im: 0 },
      transmissionZero: null,
      recommendation: "Circuito estable con buen margen de fase",
    };

    drawPoleZeroPlot(ctx, 500, 500, result);
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalled();
  });
});
