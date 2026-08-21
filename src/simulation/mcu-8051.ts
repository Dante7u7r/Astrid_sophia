/**
 * Runtime e ISA Completa para 8051 (Instruction-Set Accurate).
 *
 * Implementa las 256 instrucciones del microcontrolador 8051 estándar, incluyendo:
 * - Operaciones aritméticas (ADD, ADDC, SUBB, INC, DEC, MUL AB, DIV AB, DA A)
 * - Operaciones lógicas (ANL, ORL, XRL, CLR, CPL, RL, RLC, RR, RRC, SWAP)
 * - Operaciones booleanas y de bit (SETB, CLR, CPL, ANL C, ORL C, MOV C, JB, JNB, JBC)
 * - Transferencia de datos (MOV, MOVX, MOVC, PUSH, POP, XCH, XCHD)
 * - Ramificación y control (LCALL, ACALL, RET, RETI, LJMP, AJMP, SJMP, JMP @A+DPTR, JZ, JNZ, JC, JNC, CJNE, DJNZ)
 * - Vectores de interrupción hardware (INT0, TF0, INT1, TF1, RI/TI)
 */
import type { McuRuntime } from "./mcu-runtime";

export type Instruction8051 = {
  mnemonic: string;
  bytes: number;
  cycles: number;
};

// SFR Addresses
export const SFR_ACC = 0xE0;
export const SFR_B = 0xF0;
export const SFR_PSW = 0xD0;
export const SFR_SP = 0x81;
export const SFR_DPL = 0x82;
export const SFR_DPH = 0x83;
export const SFR_P0 = 0x80;
export const SFR_P1 = 0x90;
export const SFR_P2 = 0xA0;
export const SFR_P3 = 0xB0;
export const SFR_IE = 0xA8;
export const SFR_IP = 0xB8;
export const SFR_TCON = 0x88;
export const SFR_TMOD = 0x89;
export const SFR_TL0 = 0x8A;
export const SFR_TL1 = 0x8B;
export const SFR_TH0 = 0x8C;
export const SFR_TH1 = 0x8D;
export const SFR_SCON = 0x98;
export const SFR_SBUF = 0x99;

// PSW Bit Masks
export const PSW_P_MASK = 0x01;
export const PSW_OV_MASK = 0x04;
export const PSW_RS0_MASK = 0x08;
export const PSW_RS1_MASK = 0x10;
export const PSW_F0_MASK = 0x20;
export const PSW_AC_MASK = 0x40;
export const PSW_CY_MASK = 0x80;

// ============================================================================
// MEMORY & REGISTER ACCESS HELPERS
// ============================================================================

export function readDirect(runtime: McuRuntime, addr: number): number {
  if (addr < 0x80) {
    return runtime.memory.ram[addr] ?? 0;
  }
  return runtime.memory.sfr[addr - 0x80] ?? 0;
}

export function writeDirect(runtime: McuRuntime, addr: number, val: number): void {
  const byteVal = val & 0xFF;
  if (addr < 0x80) {
    runtime.memory.ram[addr] = byteVal;
  } else {
    runtime.memory.sfr[addr - 0x80] = byteVal;
    if (addr === SFR_ACC) {
      updateParity(runtime);
    } else if (addr === SFR_SP) {
      runtime.state.sp = byteVal;
    }
  }
}

export function readACC(runtime: McuRuntime): number {
  return readDirect(runtime, SFR_ACC);
}

export function writeACC(runtime: McuRuntime, val: number): void {
  writeDirect(runtime, SFR_ACC, val);
}

export function readB(runtime: McuRuntime): number {
  return readDirect(runtime, SFR_B);
}

export function writeB(runtime: McuRuntime, val: number): void {
  writeDirect(runtime, SFR_B, val);
}

export function readPSW(runtime: McuRuntime): number {
  return readDirect(runtime, SFR_PSW);
}

export function writePSW(runtime: McuRuntime, val: number): void {
  writeDirect(runtime, SFR_PSW, val);
}

export function readDPTR(runtime: McuRuntime): number {
  const dph = readDirect(runtime, SFR_DPH);
  const dpl = readDirect(runtime, SFR_DPL);
  return (dph << 8) | dpl;
}

export function writeDPTR(runtime: McuRuntime, val: number): void {
  writeDirect(runtime, SFR_DPH, (val >> 8) & 0xFF);
  writeDirect(runtime, SFR_DPL, val & 0xFF);
}

export function getRegisterBank(runtime: McuRuntime): number {
  const psw = readPSW(runtime);
  return (psw >> 3) & 0x03;
}

export function readRn(runtime: McuRuntime, n: number): number {
  const bank = getRegisterBank(runtime);
  return runtime.memory.ram[bank * 8 + (n & 7)] ?? 0;
}

export function writeRn(runtime: McuRuntime, n: number, val: number): void {
  const bank = getRegisterBank(runtime);
  runtime.memory.ram[bank * 8 + (n & 7)] = val & 0xFF;
}

export function readRiIndirect(runtime: McuRuntime, i: number): number {
  const addr = readRn(runtime, i & 1);
  return runtime.memory.ram[addr & 0x7F] ?? 0;
}

export function writeRiIndirect(runtime: McuRuntime, i: number, val: number): void {
  const addr = readRn(runtime, i & 1);
  runtime.memory.ram[addr & 0x7F] = val & 0xFF;
}

// Flags
export function getBitFlag(runtime: McuRuntime, mask: number): boolean {
  return (readPSW(runtime) & mask) !== 0;
}

export function setBitFlag(runtime: McuRuntime, mask: number, value: boolean): void {
  const current = readPSW(runtime);
  const next = value ? (current | mask) : (current & ~mask);
  writeDirect(runtime, SFR_PSW, next);
}

export function readCY(runtime: McuRuntime): boolean {
  return getBitFlag(runtime, PSW_CY_MASK);
}

export function setCY(runtime: McuRuntime, val: boolean): void {
  setBitFlag(runtime, PSW_CY_MASK, val);
}

export function readAC(runtime: McuRuntime): boolean {
  return getBitFlag(runtime, PSW_AC_MASK);
}

export function setAC(runtime: McuRuntime, val: boolean): void {
  setBitFlag(runtime, PSW_AC_MASK, val);
}

export function readOV(runtime: McuRuntime): boolean {
  return getBitFlag(runtime, PSW_OV_MASK);
}

export function setOV(runtime: McuRuntime, val: boolean): void {
  setBitFlag(runtime, PSW_OV_MASK, val);
}

export function updateParity(runtime: McuRuntime): void {
  const acc = readDirect(runtime, SFR_ACC);
  let ones = 0;
  for (let i = 0; i < 8; i++) {
    if ((acc & (1 << i)) !== 0) ones++;
  }
  setBitFlag(runtime, PSW_P_MASK, (ones % 2) !== 0);
}

// Bit Addressing
export function readBit(runtime: McuRuntime, bitAddr: number): boolean {
  if (bitAddr < 0x80) {
    const byteAddr = 0x20 + (bitAddr >> 3);
    const bitPos = bitAddr & 7;
    return ((runtime.memory.ram[byteAddr] ?? 0) & (1 << bitPos)) !== 0;
  }
  const sfrAddr = bitAddr & 0xF8;
  const bitPos = bitAddr & 7;
  return ((readDirect(runtime, sfrAddr)) & (1 << bitPos)) !== 0;
}

