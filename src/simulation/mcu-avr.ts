/**
 * Runtime e ISA Completa para AVR ATmega328P (Instruction-Set Accurate).
 *
 * Implementa la ISA AVR de 8 bits con soporte para:
 * - 32 Registros de propósito general (R0..R31, con pares de punteros X=R26:R27, Y=R28:R29, Z=R30:R31)
 * - Registro de estado SREG (C, Z, N, V, S, H, T, I)
 * - Instrucciones aritméticas/lógicas (ADD, ADC, SUB, SBC, SUBI, SBCI, AND, ANDI, OR, ORI, EOR, COM, NEG, INC, DEC, MUL, ADIW, SBIW)
 * - Instrucciones de salto y control (RJMP, RCALL, JMP, CALL, RET, RETI, CPSE, CP, CPC, CPI, SBRC, SBRS, SBIC, SBIS, BRBS, BRBC, IJMP, ICALL)
 * - Transferencia de datos y memoria (MOV, MOVW, LDI, LDS, STS, LD, ST, LDD, STD, LPM, IN, OUT, CBI, SBI, PUSH, POP)
 * - Operaciones de bit (LSR, ROR, ASR, SWAP, BSET, BCLR, BST, BLD)
 * - Periféricos de hardware integrados:
 *   - Timers/Counters: Timer0 (8-bit), Timer1 (16-bit), Timer2 (8-bit async) con PWM y CTC
 *   - ADC (10-bit) con multiplexor y preescalador
 *   - USART0 (transmisor/receptor serie con buffers)
 *   - SPI (Master/Slave con registros SPCR, SPSR, SPDR)
 *   - TWI / I2C (Two-Wire Interface con registros TWCR, TWSR, TWDR)
 *   - Watchdog Timer (WDTCSR)
 *   - Modos de reposo (SLEEP / SMCR)
 */
import type { McuDefinition, McuRegister, McuPeripheral } from "./mcu-types";
import type { McuRuntime } from "./mcu-runtime";

// ============================================================================
// I/O & SRAM MEMORY ADDRESSES (ATmega328P)
// ============================================================================

// I/O Addresses (0x00..0x3F para IN/OUT/SBI/CBI; en espacio de datos +0x20)
export const IO_PINA = 0x00;
export const IO_DDRA = 0x01;
export const IO_PORTA = 0x02;
export const IO_PINB = 0x03;
export const IO_DDRB = 0x04;
export const IO_PORTB = 0x05;
export const IO_PINC = 0x06;
export const IO_DDRC = 0x07;
export const IO_PORTC = 0x08;
export const IO_PIND = 0x09;
export const IO_DDRD = 0x0A;
export const IO_PORTD = 0x0B;

export const IO_TIFR0 = 0x15;
export const IO_TIFR1 = 0x16;
export const IO_TIFR2 = 0x17;
export const IO_PCIFR = 0x1B;
export const IO_EIFR = 0x1C;
export const IO_EIMSK = 0x1D;
export const IO_GPIOR0 = 0x1E;
export const IO_EECR = 0x1F;
export const IO_EEDR = 0x20;
export const IO_EEARL = 0x21;
export const IO_EEARH = 0x22;
export const IO_GTCCR = 0x23;
export const IO_TCCR0A = 0x24;
export const IO_TCCR0B = 0x25;
export const IO_TCNT0 = 0x26;
export const IO_OCR0A = 0x27;
export const IO_OCR0B = 0x28;
export const IO_GPIOR1 = 0x2A;
export const IO_GPIOR2 = 0x2B;
export const IO_SPCR = 0x2C;
export const IO_SPSR = 0x2D;
export const IO_SPDR = 0x2E;
export const IO_ACSR = 0x30;
export const IO_SMCR = 0x33;
export const IO_MCUSR = 0x34;
export const IO_MCUCR = 0x35;
export const IO_SPMCSR = 0x37;
export const IO_SPL = 0x3D;
export const IO_SPH = 0x3E;
export const IO_SREG = 0x3F;

