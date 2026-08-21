import { describe, expect, it } from "vitest";
import {
  getAvailableParametersForComponent,
  generateSweepValues,
  formatParametricValue,
} from "./parametric_sweep_model";
import type { ComponentInstance } from "../canvas_orchestrator";

describe("parametric_sweep_model", () => {
  it("extrae parámetros barribles para resistencias, capacitores y fuentes", () => {
    const r: ComponentInstance = { id: "R1", type: "resistor", value: 1000, x: 0, y: 0, rotation: 0 };
    const rParams = getAvailableParametersForComponent(r);
    expect(rParams).toHaveLength(1);
    expect(rParams[0].parameter).toBe("value");
    expect(rParams[0].unit).toBe("Ω");

    const c: ComponentInstance = { id: "C1", type: "capacitor", value: 1e-6, x: 0, y: 0, rotation: 0 };
    const cParams = getAvailableParametersForComponent(c);
    expect(cParams).toHaveLength(1);
    expect(cParams[0].unit).toBe("F");

    const sig: ComponentInstance = { id: "V_AC", type: "ac_voltage", value: 5, x: 0, y: 0, rotation: 0 };
    const sigParams = getAvailableParametersForComponent(sig);
    expect(sigParams.length).toBeGreaterThanOrEqual(3);
    expect(sigParams.map((p) => p.parameter)).toContain("amplitude");
    expect(sigParams.map((p) => p.parameter)).toContain("frequency");
    expect(sigParams.map((p) => p.parameter)).toContain("offset");
  });

  it("extrae parámetros geométricos W y L para transistores MOSFET", () => {
    const mos: ComponentInstance = {
      id: "M1",
      type: "nmos_bsim3",
      value: 0,
      x: 0,
      y: 0,
      rotation: 0,
      w: 10e-6,
      l: 180e-9,
    };
    const mosParams = getAvailableParametersForComponent(mos);
    expect(mosParams.map((p) => p.parameter)).toContain("w");
    expect(mosParams.map((p) => p.parameter)).toContain("l");
  });

  it("genera puntos de barrido lineales y logarítmicos", () => {
    const linValues = generateSweepValues({ min: 100, max: 500, steps: 5, isLog: false });
    expect(linValues).toHaveLength(5);
    expect(linValues[0]).toBeCloseTo(100);
    expect(linValues[4]).toBeCloseTo(500);

    const logValues = generateSweepValues({ min: 10, max: 1000, steps: 3, isLog: true });
    expect(logValues).toHaveLength(3);
    expect(logValues[0]).toBeCloseTo(10);
    expect(logValues[1]).toBeCloseTo(100);
    expect(logValues[2]).toBeCloseTo(1000);
  });

  it("formatea valores con notación SPICE y unidades adecuadas", () => {
    expect(formatParametricValue(1000, "value", "Ω")).toBe("1kΩ");
    expect(formatParametricValue(0.5, "wiper")).toBe("50%");
    expect(formatParametricValue(180e-9, "l")).toBe("180 nm");
    expect(formatParametricValue(10e-6, "w")).toBe("10.00 µm");
  });
});