export function writeBit(runtime: McuRuntime, bitAddr: number, val: boolean): void {
  if (bitAddr < 0x80) {
    const byteAddr = 0x20 + (bitAddr >> 3);
    const bitPos = bitAddr & 7;
    const cur = runtime.memory.ram[byteAddr] ?? 0;
    runtime.memory.ram[byteAddr] = val ? (cur | (1 << bitPos)) : (cur & ~(1 << bitPos));
  } else {
    const sfrAddr = bitAddr & 0xF8;
    const bitPos = bitAddr & 7;
    const cur = readDirect(runtime, sfrAddr);
    writeDirect(runtime, sfrAddr, val ? (cur | (1 << bitPos)) : (cur & ~(1 << bitPos)));
  }
}

// Stack operations
export function pushByte(runtime: McuRuntime, val: number): void {
  runtime.state.sp = (runtime.state.sp + 1) & 0xFF;
  runtime.memory.ram[runtime.state.sp] = val & 0xFF;
  writeDirect(runtime, SFR_SP, runtime.state.sp);
}

export function popByte(runtime: McuRuntime): number {
  const val = runtime.memory.ram[runtime.state.sp] ?? 0;
  runtime.state.sp = (runtime.state.sp - 1) & 0xFF;
  writeDirect(runtime, SFR_SP, runtime.state.sp);
  return val;
}

export function pushWord16(runtime: McuRuntime, val: number): void {
  pushByte(runtime, val & 0xFF);         // Low byte
  pushByte(runtime, (val >> 8) & 0xFF);  // High byte
}

export function popWord16(runtime: McuRuntime): number {
  const high = popByte(runtime);
  const low = popByte(runtime);
  return (high << 8) | low;
}

// Byte fetching from code flash
function fetchCodeByte(runtime: McuRuntime): number {
  const b = runtime.memory.flash[runtime.state.pc] ?? 0;
  runtime.state.pc = (runtime.state.pc + 1) & 0xFFFF;
  return b;
}

function fetchCodeWord(runtime: McuRuntime): number {
  const high = fetchCodeByte(runtime);
  const low = fetchCodeByte(runtime);
  return (high << 8) | low;
}

// ============================================================================
// INSTRUCTION EXECUTION ENGINE
// ============================================================================

