import { describe, expect, it, vi } from "vitest";
import { getGateInputYOffsets, drawAndGate, drawOrGate, drawNotGate, drawNandGate, drawNorGate, drawXorGate } from "./component_logic_renderer";
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
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe("Logic Gates: Dynamic Inputs & Rendering", () => {
  it("calcula correctamente los desplazamientos Y para 1, 2, 3, 4 y 8 entradas", () => {
    expect(getGateInputYOffsets(1)).toEqual([0]);
    expect(getGateInputYOffsets(2)).toEqual([-10, 10]);
    expect(getGateInputYOffsets(3)).toEqual([-20, 0, 20]);
    expect(getGateInputYOffsets(4)).toEqual([-30, -10, 10, 30]);
    expect(getGateInputYOffsets(8)).toEqual([-70, -50, -30, -10, 10, 30, 50, 70]);
  });

  it("genera los pines locales de compuerta dinámicamente según gateInputs", () => {
    const comp2: ComponentInstance = { id: "U1", type: "and_gate", x: 0, y: 0, rotation: 0, gateInputs: 2 };
    const pins2 = AndGateDefinition.getPins(comp2);
    expect(pins2).toHaveLength(3); // 2 entradas + 1 salida
    expect(pins2[0]).toMatchObject({ index: 0, x: -40, y: -10, label: "A" });
    expect(pins2[1]).toMatchObject({ index: 1, x: -40, y: 10, label: "B" });
    expect(pins2[2]).toMatchObject({ index: 2, x: 40, y: 0, label: "Y" });

    const comp4: ComponentInstance = { id: "U2", type: "and_gate", x: 0, y: 0, rotation: 0, gateInputs: 4 };
    const pins4 = AndGateDefinition.getPins(comp4);
    expect(pins4).toHaveLength(5); // 4 entradas + 1 salida
    expect(pins4[0].label).toBe("A");
    expect(pins4[1].label).toBe("B");
    expect(pins4[2].label).toBe("C");
    expect(pins4[3].label).toBe("D");
    expect(pins4[4].label).toBe("Y");

    const comp8: ComponentInstance = { id: "U3", type: "nand_gate", x: 0, y: 0, rotation: 0, gateInputs: 8 };
    const pins8 = NandGateDefinition.getPins(comp8);
    expect(pins8).toHaveLength(9); // 8 entradas + 1 salida
    expect(pins8[7].label).toBe("H");
    expect(pins8[8].label).toBe("Y");
  });

  it("escala halfExtents según el número de entradas", () => {
    const comp2: ComponentInstance = { id: "U1", type: "or_gate", x: 0, y: 0, rotation: 0, gateInputs: 2 };
    const comp4: ComponentInstance = { id: "U2", type: "or_gate", x: 0, y: 0, rotation: 0, gateInputs: 4 };
    const comp8: ComponentInstance = { id: "U3", type: "or_gate", x: 0, y: 0, rotation: 0, gateInputs: 8 };

    const ext2 = typeof OrGateDefinition.halfExtents === "function" ? OrGateDefinition.halfExtents(comp2) : OrGateDefinition.halfExtents;
    const ext4 = typeof OrGateDefinition.halfExtents === "function" ? OrGateDefinition.halfExtents(comp4) : OrGateDefinition.halfExtents;
    const ext8 = typeof OrGateDefinition.halfExtents === "function" ? OrGateDefinition.halfExtents(comp8) : OrGateDefinition.halfExtents;

    expect(ext2.halfH).toBe(30);
    expect(ext4.halfH).toBe(45);
    expect(ext8.halfH).toBe(85);
  });

  it("evalúa correctamente el comportamiento en vivo para AND, OR, NAND, NOR, XOR y NOT", () => {
    const compAnd: ComponentInstance = { id: "U1", type: "and_gate", x: 0, y: 0, rotation: 0, value: 5.0, offset: 2.5, gateInputs: 2 };
    // Ambos en 5V -> Salida 5V
    const resAnd1 = AndGateDefinition.evaluateLiveBehavior!({ 0: 5.0, 1: 5.0 }, compAnd);
    expect(resAnd1.branchCurrents?.[2]).toBeGreaterThanOrEqual(0);

    // Uno en 0V -> Salida 0V
    const resAnd0 = AndGateDefinition.evaluateLiveBehavior!({ 0: 5.0, 1: 0.0 }, compAnd);
    expect(resAnd0.branchCurrents?.[2]).toBeLessThanOrEqual(0);

    const compNot: ComponentInstance = { id: "U2", type: "not_gate", x: 0, y: 0, rotation: 0, value: 5.0, offset: 2.5, gateInputs: 1 };
    const resNot = NotGateDefinition.evaluateLiveBehavior!({ 0: 0.0 }, compNot);
    expect(resNot.branchCurrents?.[1]).toBeGreaterThanOrEqual(0);

    const compXor: ComponentInstance = { id: "U3", type: "xor_gate", x: 0, y: 0, rotation: 0, value: 5.0, offset: 2.5, gateInputs: 2 };
    const resXor1 = XorGateDefinition.evaluateLiveBehavior!({ 0: 5.0, 1: 0.0 }, compXor);
    expect(resXor1.branchCurrents?.[2]).toBeGreaterThanOrEqual(0);
    const resXor0 = XorGateDefinition.evaluateLiveBehavior!({ 0: 5.0, 1: 5.0 }, compXor);
    expect(resXor0.branchCurrents?.[2]).toBeLessThanOrEqual(0);
  });

  it("renderiza compuertas lógicas con 2, 4 y 8 entradas y Schmitt sin errores", () => {
    const ctx = createMockCanvasContext();
    expect(() => drawAndGate(ctx, { inputCount: 4, schmittTrigger: true, levelY: "1" })).not.toThrow();
    expect(() => drawOrGate(ctx, { inputCount: 3, levelY: "0" })).not.toThrow();
    expect(() => drawNandGate(ctx, { inputCount: 8, schmittTrigger: true })).not.toThrow();
    expect(() => drawNorGate(ctx, { inputCount: 4 })).not.toThrow();
    expect(() => drawXorGate(ctx, { inputCount: 2, schmittTrigger: false })).not.toThrow();
    expect(() => drawNotGate(ctx, { schmittTrigger: true, levelY: "1" })).not.toThrow();
  });
});
