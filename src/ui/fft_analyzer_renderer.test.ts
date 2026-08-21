import { describe, it, expect, vi } from "vitest";
import { drawFftSpectrum } from "./fft_analyzer_renderer";
import type { FftAnalysisResult } from "./fft_analyzer_model";

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

describe("FftAnalyzerRenderer", () => {
  it("no falla con dimensiones reducidas", () => {
    const ctx = createMockContext();
    drawFftSpectrum(ctx, {
      width: 20,
      height: 20,
      result: null,
      scaleMode: "dbv",
      refLevelDb: 0,
      rangeDb: 80,
    });
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 20, 20);
  });

  it("renderiza cuadrícula vacía cuando result es null", () => {
    const ctx = createMockContext();
    drawFftSpectrum(ctx, {
      width: 600,
      height: 400,
      result: null,
      scaleMode: "dbv",
      refLevelDb: 0,
      rangeDb: 80,
    });
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("dibuja espectro FFT, armónicos y cursores cuando hay datos", () => {
    const ctx = createMockContext();
    const result: FftAnalysisResult = {
      frequencies: new Float64Array([0, 100, 200, 300, 400, 500, 1000]),
      magnitudesVrms: new Float64Array([0.001, 0.01, 0.003, 0.001, 0.0003, 0.0001, 0.1]),
      magnitudesDbv: new Float64Array([-60, -40, -50, -60, -70, -80, -20]),
      samplingFreq: 100000,
      numPoints: 1024,
      fundamentalFreq: 1000,
      fundamentalVrms: 0.1,
      fundamentalDbv: -20,
      harmonics: [
        { order: 1, freq: 1000, magnitudeDbv: -20, magnitudeVrms: 0.1, bin: 10 },
        { order: 2, freq: 2000, magnitudeDbv: -60, magnitudeVrms: 0.001, bin: 20 },
      ],
      thdPercent: 0.5,
      thdPlusNDb: -55,
      snrDb: 60,
      sinadDb: 59.8,
      enob: 9.6,
      sfdrDb: 40,
      noiseFloorDbv: -90,
    };

    drawFftSpectrum(ctx, {
      width: 600,
      height: 400,
      result,
      maxHoldMagnitudes: new Float64Array([-55, -35, -45, -55, -65, -75, -18]),
      scaleMode: "dbv",
      refLevelDb: 0,
      rangeDb: 80,
      showHarmonics: true,
      cursors: { cursorF1: 500, cursorF2: 1000 },
    });

    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalled();
  });
});
