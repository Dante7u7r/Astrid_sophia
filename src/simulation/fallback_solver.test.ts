// ==========================================================================
// PRUEBAS UNITARIAS — FALLBACK SOLVER (Eliminación Gaussiana + MNA DC)
// ==========================================================================
// Verifica la corrección numérica del solver lineal de respaldo en
// TypeScript, incluyendo el pivoteo parcial ante matrices singulares o
// mal condicionadas.
//
// Estas pruebas NO requieren DOM, Tauri IPC, ni canvas. Se ejecutan
// exclusivamente en el entorno Node.js provisto por Vitest.
// ==========================================================================

import { describe, test, expect } from "vitest";
import { solveGaussian, solveCircuitTS } from "./fallback_solver";
import type { CircuitNetlist, ExtractedComponent } from "./netlist_extractor";

// ==========================================================================
// SOLUCIÓN DE SISTEMAS LINEALES — Eliminación de Gauss con pivoteo parcial
// ==========================================================================

describe("solveGaussian", () => {
  test("matriz identidad 2×2 retorna el vector independiente intacto", () => {
    const A = [[1, 0], [0, 1]];
    const b = [3, 7];
    const x = solveGaussian(A, b);
    expect(x).not.toBeNull();
    if (!x) return;
    expect(x[0]).toBeCloseTo(3, 10);
    expect(x[1]).toBeCloseTo(7, 10);
  });

  test("sistema lineal regular 2×2 se resuelve correctamente", () => {
    // 2x +  y = 5
    //  x + 3y = 6   → x = 9/5 = 1.8, y = 7/5 = 1.4
    const A = [[2, 1], [1, 3]];
    const b = [5, 6];
    const x = solveGaussian(A, b);
    expect(x).not.toBeNull();
    if (!x) return;
    expect(x[0]).toBeCloseTo(1.8, 10);
    expect(x[1]).toBeCloseTo(1.4, 10);
  });

  test("sistema denso 3×3 se resuelve con precisión algebraica", () => {
    //  3x + 2y -  z =  1
    //  2x - 2y + 4z = -2
    //  -x + 0.5y -  z =  0
    const A = [[3, 2, -1], [2, -2, 4], [-1, 0.5, -1]];
    const b = [1, -2, 0];
    const x = solveGaussian(A, b);
    expect(x).not.toBeNull();
    if (!x) return;
    // Verificar que A·x === b con tolerancia de 1e-10
    const Ax = [
      A[0][0] * x[0] + A[0][1] * x[1] + A[0][2] * x[2],
      A[1][0] * x[0] + A[1][1] * x[1] + A[1][2] * x[2],
      A[2][0] * x[0] + A[2][1] * x[1] + A[2][2] * x[2],
    ];
    expect(Ax[0]).toBeCloseTo(1, 10);
    expect(Ax[1]).toBeCloseTo(-2, 10);
    expect(Ax[2]).toBeCloseTo(0, 10);
  });

  test("matriz singular retorna null", () => {
    const A = [[1, 1], [1, 1]];
    const b = [3, 3];
    expect(solveGaussian(A, b)).toBeNull();
  });

  test("pivote nulo en primera fila se resuelve mediante pivoteo parcial", () => {
    //   0x +  y = 3   → fila 0 pivote nulo, intercambia con fila 1
    //    x + 0y = 2   → x = 2, y = 3
    const A = [[0, 1], [1, 0]];
    const b = [3, 2];
    const x = solveGaussian(A, b);
    expect(x).not.toBeNull();
    if (!x) return;
    expect(x[0]).toBeCloseTo(2, 10);
    expect(x[1]).toBeCloseTo(3, 10);
  });
});

// ==========================================================================
// SOLVER DC — Divisor de voltaje resistivo
// ==========================================================================

describe("solveCircuitTS", () => {
  test("divisor de voltaje 1 kΩ + 1 kΩ con fuente de 10 V da 5 V en el nodo central", () => {
    const netlist: CircuitNetlist = {
      components: [
        { id: "V1", type: "vsource", value: 10, pins: ["1", "0"], frequency: 0 },
        { id: "R1", type: "resistor", value: 1000, pins: ["1", "2"] },
        { id: "R2", type: "resistor", value: 1000, pins: ["2", "0"] },
      ] as ExtractedComponent[],
      wires: [],
    };

    const result = solveCircuitTS(netlist);
    expect(typeof result).not.toBe("string");
    if (typeof result === "string") return;

    // V_nodo2 = 10V * (1kΩ / (1kΩ + 1kΩ)) = 5.0 V
    expect(result.nodeVoltages["2"]).toBeCloseTo(5.0, 4);
  });
});
