import { describe, it, expect, vi } from "vitest";
import { drawLogicAnalyzer } from "./logic_analyzer_renderer";
import type { LogicRenderOptions, LogicRendererChannel } from "./logic_analyzer_renderer";

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

describe("LogicAnalyzerRenderer", () => {
  const channels: LogicRendererChannel[] = Array.from({ length: 8 }, (_, i) => ({
    index: i,
    nodeName: i === 0 ? "CLK" : i === 1 ? "DATA" : `D${i}`,
    enabled: i < 4,
    color: "#4f9cf9",
    samples: [
      { time: 0, level: "LOW" },
      { time: 0.001, level: "HIGH" },
      { time: 0.002, level: "LOW" },
    ],
  }));

  const baseOptions: LogicRenderOptions = {
    width: 600,
    height: 400,
    channels,
    threshold: { logicFamily: "TTL", vHighMin: 2.0, vLowMax: 0.8 },
    timeWindow: { startTime: 0, endTime: 0.005 },
    triggerTime: 0.001,
    isBusEnabled: true,
    busPackets: [{ startTime: 0, endTime: 0.002, hexValue: "A5", binaryValue: "10100101" }],
    uartPackets: [{ startTime: 0, endTime: 0.002, byteValue: 65, charValue: "A", hasParityError: false }],
    cursors: { cursorT1: 0.001, cursorT2: 0.003 },
  };

  it("no falla con dimensiones reducidas", () => {
    const ctx = createMockContext();
    drawLogicAnalyzer(ctx, { ...baseOptions, width: 10, height: 10 });
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 10, 10);
  });

  it("renderiza canales, regla de tiempo, buses y cursores correctamente", () => {
    const ctx = createMockContext();
    drawLogicAnalyzer(ctx, baseOptions);

    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalled();
  });
});
