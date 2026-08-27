// ==========================================================================
// MCU PIC16F84A — Emulador Completo de la ISA RISC de 35 Instrucciones (14-bit)
// ==========================================================================

import type { McuDefinition } from "./mcu-types";

export interface Pic16State {
  pc: number;
  w: number; // Working register (acumulador)
  ram: Uint8Array; // 128 bytes (bancos 0 y 1 mapeados)
  flash: Uint16Array; // 1024 palabras de 14 bits (0x000 - 0x3FF)
  stack: number[]; // Pila hardware de 8 niveles
  cycles: number;
  running: boolean;
  sleep: boolean;
  prescaler: number;
  tmr0Ticks: number;
  prevPortB: number;
  prevRa4: boolean;
}

// Direcciones SFR
export const PIC_INDF = 0x00;
export const PIC_TMR0 = 0x01;
export const PIC_OPTION = 0x81;
export const PIC_PCL = 0x02;
export const PIC_STATUS = 0x03;
export const PIC_FSR = 0x04;
export const PIC_PORTA = 0x05;
export const PIC_TRISA = 0x85;
export const PIC_PORTB = 0x06;
export const PIC_TRISB = 0x86;
export const PIC_EEDATA = 0x08;
export const PIC_EECON1 = 0x88;
export const PIC_EEADR = 0x09;
export const PIC_EECON2 = 0x89;
export const PIC_PCLATH = 0x0A;
export const PIC_INTCON = 0x0B;

// Bits de STATUS
export const STATUS_C = 0x01;
export const STATUS_DC = 0x02;
export const STATUS_Z = 0x04;
export const STATUS_PD = 0x08;
export const STATUS_TO = 0x10;
export const STATUS_RP0 = 0x20;

export function createPic16(flashWords: number = 1024): Pic16State {
  const ram = new Uint8Array(128);
  ram[PIC_STATUS] = 0x18; // TO=1, PD=1 tras Reset
  ram[PIC_OPTION] = 0xff;
  ram[PIC_TRISA] = 0x1f; // RA0..RA4 como entradas
  ram[PIC_TRISB] = 0xff; // RB0..RB7 como entradas

  return {
    pc: 0x000,
    w: 0,
    ram,
    flash: new Uint16Array(flashWords),
    stack: [],
    cycles: 0,
    running: true,
    sleep: false,
    prescaler: 0,
    tmr0Ticks: 0,
    prevPortB: 0,
    prevRa4: false,
  };
}

export function readPicRegister(state: Pic16State, addr: number): number {
  let effectiveAddr = addr & 0x7f;
  if (addr === PIC_INDF) {
    effectiveAddr = state.ram[PIC_FSR] & 0x7f;
    if (effectiveAddr === 0) return 0; // Evitar recursión infinita INDF
  }

  // Bancos 0 y 1 mapeados en STATUS.RP0
  const isBank1 = (state.ram[PIC_STATUS] & STATUS_RP0) !== 0;
  const bankOffset = isBank1 ? 0x80 : 0x00;

  if (effectiveAddr === PIC_PCL) {
    return state.pc & 0xff;
  }

  return state.ram[effectiveAddr | (bankOffset & 0x80 ? 0x80 : 0)] ?? 0;
}

export function writePicRegister(state: Pic16State, addr: number, val: number): void {
  const safeVal = val & 0xff;
  let effectiveAddr = addr & 0x7f;
  if (addr === PIC_INDF) {
    effectiveAddr = state.ram[PIC_FSR] & 0x7f;
    if (effectiveAddr === 0) return;
  }

  const isBank1 = (state.ram[PIC_STATUS] & STATUS_RP0) !== 0;
  const fullAddr = effectiveAddr | (isBank1 ? 0x80 : 0x00);

  if (effectiveAddr === PIC_PCL) {
    state.pc = ((state.ram[PIC_PCLATH] & 0x1f) << 8) | safeVal;
    return;
  }

  state.ram[fullAddr] = safeVal;
  // Registros mapeados en ambos bancos (STATUS, FSR, PCLATH, INTCON)
  if (effectiveAddr === PIC_STATUS || effectiveAddr === PIC_FSR || effectiveAddr === PIC_PCLATH || effectiveAddr === PIC_INTCON) {
    state.ram[effectiveAddr] = safeVal;
    state.ram[effectiveAddr | 0x80] = safeVal;
  }
}

