export function parseIntelHex(hexStr: string, flashSize: number): Uint8Array {
  if (!Number.isSafeInteger(flashSize) || flashSize <= 0 || flashSize > 16 * 1024 * 1024) {
    throw new Error("El tamaño de flash solicitado no es válido.");
  }
  if (new TextEncoder().encode(hexStr).byteLength > 16 * 1024 * 1024) {
    throw new Error("El archivo Intel HEX excede el límite de 16 MiB.");
  }

  const flash = new Uint8Array(flashSize);
  const lines = hexStr.split(/\r?\n/);
  let baseAddress = 0;
  let eofSeen = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const trimmed = line.trim();
    if (trimmed.length === 0 || !trimmed.startsWith(":")) continue;
    if (!/^:[0-9A-Fa-f]+$/.test(trimmed) || trimmed.length < 11 || trimmed.length % 2 === 0) {
      throw new Error(`Registro Intel HEX mal formado en la línea ${lineIndex + 1}.`);
    }

    const byteCount = parseInt(trimmed.substring(1, 3), 16);
    const address = parseInt(trimmed.substring(3, 7), 16);
    const recordType = parseInt(trimmed.substring(7, 9), 16);
    const expectedLength = 11 + byteCount * 2;
    if (trimmed.length !== expectedLength) {
      throw new Error(`Longitud Intel HEX incorrecta en la línea ${lineIndex + 1}.`);
    }

    const recordBytes: number[] = [];
    for (let offset = 1; offset < trimmed.length; offset += 2) {
      recordBytes.push(parseInt(trimmed.substring(offset, offset + 2), 16));
    }
    if (recordBytes.reduce((sum, value) => sum + value, 0) % 256 !== 0) {
      throw new Error(`Checksum Intel HEX inválido en la línea ${lineIndex + 1}.`);
    }

    const data = recordBytes.slice(4, 4 + byteCount);
    if (recordType === 0x00) {
      const absoluteAddress = baseAddress + address;
      if (absoluteAddress + byteCount > flashSize) {
        throw new Error(`El firmware escribe fuera de la flash en la línea ${lineIndex + 1}.`);
      }
      for (let i = 0; i < byteCount; i++) {
        flash[absoluteAddress + i] = data[i];
      }
    } else if (recordType === 0x01) {
      if (byteCount !== 0 || address !== 0) {
        throw new Error(`Registro EOF inválido en la línea ${lineIndex + 1}.`);
      }
      eofSeen = true;
      break;
    } else if (recordType === 0x02) {
      if (byteCount !== 2 || address !== 0) {
        throw new Error(`Dirección de segmento inválida en la línea ${lineIndex + 1}.`);
      }
      baseAddress = ((data[0] << 8) | data[1]) << 4;
    } else if (recordType === 0x04) {
      if (byteCount !== 2 || address !== 0) {
        throw new Error(`Dirección lineal extendida inválida en la línea ${lineIndex + 1}.`);
      }
      baseAddress = ((data[0] << 8) | data[1]) * 0x10000;
    } else if (recordType === 0x03 || recordType === 0x05) {
      if (byteCount !== 4 || address !== 0) {
        throw new Error(`Dirección de inicio inválida en la línea ${lineIndex + 1}.`);
      }
    } else {
      throw new Error(`Tipo de registro Intel HEX no soportado: 0x${recordType.toString(16)}.`);
    }
  }

  if (!eofSeen) {
    throw new Error("El archivo Intel HEX no contiene un registro EOF.");
  }
  return flash;
}