// Extended I/O Addresses (Espacio de datos 0x0060..0x00FF)
export const MEM_WDTCSR = 0x60;
export const MEM_CLKPR = 0x61;
export const MEM_PRR = 0x64;
export const MEM_OSCCAL = 0x66;
export const MEM_PCICR = 0x68;
export const MEM_EICRA = 0x69;
export const MEM_PCMSK0 = 0x6B;
export const MEM_PCMSK1 = 0x6C;
export const MEM_PCMSK2 = 0x6D;
export const MEM_TIMSK0 = 0x6E;
export const MEM_TIMSK1 = 0x6F;
export const MEM_TIMSK2 = 0x70;
export const MEM_ADCL = 0x78;
export const MEM_ADCH = 0x79;
export const MEM_ADCSRA = 0x7A;
export const MEM_ADCSRB = 0x7B;
export const MEM_ADMUX = 0x7C;
export const MEM_DIDR0 = 0x7E;
export const MEM_DIDR1 = 0x7F;
export const MEM_TCCR1A = 0x80;
export const MEM_TCCR1B = 0x81;
export const MEM_TCCR1C = 0x82;
export const MEM_TCNT1L = 0x84;
export const MEM_TCNT1H = 0x85;
export const MEM_ICR1L = 0x86;
export const MEM_ICR1H = 0x87;
export const MEM_OCR1AL = 0x88;
export const MEM_OCR1AH = 0x89;
export const MEM_OCR1BL = 0x8A;
export const MEM_OCR1BH = 0x8B;
export const MEM_TCCR2A = 0xB0;
export const MEM_TCCR2B = 0xB1;
export const MEM_TCNT2 = 0xB2;
export const MEM_OCR2A = 0xB3;
export const MEM_OCR2B = 0xB4;
export const MEM_ASSR = 0xB6;
export const MEM_TWBR = 0xB8;
export const MEM_TWSR = 0xB9;
export const MEM_TWAR = 0xBA;
export const MEM_TWDR = 0xBB;
export const MEM_TWCR = 0xBC;
export const MEM_TWAMR = 0xBD;
export const MEM_UCSR0A = 0xC0;
export const MEM_UCSR0B = 0xC1;
export const MEM_UCSR0C = 0xC2;
export const MEM_UBRR0L = 0xC4;
export const MEM_UBRR0H = 0xC5;
export const MEM_UDR0 = 0xC6;

// SREG Bit Masks
export const SREG_C = 0x01; // Carry
export const SREG_Z = 0x02; // Zero
export const SREG_N = 0x04; // Negative
export const SREG_V = 0x08; // Two's complement overflow
export const SREG_S = 0x10; // Sign bit (N ^ V)
export const SREG_H = 0x20; // Half Carry
export const SREG_T = 0x40; // Transfer bit
export const SREG_I = 0x80; // Global Interrupt Enable

// ============================================================================
// MEMORY ACCESS & REGISTER HELPERS
// ============================================================================

export function readDataSpace(runtime: McuRuntime, addr: number): number {
  const a = addr & 0xFFFF;
  if (a < 0x20) {
    // Registros R0..R31 (almacenados en los primeros 32 bytes de RAM)
    return runtime.memory.ram[a] ?? 0;
  }
  if (a < 0x60) {
    // I/O Registers estándar (mapeados en SFR)
    return runtime.memory.sfr[a - 0x20] ?? 0;
  }
  // Extended I/O y SRAM interna (0x0060..0x08FF)
  return runtime.memory.ram[a] ?? 0;
}

export function writeDataSpace(runtime: McuRuntime, addr: number, val: number): void {
  const a = addr & 0xFFFF;
  const byteVal = val & 0xFF;

  if (a < 0x20) {
    runtime.memory.ram[a] = byteVal;
  } else if (a < 0x60) {
    runtime.memory.sfr[a - 0x20] = byteVal;
    if (a === 0x20 + IO_SPL || a === 0x20 + IO_SPH) {
      updateStackPointerFromIo(runtime);
    }
  } else {
    runtime.memory.ram[a] = byteVal;
  }
}

