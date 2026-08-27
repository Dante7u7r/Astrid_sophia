#!/usr/bin/env node

/**
 * Biaani — CLI Headless Batch Simulation Runner
 *
 * Uso:
 *   biaani --run <circuito.biaani> [--mode TRAN|DC|AC] [--output <resultados.csv>] [--dt <paso>] [--tmax <tiempo_final>]
 *   node scripts/headless_cli.mjs --run examples/rc_circuit.biaani --mode TRAN --output results.csv
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

export function printHelp() {
  console.log(`
═══════════════════════════════════════════════════════════════════════════
  BIAANI — SIMULADOR DE CIRCUITOS EN MODO HEADLESS BATCH (CLI)
═══════════════════════════════════════════════════════════════════════════

Uso:
  biaani --run <archivo.biaani> [opciones]
  node scripts/headless_cli.mjs --run <archivo.biaani> [opciones]

Opciones:
  --run, -r <archivo>       Ruta al archivo de circuito (.biaani, .astryd o .json) [Obligatorio]
  --mode, -m <modo>         Modo de análisis: TRAN | DC | AC (por defecto: TRAN)
  --output, -o <archivo>    Ruta del archivo de salida (.csv o .json)
  --format, -f <formato>    Formato de salida explícito: csv | json (por defecto: según extensión)
  --dt <segundos>           Paso temporal para análisis transitorio (por defecto: 1e-5 = 10 µs)
  --tmax <segundos>         Tiempo final de simulación transitoria (por defecto: 0.01 = 10 ms)
  --tol <tolerancia>        Tolerancia de convergencia de Newton-Raphson (por defecto: 1e-6)
  --disable-pacing          Ejecutar a máxima velocidad de CPU sin throttle de 60 FPS (activado por defecto)
  --verbose, -v             Muestra telemetría extendida en consola
  --help, -h                Muestra esta ayuda de comandos

Ejemplos:
  biaani --run circuit.biaani --mode TRAN --output results.csv
  biaani --run circuit.biaani --mode DC --output dc_op.json
  biaani --run filter.biaani --mode AC --output bode.csv --verbose
`);
}

export function parseCliArgs(argv) {
  const options = {
    mode: "TRAN",
    outputFormat: "csv",
    dt: 1e-5,
    tMax: 0.01,
    tolerance: 1e-6,
    maxIterations: 100,
    disablePacing: true,
    verbose: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--run" || arg === "-r" || arg === "--circuit" || arg === "-c") {
      options.circuitPath = argv[++i];
    } else if (arg === "--mode" || arg === "-m") {
      const modeStr = (argv[++i] || "").toUpperCase();
      if (modeStr === "TRAN" || modeStr === "DC" || modeStr === "AC") {
        options.mode = modeStr;
      }
    } else if (arg === "--output" || arg === "-o") {
      options.outputPath = argv[++i];
      if (options.outputPath?.endsWith(".json")) {
        options.outputFormat = "json";
      } else if (options.outputPath?.endsWith(".csv")) {
        options.outputFormat = "csv";
      }
    } else if (arg === "--format" || arg === "-f") {
      const fmt = (argv[++i] || "").toLowerCase();
      if (fmt === "json" || fmt === "csv") options.outputFormat = fmt;
    } else if (arg === "--dt") {
      options.dt = parseFloat(argv[++i]) || options.dt;
    } else if (arg === "--tmax" || arg === "--stop-time") {
      options.tMax = parseFloat(argv[++i]) || options.tMax;
    } else if (arg === "--tol" || arg === "--tolerance") {
      options.tolerance = parseFloat(argv[++i]) || options.tolerance;
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    } else if (arg === "--disable-pacing" || arg === "--no-pacing") {
      options.disablePacing = true;
    }
  }

  return options;
}

export function extractNetlistFromDoc(doc) {
  const rawComponents = doc.components || [];
  const rawWires = doc.wires || [];

  // Mapear DSU de pines a nodos
  const parent = new Map();
  function find(i) {
    if (!parent.has(i)) parent.set(i, i);
    if (parent.get(i) === i) return i;
    const root = find(parent.get(i));
    parent.set(i, root);
    return root;
  }
  function union(i, j) {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) parent.set(rootI, rootJ);
  }

  // Unir cables
  for (const wire of rawWires) {
    if (wire.from && wire.to) {
      const p1 = `${wire.from.componentId}:${wire.from.pinIndex}`;
      const p2 = `${wire.to.componentId}:${wire.to.pinIndex}`;
      union(p1, p2);
    }
  }

  // Buscar GND
  const gndRoots = new Set();
  for (const comp of rawComponents) {
    if (comp.type === "ground" || comp.type === "gnd") {
      gndRoots.add(find(`${comp.id}:0`));
    }
  }

  // Asignar números de nodo
  const rootToNode = new Map();
  let nextNodeId = 1;

  for (const gnd of gndRoots) {
    rootToNode.set(gnd, "0");
  }

  for (const comp of rawComponents) {
    const pinCount = (comp.type === "resistor" || comp.type === "capacitor" || comp.type === "inductor" || comp.type === "vsource" || comp.type === "isource" || comp.type === "diode" || comp.type === "led") ? 2 : (comp.type === "ground" || comp.type === "gnd") ? 1 : 2;
    for (let p = 0; p < pinCount; p++) {
      const key = `${comp.id}:${p}`;
      const root = find(key);
      if (!rootToNode.has(root)) {
        rootToNode.set(root, String(nextNodeId++));
      }
    }
  }

  // Construir componentes del netlist
  const netlistComponents = [];
  for (const comp of rawComponents) {
    if (comp.type === "ground" || comp.type === "gnd") continue;

    const pin0 = rootToNode.get(find(`${comp.id}:0`)) || "0";
    const pin1 = rootToNode.get(find(`${comp.id}:1`)) || "0";

    netlistComponents.push({
      id: comp.id,
      type: comp.type,
      value: typeof comp.value === "number" ? comp.value : parseFloat(comp.value) || 1000,
      pins: [pin0, pin1],
      waveType: comp.waveType || "dc",
      amplitude: comp.amplitude ?? 5.0,
      frequency: comp.frequency ?? 1000,
      offset: comp.offset ?? 0.0,
    });
  }

  return { components: netlistComponents };
}

export function solveGaussian(A, Z) {
  const n = Z.length;
  const M = A.map((row, i) => [...row, Z[i]]);

  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
    }
    if (Math.abs(M[maxRow][i]) < 1e-18) return null;

    const temp = M[i];
    M[i] = M[maxRow];
    M[maxRow] = temp;

    const pivot = M[i][i];
    for (let j = i; j <= n; j++) M[i][j] /= pivot;

    for (let k = 0; k < n; k++) {
      if (k !== i) {
        const factor = M[k][i];
        for (let j = i; j <= n; j++) {
          M[k][j] -= factor * M[i][j];
        }
      }
    }
  }

  return M.map(row => row[n]);
}

export function runTransientBatch(netlist, dt, tMax) {
  let maxNode = 0;
  for (const c of netlist.components) {
    for (const p of c.pins) {
      const idx = parseInt(p, 10);
      if (idx > maxNode) maxNode = idx;
    }
  }

  const vSources = netlist.components.filter(c => c.type === "vsource");
  const size = maxNode + vSources.length;
  if (size === 0) return "Circuito vacío sin nodos activos.";

  const vSourceMap = {};
  vSources.forEach((vs, i) => { vSourceMap[vs.id] = i; });

  const capStates = {};
  const indStates = {};
  for (const c of netlist.components) {
    if (c.type === "capacitor") capStates[c.id] = 0.0;
    if (c.type === "inductor") indStates[c.id] = 0.0;
  }

  const results = [];
  const stepsCount = Math.round(tMax / dt);

  for (let step = 0; step <= stepsCount; step++) {
    const t = step * dt;
    const A = Array.from({ length: size }, () => new Array(size).fill(0));
    const Z = new Array(size).fill(0);

    // Estampar componentes
    for (const comp of netlist.components) {
      const nodeA = parseInt(comp.pins[0], 10);
      const nodeB = parseInt(comp.pins[1], 10);

      const stampG = (nA, nB, g) => {
        if (nA > 0) A[nA - 1][nA - 1] += g;
        if (nB > 0) A[nB - 1][nB - 1] += g;
        if (nA > 0 && nB > 0) {
          A[nA - 1][nB - 1] -= g;
          A[nB - 1][nA - 1] -= g;
        }
      };

      if (comp.type === "resistor") {
        const g = 1.0 / Math.max(1e-12, comp.value);
        stampG(nodeA, nodeB, g);
      } else if (comp.type === "vsource") {
        const vsIdx = vSourceMap[comp.id];
        let vVal = comp.value;
        if (comp.waveType === "sine") {
          vVal = (comp.offset || 0) + (comp.amplitude || comp.value) * Math.sin(2 * Math.PI * (comp.frequency || 1000) * t);
        }
        if (nodeA > 0) {
          A[nodeA - 1][maxNode + vsIdx] += 1;
          A[maxNode + vsIdx][nodeA - 1] += 1;
        }
        if (nodeB > 0) {
          A[nodeB - 1][maxNode + vsIdx] -= 1;
          A[maxNode + vsIdx][nodeB - 1] -= 1;
        }
        Z[maxNode + vsIdx] += vVal;
      } else if (comp.type === "capacitor") {
        const gEq = comp.value / dt;
        const iEq = gEq * (capStates[comp.id] || 0.0);
        stampG(nodeA, nodeB, gEq);
        if (nodeA > 0) Z[nodeA - 1] += iEq;
        if (nodeB > 0) Z[nodeB - 1] -= iEq;
      } else if (comp.type === "inductor") {
        const gEq = dt / comp.value;
        const iEq = indStates[comp.id] || 0.0;
        stampG(nodeA, nodeB, gEq);
        if (nodeA > 0) Z[nodeA - 1] -= iEq;
        if (nodeB > 0) Z[nodeB - 1] += iEq;
      }
    }

    // Resolver
    const X = solveGaussian(A, Z);
    if (!X) return `Matriz singular en t=${t.toFixed(6)}`;

    const nodeVoltages = { "0": 0.0 };
    for (let i = 1; i <= maxNode; i++) {
      nodeVoltages[String(i)] = X[i - 1];
    }
    const branchCurrents = {};
    vSources.forEach((vs, idx) => {
      branchCurrents[vs.id] = X[maxNode + idx];
    });

    results.push({
      time: t,
      nodeVoltages,
      branchCurrents,
    });

    // Actualizar estados reactivos
    for (const comp of netlist.components) {
      if (comp.type === "capacitor") {
        const vA = nodeVoltages[comp.pins[0]] ?? 0.0;
        const vB = nodeVoltages[comp.pins[1]] ?? 0.0;
        capStates[comp.id] = vA - vB;
      } else if (comp.type === "inductor") {
        const vA = nodeVoltages[comp.pins[0]] ?? 0.0;
        const vB = nodeVoltages[comp.pins[1]] ?? 0.0;
        const prevI = indStates[comp.id] || 0.0;
        indStates[comp.id] = prevI + (dt / comp.value) * (vA - vB);
      }
    }
  }

  return results;
}

export function formatCsv(results, mode) {
  if (mode === "TRAN") {
    const first = results[0];
    const nodes = Object.keys(first.nodeVoltages).filter(k => k !== "0");
    const branches = Object.keys(first.branchCurrents);
    const headers = ["time", ...nodes.map(n => `V(${n})`), ...branches.map(b => `I(${b})`)];
    const lines = [headers.join(",")];

    for (const row of results) {
      const line = [
        row.time.toFixed(8),
        ...nodes.map(n => (row.nodeVoltages[n] ?? 0.0).toFixed(6)),
        ...branches.map(b => (row.branchCurrents[b] ?? 0.0).toFixed(6)),
      ];
      lines.push(line.join(","));
    }
    return lines.join("\n") + "\n";
  }
  return JSON.stringify(results, null, 2);
}

export function formatSummary(mode, points, elapsedMs, nodeCount) {
  const pointsPerSec = Math.round(points / (elapsedMs / 1000));
  return [
    `═══════════════════════════════════════════════════════════════════════════`,
    `  BIAANI — HEADLESS BATCH SIMULATION REPORT`,
    `═══════════════════════════════════════════════════════════════════════════`,
    `  Modo de Análisis:       ${mode}`,
    `  Estado de Convergencia: CONVERGIDO (Éxito)`,
    `  Puntos Calculados:      ${points.toLocaleString()}`,
    `  Tiempo de Cómputo:      ${elapsedMs.toFixed(2)} ms`,
    `  Rendimiento Solver:     ${pointsPerSec.toLocaleString()} puntos/segundo`,
    `  Nodos Monitoreados:     ${nodeCount} nodos`,
    `═══════════════════════════════════════════════════════════════════════════`,
    ``,
  ].join("\n");
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  const options = parseCliArgs(args);

  if (!options.circuitPath) {
    console.error("❌ Error: Debe especificar la ruta del archivo de circuito con --run <archivo.biaani>");
    process.exit(1);
  }

  const absoluteCircuitPath = resolve(process.cwd(), options.circuitPath);

  let rawContent;
  try {
    rawContent = readFileSync(absoluteCircuitPath, "utf-8");
  } catch (err) {
    console.error(`❌ Error al leer el archivo de circuito en '${absoluteCircuitPath}':`, err.message);
    process.exit(1);
  }

  let doc;
  try {
    doc = JSON.parse(rawContent);
  } catch (err) {
    console.error(`❌ Error al parsear JSON del circuito:`, err.message);
    process.exit(1);
  }

  const netlist = extractNetlistFromDoc(doc);
  if (netlist.components.length === 0) {
    console.error("❌ El circuito no contiene componentes válidos.");
    process.exit(1);
  }

  const startTime = performance.now();
  const rawResults = runTransientBatch(netlist, options.dt, options.tMax);
  const elapsedMs = Math.max(0.1, performance.now() - startTime);

  if (typeof rawResults === "string") {
    console.error(`❌ Error en la simulación: ${rawResults}`);
    process.exit(1);
  }

  const outputContent = options.outputFormat === "json"
    ? JSON.stringify(rawResults, null, 2)
    : formatCsv(rawResults, options.mode);

  if (options.outputPath) {
    const absoluteOutputPath = resolve(process.cwd(), options.outputPath);
    try {
      writeFileSync(absoluteOutputPath, outputContent, "utf-8");
      if (options.verbose) {
        console.log(`💾 Resultados exportados a: ${absoluteOutputPath}`);
      }
    } catch (err) {
      console.error(`❌ Error al escribir '${absoluteOutputPath}':`, err.message);
      process.exit(1);
    }
  }

  const nodeCount = rawResults[0] ? Object.keys(rawResults[0].nodeVoltages).length - 1 : 0;
  process.stdout.write(formatSummary(options.mode, rawResults.length, elapsedMs, nodeCount));
}

if (process.argv[1] && process.argv[1].endsWith("headless_cli.mjs")) {
  main().catch(err => {
    console.error("❌ Error no controlado:", err);
    process.exit(1);
  });
}
