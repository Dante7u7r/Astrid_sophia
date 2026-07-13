import { describe, expect, it } from "vitest";
import type { CircuitNetlist } from "./netlist_extractor";
import {
  collectNetlistNodes,
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
});
