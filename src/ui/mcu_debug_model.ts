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