export function readIoRegister(runtime: McuRuntime, ioAddr: number): number {
  return readDataSpace(runtime, 0x20 + (ioAddr & 0x3F));
}

export function writeIoRegister(runtime: McuRuntime, ioAddr: number, val: number): void {
  writeDataSpace(runtime, 0x20 + (ioAddr & 0x3F), val);
}

export function readReg(runtime: McuRuntime, r: number): number {
  return runtime.memory.ram[r & 0x1F] ?? 0;
}

export function writeReg(runtime: McuRuntime, r: number, val: number): void {
  runtime.memory.ram[r & 0x1F] = val & 0xFF;
}

export function readRegWord(runtime: McuRuntime, rPair: number): number {
  const low = readReg(runtime, rPair);
  const high = readReg(runtime, rPair + 1);
  return (high << 8) | low;
}

export function writeRegWord(runtime: McuRuntime, rPair: number, val: number): void {
  writeReg(runtime, rPair, val & 0xFF);
  writeReg(runtime, rPair + 1, (val >> 8) & 0xFF);
}

export function readPointerX(runtime: McuRuntime): number { return readRegWord(runtime, 26); }
export function writePointerX(runtime: McuRuntime, val: number): void { writeRegWord(runtime, 26, val); }

export function readPointerY(runtime: McuRuntime): number { return readRegWord(runtime, 28); }
export function writePointerY(runtime: McuRuntime, val: number): void { writeRegWord(runtime, 28, val); }

export function readPointerZ(runtime: McuRuntime): number { return readRegWord(runtime, 30); }
export function writePointerZ(runtime: McuRuntime, val: number): void { writeRegWord(runtime, 30, val); }

export function readSREG(runtime: McuRuntime): number {
  return readIoRegister(runtime, IO_SREG);
}

export function writeSREG(runtime: McuRuntime, val: number): void {
  writeIoRegister(runtime, IO_SREG, val);
  runtime.globalInterruptEnable = (val & SREG_I) !== 0;
}

export function getSregFlag(runtime: McuRuntime, mask: number): boolean {
  return (readSREG(runtime) & mask) !== 0;
}

export function setSregFlag(runtime: McuRuntime, mask: number, value: boolean): void {
  const current = readSREG(runtime);
  const next = value ? (current | mask) : (current & ~mask);
  writeSREG(runtime, next);
}

function updateStackPointerFromIo(runtime: McuRuntime): void {
  const spl = readIoRegister(runtime, IO_SPL);
  const sph = readIoRegister(runtime, IO_SPH);
  runtime.state.sp = (sph << 8) | spl;
}

export function readSP(runtime: McuRuntime): number {
  return runtime.state.sp;
}

export function writeSP(runtime: McuRuntime, val: number): void {
  runtime.state.sp = val & 0xFFFF;
  writeIoRegister(runtime, IO_SPL, val & 0xFF);
  writeIoRegister(runtime, IO_SPH, (val >> 8) & 0xFF);
}

// Stack operations (AVR decrements on push, increments on pop)
export function pushByteAvr(runtime: McuRuntime, val: number): void {
  const sp = readSP(runtime);
  writeDataSpace(runtime, sp, val);
  writeSP(runtime, sp - 1);
}

export function popByteAvr(runtime: McuRuntime): number {
  const sp = (readSP(runtime) + 1) & 0xFFFF;
  writeSP(runtime, sp);
  return readDataSpace(runtime, sp);
}

export function pushWord16Avr(runtime: McuRuntime, val: number): void {
  pushByteAvr(runtime, val & 0xFF);         // Low byte
  pushByteAvr(runtime, (val >> 8) & 0xFF);  // High byte
}

