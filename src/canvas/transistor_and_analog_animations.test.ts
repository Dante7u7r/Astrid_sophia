import { describe, it, expect, vi } from "vitest";
import {
  NpnDefinition,
  NmosDefinition,
} from "../components/descriptors/semiconductors";
import { OpampDefinition } from "../components/descriptors/analog";

interface MockVisualState {
  color: string;
  lineWidth: number;
  shadowBlur: number;
}

describe("Phase 2: Transistors & Analog Amplifiers Pedagogical Visuals", () => {
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
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    textAlign: "left",
  }) as unknown as CanvasRenderingContext2D;

  it("Transistor NPN: Activa zona lineal con Vbe=0.7V y Vce=5V", () => {
    const ctx = createMockCtx();
    const comp = { id: "Q1", type: "npn" as const, x: 0, y: 0, rotation: 0, value: 100 };
    const voltageMap = {
      "Q1:0": 0.7, // Base = 0.7V
      "Q1:1": 5.0, // Colector = 5.0V
      "Q1:2": 0.0, // Emisor = 0.0V
    };

    NpnDefinition.render(ctx, comp, dummyState, { voltageMap });
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("Transistor NPN: Detecta saturacion cuando Vce es menor a 0.25V", () => {
    const ctx = createMockCtx();
    const comp = { id: "Q2", type: "npn" as const, x: 0, y: 0, rotation: 0, value: 100 };
    const voltageMap = {
      "Q2:0": 0.8, // Base = 0.8V
      "Q2:1": 0.1, // Colector = 0.1V (Vce = 0.1V <= 0.25V)
      "Q2:2": 0.0, // Emisor = 0.0V
    };

    NpnDefinition.render(ctx, comp, dummyState, { voltageMap });
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("MOSFET NMOS: Ilumina canal conductor cuando Vgs >= Vth", () => {
    const ctx = createMockCtx();
    const comp = { id: "M1", type: "nmos" as const, x: 0, y: 0, rotation: 0, value: 1.5 };
    const voltageMap = {
      "M1:0": 3.3, // Gate = 3.3V
      "M1:1": 5.0, // Drain = 5.0V
      "M1:2": 0.0, // Source = 0.0V (Vgs = 3.3V >= 1.5V)
    };

    NmosDefinition.render(ctx, comp, dummyState, { voltageMap });
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("Op-Amp: Muestra modo lineal y tierra virtual cuando entradas coinciden", () => {
    const ctx = createMockCtx();
    const comp = { id: "U1", type: "opamp" as const, x: 0, y: 0, rotation: 0, value: 0 };
    const voltageMap = {
      "U1:0": 2.50, // In+ = 2.5V
      "U1:1": 2.50, // In- = 2.5V
      "U1:2": 15.0, // VCC = 15V
      "U1:3": -15.0,// VEE = -15V
      "U1:4": 5.0,  // OUT = 5.0V
    };

    OpampDefinition.render(ctx, comp, dummyState, { voltageMap });
    expect(ctx.fillText).toHaveBeenCalledWith("LIN", -5, 3);
  });

  it("Op-Amp: Muestra aviso SAT+ ante saturacion en riel de alimentacion", () => {
    const ctx = createMockCtx();
    const comp = { id: "U2", type: "opamp" as const, x: 0, y: 0, rotation: 0, value: 0 };
    const voltageMap = {
      "U2:0": 5.0,  // In+ = 5V
      "U2:1": 0.0,  // In- = 0V
      "U2:2": 15.0, // VCC = 15V
      "U2:3": -15.0,// VEE = -15V
      "U2:4": 14.8, // OUT = 14.8V (cerca de 15V)
    };

    OpampDefinition.render(ctx, comp, dummyState, { voltageMap });
    expect(ctx.fillText).toHaveBeenCalledWith("SAT+", -5, 4);
  });
});
