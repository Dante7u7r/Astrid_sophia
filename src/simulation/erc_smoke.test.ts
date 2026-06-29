import { describe, test, expect } from "vitest";
import { runElectricalRuleCheck } from "./simulation_dispatcher";
import { extractElectricalNetlist } from "./netlist_extractor";
import type { ComponentInstance, PinInstance } from "../canvas_orchestrator";

function stubPins(comp: ComponentInstance): PinInstance[] {
  if (comp.type === "ground") {
    return [{ componentId: comp.id, pinIndex: 0, x: comp.x, y: comp.y - 20 }];
  }
  return [
    { componentId: comp.id, pinIndex: 0, x: comp.x - 40, y: comp.y },
    { componentId: comp.id, pinIndex: 1, x: comp.x + 40, y: comp.y },
  ];
}

describe("runElectricalRuleCheck", () => {
  test("bloquea netlist sin GND", () => {
    const components: ComponentInstance[] = [
      { id: "V1", type: "vsource", value: 5, x: 0, y: 0, rotation: 0 },
      { id: "R1", type: "resistor", value: 1000, x: 100, y: 0, rotation: 0 },
    ];
    const wires = [
      {
        id: "w1",
        from: { componentId: "V1", pinIndex: 0 },
        to: { componentId: "R1", pinIndex: 0 },
        points: [],
      },
    ];
    const { netlist } = extractElectricalNetlist(components, wires, stubPins);
    const erc = runElectricalRuleCheck(netlist, components, wires, stubPins);
    expect(erc.passed).toBe(false);
    expect(erc.errors.some(e => e.includes("Tierra"))).toBe(true);
  });

  test("pasa circuito con GND y divisor simple", () => {
    const components: ComponentInstance[] = [
      { id: "V1", type: "vsource", value: 5, x: 0, y: 0, rotation: 0 },
      { id: "R1", type: "resistor", value: 1000, x: 100, y: 0, rotation: 0 },
      { id: "GND1", type: "ground", value: 0, x: 0, y: 100, rotation: 0 },
    ];
    const wires = [
      { id: "w1", from: { componentId: "V1", pinIndex: 1 }, to: { componentId: "GND1", pinIndex: 0 }, points: [] },
      { id: "w2", from: { componentId: "V1", pinIndex: 0 }, to: { componentId: "R1", pinIndex: 0 }, points: [] },
      { id: "w3", from: { componentId: "R1", pinIndex: 1 }, to: { componentId: "GND1", pinIndex: 0 }, points: [] },
    ];
    const { netlist } = extractElectricalNetlist(components, wires, stubPins);
    const erc = runElectricalRuleCheck(netlist, components, wires, stubPins);
    expect(erc.passed).toBe(true);
  });
});
