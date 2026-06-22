/** Tipos base para simulación de microcontroladores.
 */
export type McuClockSpeed = number;

export type McuRegister = {
  name: string;
  address: number;
  size: number;
  initialValue?: number;
};

export type McuPeripheral = {
  name: string;
  baseAddress: number;
  size: number;
  interrupts: string[];
};

export type McuDefinition = {
  name: string;
  architecture: "8051" | "avr" | "arm-cortex-m0";
  clockSpeed: McuClockSpeed;
  flashSize: number;
  ramSize: number;
  registers: McuRegister[];
  peripherals: McuPeripheral[];
  pcSize: number;
  stackPointerSize: number;
};

export type McuMemoryMap = {
  flash: Uint8Array;
  ram: Uint8Array;
  sfr: Uint8Array;
};

export type McuExecutionState = {
  pc: number;
  sp: number;
  cycle: number;
  running: boolean;
  halted: boolean;
};

export type McuBreakpoint = {
  address: number;
  enabled: boolean;
  condition?: string;
  hitCount: number;
};

export type McuWatchpoint = {
  address: number;
  size: number;
  type: "read" | "write" | "both";
  enabled: boolean;
  hitCount: number;
};

export type McuInterrupt = {
  name: string;
  vector: number;
  priority: number;
  handler: () => void;
  pending: boolean;
  enabled: boolean;
};

export type McuDebugState = {
  breakpoints: McuBreakpoint[];
  watchpoints: McuWatchpoint[];
  interrupts: McuInterrupt[];
  registers: Map<string, number>;
  memory: Map<number, number>;
  stepCount: number;
  maxSteps: number;
};

export type McuPeripheralState = {
  gpio: Map<string, number>;
  timers: Map<string, { counter: number; prescaler: number }>;
  interrupts: Map<string, boolean>;
};

export type McuConfig = {
  definition: McuDefinition;
  clockSpeed?: McuClockSpeed;
  firmware?: Uint8Array;
  initialPc?: number;
  maxCycles?: number;
};

export type McuSimulationResult = {
  success: boolean;
  finalPc: number;
  finalCycle: number;
  executionTime: number;
  halted: boolean;
  haltReason: string | null;
};

export const DEFAULT_MCU_CONFIG: Partial<McuConfig> = {
  clockSpeed: 1e6,
  maxCycles: 1e6
};

export const MCU_ARCHITECTURES: Record<string, { name: string; description: string }> = {
  "8051": { name: "8051", description: "Intel 8051 compatible" },
  "avr": { name: "AVR", description: "Atmel AVR" },
  "arm-cortex-m0": { name: "ARM Cortex-M0", description: "ARM Cortex-M0" }
};

export function getArchitectureDescription(arch: string): string {
  return MCU_ARCHITECTURES[arch]?.description ?? "Unknown";
}

export function getRegisterValue(
  memory: McuMemoryMap,
  register: McuRegister
): number {
  const offset = register.address - 0x80;
  if (offset >= 0 && offset < register.size) {
    return memory.sfr[offset];
  }
  return 0;
}

export function setRegisterValue(
  memory: McuMemoryMap,
  register: McuRegister,
  value: number
): void {
  const offset = register.address - 0x80;
  if (offset >= 0 && offset < register.size) {
    memory.sfr[offset] = value & 0xFF;
  }
}

export function getMemoryByte(
  memory: McuMemoryMap,
  address: number
): number {
  if (address < 0x80) {
    return memory.ram[address] ?? 0;
  }
  if (address < 0x100) {
    return memory.sfr[address - 0x80] ?? 0;
  }
  if (address < 0x10000) {
    return memory.flash[address] ?? 0;
  }
  return 0;
}

export function setMemoryByte(
  memory: McuMemoryMap,
  address: number,
  value: number
): void {
  const byte = value & 0xFF;
  if (address < 0x80) {
    memory.ram[address] = byte;
  } else if (address < 0x100) {
    memory.sfr[address - 0x80] = byte;
  }
}

export function getMemoryWord(
  memory: McuMemoryMap,
  address: number
): number {
  return getMemoryByte(memory, address) | (getMemoryByte(memory, address + 1) << 8);
}

export function setMemoryWord(
  memory: McuMemoryMap,
  address: number,
  value: number
): void {
  setMemoryByte(memory, address, value & 0xFF);
  setMemoryByte(memory, address + 1, (value >> 8) & 0xFF);
}

