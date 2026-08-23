/**
 * LogicAnalyzerModel — Modelo de Lógica Digital, Disparadores, Búferes y Decodificadores
 *
 * Soporta familias lógicas (TTL, CMOS, LVCMOS), evaluación de estados tri-state (0, 1, X),
 * decodificación de buses paralelos (Hex, Bin, ASCII) y análisis de protocolos (UART).
 */

export type LogicLevel = 0 | 1 | "X";

export interface LogicThresholdConfig {
  id: string;
  name: string;
  vLow: number;   // Tensión máxima para nivel '0'
  vHigh: number;  // Tensión mínima para nivel '1'
}

export const LOGIC_FAMILIES: readonly LogicThresholdConfig[] = [
  { id: "ttl_5v", name: "TTL 5V (0.8V / 2.0V)", vLow: 0.8, vHigh: 2.0 },
  { id: "cmos_5v", name: "CMOS 5V (1.5V / 3.5V)", vLow: 1.5, vHigh: 3.5 },
  { id: "cmos_3v3", name: "LVCMOS 3.3V (0.8V / 2.0V)", vLow: 0.8, vHigh: 2.0 },
  { id: "cmos_1v8", name: "LVCMOS 1.8V (0.45V / 1.2V)", vLow: 0.45, vHigh: 1.2 },
  { id: "custom", name: "Personalizado", vLow: 1.0, vHigh: 2.0 },
] as const;

export type TriggerEdge = "none" | "rising" | "falling" | "either" | "high" | "low";

export interface ChannelTriggerConfig {
  channelIndex: number; // 0..7
  edge: TriggerEdge;
}

export interface LogicSample {
  time: number;
  val: number; // Voltaje analógico real
}

export interface DigitalTransition {
  time: number;
  level: LogicLevel;
}

export interface BusPacket {
  startTime: number;
  endTime: number;
  value: number;
  hasUndefined: boolean;
  hexLabel: string;
}

export interface UartPacket {
  startTime: number;
  endTime: number;
  byte: number;
  charLabel: string;
  isParityError?: boolean;
}

/** Evalúa el nivel lógico de un voltaje analógico según el umbral dado. */
export function evaluateLogicLevel(voltage: number, threshold: LogicThresholdConfig): LogicLevel {
  if (voltage <= threshold.vLow) return 0;
  if (voltage >= threshold.vHigh) return 1;
  return "X";
}

/** Extrae las transiciones digitales a partir de un historial de muestras analógicas. */
export function extractTransitions(
  samples: readonly LogicSample[],
  threshold: LogicThresholdConfig,
): DigitalTransition[] {
  if (samples.length === 0) return [];

  const transitions: DigitalTransition[] = [];
  let currentLevel: LogicLevel | null = null;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const lvl = evaluateLogicLevel(s.val, threshold);
    if (lvl !== currentLevel) {
      transitions.push({ time: s.time, level: lvl });
      currentLevel = lvl;
    }
  }

  return transitions;
}

