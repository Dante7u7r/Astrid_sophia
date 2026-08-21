import { describe, expect, it } from "vitest";
import {
  DisjointSetUnion,
  assignRootNode,
  mapPinKeysToNodes,
  pinKey,
} from "./netlist_node_model";
import {
  extractElectricalNetlist,
  invalidateTopologicalCache,
} from "./netlist_extractor";
import type { ComponentInstance, WireInstance } from "../canvas_orchestrator";

describe("netlist_node_model", () => {
  it("crea pin keys consistentes", () => {
    expect(pinKey("R1", 0)).toBe("R1:0");
    expect(pinKey("U1", "internal")).toBe("U1:internal");
  });

  it("asigna nodos incrementales por raiz", () => {
    const map: Record<string, string> = {};
    const next = { value: 1 };

    expect(assignRootNode(map, "A", next)).toBe("1");
    expect(assignRootNode(map, "A", next)).toBe("1");
    expect(assignRootNode(map, "B", next)).toBe("2");
    expect(next.value).toBe(3);
  });

  it("mapea pins unidos al mismo nodo", () => {
    const dsu = new DisjointSetUnion();
    dsu.union("R1:0", "R2:0");
    const map: Record<string, string> = {};
    const next = { value: 1 };

    expect(mapPinKeysToNodes(dsu, map, next, ["R1:0", "R2:0", "R3:0"])).toEqual(["1", "1", "2"]);
  });

  it("invalida la cache topologica correctamente y no produce estado stale", () => {
    const components: ComponentInstance[] = [
      { id: "V1", type: "vsource", x: 0, y: -50, rotation: 0, value: 5 },
      { id: "R1", type: "resistor", x: 0, y: 0, rotation: 0, value: 1000 },
      { id: "GND1", type: "ground", x: 0, y: 50, rotation: 0, value: 0 },
    ];
    const wires: WireInstance[] = [
      { id: "w1", from: { componentId: "V1", pinIndex: 0 }, to: { componentId: "R1", pinIndex: 0 } },
      { id: "w2", from: { componentId: "R1", pinIndex: 1 }, to: { componentId: "GND1", pinIndex: 0 } },
      { id: "w3", from: { componentId: "V1", pinIndex: 1 }, to: { componentId: "GND1", pinIndex: 0 } },
    ];
    const getPins = (c: ComponentInstance) => {
      if (c.type === "vsource") return [{ x: 0, y: -20, pinIndex: 0 }, { x: 0, y: 20, pinIndex: 1 }];
      if (c.type === "resistor") return [{ x: 0, y: -20, pinIndex: 0 }, { x: 0, y: 20, pinIndex: 1 }];
      if (c.type === "ground") return [{ x: 0, y: 0, pinIndex: 0 }];
      return [];
    };

    // Primera extracción (genera cache)
    const res1 = extractElectricalNetlist(components, wires, getPins);
    expect(res1.error).toBeUndefined();
    expect(res1.pinToNodeMap["GND1:0"]).toBe("0");

    // Invalidar cache topológica
    invalidateTopologicalCache();

    // Segunda extracción tras invalidación
    const res2 = extractElectricalNetlist(components, wires, getPins);
    expect(res2.error).toBeUndefined();
    expect(res2.pinToNodeMap["GND1:0"]).toBe("0");
  });
});
