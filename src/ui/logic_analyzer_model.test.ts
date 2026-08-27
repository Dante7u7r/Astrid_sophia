import { describe, expect, it } from "vitest";
import {
  autoDetectActiveChannels,
  calculateDigitalBusMetrics,
  exportDecodedPacketsCsv,
  decodeParallelBus,
  decodeUartProtocol,
  decodeSpiProtocol,
  decodeI2cProtocol,
  findPatternTriggerMatch,
  evaluateLogicLevel,
  extractTransitions,
  findTriggerMatch,
  formatTimeDiv,
  getLevelAtTime,
  LOGIC_FAMILIES,
  type ChannelTriggerConfig,
  type LogicSample,
  type LogicThresholdConfig,
} from "./logic_analyzer_model";

describe("LogicAnalyzerModel", () => {
  const ttlThreshold: LogicThresholdConfig = LOGIC_FAMILIES[0]; // TTL: vLow = 0.8, vHigh = 2.0

  it("evalúa correctamente los niveles lógicos TTL (0, 1 y X)", () => {
    expect(evaluateLogicLevel(0.2, ttlThreshold)).toBe(0);
    expect(evaluateLogicLevel(0.8, ttlThreshold)).toBe(0);
    expect(evaluateLogicLevel(1.4, ttlThreshold)).toBe("X"); // Zona indeterminada
    expect(evaluateLogicLevel(2.0, ttlThreshold)).toBe(1);
    expect(evaluateLogicLevel(5.0, ttlThreshold)).toBe(1);
  });

  it("evalúa correctamente los niveles lógicos CMOS 5V y LVCMOS 1.8V", () => {
    const cmos5v = LOGIC_FAMILIES.find((f) => f.id === "cmos_5v")!;
    expect(evaluateLogicLevel(1.0, cmos5v)).toBe(0);
    expect(evaluateLogicLevel(2.5, cmos5v)).toBe("X");
    expect(evaluateLogicLevel(4.0, cmos5v)).toBe(1);

    const lvcmos1v8 = LOGIC_FAMILIES.find((f) => f.id === "cmos_1v8")!;
    expect(evaluateLogicLevel(0.3, lvcmos1v8)).toBe(0);
    expect(evaluateLogicLevel(0.8, lvcmos1v8)).toBe("X");
    expect(evaluateLogicLevel(1.5, lvcmos1v8)).toBe(1);
  });

  it("extrae transiciones digitales consecutivas a partir de muestras analógicas", () => {
    const samples: LogicSample[] = [
      { time: 0.0, val: 0.1 },
      { time: 0.1, val: 0.2 },
      { time: 0.2, val: 4.8 }, // Flanco de subida a nivel 1
      { time: 0.3, val: 5.0 },
      { time: 0.4, val: 0.0 }, // Flanco de bajada a nivel 0
    ];

    const transitions = extractTransitions(samples, ttlThreshold);
    expect(transitions).toHaveLength(3);
    expect(transitions[0]).toEqual({ time: 0.0, level: 0 });
    expect(transitions[1]).toEqual({ time: 0.2, level: 1 });
    expect(transitions[2]).toEqual({ time: 0.4, level: 0 });
  });

  it("obtiene el nivel lógico exacto en un instante arbitrario con búsqueda binaria", () => {
    const transitions = [
      { time: 0.0, level: 0 as const },
      { time: 10e-6, level: 1 as const },
      { time: 20e-6, level: 0 as const },
    ];

    expect(getLevelAtTime(transitions, 5e-6)).toBe(0);
    expect(getLevelAtTime(transitions, 10e-6)).toBe(1);
    expect(getLevelAtTime(transitions, 15e-6)).toBe(1);
    expect(getLevelAtTime(transitions, 25e-6)).toBe(0);
  });

  it("detecta disparos por flanco de subida y flanco de bajada (Trigger Engine)", () => {
    const ch0: LogicSample[] = [
      { time: 0.0, val: 0.1 },
      { time: 1e-6, val: 0.2 },
      { time: 2e-6, val: 3.3 }, // Rising edge at index 2
      { time: 3e-6, val: 3.3 },
      { time: 4e-6, val: 0.1 }, // Falling edge at index 4
    ];

    const risingTrig: ChannelTriggerConfig = { channelIndex: 0, edge: "rising" };
    expect(findTriggerMatch([ch0], risingTrig, ttlThreshold)).toBe(2);

    const fallingTrig: ChannelTriggerConfig = { channelIndex: 0, edge: "falling" };
    expect(findTriggerMatch([ch0], fallingTrig, ttlThreshold)).toBe(4);
  });

  it("decodifica bus paralelo en paquetes hexadecimales limpios", () => {
    // D0 (LSB): alterna 0 -> 1 -> 0
    const ch0: LogicSample[] = [
      { time: 0.0, val: 0.0 },
      { time: 5e-6, val: 5.0 },
      { time: 10e-6, val: 0.0 },
    ];
    // D1 (MSB de 2 bits): constante en 1
    const ch1: LogicSample[] = [
      { time: 0.0, val: 5.0 },
      { time: 10e-6, val: 5.0 },
    ];

    const channels = [ch0, ch1, [], [], [], [], [], []];
    const enabledMask = [true, true, false, false, false, false, false, false];

    const packets = decodeParallelBus(channels, enabledMask, ttlThreshold, {
      startTime: 0.0,
      endTime: 10e-6,
    });

    expect(packets.length).toBeGreaterThanOrEqual(1);
    // Intervalo [0, 5µs]: D1=1, D0=0 -> valor 2 -> "0x02"
    expect(packets[0].value).toBe(2);
    expect(packets[0].hexLabel).toBe("0x02");
  });

  it("decodifica tramas serie UART asíncronas en caracteres y bytes", () => {
    const baudRate = 9600;
    const bitT = 1 / baudRate;

    // Enviar carácter 'A' (ASCII 65 = 0b01000001)
    // Bits: Start(0), D0(1), D1(0), D2(0), D3(0), D4(0), D5(0), D6(1), D7(0), Stop(1)
    const samples: LogicSample[] = [];
    const bits = [0, 1, 0, 0, 0, 0, 0, 1, 0, 1];

    let t = 0;
    for (const b of bits) {
      samples.push({ time: t, val: b === 1 ? 5.0 : 0.0 });
      samples.push({ time: t + bitT * 0.9, val: b === 1 ? 5.0 : 0.0 });
      t += bitT;
    }

    const packets = decodeUartProtocol(samples, baudRate, ttlThreshold);
    expect(packets.length).toBe(1);
    expect(packets[0].byte).toBe(65);
    expect(packets[0].charLabel).toContain("'A'");
  });

  it("formatea escalas temporales con precisión de unidades", () => {
    expect(formatTimeDiv(1)).toBe("1 s/div");
    expect(formatTimeDiv(10e-3)).toBe("10 ms/div");
    expect(formatTimeDiv(25e-6)).toBe("25 µs/div");
    expect(formatTimeDiv(100e-9)).toBe("100 ns/div");
  });

  it("detecta disparos por patrón binario de 8 canales (Pattern Triggering)", () => {
    const ch0: LogicSample[] = [{ time: 0, val: 5 }, { time: 1, val: 0 }, { time: 2, val: 5 }];
    const ch1: LogicSample[] = [{ time: 0, val: 0 }, { time: 1, val: 5 }, { time: 2, val: 5 }];
    const channels = [ch0, ch1, [], [], [], [], [], []];

    // Buscar patrón: CH0=1, CH1=1 (tiempo 2)
    const matchIdx = findPatternTriggerMatch(channels, [1, 1, "X", "X", "X", "X", "X", "X"], ttlThreshold);
    expect(matchIdx).toBe(2);
  });

  it("decodifica tramas serie síncronas SPI", () => {
    const sck: LogicSample[] = [];
    const mosi: LogicSample[] = [];
    const miso: LogicSample[] = [];
    const cs: LogicSample[] = [];

    // Enviar byte 0xA5 (0b10100101)
    const bits = [1, 0, 1, 0, 0, 1, 0, 1];
    let t = 0;
    for (const b of bits) {
      cs.push({ time: t, val: 0.0 }); // CS bajo
      mosi.push({ time: t, val: b === 1 ? 3.3 : 0.0 });
      miso.push({ time: t, val: 0.0 });
      sck.push({ time: t, val: 0.0 });
      t += 1e-6;
      sck.push({ time: t, val: 3.3 }); // Rising edge
      t += 1e-6;
    }

    const packets = decodeSpiProtocol(sck, mosi, miso, cs, ttlThreshold);
    expect(packets.length).toBe(1);
    expect(packets[0].mosiByte).toBe(0xA5);
    expect(packets[0].label).toContain("MOSI: 0xA5");
  });

  it("auto-detecta canales digitales activos y calcula frecuencia de reloj", () => {
    // Canal 0: señal con reloj periódico a 1 MHz
    const ch0: LogicSample[] = [];
    for (let i = 0; i < 20; i++) {
      ch0.push({ time: i * 0.5e-6, val: i % 2 === 0 ? 0.0 : 5.0 });
    }
    // Canal 1: línea estática en 0V
    const ch1: LogicSample[] = [{ time: 0, val: 0.0 }, { time: 10e-6, val: 0.0 }];
    const channels = [ch0, ch1, [], [], [], [], [], []];

    const result = autoDetectActiveChannels(channels, ttlThreshold);
    expect(result.activeChannels[0]).toBe(true);
    expect(result.activeChannels[1]).toBe(false);
    expect(result.transitionCounts[0]).toBeGreaterThan(10);
    expect(result.clockFrequencyHz).toBeDefined();
    expect(result.clockFrequencyHz!).toBeGreaterThan(500_000);
  });

  it("calcula métricas de integridad de bus digital y exporta paquetes a CSV", () => {
    const samples: LogicSample[] = [
      { time: 0.0, val: 0.0 },
      { time: 1e-6, val: 5.0 },
      { time: 2e-6, val: 0.0 },
      { time: 3e-6, val: 5.0 },
    ];
    const metrics = calculateDigitalBusMetrics(samples, ttlThreshold);
    expect(metrics.transitionCount).toBe(4);
    expect(metrics.approxFreqHz).toBeGreaterThan(0);

    const packets = [
      { startTime: 0.0, endTime: 1e-6, label: "0xAA" },
      { startTime: 1e-6, endTime: 2e-6, label: "0x55" },
    ];
    const csv = exportDecodedPacketsCsv(packets, "SPI");
    expect(csv).toContain("Index,Protocol,StartTime_s");
    expect(csv).toContain("0xAA");
    expect(csv).toContain("0x55");
  });
});
