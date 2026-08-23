import { describe, it, expect, vi } from "vitest";
import {
  AndGateDefinition,
  OrGateDefinition,
  NotGateDefinition,
} from "../components/descriptors/logic_gates";
import { FuseDefinition } from "../components/descriptors/passives";
import { ZenerDiodeDefinition, SchottkyDiodeDefinition } from "../components/descriptors/semiconductors";

interface MockVisualState {
  color: string;
  lineWidth: number;
  shadowBlur: number;
}

describe("Phase 1: Digital Logic & Protections Pedagogical Visuals", () => {
  const dummyState: MockVisualState = {
    color: "#E6EAF0",
    lineWidth: 2,
    shadowBlur: 0,
  };

  const createMockCtx = () => ({
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    fillRect: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    closePath: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillText: vi.fn(),
    quadraticCurveTo: vi.fn(),
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    textAlign: "left",
  }) as unknown as CanvasRenderingContext2D;

  it("Compuerta AND: Detecta A=1, B=1 -> Y=1 e ilumina cuerpo activo", () => {
    const ctx = createMockCtx();
    const comp = { id: "U1", type: "and_gate" as const, x: 0, y: 0, rotation: 0, value: 1 };
    const voltageMap = {
      "U1:0": 5.0, // Pin A = 5V ('1')
      "U1:1": 5.0, // Pin B = 5V ('1')
      "U1:2": 5.0, // Pin Y = 5V ('1')
    };

    AndGateDefinition.render(ctx, comp, dummyState, { voltageMap });
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });

  it("Compuerta NOT: Invierte A=1 (5V) -> Y=0 (0V)", () => {
    const ctx = createMockCtx();
    const comp = { id: "U2", type: "not_gate" as const, x: 0, y: 0, rotation: 0, value: 1 };
    const voltageMap = {
      "U2:0": 5.0, // Pin A = 5V ('1')
      "U2:1": 0.0, // Pin Y = 0V ('0')
    };

    NotGateDefinition.render(ctx, comp, dummyState, { voltageMap });
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });

  it("Fusible: Filamento intacto bajo corriente normal y fundido con aviso ante sobrecorriente", () => {
    const ctx = createMockCtx();
    const comp = { id: "F1", type: "fuse" as const, x: 0, y: 0, rotation: 0, value: 2.0, isBlown: false };

    // 1. Corriente normal (1.0 A en fusible de 2.0 A)
    FuseDefinition.render(ctx, comp, dummyState, { branchCurrents: { "F1:I": 1.0 } });
    expect(comp.isBlown).toBe(false);
    expect(ctx.fillText).not.toHaveBeenCalled();

    // 2. Sobrecorriente severa (5.0 A en fusible de 2.0 A)
    FuseDefinition.render(ctx, comp, dummyState, { branchCurrents: { "F1:I": 5.0 } });
    expect(comp.isBlown).toBe(true);
    expect(ctx.fillText).toHaveBeenCalledWith("🔥 FUNDIDO", 0, -13);
  });

  it("Diodo Zener: Regulación activa en reversa con voltaje de ruptura", () => {
    const ctx = createMockCtx();
    const comp = { id: "DZ1", type: "zener_diode" as const, x: 0, y: 0, rotation: 0, value: 5.1 };

    // Ruptura Zener: Anodo = 0V, Catodo = 5.2V -> V_catodo - V_anodo >= 5.1V
    const voltageMap = {
      "DZ1:0": 0.0,
      "DZ1:1": 5.2,
    };

    ZenerDiodeDefinition.render(ctx, comp, dummyState, { voltageMap });
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });

  it("Diodo Schottky: Conducción directa de baja caída activa", () => {
    const ctx = createMockCtx();
    const comp = { id: "DS1", type: "schottky_diode" as const, x: 0, y: 0, rotation: 0, value: 0.3 };

    // Anodo = 0.4V, Catodo = 0.0V (0.4V > 0.25V umbral Schottky)
    const voltageMap = {
      "DS1:0": 0.4,
      "DS1:1": 0.0,
    };

    SchottkyDiodeDefinition.render(ctx, comp, dummyState, { voltageMap });
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });
});
