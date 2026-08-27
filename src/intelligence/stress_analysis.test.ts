import { describe, expect, it } from "vitest";
import type { CircuitNetlist } from "../simulation/netlist_extractor";
import { evaluateComponentStress } from "./stress_analysis";

describe("StressAnalysis — Diagnóstico Físico y SOA", () => {
  it("detecta sobrepotencia en una resistencia de 1/4W", () => {
    // Resistencia de 100 ohms con 10V -> P = 100 / 100 = 1W (> 0.25W nominal -> 400% sobrecarga)
    const netlist: CircuitNetlist = {
      components: [
        { id: "R1", type: "resistor", value: 100, pins: ["1", "0"] },
      ],
      wires: [],
    };
    const nodeVoltages = { "1": 10.0, "0": 0.0 };

    const report = evaluateComponentStress(netlist, nodeVoltages);
    expect(report.items).toHaveLength(1);
    expect(report.items[0].status).toBe("overload");
    expect(report.items[0].actualValue).toBeCloseTo(1.0, 3);
    expect(report.items[0].percentOfRating).toBeCloseTo(400, 1);
    expect(report.overloadedCount).toBe(1);
    expect(report.summary).toContain("Peligro");
  });

  it("detecta sobretensión en condensador que excede su límite dieléctrico", () => {
    // Condensador con 35V (> 25V límite)
    const netlist: CircuitNetlist = {
      components: [
        { id: "C1", type: "capacitor", value: 10e-6, pins: ["1", "0"] },
      ],
      wires: [],
    };
    const nodeVoltages = { "1": 35.0, "0": 0.0 };

    const report = evaluateComponentStress(netlist, nodeVoltages);
    expect(report.items).toHaveLength(1);
    expect(report.items[0].status).toBe("overload");
    expect(report.items[0].percentOfRating).toBeCloseTo((35 / 25) * 100, 1);
  });

  it("detecta tensión inversa excesiva en diodo y sobrecorriente directa", () => {
    const netlist: CircuitNetlist = {
      components: [
        { id: "D1", type: "diode", value: 1, pins: ["0", "1"] }, // Inversa: Ánodo a 0, Cátodo a 70V (VR = 70V > 50V)
      ],
      wires: [],
    };
    const nodeVoltages = { "1": 70.0, "0": 0.0 };

    const report = evaluateComponentStress(netlist, nodeVoltages);
    expect(report.items).toHaveLength(1);
    expect(report.items[0].metricName).toContain("Tensión Inversa");
    expect(report.items[0].status).toBe("overload");
  });

  it("detecta peligro de picos inductivos destructivos cuando se conmuta una bobina sin diodo flyback", () => {
    const netlist: CircuitNetlist = {
      components: [
        { id: "L1", type: "inductor", value: 10e-3, pins: ["vcc", "collector"] },
        { id: "Q1", type: "npn", value: 1, pins: ["collector", "base", "0"] },
      ],
      wires: [],
    };
    const nodeVoltages = { vcc: 12.0, collector: 12.0, base: 0.0, "0": 0.0 };

    const report = evaluateComponentStress(netlist, nodeVoltages);
    expect(report.inductiveHazards).toHaveLength(1);
    expect(report.inductiveHazards[0].inductorId).toBe("L1");
    expect(report.inductiveHazards[0].switchingComponentId).toBe("Q1");
    expect(report.inductiveHazards[0].description).toContain("diodo flyback");
  });

  it("confirma que un circuito con diodo flyback conectado no reporta peligro inductivo", () => {
    const netlist: CircuitNetlist = {
      components: [
        { id: "L1", type: "inductor", value: 10e-3, pins: ["vcc", "collector"] },
        { id: "Q1", type: "npn", value: 1, pins: ["collector", "base", "0"] },
        { id: "D1", type: "diode", value: 1, pins: ["collector", "vcc"] }, // Diodo flyback en antiparalelo
      ],
      wires: [],
    };
    const nodeVoltages = { vcc: 12.0, collector: 12.0, base: 0.0, "0": 0.0 };

    const report = evaluateComponentStress(netlist, nodeVoltages);
    expect(report.inductiveHazards).toHaveLength(0);
  });
});