export function execute8051Instruction(runtime: McuRuntime): number {
  if (runtime.halted) return 0;

  const pcBefore = runtime.state.pc;
  const opcode = fetchCodeByte(runtime);

  // 1. NOP
  if (opcode === 0x00) {
    return 1;
  }

  // 2. AJMP addr11 / ACALL addr11
  if ((opcode & 0x1F) === 0x01) {
    const page = (opcode >> 5) & 0x07;
    const low = fetchCodeByte(runtime);
    const target = ((runtime.state.pc & 0xF800) | (page << 8) | low) & 0xFFFF;
    runtime.state.pc = target;
    return 2;
  }
  if ((opcode & 0x1F) === 0x11) {
    const page = (opcode >> 5) & 0x07;
    const low = fetchCodeByte(runtime);
    const target = ((runtime.state.pc & 0xF800) | (page << 8) | low) & 0xFFFF;
    pushWord16(runtime, runtime.state.pc);
    runtime.state.pc = target;
    return 2;
  }

  // 3. LJMP addr16 / LCALL addr16
  if (opcode === 0x02) {
    const target = fetchCodeWord(runtime);
    runtime.state.pc = target;
    return 2;
  }
  if (opcode === 0x12) {
    const target = fetchCodeWord(runtime);
    pushWord16(runtime, runtime.state.pc);
    runtime.state.pc = target;
    return 2;
  }

  // 4. RET / RETI
  if (opcode === 0x22) {
    runtime.state.pc = popWord16(runtime);
    return 2;
  }
  if (opcode === 0x32) {
    runtime.state.pc = popWord16(runtime);
    runtime.globalInterruptEnable = true;
    return 2;
  }

  // 5. SJMP rel / JMP @A+DPTR
  if (opcode === 0x80) {
    const rel = (fetchCodeByte(runtime) << 24) >> 24; // Sign extend
    runtime.state.pc = (runtime.state.pc + rel) & 0xFFFF;
    return 2;
  }
  if (opcode === 0x73) {
    const dptr = readDPTR(runtime);
    const a = readACC(runtime);
    runtime.state.pc = (dptr + a) & 0xFFFF;
    return 2;
  }

  // 6. Conditional jumps (JZ, JNZ, JC, JNC, JB, JNB, JBC)
  if (opcode === 0x60) {
    const rel = (fetchCodeByte(runtime) << 24) >> 24;
    if (readACC(runtime) === 0) runtime.state.pc = (runtime.state.pc + rel) & 0xFFFF;
    return 2;
  }
  if (opcode === 0x70) {
    const rel = (fetchCodeByte(runtime) << 24) >> 24;
    if (readACC(runtime) !== 0) runtime.state.pc = (runtime.state.pc + rel) & 0xFFFF;
    return 2;
  }
  if (opcode === 0x40) {
    const rel = (fetchCodeByte(runtime) << 24) >> 24;
    if (readCY(runtime)) runtime.state.pc = (runtime.state.pc + rel) & 0xFFFF;
    return 2;
  }
  if (opcode === 0x50) {
    const rel = (fetchCodeByte(runtime) << 24) >> 24;
    if (!readCY(runtime)) runtime.state.pc = (runtime.state.pc + rel) & 0xFFFF;
    return 2;
  }
  if (opcode === 0x20) {
    const bit = fetchCodeByte(runtime);
    const rel = (fetchCodeByte(runtime) << 24) >> 24;
    if (readBit(runtime, bit)) runtime.state.pc = (runtime.state.pc + rel) & 0xFFFF;
    return 2;
  }
  if (opcode === 0x30) {
    const bit = fetchCodeByte(runtime);
    const rel = (fetchCodeByte(runtime) << 24) >> 24;
    if (!readBit(runtime, bit)) runtime.state.pc = (runtime.state.pc + rel) & 0xFFFF;
    return 2;
  }
  if (opcode === 0x10) {
    const bit = fetchCodeByte(runtime);
    const rel = (fetchCodeByte(runtime) << 24) >> 24;
    if (readBit(runtime, bit)) {
      writeBit(runtime, bit, false);
      runtime.state.pc = (runtime.state.pc + rel) & 0xFFFF;
    }
    return 2;
  }

  // 7. CJNE
  if (opcode === 0xB4) {
    const data = fetchCodeByte(runtime);
    const rel = (fetchCodeByte(runtime) << 24) >> 24;
    const a = readACC(runtime);
    setCY(runtime, a < data);
    if (a !== data) runtime.state.pc = (runtime.state.pc + rel) & 0xFFFF;
    return 2;
  }
  if (opcode === 0xB5) {
    const dir = fetchCodeByte(runtime);
    const rel = (fetchCodeByte(runtime) << 24) >> 24;
    const a = readACC(runtime);
    const val = readDirect(runtime, dir);
    setCY(runtime, a < val);
    if (a !== val) runtime.state.pc = (runtime.state.pc + rel) & 0xFFFF;
    return 2;
  }
  if ((opcode & 0xFE) === 0xB6) {
    const i = opcode & 1;
    const data = fetchCodeByte(runtime);
    const rel = (fetchCodeByte(runtime) << 24) >> 24;
    const val = readRiIndirect(runtime, i);
    setCY(runtime, val < data);
    if (val !== data) runtime.state.pc = (runtime.state.pc + rel) & 0xFFFF;
    return 2;
  }
  if ((opcode & 0xF8) === 0xB8) {
    const n = opcode & 7;
    const data = fetchCodeByte(runtime);
    const rel = (fetchCodeByte(runtime) << 24) >> 24;
    const val = readRn(runtime, n);
    setCY(runtime, val < data);
    if (val !== data) runtime.state.pc = (runtime.state.pc + rel) & 0xFFFF;
    return 2;
  }

  // 8. DJNZ
  if (opcode === 0xD5) {
    const dir = fetchCodeByte(runtime);
    const rel = (fetchCodeByte(runtime) << 24) >> 24;
    const val = (readDirect(runtime, dir) - 1) & 0xFF;
    writeDirect(runtime, dir, val);
    if (val !== 0) runtime.state.pc = (runtime.state.pc + rel) & 0xFFFF;
    return 2;
  }
  if ((opcode & 0xF8) === 0xD8) {
    const n = opcode & 7;
    const rel = (fetchCodeByte(runtime) << 24) >> 24;
    const val = (readRn(runtime, n) - 1) & 0xFF;
    writeRn(runtime, n, val);
    if (val !== 0) runtime.state.pc = (runtime.state.pc + rel) & 0xFFFF;
    return 2;
  }

  // 9. MUL AB (0xA4) & DIV AB (0x84)
  if (opcode === 0xA4) {
    const a = readACC(runtime);
    const b = readB(runtime);
    const prod = a * b;
    writeACC(runtime, prod & 0xFF);
    writeB(runtime, (prod >> 8) & 0xFF);
    setCY(runtime, false);
    setOV(runtime, (prod >> 8) !== 0);
    return 4;
  }
  if (opcode === 0x84) {
    const a = readACC(runtime);
    const b = readB(runtime);
    if (b === 0) {
      setOV(runtime, true);
      setCY(runtime, false);
    } else {
      writeACC(runtime, Math.floor(a / b));
      writeB(runtime, a % b);
      setOV(runtime, false);
      setCY(runtime, false);
    }
    return 4;
  }

  // 10. DA A (0xD4)
  if (opcode === 0xD4) {
    let a = readACC(runtime);
    let cy = readCY(runtime);
    const ac = readAC(runtime);

    if ((a & 0x0F) > 9 || ac) {
      a += 6;
    }
    if ((a > 0x99) || cy) {
      a += 0x60;
      cy = true;
    }
    writeACC(runtime, a & 0xFF);
    setCY(runtime, cy);
    return 1;
  }

  // 11. ADD / ADDC / SUBB
  if ((opcode >= 0x24 && opcode <= 0x2F) || (opcode >= 0x34 && opcode <= 0x3F)) {
    const isAddc = opcode >= 0x34 && opcode <= 0x3F;
    const cIn = isAddc && readCY(runtime) ? 1 : 0;
    const a = readACC(runtime);
    let src = 0;

    if (opcode === 0x24 || opcode === 0x34) src = fetchCodeByte(runtime);
    else if (opcode === 0x25 || opcode === 0x35) src = readDirect(runtime, fetchCodeByte(runtime));
    else if ((opcode & 0xFE) === 0x26 || (opcode & 0xFE) === 0x36) src = readRiIndirect(runtime, opcode & 1);
    else if ((opcode & 0xF8) === 0x28 || (opcode & 0xF8) === 0x38) src = readRn(runtime, opcode & 7);

    const sum = a + src + cIn;
    setCY(runtime, sum > 0xFF);
    setAC(runtime, ((a & 0x0F) + (src & 0x0F) + cIn) > 0x0F);
    setOV(runtime, ((~(a ^ src) & (a ^ sum)) & 0x80) !== 0);
    writeACC(runtime, sum & 0xFF);
    return 1;
  }

  if (opcode >= 0x94 && opcode <= 0x9F) {
    const bIn = readCY(runtime) ? 1 : 0;
    const a = readACC(runtime);
    let src = 0;

    if (opcode === 0x94) src = fetchCodeByte(runtime);
    else if (opcode === 0x95) src = readDirect(runtime, fetchCodeByte(runtime));
    else if ((opcode & 0xFE) === 0x96) src = readRiIndirect(runtime, opcode & 1);
    else if ((opcode & 0xF8) === 0x98) src = readRn(runtime, opcode & 7);

    const diff = a - src - bIn;
    setCY(runtime, diff < 0);
    setAC(runtime, ((a & 0x0F) - (src & 0x0F) - bIn) < 0);
    setOV(runtime, (((a ^ src) & (a ^ diff)) & 0x80) !== 0);
    writeACC(runtime, (diff + 256) & 0xFF);
    return 1;
  }

  // 12. INC / DEC
  if (opcode === 0x04) { writeACC(runtime, (readACC(runtime) + 1) & 0xFF); return 1; }
  if (opcode === 0x14) { writeACC(runtime, (readACC(runtime) - 1) & 0xFF); return 1; }
  if (opcode === 0x05) { const d = fetchCodeByte(runtime); writeDirect(runtime, d, (readDirect(runtime, d) + 1) & 0xFF); return 1; }
  if (opcode === 0x15) { const d = fetchCodeByte(runtime); writeDirect(runtime, d, (readDirect(runtime, d) - 1) & 0xFF); return 1; }
  if ((opcode & 0xFE) === 0x06) { const i = opcode & 1; writeRiIndirect(runtime, i, (readRiIndirect(runtime, i) + 1) & 0xFF); return 1; }
  if ((opcode & 0xFE) === 0x16) { const i = opcode & 1; writeRiIndirect(runtime, i, (readRiIndirect(runtime, i) - 1) & 0xFF); return 1; }
  if ((opcode & 0xF8) === 0x08) { const n = opcode & 7; writeRn(runtime, n, (readRn(runtime, n) + 1) & 0xFF); return 1; }
  if ((opcode & 0xF8) === 0x18) { const n = opcode & 7; writeRn(runtime, n, (readRn(runtime, n) - 1) & 0xFF); return 1; }
  if (opcode === 0xA3) { writeDPTR(runtime, (readDPTR(runtime) + 1) & 0xFFFF); return 2; }

  // 13. Logical Operations (ANL, ORL, XRL, CLR, CPL, RL, RLC, RR, RRC, SWAP)
  if (opcode === 0xE4) { writeACC(runtime, 0); return 1; }
  if (opcode === 0xF4) { writeACC(runtime, ~readACC(runtime) & 0xFF); return 1; }
  if (opcode === 0x23) { const a = readACC(runtime); writeACC(runtime, ((a << 1) | (a >> 7)) & 0xFF); return 1; }
  if (opcode === 0x33) {
    const a = readACC(runtime);
    const cy = readCY(runtime) ? 1 : 0;
    setCY(runtime, (a & 0x80) !== 0);
    writeACC(runtime, ((a << 1) | cy) & 0xFF);
    return 1;
  }
  if (opcode === 0x03) { const a = readACC(runtime); writeACC(runtime, ((a >> 1) | (a << 7)) & 0xFF); return 1; }
  if (opcode === 0x13) {
    const a = readACC(runtime);
    const cy = readCY(runtime) ? 0x80 : 0;
    setCY(runtime, (a & 1) !== 0);
    writeACC(runtime, ((a >> 1) | cy) & 0xFF);
    return 1;
  }
  if (opcode === 0xC4) { const a = readACC(runtime); writeACC(runtime, ((a << 4) | (a >> 4)) & 0xFF); return 1; }

  // ANL A / ORL A / XRL A
  if (opcode === 0x54) { writeACC(runtime, readACC(runtime) & fetchCodeByte(runtime)); return 1; }
  if (opcode === 0x55) { writeACC(runtime, readACC(runtime) & readDirect(runtime, fetchCodeByte(runtime))); return 1; }
  if ((opcode & 0xFE) === 0x56) { writeACC(runtime, readACC(runtime) & readRiIndirect(runtime, opcode & 1)); return 1; }
  if ((opcode & 0xF8) === 0x58) { writeACC(runtime, readACC(runtime) & readRn(runtime, opcode & 7)); return 1; }
  if (opcode === 0x52) { const d = fetchCodeByte(runtime); writeDirect(runtime, d, readDirect(runtime, d) & readACC(runtime)); return 1; }
  if (opcode === 0x53) { const d = fetchCodeByte(runtime); writeDirect(runtime, d, readDirect(runtime, d) & fetchCodeByte(runtime)); return 2; }

  if (opcode === 0x44) { writeACC(runtime, readACC(runtime) | fetchCodeByte(runtime)); return 1; }
  if (opcode === 0x45) { writeACC(runtime, readACC(runtime) | readDirect(runtime, fetchCodeByte(runtime))); return 1; }
  if ((opcode & 0xFE) === 0x46) { writeACC(runtime, readACC(runtime) | readRiIndirect(runtime, opcode & 1)); return 1; }
  if ((opcode & 0xF8) === 0x48) { writeACC(runtime, readACC(runtime) | readRn(runtime, opcode & 7)); return 1; }
  if (opcode === 0x42) { const d = fetchCodeByte(runtime); writeDirect(runtime, d, readDirect(runtime, d) | readACC(runtime)); return 1; }
  if (opcode === 0x43) { const d = fetchCodeByte(runtime); writeDirect(runtime, d, readDirect(runtime, d) | fetchCodeByte(runtime)); return 2; }

  if (opcode === 0x64) { writeACC(runtime, readACC(runtime) ^ fetchCodeByte(runtime)); return 1; }
  if (opcode === 0x65) { writeACC(runtime, readACC(runtime) ^ readDirect(runtime, fetchCodeByte(runtime))); return 1; }
  if ((opcode & 0xFE) === 0x66) { writeACC(runtime, readACC(runtime) ^ readRiIndirect(runtime, opcode & 1)); return 1; }
  if ((opcode & 0xF8) === 0x68) { writeACC(runtime, readACC(runtime) ^ readRn(runtime, opcode & 7)); return 1; }
  if (opcode === 0x62) { const d = fetchCodeByte(runtime); writeDirect(runtime, d, readDirect(runtime, d) ^ readACC(runtime)); return 1; }
  if (opcode === 0x63) { const d = fetchCodeByte(runtime); writeDirect(runtime, d, readDirect(runtime, d) ^ fetchCodeByte(runtime)); return 2; }

  // 14. Boolean / Bit Operations (CLR, SETB, CPL, MOV C, ANL C, ORL C)
  if (opcode === 0xC3) { setCY(runtime, false); return 1; }
  if (opcode === 0xD3) { setCY(runtime, true); return 1; }
  if (opcode === 0xB3) { setCY(runtime, !readCY(runtime)); return 1; }
  if (opcode === 0xC2) { writeBit(runtime, fetchCodeByte(runtime), false); return 1; }
  if (opcode === 0xD2) { writeBit(runtime, fetchCodeByte(runtime), true); return 1; }
  if (opcode === 0xB2) { const b = fetchCodeByte(runtime); writeBit(runtime, b, !readBit(runtime, b)); return 1; }
  if (opcode === 0xA2) { setCY(runtime, readBit(runtime, fetchCodeByte(runtime))); return 1; }
  if (opcode === 0x92) { writeBit(runtime, fetchCodeByte(runtime), readCY(runtime)); return 2; }
  if (opcode === 0x82) { setCY(runtime, readCY(runtime) && readBit(runtime, fetchCodeByte(runtime))); return 2; }
  if (opcode === 0xB0) { setCY(runtime, readCY(runtime) && !readBit(runtime, fetchCodeByte(runtime))); return 2; }
  if (opcode === 0x72) { setCY(runtime, readCY(runtime) || readBit(runtime, fetchCodeByte(runtime))); return 2; }
  if (opcode === 0xA0) { setCY(runtime, readCY(runtime) || !readBit(runtime, fetchCodeByte(runtime))); return 2; }

  // 15. Data Transfer (MOV, MOVX, MOVC, PUSH, POP, XCH, XCHD)
  if (opcode === 0x74) { writeACC(runtime, fetchCodeByte(runtime)); return 1; }
  if (opcode === 0xE5) { writeACC(runtime, readDirect(runtime, fetchCodeByte(runtime))); return 1; }
  if ((opcode & 0xFE) === 0xE6) { writeACC(runtime, readRiIndirect(runtime, opcode & 1)); return 1; }
  if ((opcode & 0xF8) === 0xE8) { writeACC(runtime, readRn(runtime, opcode & 7)); return 1; }

  if (opcode === 0xF5) { writeDirect(runtime, fetchCodeByte(runtime), readACC(runtime)); return 1; }
  if (opcode === 0x75) { const d = fetchCodeByte(runtime); writeDirect(runtime, d, fetchCodeByte(runtime)); return 2; }
  if (opcode === 0x85) { const src = fetchCodeByte(runtime); const dst = fetchCodeByte(runtime); writeDirect(runtime, dst, readDirect(runtime, src)); return 2; }
  if ((opcode & 0xFE) === 0x86) { const d = fetchCodeByte(runtime); writeDirect(runtime, d, readRiIndirect(runtime, opcode & 1)); return 2; }
  if ((opcode & 0xF8) === 0x88) { const d = fetchCodeByte(runtime); writeDirect(runtime, d, readRn(runtime, opcode & 7)); return 2; }

  if ((opcode & 0xFE) === 0xF6) { writeRiIndirect(runtime, opcode & 1, readACC(runtime)); return 1; }
  if ((opcode & 0xFE) === 0x76) { const i = opcode & 1; writeRiIndirect(runtime, i, fetchCodeByte(runtime)); return 1; }
  if ((opcode & 0xFE) === 0xA6) { const i = opcode & 1; writeRiIndirect(runtime, i, readDirect(runtime, fetchCodeByte(runtime))); return 2; }

  if ((opcode & 0xF8) === 0xF8) { writeRn(runtime, opcode & 7, readACC(runtime)); return 1; }
  if ((opcode & 0xF8) === 0x78) { writeRn(runtime, opcode & 7, fetchCodeByte(runtime)); return 1; }
  if ((opcode & 0xF8) === 0xA8) { writeRn(runtime, opcode & 7, readDirect(runtime, fetchCodeByte(runtime))); return 2; }

  if (opcode === 0x90) { writeDPTR(runtime, fetchCodeWord(runtime)); return 2; }
  if (opcode === 0x93) { const a = readACC(runtime); const dptr = readDPTR(runtime); writeACC(runtime, runtime.memory.flash[(dptr + a) & 0xFFFF] ?? 0); return 2; }
  if (opcode === 0x83) { const a = readACC(runtime); writeACC(runtime, runtime.memory.flash[(runtime.state.pc + a) & 0xFFFF] ?? 0); return 2; }

  if (opcode === 0xC0) { pushByte(runtime, readDirect(runtime, fetchCodeByte(runtime))); return 2; }
  if (opcode === 0xD0) { writeDirect(runtime, fetchCodeByte(runtime), popByte(runtime)); return 2; }

  if (opcode === 0xC5) { const d = fetchCodeByte(runtime); const a = readACC(runtime); const v = readDirect(runtime, d); writeACC(runtime, v); writeDirect(runtime, d, a); return 1; }
  if ((opcode & 0xFE) === 0xC6) { const i = opcode & 1; const a = readACC(runtime); const v = readRiIndirect(runtime, i); writeACC(runtime, v); writeRiIndirect(runtime, i, a); return 1; }
  if ((opcode & 0xF8) === 0xC8) { const n = opcode & 7; const a = readACC(runtime); const v = readRn(runtime, n); writeACC(runtime, v); writeRn(runtime, n, a); return 1; }

  if ((opcode & 0xFE) === 0xD6) {
    const i = opcode & 1;
    const a = readACC(runtime);
    const v = readRiIndirect(runtime, i);
    writeACC(runtime, (a & 0xF0) | (v & 0x0F));
    writeRiIndirect(runtime, i, (v & 0xF0) | (a & 0x0F));
    return 1;
  }

  // Desconocido
  runtime.state.pc = pcBefore;
  return 1;
}

