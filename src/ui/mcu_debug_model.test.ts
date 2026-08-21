import { describe, expect, it } from "vitest";
import {
  parseIntelHex,
  translateInstructionToSpanish,
  evaluateWatchExpression,
  formatMemoryDump,
  stepUntilBreakpoint,
  stepOver,
} from "./mcu_debug_model";
import {
  createMcuRuntime,
  STANDARD_8051_DEFINITION,
  ATMEGA328P_DEFINITIONS,
  writeACC,
  writeB,
  setCY,
} from "../simulation";

describe("mcu_debug_model", () => {
  describe("1. Intel HEX Parser & ASM Translator", () => {
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

  describe("2. Watch Expressions Evaluator", () => {
    it("evalúa registros y banderas de 8051 (ACC, B, PSW.CY, RAM)", () => {
      const runtime = createMcuRuntime({
        definition: STANDARD_8051_DEFINITION,
      });

      writeACC(runtime, 0x42);
      writeB(runtime, 0x10);
      setCY(runtime, true);
      runtime.memory.ram[0x20] = 0xAA;

      const watchAcc = evaluateWatchExpression("ACC", runtime);
      expect(watchAcc.valid).toBe(true);
      expect(watchAcc.formattedHex).toBe("0x42");
      expect(watchAcc.formattedDec).toBe("66");

      const watchB = evaluateWatchExpression("B", runtime);
      expect(watchB.value).toBe(0x10);

      const watchCy = evaluateWatchExpression("PSW.CY", runtime);
      expect(watchCy.value).toBe(1);

      const watchRam = evaluateWatchExpression("RAM[0x20]", runtime);
      expect(watchRam.value).toBe(0xAA);
      expect(watchRam.formattedHex).toBe("0xAA");
    });

    it("evalúa registros y banderas de AVR (R16, SREG.Z, SP, X)", () => {
      const runtime = createMcuRuntime({
        definition: ATMEGA328P_DEFINITIONS,
      });

      runtime.memory.ram[16] = 0x55; // R16
      runtime.state.sp = 0x08FF;

      const watchR16 = evaluateWatchExpression("R16", runtime);
      expect(watchR16.valid).toBe(true);
      expect(watchR16.formattedHex).toBe("0x55");

      const watchSp = evaluateWatchExpression("SP", runtime);
      expect(watchSp.formattedHex).toBe("0x08FF");
    });
  });

  describe("3. Memory Hex Dump Formatter", () => {
    it("formatea volcado de memoria con dirección, hex y ASCII", () => {
      const mem = new Uint8Array(32);
      mem[0] = 0x48; // 'H'
      mem[1] = 0x69; // 'i'
      mem[2] = 0x21; // '!'

      const rows = formatMemoryDump(mem, 0, 32);
      expect(rows.length).toBe(2);
      expect(rows[0].addressHex).toBe("0000");
      expect(rows[0].hexStrings[0]).toBe("48");
      expect(rows[0].hexStrings[1]).toBe("69");
      expect(rows[0].ascii.startsWith("Hi!")).toBe(true);
    });
  });

  describe("4. Breakpoints and Step Over Debugging", () => {
    it("stepUntilBreakpoint se detiene exactamente en el breakpoint configurado", () => {
      // 8051 firmware: 3 NOPs
      const firmware = new Uint8Array([0x00, 0x00, 0x00]);
      const runtime = createMcuRuntime({
        definition: STANDARD_8051_DEFINITION,
        firmware,
      });

      const bps = new Set([2]); // Breakpoint en PC=2
      const res = stepUntilBreakpoint(runtime, bps, 10);

      expect(res.hitBreakpoint).toBe(true);
      expect(runtime.state.pc).toBe(2);
      expect(res.stepsExecuted).toBe(2);
    });

    it("stepOver ejecuta subrutina completa hasta retornar a la instrucción siguiente", () => {
      // 0x00: LCALL 0x0006 (3 bytes: 0x12 0x00 0x06)
      // 0x03: NOP
      // 0x06: NOP; RET (0x22)
      const firmware = new Uint8Array(20);
      firmware[0] = 0x12; firmware[1] = 0x00; firmware[2] = 0x06; // LCALL 0x0006
      firmware[3] = 0x00; // NOP
      firmware[6] = 0x00; // NOP
      firmware[7] = 0x22; // RET

      const runtime = createMcuRuntime({
        definition: STANDARD_8051_DEFINITION,
        firmware,
      });

      // Ejecutar Step Over sobre LCALL
      const res = stepOver(runtime);
      expect(res.hitBreakpoint).toBe(false);
      expect(runtime.state.pc).toBe(3); // Debe volver a PC=3 tras completar la subrutina
    });
  });
});
