// ==========================================================================
// PRUEBAS UNITARIAS — INSPECTOR PEDAGÓGICO DE MATRIZ MNA SIMBÓLICA
// ==========================================================================

import { describe, test, expect } from "vitest";
import { extractMnaSymbolicMatrix } from "./mna_symbolic_inspector";
import type { CircuitNetlist, ExtractedComponent } from "./netlist_extractor";

describe("extractMnaSymbolicMatrix", () => {
  test("circuito vacío retorna tamaño 0", () => {
    const netlist: CircuitNetlist = {
      components: [],
      wires: [],
    };
    const res = extractMnaSymbolicMatrix(netlist);
    expect(res.size).toBe(0);
    expect(res.latexEquation).toBe("\\text{Circuito vacío}");
  });

  test("divisor de voltaje V1 + R1 + R2 genera matriz MNA simbólica y numérica exacta", () => {
    const netlist: CircuitNetlist = {
      components: [
        { id: "V1", type: "vsource", value: 10, pins: ["1", "0"], frequency: 0 },
        { id: "R1", type: "resistor", value: 1000, pins: ["1", "2"] },
        { id: "R2", type: "resistor", value: 2000, pins: ["2", "0"] },
      ] as ExtractedComponent[],
      wires: [],
    };

    const res = extractMnaSymbolicMatrix(netlist);

    // 2 nodos ("1", "2") + 1 fuente de voltaje ("V1") = tamaño 3
    expect(res.size).toBe(3);
    expect(res.nodeCount).toBe(2);
    expect(res.vsourceCount).toBe(1);
    expect(res.unknownLabels).toEqual(["v_{1}", "v_{2}", "i_{V1}"]);

    // Fila 1 (Nodo 1): G_R1 * v1 - G_R1 * v2 + i_V1 = 0
    expect(res.matrixG[0][0].symbolic).toBe("G_{R1}");
    expect(res.matrixG[0][0].numeric).toBeCloseTo(1 / 1000, 6);
    expect(res.matrixG[0][1].symbolic).toBe("-G_{R1}");
    expect(res.matrixG[0][2].symbolic).toBe("1");

    // Fila 2 (Nodo 2): -G_R1 * v1 + (G_R1 + G_R2) * v2 = 0
    expect(res.matrixG[1][0].symbolic).toBe("-G_{R1}");
    expect(res.matrixG[1][1].symbolic).toBe("G_{R1} G_{R2}");
    expect(res.matrixG[1][1].numeric).toBeCloseTo(1 / 1000 + 1 / 2000, 6);

    // Fila 3 (Rama V1): v1 = V_V1
    expect(res.matrixG[2][0].symbolic).toBe("1");
    expect(res.matrixG[2][1].symbolic).toBe("0");
    expect(res.vectorZ[2].symbolic).toBe("V_{V1}");
    expect(res.vectorZ[2].numeric).toBe(10);

    // Ecuaciones nodales en LaTeX
    expect(res.latexNodalEquations.length).toBe(3);
    expect(res.latexEquation).toContain("\\begin{pmatrix}");
    expect(res.latexEquation).toContain("G_{R1}");
  });

  test("circuito RC con capacitor genera estampa en matriz dinámica C", () => {
    const netlist: CircuitNetlist = {
      components: [
        { id: "R1", type: "resistor", value: 1000, pins: ["1", "2"] },
        { id: "C1", type: "capacitor", value: 1e-6, pins: ["2", "0"] },
      ] as ExtractedComponent[],
      wires: [],
    };

    const res = extractMnaSymbolicMatrix(netlist);
    expect(res.nodeCount).toBe(2);
    // Nodo 2 tiene C1 a tierra
    expect(res.matrixC[1][1].symbolic).toBe("C_{C1}");
    expect(res.matrixC[1][1].numeric).toBe(1e-6);
  });
});
