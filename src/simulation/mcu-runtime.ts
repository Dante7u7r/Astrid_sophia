/** Runtime básico para simulación de microcontroladores.
 * Implementa cycle-accurate execution con step() y run().
 */
import type {
  McuDefinition,
  McuMemoryMap,
  McuExecutionState,
  McuConfig,
  McuSimulationResult,
  McuDebugState,
  McuBreakpoint,
  McuWatchpoint
} from "./mcu-types";

export type McuRuntime = {
  definition: McuDefinition;
  memory: McuMemoryMap;
  state: McuExecutionState;
  debug: McuDebugState;
  cycleLimit: number;
  halted: boolean;
  haltReason: string | null;
  firmware: Uint8Array;
  // Infraestructura para el Motor de Interrupciones Mixed-Signal
  /** Vector de interrupción pendiente de ser atendido por el núcleo.
   *  null indica que no hay interrupciones pendientes.
   *  Equivale al latch físico de IRQ del hardware real. */
  pendingInterruptVector: number | null;
  /** Bit global de habilitación de interrupciones.
   *  true = las interrupciones están habilitadas (equivalente al bit EA en 8051
   *  o al bit I en el registro SREG de AVR). */
  globalInterruptEnable: boolean;
};

export function createMcuRuntime(config: McuConfig): McuRuntime {
  const def = config.definition;
  const memory: McuMemoryMap = {
    flash: new Uint8Array(def.flashSize),
    ram: new Uint8Array(def.ramSize),
    sfr: new Uint8Array(128)
  };

  if (config.firmware) {
    for (let i = 0; i < Math.min(config.firmware.length, def.flashSize); i++) {
      memory.flash[i] = config.firmware[i];
    }
  }

  const firmware = config.firmware ?? new Uint8Array(0);
  const initialPc = config.initialPc ?? 0;

  return {
    definition: def,
    memory,
    state: {
      pc: initialPc,
      sp: 0x7F,
      cycle: 0,
      running: false,
      halted: false
    },
    debug: {
      breakpoints: [],
      watchpoints: [],
      interrupts: [],
      registers: new Map(),
      memory: new Map(),
      stepCount: 0,
      maxSteps: config.maxCycles ?? 1e6
    },
    cycleLimit: config.maxCycles ?? 1e6,
    halted: false,
    haltReason: null,
    firmware,
    pendingInterruptVector: null,
    globalInterruptEnable: true
  };
}

export function resetRuntime(runtime: McuRuntime): void {
  runtime.state.pc = 0;
  runtime.state.sp = 0x7F;
  runtime.state.cycle = 0;
  runtime.state.running = false;
  runtime.state.halted = false;
  runtime.halted = false;
  runtime.haltReason = null;

  runtime.memory.ram.fill(0);
  runtime.memory.sfr.fill(0);

  runtime.debug.breakpoints.forEach(bp => bp.hitCount = 0);
  runtime.debug.watchpoints.forEach(wp => wp.hitCount = 0);
  runtime.debug.stepCount = 0;
}

export function startRuntime(runtime: McuRuntime): void {
  runtime.state.running = true;
  runtime.state.halted = false;
  runtime.halted = false;
  runtime.haltReason = null;
}

export function haltRuntime(runtime: McuRuntime, reason: string): void {
  runtime.state.running = false;
  runtime.state.halted = true;
  runtime.halted = true;
  runtime.haltReason = reason;
}

export function fetchByte(runtime: McuRuntime): number {
  const pc = runtime.state.pc;
  if (pc >= runtime.definition.flashSize) {
    return 0;
  }
  return runtime.memory.flash[pc];
}

export function fetchWord(runtime: McuRuntime): number {
  return fetchByte(runtime) | (fetchByte(runtime) << 8);
}

export function advancePc(runtime: McuRuntime, count: number = 1): void {
  runtime.state.pc = (runtime.state.pc + count) & 0xFFFF;
}

export function stepInstruction(runtime: McuRuntime): number {
  if (runtime.halted) return 0;

  const opcode = fetchByte(runtime);
  advancePc(runtime, 1);

  const cycles = executeOpcode(runtime, opcode);
  runtime.state.cycle += cycles;

  return cycles;
}

export function executeOpcode(_runtime: McuRuntime, opcode: number): number {
  switch (opcode) {
    case 0x00:
      return 1;
    case 0x02:
      return 2;
    case 0x12:
      return 2;
    case 0x22:
      return 2;
    case 0x32:
      return 2;
    case 0x80:
      return 2;
    case 0x90:
      return 2;
    case 0xA0:
      return 2;
    case 0xB0:
      return 2;
    case 0xC0:
      return 2;
    case 0xD0:
      return 2;
    case 0xE0:
      return 1;
    case 0xF0:
      return 1;
    default:
      return 1;
  }
}