export function translateInstructionToSpanish(mnemonic: string): string {
  const cleanMnemonic = mnemonic.trim().toUpperCase();
  const parts = cleanMnemonic.split(/\s+/);
  const op = parts[0];
  const args = parts.slice(1).join(" ");

  switch (op) {
    case "NOP":
      return "No realiza ninguna operacion (Consume 1 ciclo de reloj).";
    case "MOV": {
      const ops = args.split(",");
      const dest = ops[0] ? ops[0].trim() : "";
      const src = ops[1] ? ops[1].trim() : "";
      return `Mueve/Copia el valor de ${src} a ${dest}.`;
    }
    case "ADD":
      return `Suma el valor de ${args} al Acumulador (A).`;
    case "ADDC":
      return `Suma con acarreo (Carry) el valor de ${args} al Acumulador (A).`;
    case "SUBB":
      return `Resta con acarreo el valor de ${args} del Acumulador (A).`;
    case "INC":
      return `Incrementa en 1 el valor de ${args}.`;
    case "DEC":
      return `Decrementa en 1 el valor de ${args}.`;
    case "MUL":
      return "Multiplica los registros A y B. El resultado se guarda en A y B.";
    case "DIV":
      return "Divide el registro A entre el registro B. El cociente va a A y el residuo a B.";
    case "ANL": {
      const ops = args.split(",");
      return `Realiza una operacion logica AND de ${ops[1] || ""} sobre ${ops[0] || ""}.`;
    }
    case "ORL": {
      const ops = args.split(",");
      return `Realiza una operacion logica OR de ${ops[1] || ""} sobre ${ops[0] || ""}.`;
    }
    case "XRL": {
      const ops = args.split(",");
      return `Realiza una operacion logica XOR de ${ops[1] || ""} sobre ${ops[0] || ""}.`;
    }
    case "CLR":
      return `Limpia/Pone en cero el registro o bit ${args}.`;
    case "SETB":
      return `Activa/Pone en uno el bit ${args}.`;
    case "CPL":
      return `Complementa/Invierte los bits de ${args}.`;
    case "LJMP":
      return `Salto largo incondicional a la direccion de memoria ${args}.`;
    case "AJMP":
      return `Salto absoluto a la direccion de memoria ${args}.`;
    case "SJMP":
      return `Salto relativo corto a la direccion ${args}.`;
    case "JZ":
      return `Salta a la etiqueta ${args} si el Acumulador (A) es igual a cero.`;
    case "JNZ":
      return `Salta a la etiqueta ${args} si el Acumulador (A) es diferente de cero.`;
    case "JC":
      return `Salta a la etiqueta ${args} si el indicador de Acarreo (Carry) esta activo.`;
    case "JNC":
      return `Salta a la etiqueta ${args} si el indicador de Acarreo (Carry) esta inactivo.`;
    case "JB": {
      const ops = args.split(",");
      return `Salta a la etiqueta ${ops[1] || ""} si el bit ${ops[0] || ""} esta activo (1).`;
    }
    case "JNB": {
      const ops = args.split(",");
      return `Salta a la etiqueta ${ops[1] || ""} si el bit ${ops[0] || ""} esta inactivo (0).`;
    }
    case "JBC": {
      const ops = args.split(",");
      return `Salta a la etiqueta ${ops[1] || ""} si el bit ${ops[0] || ""} esta activo, y luego limpia el bit.`;
    }
    case "CJNE": {
      const ops = args.split(",");
      return `Compara ${ops[0] || ""} con ${ops[1] || ""} y salta a la direccion ${ops[2] || ""} si no son iguales.`;
    }
    case "DJNZ": {
      const ops = args.split(",");
      return `Decrementa ${ops[0] || ""} en 1 y salta a la etiqueta ${ops[1] || ""} si no es cero.`;
    }
    case "ACALL":
      return `Llamada absoluta a la subrutina en la direccion ${args}.`;
    case "LCALL":
      return `Llamada larga a la subrutina en la direccion ${args}.`;
    case "RET":
      return "Retorna de una llamada a subrutina restaurando el program counter (PC) de la pila.";
    case "RETI":
      return "Retorna de una subrutina de interrupcion, restaurando el estado e interrupciones.";
    case "PUSH":
      return `Empuja el valor de ${args} a la pila (Stack), incrementando SP.`;
    case "POP":
      return `Saca el valor de la pila (Stack) y lo guarda en ${args}, decrementando SP.`;
    case "RL":
      return "Rota el contenido del Acumulador (A) a la izquierda de forma circular.";
    case "RLC":
      return "Rota el contenido del Acumulador (A) a la izquierda a traves del bit de Acarreo (Carry).";
    case "RR":
      return "Rota el contenido del Acumulador (A) a la derecha de forma circular.";
    case "RRC":
      return "Rota el contenido del Acumulador (A) a la derecha a traves del bit de Acarreo (Carry).";
    case "SWAP":
      return "Intercambia los nibbles altos y bajos (4 bits) del Acumulador (A).";
    default:
      if (cleanMnemonic.startsWith("LDI")) {
        return "Carga un valor inmediato directamente en un registro de trabajo.";
      }
      if (cleanMnemonic.startsWith("STS") || cleanMnemonic.startsWith("OUT")) {
        return "Escribe el contenido del registro en el espacio de E/S o perifericos.";
      }
      if (cleanMnemonic.startsWith("IN")) {
        return "Lee el contenido de un pin de puerto o registro de E/S hacia la CPU.";
      }
      return `Ejecuta la instruccion '${op}' con argumentos '${args}'.`;
  }
}

