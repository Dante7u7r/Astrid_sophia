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

// ==========================================================================
// TIPOS PARA EXPORTACIÓN DE PARÁMETROS S (TOUCHSTONE .sNp)
// ==========================================================================

export type SParameterFormat = 'ma' | 'ri';

export interface PortDefinition {
  readonly name: string;
  readonly positiveNode: string;
  readonly negativeNode: string;
  readonly referenceImpedance: number;
}

export interface SParameterSettings {
  readonly ports: readonly PortDefinition[];
  readonly fStart: number;
  readonly fEnd: number;
  readonly pointsPerDecade: number;
  readonly outputFormat: SParameterFormat;
}

export interface SParameterResult {
  readonly frequencies: readonly number[];
  /** sMatrices[k][j][i] = S_ji en la frecuencia k (j=fila, i=columna) */
  readonly sMatrices: readonly (readonly (readonly { re: number; im: number }[])[])[];
  readonly format: SParameterFormat;
  readonly referenceImpedance: number;
  readonly converged: boolean;
  readonly error: string | null;
}

// ==========================================================================
// TIPOS BÁSICOS PARA ANÁLISIS PARAMÉTRICO PVT (PROCESS-VOLTAGE-TEMPERATURE)
// ==========================================================================

export type ProcessCorner = 'tt' | 'ff' | 'ss' | 'fs' | 'sf';

export interface PvtConfig {
  readonly corner: ProcessCorner;
  readonly temperatureC: number;
  readonly voltageScaling: number;
}

// ==========================================================================
// PERFILES PVT PREDEFINIDOS DE LA INDUSTRIA
// ==========================================================================

/** Perfil PVT Comercial (0°C a 70°C) */
export const PVT_PROFILE_COMMERCIAL: readonly PvtConfig[] = Object.freeze([
  { corner: 'tt', temperatureC: 27, voltageScaling: 1.0 },
  { corner: 'ff', temperatureC: 70, voltageScaling: 1.05 },
  { corner: 'ss', temperatureC: 0, voltageScaling: 0.95 },
]);

/** Perfil PVT Industrial (-40°C a 85°C) */
export const PVT_PROFILE_INDUSTRIAL: readonly PvtConfig[] = Object.freeze([
  { corner: 'tt', temperatureC: 27, voltageScaling: 1.0 },
  { corner: 'ff', temperatureC: 85, voltageScaling: 1.10 },
  { corner: 'ss', temperatureC: -40, voltageScaling: 0.90 },
]);

/** Perfil PVT Automotriz AEC-Q100 Grade 1 (-40°C a 125°C) */
export const PVT_PROFILE_AUTOMOTIVE: readonly PvtConfig[] = Object.freeze([
  { corner: 'tt', temperatureC: 27, voltageScaling: 1.0 },
  { corner: 'ff', temperatureC: 125, voltageScaling: 1.10 },
  { corner: 'ss', temperatureC: -40, voltageScaling: 0.90 },
]);

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

// ==========================================================================
// TIPOS PARA EL MOTOR DE INTERRUPCIONES MIXED-SIGNAL (MCU INTERRUPT ENGINE)
// ==========================================================================

/** Dirección del cruce del umbral analógico.
 *  Mapeado directo del enum de Rust 'DigitalThresholdDirection'.
 */
export type DigitalThresholdDirection = 'rising' | 'falling' | 'either';

/** Representa la carga útil del disparador de evento analógico interceptado
 *  por el solver MNA del lado de Rust. Se transmite desde el backend a
 *  través del canal Tauri 'sim-frame-update'.
 */
export interface AnalogEventTrigger {
  /** ID del componente MCU destino en el lienzo del editor. */
  readonly componentId: string;
  /** Índice del nodo en la matriz MNA que fue monitoreado. */
  readonly nodeIdx: number;
  /** Voltaje de umbral que disparó la interrupción (Vth). */
  readonly thresholdVoltage: number;
  /** Dirección del flanco que causó el cruce. */
  readonly direction: DigitalThresholdDirection;
  /** Vector de interrupción de hardware destinado a la MCU (ej: 0x02 para INT0 externo). */
  readonly interruptVector: number;
}

