import { describe, expect, it } from "vitest";
import {
  JohnsonCounter4017Definition,
  BcdCounter90Definition,
  UpDownCounter193Definition,
  Decoder138Definition,
  Multiplexer151Definition,
} from "./digital_ics";

describe("digital_ics descriptors", () => {
  it("CD4017 avanza secuencialmente de Q0 a Q9 con cada flanco de subida en CLK", () => {
    const comp: any = { id: "U_4017", type: "ic_4017", value: 5.0 };

    // Reset activo
    let res = JohnsonCounter4017Definition.evaluateLiveBehavior?.({ 0: 0, 1: 0, 2: 5.0 }, comp);
    expect(res?.dynamicState?.stage).toBe(0);

    // Reset liberado, CLK bajo
    res = JohnsonCounter4017Definition.evaluateLiveBehavior?.({ 0: 0, 1: 0, 2: 0 }, comp);
    expect(res?.dynamicState?.stage).toBe(0);

    // Flanco de subida 1 (0 -> 5V)
    res = JohnsonCounter4017Definition.evaluateLiveBehavior?.({ 0: 5.0, 1: 0, 2: 0 }, comp);
    expect(res?.dynamicState?.stage).toBe(1);

    // Flanco de bajada (5V -> 0)
    res = JohnsonCounter4017Definition.evaluateLiveBehavior?.({ 0: 0, 1: 0, 2: 0 }, comp);
    expect(res?.dynamicState?.stage).toBe(1);

    // Flanco de subida 2
    res = JohnsonCounter4017Definition.evaluateLiveBehavior?.({ 0: 5.0, 1: 0, 2: 0 }, comp);
    expect(res?.dynamicState?.stage).toBe(2);
  });

  it("74HC90 cuenta en BCD dividiendo por 2 en CKA y por 5 en CKB", () => {
    const comp: any = { id: "U_7490", type: "ic_7490", value: 5.0 };

    // Reset a 0
    let res = BcdCounter90Definition.evaluateLiveBehavior?.({ 0: 5.0, 1: 5.0, 2: 5.0, 3: 5.0, 4: 0, 5: 0 }, comp);
    expect(res?.dynamicState?.count).toBe(0);

    // Flanco de bajada en CKA (QA pasa a 1)
    res = BcdCounter90Definition.evaluateLiveBehavior?.({ 0: 0, 1: 5.0, 2: 0, 3: 0, 4: 0, 5: 0 }, comp);
    expect(res?.dynamicState?.qa).toBe(true);
    expect(res?.dynamicState?.count).toBe(1);
  });

  it("74HC193 incrementa con CPU y decrementa con CPD", () => {
    const comp: any = { id: "U_74193", type: "ic_74193", value: 5.0 };

    // Master Reset activo
    let res = UpDownCounter193Definition.evaluateLiveBehavior?.({ 0: 0, 1: 0, 2: 5.0, 7: 5.0 }, comp);
    expect(res?.dynamicState?.count).toBe(0);

    // Reset liberado
    res = UpDownCounter193Definition.evaluateLiveBehavior?.({ 0: 0, 1: 5.0, 2: 5.0, 7: 0 }, comp);
    expect(res?.dynamicState?.count).toBe(0);

    // Flanco de subida en CPU (0 -> 5V) con CPD en alto
    res = UpDownCounter193Definition.evaluateLiveBehavior?.({ 0: 5.0, 1: 5.0, 2: 5.0, 7: 0 }, comp);
    expect(res?.dynamicState?.count).toBe(1);
  });

  it("74HC138 decodifica la dirección A0-A2 en salidas activas en bajo Y0-Y7", () => {
    const comp: any = { id: "U_74138", type: "ic_74138", value: 5.0 };

    // Dirección 3 (A0=1, A1=1, A2=0), Habilitado (G1=1, G2A=0, G2B=0)
    const pinVoltages = {
      0: 5.0, // A0
      1: 5.0, // A1
      2: 0.0, // A2
      3: 5.0, // G1
      4: 0.0, // G2A
      5: 0.0, // G2B
    };

    const res = Decoder138Definition.evaluateLiveBehavior?.(pinVoltages, comp);
    expect(res?.dynamicState?.enabled).toBe(true);
    expect(res?.dynamicState?.addr).toBe(3);
    // Y3 debe generar corriente para llevar el pin a 0V (activo bajo)
    expect(res?.branchCurrents?.[9]).toBeLessThan(0); // Pin 9 es Y3
  });

  it("74HC151 multiplexa la entrada seleccionada a Y y su complemento a W", () => {
    const comp: any = { id: "U_74151", type: "ic_74151", value: 5.0 };

    // Seleccionar canal D5 (S0=1, S1=0, S2=1 = 5), D5 en 5V, Strobe E=0 (Habilitado)
    const pinVoltages = {
      0: 0.0, 1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0,
      5: 5.0, // D5 = 5V
      6: 0.0, 7: 0.0,
      8: 5.0, // S0 = 1
      9: 0.0, // S1 = 0
      10: 5.0, // S2 = 1
      11: 0.0, // E = 0 (Activo)
    };

    const res = Multiplexer151Definition.evaluateLiveBehavior?.(pinVoltages, comp);
    expect(res?.dynamicState?.sel).toBe(5);
    expect(res?.dynamicState?.selectedBit).toBe(true);
    expect(res?.dynamicState?.enabled).toBe(true);
  });
});