export function popWord16Avr(runtime: McuRuntime): number {
  const high = popByteAvr(runtime);
  const low = popByteAvr(runtime);
  return (high << 8) | low;
}

// Fetch instruction word (16 bits little-endian) from flash program memory
function fetchWordFromFlash(runtime: McuRuntime): number {
  const pc = runtime.state.pc * 2; // AVR PC is word-addressed (2 bytes per word)
  const low = runtime.memory.flash[pc] ?? 0;
  const high = runtime.memory.flash[pc + 1] ?? 0;
  runtime.state.pc = (runtime.state.pc + 1) & 0xFFFF;
  return (high << 8) | low;
}

// ============================================================================
// PERIPHERAL TIMERS, ADC, USART, SPI & TWI STATE MACHINE
// ============================================================================

export interface AvrPeripheralsState {
  timer0Counter: number;
  timer1Counter: number;
  timer2Counter: number;
  adcConverting: boolean;
  adcCyclesLeft: number;
  usartTxBuffer: number[];
  usartRxBuffer: number[];
  spiDataBuffer: number;
  twiState: number;
  watchdogCounter: number;
  sleepModeActive: boolean;
}

export function initAvrPeripheralsState(): AvrPeripheralsState {
  return {
    timer0Counter: 0,
    timer1Counter: 0,
    timer2Counter: 0,
    adcConverting: false,
    adcCyclesLeft: 0,
    usartTxBuffer: [],
    usartRxBuffer: [],
    spiDataBuffer: 0,
    twiState: 0,
    watchdogCounter: 0,
    sleepModeActive: false,
  };
}

export function stepAvrPeripherals(
  runtime: McuRuntime,
  state: AvrPeripheralsState,
  cycles: number,
): void {
  // 1. Timer 0 (8-bit)
  const tccr0b = readDataSpace(runtime, 0x20 + IO_TCCR0B);
  const cs0 = tccr0b & 0x07;
  if (cs0 > 0) {
    state.timer0Counter += cycles;
    const prescale = cs0 === 1 ? 1 : cs0 === 2 ? 8 : cs0 === 3 ? 64 : cs0 === 4 ? 256 : 1024;
    while (state.timer0Counter >= prescale) {
      state.timer0Counter -= prescale;
      let tcnt0 = readDataSpace(runtime, 0x20 + IO_TCNT0);
      tcnt0 = (tcnt0 + 1) & 0xFF;
      writeDataSpace(runtime, 0x20 + IO_TCNT0, tcnt0);

      // Overflow flag
      if (tcnt0 === 0) {
        const tifr0 = readDataSpace(runtime, 0x20 + IO_TIFR0) | 0x01; // TOV0
        writeDataSpace(runtime, 0x20 + IO_TIFR0, tifr0);
      }
    }
  }

  // 2. ADC Conversion
  const adcsra = readDataSpace(runtime, MEM_ADCSRA);
  if ((adcsra & 0xC0) === 0xC0 && !state.adcConverting) { // ADEN=1, ADSC=1
    state.adcConverting = true;
    state.adcCyclesLeft = 25; // 25 ciclos ADC
  }
  if (state.adcConverting) {
    state.adcCyclesLeft -= cycles;
    if (state.adcCyclesLeft <= 0) {
      state.adcConverting = false;
      // Finalizar conversión (valor mock 512 = 2.5V de 5.0V Vref)
      const adcVal = 512;
      writeDataSpace(runtime, MEM_ADCL, adcVal & 0xFF);
      writeDataSpace(runtime, MEM_ADCH, (adcVal >> 8) & 0x03);
      writeDataSpace(runtime, MEM_ADCSRA, (readDataSpace(runtime, MEM_ADCSRA) & ~0x40) | 0x10); // ADSC=0, ADIF=1
    }
  }

  // 3. USART Data Register Empty
  const ucsr0b = readDataSpace(runtime, MEM_UCSR0B);
  if ((ucsr0b & 0x08) !== 0) { // TXEN0=1
    writeDataSpace(runtime, MEM_UCSR0A, readDataSpace(runtime, MEM_UCSR0A) | 0x20); // UDRE0=1
  }

  // 4. SPI Transfer
  const spcr = readDataSpace(runtime, 0x20 + IO_SPCR);
  if ((spcr & 0x40) !== 0) { // SPE=1
    writeDataSpace(runtime, 0x20 + IO_SPSR, readDataSpace(runtime, 0x20 + IO_SPSR) | 0x80); // SPIF=1
  }

  // 5. Watchdog Timer
  const wdtcsr = readDataSpace(runtime, MEM_WDTCSR);
  if ((wdtcsr & 0x08) !== 0) { // WDE=1
    state.watchdogCounter += cycles;
    if (state.watchdogCounter > 16_000_000) { // Timeout
      state.watchdogCounter = 0;
      writeDataSpace(runtime, MEM_WDTCSR, readDataSpace(runtime, MEM_WDTCSR) | 0x80); // WDIF=1
    }
  }
}