// ============================================================================
// EVALUADOR DE EXPRESIONES DE INSPECCIÓN (WATCH EXPRESSIONS)
// ============================================================================

import type { McuRuntime } from "../simulation/mcu-runtime";
import { stepInstruction } from "../simulation/mcu-runtime";
import {
  readACC,
  readB,
  readCY,
  readAC,
  readOV,
  readDPTR,
  readRn,
  readDirect,
  SFR_PSW,
  SFR_SP,
} from "../simulation/mcu-8051";
import {
  readReg,
  readRegWord,
  readPointerX,
  readPointerY,
  readPointerZ,
  readSP,
  readSREG,
  getSregFlag,
  readIoRegister,
  readDataSpace,
  SREG_I,
  SREG_T,
  SREG_H,
  SREG_S,
  SREG_V,
  SREG_N,
  SREG_Z,
  SREG_C,
} from "../simulation/mcu-avr";

export interface WatchResult {
  expression: string;
  value: number;
  formattedHex: string;
  formattedDec: string;
  formattedBin: string;
  valid: boolean;
  error?: string;
}

export function evaluateWatchExpression(
  expression: string,
  runtime: McuRuntime,
): WatchResult {
  const expr = expression.trim();
  if (!expr) {
    return {
      expression: expr,
      value: 0,
      formattedHex: "0x00",
      formattedDec: "0",
      formattedBin: "0b00000000",
      valid: false,
      error: "Expresión vacía",
    };
  }

  const is8051 = runtime.definition.architecture === "8051";
  const upper = expr.toUpperCase();

  try {
    let val: number | null = null;

    // 1. Registros 8051
    if (is8051) {
      if (upper === "A" || upper === "ACC") val = readACC(runtime);
      else if (upper === "B") val = readB(runtime);
      else if (upper === "PC") val = runtime.state.pc;
      else if (upper === "SP") val = runtime.memory.sfr[SFR_SP - 0x80] ?? runtime.state.sp;
      else if (upper === "PSW") val = runtime.memory.sfr[SFR_PSW - 0x80] ?? 0;
      else if (upper === "DPTR") val = readDPTR(runtime);
      else if (upper === "PSW.CY" || upper === "CY" || upper === "C") val = readCY(runtime) ? 1 : 0;
      else if (upper === "PSW.AC" || upper === "AC") val = readAC(runtime) ? 1 : 0;
      else if (upper === "PSW.OV" || upper === "OV") val = readOV(runtime) ? 1 : 0;
      else if (upper === "PSW.P" || upper === "P") val = (runtime.memory.sfr[SFR_PSW - 0x80] & 1);
      else if (/^R[0-7]$/.test(upper)) {
        const rIndex = parseInt(upper.substring(1), 10);
        val = readRn(runtime, rIndex);
      } else if (/^P[0-3]$/.test(upper)) {
        const pPort = parseInt(upper.substring(1), 10);
        const srfAddr = 0x80 + pPort * 0x10;
        val = readDirect(runtime, srfAddr);
      }
    } else {
      // 2. Registros AVR
      if (upper === "PC") val = runtime.state.pc;
      else if (upper === "SP") val = readSP(runtime);
      else if (upper === "SREG") val = readSREG(runtime);
      else if (upper === "X") val = readPointerX(runtime);
      else if (upper === "Y") val = readPointerY(runtime);
      else if (upper === "Z") val = readPointerZ(runtime);
      else if (upper === "SREG.I") val = getSregFlag(runtime, SREG_I) ? 1 : 0;
      else if (upper === "SREG.T") val = getSregFlag(runtime, SREG_T) ? 1 : 0;
      else if (upper === "SREG.H") val = getSregFlag(runtime, SREG_H) ? 1 : 0;
      else if (upper === "SREG.S") val = getSregFlag(runtime, SREG_S) ? 1 : 0;
      else if (upper === "SREG.V") val = getSregFlag(runtime, SREG_V) ? 1 : 0;
      else if (upper === "SREG.N") val = getSregFlag(runtime, SREG_N) ? 1 : 0;
      else if (upper === "SREG.Z") val = getSregFlag(runtime, SREG_Z) ? 1 : 0;
      else if (upper === "SREG.C") val = getSregFlag(runtime, SREG_C) ? 1 : 0;
      else if (/^R([0-9]|[12][0-9]|3[01])$/.test(upper)) {
        const rIndex = parseInt(upper.substring(1), 10);
        val = readReg(runtime, rIndex);
      } else if (/^R([0-9]|[12][0-9]|30):R([0-9]|[12][0-9]|31)$/.test(upper)) {
        const pair = parseInt(upper.substring(1).split(":")[0], 10);
        val = readRegWord(runtime, pair);
      } else if (upper === "PORTB") val = readIoRegister(runtime, 0x05);
      else if (upper === "PORTC") val = readIoRegister(runtime, 0x08);
      else if (upper === "PORTD") val = readIoRegister(runtime, 0x0B);
      else if (upper === "PINB") val = readIoRegister(runtime, 0x03);
      else if (upper === "PINC") val = readIoRegister(runtime, 0x06);
      else if (upper === "PIND") val = readIoRegister(runtime, 0x09);
      else if (upper === "DDRB") val = readIoRegister(runtime, 0x04);
      else if (upper === "DDRC") val = readIoRegister(runtime, 0x07);
      else if (upper === "DDRD") val = readIoRegister(runtime, 0x0A);
    }

    // 3. Expresiones de memoria: RAM[0x20], SFR[0x80], FLASH[0x1000]
    const ramMatch = /^RAM\[(0x[0-9a-f]+|\d+)\]$/i.exec(expr);
    if (ramMatch) {
      const isHex = ramMatch[1].startsWith("0X") || ramMatch[1].startsWith("0x");
      const addr = isHex ? parseInt(ramMatch[1].replace(/^0[xX]/, ""), 16) : parseInt(ramMatch[1], 10);
      val = is8051 ? (runtime.memory.ram[addr] ?? 0) : readDataSpace(runtime, addr);
    }

    const sfrMatch = /^SFR\[(0x[0-9a-f]+|\d+)\]$/i.exec(expr);
    if (sfrMatch) {
      const isHex = sfrMatch[1].startsWith("0X") || sfrMatch[1].startsWith("0x");
      const addr = isHex ? parseInt(sfrMatch[1].replace(/^0[xX]/, ""), 16) : parseInt(sfrMatch[1], 10);
      val = is8051 ? readDirect(runtime, addr) : readIoRegister(runtime, addr);
    }

    const flashMatch = /^FLASH\[(0x[0-9a-f]+|\d+)\]$/i.exec(expr);
    if (flashMatch) {
      const isHex = flashMatch[1].startsWith("0X") || flashMatch[1].startsWith("0x");
      const addr = isHex ? parseInt(flashMatch[1].replace(/^0[xX]/, ""), 16) : parseInt(flashMatch[1], 10);
      val = runtime.memory.flash[addr] ?? 0;
    }

    // 4. Expresión matemática o literal numérico simple (ej: 0x100, R16 + 5)
    if (val === null) {
      if (/^(0x[0-9A-Fa-f]+|\d+)$/i.test(expr)) {
        const isHex = expr.startsWith("0x") || expr.startsWith("0X");
        val = isHex ? parseInt(expr.replace(/^0[xX]/, ""), 16) : parseInt(expr, 10);
      }
    }

    if (val === null) {
      return {
        expression: expr,
        value: 0,
        formattedHex: "N/A",
        formattedDec: "N/A",
        formattedBin: "N/A",
        valid: false,
        error: "Símbolo o expresión no reconocida",
      };
    }

    const hexDigits = val > 0xFF ? 4 : 2;
    const binDigits = val > 0xFF ? 16 : 8;

    return {
      expression: expr,
      value: val,
      formattedHex: `0x${val.toString(16).toUpperCase().padStart(hexDigits, "0")}`,
      formattedDec: val.toString(10),
      formattedBin: `0b${val.toString(2).padStart(binDigits, "0")}`,
      valid: true,
    };
  } catch (err) {
    return {
      expression: expr,
      value: 0,
      formattedHex: "Error",
      formattedDec: "Error",
      formattedBin: "Error",
      valid: false,
      error: err instanceof Error ? err.message : "Error al evaluar expresión",
    };
  }
}

