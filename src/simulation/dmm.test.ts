import { describe, expect, test } from "vitest";
import type { ComponentInstance, WireInstance } from "../canvas_orchestrator";
import {
  DMM_INITIAL_DISPLAY,
  formatDmmReading,
  normalizeDmmMode,
  updateDmmReadings,
} from "./dmm";

describe("multimetro digital", () => {
  test("normaliza modos invalidos al voltimetro", () => {
    expect(normalizeDmmMode("V")).toBe("V");
    expect(normalizeDmmMode("A")).toBe("A");
    expect(normalizeDmmMode("R")).toBe("R");
    expect(normalizeDmmMode(Number.NaN)).toBe("V");
    expect(normalizeDmmMode(0)).toBe("V");
  });

  test("formatea voltaje, corriente y resistencia", () => {
    expect(formatDmmReading("V", 3.3)).toBe("3.300 V");
    expect(formatDmmReading("A", 0.005)).toBe("500.00 mA");
    expect(formatDmmReading("R", 1)).toBe("100.000 kOhm");
  });

  test("muestra OPEN hasta que ambos terminales esten conectados y resueltos", () => {
    const dmm: ComponentInstance = {
      id: "DMM1",
      type: "dmm",
      value: "V",
      dmmValue: "0.000 V",
      x: 0,
      y: 0,
      rotation: 0,
    };
    const wires: WireInstance[] = [{
      id: "W1",
      from: { componentId: "DMM1", pinIndex: 0 },
      to: { componentId: "R1", pinIndex: 0 },
      points: [],
    }];

    updateDmmReadings(
      [dmm],
      wires,
      { "DMM1:0": "1", "DMM1:1": "0" },
      { "1": 5, "0": 0 },
    );

    expect(dmm.dmmValue).toBe(DMM_INITIAL_DISPLAY);
  });
});
