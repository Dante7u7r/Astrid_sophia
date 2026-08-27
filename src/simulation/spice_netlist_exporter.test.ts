import { describe, expect, it } from "vitest";
import type { ComponentInstance, WireInstance } from "../canvas_orchestrator";
import { exportToSpiceNetlist, formatSpiceValue } from "./spice_netlist_exporter";

describe("spice_netlist_exporter", () => {
  it("formatea correctamente valores numéricos con prefijos de ingeniería SPICE", () => {
    expect(formatSpiceValue(1000)).toBe("1k");
    expect(formatSpiceValue(1000000)).toBe("1Meg");
    expect(formatSpiceValue(0.000001)).toBe("1u");
    expect(formatSpiceValue(1e-9)).toBe("1n");
    expect(formatSpiceValue(1e-12)).toBe("1p");
    expect(formatSpiceValue("4.7k")).toBe("4.7k");
    expect(formatSpiceValue(0)).toBe("0");
  });

  it("exporta un circuito divisor de tensión a netlist SPICE (.cir)", () => {
    const components: ComponentInstance[] = [
      { id: "GND", type: "ground", x: 0, y: 100, rotation: 0 },
      { id: "V1", type: "vsource", value: 12, x: 0, y: 0, rotation: 0 },
      { id: "R1", type: "resistor", value: 1000, x: 50, y: 0, rotation: 0 },
      { id: "R2", type: "resistor", value: 2000, x: 50, y: 50, rotation: 0 },
    ];

    const wires: WireInstance[] = [
      { id: "w1", from: { componentId: "V1", pinIndex: 0 }, to: { componentId: "R1", pinIndex: 0 }, points: [] },
      { id: "w2", from: { componentId: "R1", pinIndex: 1 }, to: { componentId: "R2", pinIndex: 0 }, points: [] },
      { id: "w3", from: { componentId: "R2", pinIndex: 1 }, to: { componentId: "GND", pinIndex: 0 }, points: [] },
      { id: "w4", from: { componentId: "V1", pinIndex: 1 }, to: { componentId: "GND", pinIndex: 0 }, points: [] },
    ];

    const spiceText = exportToSpiceNetlist(components, wires, {
      title: "Divisor de Tensión 12V",
      analysisCommand: ".tran 1u 5ms",
    });

    expect(spiceText).toContain("* Divisor de Tensión 12V");
    expect(spiceText).toContain("V_V1");
    expect(spiceText).toContain("R_R1");
    expect(spiceText).toContain("R_R2");
    expect(spiceText).toContain(".tran 1u 5ms");
    expect(spiceText).toContain(".END");
  });

  it("embebde modelos discretos y macromodelos utilizados en el circuito", () => {
    const components: ComponentInstance[] = [
      { id: "GND", type: "ground", x: 0, y: 100, rotation: 0 },
      { id: "D1", type: "diode", modelName: "1N4733A", x: 50, y: 0, rotation: 0 },
      { id: "X1", type: "x", modelName: "LM7805", x: 100, y: 0, rotation: 0 },
    ];

    const wires: WireInstance[] = [
      { id: "w1", from: { componentId: "D1", pinIndex: 0 }, to: { componentId: "GND", pinIndex: 0 }, points: [] },
      { id: "w2", from: { componentId: "X1", pinIndex: 1 }, to: { componentId: "GND", pinIndex: 0 }, points: [] },
    ];

    const spiceText = exportToSpiceNetlist(components, wires, {
      includeModels: true,
    });

    expect(spiceText).toContain("D_D1");
    expect(spiceText).toContain("X_X1");
    expect(spiceText).toContain(".MODEL 1N4733A D");
    expect(spiceText).toContain(".SUBCKT LM7805");
  });
});