// ============================================================================
// FORMATEADOR DE VOLCADO DE MEMORIA (HEX DUMP)
// ============================================================================

export interface MemoryRow {
  address: number;
  addressHex: string;
  bytes: number[];
  hexStrings: string[];
  ascii: string;
}

export function formatMemoryDump(
  memory: Uint8Array,
  startAddress: number = 0,
  length: number = 256,
): MemoryRow[] {
  const rows: MemoryRow[] = [];
  const start = Math.max(0, startAddress & ~0x0F);
  const end = Math.min(memory.length, start + length);

  for (let addr = start; addr < end; addr += 16) {
    const bytes: number[] = [];
    const hexStrings: string[] = [];
    let ascii = "";

    for (let col = 0; col < 16; col++) {
      const idx = addr + col;
      if (idx < memory.length) {
        const b = memory[idx];
        bytes.push(b);
        hexStrings.push(b.toString(16).toUpperCase().padStart(2, "0"));
        ascii += (b >= 32 && b <= 126) ? String.fromCharCode(b) : ".";
      } else {
        bytes.push(0);
        hexStrings.push("--");
        ascii += " ";
      }
    }

    rows.push({
      address: addr,
      addressHex: addr.toString(16).toUpperCase().padStart(4, "0"),
      bytes,
      hexStrings,
      ascii,
    });
  }

  return rows;
}