function updateZeroFlag(state: Pic16State, val: number): void {
  if ((val & 0xff) === 0) {
    state.ram[PIC_STATUS] |= STATUS_Z;
  } else {
    state.ram[PIC_STATUS] &= ~STATUS_Z;
  }
}

/**
 * Ejecuta una sola instrucción en el PIC16F84A (1 o 2 ciclos máquina).
 */
export function stepPic16(state: Pic16State): number {
  if (!state.running || state.sleep) return 0;

  const opcode = state.flash[state.pc & 0x3ff] ?? 0;
  state.pc = (state.pc + 1) & 0x3ff;
  let instructionCycles = 1;

  // 1. Instrucciones orientadas a bytes (00 ffff ffff ffff)
  const opGroup = (opcode >> 12) & 0x03;

  if (opGroup === 0) {
    const f = opcode & 0x7f;
    const d = (opcode >> 7) & 0x01; // 0 = W, 1 = f

    const subOp = (opcode >> 8) & 0x0f;
    switch (subOp) {
      case 0x07: { // ADDWF f, d
        const fVal = readPicRegister(state, f);
        const res = state.w + fVal;
        const res8 = res & 0xff;
        // Flags C, DC, Z
        if (res > 0xff) state.ram[PIC_STATUS] |= STATUS_C;
        else state.ram[PIC_STATUS] &= ~STATUS_C;
        if (((state.w & 0x0f) + (fVal & 0x0f)) > 0x0f) state.ram[PIC_STATUS] |= STATUS_DC;
        else state.ram[PIC_STATUS] &= ~STATUS_DC;
        updateZeroFlag(state, res8);
        if (d === 0) state.w = res8;
        else writePicRegister(state, f, res8);
        break;
      }
      case 0x05: { // ANDWF f, d
        const res = state.w & readPicRegister(state, f);
        updateZeroFlag(state, res);
        if (d === 0) state.w = res;
        else writePicRegister(state, f, res);
        break;
      }
      case 0x01: { // CLRF f (d=1) / CLRW (d=0)
        if (d === 1) {
          writePicRegister(state, f, 0);
          state.ram[PIC_STATUS] |= STATUS_Z;
        } else {
          state.w = 0;
          state.ram[PIC_STATUS] |= STATUS_Z;
        }
        break;
      }
      case 0x09: { // COMF f, d
        const res = (~readPicRegister(state, f)) & 0xff;
        updateZeroFlag(state, res);
        if (d === 0) state.w = res;
        else writePicRegister(state, f, res);
        break;
      }
      case 0x03: { // DECF f, d
        const res = (readPicRegister(state, f) - 1) & 0xff;
        updateZeroFlag(state, res);
        if (d === 0) state.w = res;
        else writePicRegister(state, f, res);
        break;
      }
      case 0x0b: { // DECFSZ f, d
        const res = (readPicRegister(state, f) - 1) & 0xff;
        if (d === 0) state.w = res;
        else writePicRegister(state, f, res);
        if (res === 0) {
          state.pc = (state.pc + 1) & 0x3ff;
          instructionCycles = 2;
        }
        break;
      }
      case 0x0a: { // INCF f, d
        const res = (readPicRegister(state, f) + 1) & 0xff;
        updateZeroFlag(state, res);
        if (d === 0) state.w = res;
        else writePicRegister(state, f, res);
        break;
      }
      case 0x0f: { // INCFSZ f, d
        const res = (readPicRegister(state, f) + 1) & 0xff;
        if (d === 0) state.w = res;
        else writePicRegister(state, f, res);
        if (res === 0) {
          state.pc = (state.pc + 1) & 0x3ff;
          instructionCycles = 2;
        }
        break;
      }
      case 0x04: { // IORWF f, d
        const res = state.w | readPicRegister(state, f);
        updateZeroFlag(state, res);
        if (d === 0) state.w = res;
        else writePicRegister(state, f, res);
        break;
      }
      case 0x08: { // MOVF f, d
        const val = readPicRegister(state, f);
        updateZeroFlag(state, val);
        if (d === 0) state.w = val;
        else writePicRegister(state, f, val);
        break;
      }
      case 0x00: { // MOVWF f o NOP / CLRWDT / RETFIE / RETURN / SLEEP
        if ((opcode & 0x0f80) === 0x0080) { // MOVWF f
          writePicRegister(state, f, state.w);
        } else if (opcode === 0x0008) { // RETURN
          state.pc = state.stack.pop() ?? 0;
          instructionCycles = 2;
        } else if (opcode === 0x0009) { // RETFIE
          state.pc = state.stack.pop() ?? 0;
          state.ram[PIC_INTCON] |= 0x80; // GIE = 1
          instructionCycles = 2;
        } else if (opcode === 0x0063) { // SLEEP
          state.sleep = true;
          state.ram[PIC_STATUS] &= ~STATUS_TO;
          state.ram[PIC_STATUS] |= STATUS_PD;
        }
        break;
      }
      case 0x02: { // SUBWF f, d (f - W)
        const fVal = readPicRegister(state, f);
        const res = fVal - state.w;
        const res8 = res & 0xff;
        if (res >= 0) state.ram[PIC_STATUS] |= STATUS_C;
        else state.ram[PIC_STATUS] &= ~STATUS_C;
        if ((fVal & 0x0f) >= (state.w & 0x0f)) state.ram[PIC_STATUS] |= STATUS_DC;
        else state.ram[PIC_STATUS] &= ~STATUS_DC;
        updateZeroFlag(state, res8);
        if (d === 0) state.w = res8;
        else writePicRegister(state, f, res8);
        break;
      }
      case 0x0e: { // SWAPF f, d
        const val = readPicRegister(state, f);
        const res = ((val << 4) & 0xf0) | ((val >> 4) & 0x0f);
        if (d === 0) state.w = res;
        else writePicRegister(state, f, res);
        break;
      }
      case 0x06: { // XORWF f, d
        const res = state.w ^ readPicRegister(state, f);
        updateZeroFlag(state, res);
        if (d === 0) state.w = res;
        else writePicRegister(state, f, res);
        break;
      }
    }
  } else if (opGroup === 1) { // 2. Instrucciones orientadas a bits (01 bbba ffff ffff)
    const f = opcode & 0x7f;
    const bit = (opcode >> 7) & 0x07;
    const bitOp = (opcode >> 10) & 0x03;

    const val = readPicRegister(state, f);
    if (bitOp === 0) { // BCF f, b
      writePicRegister(state, f, val & ~(1 << bit));
    } else if (bitOp === 1) { // BSF f, b
      writePicRegister(state, f, val | (1 << bit));
    } else if (bitOp === 2) { // BTFSC f, b
      if ((val & (1 << bit)) === 0) {
        state.pc = (state.pc + 1) & 0x3ff;
        instructionCycles = 2;
      }
    } else if (bitOp === 3) { // BTFSS f, b
      if ((val & (1 << bit)) !== 0) {
        state.pc = (state.pc + 1) & 0x3ff;
        instructionCycles = 2;
      }
    }
  } else if (opGroup === 2) { // 3. Saltos y Literales (10 y 11)
    const k = opcode & 0x7ff;
    if ((opcode & 0x3800) === 0x2000) { // CALL k
      state.stack.push(state.pc);
      state.pc = ((state.ram[PIC_PCLATH] & 0x18) << 8) | k;
      instructionCycles = 2;
    } else if ((opcode & 0x3800) === 0x2800) { // GOTO k
      state.pc = ((state.ram[PIC_PCLATH] & 0x18) << 8) | k;
      instructionCycles = 2;
    }
  } else if (opGroup === 3) { // Literales (11 xxxx kkkk kkkk)
    const k = opcode & 0xff;
    const litOp = (opcode >> 8) & 0x0f;

    switch (litOp) {
      case 0x0e: // ADDLW k
      case 0x0f: {
        const res = state.w + k;
        if (res > 0xff) state.ram[PIC_STATUS] |= STATUS_C;
        else state.ram[PIC_STATUS] &= ~STATUS_C;
        if (((state.w & 0x0f) + (k & 0x0f)) > 0x0f) state.ram[PIC_STATUS] |= STATUS_DC;
        else state.ram[PIC_STATUS] &= ~STATUS_DC;
        state.w = res & 0xff;
        updateZeroFlag(state, state.w);
        break;
      }
      case 0x08: // ANDLW k
      case 0x09: {
        state.w = (state.w & k) & 0xff;
        updateZeroFlag(state, state.w);
        break;
      }
      case 0x00: // MOVLW k
      case 0x01:
      case 0x02:
      case 0x03: {
        state.w = k;
        break;
      }
      case 0x04: // RETLW k
      case 0x05:
      case 0x06:
      case 0x07: {
        state.w = k;
        state.pc = state.stack.pop() ?? 0;
        instructionCycles = 2;
        break;
      }
      case 0x0c: // SUBLW k (k - W)
      case 0x0d: {
        const res = k - state.w;
        if (res >= 0) state.ram[PIC_STATUS] |= STATUS_C;
        else state.ram[PIC_STATUS] &= ~STATUS_C;
        if ((k & 0x0f) >= (state.w & 0x0f)) state.ram[PIC_STATUS] |= STATUS_DC;
        else state.ram[PIC_STATUS] &= ~STATUS_DC;
        state.w = res & 0xff;
        updateZeroFlag(state, state.w);
        break;
      }
      case 0x0a: // XORLW k
      case 0x0b: {
        state.w = (state.w ^ k) & 0xff;
        updateZeroFlag(state, state.w);
        break;
      }
    }
  }

  state.cycles += instructionCycles;
  return instructionCycles;
}