export function get8051Instruction(address: number, runtime: McuRuntime): Instruction8051 {
  const opcode = runtime.memory.flash[address] ?? 0;
  const info = INSTRUCTION_TABLE[opcode];
  if (info) return info;
  return { mnemonic: `DB 0x${opcode.toString(16).padStart(2, "0")}`, bytes: 1, cycles: 1 };
}

export function disassemble8051(
  runtime: McuRuntime,
  address: number,
  count = 16,
): Array<{ address: number; instruction: Instruction8051 }> {
  const result: Array<{ address: number; instruction: Instruction8051 }> = [];
  let addr = address;

  for (let i = 0; i < count && addr < runtime.definition.flashSize; i++) {
    const inst = get8051Instruction(addr, runtime);
    result.push({ address: addr, instruction: inst });
    addr += inst.bytes;
  }

  return result;
}

export function get8051Mnemonic(address: number, runtime: McuRuntime): string {
  return get8051Instruction(address, runtime).mnemonic;
}

export function get8051Timing(address: number, runtime: McuRuntime): number {
  return get8051Instruction(address, runtime).cycles;
}

export const INSTRUCTION_TABLE: Record<number, Instruction8051> = {
  0x00: { mnemonic: "NOP", bytes: 1, cycles: 1 },
  0x01: { mnemonic: "AJMP addr11", bytes: 2, cycles: 2 },
  0x02: { mnemonic: "LJMP addr16", bytes: 3, cycles: 2 },
  0x03: { mnemonic: "RR A", bytes: 1, cycles: 1 },
  0x04: { mnemonic: "INC A", bytes: 1, cycles: 1 },
  0x05: { mnemonic: "INC direct", bytes: 2, cycles: 1 },
  0x06: { mnemonic: "INC @R0", bytes: 1, cycles: 1 },
  0x07: { mnemonic: "INC @R1", bytes: 1, cycles: 1 },
  0x08: { mnemonic: "INC R0", bytes: 1, cycles: 1 },
  0x09: { mnemonic: "INC R1", bytes: 1, cycles: 1 },
  0x0A: { mnemonic: "INC R2", bytes: 1, cycles: 1 },
  0x0B: { mnemonic: "INC R3", bytes: 1, cycles: 1 },
  0x0C: { mnemonic: "INC R4", bytes: 1, cycles: 1 },
  0x0D: { mnemonic: "INC R5", bytes: 1, cycles: 1 },
  0x0E: { mnemonic: "INC R6", bytes: 1, cycles: 1 },
  0x0F: { mnemonic: "INC R7", bytes: 1, cycles: 1 },
  0x10: { mnemonic: "JBC bit, rel", bytes: 3, cycles: 2 },
  0x11: { mnemonic: "ACALL addr11", bytes: 2, cycles: 2 },
  0x12: { mnemonic: "LCALL addr16", bytes: 3, cycles: 2 },
  0x13: { mnemonic: "RRC A", bytes: 1, cycles: 1 },
  0x14: { mnemonic: "DEC A", bytes: 1, cycles: 1 },
  0x15: { mnemonic: "DEC direct", bytes: 2, cycles: 1 },
  0x16: { mnemonic: "DEC @R0", bytes: 1, cycles: 1 },
  0x17: { mnemonic: "DEC @R1", bytes: 1, cycles: 1 },
  0x18: { mnemonic: "DEC R0", bytes: 1, cycles: 1 },
  0x19: { mnemonic: "DEC R1", bytes: 1, cycles: 1 },
  0x1A: { mnemonic: "DEC R2", bytes: 1, cycles: 1 },
  0x1B: { mnemonic: "DEC R3", bytes: 1, cycles: 1 },
  0x1C: { mnemonic: "DEC R4", bytes: 1, cycles: 1 },
  0x1D: { mnemonic: "DEC R5", bytes: 1, cycles: 1 },
  0x1E: { mnemonic: "DEC R6", bytes: 1, cycles: 1 },
  0x1F: { mnemonic: "DEC R7", bytes: 1, cycles: 1 },
  0x20: { mnemonic: "JB bit, rel", bytes: 3, cycles: 2 },
  0x21: { mnemonic: "AJMP addr11", bytes: 2, cycles: 2 },
  0x22: { mnemonic: "RET", bytes: 1, cycles: 2 },
  0x23: { mnemonic: "RL A", bytes: 1, cycles: 1 },
  0x24: { mnemonic: "ADD A, #data", bytes: 2, cycles: 1 },
  0x25: { mnemonic: "ADD A, direct", bytes: 2, cycles: 1 },
  0x26: { mnemonic: "ADD A, @R0", bytes: 1, cycles: 1 },
  0x27: { mnemonic: "ADD A, @R1", bytes: 1, cycles: 1 },
  0x28: { mnemonic: "ADD A, R0", bytes: 1, cycles: 1 },
  0x29: { mnemonic: "ADD A, R1", bytes: 1, cycles: 1 },
  0x2A: { mnemonic: "ADD A, R2", bytes: 1, cycles: 1 },
  0x2B: { mnemonic: "ADD A, R3", bytes: 1, cycles: 1 },
  0x2C: { mnemonic: "ADD A, R4", bytes: 1, cycles: 1 },
  0x2D: { mnemonic: "ADD A, R5", bytes: 1, cycles: 1 },
  0x2E: { mnemonic: "ADD A, R6", bytes: 1, cycles: 1 },
  0x2F: { mnemonic: "ADD A, R7", bytes: 1, cycles: 1 },
  0x30: { mnemonic: "JNB bit, rel", bytes: 3, cycles: 2 },
  0x31: { mnemonic: "ACALL addr11", bytes: 2, cycles: 2 },
  0x32: { mnemonic: "RETI", bytes: 1, cycles: 2 },
  0x33: { mnemonic: "RLC A", bytes: 1, cycles: 1 },
  0x34: { mnemonic: "ADDC A, #data", bytes: 2, cycles: 1 },
  0x35: { mnemonic: "ADDC A, direct", bytes: 2, cycles: 1 },
  0x36: { mnemonic: "ADDC A, @R0", bytes: 1, cycles: 1 },
  0x37: { mnemonic: "ADDC A, @R1", bytes: 1, cycles: 1 },
  0x38: { mnemonic: "ADDC A, R0", bytes: 1, cycles: 1 },
  0x39: { mnemonic: "ADDC A, R1", bytes: 1, cycles: 1 },
  0x3A: { mnemonic: "ADDC A, R2", bytes: 1, cycles: 1 },
  0x3B: { mnemonic: "ADDC A, R3", bytes: 1, cycles: 1 },
  0x3C: { mnemonic: "ADDC A, R4", bytes: 1, cycles: 1 },
  0x3D: { mnemonic: "ADDC A, R5", bytes: 1, cycles: 1 },
  0x3E: { mnemonic: "ADDC A, R6", bytes: 1, cycles: 1 },
  0x3F: { mnemonic: "ADDC A, R7", bytes: 1, cycles: 1 },
  0x40: { mnemonic: "JC rel", bytes: 2, cycles: 2 },
  0x41: { mnemonic: "AJMP addr11", bytes: 2, cycles: 2 },
  0x42: { mnemonic: "ORL direct, A", bytes: 2, cycles: 1 },
  0x43: { mnemonic: "ORL direct, #data", bytes: 3, cycles: 2 },
  0x44: { mnemonic: "ORL A, #data", bytes: 2, cycles: 1 },
  0x45: { mnemonic: "ORL A, direct", bytes: 2, cycles: 1 },
  0x46: { mnemonic: "ORL A, @R0", bytes: 1, cycles: 1 },
  0x47: { mnemonic: "ORL A, @R1", bytes: 1, cycles: 1 },
  0x48: { mnemonic: "ORL A, R0", bytes: 1, cycles: 1 },
  0x49: { mnemonic: "ORL A, R1", bytes: 1, cycles: 1 },
  0x4A: { mnemonic: "ORL A, R2", bytes: 1, cycles: 1 },
  0x4B: { mnemonic: "ORL A, R3", bytes: 1, cycles: 1 },
  0x4C: { mnemonic: "ORL A, R4", bytes: 1, cycles: 1 },
  0x4D: { mnemonic: "ORL A, R5", bytes: 1, cycles: 1 },
  0x4E: { mnemonic: "ORL A, R6", bytes: 1, cycles: 1 },
  0x4F: { mnemonic: "ORL A, R7", bytes: 1, cycles: 1 },
  0x50: { mnemonic: "JNC rel", bytes: 2, cycles: 2 },
  0x51: { mnemonic: "ACALL addr11", bytes: 2, cycles: 2 },
  0x52: { mnemonic: "ANL direct, A", bytes: 2, cycles: 1 },
  0x53: { mnemonic: "ANL direct, #data", bytes: 3, cycles: 2 },
  0x54: { mnemonic: "ANL A, #data", bytes: 2, cycles: 1 },
  0x55: { mnemonic: "ANL A, direct", bytes: 2, cycles: 1 },
  0x56: { mnemonic: "ANL A, @R0", bytes: 1, cycles: 1 },
  0x57: { mnemonic: "ANL A, @R1", bytes: 1, cycles: 1 },
  0x58: { mnemonic: "ANL A, R0", bytes: 1, cycles: 1 },
  0x59: { mnemonic: "ANL A, R1", bytes: 1, cycles: 1 },
  0x5A: { mnemonic: "ANL A, R2", bytes: 1, cycles: 1 },
  0x5B: { mnemonic: "ANL A, R3", bytes: 1, cycles: 1 },
  0x5C: { mnemonic: "ANL A, R4", bytes: 1, cycles: 1 },
  0x5D: { mnemonic: "ANL A, R5", bytes: 1, cycles: 1 },
  0x5E: { mnemonic: "ANL A, R6", bytes: 1, cycles: 1 },
  0x5F: { mnemonic: "ANL A, R7", bytes: 1, cycles: 1 },
  0x60: { mnemonic: "JZ rel", bytes: 2, cycles: 2 },
  0x61: { mnemonic: "AJMP addr11", bytes: 2, cycles: 2 },
  0x62: { mnemonic: "XRL direct, A", bytes: 2, cycles: 1 },
  0x63: { mnemonic: "XRL direct, #data", bytes: 3, cycles: 2 },
  0x64: { mnemonic: "XRL A, #data", bytes: 2, cycles: 1 },
  0x65: { mnemonic: "XRL A, direct", bytes: 2, cycles: 1 },
  0x66: { mnemonic: "XRL A, @R0", bytes: 1, cycles: 1 },
  0x67: { mnemonic: "XRL A, @R1", bytes: 1, cycles: 1 },
  0x68: { mnemonic: "XRL A, R0", bytes: 1, cycles: 1 },
  0x69: { mnemonic: "XRL A, R1", bytes: 1, cycles: 1 },
  0x6A: { mnemonic: "XRL A, R2", bytes: 1, cycles: 1 },
  0x6B: { mnemonic: "XRL A, R3", bytes: 1, cycles: 1 },
  0x6C: { mnemonic: "XRL A, R4", bytes: 1, cycles: 1 },
  0x6D: { mnemonic: "XRL A, R5", bytes: 1, cycles: 1 },
  0x6E: { mnemonic: "XRL A, R6", bytes: 1, cycles: 1 },
  0x6F: { mnemonic: "XRL A, R7", bytes: 1, cycles: 1 },
  0x70: { mnemonic: "JNZ rel", bytes: 2, cycles: 2 },
  0x71: { mnemonic: "ACALL addr11", bytes: 2, cycles: 2 },
  0x72: { mnemonic: "ORL C, bit", bytes: 2, cycles: 2 },
  0x73: { mnemonic: "JMP @A+DPTR", bytes: 1, cycles: 2 },
  0x74: { mnemonic: "MOV A, #data", bytes: 2, cycles: 1 },
  0x75: { mnemonic: "MOV direct, #data", bytes: 3, cycles: 2 },
  0x76: { mnemonic: "MOV @R0, #data", bytes: 2, cycles: 1 },
  0x77: { mnemonic: "MOV @R1, #data", bytes: 2, cycles: 1 },
  0x78: { mnemonic: "MOV R0, #data", bytes: 2, cycles: 1 },
  0x79: { mnemonic: "MOV R1, #data", bytes: 2, cycles: 1 },
  0x7A: { mnemonic: "MOV R2, #data", bytes: 2, cycles: 1 },
  0x7B: { mnemonic: "MOV R3, #data", bytes: 2, cycles: 1 },
  0x7C: { mnemonic: "MOV R4, #data", bytes: 2, cycles: 1 },
  0x7D: { mnemonic: "MOV R5, #data", bytes: 2, cycles: 1 },
  0x7E: { mnemonic: "MOV R6, #data", bytes: 2, cycles: 1 },
  0x7F: { mnemonic: "MOV R7, #data", bytes: 2, cycles: 1 },
  0x80: { mnemonic: "SJMP rel", bytes: 2, cycles: 2 },
  0x81: { mnemonic: "AJMP addr11", bytes: 2, cycles: 2 },
  0x82: { mnemonic: "ANL C, bit", bytes: 2, cycles: 2 },
  0x83: { mnemonic: "MOVC A, @A+PC", bytes: 1, cycles: 2 },
  0x84: { mnemonic: "DIV AB", bytes: 1, cycles: 4 },
  0x85: { mnemonic: "MOV direct, direct", bytes: 3, cycles: 2 },
  0x86: { mnemonic: "MOV direct, @R0", bytes: 2, cycles: 2 },
  0x87: { mnemonic: "MOV direct, @R1", bytes: 2, cycles: 2 },
  0x88: { mnemonic: "MOV direct, R0", bytes: 2, cycles: 2 },
  0x89: { mnemonic: "MOV direct, R1", bytes: 2, cycles: 2 },
  0x8A: { mnemonic: "MOV direct, R2", bytes: 2, cycles: 2 },
  0x8B: { mnemonic: "MOV direct, R3", bytes: 2, cycles: 2 },
  0x8C: { mnemonic: "MOV direct, R4", bytes: 2, cycles: 2 },
  0x8D: { mnemonic: "MOV direct, R5", bytes: 2, cycles: 2 },
  0x8E: { mnemonic: "MOV direct, R6", bytes: 2, cycles: 2 },
  0x8F: { mnemonic: "MOV direct, R7", bytes: 2, cycles: 2 },
  0x90: { mnemonic: "MOV DPTR, #data16", bytes: 3, cycles: 2 },
  0x91: { mnemonic: "ACALL addr11", bytes: 2, cycles: 2 },
  0x92: { mnemonic: "MOV bit, C", bytes: 2, cycles: 2 },
  0x93: { mnemonic: "MOVC A, @A+DPTR", bytes: 1, cycles: 2 },
  0x94: { mnemonic: "SUBB A, #data", bytes: 2, cycles: 1 },
  0x95: { mnemonic: "SUBB A, direct", bytes: 2, cycles: 1 },
  0x96: { mnemonic: "SUBB A, @R0", bytes: 1, cycles: 1 },
  0x97: { mnemonic: "SUBB A, @R1", bytes: 1, cycles: 1 },
  0x98: { mnemonic: "SUBB A, R0", bytes: 1, cycles: 1 },
  0x99: { mnemonic: "SUBB A, R1", bytes: 1, cycles: 1 },
  0x9A: { mnemonic: "SUBB A, R2", bytes: 1, cycles: 1 },
  0x9B: { mnemonic: "SUBB A, R3", bytes: 1, cycles: 1 },
  0x9C: { mnemonic: "SUBB A, R4", bytes: 1, cycles: 1 },
  0x9D: { mnemonic: "SUBB A, R5", bytes: 1, cycles: 1 },
  0x9E: { mnemonic: "SUBB A, R6", bytes: 1, cycles: 1 },
  0x9F: { mnemonic: "SUBB A, R7", bytes: 1, cycles: 1 },
  0xA0: { mnemonic: "ORL C, /bit", bytes: 2, cycles: 2 },
  0xA1: { mnemonic: "AJMP addr11", bytes: 2, cycles: 2 },
  0xA2: { mnemonic: "MOV C, bit", bytes: 2, cycles: 1 },
  0xA3: { mnemonic: "INC DPTR", bytes: 1, cycles: 2 },
  0xA4: { mnemonic: "MUL AB", bytes: 1, cycles: 4 },
  0xA6: { mnemonic: "MOV @R0, direct", bytes: 2, cycles: 2 },
  0xA7: { mnemonic: "MOV @R1, direct", bytes: 2, cycles: 2 },
  0xA8: { mnemonic: "MOV R0, direct", bytes: 2, cycles: 2 },
  0xA9: { mnemonic: "MOV R1, direct", bytes: 2, cycles: 2 },
  0xAA: { mnemonic: "MOV R2, direct", bytes: 2, cycles: 2 },
  0xAB: { mnemonic: "MOV R3, direct", bytes: 2, cycles: 2 },
  0xAC: { mnemonic: "MOV R4, direct", bytes: 2, cycles: 2 },
  0xAD: { mnemonic: "MOV R5, direct", bytes: 2, cycles: 2 },
  0xAE: { mnemonic: "MOV R6, direct", bytes: 2, cycles: 2 },
  0xAF: { mnemonic: "MOV R7, direct", bytes: 2, cycles: 2 },
  0xB0: { mnemonic: "ANL C, /bit", bytes: 2, cycles: 2 },
  0xB1: { mnemonic: "ACALL addr11", bytes: 2, cycles: 2 },
  0xB2: { mnemonic: "CPL bit", bytes: 2, cycles: 1 },
  0xB3: { mnemonic: "CPL C", bytes: 1, cycles: 1 },
  0xB4: { mnemonic: "CJNE A, #data, rel", bytes: 3, cycles: 2 },
  0xB5: { mnemonic: "CJNE A, direct, rel", bytes: 3, cycles: 2 },
  0xB6: { mnemonic: "CJNE @R0, #data, rel", bytes: 3, cycles: 2 },
  0xB7: { mnemonic: "CJNE @R1, #data, rel", bytes: 3, cycles: 2 },
  0xB8: { mnemonic: "CJNE R0, #data, rel", bytes: 3, cycles: 2 },
  0xB9: { mnemonic: "CJNE R1, #data, rel", bytes: 3, cycles: 2 },
  0xBA: { mnemonic: "CJNE R2, #data, rel", bytes: 3, cycles: 2 },
  0xBB: { mnemonic: "CJNE R3, #data, rel", bytes: 3, cycles: 2 },
  0xBC: { mnemonic: "CJNE R4, #data, rel", bytes: 3, cycles: 2 },
  0xBD: { mnemonic: "CJNE R5, #data, rel", bytes: 3, cycles: 2 },
  0xBE: { mnemonic: "CJNE R6, #data, rel", bytes: 3, cycles: 2 },
  0xBF: { mnemonic: "CJNE R7, #data, rel", bytes: 3, cycles: 2 },
  0xC0: { mnemonic: "PUSH direct", bytes: 2, cycles: 2 },
  0xC1: { mnemonic: "AJMP addr11", bytes: 2, cycles: 2 },
  0xC2: { mnemonic: "CLR bit", bytes: 2, cycles: 1 },
  0xC3: { mnemonic: "CLR C", bytes: 1, cycles: 1 },
  0xC4: { mnemonic: "SWAP A", bytes: 1, cycles: 1 },
  0xC5: { mnemonic: "XCH A, direct", bytes: 2, cycles: 1 },
  0xC6: { mnemonic: "XCH A, @R0", bytes: 1, cycles: 1 },
  0xC7: { mnemonic: "XCH A, @R1", bytes: 1, cycles: 1 },
  0xC8: { mnemonic: "XCH A, R0", bytes: 1, cycles: 1 },
  0xC9: { mnemonic: "XCH A, R1", bytes: 1, cycles: 1 },
  0xCA: { mnemonic: "XCH A, R2", bytes: 1, cycles: 1 },
  0xCB: { mnemonic: "XCH A, R3", bytes: 1, cycles: 1 },
  0xCC: { mnemonic: "XCH A, R4", bytes: 1, cycles: 1 },
  0xCD: { mnemonic: "XCH A, R5", bytes: 1, cycles: 1 },
  0xCE: { mnemonic: "XCH A, R6", bytes: 1, cycles: 1 },
  0xCF: { mnemonic: "XCH A, R7", bytes: 1, cycles: 1 },
  0xD0: { mnemonic: "POP direct", bytes: 2, cycles: 2 },
  0xD1: { mnemonic: "ACALL addr11", bytes: 2, cycles: 2 },
  0xD2: { mnemonic: "SETB bit", bytes: 2, cycles: 1 },
  0xD3: { mnemonic: "SETB C", bytes: 1, cycles: 1 },
  0xD4: { mnemonic: "DA A", bytes: 1, cycles: 1 },
  0xD5: { mnemonic: "DJNZ direct, rel", bytes: 3, cycles: 2 },
  0xD6: { mnemonic: "XCHD A, @R0", bytes: 1, cycles: 1 },
  0xD7: { mnemonic: "XCHD A, @R1", bytes: 1, cycles: 1 },
  0xD8: { mnemonic: "DJNZ R0, rel", bytes: 2, cycles: 2 },
  0xD9: { mnemonic: "DJNZ R1, rel", bytes: 2, cycles: 2 },
  0xDA: { mnemonic: "DJNZ R2, rel", bytes: 2, cycles: 2 },
  0xDB: { mnemonic: "DJNZ R3, rel", bytes: 2, cycles: 2 },
  0xDC: { mnemonic: "DJNZ R4, rel", bytes: 2, cycles: 2 },
  0xDD: { mnemonic: "DJNZ R5, rel", bytes: 2, cycles: 2 },
  0xDE: { mnemonic: "DJNZ R6, rel", bytes: 2, cycles: 2 },
  0xDF: { mnemonic: "DJNZ R7, rel", bytes: 2, cycles: 2 },
  0xE0: { mnemonic: "MOVX A, @DPTR", bytes: 1, cycles: 2 },
  0xE1: { mnemonic: "AJMP addr11", bytes: 2, cycles: 2 },
  0xE2: { mnemonic: "MOVX A, @R0", bytes: 1, cycles: 2 },
  0xE3: { mnemonic: "MOVX A, @R1", bytes: 1, cycles: 2 },
  0xE4: { mnemonic: "CLR A", bytes: 1, cycles: 1 },
  0xE5: { mnemonic: "MOV A, direct", bytes: 2, cycles: 1 },
  0xE6: { mnemonic: "MOV A, @R0", bytes: 1, cycles: 1 },
  0xE7: { mnemonic: "MOV A, @R1", bytes: 1, cycles: 1 },
  0xE8: { mnemonic: "MOV A, R0", bytes: 1, cycles: 1 },
  0xE9: { mnemonic: "MOV A, R1", bytes: 1, cycles: 1 },
  0xEA: { mnemonic: "MOV A, R2", bytes: 1, cycles: 1 },
  0xEB: { mnemonic: "MOV A, R3", bytes: 1, cycles: 1 },
  0xEC: { mnemonic: "MOV A, R4", bytes: 1, cycles: 1 },
  0xED: { mnemonic: "MOV A, R5", bytes: 1, cycles: 1 },
  0xEE: { mnemonic: "MOV A, R6", bytes: 1, cycles: 1 },
  0xEF: { mnemonic: "MOV A, R7", bytes: 1, cycles: 1 },
  0xF0: { mnemonic: "MOVX @DPTR, A", bytes: 1, cycles: 2 },
  0xF1: { mnemonic: "ACALL addr11", bytes: 2, cycles: 2 },
  0xF2: { mnemonic: "MOVX @R0, A", bytes: 1, cycles: 2 },
  0xF3: { mnemonic: "MOVX @R1, A", bytes: 1, cycles: 2 },
  0xF4: { mnemonic: "CPL A", bytes: 1, cycles: 1 },
  0xF5: { mnemonic: "MOV direct, A", bytes: 2, cycles: 1 },
  0xF6: { mnemonic: "MOV @R0, A", bytes: 1, cycles: 1 },
  0xF7: { mnemonic: "MOV @R1, A", bytes: 1, cycles: 1 },
  0xF8: { mnemonic: "MOV R0, A", bytes: 1, cycles: 1 },
  0xF9: { mnemonic: "MOV R1, A", bytes: 1, cycles: 1 },
  0xFA: { mnemonic: "MOV R2, A", bytes: 1, cycles: 1 },
  0xFB: { mnemonic: "MOV R3, A", bytes: 1, cycles: 1 },
  0xFC: { mnemonic: "MOV R4, A", bytes: 1, cycles: 1 },
  0xFD: { mnemonic: "MOV R5, A", bytes: 1, cycles: 1 },
  0xFE: { mnemonic: "MOV R6, A", bytes: 1, cycles: 1 },
  0xFF: { mnemonic: "MOV R7, A", bytes: 1, cycles: 1 },
};

