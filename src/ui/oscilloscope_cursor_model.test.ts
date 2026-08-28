import { describe, expect, it } from "vitest";
import {
  dragOscilloscopeCursor,
  hitTestOscilloscopeCursor,
  sampleVoltageAtNormalizedTime,
  type CursorScale,
  type CursorState,
} from "./oscilloscope_cursor_model";
import type { TimeStepResult } from "./oscilloscope_panel";

const state: CursorState = {
  cursorT1: 0.25,
  cursorT2: 0.75,
  cursorV1: 1,
  cursorV2: -1,
};

const legacyScale: CursorScale = {
  width: 400,
  height: 200,
  voltsPerDivCh1: 1,
  offsetCh1: 0,
};

const ch2Scale: CursorScale = {
  width: 400,
  height: 200,
  voltsPerDiv: 5,
  offsetPixels: 25,
};

describe("oscilloscope_cursor_model", () => {
  it("detecta cursores verticales y horizontales con escala legacy", () => {
    expect(hitTestOscilloscopeCursor(100, 100, state, legacyScale)).toBe("T1");
    expect(hitTestOscilloscopeCursor(300, 100, state, legacyScale)).toBe("T2");
    expect(hitTestOscilloscopeCursor(200, 75, state, legacyScale)).toBe("V1");
    expect(hitTestOscilloscopeCursor(200, 125, state, legacyScale)).toBe("V2");
    expect(hitTestOscilloscopeCursor(0, 0, state, legacyScale)).toBeNull();
  });

  it("detecta pestañas de manijas en los bordes con tolerancia ampliada", () => {
    // Manija superior T1 en y=10, x=108 (cerca de pxT1=100)
    expect(hitTestOscilloscopeCursor(108, 10, state, legacyScale)).toBe("T1");
    // Manija lateral V1 en x=15, y=82 (cerca de pyV1=75)
    expect(hitTestOscilloscopeCursor(15, 82, state, legacyScale)).toBe("V1");
  });

  it("filtra cursores segun el modo activo", () => {
    const timeScale: CursorScale = { ...legacyScale, mode: "time" };
    expect(hitTestOscilloscopeCursor(100, 100, state, timeScale)).toBe("T1");
    expect(hitTestOscilloscopeCursor(200, 75, state, timeScale)).toBeNull();

    const voltageScale: CursorScale = { ...legacyScale, mode: "voltage" };
    expect(hitTestOscilloscopeCursor(100, 100, state, voltageScale)).toBeNull();
    expect(hitTestOscilloscopeCursor(200, 75, state, voltageScale)).toBe("V1");

    const offScale: CursorScale = { ...legacyScale, mode: "off" };
    expect(hitTestOscilloscopeCursor(100, 100, state, offScale)).toBeNull();
    expect(hitTestOscilloscopeCursor(200, 75, state, offScale)).toBeNull();
  });

  it("arrastra cursores de tiempo con limites", () => {
    expect(dragOscilloscopeCursor("T1", -100, 0, state, legacyScale).cursorT1).toBe(0.01);
    expect(dragOscilloscopeCursor("T2", 500, 0, state, legacyScale).cursorT2).toBe(0.99);
    expect(dragOscilloscopeCursor("T1", 200, 0, state, legacyScale).cursorT1).toBe(0.5);
  });

  it("arrastra cursores de voltaje usando escala CH1", () => {
    expect(dragOscilloscopeCursor("V1", 0, 50, state, legacyScale).cursorV1).toBe(2);
    expect(dragOscilloscopeCursor("V2", 0, 150, state, legacyScale).cursorV2).toBe(-2);
  });

  it("calcula y arrastra cursores de voltaje con escala generica de CH2 (5V/div y offset)", () => {
    // centerY = 100, offsetPixels = 25 -> yV1 = 100 - (1/5)*25 - 25 = 70
    // yV2 = 100 - (-1/5)*25 - 25 = 80
    expect(hitTestOscilloscopeCursor(200, 70, state, ch2Scale)).toBe("V1");
    expect(hitTestOscilloscopeCursor(200, 80, state, ch2Scale)).toBe("V2");

    // Drag V1 to y = 50: ((100 - 25 - 50) / 25) * 5 = 1 * 5 = 5 V
    expect(dragOscilloscopeCursor("V1", 0, 50, state, ch2Scale).cursorV1).toBe(5);
    // Drag V2 to y = 100: ((100 - 25 - 100) / 25) * 5 = -1 * 5 = -5 V
    expect(dragOscilloscopeCursor("V2", 0, 100, state, ch2Scale).cursorV2).toBe(-5);
  });

  it("interpola correctamente tensiones en sampleVoltageAtNormalizedTime para modo Track", () => {
    const results: TimeStepResult[] = [
      { time: 0.0, nodeVoltages: { "1": 0.0 }, branchCurrents: {} },
      { time: 0.005, nodeVoltages: { "1": 2.5 }, branchCurrents: {} },
      { time: 0.010, nodeVoltages: { "1": 5.0 }, branchCurrents: {} },
      { time: 0.020, nodeVoltages: { "1": 0.0 }, branchCurrents: {} },
    ];

    // timeDivValue = 0.002s (window = 20ms = 0.020s)
    // normTime = 0.25 -> targetTime = 0.005s -> V = 2.5V
    const vT1 = sampleVoltageAtNormalizedTime(results, "1", 0.25, 0.002, 0);
    expect(vT1).toBeCloseTo(2.5, 4);

    // normTime = 0.50 -> targetTime = 0.010s -> V = 5.0V
    const vT2 = sampleVoltageAtNormalizedTime(results, "1", 0.50, 0.002, 0);
    expect(vT2).toBeCloseTo(5.0, 4);

    // normTime = 0.375 -> targetTime = 0.0075s -> V = 3.75V (interpolado)
    const vMid = sampleVoltageAtNormalizedTime(results, "1", 0.375, 0.002, 0);
    expect(vMid).toBeCloseTo(3.75, 4);
  });
});

