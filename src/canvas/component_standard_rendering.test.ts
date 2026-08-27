import { describe, expect, it, vi } from "vitest";
import {
  ResistorDefinition,
  PotentiometerDefinition,
  LdrDefinition,
} from "../components/descriptors/passives";
import {
  AndGateDefinition,
  OrGateDefinition,
  NotGateDefinition,
  NandGateDefinition,
  NorGateDefinition,
  XorGateDefinition,
} from "../components/descriptors/logic_gates";
import type { ComponentInstance } from "../canvas_orchestrator";

function createMockCanvasContext(): CanvasRenderingContext2D {
  return {
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    closePath: vi.fn(),
    quadraticCurveTo: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe("Component Standard Rendering (IEEE vs IEC)", () => {
  const visualState = {
    color: "#38BDF8",
    lineWidth: 1.5,
    glowLevel: 0,
    accentColor: "#38BDF8",
  };

  it("renderiza Resistencia en formato IEEE (zigzag) por defecto", () => {
    const ctx = createMockCanvasContext();
    const comp: ComponentInstance = { id: "R1", type: "resistor", x: 0, y: 0, rotation: 0, value: 1000 };

    ResistorDefinition.render(ctx, comp, visualState, { symbolStandard: "IEEE" });
    expect(ctx.moveTo).toHaveBeenCalledWith(-20, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(-15, -8);
    expect(ctx.rect).not.toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("renderiza Resistencia en formato IEC (caja rectangular europea)", () => {
    const ctx = createMockCanvasContext();
    const comp: ComponentInstance = { id: "R1", type: "resistor", x: 0, y: 0, rotation: 0, value: 1000 };

    ResistorDefinition.render(ctx, comp, visualState, { symbolStandard: "IEC" });
    expect(ctx.rect).toHaveBeenCalledWith(-18, -6, 36, 12);
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("renderiza Potenciómetro y LDR en formato IEC", () => {
    const ctxPot = createMockCanvasContext();
    const compPot: ComponentInstance = { id: "RV1", type: "potentiometer", x: 0, y: 0, rotation: 0, value: 10000 };
    PotentiometerDefinition.render(ctxPot, compPot, visualState, { symbolStandard: "IEC" });
    expect(ctxPot.rect).toHaveBeenCalledWith(-18, -6, 36, 12);

    const ctxLdr = createMockCanvasContext();
    const compLdr: ComponentInstance = { id: "LDR1", type: "ldr", x: 0, y: 0, rotation: 0, value: 100 };
    LdrDefinition.render(ctxLdr, compLdr, visualState, { symbolStandard: "IEC" });
    expect(ctxLdr.rect).toHaveBeenCalledWith(-18, -6, 36, 12);
  });

  it("renderiza compuertas lógicas en formato IEC con operadores normalizados", () => {
    const ctxAnd = createMockCanvasContext();
    const compAnd: ComponentInstance = { id: "U1", type: "and_gate", x: 0, y: 0, rotation: 0 };
    AndGateDefinition.render(ctxAnd, compAnd, visualState, { symbolStandard: "IEC" });
    expect(ctxAnd.rect).toHaveBeenCalledWith(-20, -20, 40, 40);
    expect(ctxAnd.fillText).toHaveBeenCalledWith("&", 0, -16);

    const ctxOr = createMockCanvasContext();
    const compOr: ComponentInstance = { id: "U2", type: "or_gate", x: 0, y: 0, rotation: 0 };
    OrGateDefinition.render(ctxOr, compOr, visualState, { symbolStandard: "IEC" });
    expect(ctxOr.rect).toHaveBeenCalledWith(-20, -22, 40, 44);
    expect(ctxOr.fillText).toHaveBeenCalledWith("≥1", 0, -18);

    const ctxNot = createMockCanvasContext();
    const compNot: ComponentInstance = { id: "U3", type: "not_gate", x: 0, y: 0, rotation: 0 };
    NotGateDefinition.render(ctxNot, compNot, visualState, { symbolStandard: "IEC" });
    expect(ctxNot.rect).toHaveBeenCalledWith(-20, -18, 40, 36);
    expect(ctxNot.fillText).toHaveBeenCalledWith("1", 0, -14);
    expect(ctxNot.arc).toHaveBeenCalledWith(24, 0, 4, 0, Math.PI * 2);

    const ctxNand = createMockCanvasContext();
    const compNand: ComponentInstance = { id: "U4", type: "nand_gate", x: 0, y: 0, rotation: 0 };
    NandGateDefinition.render(ctxNand, compNand, visualState, { symbolStandard: "IEC" });
    expect(ctxNand.fillText).toHaveBeenCalledWith("&", 0, -16);
    expect(ctxNand.arc).toHaveBeenCalledWith(24, 0, 4, 0, Math.PI * 2);

    const ctxNor = createMockCanvasContext();
    const compNor: ComponentInstance = { id: "U5", type: "nor_gate", x: 0, y: 0, rotation: 0 };
    NorGateDefinition.render(ctxNor, compNor, visualState, { symbolStandard: "IEC" });
    expect(ctxNor.fillText).toHaveBeenCalledWith("≥1", 0, -18);
    expect(ctxNor.arc).toHaveBeenCalledWith(24, 0, 4, 0, Math.PI * 2);

    const ctxXor = createMockCanvasContext();
    const compXor: ComponentInstance = { id: "U6", type: "xor_gate", x: 0, y: 0, rotation: 0 };
    XorGateDefinition.render(ctxXor, compXor, visualState, { symbolStandard: "IEC" });
    expect(ctxXor.fillText).toHaveBeenCalledWith("=1", 0, -18);
  });
});
