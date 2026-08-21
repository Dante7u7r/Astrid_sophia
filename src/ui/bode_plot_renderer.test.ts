import { describe, it, expect, vi } from "vitest";
import { drawBodePlot } from "./bode_plot_renderer";
import { processAcSweepData } from "./bode_plot_model";

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
    measureText: vi.fn(() => ({ width: 30 })),
    setLineDash: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe("BodePlotRenderer", () => {
  it("no falla cuando el ancho o alto es demasiado pequeño", () => {
    const ctx = createMockContext();
    drawBodePlot(ctx, 10, 10, null);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 10, 10);
  });

  it("renderiza una retícula vacía cuando dataSet es null", () => {
    const ctx = createMockContext();
    drawBodePlot(ctx, 800, 500, null);
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalled();
  });

  it("dibuja curvas de magnitud y fase cuando se proporciona un dataSet con puntos", () => {
    const ctx = createMockContext();
    const dataSet = processAcSweepData(
      [10, 100, 1000, 10000, 100000],
      [1.0, 0.99, 0.707, 0.1, 0.01],
      [0, -5, -45, -85, -90],
      1.0
    );

    drawBodePlot(ctx, 800, 500, dataSet, {
      isCursorsEnabled: true,
      cursorF1: 100,
      cursorF2: 10000,
      hoveredPoint: { freq: 1000, magDb: -3.01, phaseDeg: -45 },
    });

    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalled();
  });
});
