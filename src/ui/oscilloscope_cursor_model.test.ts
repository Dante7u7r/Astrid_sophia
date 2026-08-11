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

const scale: CursorScale = {
  width: 400,
  height: 200,
  voltsPerDivCh1: 1,
  offsetCh1: 0,
};

describe("oscilloscope_cursor_model", () => {
  it("detecta cursores verticales y horizontales", () => {
    expect(hitTestOscilloscopeCursor(100, 0, state, scale)).toBe("T1");
    expect(hitTestOscilloscopeCursor(300, 0, state, scale)).toBe("T2");
    expect(hitTestOscilloscopeCursor(0, 75, state, scale)).toBe("V1");
    expect(hitTestOscilloscopeCursor(0, 125, state, scale)).toBe("V2");
    expect(hitTestOscilloscopeCursor(0, 0, state, scale)).toBeNull();
  });

  it("arrastra cursores de tiempo con limites", () => {
    expect(dragOscilloscopeCursor("T1", -100, 0, state, scale).cursorT1).toBe(0.02);
    expect(dragOscilloscopeCursor("T2", 500, 0, state, scale).cursorT2).toBe(0.98);
    expect(dragOscilloscopeCursor("T1", 200, 0, state, scale).cursorT1).toBe(0.5);
  });

  it("arrastra cursores de voltaje usando escala CH1", () => {
    expect(dragOscilloscopeCursor("V1", 0, 50, state, scale).cursorV1).toBe(2);
    expect(dragOscilloscopeCursor("V2", 0, 150, state, scale).cursorV2).toBe(-2);
  });
});
