import { describe, expect, it } from "vitest";
import {
  parseIntelHex,
  translateInstructionToSpanish,
} from "./mcu_debug_model";

describe("mcu_debug_model", () => {
  it("parsea registros Intel HEX de datos y respeta flashSize", () => {
    const flash = parseIntelHex([
      ":0400020001020304F0",
      ":00000001FF",
    ].join("\n"), 5);

    expect(Array.from(flash)).toEqual([0, 0, 1, 2, 3]);
  });

  it("ignora lineas que no son records Intel HEX", () => {
    const flash = parseIntelHex("comentario\n:01000000AA55", 2);
    expect(Array.from(flash)).toEqual([0xAA, 0]);
  });

  it("traduce instrucciones comunes de 8051", () => {
    expect(translateInstructionToSpanish("MOV A,#01H")).toContain("Mueve/Copia");
    expect(translateInstructionToSpanish("JNZ LOOP")).toContain("diferente de cero");
    expect(translateInstructionToSpanish("LDI R16,0x01")).toContain("valor inmediato");
    expect(translateInstructionToSpanish("FOO BAR")).toContain("Ejecuta la instruccion 'FOO'");
  });
});