/** Obtiene el nivel lógico en un instante específico de tiempo a partir de las transiciones. */
export function getLevelAtTime(transitions: readonly DigitalTransition[], time: number): LogicLevel {
  if (transitions.length === 0) return "X";
  if (time < transitions[0].time) return transitions[0].level;

  let low = 0;
  let high = transitions.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (transitions[mid].time <= time) {
      if (mid === transitions.length - 1 || transitions[mid + 1].time > time) {
        return transitions[mid].level;
      }
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return transitions[transitions.length - 1].level;
}

/** Busca el índice de disparo (Trigger Index) en el historial de muestras. */
export function findTriggerMatch(
  channelsHistory: readonly (readonly LogicSample[])[],
  triggerConfig: ChannelTriggerConfig,
  threshold: LogicThresholdConfig,
): number {
  const { channelIndex, edge } = triggerConfig;
  if (edge === "none" || channelIndex < 0 || channelIndex >= channelsHistory.length) return 0;

  const history = channelsHistory[channelIndex];
  if (!history || history.length < 2) return 0;

  for (let i = 1; i < history.length; i++) {
    const prevLevel = evaluateLogicLevel(history[i - 1].val, threshold);
    const currLevel = evaluateLogicLevel(history[i].val, threshold);

    if (edge === "rising" && prevLevel === 0 && currLevel === 1) return i;
    if (edge === "falling" && prevLevel === 1 && currLevel === 0) return i;
    if (edge === "either" && prevLevel !== currLevel && (prevLevel === 0 || prevLevel === 1) && (currLevel === 0 || currLevel === 1)) return i;
    if (edge === "high" && currLevel === 1) return i;
    if (edge === "low" && currLevel === 0) return i;
  }

  return 0;
}

/** Decodifica el bus paralelo combinando los canales seleccionados (por defecto D0..D7). */
export function decodeParallelBus(
  channelsHistory: readonly (readonly LogicSample[])[],
  enabledMask: readonly boolean[], // longitud 8
  threshold: LogicThresholdConfig,
  timeRange: { startTime: number; endTime: number },
): BusPacket[] {
  // Recopilar todos los instantes de cambio en cualquiera de los canales habilitados
  const eventTimesSet = new Set<number>();
  eventTimesSet.add(timeRange.startTime);
  eventTimesSet.add(timeRange.endTime);

  const channelTransitions: DigitalTransition[][] = [];

  for (let ch = 0; ch < 8; ch++) {
    if (!enabledMask[ch] || !channelsHistory[ch] || channelsHistory[ch].length === 0) {
      channelTransitions.push([]);
      continue;
    }
    const trans = extractTransitions(channelsHistory[ch], threshold);
    channelTransitions.push(trans);
    for (const t of trans) {
      if (t.time >= timeRange.startTime && t.time <= timeRange.endTime) {
        eventTimesSet.add(t.time);
      }
    }
  }

  const sortedTimes = Array.from(eventTimesSet).sort((a, b) => a - b);
  if (sortedTimes.length < 2) return [];

  const packets: BusPacket[] = [];

  for (let i = 0; i < sortedTimes.length - 1; i++) {
    const tStart = sortedTimes[i];
    const tEnd = sortedTimes[i + 1];
    const midTime = tStart + (tEnd - tStart) * 0.5;

    let busVal = 0;
    let hasUndefined = false;
    let bitPos = 0;

    for (let ch = 0; ch < 8; ch++) {
      if (!enabledMask[ch]) continue;
      const lvl = getLevelAtTime(channelTransitions[ch], midTime);
      if (lvl === 1) {
        busVal |= (1 << bitPos);
      } else if (lvl === "X") {
        hasUndefined = true;
      }
      bitPos++;
    }

    if (bitPos === 0) continue;

    const hexDigits = Math.max(2, Math.ceil(bitPos / 4));
    const hexLabel = hasUndefined
      ? "XX"
      : `0x${busVal.toString(16).toUpperCase().padStart(hexDigits, "0")}`;

    packets.push({
      startTime: tStart,
      endTime: tEnd,
      value: busVal,
      hasUndefined,
      hexLabel,
    });
  }

  return packets;
}

/** Decodificador de protocolo serie asíncrono UART (8-N-1 o configurable). */
export function decodeUartProtocol(
  samples: readonly LogicSample[],
  baudRate: number,
  threshold: LogicThresholdConfig,
): UartPacket[] {
  if (samples.length < 10 || baudRate <= 0) return [];

  const bitDuration = 1 / baudRate;
  const transitions = extractTransitions(samples, threshold);
  if (transitions.length < 2) return [];

  const packets: UartPacket[] = [];
  let i = 0;

  while (i < transitions.length - 1) {
    const current = transitions[i];
    // Buscar flanco de bajada (Start bit: 1 -> 0)
    if (current.level === 0) {
      const prevLvl = i > 0 ? transitions[i - 1].level : 1;
      if (prevLvl === 1) {
        const startBitTime = current.time;
        // Muestrear en el centro de los 8 bits de datos: t = startBitTime + (1.5 + k) * bitDuration
        let byteVal = 0;
        let valid = true;

        for (let bit = 0; bit < 8; bit++) {
          const sampleTime = startBitTime + (1.5 + bit) * bitDuration;
          const lvl = getLevelAtTime(transitions, sampleTime);
          if (lvl === 1) {
            byteVal |= (1 << bit);
          } else if (lvl === "X") {
            valid = false;
            break;
          }
        }

        const stopBitTime = startBitTime + 9.5 * bitDuration;
        const stopLvl = getLevelAtTime(transitions, stopBitTime);

        if (valid && (stopLvl === 1 || stopLvl === "X")) {
          const charLabel = byteVal >= 32 && byteVal <= 126
            ? `'${String.fromCharCode(byteVal)}' (0x${byteVal.toString(16).toUpperCase().padStart(2, "0")})`
            : `0x${byteVal.toString(16).toUpperCase().padStart(2, "0")}`;

          packets.push({
            startTime: startBitTime,
            endTime: startBitTime + 10 * bitDuration,
            byte: byteVal,
            charLabel,
          });

          // Avanzar hasta pasar el frame decodificado
          while (i < transitions.length && transitions[i].time < stopBitTime) {
            i++;
          }
          continue;
        }
      }
    }
    i++;
  }

  return packets;
}

export interface I2cPacket {
  type: "start" | "address" | "data" | "ack" | "nack" | "stop";
  startTime: number;
  endTime: number;
  value?: number;
  isRead?: boolean;
  label: string;
}

export interface SpiPacket {
  startTime: number;
  endTime: number;
  mosiByte?: number;
  misoByte?: number;
  label: string;
}

/** Decodificador de protocolo serie síncrono I2C (SCL / SDA). */
export function decodeI2cProtocol(
  sclSamples: readonly LogicSample[],
  sdaSamples: readonly LogicSample[],
  threshold: LogicThresholdConfig,
): I2cPacket[] {
  if (sclSamples.length < 10 || sdaSamples.length < 10) return [];

  const sclTrans = extractTransitions(sclSamples, threshold);
  const sdaTrans = extractTransitions(sdaSamples, threshold);
  if (sclTrans.length < 2 || sdaTrans.length < 2) return [];

  const packets: I2cPacket[] = [];
  let inTransaction = false;
  let bitCount = 0;
  let currentByte = 0;
  let byteStartTime = 0;
  let isAddressPhase = true;

  // Detectar condiciones START y STOP por transiciones de SDA mientras SCL está en nivel alto '1'
  for (let i = 0; i < sdaTrans.length; i++) {
    const sda = sdaTrans[i];
    const sclLvl = getLevelAtTime(sclTrans, sda.time);

    if (sclLvl === 1) {
      if (sda.level === 0) {
        // START CONDITION (SDA cae mientras SCL es 1)
        inTransaction = true;
        isAddressPhase = true;
        bitCount = 0;
        currentByte = 0;
        packets.push({
          type: "start",
          startTime: sda.time,
          endTime: sda.time + 1e-6,
          label: "START",
        });
      } else if (sda.level === 1 && inTransaction) {
        // STOP CONDITION (SDA sube mientras SCL es 1)
        inTransaction = false;
        packets.push({
          type: "stop",
          startTime: sda.time,
          endTime: sda.time + 1e-6,
          label: "STOP",
        });
      }
    }
  }

  // Muestreo de bits en flancos de subida de SCL
  for (let i = 0; i < sclTrans.length; i++) {
    const scl = sclTrans[i];
    if (scl.level === 1 && inTransaction) {
      const sdaBit = getLevelAtTime(sdaTrans, scl.time);
      if (sdaBit === "X") continue;

      if (bitCount === 0) {
        byteStartTime = scl.time;
      }

      if (bitCount < 8) {
        currentByte = (currentByte << 1) | (sdaBit as number);
        bitCount++;
      } else if (bitCount === 8) {
        // 9º bit: ACK (0) o NACK (1)
        const isAck = sdaBit === 0;
        if (isAddressPhase) {
          const addr7 = (currentByte >> 1) & 0x7F;
          const isRead = (currentByte & 0x01) === 1;
          packets.push({
            type: "address",
            startTime: byteStartTime,
            endTime: scl.time,
            value: addr7,
            isRead,
            label: `ADDR: 0x${addr7.toString(16).toUpperCase().padStart(2, "0")} (${isRead ? "R" : "W"}) [${isAck ? "ACK" : "NACK"}]`,
          });
          isAddressPhase = false;
        } else {
          packets.push({
            type: "data",
            startTime: byteStartTime,
            endTime: scl.time,
            value: currentByte,
            label: `DATA: 0x${currentByte.toString(16).toUpperCase().padStart(2, "0")} [${isAck ? "ACK" : "NACK"}]`,
          });
        }
        bitCount = 0;
        currentByte = 0;
      }
    }
  }

  return packets;
}

/** Decodificador de protocolo serie SPI (SCK, MOSI, MISO, CS). */
export function decodeSpiProtocol(
  sckSamples: readonly LogicSample[],
  mosiSamples: readonly LogicSample[],
  misoSamples: readonly LogicSample[],
  csSamples: readonly LogicSample[],
  threshold: LogicThresholdConfig,
): SpiPacket[] {
  if (sckSamples.length < 10) return [];

  const sckTrans = extractTransitions(sckSamples, threshold);
  const mosiTrans = extractTransitions(mosiSamples, threshold);
  const misoTrans = extractTransitions(misoSamples, threshold);
  const csTrans = csSamples.length > 0 ? extractTransitions(csSamples, threshold) : [];

  const packets: SpiPacket[] = [];
  let bitCount = 0;
  let mosiByte = 0;
  let misoByte = 0;
  let byteStartTime = 0;

  for (let i = 0; i < sckTrans.length; i++) {
    const sck = sckTrans[i];
    // Modo 0 por defecto (Muestreo en flanco de subida)
    if (sck.level === 1) {
      // Verificar Chip Select si está presente (CS activo en nivel bajo '0')
      const csLvl = csTrans.length > 0 ? getLevelAtTime(csTrans, sck.time) : 0;
      if (csLvl !== 0) continue;

      if (bitCount === 0) byteStartTime = sck.time;

      const mosiBit = getLevelAtTime(mosiTrans, sck.time);
      const misoBit = getLevelAtTime(misoTrans, sck.time);

      if (mosiBit !== "X") mosiByte = (mosiByte << 1) | mosiBit;
      if (misoBit !== "X") misoByte = (misoByte << 1) | misoBit;
      bitCount++;

      if (bitCount === 8) {
        const mosiHex = mosiByte.toString(16).toUpperCase().padStart(2, "0");
        const misoHex = misoByte.toString(16).toUpperCase().padStart(2, "0");
        packets.push({
          startTime: byteStartTime,
          endTime: sck.time,
          mosiByte,
          misoByte,
          label: `MOSI: 0x${mosiHex} | MISO: 0x${misoHex}`,
        });
        bitCount = 0;
        mosiByte = 0;
        misoByte = 0;
      }
    }
  }

  return packets;
}

/** Disparo por coincidencia de patrón binario de 8 canales (ej: 0b1010XXXX). */
export function findPatternTriggerMatch(
  channelsHistory: readonly (readonly LogicSample[])[],
  patternMask: readonly (0 | 1 | "X")[],
  threshold: LogicThresholdConfig,
): number {
  if (channelsHistory.length === 0 || !channelsHistory[0] || channelsHistory[0].length < 2) return 0;
  const numSamples = channelsHistory[0].length;

  for (let i = 0; i < numSamples; i++) {
    let match = true;
    for (let ch = 0; ch < Math.min(8, patternMask.length, channelsHistory.length); ch++) {
      const expected = patternMask[ch];
      if (expected === "X") continue;

      const sample = channelsHistory[ch][i];
      if (!sample) continue;
      const actual = evaluateLogicLevel(sample.val, threshold);
      if (actual !== expected) {
        match = false;
        break;
      }
    }

    if (match) return i;
  }

  return 0;
}

/** Formatea una escala de tiempo a texto legible (ns/div, µs/div, ms/div, s/div). */
export function formatTimeDiv(secondsPerDiv: number): string {
  if (secondsPerDiv >= 1) return `${secondsPerDiv.toFixed(secondsPerDiv % 1 === 0 ? 0 : 2)} s/div`;
  if (secondsPerDiv >= 1e-3) return `${(secondsPerDiv * 1e3).toFixed(secondsPerDiv * 1e3 % 1 === 0 ? 0 : 2)} ms/div`;
  if (secondsPerDiv >= 1e-6) return `${(secondsPerDiv * 1e6).toFixed(secondsPerDiv * 1e6 % 1 === 0 ? 0 : 2)} µs/div`;
  return `${(secondsPerDiv * 1e9).toFixed(0)} ns/div`;
}
