import { describe, it, expect, vi } from "vitest";
import {
  drawAcSweep,
  drawXyTrace,
  drawTyReticle,
  drawPvtTraces,
  drawSplitTyReticle,
  drawOscilloscopeCursors,
  drawWaveformHistogram,
  drawMaskOverlay,
  type OscilloscopeChannelView,
} from "./oscilloscope_renderer";
import type { AcSweepResult, PvtTrace, TimeStepResult } from "./oscilloscope_panel";
import type { WaveformHistogram, MaskToleranceDefinition, MaskTestResult } from "./oscilloscope_model";

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
    rect: vi.fn(),
    clip: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 45 })),
    setLineDash: vi.fn(),
    roundRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe("OscilloscopeRenderer — drawAcSweep", () => {
  it("ignora barridos con rango logarítmico inválido", () => {
    const ctx = createMockContext();
    const result: AcSweepResult = {
      frequencies: [100, 100],
      nodeAmplitudes: {},
      nodePhases: {},
    };
    drawAcSweep(ctx, 400, 300, result, []);
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it("dibuja cuadrícula de décadas y trazas activas", () => {
    const ctx = createMockContext();
    const result: AcSweepResult = {
      frequencies: [10, 100, 1000, 10000, 100000],
      nodeAmplitudes: {
        "1": [-3, -6, -20, -40, -60],
        "2": [0, 0, 0, 0, 0],
      },
      nodePhases: {},
    };
    const channels: OscilloscopeChannelView[] = [
      { node: "1", color: "#66fcf1", active: true },
      { node: "2", color: "#facc15", active: false },
      { node: null, color: "#f43f5e", active: true },
    ];
    drawAcSweep(ctx, 500, 300, result, channels);
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalled();
  });
});

describe("OscilloscopeRenderer — drawXyTrace", () => {
  it("renderiza modo XY sobre cuadrícula 2D con submuestreo", () => {
    const ctx = createMockContext();
    const data: TimeStepResult[] = Array.from({ length: 200 }, (_, i) => ({
      time: i * 0.0001,
      nodeVoltages: {
        X: Math.cos((i * Math.PI) / 20) * 5,
        Y: Math.sin((i * Math.PI) / 20) * 5,
      },
    }));

    drawXyTrace(ctx, 400, 400, data, "X", "Y", 1, 1, 0, 0);
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.moveTo).toHaveBeenCalled();
    expect(ctx.lineTo).toHaveBeenCalled();
  });
});

describe("OscilloscopeRenderer — drawTyReticle & drawSplitTyReticle", () => {
  it("dibuja retícula estándar con marcadores de canal y disparador", () => {
    const ctx = createMockContext();
    const ret = drawTyReticle(ctx, 600, 400, {
      channels: [
        { num: 1, color: "#66fcf1", offsetPixels: 20, active: true },
        { num: 2, color: "#facc15", offsetPixels: -20, active: false },
      ],
      trigger: {
        levelVolts: 2.5,
        voltsPerDiv: 1.0,
        mode: "auto",
        triggered: true,
        paused: false,
      },
    });

    expect(ret.divWidth).toBe(60);
    expect(ret.divHeight).toBe(50);
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith("1", expect.any(Number), expect.any(Number));
    expect(ctx.fillText).toHaveBeenCalledWith("T", expect.any(Number), expect.any(Number));
    expect(ctx.fillText).toHaveBeenCalledWith("TRIG'D", expect.any(Number), expect.any(Number));
  });

  it("renderiza badges de trigger en estados STOP y NORMAL", () => {
    const ctx = createMockContext();
    drawTyReticle(ctx, 600, 400, {
      trigger: {
        levelVolts: 0,
        voltsPerDiv: 1.0,
        mode: "normal",
        triggered: false,
        paused: true,
      },
    });
    expect(ctx.fillText).toHaveBeenCalledWith("STOP", expect.any(Number), expect.any(Number));
  });

  it("dibuja retícula dividida para múltiples canales activos", () => {
    const ctx = createMockContext();
    drawSplitTyReticle(ctx, 800, 600, [
      { num: 1, color: "#66fcf1", offsetPixels: 0, voltsPerDiv: 1 },
      { num: 2, color: "#facc15", offsetPixels: 10, voltsPerDiv: 2 },
    ], {
      levelVolts: 1,
      voltsPerDiv: 1,
      mode: "single",
      triggered: false,
      paused: false,
    });

    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith("CH1 (1 V/div)", 24, expect.any(Number));
    expect(ctx.fillText).toHaveBeenCalledWith("CH2 (2 V/div)", 24, expect.any(Number));
  });

  it("omite retícula dividida si hay <= 1 canal activo", () => {
    const ctx = createMockContext();
    drawSplitTyReticle(ctx, 800, 600, [
      { num: 1, color: "#66fcf1", offsetPixels: 0, voltsPerDiv: 1 },
    ]);
    expect(ctx.save).not.toHaveBeenCalled();
  });
});

describe("OscilloscopeRenderer — drawPvtTraces", () => {
  it("dibuja curvas de variaciones PVT sobre retícula", () => {
    const ctx = createMockContext();
    const traces: PvtTrace[] = [
      {
        name: "Nominal",
        color: "#66fcf1",
        visible: true,
        results: [
          { time: 0, nodeVoltages: { "out": 0 } },
          { time: 0.001, nodeVoltages: { "out": 2.5 } },
          { time: 0.002, nodeVoltages: { "out": 5.0 } },
        ],
      },
      {
        name: "Slow Corner",
        color: "#f43f5e",
        visible: false,
        results: [],
      },
    ];

    drawPvtTraces(ctx, 600, 400, traces, "out", 1.0, 0, 0.0005);
    expect(ctx.stroke).toHaveBeenCalled();
  });
});

describe("OscilloscopeRenderer — drawOscilloscopeCursors", () => {
  it("calcula y muestra deltas de tiempo, frecuencia, fase y pestañas en bordes", () => {
    const ctx = createMockContext();
    drawOscilloscopeCursors(
      ctx,
      800,
      400,
      50,
      0.2,
      0.7,
      1.0,
      3.5,
      1.0,
      0,
      0.001,
      0.005,
    );

    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith(expect.stringContaining("T1:"), expect.any(Number), expect.any(Number));
    expect(ctx.fillText).toHaveBeenCalledWith(expect.stringContaining("T2:"), expect.any(Number), expect.any(Number));
    expect(ctx.fillText).toHaveBeenCalledWith(expect.stringContaining("V1:"), expect.any(Number), expect.any(Number));
    expect(ctx.fillText).toHaveBeenCalledWith(expect.stringContaining("V2:"), expect.any(Number), expect.any(Number));
    expect(ctx.roundRect).toHaveBeenCalled();
  });

  it("dibuja manijas en bordes inferiores y laterales con formato de tiempo y voltaje", () => {
    const ctx = createMockContext();
    drawOscilloscopeCursors(
      ctx,
      800,
      400,
      50,
      0.1,
      0.6,
      1.0,
      2.0,
      1.0,
      0,
      1e-8,
    );
    expect(ctx.fillText).toHaveBeenCalledWith(
      expect.stringContaining("T1: 10.0 ns"),
      expect.any(Number),
      expect.any(Number),
    );
    expect(ctx.fillText).toHaveBeenCalledWith(
      expect.stringContaining("T2: 60.0 ns"),
      expect.any(Number),
      expect.any(Number),
    );
    expect(ctx.fillText).toHaveBeenCalledWith(
      expect.stringContaining("V1: +1.00 V"),
      expect.any(Number),
      expect.any(Number),
    );
    expect(ctx.fillText).toHaveBeenCalledWith(
      expect.stringContaining("V2: +2.00 V"),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("soporta modo track con marcadores circulares y etiquetas en curva", () => {
    const ctx = createMockContext();
    drawOscilloscopeCursors(
      ctx,
      800,
      400,
      50,
      0.25,
      0.75,
      0,
      0,
      1.0,
      0,
      0.002,
      {
        mode: "track",
        trackV1: 3.3,
        trackV2: -1.2,
        sourceLabel: "CH1",
      },
    );

    expect(ctx.arc).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith(
      expect.stringContaining("T1: +3.30 V"),
      expect.any(Number),
      expect.any(Number),
    );
    expect(ctx.fillText).toHaveBeenCalledWith(
      expect.stringContaining("T2: -1.20 V"),
      expect.any(Number),
      expect.any(Number),
    );
  });
});


describe("OscilloscopeRenderer — drawWaveformHistogram", () => {
  it("renderiza barras de distribucion y estadisticas de media y desviacion", () => {
    const ctx = createMockContext();
    const histogram: WaveformHistogram = {
      binCenters: [0, 1, 2, 3, 4],
      counts: [10, 25, 50, 25, 10],
      probabilities: [0.08, 0.21, 0.42, 0.21, 0.08],
      minV: 0,
      maxV: 4,
      mean: 2.0,
      stdDev: 0.85,
      median: 2.0,
      totalSamples: 120,
    };

    drawWaveformHistogram(ctx, 800, 400, histogram, "#FACC15");
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.strokeRect).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith("µ: 2.00V", expect.any(Number), expect.any(Number));
    expect(ctx.fillText).toHaveBeenCalledWith("σ: 0.85V", expect.any(Number), expect.any(Number));
  });

  it("omite renderizado si el histograma esta vacio", () => {
    const ctx = createMockContext();
    const emptyHist: WaveformHistogram = {
      binCenters: [],
      counts: [],
      probabilities: [],
      minV: 0,
      maxV: 0,
      mean: 0,
      stdDev: 0,
      median: 0,
      totalSamples: 0,
    };
    drawWaveformHistogram(ctx, 800, 400, emptyHist);
    expect(ctx.save).not.toHaveBeenCalled();
  });
});

describe("OscilloscopeRenderer — drawMaskOverlay", () => {
  it("renderiza corredor de mascara y badges de PASS", () => {
    const ctx = createMockContext();
    const results: TimeStepResult[] = [
      { time: 0, nodeVoltages: { "out": 5.0 }, branchCurrents: {} },
      { time: 0.001, nodeVoltages: { "out": 5.0 }, branchCurrents: {} },
      { time: 0.002, nodeVoltages: { "out": 5.0 }, branchCurrents: {} },
    ];
    const mask: MaskToleranceDefinition = {
      centerPoints: [{ time: 0, voltage: 5.0 }],
      deltaV: 0.5,
    };
    const violations: MaskTestResult = {
      passed: true,
      totalSamples: 3,
      violationCount: 0,
      violationIndices: [],
      violationPoints: [],
    };

    drawMaskOverlay(ctx, 800, 400, results, "out", mask, 1.0, 0, 0.001, 0, violations);
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith("MASK: PASS", expect.any(Number), expect.any(Number));
  });

  it("renderiza circulos de error y badge FAIL ante violaciones de mascara", () => {
    const ctx = createMockContext();
    const results: TimeStepResult[] = [
      { time: 0, nodeVoltages: { "out": 5.0 }, branchCurrents: {} },
      { time: 0.001, nodeVoltages: { "out": 6.5 }, branchCurrents: {} },
    ];
    const mask: MaskToleranceDefinition = {
      centerPoints: [{ time: 0, voltage: 5.0 }],
      deltaV: 0.5,
    };
    const violations: MaskTestResult = {
      passed: false,
      totalSamples: 2,
      violationCount: 1,
      violationIndices: [1],
      violationPoints: [{ time: 0.001, voltage: 6.5, expected: 5.0 }],
    };

    drawMaskOverlay(ctx, 800, 400, results, "out", mask, 1.0, 0, 0.001, 0, violations);
    expect(ctx.arc).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith(
      expect.stringContaining("MASK: FAIL (1 err)"),
      expect.any(Number),
      expect.any(Number),
    );
  });
});
