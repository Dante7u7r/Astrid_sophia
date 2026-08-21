import { describe, it, expect, vi } from "vitest";
import {
  drawAcSweep,
  drawXyTrace,
  drawTyReticle,
  drawPvtTraces,
  drawSplitTyReticle,
  drawOscilloscopeCursors,
  type OscilloscopeChannelView,
} from "./oscilloscope_renderer";
import type { AcSweepResult, PvtTrace, TimeStepResult } from "./oscilloscope_panel";

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
  it("calcula y muestra deltas de tiempo, frecuencia y fase", () => {
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
    expect(ctx.fillText).toHaveBeenCalledWith("t1", expect.any(Number), expect.any(Number));
    expect(ctx.fillText).toHaveBeenCalledWith("t2", expect.any(Number), expect.any(Number));
    expect(ctx.fillText).toHaveBeenCalledWith("v1", expect.any(Number), expect.any(Number));
    expect(ctx.fillText).toHaveBeenCalledWith("v2", expect.any(Number), expect.any(Number));
    expect(ctx.roundRect).toHaveBeenCalled();
  });
});
