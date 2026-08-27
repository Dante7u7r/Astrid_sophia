import { describe, expect, it, vi } from "vitest";
import type { ComponentInstance } from "../canvas_orchestrator";
import {
  FrequencyCounterDefinition,
  LogicProbeDefinition,
  PulseGeneratorDefinition,
  StbProbeDefinition,
  WattmeterDefinition,
} from "../components/descriptors/instruments";

describe("Advanced Instrumentation in Schematic (Wattmeter, Logic Probe, Pulse Gen, Freq Counter, STB Probe)", () => {
  it("Valida metadatos, prefijos y alineación estricta a 20px de todos los pines de instrumentación", () => {
    const defs = [
      { def: WattmeterDefinition, type: "wattmeter", prefix: "W", pinCount: 4 },
      { def: LogicProbeDefinition, type: "logic_probe", prefix: "LP", pinCount: 1 },
      { def: PulseGeneratorDefinition, type: "pulse_generator", prefix: "PULSE", pinCount: 2 },
      { def: FrequencyCounterDefinition, type: "frequency_counter", prefix: "FC", pinCount: 2 },
      { def: StbProbeDefinition, type: "stb_probe", prefix: "STB", pinCount: 2 },
    ];

    for (const item of defs) {
      expect(item.def.type).toBe(item.type);
      expect(item.def.prefix).toBe(item.prefix);

      const comp: ComponentInstance = {
        id: `${item.prefix}1`,
        type: item.type as ComponentInstance["type"],
        x: 0,
        y: 0,
        rotation: 0,
        value: 0,
      };

      const pins = item.def.getPins(comp);
      expect(pins).toHaveLength(item.pinCount);

      for (const pin of pins) {
        expect(Math.abs(pin.x % 20)).toBe(0);
        expect(Math.abs(pin.y % 20)).toBe(0);
      }
    }
  });

  it("Evalúa cálculo de potencia activa y corriente del Vatímetro", () => {
    const comp: ComponentInstance = {
      id: "W1",
      type: "wattmeter",
      x: 0,
      y: 0,
      rotation: 0,
      value: 0,
      activePower: 0,
    };

    // Shunt de 1 mOhm con 2mV de caída -> 2 Amperios de corriente
    // Tensión diferencial entre V+ y V- = 120V
    // Potencia esperada = 120V * 2A = 240W
    const pinVoltages = {
      0: 12.002, // I+
      1: 12.000, // I- (caída 2mV en shunt 1mOhm => 2A)
      2: 120.0,  // V+
      3: 0.0,    // V-
    };

    const res = WattmeterDefinition.evaluateLiveBehavior!(pinVoltages, comp);
    expect(res.branchCurrents?.[0]).toBeCloseTo(2.0, 3);
    expect(res.branchCurrents?.[1]).toBeCloseTo(-2.0, 3);
    expect(comp.activePower).toBeCloseTo(240.0, 1);
    expect(comp.powerFactor).toBe(1.0);
  });

  it("Evalúa estados lógicos (HIGH, LOW, Hi-Z/FLOAT) de la Sonda Lógica Digital", () => {
    const comp: ComponentInstance = {
      id: "LP1",
      type: "logic_probe",
      x: 0,
      y: 0,
      rotation: 0,
      value: "X",
      logicState: "X",
    };

    // 1. Nivel ALTO (HIGH): Vin = 4.8V >= 2.0V
    LogicProbeDefinition.evaluateLiveBehavior!({ 0: 4.8 }, comp);
    expect(comp.logicState).toBe("1");

    // 2. Nivel BAJO (LOW): Vin = 0.2V <= 0.8V
    LogicProbeDefinition.evaluateLiveBehavior!({ 0: 0.2 }, comp);
    expect(comp.logicState).toBe("0");

    // 3. Nivel Indeterminado / Tristate / Flotante: Vin = 1.4V
    LogicProbeDefinition.evaluateLiveBehavior!({ 0: 1.4 }, comp);
    expect(comp.logicState).toBe("X");
  });

  it("Evalúa inyección de pulsos digitales y parámetros del generador de pulsos", () => {
    const comp: ComponentInstance = {
      id: "PULSE1",
      type: "pulse_generator",
      x: 0,
      y: 0,
      rotation: 0,
      value: 1000,
      amplitude: 5.0,
      frequency: 2500,
    };

    const res = PulseGeneratorDefinition.evaluateLiveBehavior!({ 0: 0, 1: 5.0 }, comp);
    expect(res.dynamicState?.vOut).toBe(5.0);
    expect(res.dynamicState?.frequency).toBe(2500);
    expect(res.branchCurrents?.[1]).toBeGreaterThan(0);
  });

  it("Evalúa medición y lectura de frecuencia del Frecuencímetro", () => {
    const comp: ComponentInstance = {
      id: "FC1",
      type: "frequency_counter",
      x: 0,
      y: 0,
      rotation: 0,
      value: 50000,
    };

    FrequencyCounterDefinition.evaluateLiveBehavior!({ 0: 5.0, 1: 0.0 }, comp);
    expect(comp.frequencyReading).toBe(50000);
  });

  it("Renderiza en Canvas 2D los 4 instrumentos virtuales de laboratorio", () => {
    const createMockCtx = () => ({
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      roundRect: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillText: vi.fn(),
      font: "",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      textAlign: "left",
      textBaseline: "middle",
    }) as unknown as CanvasRenderingContext2D;

    const ctx = createMockCtx();
    const state = { color: "#38BDF8", lineWidth: 1.5, selected: false, hovered: false, isDark: true };
    const options = { detail: "full" as const, symbolStandard: "IEEE" as const };

    const compWatt: ComponentInstance = { id: "W1", type: "wattmeter", x: 0, y: 0, rotation: 0, value: 240, activePower: 240 };
    WattmeterDefinition.render(ctx, compWatt, state, options);
    expect(ctx.stroke).toHaveBeenCalled();

    const compLp: ComponentInstance = { id: "LP1", type: "logic_probe", x: 0, y: 0, rotation: 0, value: "1", logicState: "1" };
    LogicProbeDefinition.render(ctx, compLp, state, options);

    const compPulse: ComponentInstance = { id: "PULSE1", type: "pulse_generator", x: 0, y: 0, rotation: 0, value: 1000 };
    PulseGeneratorDefinition.render(ctx, compPulse, state, options);

    const compFc: ComponentInstance = { id: "FC1", type: "frequency_counter", x: 0, y: 0, rotation: 0, value: 1000, frequencyReading: 1000 };
    FrequencyCounterDefinition.render(ctx, compFc, state, options);

    const compStb: ComponentInstance = { id: "STB1", type: "stb_probe", x: 0, y: 0, rotation: 0, value: 0 };
    StbProbeDefinition.render(ctx, compStb, state, options);
  });

  it("Evalúa comportamiento de conducción transparente de la Sonda STB en DC y transitorio", () => {
    const comp: ComponentInstance = {
      id: "STB1",
      type: "stb_probe",
      x: 0,
      y: 0,
      rotation: 0,
      value: 0,
    };

    const res = StbProbeDefinition.evaluateLiveBehavior!({ 0: 5.0, 1: 5.0 }, comp);
    expect(res.branchCurrents[0]).toBeCloseTo(0, 4);
    expect(res.branchCurrents[1]).toBeCloseTo(0, 4);

    const resDiff = StbProbeDefinition.evaluateLiveBehavior!({ 0: 5.001, 1: 5.0 }, comp);
    // 1mV de diferencia en 1 uOhm (G = 1e6 S) => 1000 A
    expect(resDiff.branchCurrents[0]).toBeGreaterThan(0);
    expect(resDiff.branchCurrents[1]).toBeLessThan(0);
  });
});

