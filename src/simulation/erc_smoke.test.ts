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

  test("bloquea circuito con subcircuito aislado sin GND", () => {
    // Circuito con GND y divisor simple, MAS un subcircuito aislado R2-R3 sin conex a tierra
    const components: ComponentInstance[] = [
      { id: "V1", type: "vsource", value: 5, x: 0, y: 0, rotation: 0 },
      { id: "R1", type: "resistor", value: 1000, x: 100, y: 0, rotation: 0 },
      { id: "GND1", type: "ground", value: 0, x: 0, y: 100, rotation: 0 },
      // Subcircuito aislado
      { id: "R2", type: "resistor", value: 500, x: 300, y: 0, rotation: 0 },
      { id: "R3", type: "resistor", value: 500, x: 400, y: 0, rotation: 0 },
    ];
    const wires = [
      { id: "w1", from: { componentId: "V1", pinIndex: 1 }, to: { componentId: "GND1", pinIndex: 0 }, points: [] },
      { id: "w2", from: { componentId: "V1", pinIndex: 0 }, to: { componentId: "R1", pinIndex: 0 }, points: [] },
      { id: "w3", from: { componentId: "R1", pinIndex: 1 }, to: { componentId: "GND1", pinIndex: 0 }, points: [] },
      // Conexión del subcircuito aislado entre sí
      { id: "w4", from: { componentId: "R2", pinIndex: 1 }, to: { componentId: "R3", pinIndex: 0 }, points: [] },
    ];
    const { netlist } = extractElectricalNetlist(components, wires, stubPins);
    const erc = runElectricalRuleCheck(netlist, components, wires, stubPins);
    expect(erc.passed).toBe(false);
    expect(erc.errors.some(e => e.includes("aislado"))).toBe(true);
  });

  test("bloquea circuito con bucle de fuentes de tension ideales", () => {
    const components: ComponentInstance[] = [
      { id: "V1", type: "vsource", value: 5, x: 0, y: 0, rotation: 0 },
      { id: "V2", type: "vsource", value: 5, x: 100, y: 0, rotation: 0 },
      { id: "GND1", type: "ground", value: 0, x: 0, y: 100, rotation: 0 },
    ];
    const wires = [
      // V1 y V2 en paralelo (ambos entre nodos comunes), que forma un bucle de fuentes ideales
      { id: "w1", from: { componentId: "V1", pinIndex: 0 }, to: { componentId: "V2", pinIndex: 0 }, points: [] },
      { id: "w2", from: { componentId: "V1", pinIndex: 1 }, to: { componentId: "V2", pinIndex: 1 }, points: [] },
      { id: "w3", from: { componentId: "V1", pinIndex: 1 }, to: { componentId: "GND1", pinIndex: 0 }, points: [] },
    ];
    const { netlist } = extractElectricalNetlist(components, wires, stubPins);
    const erc = runElectricalRuleCheck(netlist, components, wires, stubPins);
    expect(erc.passed).toBe(false);
    expect(erc.errors.some(e => e.includes("Bucle de fuentes"))).toBe(true);
  });
});
