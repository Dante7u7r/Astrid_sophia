// ==========================================================================
// ASTRYD SOPHIA — INSPECTOR PEDAGÓGICO DE LA MATRIZ MNA
// ==========================================================================
// Extrae y formula el sistema Modified Nodal Analysis (MNA) en representaciones
// simbólicas y numéricas con exportación directa a LaTeX / KaTeX:
//   G · v + C · dv/dt = i
//
// Diseñado con valor didáctico universitario para permitir a estudiantes y
// docentes visualizar exactamente la matriz de admitancias y fuentes estampadas.
// ==========================================================================

import type { CircuitNetlist } from "./netlist_extractor";
import { getMaxNodeIndex, createVoltageSourceMap } from "./fallback_mna";

export interface MnaSymbolicCell {
  readonly symbolic: string;
  readonly numeric: number;
}

export interface MnaSymbolicResult {
  readonly size: number;
  readonly nodeCount: number;
  readonly vsourceCount: number;
  readonly unknownLabels: readonly string[];
  readonly matrixG: readonly (readonly MnaSymbolicCell[])[];
  readonly matrixC: readonly (readonly MnaSymbolicCell[])[];
  readonly vectorZ: readonly MnaSymbolicCell[];
  readonly latexEquation: string;
  readonly latexNodalEquations: readonly string[];
}

function cleanLatexId(id: string): string {
  return id.replace(/_/g, "\\_");
}