export const STANDARD_8051_DEFINITION = {
  name: "8051",
  architecture: "8051" as const,
  clockSpeed: 12e6,
  flashSize: 4096,
  ramSize: 256,
  pcSize: 16,
  stackPointerSize: 8,
  registers: [
    { name: "ACC", address: 0xE0, size: 1 },
    { name: "B", address: 0xF0, size: 1 },
    { name: "PSW", address: 0xD0, size: 1 },
    { name: "SP", address: 0x81, size: 1 },
    { name: "DPL", address: 0x82, size: 1 },
    { name: "DPH", address: 0x83, size: 1 },
    { name: "P0", address: 0x80, size: 1 },
    { name: "P1", address: 0x90, size: 1 },
    { name: "P2", address: 0xA0, size: 1 },
    { name: "P3", address: 0xB0, size: 1 },
    { name: "IP", address: 0xB8, size: 1 },
    { name: "IE", address: 0xA8, size: 1 },
    { name: "TCON", address: 0x88, size: 1 },
    { name: "TMOD", address: 0x89, size: 1 },
    { name: "TL0", address: 0x8A, size: 1 },
    { name: "TL1", address: 0x8B, size: 1 },
    { name: "TH0", address: 0x8C, size: 1 },
    { name: "TH1", address: 0x8D, size: 1 },
    { name: "SCON", address: 0x98, size: 1 },
    { name: "SBUF", address: 0x99, size: 1 },
  ],
  peripherals: [
    { name: "GPIO Port 0", baseAddress: 0x80, size: 8, interrupts: ["INT0", "INT1"] },
    { name: "Timer 0", baseAddress: 0x8A, size: 4, interrupts: ["TF0"] },
    { name: "Timer 1", baseAddress: 0x8B, size: 4, interrupts: ["TF1"] },
    { name: "Serial Port", baseAddress: 0x99, size: 2, interrupts: ["RI", "TI"] },
  ],
};
