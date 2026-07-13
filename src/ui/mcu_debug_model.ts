export function parseIntelHex(hexStr: string, flashSize: number): Uint8Array {
  const flash = new Uint8Array(flashSize);
  const lines = hexStr.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(":")) continue;

    const byteCount = parseInt(trimmed.substring(1, 3), 16);
    const address = parseInt(trimmed.substring(3, 7), 16);
    const recordType = parseInt(trimmed.substring(7, 9), 16);

    if (recordType === 0) {
      for (let i = 0; i < byteCount; i++) {
        const byteVal = parseInt(trimmed.substring(9 + i * 2, 9 + i * 2 + 2), 16);
        if (address + i < flashSize) {
          flash[address + i] = byteVal;
        }
      }
    } else if (recordType === 1) {
      break;
    }
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
