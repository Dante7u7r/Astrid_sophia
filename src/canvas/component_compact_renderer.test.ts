import { describe, it, expect, vi } from "vitest";
import { drawCompactComponent } from "./component_compact_renderer";
import type { ComponentInstance } from "../canvas_orchestrator";

function createMockContext(): CanvasRenderingContext2D {
  return {
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    rect: vi.fn(),
    arc: vi.fn(),
    bezierCurveTo: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    closePath: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

function makeComp(type: string, id = "C1", pinCount?: number): ComponentInstance {
  return {
    id,
    type,
    x: 100,
    y: 100,
    rotation: 0,
    pins: [],
    pinCount,
  };
}

describe("drawCompactComponent", () => {
  it("dibuja componente ground sin leads estándar", () => {
    const ctx = createMockContext();
    const comp = makeComp("ground", "GND1");

    drawCompactComponent(ctx, comp, "#66fcf1");
    expect(ctx.strokeStyle).toBe("#66fcf1");
    expect(ctx.moveTo).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("dibuja fuentes de tensión / corriente con arco", () => {
    const ctx = createMockContext();
    const comp = makeComp("vsource", "V1");

    drawCompactComponent(ctx, comp, "#22c55e");
    expect(ctx.arc).toHaveBeenCalledWith(0, 0, 18, 0, Math.PI * 2);
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("dibuja microcontroladores MCU (8051 y AVR)", () => {
    const ctx = createMockContext();
    const mcu8051 = makeComp("mcu_8051", "U1");
    drawCompactComponent(ctx, mcu8051, "#38bdf8");
    expect(ctx.rect).toHaveBeenCalledWith(-50, -220, 100, 420);

    const mcuAvr = makeComp("mcu_avr", "U2");
    drawCompactComponent(ctx, mcuAvr, "#38bdf8");
    expect(ctx.rect).toHaveBeenCalledWith(-50, -160, 100, 300);
  });

  it("dibuja subcircuitos SPICE tipo X con altura proporcional a pines", () => {
    const ctx = createMockContext();
    const subckt = makeComp("x", "X1", 8);
    drawCompactComponent(ctx, subckt, "#a855f7");
    expect(ctx.rect).toHaveBeenCalledWith(-40, -80, 80, 160);
  });

  it("dibuja capacitor e inductor con trazos específicos", () => {
    const ctx = createMockContext();
    const cap = makeComp("capacitor", "C1");
    drawCompactComponent(ctx, cap, "#facc15");
    expect(ctx.lineTo).toHaveBeenCalledWith(-6, 14);

    const ind = makeComp("inductor", "L1");
    drawCompactComponent(ctx, ind, "#facc15");
    expect(ctx.bezierCurveTo).toHaveBeenCalled();
  });

  it("dibuja componente por defecto con rectángulo", () => {
    const ctx = createMockContext();
    const resistor = makeComp("resistor", "R1");
    drawCompactComponent(ctx, resistor, "#66fcf1");
    expect(ctx.rect).toHaveBeenCalledWith(-20, -10, 40, 20);
    expect(ctx.fill).toHaveBeenCalled();
  });
});