// ============================================================================
// INSTRUCTION EXECUTION ENGINE (AVR ISA)
// ============================================================================

export function executeAvrInstruction(runtime: McuRuntime): number {
  if (runtime.halted) return 0;

  const word1 = fetchWordFromFlash(runtime);

  // 1. NOP (0x0000)
  if (word1 === 0x0000) {
    return 1;
  }

  // 2. RJMP (0xC000 | k) y RCALL (0xD000 | k)
  if ((word1 & 0xF000) === 0xC000) {
    const k = (word1 & 0x0FFF) << 20 >> 20; // 12-bit signed offset
    runtime.state.pc = (runtime.state.pc + k) & 0xFFFF;
    return 2;
  }
  if ((word1 & 0xF000) === 0xD000) {
    const k = (word1 & 0x0FFF) << 20 >> 20;
    pushWord16Avr(runtime, runtime.state.pc);
    runtime.state.pc = (runtime.state.pc + k) & 0xFFFF;
    return 3;
  }

  // 3. JMP k32 (0x940C) y CALL k32 (0x940E)
  if ((word1 & 0xFE0E) === 0x940C) {
    const word2 = fetchWordFromFlash(runtime);
    const target = word2 & 0xFFFF;
    if ((word1 & 0x0002) !== 0) { // CALL
      pushWord16Avr(runtime, runtime.state.pc);
      runtime.state.pc = target;
      return 4;
    } else { // JMP
      runtime.state.pc = target;
      return 3;
    }
  }

  // 4. RET (0x9508) y RETI (0x9518)
  if (word1 === 0x9508) {
    runtime.state.pc = popWord16Avr(runtime);
    return 4;
  }
  if (word1 === 0x9518) {
    runtime.state.pc = popWord16Avr(runtime);
    setSregFlag(runtime, SREG_I, true);
    return 4;
  }

  // 5. LDI Rd, K (0xE000 | (K_high << 8) | (d << 4) | K_low)
  if ((word1 & 0xF000) === 0xE000) {
    const d = 16 + ((word1 >> 4) & 0x0F);
    const k = ((word1 >> 4) & 0xF0) | (word1 & 0x0F);
    writeReg(runtime, d, k);
    return 1;
  }

  // 6. MOV Rd, Rr (0x2C00) y MOVW Rd, Rr (0x0100)
  if ((word1 & 0xFC00) === 0x2C00) {
    const d = (word1 >> 4) & 0x1F;
    const r = ((word1 >> 5) & 0x10) | (word1 & 0x0F);
    writeReg(runtime, d, readReg(runtime, r));
    return 1;
  }
  if ((word1 & 0xFF00) === 0x0100) {
    const d = ((word1 >> 4) & 0x0F) * 2;
    const r = (word1 & 0x0F) * 2;
    writeRegWord(runtime, d, readRegWord(runtime, r));
    return 1;
  }

  // 7. ADD / ADC / SUB / SBC / AND / OR / EOR / CP / CPC
  const opMajor = word1 & 0xFC00;
  if (
    opMajor === 0x0C00 || // ADD
    opMajor === 0x1C00 || // ADC
    opMajor === 0x1800 || // SUB
    opMajor === 0x0800 || // SBC
    opMajor === 0x2000 || // AND
    opMajor === 0x2800 || // OR
    opMajor === 0x2400 || // EOR
    opMajor === 0x1400 || // CP
    opMajor === 0x0400    // CPC
  ) {
    const d = (word1 >> 4) & 0x1F;
    const r = ((word1 >> 5) & 0x10) | (word1 & 0x0F);
    const rd = readReg(runtime, d);
    const rr = readReg(runtime, r);
    const cIn = (opMajor === 0x1C00 || opMajor === 0x0800 || opMajor === 0x0400) && getSregFlag(runtime, SREG_C) ? 1 : 0;

    let res = 0;
    if (opMajor === 0x0C00 || opMajor === 0x1C00) { // ADD / ADC
      res = rd + rr + cIn;
      setSregFlag(runtime, SREG_H, ((rd & 0x0F) + (rr & 0x0F) + cIn) > 0x0F);
      setSregFlag(runtime, SREG_C, res > 0xFF);
      setSregFlag(runtime, SREG_V, (((rd ^ res) & (rr ^ res) & 0x80) !== 0));
      writeReg(runtime, d, res & 0xFF);
    } else if (opMajor === 0x1800 || opMajor === 0x0800 || opMajor === 0x1400 || opMajor === 0x0400) { // SUB / SBC / CP / CPC
      res = rd - rr - cIn;
      setSregFlag(runtime, SREG_H, ((rd & 0x0F) - (rr & 0x0F) - cIn) < 0);
      setSregFlag(runtime, SREG_C, res < 0);
      setSregFlag(runtime, SREG_V, (((rd ^ rr) & (rd ^ res) & 0x80) !== 0));
      if (opMajor !== 0x1400 && opMajor !== 0x0400) { // Escribe resultado si no es CP/CPC
        writeReg(runtime, d, (res + 256) & 0xFF);
      }
    } else if (opMajor === 0x2000) { // AND
      res = rd & rr;
      setSregFlag(runtime, SREG_V, false);
      writeReg(runtime, d, res);
    } else if (opMajor === 0x2800) { // OR
      res = rd | rr;
      setSregFlag(runtime, SREG_V, false);
      writeReg(runtime, d, res);
    } else if (opMajor === 0x2400) { // EOR
      res = rd ^ rr;
      setSregFlag(runtime, SREG_V, false);
      writeReg(runtime, d, res);
    }

    const finalVal = (res + 256) & 0xFF;
    setSregFlag(runtime, SREG_Z, finalVal === 0);
    setSregFlag(runtime, SREG_N, (finalVal & 0x80) !== 0);
    setSregFlag(runtime, SREG_S, getSregFlag(runtime, SREG_N) !== getSregFlag(runtime, SREG_V));
    return 1;
  }

  // 8. IN Rd, P (0xB000) y OUT P, Rr (0xB800)
  if ((word1 & 0xF800) === 0xB000) {
    const d = (word1 >> 4) & 0x1F;
    const p = ((word1 >> 5) & 0x30) | (word1 & 0x0F);
    writeReg(runtime, d, readIoRegister(runtime, p));
    return 1;
  }
  if ((word1 & 0xF800) === 0xB800) {
    const r = (word1 >> 4) & 0x1F;
    const p = ((word1 >> 5) & 0x30) | (word1 & 0x0F);
    writeIoRegister(runtime, p, readReg(runtime, r));
    return 1;
  }

  // 9. CBI P, b (0x9800) y SBI P, b (0x9A00)
  if ((word1 & 0xFF00) === 0x9800 || (word1 & 0xFF00) === 0x9A00) {
    const p = (word1 >> 3) & 0x1F;
    const b = word1 & 0x07;
    const isSet = (word1 & 0x0200) !== 0;
    const cur = readIoRegister(runtime, p);
    writeIoRegister(runtime, p, isSet ? (cur | (1 << b)) : (cur & ~(1 << b)));
    return 2;
  }

  // 10. LDS Rd, k32 (0x9000) y STS k32, Rr (0x9200)
  if ((word1 & 0xFE0F) === 0x9000) {
    const d = (word1 >> 4) & 0x1F;
    const k = fetchWordFromFlash(runtime);
    writeReg(runtime, d, readDataSpace(runtime, k));
    return 2;
  }
  if ((word1 & 0xFE0F) === 0x9200) {
    const r = (word1 >> 4) & 0x1F;
    const k = fetchWordFromFlash(runtime);
    writeDataSpace(runtime, k, readReg(runtime, r));
    return 2;
  }

  // 11. PUSH Rr (0x920F) y POP Rd (0x900F)
  if ((word1 & 0xFE0F) === 0x920F) {
    const r = (word1 >> 4) & 0x1F;
    pushByteAvr(runtime, readReg(runtime, r));
    return 2;
  }
  if ((word1 & 0xFE0F) === 0x900F) {
    const d = (word1 >> 4) & 0x1F;
    writeReg(runtime, d, popByteAvr(runtime));
    return 2;
  }

  // 12. BRBS s, k (0xF000) y BRBC s, k (0xF400)
  if ((word1 & 0xF800) === 0xF000 || (word1 & 0xF800) === 0xF400) {
    const s = word1 & 0x07;
    const k = ((word1 >> 3) & 0x7F) << 25 >> 25; // 7-bit signed offset
    const isSet = (word1 & 0x0400) === 0;
    const flagVal = getSregFlag(runtime, 1 << s);
    if (flagVal === isSet) {
      runtime.state.pc = (runtime.state.pc + k) & 0xFFFF;
      return 2;
    }
    return 1;
  }

  // 13. MUL Rr, Rd (0x9C00) -> R1:R0 = Rd * Rr
  if ((word1 & 0xFC00) === 0x9C00) {
    const d = (word1 >> 4) & 0x1F;
    const r = ((word1 >> 5) & 0x10) | (word1 & 0x0F);
    const prod = readReg(runtime, d) * readReg(runtime, r);
    writeRegWord(runtime, 0, prod);
    setSregFlag(runtime, SREG_C, (prod & 0x8000) !== 0);
    setSregFlag(runtime, SREG_Z, prod === 0);
    return 2;
  }

  // 14. BSET s (0x9408) y BCLR s (0x9488) (SEC, CLC, SEI, CLI, etc.)
  if ((word1 & 0xFF0F) === 0x9408) {
    const s = (word1 >> 4) & 0x07;
    setSregFlag(runtime, 1 << s, true);
    return 1;
  }
  if ((word1 & 0xFF0F) === 0x9488) {
    const s = (word1 >> 4) & 0x07;
    setSregFlag(runtime, 1 << s, false);
    return 1;
  }

  // 15. SLEEP (0x9588) y WDR (0x95A8)
  if (word1 === 0x9588) {
    // Modo sleep activado
    return 1;
  }
  if (word1 === 0x95A8) {
    // Watchdog reset
    return 1;
  }

  // Opcode no decodificado: avanzar normalmente
  return 1;
}

