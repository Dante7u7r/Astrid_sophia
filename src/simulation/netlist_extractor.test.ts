// ==========================================================================
// PRUEBAS UNITARIAS — NETLIST EXTRACTOR
// ==========================================================================
// Verifica el colapsado de nodos mediante DSU (Disjoint Set Union) y la
// extracción de netlists eléctricas a partir de componentes y cables.
//
// Estas pruebas NO requieren DOM, Tauri IPC, ni canvas. Se ejecutan
// exclusivamente en el entorno Node.js provisto por Vitest.
// ==========================================================================

import { describe, test, expect } from "vitest";
import { DisjointSetUnion, extractElectricalNetlist } from "./netlist_extractor";
import type { ComponentInstance, PinInstance, WireInstance } from "../canvas_orchestrator";

// ==========================================================================
// DSU — DISJOINT SET UNION
// ==========================================================================

describe("DisjointSetUnion", () => {
  test("find devuelve el propio elemento cuando no ha sido unido", () => {
    const dsu = new DisjointSetUnion();
    expect(dsu.find("A")).toBe("A");
    expect(dsu.find("Z")).toBe("Z");
  });

  test("union fusiona dos conjuntos correctamente", () => {
    const dsu = new DisjointSetUnion();
    dsu.union("A", "B");
    expect(dsu.find("A")).toBe(dsu.find("B"));
  });

  test("union encadena tres nodos y todos comparten la misma raíz", () => {
    const dsu = new DisjointSetUnion();
    dsu.union("A", "B");
    dsu.union("B", "C");
    const root = dsu.find("C");
    expect(dsu.find("A")).toBe(root);
    expect(dsu.find("B")).toBe(root);
  });

  test("compresi\u00f3n de caminos: tras union+find, el padre apunta directamente a la ra\u00edz", () => {
    const dsu = new DisjointSetUnion();
    dsu.union("A", "B");
    dsu.union("B", "C");
    // find("C") comprime el camino de C
    const root = dsu.find("C");
    // find("A") debe devolver la misma raíz
    expect(dsu.find("A")).toBe(root);
    // Verificar compresión mediante el estado interno (los parents directos)
    expect((dsu as any).parent["A"]).toBe(root);
    expect((dsu as any).parent["B"]).toBe(root);
  });

  test("conjuntos independientes no se contaminan entre s\u00ed", () => {
    const dsu = new DisjointSetUnion();
    dsu.union("X", "Y");
    dsu.union("P", "Q");
    const rootXY = dsu.find("X");
    const rootPQ = dsu.find("P");
    expect(dsu.find("Y")).toBe(rootXY);
    expect(dsu.find("Q")).toBe(rootPQ);
    expect(rootXY).not.toBe(rootPQ);
  });
});

// ==========================================================================
// EXTRACCIÓN DE NETLIST — Integración DSU + componentes
// ==========================================================================

describe("extractElectricalNetlist", () => {
  test("cables conectados fusionan pines en el mismo nodo eléctrico", () => {
    const components: ComponentInstance[] = [
      {
        id: "R1", type: "resistor", value: 1000, x: 0, y: 0, rotation: 0,
        pins: ["n1", "n2"],
      } as unknown as ComponentInstance,
      {
        id: "R2", type: "resistor", value: 2000, x: 100, y: 0, rotation: 0,
        pins: ["n2", "n0"],
      } as unknown as ComponentInstance,
    ];

    const wires: WireInstance[] = [
      {
        id: "W1",
        from: { componentId: "R1", pinIndex: 1 },
        to: { componentId: "R2", pinIndex: 0 },
      },
    ];

    const getPins = (c: ComponentInstance): PinInstance[] => {
      const typed = c as ComponentInstance & { pins: string[] };
      return typed.pins.map((_, i) => ({
        componentId: c.id,
        pinIndex: i,
        x: 0,
        y: 0,
      }));
    };

    const { pinToNodeMap } = extractElectricalNetlist(components, wires, getPins);

    // R1:1 y R2:0 están cableados → mismo nodo
    expect(pinToNodeMap["R1:1"]).toBe(pinToNodeMap["R2:0"]);
    // R1:0 y R2:1 no están cableados → nodos distintos
    expect(pinToNodeMap["R1:0"]).not.toBe(pinToNodeMap["R2:1"]);
  });
});