// ============================================================================
// CONTROLADORES DE DEPURACIÓN (BREAKPOINTS, STEP, STEP-OVER)
// ============================================================================

export function stepUntilBreakpoint(
  runtime: McuRuntime,
  breakpoints: Set<number>,
  maxSteps: number = 1000,
): { stepsExecuted: number; hitBreakpoint: boolean; halted: boolean } {
  let steps = 0;

  while (steps < maxSteps && !runtime.halted) {
    stepInstruction(runtime);
    steps += 1;

    if (breakpoints.has(runtime.state.pc)) {
      return { stepsExecuted: steps, hitBreakpoint: true, halted: runtime.halted };
    }
  }

  return { stepsExecuted: steps, hitBreakpoint: false, halted: runtime.halted };
}

export function stepOver(
  runtime: McuRuntime,
  breakpoints: Set<number> = new Set(),
  maxSteps: number = 10000,
): { stepsExecuted: number; hitBreakpoint: boolean; halted: boolean } {
  const is8051 = runtime.definition.architecture === "8051";
  const pc = runtime.state.pc;
  const opcode = is8051
    ? (runtime.memory.flash[pc] ?? 0)
    : ((runtime.memory.flash[pc * 2 + 1] << 8) | (runtime.memory.flash[pc * 2] ?? 0));

  // Comprobar si la instrucción actual es una llamada a subrutina (CALL)
  let isCall = false;
  let returnPc = pc + 1;

  if (is8051) {
    if (opcode === 0x12) { // LCALL (3 bytes)
      isCall = true;
      returnPc = (pc + 3) & 0xFFFF;
    } else if ((opcode & 0x1F) === 0x11) { // ACALL (2 bytes)
      isCall = true;
      returnPc = (pc + 2) & 0xFFFF;
    }
  } else {
    if ((opcode & 0xF000) === 0xD000) { // RCALL (1 word)
      isCall = true;
      returnPc = (pc + 1) & 0xFFFF;
    } else if ((opcode & 0xFE0E) === 0x940E) { // CALL (2 words)
      isCall = true;
      returnPc = (pc + 2) & 0xFFFF;
    }
  }

  if (!isCall) {
    // Si no es llamada a subrutina, un simple stepInto
    stepInstruction(runtime);
    return {
      stepsExecuted: 1,
      hitBreakpoint: breakpoints.has(runtime.state.pc),
      halted: runtime.halted,
    };
  }

  // Si es subrutina, ejecutar hasta volver a returnPc o encontrar un breakpoint
  let steps = 0;
  while (steps < maxSteps && !runtime.halted) {
    stepInstruction(runtime);
    steps += 1;

    if (breakpoints.has(runtime.state.pc)) {
      return { stepsExecuted: steps, hitBreakpoint: true, halted: runtime.halted };
    }
    if (runtime.state.pc === returnPc) {
      break;
    }
  }

  return { stepsExecuted: steps, hitBreakpoint: false, halted: runtime.halted };
}