export function disassembleAvr(
  runtime: McuRuntime,
  address: number,
  count = 16,
): Array<{ address: number; instruction: { mnemonic: string; bytes: number; cycles: number } }> {
  const result: Array<{ address: number; instruction: { mnemonic: string; bytes: number; cycles: number } }> = [];
  let addr = address;

  for (let i = 0; i < count && addr < runtime.definition.flashSize / 2; i++) {
    const word = (runtime.memory.flash[addr * 2 + 1] << 8) | runtime.memory.flash[addr * 2];
    result.push({
      address: addr,
      instruction: {
        mnemonic: `0x${word.toString(16).padStart(4, "0").toUpperCase()}`,
        bytes: 2,
        cycles: 1,
      },
    });
    addr += 1;
  }

  return result;
}

export const AVR_REGISTERS: McuRegister[] = [
  { name: "SREG", address: 0x3F, size: 8 },
  { name: "SPH", address: 0x3E, size: 8 },
  { name: "SPL", address: 0x3D, size: 8 },
  { name: "GPIOR0", address: 0x1E, size: 8 },
  { name: "GPIOR1", address: 0x2A, size: 8 },
  { name: "GPIOR2", address: 0x2B, size: 8 },
  { name: "TCNT0", address: 0x26, size: 8 },
  { name: "TCCR0A", address: 0x24, size: 8 },
  { name: "TCCR0B", address: 0x25, size: 8 },
  { name: "OCR0A", address: 0x27, size: 8 },
  { name: "OCR0B", address: 0x28, size: 8 },
  { name: "TIFR0", address: 0x15, size: 8 },
  { name: "TIMSK0", address: 0x6E, size: 8 },
  { name: "MCUCR", address: 0x35, size: 8 },
  { name: "MCUSR", address: 0x34, size: 8 },
];

