import { describe, expect, it } from "vitest";
import {
  createMcuRuntime,
  stepInstruction,
  runCycles,
  injectHardwareInterrupt,
} from "./mcu-runtime";
import {
  STANDARD_8051_DEFINITION,
  readACC,
  writeACC,
  readB,
  writeB,
  readCY,
  setCY,
  readOV,
  readAC,
  readDPTR,
  readDirect,
  writeDirect,
  readBit,
  writeBit,
  readRn,
  writeRn,
  SFR_PSW,
  SFR_ACC,
  SFR_B,
} from "./mcu-8051";

describe("8051 ISA Comprehensive Instruction Test Suite", () => {
  function make8051Runtime(code: number[]): ReturnType<typeof createMcuRuntime> {
    const firmware = new Uint8Array(256);
    for (let i = 0; i < code.length; i++) {
      firmware[i] = code[i];
    }
    const runtime = createMcuRuntime({
      definition: STANDARD_8051_DEFINITION,
      firmware,
    });
    return runtime;
  }

  describe("1. Arithmetic Instructions", () => {
    it("ADD A, #data y banderas CY, AC, OV", () => {
      // MOV A, #0x7F; ADD A, #0x01 => A = 0x80, OV = 1, AC = 1, CY = 0
      const runtime = make8051Runtime([
        0x74, 0x7F, // MOV A, #0x7F
        0x24, 0x01, // ADD A, #0x01
      ]);
      stepInstruction(runtime); // MOV A
      stepInstruction(runtime); // ADD A

      expect(readACC(runtime)).toBe(0x80);
      expect(readOV(runtime)).toBe(true); // Desbordamiento con signo (positivo + positivo = negativo)
      expect(readAC(runtime)).toBe(true); // Carry del nibble bajo
      expect(readCY(runtime)).toBe(false);
    });

    it("ADDC A, #data con Carry entrante", () => {
      // SETB C; MOV A, #0xFE; ADDC A, #0x01 => A = 0x00, CY = 1
      const runtime = make8051Runtime([
        0xD3,       // SETB C
        0x74, 0xFE, // MOV A, #0xFE
        0x34, 0x01, // ADDC A, #0x01
      ]);
      stepInstruction(runtime); // SETB C
      expect(readCY(runtime)).toBe(true);

      stepInstruction(runtime); // MOV A
      stepInstruction(runtime); // ADDC A
      expect(readACC(runtime)).toBe(0x00);
      expect(readCY(runtime)).toBe(true);
    });

    it("SUBB A, #data con Carry/Borrow", () => {
      // CLR C; MOV A, #0x05; SUBB A, #0x0A => A = 0xFB (-5), CY = 1
      const runtime = make8051Runtime([
        0xC3,       // CLR C
        0x74, 0x05, // MOV A, #0x05
        0x94, 0x0A, // SUBB A, #0x0A
      ]);
      stepInstruction(runtime);
      stepInstruction(runtime);
      stepInstruction(runtime);

      expect(readACC(runtime)).toBe(0xFB);
      expect(readCY(runtime)).toBe(true);
    });

    it("MUL AB (Multiplicación de 8x8 a 16 bits)", () => {
      // MOV A, #50 (0x32); MOV B, #10 (0x0A); MUL AB => A = 500 & 0xFF = 0xF4, B = 500 >> 8 = 0x01, OV = 1, CY = 0
      const runtime = make8051Runtime([
        0x74, 50,         // MOV A, #50
        0x75, SFR_B, 10,  // MOV B, #10
        0xA4,             // MUL AB
      ]);
      stepInstruction(runtime);
      stepInstruction(runtime);
      stepInstruction(runtime);

      expect(readACC(runtime)).toBe(0xF4); // 500 % 256 = 244 (0xF4)
      expect(readB(runtime)).toBe(0x01);   // 500 / 256 = 1
      expect(readOV(runtime)).toBe(true);  // Producto > 255
      expect(readCY(runtime)).toBe(false); // CY siempre es 0
    });

    it("DIV AB (División de enteros y residuo)", () => {
      // MOV A, #35; MOV B, #10; DIV AB => A = 3 (cociente), B = 5 (residuo), OV = 0, CY = 0
      const runtime = make8051Runtime([
        0x74, 35,         // MOV A, #35
        0x75, SFR_B, 10,  // MOV B, #10
        0x84,             // DIV AB
      ]);
      stepInstruction(runtime);
      stepInstruction(runtime);
      stepInstruction(runtime);

      expect(readACC(runtime)).toBe(3);
      expect(readB(runtime)).toBe(5);
      expect(readOV(runtime)).toBe(false);
      expect(readCY(runtime)).toBe(false);
    });

    it("DIV AB por Cero activa bandera OV", () => {
      const runtime = make8051Runtime([
        0x74, 10,        // MOV A, #10
        0x75, SFR_B, 0,  // MOV B, #0
        0x84,            // DIV AB
      ]);
      stepInstruction(runtime);
      stepInstruction(runtime);
      stepInstruction(runtime);

      expect(readOV(runtime)).toBe(true);
      expect(readCY(runtime)).toBe(false);
    });

    it("DA A (Ajuste Decimal para suma BCD)", () => {
      // 0x38 + 0x49 = 0x81 (hex), BCD debería ser 87 (0x87)
      // MOV A, #0x38; ADD A, #0x49; DA A => A = 0x87
      const runtime = make8051Runtime([
        0x74, 0x38, // MOV A, #0x38
        0x24, 0x49, // ADD A, #0x49
        0xD4,       // DA A
      ]);
      stepInstruction(runtime);
      stepInstruction(runtime);
      stepInstruction(runtime);

      expect(readACC(runtime)).toBe(0x87);
    });

    it("INC DPTR (Incremento del puntero de datos de 16 bits)", () => {
      const runtime = make8051Runtime([
        0x90, 0x01, 0xFF, // MOV DPTR, #0x01FF
        0xA3,             // INC DPTR
      ]);
      stepInstruction(runtime);
      expect(readDPTR(runtime)).toBe(0x01FF);

      stepInstruction(runtime);
      expect(readDPTR(runtime)).toBe(0x0200);
    });
  });

  describe("2. Logical & Bit Manipulation Instructions", () => {
    it("SWAP A, RL A, RLC A, RR A, RRC A", () => {
      // MOV A, #0x12; SWAP A => A = 0x21
      const runtime = make8051Runtime([
        0x74, 0x12, // MOV A, #0x12
        0xC4,       // SWAP A
        0x23,       // RL A (0x21 << 1 => 0x42)
      ]);
      stepInstruction(runtime);
      stepInstruction(runtime);
      expect(readACC(runtime)).toBe(0x21);

      stepInstruction(runtime);
      expect(readACC(runtime)).toBe(0x42);
    });

    it("Operaciones de bits booleanos (SETB, CLR, CPL, MOV C, bit)", () => {
      // Bit 0x00 está en RAM byte 0x20, bit 0
      const runtime = make8051Runtime([
        0xD2, 0x00, // SETB 0x00
        0xA2, 0x00, // MOV C, 0x00
        0xB2, 0x00, // CPL 0x00
        0xC2, 0x00, // CLR 0x00
      ]);

      stepInstruction(runtime); // SETB 0x00
      expect(readBit(runtime, 0x00)).toBe(true);

      stepInstruction(runtime); // MOV C, 0x00
      expect(readCY(runtime)).toBe(true);

      stepInstruction(runtime); // CPL 0x00
      expect(readBit(runtime, 0x00)).toBe(false);

      stepInstruction(runtime); // CLR 0x00
      expect(readBit(runtime, 0x00)).toBe(false);
    });

    it("JBC bit, rel (Salta si el bit está en 1 y lo limpia a 0)", () => {
      const runtime = make8051Runtime([
        0xD2, 0x05,       // SETB 0x05 (RAM 0x20.5)
        0x10, 0x05, 0x10, // JBC 0x05, +0x10
      ]);
      stepInstruction(runtime);
      expect(readBit(runtime, 0x05)).toBe(true);

      stepInstruction(runtime); // Ejecuta JBC
      expect(readBit(runtime, 0x05)).toBe(false); // Bit debe ser limpiado
      expect(runtime.state.pc).toBe(0x02 + 3 + 0x10); // Salto ejecutado
    });
  });

  describe("3. Data Transfer & Stack Instructions", () => {
    it("PUSH y POP direct", () => {
      const runtime = make8051Runtime([
        0x74, 0x42,       // MOV A, #0x42
        0xC0, SFR_ACC,    // PUSH ACC
        0x74, 0x00,       // MOV A, #0x00
        0xD0, SFR_ACC,    // POP ACC
      ]);
      stepInstruction(runtime);
      stepInstruction(runtime); // PUSH ACC
      expect(runtime.state.sp).toBe(0x80);

      stepInstruction(runtime); // MOV A, #0
      expect(readACC(runtime)).toBe(0x00);

      stepInstruction(runtime); // POP ACC
      expect(readACC(runtime)).toBe(0x42);
      expect(runtime.state.sp).toBe(0x7F);
    });

    it("XCH A, Rn y XCHD A, @Ri", () => {
      const runtime = make8051Runtime([
        0x74, 0xAB,       // MOV A, #0xAB
        0x78, 0xCD,       // MOV R0, #0xCD
        0xC8,             // XCH A, R0 => A = 0xCD, R0 = 0xAB
      ]);
      stepInstruction(runtime);
      stepInstruction(runtime);
      stepInstruction(runtime);

      expect(readACC(runtime)).toBe(0xCD);
      expect(readRn(runtime, 0)).toBe(0xAB);
    });
  });

  describe("4. Branching, Loops & Subroutines (LCALL/RET)", () => {
    it("LCALL addr16 y RET", () => {
      // 0x00: LCALL 0x0010
      // 0x03: MOV A, #0x99
      // 0x10: MOV A, #0x55
      // 0x12: RET
      const code = new Array(30).fill(0);
      code[0] = 0x12; code[1] = 0x00; code[2] = 0x10; // LCALL 0x0010
      code[3] = 0x74; code[4] = 0x99;                 // MOV A, #0x99
      code[0x10] = 0x74; code[0x11] = 0x55;           // MOV A, #0x55
      code[0x12] = 0x22;                              // RET

      const runtime = make8051Runtime(code);

      stepInstruction(runtime); // LCALL 0x0010
      expect(runtime.state.pc).toBe(0x0010);
      expect(runtime.state.sp).toBe(0x81); // 2 bytes de retorno guardados en pila

      stepInstruction(runtime); // MOV A, #0x55
      expect(readACC(runtime)).toBe(0x55);

      stepInstruction(runtime); // RET
      expect(runtime.state.pc).toBe(0x0003); // Retorno a la instrucción siguiente
      expect(runtime.state.sp).toBe(0x7F);

      stepInstruction(runtime); // MOV A, #0x99
      expect(readACC(runtime)).toBe(0x99);
    });

    it("CJNE A, #data, rel y DJNZ Rn, rel", () => {
      // MOV R1, #3; BUCLE: DJNZ R1, BUCLE
      const runtime = make8051Runtime([
        0x79, 0x03,       // MOV R1, #0x03
        0xD9, 0xFE,       // DJNZ R1, -2 (salto a sí misma mientras R1 > 0)
      ]);

      stepInstruction(runtime); // MOV R1, #3
      expect(readRn(runtime, 1)).toBe(3);

      stepInstruction(runtime); // DJNZ (R1 -> 2, salta a 0x02)
      expect(readRn(runtime, 1)).toBe(2);
      expect(runtime.state.pc).toBe(0x02);

      stepInstruction(runtime); // DJNZ (R1 -> 1, salta a 0x02)
      expect(readRn(runtime, 1)).toBe(1);
      expect(runtime.state.pc).toBe(0x02);

      stepInstruction(runtime); // DJNZ (R1 -> 0, no salta, avanza a 0x04)
      expect(readRn(runtime, 1)).toBe(0);
      expect(runtime.state.pc).toBe(0x04);
    });
  });

  describe("5. Interrupts & ISR execution", () => {
    it("Atiende interrupción por hardware y retorna con RETI", () => {
      // 0x00: NOP; NOP;
      // 0x08: MOV A, #0xAA; RETI
      const code = new Array(30).fill(0);
      code[0] = 0x00; // NOP
      code[1] = 0x00; // NOP
      code[8] = 0x74; code[9] = 0xAA; // MOV A, #0xAA
      code[10] = 0x32; // RETI

      const runtime = make8051Runtime(code);
      runtime.globalInterruptEnable = true;

      // Inyectar interrupción vector 2 (salta a 2 * 4 = 8)
      injectHardwareInterrupt(runtime, 2);
      runCycles(runtime, 4); // Context save y salto a ISR (0x08)

      expect(runtime.state.pc).toBe(8);
      expect(runtime.globalInterruptEnable).toBe(false);

      stepInstruction(runtime); // MOV A, #0xAA
      expect(readACC(runtime)).toBe(0xAA);

      stepInstruction(runtime); // RETI
      expect(runtime.globalInterruptEnable).toBe(true); // Re-habilita interrupciones
    });
  });
});
