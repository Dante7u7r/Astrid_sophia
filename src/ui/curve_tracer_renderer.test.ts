import { describe, it, expect, vi } from "vitest";
import { drawCurveTracer } from "./curve_tracer_renderer";
import type { TraceResult } from "./curve_tracer_model";

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

describe("CurveTracerRenderer", () => {
  it("no falla con dimensiones insuficientes", () => {
    const ctx = createMockContext();
    drawCurveTracer(ctx, { width: 20, height: 20, result: null });
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 20, 20);
  });

  it("renderiza cuadrícula vacía cuando result es null", () => {
    const ctx = createMockContext();
    drawCurveTracer(ctx, { width: 600, height: 400, result: null });
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("dibuja familias de curvas y punto Q interactivo", () => {
    const ctx = createMockContext();
    const result: TraceResult = {
      deviceName: "2N2222",
      category: "bjt",
      mode: "output",
      traces: [
        {
          stepValue: 0.00001,
          stepLabel: "Ib = 10 µA",
          color: "#4f9cf9",
          points: [
            { v: 0, i: 0 },
            { v: 1, i: 0.001 },
            { v: 5, i: 0.0012 },
          ],
        },
        {
          stepValue: 0.00002,
          stepLabel: "Ib = 20 µA",
          color: "#22c55e",
          points: [
            { v: 0, i: 0 },
            { v: 1, i: 0.002 },
            { v: 5, i: 0.0024 },
          ],
        },
      ],
      params: {
        hFE_DC: 120,
        vceSat: 0.2,
      },
      vMin: 0,
      vMax: 5,
      iMin: 0,
      iMax: 0.003,
      xLabel: "Vce (V)",
      yLabel: "Ic (mA)",
    };

    drawCurveTracer(ctx, {
      width: 600,
      height: 400,
      result,
      qPoint: { v: 2.5, i: 0.0015 },
      showTangent: true,
    });

    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalled();
  });
});