export function extractMnaSymbolicMatrix(netlist: CircuitNetlist): MnaSymbolicResult {
  const n = getMaxNodeIndex(netlist);
  const vSources = netlist.components.filter(
    (c) => c.type === "vsource" || c.type === "vcvs" || c.type === "ccvs",
  );
  const m = vSources.length;
  const size = n + m;

  if (size === 0) {
    return {
      size: 0,
      nodeCount: 0,
      vsourceCount: 0,
      unknownLabels: [],
      matrixG: [],
      matrixC: [],
      vectorZ: [],
      latexEquation: "\\text{Circuito vacío}",
      latexNodalEquations: [],
    };
  }

  const vSourceMap = createVoltageSourceMap(vSources);

  // Unknown labels: v_1 ... v_n, i_V1 ... i_Vm
  const unknownLabels: string[] = [];
  for (let i = 1; i <= n; i++) {
    unknownLabels.push(`v_{${i}}`);
  }
  for (const vs of vSources) {
    unknownLabels.push(`i_{${cleanLatexId(vs.id)}}`);
  }

  // Inicializar celdas simbólicas y numéricas
  const G: { symbolicParts: string[]; numeric: number }[][] = Array(size)
    .fill(0)
    .map(() =>
      Array(size)
        .fill(0)
        .map(() => ({ symbolicParts: [], numeric: 0 })),
    );

  const C: { symbolicParts: string[]; numeric: number }[][] = Array(size)
    .fill(0)
    .map(() =>
      Array(size)
        .fill(0)
        .map(() => ({ symbolicParts: [], numeric: 0 })),
    );

  const Z: { symbolicParts: string[]; numeric: number }[] = Array(size)
    .fill(0)
    .map(() => ({ symbolicParts: [], numeric: 0 }));

  // Helper para estampar en G
  const stampGSym = (row: number, col: number, sym: string, num: number) => {
    if (row >= 0 && row < size && col >= 0 && col < size) {
      if (sym) G[row][col].symbolicParts.push(sym);
      G[row][col].numeric += num;
    }
  };

  // Helper para estampar en C
  const stampCSym = (row: number, col: number, sym: string, num: number) => {
    if (row >= 0 && row < size && col >= 0 && col < size) {
      if (sym) C[row][col].symbolicParts.push(sym);
      C[row][col].numeric += num;
    }
  };

  // Helper para estampar en Z
  const stampZSym = (row: number, sym: string, num: number) => {
    if (row >= 0 && row < size) {
      if (sym) Z[row].symbolicParts.push(sym);
      Z[row].numeric += num;
    }
  };

  // Estampar componentes
  for (const comp of netlist.components) {
    const compLabel = cleanLatexId(comp.id);
    if (comp.type === "resistor") {
      const nodeA = parseInt(comp.pins[0]);
      const nodeB = parseInt(comp.pins[1]);
      const gNum = comp.value > 0 ? 1.0 / comp.value : 0;
      const gSym = `G_{${compLabel}}`;

      if (nodeA > 0) stampGSym(nodeA - 1, nodeA - 1, gSym, gNum);
      if (nodeB > 0) stampGSym(nodeB - 1, nodeB - 1, gSym, gNum);
      if (nodeA > 0 && nodeB > 0) {
        stampGSym(nodeA - 1, nodeB - 1, `-${gSym}`, -gNum);
        stampGSym(nodeB - 1, nodeA - 1, `-${gSym}`, -gNum);
      }
    } else if (comp.type === "vsource") {
      const nodePos = parseInt(comp.pins[0]);
      const nodeNeg = parseInt(comp.pins[1]);
      const vsIdx = vSourceMap[comp.id];
      const col = n + vsIdx;

      if (nodePos > 0) {
        stampGSym(nodePos - 1, col, "+1", 1.0);
        stampGSym(col, nodePos - 1, "+1", 1.0);
      }
      if (nodeNeg > 0) {
        stampGSym(nodeNeg - 1, col, "-1", -1.0);
        stampGSym(col, nodeNeg - 1, "-1", -1.0);
      }
      stampZSym(col, `V_{${compLabel}}`, comp.value);
    } else if (comp.type === "isource") {
      const nodePos = parseInt(comp.pins[0]);
      const nodeNeg = parseInt(comp.pins[1]);
      const iSym = `I_{${compLabel}}`;
      if (nodePos > 0) stampZSym(nodePos - 1, `-${iSym}`, -comp.value);
      if (nodeNeg > 0) stampZSym(nodeNeg - 1, `+${iSym}`, comp.value);
    } else if (comp.type === "capacitor") {
      const nodeA = parseInt(comp.pins[0]);
      const nodeB = parseInt(comp.pins[1]);
      const cNum = comp.value;
      const cSym = `C_{${compLabel}}`;

      if (nodeA > 0) stampCSym(nodeA - 1, nodeA - 1, cSym, cNum);
      if (nodeB > 0) stampCSym(nodeB - 1, nodeB - 1, cSym, cNum);
      if (nodeA > 0 && nodeB > 0) {
        stampCSym(nodeA - 1, nodeB - 1, `-${cSym}`, -cNum);
        stampCSym(nodeB - 1, nodeA - 1, `-${cSym}`, -cNum);
      }
    } else if (comp.type === "inductor") {
      const nodeA = parseInt(comp.pins[0]);
      const nodeB = parseInt(comp.pins[1]);
      const gNum = 1.0 / Math.max(1e-4, comp.value * 1000);
      const gSym = `G_{L,\\text{eq}}`;
      if (nodeA > 0) stampGSym(nodeA - 1, nodeA - 1, gSym, gNum);
      if (nodeB > 0) stampGSym(nodeB - 1, nodeB - 1, gSym, gNum);
      if (nodeA > 0 && nodeB > 0) {
        stampGSym(nodeA - 1, nodeB - 1, `-${gSym}`, -gNum);
        stampGSym(nodeB - 1, nodeA - 1, `-${gSym}`, -gNum);
      }
    } else if (comp.type === "vcvs") {
      const nodePos = parseInt(comp.pins[0]);
      const nodeNeg = parseInt(comp.pins[1]);
      const ctrlPos = parseInt(comp.pins[2]);
      const ctrlNeg = parseInt(comp.pins[3]);
      const vsIdx = vSourceMap[comp.id];
      const col = n + vsIdx;
      const gainSym = `\\mu_{${compLabel}}`;

      if (nodePos > 0) {
        stampGSym(nodePos - 1, col, "+1", 1.0);
        stampGSym(col, nodePos - 1, "+1", 1.0);
      }
      if (nodeNeg > 0) {
        stampGSym(nodeNeg - 1, col, "-1", -1.0);
        stampGSym(col, nodeNeg - 1, "-1", -1.0);
      }
      if (ctrlPos > 0) stampGSym(col, ctrlPos - 1, `-${gainSym}`, -comp.value);
      if (ctrlNeg > 0) stampGSym(col, ctrlNeg - 1, `+${gainSym}`, comp.value);
    } else if (comp.type === "vccs") {
      const nodePos = parseInt(comp.pins[0]);
      const nodeNeg = parseInt(comp.pins[1]);
      const ctrlPos = parseInt(comp.pins[2]);
      const ctrlNeg = parseInt(comp.pins[3]);
      const gmSym = `g_{m,${compLabel}}`;

      if (nodePos > 0) {
        if (ctrlPos > 0) stampGSym(nodePos - 1, ctrlPos - 1, `+${gmSym}`, comp.value);
        if (ctrlNeg > 0) stampGSym(nodePos - 1, ctrlNeg - 1, `-${gmSym}`, -comp.value);
      }
      if (nodeNeg > 0) {
        if (ctrlPos > 0) stampGSym(nodeNeg - 1, ctrlPos - 1, `-${gmSym}`, -comp.value);
        if (ctrlNeg > 0) stampGSym(nodeNeg - 1, ctrlNeg - 1, `+${gmSym}`, comp.value);
      }
    }
  }

  // Formatear celdas a string limpio
  const formatCell = (parts: readonly string[], num: number): MnaSymbolicCell => {
    let sym = "0";
    if (parts.length > 0) {
      sym = parts
        .map((p, idx) => {
          if (idx === 0 && p.startsWith("+")) return p.substring(1);
          return p;
        })
        .join(" ");
    }
    return {
      symbolic: sym,
      numeric: num,
    };
  };

  const matrixGResult: MnaSymbolicCell[][] = G.map((row) =>
    row.map((cell) => formatCell(cell.symbolicParts, cell.numeric)),
  );

  const matrixCResult: MnaSymbolicCell[][] = C.map((row) =>
    row.map((cell) => formatCell(cell.symbolicParts, cell.numeric)),
  );

  const vectorZResult: MnaSymbolicCell[] = Z.map((cell) =>
    formatCell(cell.symbolicParts, cell.numeric),
  );

  // Construir string LaTeX matricial
  const gRows = matrixGResult
    .map((row) => row.map((c) => c.symbolic).join(" & "))
    .join(" \\\\\n");
  const xRows = unknownLabels.join(" \\\\\n");
  const zRows = vectorZResult.map((c) => c.symbolic).join(" \\\\\n");

  const latexEquation = `\\begin{pmatrix}\n${gRows}\n\\end{pmatrix} \\begin{pmatrix}\n${xRows}\n\\end{pmatrix} = \\begin{pmatrix}\n${zRows}\n\\end{pmatrix}`;

  // Construir ecuaciones nodales fila a fila
  const latexNodalEquations: string[] = [];
  for (let i = 0; i < size; i++) {
    const terms: string[] = [];
    for (let j = 0; j < size; j++) {
      const cell = matrixGResult[i][j];
      if (cell.symbolic !== "0") {
        terms.push(`(${cell.symbolic}) \\cdot ${unknownLabels[j]}`);
      }
    }
    const rhs = vectorZResult[i].symbolic;
    const rowTitle = i < n ? `\\text{Nodo } ${i + 1}` : `\\text{Rama } ${vSources[i - n]?.id || (i + 1)}`;
    latexNodalEquations.push(`${rowTitle}: \\quad ${terms.length > 0 ? terms.join(" + ") : "0"} = ${rhs}`);
  }

  return {
    size,
    nodeCount: n,
    vsourceCount: m,
    unknownLabels,
    matrixG: matrixGResult,
    matrixC: matrixCResult,
    vectorZ: vectorZResult,
    latexEquation,
    latexNodalEquations,
  };
}
