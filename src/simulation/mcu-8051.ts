/** Simulación instruction-set accurate para 8051.
 * Implementa el subset más común de instrucciones.
 */
import type { McuRuntime } from "./mcu-runtime";

export type Instruction8051 = {
  mnemonic: string;
  bytes: number;
  cycles: number;
};

export const INSTRUCTION_TABLE: Record<number, Instruction8051> = {
  [0x00]: { mnemonic: "NOP", bytes: 1, cycles: 1 },
  [0x02]: { mnemonic: "LJMP", bytes: 3, cycles: 2 },
  [0x12]: { mnemonic: "AJMP", bytes: 2, cycles: 2 },
  [0x03]: { mnemonic: "RR A", bytes: 1, cycles: 1 },
  [0x04]: { mnemonic: "INC A", bytes: 1, cycles: 1 },
  [0x05]: { mnemonic: "INC", bytes: 2, cycles: 1 },
  [0x08]: { mnemonic: "INC", bytes: 2, cycles: 1 },
  [0x09]: { mnemonic: "INC", bytes: 2, cycles: 1 },
  [0x0A]: { mnemonic: "INC", bytes: 2, cycles: 1 },
  [0x0B]: { mnemonic: "INC", bytes: 2, cycles: 1 },
  [0x0C]: { mnemonic: "INC", bytes: 2, cycles: 1 },
  [0x0D]: { mnemonic: "INC", bytes: 2, cycles: 1 },
  [0x0E]: { mnemonic: "INC", bytes: 2, cycles: 1 },
  [0x0F]: { mnemonic: "INC", bytes: 2, cycles: 1 },
  [0x10]: { mnemonic: "JBC", bytes: 3, cycles: 2 },
  [0x13]: { mnemonic: "RRC A", bytes: 1, cycles: 1 },
  [0x14]: { mnemonic: "DEC A", bytes: 1, cycles: 1 },
  [0x15]: { mnemonic: "DEC", bytes: 2, cycles: 1 },
  [0x18]: { mnemonic: "DEC", bytes: 2, cycles: 1 },
  [0x19]: { mnemonic: "DEC", bytes: 2, cycles: 1 },
  [0x1A]: { mnemonic: "DEC", bytes: 2, cycles: 1 },
  [0x1B]: { mnemonic: "DEC", bytes: 2, cycles: 1 },
  [0x1C]: { mnemonic: "DEC", bytes: 2, cycles: 1 },
  [0x1D]: { mnemonic: "DEC", bytes: 2, cycles: 1 },
  [0x1E]: { mnemonic: "DEC", bytes: 2, cycles: 1 },
  [0x1F]: { mnemonic: "DEC", bytes: 2, cycles: 1 },
  [0x20]: { mnemonic: "JB", bytes: 3, cycles: 2 },
  [0x22]: { mnemonic: "RET", bytes: 1, cycles: 2 },
  [0x23]: { mnemonic: "RL A", bytes: 1, cycles: 1 },
  [0x24]: { mnemonic: "ADDC A,", bytes: 2, cycles: 1 },
  [0x25]: { mnemonic: "ADDC A,", bytes: 2, cycles: 1 },
  [0x28]: { mnemonic: "ADDC A,", bytes: 2, cycles: 1 },
  [0x29]: { mnemonic: "ADDC A,", bytes: 2, cycles: 1 },
  [0x2A]: { mnemonic: "ADDC A,", bytes: 2, cycles: 1 },
  [0x2B]: { mnemonic: "ADDC A,", bytes: 2, cycles: 1 },
  [0x2C]: { mnemonic: "ADDC A,", bytes: 2, cycles: 1 },
  [0x2D]: { mnemonic: "ADDC A,", bytes: 2, cycles: 1 },
  [0x2E]: { mnemonic: "ADDC A,", bytes: 2, cycles: 1 },
  [0x2F]: { mnemonic: "ADDC A,", bytes: 2, cycles: 1 },
  [0x30]: { mnemonic: "JNB", bytes: 3, cycles: 2 },
  [0x32]: { mnemonic: "RETI", bytes: 1, cycles: 2 },
  [0x33]: { mnemonic: "RLC A", bytes: 1, cycles: 1 },
  [0x34]: { mnemonic: "ADDC A,", bytes: 2, cycles: 1 },
  [0x35]: { mnemonic: "ADDC A,", bytes: 2, cycles: 1 },
  [0x38]: { mnemonic: "ADDC A,", bytes: 2, cycles: 1 },
  [0x39]: { mnemonic: "ADDC A,", bytes: 2, cycles: 1 },
  [0x3A]: { mnemonic: "ADDC A,", bytes: 2, cycles: 1 },
  [0x3B]: { mnemonic: "ADDC A,", bytes: 2, cycles: 1 },
  [0x3C]: { mnemonic: "ADDC A,", bytes: 2, cycles: 1 },
  [0x3D]: { mnemonic: "ADDC A,", bytes: 2, cycles: 1 },
  [0x3E]: { mnemonic: "ADDC A,", bytes: 2, cycles: 1 },
  [0x3F]: { mnemonic: "ADDC A,", bytes: 2, cycles: 1 },
  [0x40]: { mnemonic: "JC", bytes: 2, cycles: 2 },
  [0x42]: { mnemonic: "ORL", bytes: 2, cycles: 1 },
  [0x43]: { mnemonic: "ORL", bytes: 3, cycles: 2 },
  [0x44]: { mnemonic: "ORL A,", bytes: 2, cycles: 1 },
  [0x45]: { mnemonic: "ORL A,", bytes: 2, cycles: 1 },
  [0x48]: { mnemonic: "ORL A,", bytes: 2, cycles: 1 },
  [0x49]: { mnemonic: "ORL A,", bytes: 2, cycles: 1 },
  [0x4A]: { mnemonic: "ORL A,", bytes: 2, cycles: 1 },
  [0x4B]: { mnemonic: "ORL A,", bytes: 2, cycles: 1 },
  [0x4C]: { mnemonic: "ORL A,", bytes: 2, cycles: 1 },
  [0x4D]: { mnemonic: "ORL A,", bytes: 2, cycles: 1 },
  [0x4E]: { mnemonic: "ORL A,", bytes: 2, cycles: 1 },
  [0x4F]: { mnemonic: "ORL A,", bytes: 2, cycles: 1 },
  [0x50]: { mnemonic: "JNC", bytes: 2, cycles: 2 },
  [0x52]: { mnemonic: "ANL", bytes: 2, cycles: 1 },
  [0x53]: { mnemonic: "ANL", bytes: 3, cycles: 2 },
  [0x54]: { mnemonic: "ANL A,", bytes: 2, cycles: 1 },
  [0x55]: { mnemonic: "ANL A,", bytes: 2, cycles: 1 },
  [0x58]: { mnemonic: "ANL A,", bytes: 2, cycles: 1 },
  [0x59]: { mnemonic: "ANL A,", bytes: 2, cycles: 1 },
  [0x5A]: { mnemonic: "ANL A,", bytes: 2, cycles: 1 },
  [0x5B]: { mnemonic: "ANL A,", bytes: 2, cycles: 1 },
  [0x5C]: { mnemonic: "ANL A,", bytes: 2, cycles: 1 },
  [0x5D]: { mnemonic: "ANL A,", bytes: 2, cycles: 1 },
  [0x5E]: { mnemonic: "ANL A,", bytes: 2, cycles: 1 },
  [0x5F]: { mnemonic: "ANL A,", bytes: 2, cycles: 1 },
  [0x60]: { mnemonic: "JZ", bytes: 2, cycles: 2 },
  [0x62]: { mnemonic: "XRL", bytes: 2, cycles: 1 },
  [0x63]: { mnemonic: "XRL", bytes: 3, cycles: 2 },
  [0x64]: { mnemonic: "XRL A,", bytes: 2, cycles: 1 },
  [0x65]: { mnemonic: "XRL A,", bytes: 2, cycles: 1 },
  [0x68]: { mnemonic: "XRL A,", bytes: 2, cycles: 1 },
  [0x69]: { mnemonic: "XRL A,", bytes: 2, cycles: 1 },
  [0x6A]: { mnemonic: "XRL A,", bytes: 2, cycles: 1 },
  [0x6B]: { mnemonic: "XRL A,", bytes: 2, cycles: 1 },
  [0x6C]: { mnemonic: "XRL A,", bytes: 2, cycles: 1 },
  [0x6D]: { mnemonic: "XRL A,", bytes: 2, cycles: 1 },
  [0x6E]: { mnemonic: "XRL A,", bytes: 2, cycles: 1 },
  [0x6F]: { mnemonic: "XRL A,", bytes: 2, cycles: 1 },
  [0x70]: { mnemonic: "JNZ", bytes: 2, cycles: 2 },
  [0x73]: { mnemonic: "JMP @A+DPTR", bytes: 1, cycles: 2 },
  [0x74]: { mnemonic: "MOV A,", bytes: 2, cycles: 1 },
  [0x75]: { mnemonic: "MOV", bytes: 3, cycles: 2 },
  [0x77]: { mnemonic: "MOV", bytes: 3, cycles: 2 },
  [0x78]: { mnemonic: "MOV", bytes: 2, cycles: 1 },
  [0x79]: { mnemonic: "MOV", bytes: 2, cycles: 1 },
  [0x7A]: { mnemonic: "MOV", bytes: 2, cycles: 1 },
  [0x7B]: { mnemonic: "MOV", bytes: 2, cycles: 1 },
  [0x7C]: { mnemonic: "MOV", bytes: 2, cycles: 1 },
  [0x7D]: { mnemonic: "MOV", bytes: 2, cycles: 1 },
  [0x7E]: { mnemonic: "MOV", bytes: 2, cycles: 1 },
  [0x7F]: { mnemonic: "MOV", bytes: 2, cycles: 1 },
  [0x80]: { mnemonic: "SJMP", bytes: 2, cycles: 2 },
  [0x90]: { mnemonic: "MOVC A,@A+DPTR", bytes: 3, cycles: 2 },
  [0xA0]: { mnemonic: "ORL C,", bytes: 2, cycles: 2 },
  [0xA2]: { mnemonic: "MOV C,", bytes: 2, cycles: 1 },
  [0xA3]: { mnemonic: "INC DPTR", bytes: 1, cycles: 2 },
  [0xA4]: { mnemonic: "MUL AB", bytes: 1, cycles: 4 },
  [0xA8]: { mnemonic: "MOV", bytes: 2, cycles: 1 },
  [0xA9]: { mnemonic: "MOV", bytes: 2, cycles: 1 },
  [0xAA]: { mnemonic: "MOV", bytes: 2, cycles: 1 },
  [0xAB]: { mnemonic: "MOV", bytes: 2, cycles: 1 },
  [0xAC]: { mnemonic: "MOV", bytes: 2, cycles: 1 },
  [0xAD]: { mnemonic: "MOV", bytes: 2, cycles: 1 },
  [0xAE]: { mnemonic: "MOV", bytes: 2, cycles: 1 },
  [0xAF]: { mnemonic: "MOV", bytes: 2, cycles: 1 },
  [0xB0]: { mnemonic: "ANL C,", bytes: 2, cycles: 2 },
  [0xB2]: { mnemonic: "CPL", bytes: 2, cycles: 1 },
  [0xB3]: { mnemonic: "CPL C", bytes: 1, cycles: 1 },
  [0xB4]: { mnemonic: "CJNE", bytes: 3, cycles: 2 },
  [0xB5]: { mnemonic: "CJNE", bytes: 3, cycles: 2 },
  [0xB8]: { mnemonic: "CJNE", bytes: 3, cycles: 2 },
  [0xB9]: { mnemonic: "CJNE", bytes: 3, cycles: 2 },
  [0xBA]: { mnemonic: "CJNE", bytes: 3, cycles: 2 },
  [0xBB]: { mnemonic: "CJNE", bytes: 3, cycles: 2 },
  [0xBC]: { mnemonic: "CJNE", bytes: 3, cycles: 2 },
  [0xBD]: { mnemonic: "CJNE", bytes: 3, cycles: 2 },
  [0xBE]: { mnemonic: "CJNE", bytes: 3, cycles: 2 },
  [0xBF]: { mnemonic: "CJNE", bytes: 3, cycles: 2 },
  [0xC0]: { mnemonic: "PUSH", bytes: 2, cycles: 2 },
  [0xC2]: { mnemonic: "CLR", bytes: 2, cycles: 1 },
  [0xC3]: { mnemonic: "CLR C", bytes: 1, cycles: 1 },
  [0xC4]: { mnemonic: "SWAP A", bytes: 1, cycles: 1 },
  [0xC5]: { mnemonic: "XCH", bytes: 2, cycles: 1 },
  [0xC8]: { mnemonic: "XCH", bytes: 2, cycles: 1 },
  [0xC9]: { mnemonic: "XCH", bytes: 2, cycles: 1 },
  [0xCA]: { mnemonic: "XCH", bytes: 2, cycles: 1 },
  [0xCB]: { mnemonic: "XCH", bytes: 2, cycles: 1 },
  [0xCC]: { mnemonic: "XCH", bytes: 2, cycles: 1 },
  [0xCD]: { mnemonic: "XCH", bytes: 2, cycles: 1 },
  [0xCE]: { mnemonic: "XCH", bytes: 2, cycles: 1 },
  [0xCF]: { mnemonic: "XCH", bytes: 2, cycles: 1 },
  [0xD0]: { mnemonic: "POP", bytes: 2, cycles: 2 },
  [0xD2]: { mnemonic: "SETB", bytes: 2, cycles: 1 },
  [0xD3]: { mnemonic: "SETB C", bytes: 1, cycles: 1 },
  [0xD4]: { mnemonic: "DA A", bytes: 1, cycles: 1 },
  [0xD5]: { mnemonic: "DJNZ", bytes: 3, cycles: 2 },
  [0xD8]: { mnemonic: "DJNZ", bytes: 3, cycles: 2 },
  [0xD9]: { mnemonic: "DJNZ", bytes: 3, cycles: 2 },
  [0xDA]: { mnemonic: "DJNZ", bytes: 3, cycles: 2 },
  [0xDB]: { mnemonic: "DJNZ", bytes: 3, cycles: 2 },
  [0xDC]: { mnemonic: "DJNZ", bytes: 3, cycles: 2 },
  [0xDD]: { mnemonic: "DJNZ", bytes: 3, cycles: 2 },
  [0xDE]: { mnemonic: "DJNZ", bytes: 3, cycles: 2 },
  [0xDF]: { mnemonic: "DJNZ", bytes: 3, cycles: 2 },
  [0xE0]: { mnemonic: "MOVX A,@A+DPTR", bytes: 1, cycles: 2 },
  [0xE4]: { mnemonic: "CLR A", bytes: 1, cycles: 1 },
  [0xE5]: { mnemonic: "MOV A,", bytes: 2, cycles: 1 },
  [0xE8]: { mnemonic: "MOV A,", bytes: 2, cycles: 1 },
  [0xE9]: { mnemonic: "MOV A,", bytes: 2, cycles: 1 },
  [0xEA]: { mnemonic: "MOV A,", bytes: 2, cycles: 1 },
  [0xEB]: { mnemonic: "MOV A,", bytes: 2, cycles: 1 },
  [0xEC]: { mnemonic: "MOV A,", bytes: 2, cycles: 1 },
  [0xED]: { mnemonic: "MOV A,", bytes: 2, cycles: 1 },
  [0xEE]: { mnemonic: "MOV A,", bytes: 2, cycles: 1 },
  [0xEF]: { mnemonic: "MOV A,", bytes: 2, cycles: 1 },
  [0xF0]: { mnemonic: "MOVX @DPTR,A", bytes: 1, cycles: 2 },
  [0xF4]: { mnemonic: "CPL A", bytes: 1, cycles: 1 },
  [0xF5]: { mnemonic: "MOV", bytes: 2, cycles: 1 },
  [0xF8]: { mnemonic: "MOV", bytes: 2, cycles: 1 },
  [0xF9]: { mnemonic: "MOV", bytes: 2, cycles: 1 },
  [0xFA]: { mnemonic: "MOV", bytes: 2, cycles: 1 },
  [0xFB]: { mnemonic: "MOV", bytes: 2, cycles: 1 },
  [0xFC]: { mnemonic: "MOV", bytes: 2, cycles: 1 },
  [0xFD]: { mnemonic: "MOV", bytes: 2, cycles: 1 },
  [0xFE]: { mnemonic: "MOV", bytes: 2, cycles: 1 },
  [0xFF]: { mnemonic: "MOV", bytes: 2, cycles: 1 }
};

