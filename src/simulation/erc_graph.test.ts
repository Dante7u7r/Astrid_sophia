import { describe, expect, it } from "vitest";
import type { CircuitNetlist } from "./netlist_extractor";
import {
  collectNetlistNodes,
  evaluateRealtimeErcIssues,
  findIsolatedActiveNodes,
  hasIdealVoltageSourceCycle,
} from "./erc_graph";

function netlist(components: CircuitNetlist["components"], wires: CircuitNetlist["wires"] = []): CircuitNetlist {
  return { components, wires };
}

describe("erc_graph", () => {
  it("colecta nodos desde componentes", () => {
    const nodes = collectNetlistNodes(netlist([
      { id: "R1", type: "resistor", value: 1, pins: ["1", "0"] },
      { id: "R2", type: "resistor", value: 1, pins: ["2", "1"] },
    ]));

    expect([...nodes].sort()).toEqual(["0", "1", "2"]);
  });

  it("detecta nodos activos aislados de tierra", () => {
    const isolated = findIsolatedActiveNodes(netlist([
      { id: "R1", type: "resistor", value: 1, pins: ["1", "0"] },
      { id: "R2", type: "resistor", value: 1, pins: ["2", "3"] },
    ], [
      { id: "W1", nodes: ["2", "3"] },
    ]));

    expect(isolated.sort()).toEqual(["2", "3"]);
  });

  it("no inventa una ruta DC a traves de una fuente de corriente", () => {
    const isolated = findIsolatedActiveNodes(netlist([
      { id: "I1", type: "isource", value: 1, pins: ["1", "0"] },
    ], [
      { id: "W1", nodes: ["1", "0"] },
    ]));

    expect(isolated).toEqual(["1"]);
  });

  it("no conecta topologicamente la compuerta MOS con el canal", () => {
    const isolated = findIsolatedActiveNodes(netlist([
      { id: "M1", type: "nmos", value: 1, pins: ["1", "2", "0"] },
      { id: "R1", type: "resistor", value: 1, pins: ["2", "0"] },
    ], [
      { id: "WG", nodes: ["1", "1"] },
      { id: "WD", nodes: ["2", "0"] },
    ]));

    expect(isolated).toEqual(["1"]);
  });

  it("detecta ciclos de fuentes ideales", () => {
    expect(hasIdealVoltageSourceCycle(netlist([
      { id: "V1", type: "vsource", value: 1, pins: ["1", "2"] },
      { id: "V2", type: "vsource", value: 1, pins: ["2", "3"] },
      { id: "V3", type: "vsource", value: 1, pins: ["3", "1"] },
    ]))).toBe(true);

    expect(hasIdealVoltageSourceCycle(netlist([
      { id: "V1", type: "vsource", value: 1, pins: ["1", "2"] },
      { id: "R1", type: "resistor", value: 1, pins: ["2", "0"] },
    ]))).toBe(false);
  });

  it("evalúa problemas ERC en tiempo real (pines flotantes, falta de GND y cortocircuitos)", () => {
    const getPins = (comp: any) => [
      { componentId: comp.id, pinIndex: 0, x: 0, y: 0 },
      { componentId: comp.id, pinIndex: 1, x: 10, y: 0 },
    ];

    // 1. Resistor aislado sin conexiones
    const res1 = evaluateRealtimeErcIssues(
      [{ id: "R1", type: "resistor", value: 1000, x: 0, y: 0 }],
      [],
      getPins,
    );
    expect(res1.some(i => i.componentId === "R1" && i.pinIndex === 0)).toBe(true);
    expect(res1.some(i => i.componentId === "R1" && i.pinIndex === 1)).toBe(true);

    // 2. Fuente de voltaje en cortocircuito directo y sin GND
    const res2 = evaluateRealtimeErcIssues(
      [{ id: "V1", type: "vsource", value: 5, x: 0, y: 0 }],
      [{ id: "W1", from: { componentId: "V1", pinIndex: 0 }, to: { componentId: "V1", pinIndex: 1 } }],
      getPins,
    );
    expect(res2.some(i => i.message.includes("sin referencia a Tierra"))).toBe(true);
    expect(res2.some(i => i.type === "error" && i.message.includes("cortocircuito"))).toBe(true);
  });
});
