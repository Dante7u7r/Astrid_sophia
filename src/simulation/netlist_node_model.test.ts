import { describe, expect, it } from "vitest";
import {
  DisjointSetUnion,
  assignRootNode,
  mapPinKeysToNodes,
  pinKey,
} from "./netlist_node_model";

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
});