export function get8051Instruction(address: number, runtime: McuRuntime): Instruction8051 {
  const opcode = runtime.memory.flash[address] ?? 0;
  const info = INSTRUCTION_TABLE[opcode];
  if (info) return info;
  return { mnemonic: "???", bytes: 1, cycles: 1 };
}

export function disassemble8051(
  runtime: McuRuntime,
  address: number,
  count: number = 16
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
  const inst = get8051Instruction(address, runtime);
  return inst.mnemonic;
}

export function get8051Timing(address: number, runtime: McuRuntime): number {
  const inst = get8051Instruction(address, runtime);
  return inst.cycles;
}

export const STANDARD_8051_DEFINITION = {
  name: "8051",
  architecture: "8051" as const,
  clockSpeed: 12e6,
  flashSize: 4096,
  ramSize: 128,
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
    { name: "SBUF", address: 0x99, size: 1 }
  ],
  peripherals: [
    { name: "GPIO Port 0", baseAddress: 0x80, size: 8, interrupts: ["INT0", "INT1"] },
    { name: "Timer 0", baseAddress: 0x8A, size: 4, interrupts: ["TF0"] },
    { name: "Timer 1", baseAddress: 0x8B, size: 4, interrupts: ["TF1"] },
    { name: "Serial Port", baseAddress: 0x99, size: 2, interrupts: ["RI", "TI"] }
  ]
};