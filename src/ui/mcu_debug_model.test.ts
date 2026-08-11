import { describe, expect, it } from "vitest";
import {
  parseIntelHex,
  translateInstructionToSpanish,
} from "./mcu_debug_model";

describe("mcu_debug_model", () => {
  it("parsea registros Intel HEX de datos dentro de flashSize", () => {
    const flash = parseIntelHex([
      ":0400010001020304F1",
      ":00000001FF",
    ].join("\n"), 5);

    expect(Array.from(flash)).toEqual([0, 1, 2, 3, 4]);
  });

  it("ignora lineas que no son records Intel HEX", () => {
    const flash = parseIntelHex("comentario\n:01000000AA55\n:00000001FF", 2);
    expect(Array.from(flash)).toEqual([0xAA, 0]);
  });

  it("rechaza checksums inválidos y escrituras fuera de flash", () => {
    expect(() => parseIntelHex(":01000000AA54\n:00000001FF", 2)).toThrow(/Checksum/);
    expect(() => parseIntelHex(":01000200AA53\n:00000001FF", 2)).toThrow(/fuera de la flash/);
  });

  it("soporta direcciones lineales extendidas", () => {
    const flash = parseIntelHex([
      ":020000040001F9",
      ":01000000AA55",
      ":00000001FF",
    ].join("\n"), 0x10001);

    expect(flash[0x10000]).toBe(0xAA);
  });

  it("traduce instrucciones comunes de 8051", () => {
    expect(translateInstructionToSpanish("MOV A,#01H")).toContain("Mueve/Copia");
    expect(translateInstructionToSpanish("JNZ LOOP")).toContain("diferente de cero");
    expect(translateInstructionToSpanish("LDI R16,0x01")).toContain("valor inmediato");
    expect(translateInstructionToSpanish("FOO BAR")).toContain("Ejecuta la instruccion 'FOO'");
  });
});
