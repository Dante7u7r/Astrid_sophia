import { describe, it, expect, vi } from "vitest";
import {
  LampDefinition,
  RelayDefinition,
  BuzzerDefinition,
} from "../components/descriptors/actuators";
import {
  LdrDefinition,
  ThermistorDefinition,
  PotentiometerDefinition,
} from "../components/descriptors/passives";

interface MockVisualState {
  color: string;
  lineWidth: number;
  shadowBlur: number;
}

describe("Phase 3: Actuators, Sources & Sensors Pedagogical Visuals", () => {
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
    createRadialGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),
    setLineDash: vi.fn(),
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    textAlign: "left",
  }) as unknown as CanvasRenderingContext2D;

  it("Lámpara: Calcula nivel de brillo por tensión diferencial y renderiza filamento incandescente", () => {
    const ctx = createMockCtx();
    const comp = { id: "LP1", type: "lamp" as const, x: 0, y: 0, rotation: 0, value: "120", glowLevel: 0 };

    // 12V en bombilla de 12V
    const behavior = LampDefinition.evaluateLiveBehavior?.([12, 0], comp);
    expect(behavior?.glowLevel).toBe(1.0);
    expect(comp.glowLevel).toBe(1.0);

    LampDefinition.render(ctx, comp, dummyState, {});
    expect(ctx.createRadialGradient).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("Relé: Conmuta contacto COM-NO ante excitación de bobina >= 3.6V", () => {
    const ctx = createMockCtx();
    const comp = { id: "RY1", type: "relay" as const, x: 0, y: 0, rotation: 0, value: "80m", relayClosed: false };

    // 5V en bobina (resistencia 120 ohms -> I = 41.6mA > 30mA pull-in)
    const behavior = RelayDefinition.evaluateLiveBehavior?.([5, 0, 12, 0], comp);
    expect(behavior?.relayClosed).toBe(true);
    expect(comp.relayClosed).toBe(true);

    RelayDefinition.render(ctx, comp, dummyState, {});
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("Buzzer: Emite ondas de presión acústica proporcionales a la tensión", () => {
    const ctx = createMockCtx();
    const comp = { id: "BZ1", type: "buzzer" as const, x: 0, y: 0, rotation: 0, value: "90", buzzerLevel: 0 };

    const behavior = BuzzerDefinition.evaluateLiveBehavior?.([5, 0], comp);
    expect(behavior?.buzzerLevel).toBeGreaterThan(0.5);
    expect(comp.buzzerLevel).toBeGreaterThan(0.5);

    BuzzerDefinition.render(ctx, comp, dummyState, {});
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("Potenciómetro: Muestra porcentaje de posición del cursor en tiempo real", () => {
    const ctx = createMockCtx();
    const comp = { id: "RV1", type: "potentiometer" as const, x: 0, y: 0, rotation: 0, value: 10000, wiperPosition: 0.75 };

    PotentiometerDefinition.render(ctx, comp, dummyState, {});
    expect(ctx.fillText).toHaveBeenCalledWith("75%", 0, -14);
  });

  it("LDR: Muestra nivel de iluminación ambiental en lux", () => {
    const ctx = createMockCtx();
    const comp = { id: "LDR1", type: "ldr" as const, x: 0, y: 0, rotation: 0, value: 100, lux: 450 };

    LdrDefinition.render(ctx, comp, dummyState, {});
    expect(ctx.fillText).toHaveBeenCalledWith("450 lx", 0, -28);
  });

  it("Termistor: Muestra temperatura operativa en Celsius", () => {
    const ctx = createMockCtx();
    const comp = { id: "RT1", type: "thermistor" as const, x: 0, y: 0, rotation: 0, value: 25, temperatureCelsius: 85 };

    ThermistorDefinition.render(ctx, comp, dummyState, {});
    expect(ctx.fillText).toHaveBeenCalledWith("85°C", 0, -14);
  });
});