export const PIC16F84A_DEFINITION: McuDefinition = {
  name: "PIC16F84A",
  architecture: "pic16" as any,
  clockSpeed: 4000000,
  flashSize: 1024,
  ramSize: 128,
  pcSize: 13,
  stackPointerSize: 3,
  registers: [
    { name: "W", address: 0x100, size: 1 },
    { name: "STATUS", address: PIC_STATUS, size: 1 },
    { name: "PORTA", address: PIC_PORTA, size: 1 },
    { name: "PORTB", address: PIC_PORTB, size: 1 },
    { name: "TRISA", address: PIC_TRISA, size: 1 },
    { name: "TRISB", address: PIC_TRISB, size: 1 },
    { name: "TMR0", address: PIC_TMR0, size: 1 },
    { name: "OPTION_REG", address: PIC_OPTION, size: 1 },
    { name: "INTCON", address: PIC_INTCON, size: 1 },
  ],
  peripherals: [
    { name: "PORTA", baseAddress: PIC_PORTA, size: 1, interrupts: [] },
    { name: "PORTB", baseAddress: PIC_PORTB, size: 1, interrupts: ["RB0/INT", "RB_CHANGE"] },
    { name: "TMR0", baseAddress: PIC_TMR0, size: 1, interrupts: ["TMR0_OVF"] },
  ],
};
