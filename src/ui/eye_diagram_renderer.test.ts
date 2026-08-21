import { describe, expect, it, vi } from "vitest";
import { drawEyeDiagram, drawJitterHistogram } from "./eye_diagram_renderer";
import type { EyeDiagramResult } from "../simulation/eye_diagram_model";

describe("eye_diagram_renderer", () => {
  function createMockContext(): CanvasRenderingContext2D {
    return {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      font: "",
      textAlign: "start",
      textBaseline: "alphabetic",
      shadowColor: "",
      shadowBlur: 0,
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      fillText: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      setLineDash: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
  }

  const mockEyeResult: EyeDiagramResult = {
    node: "out",
    unitInterval: 100e-9,
    baudRate: 10e6,
    vMin: 0,
    vMax: 3.3,
    eyeHeight: 2.5,
    eyeWidth: 80e-9,
    eyeWidthUi: 0.8,
    eyeAmplitude: 3.0,
    qualityFactorQ: 8.5,
    extinctionRatioDb: 12.0,
    slices: [
      {
        sliceIndex: 0,
        points: [
          { tRel: 0, voltage: 0 },
          { tRel: 50e-9, voltage: 3.3 },
          { tRel: 100e-9, voltage: 3.3 },
          { tRel: 150e-9, voltage: 0 },
          { tRel: 200e-9, voltage: 0 },
        ],
      },
    ],
    jitter: {
      tieSamples: [1e-12, -2e-12],
      tieRms: 5e-12,
      tiePkPk: 15e-12,
      periodJitterSamples: [2e-12, -1e-12],
      periodJitterRms: 3e-12,
      periodJitterPkPk: 8e-12,
      cycleToCycleJitterRms: 2e-12,
      cycleToCycleJitterMax: 4e-12,
      randomJitterRms: 3.5e-12,
      deterministicJitter: 5e-12,
      totalJitter: 54e-12,
    },
    maskViolationsCount: 0,
  };

  it("renderiza cuadrícula de UI, trazas plegadas fosforescentes y HUD", () => {
    const ctx = createMockContext();
    drawEyeDiagram(ctx, {
      width: 600,
      height: 400,
      result: mockEyeResult,
      showMask: true,
      showSamplingPoint: true,
    });

    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith(
      expect.stringContaining("OJO V(out)"),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("renderiza histograma de distribución de jitter TIE", () => {
    const ctx = createMockContext();
    const samples = [1e-12, 2e-12, 1.5e-12, -0.5e-12, 0.2e-12, 2.8e-12];
    drawJitterHistogram(ctx, {
      width: 400,
      height: 200,
      samples,
    });

    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith(
      expect.stringContaining("Histograma de Jitter"),
      expect.any(Number),
      expect.any(Number),
    );
  });
});