export function runCycles(
  runtime: McuRuntime,
  maxCycles: number
): number {
  if (runtime.halted) return 0;

  startRuntime(runtime);
  let cycles = 0;

  while (runtime.state.running && cycles < maxCycles) {
    if (checkBreakpoints(runtime)) return cycles;
    if (checkWatchpoints(runtime)) return cycles;

    const addedCycles = stepInstruction(runtime);
    cycles += addedCycles;

    if (cycles >= runtime.cycleLimit) {
      haltRuntime(runtime, "Cycle limit reached");
      break;
    }
  }

  return cycles;
}

export function runUntilHalt(runtime: McuRuntime): McuSimulationResult {
  if (runtime.halted) {
    return {
      success: false,
      finalPc: runtime.state.pc,
      finalCycle: runtime.state.cycle,
      executionTime: runtime.state.cycle / runtime.definition.clockSpeed,
      halted: true,
      haltReason: runtime.haltReason
    };
  }

  startRuntime(runtime);

  while (runtime.state.running) {
    if (checkBreakpoints(runtime)) break;
    if (checkWatchpoints(runtime)) break;

    stepInstruction(runtime);

    if (runtime.state.cycle >= runtime.cycleLimit) {
      haltRuntime(runtime, "Cycle limit reached");
      break;
    }
  }

  return {
    success: !runtime.halted && runtime.haltReason === null,
    finalPc: runtime.state.pc,
    finalCycle: runtime.state.cycle,
    executionTime: runtime.state.cycle / runtime.definition.clockSpeed,
    halted: runtime.halted,
    haltReason: runtime.haltReason
  };
}

export function checkBreakpoints(runtime: McuRuntime): boolean {
  for (const bp of runtime.debug.breakpoints) {
    if (!bp.enabled) continue;
    if (bp.address === runtime.state.pc) {
      bp.hitCount++;
      haltRuntime(runtime, `Breakpoint hit at 0x${runtime.state.pc.toString(16)}`);
      return true;
    }
  }
  return false;
}

export function checkWatchpoints(runtime: McuRuntime): boolean {
  for (const wp of runtime.debug.watchpoints) {
    if (!wp.enabled) continue;
    if (runtime.state.pc >= wp.address && runtime.state.pc < wp.address + wp.size) {
      wp.hitCount++;
      haltRuntime(runtime, `Watchpoint hit at 0x${runtime.state.pc.toString(16)}`);
      return true;
    }
  }
  return false;
}

export function addBreakpoint(
  runtime: McuRuntime,
  address: number
): McuBreakpoint {
  const bp: McuBreakpoint = {
    address,
    enabled: true,
    hitCount: 0
  };
  runtime.debug.breakpoints.push(bp);
  return bp;
}

export function removeBreakpoint(
  runtime: McuRuntime,
  address: number
): void {
  runtime.debug.breakpoints = runtime.debug.breakpoints.filter(
    bp => bp.address !== address
  );
}

export function clearBreakpoints(runtime: McuRuntime): void {
  runtime.debug.breakpoints = [];
}

export function addWatchpoint(
  runtime: McuRuntime,
  address: number,
  size: number,
  type: "read" | "write" | "both" = "both"
): McuWatchpoint {
  const wp: McuWatchpoint = {
    address,
    size,
    type,
    enabled: true,
    hitCount: 0
  };
  runtime.debug.watchpoints.push(wp);
  return wp;
}

export function removeWatchpoint(
  runtime: McuRuntime,
  address: number
): void {
  runtime.debug.watchpoints = runtime.debug.watchpoints.filter(
    wp => wp.address !== address
  );
}

export function clearWatchpoints(runtime: McuRuntime): void {
  runtime.debug.watchpoints = [];
}

export function singleStep(runtime: McuRuntime): number {
  if (runtime.halted) return 0;
  runtime.debug.stepCount++;
  return stepInstruction(runtime);
}

export function getRuntimeState(runtime: McuRuntime): McuExecutionState {
  return { ...runtime.state };
}

export function getRegisterDump(
  runtime: McuRuntime
): Array<{ name: string; value: number }> {
  return [
    { name: "A", value: runtime.memory.sfr[0xE0 - 0x80] ?? 0 },
    { name: "B", value: runtime.memory.sfr[0xF0 - 0x80] ?? 0 },
    { name: "PSW", value: runtime.memory.sfr[0xD0 - 0x80] ?? 0 },
    { name: "SP", value: runtime.state.sp },
    { name: "PC", value: runtime.state.pc }
  ];
}

