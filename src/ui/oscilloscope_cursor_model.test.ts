import { describe, expect, it } from "vitest";
import {
  dragOscilloscopeCursor,
  hitTestOscilloscopeCursor,
  type CursorScale,
  type CursorState,
} from "./oscilloscope_cursor_model";

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
    expect(hitTestOscilloscopeCursor(100, 0, state, legacyScale)).toBe("T1");
    expect(hitTestOscilloscopeCursor(300, 0, state, legacyScale)).toBe("T2");
    expect(hitTestOscilloscopeCursor(0, 75, state, legacyScale)).toBe("V1");
    expect(hitTestOscilloscopeCursor(0, 125, state, legacyScale)).toBe("V2");
    expect(hitTestOscilloscopeCursor(0, 0, state, legacyScale)).toBeNull();
  });

  it("arrastra cursores de tiempo con limites", () => {
    expect(dragOscilloscopeCursor("T1", -100, 0, state, legacyScale).cursorT1).toBe(0.02);
    expect(dragOscilloscopeCursor("T2", 500, 0, state, legacyScale).cursorT2).toBe(0.98);
    expect(dragOscilloscopeCursor("T1", 200, 0, state, legacyScale).cursorT1).toBe(0.5);
  });

  it("arrastra cursores de voltaje usando escala CH1", () => {
    expect(dragOscilloscopeCursor("V1", 0, 50, state, legacyScale).cursorV1).toBe(2);
    expect(dragOscilloscopeCursor("V2", 0, 150, state, legacyScale).cursorV2).toBe(-2);
  });

  it("calcula y arrastra cursores de voltaje con escala generica de CH2 (5V/div y offset)", () => {
    // centerY = 100, offsetPixels = 25 -> yV1 = 100 - (1/5)*25 - 25 = 70
    // yV2 = 100 - (-1/5)*25 - 25 = 80
    expect(hitTestOscilloscopeCursor(0, 70, state, ch2Scale)).toBe("V1");
    expect(hitTestOscilloscopeCursor(0, 80, state, ch2Scale)).toBe("V2");

    // Drag V1 to y = 50: ((100 - 25 - 50) / 25) * 5 = 1 * 5 = 5 V
    expect(dragOscilloscopeCursor("V1", 0, 50, state, ch2Scale).cursorV1).toBe(5);
    // Drag V2 to y = 100: ((100 - 25 - 100) / 25) * 5 = -1 * 5 = -5 V
    expect(dragOscilloscopeCursor("V2", 0, 100, state, ch2Scale).cursorV2).toBe(-5);
  });
});
