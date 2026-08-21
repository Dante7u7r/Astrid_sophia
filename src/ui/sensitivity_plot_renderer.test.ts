import { describe, it, expect, vi } from "vitest";
import { drawSensitivityPlot } from "./sensitivity_plot_renderer";
import type { SensitivityAnalysisResult } from "../simulation/tauri_commands";

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

describe("SensitivityPlotRenderer", () => {
  it("no falla con dimensiones nulas o mínimas", () => {
    const ctx = createMockContext();
    drawSensitivityPlot(ctx, 10, 10, null);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 10, 10);
  });

  it("muestra mensaje de sin datos cuando result es null o vacío", () => {
    const ctx = createMockContext();
    drawSensitivityPlot(ctx, 500, 300, null);
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith(
      "Sin datos de sensibilidad. Ejecuta un análisis de sensibilidad en el circuito.",
      250,
      150
    );
  });

  it("renderiza barras de impacto porcentual normalizado de componentes", () => {
    const ctx = createMockContext();
    const result: SensitivityAnalysisResult = {
      targetNode: "2",
      nominalValue: 5.0,
      sensitivities: [
        {
          componentId: "R1",
          nominalValue: 1000,
          sensitivities: { "2": -0.0025 },
          normalizedSensitivities: { "2": -0.5 },
        },
        {
          componentId: "R2",
          nominalValue: 1000,
          sensitivities: { "2": 0.0025 },
          normalizedSensitivities: { "2": 0.5 },
        },
      ],
      worstCase: {
        minVoltage: 4.8,
        maxVoltage: 5.2,
        dominantComponents: ["R1", "R2"],
      },
    };

    drawSensitivityPlot(ctx, 600, 400, result);
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalled();
  });
});