export function getStackDump(
  runtime: McuRuntime,
  count: number = 8
): Array<number> {
  const stack: number[] = [];
  for (let i = 0; i < count; i++) {
    const addr = (runtime.state.sp + i) & 0xFF;
    stack.push(runtime.memory.ram[addr] ?? 0);
  }
  return stack;
}

export function getMemoryDump(
  runtime: McuRuntime,
  start: number,
  count: number
): Uint8Array {
  const dump = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const addr = (start + i) & 0xFFFF;
    dump[i] = addr < 0x80
      ? runtime.memory.ram[addr]
      : addr < 0x100
        ? runtime.memory.sfr[addr - 0x80]
        : runtime.memory.flash[addr];
  }
  return dump;
}

export function disassembleInstruction(
  runtime: McuRuntime,
  address: number
): { opcode: number; bytes: number; mnemonic: string; operands: string } {
  const opcode = runtime.memory.flash[address] ?? 0;
  return {
    opcode,
    bytes: 1,
    mnemonic: `DB 0x${opcode.toString(16).padStart(2, "0")}`,
    operands: ""
  };
}

export const RUNTIME_STATUS_LABELS: Record<string, string> = {
  running: "Running",
  halted: "Halted",
  breakpoint: "Breakpoint",
  watchpoint: "Watchpoint",
  "cycle-limit": "Cycle limit"
};

// ==========================================================================
// FUNCIONES PARA EL MOTOR DE INTERRUPCIONES MIXED-SIGNAL
// ==========================================================================

/**
 * Inyecta una interrupción de hardware en el runtime de la MCU.
 * Respeta el bit global de habilitación (GIE/EA): si está deshabilitado,
 * la interrupción se ignora silenciosamente, simulando el comportamiento
 * de enmascaramiento físico del microcontrolador real.
 *
 * Esta función debe ser invocada desde el despachador del puente SPICE
 * (dispatchAnalogTrigger en mcu-spice-bridge.ts) cuando se recibe un
 * AnalogEventTrigger desde el solver Rust.
 *
 * @param runtime  Runtime de la MCU destino.
 * @param vector   Vector de interrupción de hardware (ej: 0x02 para INT0).
 */
export function injectHardwareInterrupt(
  runtime: McuRuntime,
  vector: number,
): void {
  if (!runtime.globalInterruptEnable) {
    return;
  }
  // Almacenar el vector en el registro latch de interrupciones pendientes.
  // El núcleo lo procesará al inicio del siguiente ciclo de instrucción
  // (véase executeCycleWithInterrupts).
  runtime.pendingInterruptVector = vector;
}

/**
 * Wrapper de ejecución de ciclo que verifica interrupciones pendientes
 * antes de ejecutar la siguiente instrucción. Simula el comportamiento
 * del hardware real donde la CPU samplea las líneas de IRQ en la frontera
 * de cada instrucción.
 *
 * Si hay una interrupción pendiente:
 *   1. Limpia el latch (ACK).
 *   2. Deshabilita GIE para evitar anidamiento infinito (el software debe
 *      re-habilitar con RETI explícitamente).
 *   3. Realiza context save: push del PC (16 bits, big-endian) a la pila.
 *   4. Salta al vector de interrupción (pc = vector * 4).
 *   5. Retorna 4 ciclos de latencia (típico en arquitecturas modernas).
 *
 * Si no hay interrupción pendiente, delega a stepInstruction().
 *
 * @param runtime  Runtime de la MCU.
 * @returns Número de ciclos consumidos.
 */
export function executeCycleWithInterrupts(runtime: McuRuntime): number {
  if (runtime.pendingInterruptVector !== null) {
    // 1. Latch ACK: limpiar el vector pendiente
    const vector = runtime.pendingInterruptVector;
    runtime.pendingInterruptVector = null;

    // 2. Deshabilitar interrupciones globales para evitar reentrancia.
    //    El software habilitará de nuevo vía instrucción RETI o SETB EA.
    runtime.globalInterruptEnable = false;

    // 3. Context save: push del PC (16 bits) a la pila.
    //    Orden big-endian: primero byte alto, luego byte bajo.
    const pc = runtime.state.pc;
    runtime.state.sp += 1;
    runtime.memory.ram[runtime.state.sp] = (pc >> 8) & 0xFF;
    runtime.state.sp += 1;
    runtime.memory.ram[runtime.state.sp] = pc & 0xFF;

    // 4. Vector jump: redirigir el PC a la dirección base de la ISR.
    //    Se utiliza un mapeo genérico de 4 bytes por vector.
    runtime.state.pc = vector * 4;

    // 5. Retornar latencia fija de 4 ciclos (típica en 8051 y AVR
    //    para el acknowledge + salto de interrupción).
    return 4;
  }

  // Sin interrupción pendiente: ejecución secuencial ordinaria
  return stepInstruction(runtime);
}