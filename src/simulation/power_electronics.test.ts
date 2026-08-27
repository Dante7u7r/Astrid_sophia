import { describe, expect, it, vi } from "vitest";
import type { ComponentInstance } from "../canvas_orchestrator";
import {
  DiacDefinition,
  ScrDefinition,
  Tl431Definition,
  TriacDefinition,
} from "../components/descriptors/power_electronics";

describe("Power Electronics & Trigger Devices (SCR, Triac, Diac, TL431)", () => {
  it("Valida metadatos, prefijos y alineación estricta a 20px de todos los pines", () => {
    const defs = [
      { def: ScrDefinition, type: "scr", prefix: "SCR", pinCount: 3 },
      { def: TriacDefinition, type: "triac", prefix: "TR", pinCount: 3 },
      { def: DiacDefinition, type: "diac", prefix: "DIAC", pinCount: 2 },
      { def: Tl431Definition, type: "tl431", prefix: "U", pinCount: 3 },
    ];

    for (const item of defs) {
      expect(item.def.type).toBe(item.type);
      expect(item.def.prefix).toBe(item.prefix);
      expect(item.def.category).toBe("semiconductores");

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

  it("Evalúa disparo por puerta, enclavamiento y desenclavamiento por corriente de mantenimiento del SCR", () => {
    const comp: ComponentInstance = {
      id: "SCR1",
      type: "scr",
      x: 0,
      y: 0,
      rotation: 0,
      value: 0,
      holdingCurrent: 0.005,
      gateTriggerVoltage: 0.7,
      powerState: { isLatched: false },
    };

    // 1. Estado de bloqueo directo (VA = 12V, VK = 0V, VG = 0V) -> Apagado
    const resOff = ScrDefinition.evaluateLiveBehavior!({ 0: 12, 1: 0, 2: 0 }, comp);
    expect(resOff.dynamicState?.isLatched).toBe(false);
    expect(resOff.dynamicState?.iAk).toBe(0.0);

    // 2. Pulso de disparo en puerta (VG = 1.0V >= 0.7V) -> Enclava
    const resTrigger = ScrDefinition.evaluateLiveBehavior!({ 0: 12, 1: 0, 2: 1.0 }, comp);
    expect(resTrigger.dynamicState?.isLatched).toBe(true);
    expect(resTrigger.dynamicState?.iAk).toBeGreaterThan(0.1);

    // 3. Retiro del pulso de compuerta (VG = 0V) -> Se mantiene enclavado porque I_AK > I_H
    const resRetain = ScrDefinition.evaluateLiveBehavior!({ 0: 12, 1: 0, 2: 0 }, comp);
    expect(resRetain.dynamicState?.isLatched).toBe(true);
    expect(resRetain.dynamicState?.iAk).toBeGreaterThan(0.1);

    // 4. Conmutación por cero / Tensión inversa (VA = 0V) -> Se desenclava
    const resUnlatch = ScrDefinition.evaluateLiveBehavior!({ 0: 0, 1: 0, 2: 0 }, comp);
    expect(resUnlatch.dynamicState?.isLatched).toBe(false);
    expect(resUnlatch.dynamicState?.iAk).toBe(0.0);
  });

  it("Evalúa disparo bidireccional en 4 cuadrantes del Triac", () => {
    const comp: ComponentInstance = {
      id: "TR1",
      type: "triac",
      x: 0,
      y: 0,
      rotation: 0,
      value: 0,
      holdingCurrent: 0.01,
      gateTriggerVoltage: 0.7,
      powerState: { isLatched: false },
    };

    // 1. Cuadrante I: V_MT2 > 0 (15V), V_G > 0 (1.2V) -> Conduce positivo
    const resQ1 = TriacDefinition.evaluateLiveBehavior!({ 0: 15, 1: 0, 2: 1.2 }, comp);
    expect(resQ1.dynamicState?.isLatched).toBe(true);
    expect(resQ1.dynamicState?.iMt).toBeGreaterThan(0.1);

    // 2. Cruce por cero -> Se apaga
    TriacDefinition.evaluateLiveBehavior!({ 0: 0, 1: 0, 2: 0 }, comp);
    expect(comp.powerState?.isLatched).toBe(false);

    // 3. Cuadrante III: V_MT2 < 0 (-15V), V_G < 0 (-1.2V) -> Conduce negativo
    const resQ3 = TriacDefinition.evaluateLiveBehavior!({ 0: -15, 1: 0, 2: -1.2 }, comp);
    expect(resQ3.dynamicState?.isLatched).toBe(true);
    expect(resQ3.dynamicState?.iMt).toBeLessThan(-0.1);
  });

  it("Evalúa ruptura por tensión avalancha (Breakover 32V) del Diac", () => {
    const comp: ComponentInstance = {
      id: "DIAC1",
      type: "diac",
      x: 0,
      y: 0,
      rotation: 0,
      value: 32,
      breakoverVoltage: 32,
      powerState: { isLatched: false },
    };

    // 1. Tensión menor a V_BO (20V < 32V) -> Bloqueo
    const resBelow = DiacDefinition.evaluateLiveBehavior!({ 0: 20, 1: 0 }, comp);
    expect(resBelow.dynamicState?.isLatched).toBe(false);
    expect(resBelow.dynamicState?.i).toBe(0.0);

    // 2. Tensión mayor o igual a V_BO (35V >= 32V) -> Ruptura y conducción
    const resBreakover = DiacDefinition.evaluateLiveBehavior!({ 0: 35, 1: 0 }, comp);
    expect(resBreakover.dynamicState?.isLatched).toBe(true);
    expect(resBreakover.dynamicState?.i).toBeGreaterThan(0.01);

    // 3. Ruptura simétrica negativa (-35V)
    comp.powerState!.isLatched = false;
    const resNeg = DiacDefinition.evaluateLiveBehavior!({ 0: -35, 1: 0 }, comp);
    expect(resNeg.dynamicState?.isLatched).toBe(true);
    expect(resNeg.dynamicState?.i).toBeLessThan(-0.01);
  });

  it("Evalúa regulación de tensión shunt con referencia 2.495V del TL431", () => {
    const comp: ComponentInstance = {
      id: "U1",
      type: "tl431",
      x: 0,
      y: 0,
      rotation: 0,
      value: 2.495,
      refVoltage: 2.495,
    };

    // 1. V_REF < 2.495V (V_REF = 2.0V, VK = 5V, VA = 0V) -> Corriente de reposo mínima (I_K ≈ 1µA)
    const resBelow = Tl431Definition.evaluateLiveBehavior!({ 0: 5.0, 1: 0, 2: 2.0 }, comp);
    expect(resBelow.dynamicState?.isRegulating).toBe(false);
    expect(resBelow.dynamicState?.iK).toBeCloseTo(1e-6, 5);

    // 2. V_REF >= 2.495V (V_REF = 2.50V, VK = 5V, VA = 0V) -> Regula activamente y drena corriente
    const resReg = Tl431Definition.evaluateLiveBehavior!({ 0: 5.0, 1: 0, 2: 2.50 }, comp);
    expect(resReg.dynamicState?.isRegulating).toBe(true);
    expect(resReg.dynamicState?.iK).toBeGreaterThan(0.001);

    // 3. Mayor exceso en V_REF (V_REF = 2.60V) -> Aumenta fuertemente la corriente de cátodo (gm = 1.0S)
    const resHigh = Tl431Definition.evaluateLiveBehavior!({ 0: 5.0, 1: 0, 2: 2.60 }, comp);
    expect(resHigh.dynamicState?.iK).toBeGreaterThan(0.1);
  });

  it("Renderiza en Canvas 2D los símbolos gráficos para los 4 dispositivos de potencia", () => {
    const createMockCtx = () => ({
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
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

    const compScr: ComponentInstance = { id: "SCR1", type: "scr", x: 0, y: 0, rotation: 0, value: 0 };
    ScrDefinition.render(ctx, compScr, state, options);
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();

    const compTriac: ComponentInstance = { id: "TR1", type: "triac", x: 0, y: 0, rotation: 0, value: 0 };
    TriacDefinition.render(ctx, compTriac, state, options);

    const compDiac: ComponentInstance = { id: "DIAC1", type: "diac", x: 0, y: 0, rotation: 0, value: 32 };
    DiacDefinition.render(ctx, compDiac, state, options);

    const compTl431: ComponentInstance = { id: "U1", type: "tl431", x: 0, y: 0, rotation: 0, value: 2.495 };
    Tl431Definition.render(ctx, compTl431, state, options);
    expect(ctx.fillText).toHaveBeenCalledWith("REF", expect.any(Number), expect.any(Number));
  });
});
