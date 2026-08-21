import { describe, expect, it } from "vitest";
import {
  createMcuRuntime,
  stepInstruction,
} from "./mcu-runtime";
import {
  ATMEGA328P,
  readReg,
  writeReg,
  readRegWord,
  readIoRegister,
  writeIoRegister,
  readDataSpace,
  writeDataSpace,
  getSregFlag,
  setSregFlag,
  readSP,
  writeSP,
  initAvrPeripheralsState,
  stepAvrPeripherals,
  IO_PORTB,
  IO_PINB,
  IO_TCCR0B,
  IO_TCNT0,
  IO_TIFR0,
  MEM_ADCSRA,
  MEM_ADCL,
  MEM_ADCH,
  MEM_UCSR0A,
  MEM_UCSR0B,
  MEM_WDTCSR,
  IO_SPCR,
  IO_SPSR,
  SREG_C,
  SREG_Z,
  SREG_N,
} from "./mcu-avr";

describe("AVR ATmega328P ISA & Peripherals Test Suite", () => {
  // Helper para generar runtime AVR con código en flash (palabras de 16 bits en little-endian)
  function makeAvrRuntime(opcodes: number[]): ReturnType<typeof createMcuRuntime> {
    const flashBytes = new Uint8Array(512);
    for (let i = 0; i < opcodes.length; i++) {
      const word = opcodes[i];
      flashBytes[i * 2] = word & 0xFF;         // Low byte
      flashBytes[i * 2 + 1] = (word >> 8) & 0xFF; // High byte
    }
    const runtime = createMcuRuntime({
      definition: ATMEGA328P,
      firmware: flashBytes,
    });
    // Inicializar SP en 0x08FF (tope de SRAM de ATmega328P)
    writeSP(runtime, 0x08FF);
    return runtime;
  }

  describe("1. Arithmetic, Logic & Register Instructions", () => {
    it("LDI (Load Immediate) y ADD (Addition con banderas SREG)", () => {
      // LDI R16, 0x30  => 0xE300
      // LDI R17, 0x25  => 0xE215
      // ADD R16, R17   => 0x0F01
      const runtime = makeAvrRuntime([
        0xE300, // LDI R16, 0x30
        0xE215, // LDI R17, 0x25
        0x0F01, // ADD R16, R17
      ]);

      stepInstruction(runtime); // LDI R16
      expect(readReg(runtime, 16)).toBe(0x30);

      stepInstruction(runtime); // LDI R17
      expect(readReg(runtime, 17)).toBe(0x25);

      stepInstruction(runtime); // ADD R16, R17
      expect(readReg(runtime, 16)).toBe(0x55);
      expect(getSregFlag(runtime, SREG_Z)).toBe(false);
      expect(getSregFlag(runtime, SREG_C)).toBe(false);
    });

    it("SUB y detección de Zero Flag (Z) y Carry Flag (C)", () => {
      // LDI R16, 0x10  => 0xE100
      // LDI R17, 0x10  => 0xE110
      // SUB R16, R17   => 0x1B01
      const runtime = makeAvrRuntime([
        0xE100, // LDI R16, 0x10
        0xE110, // LDI R17, 0x10
        0x1B01, // SUB R16, R17
      ]);

      stepInstruction(runtime);
      stepInstruction(runtime);
      stepInstruction(runtime);

      expect(readReg(runtime, 16)).toBe(0x00);
      expect(getSregFlag(runtime, SREG_Z)).toBe(true);
      expect(getSregFlag(runtime, SREG_C)).toBe(false);
    });

    it("MUL (Multiplicación sin signo a 16 bits en R1:R0)", () => {
      // LDI R16, 20   => 0xE104
      // LDI R17, 30   => 0xE11E
      // MUL R16, R17  => 0x9F01
      const runtime = makeAvrRuntime([
        0xE104, // LDI R16, 20
        0xE11E, // LDI R17, 30
        0x9F01, // MUL R16, R17 => 600 (0x0258) en R1:R0
      ]);

      stepInstruction(runtime);
      stepInstruction(runtime);
      stepInstruction(runtime);

      expect(readRegWord(runtime, 0)).toBe(600); // 20 * 30 = 600
    });

    it("MOVW (Copiar par de registros de 16 bits)", () => {
      // MOVW R24, R16 (R25:R24 = R17:R16) => 0x01C8
      const runtime = makeAvrRuntime([
        0x01C8, // MOVW R24, R16
      ]);
      writeReg(runtime, 16, 0xAA);
      writeReg(runtime, 17, 0x55);

      stepInstruction(runtime);
      expect(readReg(runtime, 24)).toBe(0xAA);
      expect(readReg(runtime, 25)).toBe(0x55);
    });
  });

  describe("2. I/O Ports & Bit Manipulation", () => {
    it("OUT e IN en registros de I/O", () => {
      // LDI R16, 0xFF => 0xEF0F
      // OUT PORTB, R16 => 0xB905 (IO 0x05)
      // IN R18, PORTB  => 0xB125
      const runtime = makeAvrRuntime([
        0xEF0F,
        0xB905,
        0xB125,
      ]);

      stepInstruction(runtime); // LDI R16
      stepInstruction(runtime); // OUT PORTB, R16
      expect(readIoRegister(runtime, IO_PORTB)).toBe(0xFF);

      stepInstruction(runtime); // IN R18, PORTB
      expect(readReg(runtime, 18)).toBe(0xFF);
    });

    it("SBI (Set Bit in I/O) y CBI (Clear Bit in I/O)", () => {
      // SBI PORTB, 5 => 0x9A2D (PortB = 0x05, Bit 5)
      // CBI PORTB, 5 => 0x982D
      const runtime = makeAvrRuntime([
        0x9A2D, // SBI PORTB, 5
        0x982D, // CBI PORTB, 5
      ]);

      writeIoRegister(runtime, IO_PORTB, 0x00);
      stepInstruction(runtime);
      expect(readIoRegister(runtime, IO_PORTB)).toBe(0x20); // Bit 5 = 1

      stepInstruction(runtime);
      expect(readIoRegister(runtime, IO_PORTB)).toBe(0x00); // Bit 5 = 0
    });
  });

  describe("3. Data Space & Stack Operations", () => {
    it("PUSH y POP en pila AVR (decremento y recuperación)", () => {
      // LDI R16, 0x88 => 0xE808
      // PUSH R16      => 0x930F
      // LDI R16, 0x00 => 0xE000
      // POP R17       => 0x911F
      const runtime = makeAvrRuntime([
        0xE808,
        0x930F,
        0xE000,
        0x911F,
      ]);

      stepInstruction(runtime); // LDI R16, 0x88
      const spBefore = readSP(runtime);

      stepInstruction(runtime); // PUSH R16
      expect(readSP(runtime)).toBe(spBefore - 1);
      expect(readDataSpace(runtime, spBefore)).toBe(0x88);

      stepInstruction(runtime); // LDI R16, 0x00
      expect(readReg(runtime, 16)).toBe(0x00);

      stepInstruction(runtime); // POP R17
      expect(readReg(runtime, 17)).toBe(0x88);
      expect(readSP(runtime)).toBe(spBefore);
    });
  });

  describe("4. Flow Control (RJMP, RCALL, RET)", () => {
    it("RCALL y RET con stack de retorno de 16 bits", () => {
      // PC=0: RCALL +2 (salta a PC=3) => 0xD002
      // PC=1: LDI R16, 0x99            => 0xE909
      // PC=2: NOP                      => 0x0000
      // PC=3: LDI R16, 0x55            => 0xE505
      // PC=4: RET                      => 0x9508
      const runtime = makeAvrRuntime([
        0xD002, // RCALL +2 (a PC=3)
        0xE909, // LDI R16, 0x99
        0x0000, // NOP
        0xE505, // LDI R16, 0x55
        0x9508, // RET
      ]);

      stepInstruction(runtime); // RCALL
      expect(runtime.state.pc).toBe(3);

      stepInstruction(runtime); // LDI R16, 0x55
      expect(readReg(runtime, 16)).toBe(0x55);

      stepInstruction(runtime); // RET
      expect(runtime.state.pc).toBe(1); // Regresa a PC=1

      stepInstruction(runtime); // LDI R16, 0x99
      expect(readReg(runtime, 16)).toBe(0x99);
    });
  });

  describe("5. ATmega328P Hardware Peripherals", () => {
    it("Timer0 conteo y bandera TOV0 en desbordamiento", () => {
      const runtime = makeAvrRuntime([0x0000]);
      const periph = initAvrPeripheralsState();

      // Configurar Timer0: TCCR0B = 0x01 (Prescaler = 1), TCNT0 = 0xFE
      writeDataSpace(runtime, 0x20 + IO_TCCR0B, 0x01);
      writeDataSpace(runtime, 0x20 + IO_TCNT0, 0xFE);

      stepAvrPeripherals(runtime, periph, 1); // TCNT0 -> 0xFF
      expect(readDataSpace(runtime, 0x20 + IO_TCNT0)).toBe(0xFF);

      stepAvrPeripherals(runtime, periph, 1); // TCNT0 -> 0x00 (Overflow!)
      expect(readDataSpace(runtime, 0x20 + IO_TCNT0)).toBe(0x00);
      expect((readDataSpace(runtime, 0x20 + IO_TIFR0) & 0x01)).toBe(0x01); // TOV0 activo
    });

    it("ADC inicio de conversión y bandera de completitud ADIF", () => {
      const runtime = makeAvrRuntime([0x0000]);
      const periph = initAvrPeripheralsState();

      // Iniciar ADC: ADCSRA = 0xC0 (ADEN=1, ADSC=1)
      writeDataSpace(runtime, MEM_ADCSRA, 0xC0);

      stepAvrPeripherals(runtime, periph, 30); // Ejecutar ciclos suficientes para conversión

      expect(periph.adcConverting).toBe(false);
      expect((readDataSpace(runtime, MEM_ADCSRA) & 0x10)).toBe(0x10); // ADIF activo
      expect(readDataSpace(runtime, MEM_ADCL)).toBe(0x00);
      expect(readDataSpace(runtime, MEM_ADCH)).toBe(0x02); // 512 = 0x0200
    });

    it("USART0 transmisor buffer UDRE0", () => {
      const runtime = makeAvrRuntime([0x0000]);
      const periph = initAvrPeripheralsState();

      // Habilitar TX: UCSR0B = 0x08 (TXEN0=1)
      writeDataSpace(runtime, MEM_UCSR0B, 0x08);
      stepAvrPeripherals(runtime, periph, 1);

      expect((readDataSpace(runtime, MEM_UCSR0A) & 0x20)).toBe(0x20); // UDRE0 activo
    });

    it("SPI transferencia de datos SPIF", () => {
      const runtime = makeAvrRuntime([0x0000]);
      const periph = initAvrPeripheralsState();

      // Habilitar SPI: SPCR = 0x40 (SPE=1)
      writeDataSpace(runtime, 0x20 + IO_SPCR, 0x40);
      stepAvrPeripherals(runtime, periph, 1);

      expect((readDataSpace(runtime, 0x20 + IO_SPSR) & 0x80)).toBe(0x80); // SPIF activo
    });
  });
});
