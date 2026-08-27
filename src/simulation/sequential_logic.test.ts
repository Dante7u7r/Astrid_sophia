import { describe, expect, it, vi } from "vitest";
import type { ComponentInstance } from "../canvas_orchestrator";
import {
  BcdTo7SegDefinition,
  FlipFlopDDefinition,
  FlipFlopJKDefinition,
  ShiftRegister595Definition,
} from "../components/descriptors/sequential_logic";

describe("Sequential Logic & Digital ICs (Flip-Flops D/JK, BCD 7447, 74595)", () => {
  it("Valida metadatos, prefijos SPICE 'U' y cuadrícula 20px estricta para todos los pines", () => {
    const defs = [
      { def: FlipFlopDDefinition, type: "flipflop_d", pinCount: 6 },
      { def: FlipFlopJKDefinition, type: "flipflop_jk", pinCount: 6 },
      { def: BcdTo7SegDefinition, type: "bcd_to_7seg", pinCount: 11 },
      { def: ShiftRegister595Definition, type: "shift_register_595", pinCount: 14 },
    ];

    for (const item of defs) {
      expect(item.def.type).toBe(item.type);
      expect(item.def.prefix).toBe("U");
      expect(item.def.category).toBe("logica-digital");

      const comp: ComponentInstance = {
        id: `${item.def.prefix}1`,
        type: item.type as ComponentInstance["type"],
        x: 0,
        y: 0,
        rotation: 0,
        value: 5.0,
      };

      const pins = item.def.getPins(comp);
      expect(pins).toHaveLength(item.pinCount);

      for (const pin of pins) {
        expect(Math.abs(pin.x % 20)).toBe(0);
        expect(Math.abs(pin.y % 20)).toBe(0);
      }
    }
  });

  it("Evalúa lógica y sincronismo de reloj del Flip-Flop D (74HC74)", () => {
    const comp: ComponentInstance = {
      id: "U1",
      type: "flipflop_d",
      x: 0,
      y: 0,
      rotation: 0,
      value: 5.0,
    };

    // 1. Asíncrono Clear: CLR = 0V, PRE = 5V -> Q = 0, Q_NOT = 1
    const resClr = FlipFlopDDefinition.evaluateLiveBehavior!({ 0: 5, 1: 0, 2: 5, 3: 0 }, comp);
    expect(resClr.dynamicState?.q).toBe(false);
    expect(resClr.dynamicState?.qNot).toBe(true);

    // 2. Asíncrono Preset: PRE = 0V, CLR = 5V -> Q = 1, Q_NOT = 0
    const resPre = FlipFlopDDefinition.evaluateLiveBehavior!({ 0: 0, 1: 0, 2: 0, 3: 5 }, comp);
    expect(resPre.dynamicState?.q).toBe(true);
    expect(resPre.dynamicState?.qNot).toBe(false);

    // 3. Flanco de subida con D = 0 (CLK: 0V -> 5V, PRE=5, CLR=5)
    comp.sequentialState = { q: true, qNot: false, prevClk: false };
    const resClkLow = FlipFlopDDefinition.evaluateLiveBehavior!({ 0: 0, 1: 5, 2: 5, 3: 5 }, comp);
    expect(resClkLow.dynamicState?.q).toBe(false);
    expect(resClkLow.dynamicState?.qNot).toBe(true);

    // 4. Mantenimiento sin flanco (CLK = 5V constante)
    const resHold = FlipFlopDDefinition.evaluateLiveBehavior!({ 0: 5, 1: 5, 2: 5, 3: 5 }, comp);
    expect(resHold.dynamicState?.q).toBe(false); // Retiene 0 porque no hubo flanco 0->1

    // 5. Flanco de subida con D = 1 (CLK: 0V -> 5V)
    comp.sequentialState!.prevClk = false;
    const resClkHigh = FlipFlopDDefinition.evaluateLiveBehavior!({ 0: 5, 1: 5, 2: 5, 3: 5 }, comp);
    expect(resClkHigh.dynamicState?.q).toBe(true);
    expect(resClkHigh.dynamicState?.qNot).toBe(false);
  });

  it("Evalúa función Toggle, Set, Reset y Hold del Flip-Flop JK (74HC73)", () => {
    const comp: ComponentInstance = {
      id: "U1",
      type: "flipflop_jk",
      x: 0,
      y: 0,
      rotation: 0,
      value: 5.0,
      sequentialState: { q: false, qNot: true, prevClk: false },
    };

    // 1. Set: J=1, K=0, Flanco de reloj -> Q = 1
    const resSet = FlipFlopJKDefinition.evaluateLiveBehavior!({ 0: 5, 1: 5, 2: 0, 3: 5 }, comp);
    expect(resSet.dynamicState?.q).toBe(true);
    expect(resSet.dynamicState?.qNot).toBe(false);

    // 2. Hold: J=0, K=0, Flanco de reloj -> Q = 1
    comp.sequentialState!.prevClk = false;
    const resHold = FlipFlopJKDefinition.evaluateLiveBehavior!({ 0: 0, 1: 5, 2: 0, 3: 5 }, comp);
    expect(resHold.dynamicState?.q).toBe(true);

    // 3. Reset: J=0, K=1, Flanco de reloj -> Q = 0
    comp.sequentialState!.prevClk = false;
    const resReset = FlipFlopJKDefinition.evaluateLiveBehavior!({ 0: 0, 1: 5, 2: 5, 3: 5 }, comp);
    expect(resReset.dynamicState?.q).toBe(false);
    expect(resReset.dynamicState?.qNot).toBe(true);

    // 4. Toggle: J=1, K=1, Flanco de reloj -> Q = 1 (invierte de 0 a 1)
    comp.sequentialState!.prevClk = false;
    const resToggle1 = FlipFlopJKDefinition.evaluateLiveBehavior!({ 0: 5, 1: 5, 2: 5, 3: 5 }, comp);
    expect(resToggle1.dynamicState?.q).toBe(true);
    expect(resToggle1.dynamicState?.qNot).toBe(false);

    // 5. Toggle de nuevo: J=1, K=1, Flanco de reloj -> Q = 0 (invierte de 1 a 0)
    comp.sequentialState!.prevClk = false;
    const resToggle2 = FlipFlopJKDefinition.evaluateLiveBehavior!({ 0: 5, 1: 5, 2: 5, 3: 5 }, comp);
    expect(resToggle2.dynamicState?.q).toBe(false);
    expect(resToggle2.dynamicState?.qNot).toBe(true);
  });

  it("Evalúa decodificación numérica del Decodificador BCD a 7 Segmentos (74HC47)", () => {
    const comp: ComponentInstance = {
      id: "U1",
      type: "bcd_to_7seg",
      x: 0,
      y: 0,
      rotation: 0,
      value: 5.0,
    };

    // 1. BCD = 0 (A=0, B=0, C=0, D=0) -> a,b,c,d,e,f encendidos, g apagado
    const res0 = BcdTo7SegDefinition.evaluateLiveBehavior!({ 0: 0, 1: 0, 2: 0, 3: 0 }, comp);
    expect(res0.dynamicState?.bcdVal).toBe(0);
    expect(res0.dynamicState?.segOutputs.a).toBe(true);
    expect(res0.dynamicState?.segOutputs.b).toBe(true);
    expect(res0.dynamicState?.segOutputs.c).toBe(true);
    expect(res0.dynamicState?.segOutputs.d).toBe(true);
    expect(res0.dynamicState?.segOutputs.e).toBe(true);
    expect(res0.dynamicState?.segOutputs.f).toBe(true);
    expect(res0.dynamicState?.segOutputs.g).toBe(false);

    // 2. BCD = 1 (A=1, B=0, C=0, D=0) -> b,c encendidos
    const res1 = BcdTo7SegDefinition.evaluateLiveBehavior!({ 0: 5, 1: 0, 2: 0, 3: 0 }, comp);
    expect(res1.dynamicState?.bcdVal).toBe(1);
    expect(res1.dynamicState?.segOutputs.b).toBe(true);
    expect(res1.dynamicState?.segOutputs.c).toBe(true);
    expect(res1.dynamicState?.segOutputs.a).toBe(false);

    // 3. BCD = 8 (A=0, B=0, C=0, D=1 -> 8) -> Todos los 7 segmentos encendidos
    const res8 = BcdTo7SegDefinition.evaluateLiveBehavior!({ 0: 0, 1: 0, 2: 0, 3: 5 }, comp);
    expect(res8.dynamicState?.bcdVal).toBe(8);
    expect(res8.dynamicState?.segOutputs.a).toBe(true);
    expect(res8.dynamicState?.segOutputs.g).toBe(true);

    // 4. BCD = 9 (A=1, B=0, C=0, D=1 -> 9) -> a,b,c,d,f,g encendidos, e apagado
    const res9 = BcdTo7SegDefinition.evaluateLiveBehavior!({ 0: 5, 1: 0, 2: 0, 3: 5 }, comp);
    expect(res9.dynamicState?.bcdVal).toBe(9);
    expect(res9.dynamicState?.segOutputs.e).toBe(false);
    expect(res9.dynamicState?.segOutputs.g).toBe(true);
  });

  it("Evalúa desplazamiento serie y cerrojo de almacenamiento en el 74HC595", () => {
    const comp: ComponentInstance = {
      id: "U1",
      type: "shift_register_595",
      x: 0,
      y: 0,
      rotation: 0,
      value: 5.0,
      sequentialState: { shiftReg: 0, latchReg: 0, prevSrclk: false, prevRclk: false },
    };

    // 1. Desplazar bit '1' con pulso en SRCLK (SER = 5V, SRCLK = 5V, RCLK = 0V, OE = 0V, SRCLR = 5V)
    ShiftRegister595Definition.evaluateLiveBehavior!({ 0: 5, 1: 5, 2: 0, 3: 0, 4: 5 }, comp);
    expect(comp.sequentialState?.shiftReg).toBe(1);
    expect(comp.sequentialState?.latchReg).toBe(0); // Latch aún no actualizado

    // 2. Bajar reloj de desplazamiento
    ShiftRegister595Definition.evaluateLiveBehavior!({ 0: 5, 1: 0, 2: 0, 3: 0, 4: 5 }, comp);

    // 3. Desplazar otro bit '1'
    ShiftRegister595Definition.evaluateLiveBehavior!({ 0: 5, 1: 5, 2: 0, 3: 0, 4: 5 }, comp);
    expect(comp.sequentialState?.shiftReg).toBe(3); // (1 << 1) | 1 = 3 (0b00000011)

    // 4. Pulso en RCLK para transferir al latch de salida
    const resLatch = ShiftRegister595Definition.evaluateLiveBehavior!({ 0: 0, 1: 0, 2: 5, 3: 0, 4: 5 }, comp);
    expect(resLatch.dynamicState?.latchReg).toBe(3);

    // Salidas Q0 y Q1 deben entregar corriente hacia la carga (bit 1)
    expect(resLatch.branchCurrents[5]).toBeGreaterThan(0); // Q0
    expect(resLatch.branchCurrents[6]).toBeGreaterThan(0); // Q1
    expect(resLatch.branchCurrents[7]).toBe(0); // Q2 = 0V
  });

  it("Renderiza símbolos vectoriales en Canvas 2D para los 4 componentes secuenciales", () => {
    const createMockCtx = () => ({
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      rect: vi.fn(),
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

    const compD: ComponentInstance = { id: "U1", type: "flipflop_d", x: 0, y: 0, rotation: 0, value: 5 };
    FlipFlopDDefinition.render(ctx, compD, state, options);
    expect(ctx.rect).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith("74HC74", expect.any(Number), expect.any(Number));

    const compJK: ComponentInstance = { id: "U2", type: "flipflop_jk", x: 0, y: 0, rotation: 0, value: 5 };
    FlipFlopJKDefinition.render(ctx, compJK, state, options);
    expect(ctx.fillText).toHaveBeenCalledWith("74HC73", expect.any(Number), expect.any(Number));

    const compBcd: ComponentInstance = { id: "U3", type: "bcd_to_7seg", x: 0, y: 0, rotation: 0, value: 5 };
    BcdTo7SegDefinition.render(ctx, compBcd, state, options);
    expect(ctx.fillText).toHaveBeenCalledWith("74HC47", expect.any(Number), expect.any(Number));

    const comp595: ComponentInstance = { id: "U4", type: "shift_register_595", x: 0, y: 0, rotation: 0, value: 5 };
    ShiftRegister595Definition.render(ctx, comp595, state, options);
    expect(ctx.fillText).toHaveBeenCalledWith("74HC595", expect.any(Number), expect.any(Number));
  });
});