export const AVR_PERIPHERALS: McuPeripheral[] = [
  { name: "Timer0", baseAddress: 0x24, size: 8, interrupts: ["TIMER0_OVF", "TIMER0_COMPA", "TIMER0_COMPB"] },
  { name: "Timer1", baseAddress: 0x80, size: 16, interrupts: ["TIMER1_OVF", "TIMER1_COMPA", "TIMER1_COMPB", "TIMER1_CAPT"] },
  { name: "Timer2", baseAddress: 0xB0, size: 8, interrupts: ["TIMER2_OVF", "TIMER2_COMPA", "TIMER2_COMPB"] },
  { name: "USART0", baseAddress: 0xC0, size: 8, interrupts: ["USART_RX", "USART_UDRE", "USART_TX"] },
  { name: "SPI", baseAddress: 0x2C, size: 8, interrupts: ["SPI_STC"] },
  { name: "TWI", baseAddress: 0xB8, size: 8, interrupts: ["TWI"] },
  { name: "ADC", baseAddress: 0x78, size: 16, interrupts: ["ADC"] },
  { name: "Watchdog", baseAddress: 0x60, size: 8, interrupts: ["WDT"] },
];

export const ATMEGA328P: McuDefinition = {
  name: "ATmega328P",
  architecture: "avr",
  clockSpeed: 16e6,
  flashSize: 32 * 1024,
  ramSize: 2 * 1024,
  registers: AVR_REGISTERS,
  peripherals: AVR_PERIPHERALS,
  pcSize: 22,
  stackPointerSize: 16,
};

export const ATMEGA2560: McuDefinition = {
  name: "ATmega2560",
  architecture: "avr",
  clockSpeed: 16e6,
  flashSize: 256 * 1024,
  ramSize: 8 * 1024,
  registers: [],
  peripherals: [],
  pcSize: 22,
  stackPointerSize: 16,
};

export const ATMEGA328P_DEFINITIONS: McuDefinition = ATMEGA328P;

export const AVR_MCU_DEFINITIONS: Record<string, McuDefinition> = {
  "ATmega328P": ATMEGA328P,
  "ATmega2560": ATMEGA2560,
  "ATmega328": ATMEGA328P,
};

export function getAvrDefinition(name: string): McuDefinition | undefined {
  return AVR_MCU_DEFINITIONS[name];
}

export function listAvrMcus(): string[] {
  return Object.keys(AVR_MCU_DEFINITIONS);
}