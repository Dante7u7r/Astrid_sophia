import { type CircuitNetlist } from "./netlist_extractor";
import { type TimeStepResult } from "../ui/oscilloscope_panel";
import {
  createMcuRuntime,
  createMcuSpiceBridge,
  updateGpioInputs,
  runCycles,
  connectGpioToNode,
  STANDARD_8051_DEFINITION,
  ATMEGA328P_DEFINITIONS,
  type McuRuntime,
  type McuSpiceBridge,
  type GpioPin,
} from "../simulation";
import {
  createMnaSystem,
  createVoltageSourceMap,
  evaluateWaveformValue,
  getMaxNodeIndex,
  stampCapacitorBackwardEuler,
  stampConductance,
  stampInductorBackwardEuler,
  stampVoltageSource,
  updateCapacitorVoltageState,
  updateInductorCurrentState,
} from "./fallback_mna";

// ==========================================================================
// INTERFAZ DE RESULTADO DEL SOLVER DC DE RESPALDO
// ==========================================================================

export interface TSResult {
  readonly nodeVoltages: Readonly<Record<string, number>>;
  readonly branchCurrents: Readonly<Record<string, number>>;
  readonly convergenceIterations: number;
}

const FALLBACK_COMPONENT_PINS: Readonly<Record<string, number | readonly number[]>> = {
  ground: 1,
  resistor: 2,
  vsource: 2,
  isource: 2,
  capacitor: 2,
  inductor: 2,
  switch: 2,
  potentiometer: 3,
  opamp: [3, 5],
  opamp_ideal: [3, 5],
  vcvs: 4,
  vccs: 4,
  ccvs: [2, 4],
  cccs: [2, 4],
  flipflop_d: 6,
  flipflop_jk: 6,
  bcd_to_7seg: 11,
  shift_register_595: 14,
  scr: 3,
  triac: 3,
  diac: 2,
  tl431: 3,
  wattmeter: 4,
  logic_probe: 1,
  pulse_generator: 2,
  frequency_counter: 2,
  stb_probe: 2,
  igbt: 3,
};

function validateFallbackNetlist(netlist: CircuitNetlist): string | null {
  if (netlist.components.length > 10_000) {
    return "El fallback local excede el limite de 10 000 componentes.";
  }
  const ids = new Set<string>();
  let maxNode = 0;
  for (const comp of netlist.components) {
    const allowedPins = FALLBACK_COMPONENT_PINS[comp.type];
    if (!allowedPins) {
      return `El componente [${comp.id}] de tipo '${comp.type}' no tiene un modelo científico en el fallback local. Use la aplicación Tauri.`;
    }
    if (!comp.id.trim() || comp.id.length > 128 || ids.has(comp.id)) {
      return `El componente [${comp.id}] tiene un ID vacio, duplicado o demasiado largo.`;
    }
    ids.add(comp.id);
    const pinMatches = Array.isArray(allowedPins)
      ? allowedPins.includes(comp.pins.length)
      : comp.pins.length === allowedPins;
    if (!pinMatches) {
      const pinDesc = Array.isArray(allowedPins) ? allowedPins.join(" o ") : allowedPins.toString();
      return `El componente [${comp.id}] requiere ${pinDesc} pines y recibio ${comp.pins.length}.`;
    }
    if (!Number.isFinite(comp.value)) {
      return `El componente [${comp.id}] tiene un valor no finito.`;
    }
    for (const pin of comp.pins) {
      if (!/^\d+$/.test(pin)) {
        return `El componente [${comp.id}] contiene un nodo no numerico.`;
      }
      maxNode = Math.max(maxNode, Number(pin));
    }
  }
  if (maxNode > 5_000) {
    return "El fallback local excede el limite de 5 000 nodos.";
  }
  return null;
}

// ==========================================================================
// ELIMINACIÓN GAUSSIANA CON PIVOTEO PARCIAL
//
// Resuelve el sistema lineal A * x = Z mediante eliminación Gaussiana
// con pivoteo parcial por filas. El pivoteo selecciona en cada columna i
// la fila con el elemento de mayor magnitud (|M[r][i]| máxima) y la
// intercambia con la fila actual i, evitando la división por ceros en
// nodos flotantes o circuitos mal condicionados.
//
// La matriz aumentada M = [A | Z] se construye y se reduce a forma
// escalonada reducida por filas (Gauss-Jordan). Cada fila i se normaliza
// dividiendo por el pivote M[i][i], y se elimina la columna i de todas
// las demás filas. Esto evita la sustitución hacia atrás, dando la
// solución directamente en la última columna.
//
// Complejidad: O(N³) con N = número de ecuaciones del sistema MNA.
// Adecuado para circuitos pequeños (N < 500). Para circuitos mayores,
// se prefiere el solver disperso (LU) en Rust.
// ==========================================================================

export function solveGaussian(A: readonly number[][], Z: readonly number[]): number[] | null {
  const size = A.length;
  const M: number[][] = Array(size).fill(0).map((_, i) => [...A[i], Z[i]]);

  for (let i = 0; i < size; i++) {
    // Pivoteo parcial: encontrar la fila con el elemento de mayor magnitud
    let maxRow = i;
    for (let r = i + 1; r < size; r++) {
      if (Math.abs(M[r][i]) > Math.abs(M[maxRow][i])) maxRow = r;
    }
    const temp = M[i];
    M[i] = M[maxRow];
    M[maxRow] = temp;

    const pivot = M[i][i];
    if (Math.abs(pivot) < 1e-12) return null;

    // Normalizar la fila del pivote
    for (let c = i; c <= size; c++) {
      M[i][c] /= pivot;
    }

    // Eliminar la columna i de todas las demás filas
    for (let r = 0; r < size; r++) {
      if (r !== i) {
        const factor = M[r][i];
        for (let c = i; c <= size; c++) {
          M[r][c] -= factor * M[i][c];
        }
      }
    }
  }

  return M.map(row => row[size]);
}

export function diagnoseSingularMna(A: readonly number[][], n: number, netlist: CircuitNetlist): string {
  // 1. Detectar nodos con conductancia diagonal nula o casi nula
  for (let i = 0; i < n; i++) {
    let rowSum = 0;
    for (let j = 0; j < A[i].length; j++) {
      rowSum += Math.abs(A[i][j]);
    }
    if (rowSum < 1e-11) {
      const nodeNum = i + 1;
      return `Error topológico: El nodo [${nodeNum}] no tiene camino resistivo a tierra ni conexión activa (nodo flotante).`;
    }
  }

  // 2. Detectar fuentes de voltaje en conflicto (mismos nodos)
  const vSources = netlist.components.filter(c => c.type === 'vsource');
  for (let i = 0; i < vSources.length; i++) {
    for (let j = i + 1; j < vSources.length; j++) {
      const v1 = vSources[i];
      const v2 = vSources[j];
      const sameNodes = (v1.pins[0] === v2.pins[0] && v1.pins[1] === v2.pins[1]) ||
                        (v1.pins[0] === v2.pins[1] && v1.pins[1] === v2.pins[0]);
      if (sameNodes) {
        return `Error topológico: Fuentes de tensión en paralelo o cortocircuito directo entre los componentes [${v1.id}] y [${v2.id}].`;
      }
    }
  }

  return "No se pudo resolver el sistema de ecuaciones. La matriz MNA es singular.";
}

export function solveGaussianWithStepping(
  A: readonly number[][],
  Z: readonly number[],
  n: number,
  netlist: CircuitNetlist,
): { solution: number[]; gminApplied: boolean; iterations: number } | string {
  // 1. Intento directo
  const direct = solveGaussian(A, Z);
  if (direct && direct.every(val => Number.isFinite(val))) {
    return { solution: direct, gminApplied: false, iterations: 1 };
  }

  // 2. Gmin Stepping: Inyectar conductancias diminutas a tierra para rescatar nodos de alta impedancia
  const gmins = [1e-12, 1e-10, 1e-8, 1e-6];
  for (let idx = 0; idx < gmins.length; idx++) {
    const gmin = gmins[idx];
    const Acopy = A.map(row => [...row]);
    for (let i = 0; i < n; i++) {
      Acopy[i][i] += gmin;
    }
    const stepped = solveGaussian(Acopy, Z);
    if (stepped && stepped.every(val => Number.isFinite(val))) {
      return { solution: stepped, gminApplied: true, iterations: idx + 2 };
    }
  }

  // 3. Si falla, emitir diagnóstico topológico guiado
  return diagnoseSingularMna(A, n, netlist);
}

// ==========================================================================
// SOLVER DC (ANÁLISIS DE CORRIENTE CONTINUA) DE RESPALDO EN TYPESCRIPT
//
// Construye el sistema MNA (Modified Nodal Analysis) estampando cada
// componente del circuito en la matriz de conductancias A y el vector
// de excitaciones Z, y lo resuelve mediante eliminación Gaussiana.
//
// Los tipos de componentes soportados:
//   - resistor: estampa conductancia G = 1/R entre nodos A y B
//   - vsource: estampa la fuente en la fila añadida (MNA expandido)
//   - isource: inyecta corriente en el nodo positivo
//   - diode / led: modelo linealizado con resistencia fija de 50Ω
//   - nmos / pmos / npn / pnp: modelos de gran señal simplificados
//   - switch: conmutador ideal con Ron/Roff
//   - opamp: modelo de ganancia finita con Rin = 10MΩ, Rout = 100Ω
//   - capacitor / inductor: como conductancia ficticia en DC
// ==========================================================================

export function solveCircuitTS(netlist: CircuitNetlist): TSResult | string {
  const validationError = validateFallbackNetlist(netlist);
  if (validationError) return validationError;

  const n = getMaxNodeIndex(netlist);
  const vSources = netlist.components.filter(c => c.type === 'vsource' || c.type === 'vcvs' || c.type === 'ccvs');
  const m = vSources.length;

  const size = n + m;
  if (size === 0) return "El circuito no tiene nodos activos o componentes.";

  const system = createMnaSystem(size);
  const { A, Z } = system;
  const vSourceMap = createVoltageSourceMap(vSources);

  for (const comp of netlist.components) {
    if (comp.type === 'resistor') {
      const nodeA = parseInt(comp.pins[0]);
      const nodeB = parseInt(comp.pins[1]);
      if (comp.value <= 1e-12) return `La resistencia del resistor [${comp.id}] es demasiado baja o cero.`;
      const G = 1.0 / comp.value;
      stampConductance(A, nodeA, nodeB, G);
    } else if (comp.type === 'stb_probe') {
      const nodeA = parseInt(comp.pins[0]);
      const nodeB = parseInt(comp.pins[1]);
      const G = comp.value > 1e-12 ? 1.0 / comp.value : 1e6;
      stampConductance(A, nodeA, nodeB, G);
    } else if (comp.type === 'vsource') {
      const nodePos = parseInt(comp.pins[0]);
      const nodeNeg = parseInt(comp.pins[1]);
      const vsIdx = vSourceMap[comp.id];
      stampVoltageSource(system, n, vsIdx, nodePos, nodeNeg, comp.value);
    } else if (comp.type === 'vcvs') {
      const nodePos = parseInt(comp.pins[0]);
      const nodeNeg = parseInt(comp.pins[1]);
      const ctrlPos = parseInt(comp.pins[2]);
      const ctrlNeg = parseInt(comp.pins[3]);
      const vsIdx = vSourceMap[comp.id];
      const col = n + vsIdx;
      if (nodePos > 0) {
        A[nodePos - 1][col] += 1.0;
        A[col][nodePos - 1] += 1.0;
      }
      if (nodeNeg > 0) {
        A[nodeNeg - 1][col] -= 1.0;
        A[col][nodeNeg - 1] -= 1.0;
      }
      if (ctrlPos > 0) A[col][ctrlPos - 1] -= comp.value;
      if (ctrlNeg > 0) A[col][ctrlNeg - 1] += comp.value;
    } else if (comp.type === 'vccs') {
      const nodePos = parseInt(comp.pins[0]);
      const nodeNeg = parseInt(comp.pins[1]);
      const ctrlPos = parseInt(comp.pins[2]);
      const ctrlNeg = parseInt(comp.pins[3]);
      const g = comp.value;
      if (nodePos > 0) {
        if (ctrlPos > 0) A[nodePos - 1][ctrlPos - 1] += g;
        if (ctrlNeg > 0) A[nodePos - 1][ctrlNeg - 1] -= g;
      }
      if (nodeNeg > 0) {
        if (ctrlPos > 0) A[nodeNeg - 1][ctrlPos - 1] -= g;
        if (ctrlNeg > 0) A[nodeNeg - 1][ctrlNeg - 1] += g;
      }
    } else if (comp.type === 'ccvs') {
      const nodePos = parseInt(comp.pins[0]);
      const nodeNeg = parseInt(comp.pins[1]);
      const vsIdx = vSourceMap[comp.id];
      const col = n + vsIdx;
      if (nodePos > 0) {
        A[nodePos - 1][col] += 1.0;
        A[col][nodePos - 1] += 1.0;
      }
      if (nodeNeg > 0) {
        A[nodeNeg - 1][col] -= 1.0;
        A[col][nodeNeg - 1] -= 1.0;
      }
      if (comp.controlling_source && vSourceMap[comp.controlling_source] !== undefined) {
        const ctrlCol = n + vSourceMap[comp.controlling_source];
        A[col][ctrlCol] -= comp.value;
      }
    } else if (comp.type === 'cccs') {
      const nodePos = parseInt(comp.pins[0]);
      const nodeNeg = parseInt(comp.pins[1]);
      if (comp.controlling_source && vSourceMap[comp.controlling_source] !== undefined) {
        const ctrlCol = n + vSourceMap[comp.controlling_source];
        if (nodePos > 0) A[nodePos - 1][ctrlCol] += comp.value;
        if (nodeNeg > 0) A[nodeNeg - 1][ctrlCol] -= comp.value;
      }
    } else if (comp.type === 'isource') {
      const nodePos = parseInt(comp.pins[0]);
      const nodeNeg = parseInt(comp.pins[1]);
      if (nodePos > 0) Z[nodePos - 1] -= comp.value;
      if (nodeNeg > 0) Z[nodeNeg - 1] += comp.value;
    } else if (comp.type === 'diode') {
      const nodeAnode = parseInt(comp.pins[0]);
      const nodeCathode = parseInt(comp.pins[1]);
      stampConductance(A, nodeAnode, nodeCathode, 1.0 / 50.0);
    } else if (comp.type === 'diac') {
      const nodeA1 = parseInt(comp.pins[0]);
      const nodeA2 = parseInt(comp.pins[1]);
      stampConductance(A, nodeA1, nodeA2, 1.0 / 1e7);
    } else if (comp.type === 'scr') {
      const nodeA = parseInt(comp.pins[0]);
      const nodeK = parseInt(comp.pins[1]);
      const nodeG = parseInt(comp.pins[2]);
      stampConductance(A, nodeA, nodeK, 1.0 / 1e6);
      stampConductance(A, nodeG, nodeK, 1.0 / 50.0);
    } else if (comp.type === 'triac') {
      const nodeMt2 = parseInt(comp.pins[0]);
      const nodeMt1 = parseInt(comp.pins[1]);
      const nodeG = parseInt(comp.pins[2]);
      stampConductance(A, nodeMt2, nodeMt1, 1.0 / 1e6);
      stampConductance(A, nodeG, nodeMt1, 1.0 / 50.0);
    } else if (comp.type === 'tl431') {
      const nodeK = parseInt(comp.pins[0]);
      const nodeA = parseInt(comp.pins[1]);
      const nodeRef = parseInt(comp.pins[2]);
      const gm = 1.0;
      const vRefTarget = comp.refVoltage ?? (comp.value > 0 ? comp.value : 2.495);
      if (nodeK > 0) {
        if (nodeRef > 0) A[nodeK - 1][nodeRef - 1] += gm;
        if (nodeA > 0) A[nodeK - 1][nodeA - 1] -= gm;
        Z[nodeK - 1] += gm * vRefTarget;
      }
      if (nodeA > 0) {
        if (nodeRef > 0) A[nodeA - 1][nodeRef - 1] -= gm;
        if (nodeA > 0) A[nodeA - 1][nodeA - 1] += gm;
        Z[nodeA - 1] -= gm * vRefTarget;
      }
      stampConductance(A, nodeK, nodeA, 1.0 / 1e5);
    } else if (comp.type === 'wattmeter') {
      const nodeIin = parseInt(comp.pins[0]);
      const nodeIout = parseInt(comp.pins[1]);
      const nodeVpos = parseInt(comp.pins[2]);
      const nodeVneg = parseInt(comp.pins[3]);
      stampConductance(A, nodeIin, nodeIout, 1.0 / 0.001);
      stampConductance(A, nodeVpos, nodeVneg, 1.0 / 1e7);
    } else if (comp.type === 'logic_probe') {
      const nodeIn = parseInt(comp.pins[0]);
      stampConductance(A, nodeIn, 0, 1.0 / 1e7);
    } else if (comp.type === 'frequency_counter') {
      const nodeIn = parseInt(comp.pins[0]);
      const nodeCom = parseInt(comp.pins[1]);
      stampConductance(A, nodeIn, nodeCom, 1.0 / 1e7);
    } else if (comp.type === 'pulse_generator') {
      const nodeGnd = parseInt(comp.pins[0]);
      const nodeOut = parseInt(comp.pins[1]);
      const vPulse = comp.amplitude ?? 5.0;
      const rOut = 25.0;
      stampConductance(A, nodeOut, nodeGnd, 1.0 / rOut);
      if (nodeOut > 0) Z[nodeOut - 1] += vPulse / rOut;
      if (nodeGnd > 0) Z[nodeGnd - 1] -= vPulse / rOut;
    } else if (comp.type === 'led') {
      const nodeAnode = parseInt(comp.pins[0]);
      const nodeCathode = parseInt(comp.pins[1]);
      stampConductance(A, nodeAnode, nodeCathode, 1.0 / 50.0);
    } else if (comp.type === 'nmos') {
      const nodeGate = parseInt(comp.pins[0]);
      const nodeDrain = parseInt(comp.pins[1]);
      const nodeSource = parseInt(comp.pins[2]);
      stampConductance(A, nodeDrain, nodeSource, 1.0 / 1e6);
      stampConductance(A, nodeGate, nodeSource, 1.0 / 1e9);
    } else if (comp.type === 'pmos') {
      const nodeGate = parseInt(comp.pins[0]);
      const nodeDrain = parseInt(comp.pins[1]);
      const nodeSource = parseInt(comp.pins[2]);
      stampConductance(A, nodeSource, nodeDrain, 1.0 / 1e6);
      stampConductance(A, nodeGate, nodeSource, 1.0 / 1e9);
    } else if (comp.type === 'npn' || comp.type === 'pnp') {
      const nodeBase = parseInt(comp.pins[0]);
      const nodeCollector = parseInt(comp.pins[1]);
      const nodeEmitter = parseInt(comp.pins[2]);
      stampConductance(A, nodeCollector, nodeEmitter, 1.0 / 1e6);
      stampConductance(A, nodeBase, nodeEmitter, 1.0 / 1e9);
    } else if (comp.type === 'switch') {
      const nodeA = parseInt(comp.pins[0]);
      const nodeB = parseInt(comp.pins[1]);
      const isClosed = comp.switchState ?? false;
      const ron = comp.switchRon ?? 0.01;
      const roff = comp.switchRoff ?? 1e9;
      const G = 1.0 / (isClosed ? ron : roff);
      stampConductance(A, nodeA, nodeB, G);
    } else if (comp.type === 'opamp' || comp.type === 'opamp_ideal') {
      const nodeInPos = parseInt(comp.pins[0]);
      const nodeInNeg = parseInt(comp.pins[1]);
      const nodeOut = parseInt(comp.pins.length >= 5 ? comp.pins[4] : comp.pins[2]);
      const aol = comp.opampAol ?? (comp.value > 0 ? comp.value : 100000.0);
      const rout = comp.opampRout ?? 75.0;
      const rin = comp.opampRin ?? 1e7;
      const vos = comp.opampVos ?? 0.0;
      const ib = comp.opampIb ?? 0.0;
      const ios = comp.opampIos ?? 0.0;

      const gIn = 1.0 / Math.max(1.0, rin);
      const gOut = 1.0 / Math.max(0.1, rout);
      const gm = aol * gOut;

      stampConductance(A, nodeInPos, nodeInNeg, gIn);
      const ibPos = ib + 0.5 * ios;
      const ibNeg = ib - 0.5 * ios;
      if (ibPos !== 0 && nodeInPos > 0) Z[nodeInPos - 1] -= ibPos;
      if (ibNeg !== 0 && nodeInNeg > 0) Z[nodeInNeg - 1] -= ibNeg;

      if (nodeOut > 0) {
        A[nodeOut - 1][nodeOut - 1] += gOut;
        if (nodeInPos > 0) A[nodeOut - 1][nodeInPos - 1] -= gm;
        if (nodeInNeg > 0) A[nodeOut - 1][nodeInNeg - 1] += gm;
        if (vos !== 0) Z[nodeOut - 1] += gm * vos;
      }
    } else if (comp.type === 'capacitor') {
      const nodeA = parseInt(comp.pins[0]);
      const nodeB = parseInt(comp.pins[1]);
      stampConductance(A, nodeA, nodeB, 1.0 / 1e7);
    } else if (comp.type === 'inductor') {
      const nodeA = parseInt(comp.pins[0]);
      const nodeB = parseInt(comp.pins[1]);
      stampConductance(A, nodeA, nodeB, 1.0 / 0.001);
    }
  }

  const solveResult = solveGaussianWithStepping(A, Z, n, netlist);
  if (typeof solveResult === "string") {
    return solveResult;
  }

  const { solution: X, iterations } = solveResult;

  const voltages: Record<string, number> = { "0": 0.0 };
  for (let i = 1; i <= n; i++) {
    voltages[i.toString()] = X[i - 1];
  }

  const currents: Record<string, number> = {};
  vSources.forEach((vs, idx) => {
    currents[vs.id] = X[n + idx];
  });

  return {
    nodeVoltages: voltages,
    branchCurrents: currents,
    convergenceIterations: iterations,
  };
}

// ==========================================================================
// SOLVER TRANSITORIO DE RESPALDO EN TYPESCRIPT (EULER REGRESIVO)
//
// Implementa un solucionador transitorio de paso fijo usando el método
// de integración implícito de Euler Regresivo (Backward Euler).
//
// MODELOS COMPANION (Euler Regresivo):
//
//   Capacitor:  I(t+dt) = (C/dt) * Vc(t+dt) - (C/dt) * Vc(t)
//               → Conductancia equivalente: g_eq = C / dt
//               → Fuente de corriente equivalente: i_eq = g_eq * Vc(t)
//
//   Inductor:   V(t+dt) = (L/dt) * Il(t+dt) - (L/dt) * Il(t)
//               → Conductancia equivalente: g_eq = dt / L
//               → Fuente de corriente equivalente: i_eq = Il(t)
//
// CO-SIMULACIÓN CON MICROCONTROLADORES:
// Los MCUs locales (8051, AVR) usan runtimes digitales experimentales
// que avanzan contadores temporales en cada paso. Sus
// salidas digitales se estampan en la matriz MNA como fuentes Norton
// equivalentes (resistencia de 50Ω + fuente de corriente).
//
// PARÁMETROS:
//   - netlist: estructura del circuito extraída del lienzo
//   - dt: paso de tiempo fijo (segundos)
//   - tMax: tiempo total de simulación (segundos)
//   - componentFirmware: mapeo de ID de componente → firmware binario
//     (opcional, para MCUs que requieren código de programa)
// ==========================================================================

export function solveTransientCircuitTS(
  netlist: CircuitNetlist,
  dt: number,
  tMax: number,
  componentFirmware: Readonly<Record<string, Uint8Array>>,
): TimeStepResult[] | string {
  const validationError = validateFallbackNetlist(netlist);
  if (validationError) return validationError;
  if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(tMax) || tMax < 0) {
    return "El fallback transitorio requiere dt finito positivo y tMax finito no negativo.";
  }
  if (tMax / dt > 2_000_000) {
    return "El fallback transitorio excede el limite de 2 000 000 de pasos.";
  }

  const n = getMaxNodeIndex(netlist);
  const vSources = netlist.components.filter(c => c.type === 'vsource' || c.type === 'vcvs' || c.type === 'ccvs');
  const m = vSources.length;
  const size = n + m;

  if (size === 0) return "El circuito no tiene nodos activos o componentes.";

  const vSourceMap = createVoltageSourceMap(vSources);

  // Inicializar históricos de almacenamiento (condiciones iniciales cero)
  const capStates: Record<string, number> = {};
  const indStates: Record<string, number> = {};

  for (const comp of netlist.components) {
    if (comp.type === 'capacitor') {
      capStates[comp.id] = 0.0;
    } else if (comp.type === 'inductor') {
      indStates[comp.id] = 0.0;
    }
  }

  // Inicializar MCUs para co-simulación en TS
  const mcuRuntimes: Record<string, { runtime: McuRuntime; bridge: McuSpiceBridge; type: string; pins: readonly string[] }> = {};
  for (const comp of netlist.components) {
    if (comp.type === 'mcu_8051' || comp.type === 'mcu_avr') {
      const baseDefinition = comp.type === 'mcu_avr'
        ? ATMEGA328P_DEFINITIONS
        : STANDARD_8051_DEFINITION;
      const definition = {
        ...baseDefinition,
        clockSpeed: comp.mcuClockSpeed ?? baseDefinition.clockSpeed,
      };
      const runtime = createMcuRuntime({
        definition,
        firmware: componentFirmware[comp.id],
      });
      const bridge = createMcuSpiceBridge(runtime, comp.pins.length);
      comp.pins.forEach((nodeId, pinIdx) => {
        connectGpioToNode(bridge, pinIdx, nodeId);
      });
      mcuRuntimes[comp.id] = {
        runtime,
        bridge,
        type: comp.type,
        pins: comp.pins,
      };
    }
  }

  const stepsCount = Math.round(tMax / dt);
  const results: TimeStepResult[] = [];
  const rustMcuOutputs: Record<string, Record<number, number>> = {};

  for (let step = 0; step <= stepsCount; step++) {
    const t = step * dt;

    // 1. Sincronizar voltajes del circuito al MCU y ejecutar instrucciones
    if (step > 0 && results.length > 0) {
      const prevVoltages = results[results.length - 1].nodeVoltages;

      // MCUs locales (8051, AVR)
      for (const mcuId in mcuRuntimes) {
        const item = mcuRuntimes[mcuId];

        const nodeVoltagesMap = new Map<string, number>();
        item.pins.forEach((nodeId) => {
          const v = parseInt(nodeId) > 0 ? (prevVoltages[nodeId] ?? 0.0) : 0.0;
          nodeVoltagesMap.set(nodeId, v);
        });

        item.bridge.config.spiceNodeVoltages = nodeVoltagesMap;
        updateGpioInputs(item.bridge);

        const clockSpeed = item.runtime.definition.clockSpeed;
        const cycles = Math.round(dt * clockSpeed);
        runCycles(item.runtime, cycles);
      }

      // MCUs Rust (mocked en TS: Arduino Uno, ESP32, Raspberry Pi Pico)
      for (const comp of netlist.components) {
        if (comp.type === 'arduino_uno' || comp.type === 'esp32' || comp.type === 'raspberry_pi_pico') {
          const vCC = comp.type === 'arduino_uno' ? 5.0 : 3.3;
          const mode = comp.value;

          const pinOutNode = comp.pins[1];
          const pinAdcNode = comp.pins[2];

          const vAdc = parseInt(pinAdcNode) > 0 ? (prevVoltages[pinAdcNode] ?? 0.0) : 0.0;

          let vOut = 0.0;
          let vDac = 0.0;

          if (mode === 1) {
            vOut = (t % 1.0 < 0.5) ? vCC : 0.0;
          } else if (mode === 2) {
            const vOutPrev = parseInt(pinOutNode) > 0 ? (prevVoltages[pinOutNode] ?? 0.0) : 0.0;
            const wasHigh = vOutPrev > 0.5 * vCC;
            const threshold = wasHigh ? 0.45 * vCC : 0.55 * vCC;
            vOut = (vAdc > threshold) ? vCC : 0.0;
          } else if (mode === 3) {
            const period = 1e-4;
            const tPhase = t % period;
            const duty = Math.min(Math.max(vAdc / vCC, 0.0), 1.0);
            vDac = (tPhase < duty * period) ? vCC : 0.0;
          } else {
            vDac = Math.min(Math.max(vAdc, 0.0), vCC);
          }

          rustMcuOutputs[comp.id] = {
            1: vOut,
            3: vDac,
          };
        }
      }
    }

    // 2. Construir el sistema MNA para este paso de tiempo
    const system = createMnaSystem(size);
    const { A, Z } = system;

    // Estampar componentes lineales base
    for (const comp of netlist.components) {
      if (comp.type === 'resistor') {
        const nodeA = parseInt(comp.pins[0]);
        const nodeB = parseInt(comp.pins[1]);
        if (comp.value <= 1e-12) return `Resistencia nula detectada.`;
        stampConductance(A, nodeA, nodeB, 1.0 / comp.value);
      } else if (comp.type === 'stb_probe') {
        const nodeA = parseInt(comp.pins[0]);
        const nodeB = parseInt(comp.pins[1]);
        const G = comp.value > 1e-12 ? 1.0 / comp.value : 1e6;
        stampConductance(A, nodeA, nodeB, G);
      } else if (comp.type === 'vsource') {
        const nodePos = parseInt(comp.pins[0]);
        const nodeNeg = parseInt(comp.pins[1]);
        const vsIdx = vSourceMap[comp.id];

        const vVal = evaluateWaveformValue(comp, t);

        stampVoltageSource(system, n, vsIdx, nodePos, nodeNeg, vVal);
      } else if (comp.type === 'vcvs') {
        const nodePos = parseInt(comp.pins[0]);
        const nodeNeg = parseInt(comp.pins[1]);
        const ctrlPos = parseInt(comp.pins[2]);
        const ctrlNeg = parseInt(comp.pins[3]);
        const vsIdx = vSourceMap[comp.id];
        const col = n + vsIdx;
        if (nodePos > 0) {
          A[nodePos - 1][col] += 1.0;
          A[col][nodePos - 1] += 1.0;
        }
        if (nodeNeg > 0) {
          A[nodeNeg - 1][col] -= 1.0;
          A[col][nodeNeg - 1] -= 1.0;
        }
        if (ctrlPos > 0) A[col][ctrlPos - 1] -= comp.value;
        if (ctrlNeg > 0) A[col][ctrlNeg - 1] += comp.value;
      } else if (comp.type === 'vccs') {
        const nodePos = parseInt(comp.pins[0]);
        const nodeNeg = parseInt(comp.pins[1]);
        const ctrlPos = parseInt(comp.pins[2]);
        const ctrlNeg = parseInt(comp.pins[3]);
        const g = comp.value;
        if (nodePos > 0) {
          if (ctrlPos > 0) A[nodePos - 1][ctrlPos - 1] += g;
          if (ctrlNeg > 0) A[nodePos - 1][ctrlNeg - 1] -= g;
        }
        if (nodeNeg > 0) {
          if (ctrlPos > 0) A[nodeNeg - 1][ctrlPos - 1] -= g;
          if (ctrlNeg > 0) A[nodeNeg - 1][ctrlNeg - 1] += g;
        }
      } else if (comp.type === 'ccvs') {
        const nodePos = parseInt(comp.pins[0]);
        const nodeNeg = parseInt(comp.pins[1]);
        const vsIdx = vSourceMap[comp.id];
        const col = n + vsIdx;
        if (nodePos > 0) {
          A[nodePos - 1][col] += 1.0;
          A[col][nodePos - 1] += 1.0;
        }
        if (nodeNeg > 0) {
          A[nodeNeg - 1][col] -= 1.0;
          A[col][nodeNeg - 1] -= 1.0;
        }
        if (comp.controlling_source && vSourceMap[comp.controlling_source] !== undefined) {
          const ctrlCol = n + vSourceMap[comp.controlling_source];
          A[col][ctrlCol] -= comp.value;
        }
      } else if (comp.type === 'cccs') {
        const nodePos = parseInt(comp.pins[0]);
        const nodeNeg = parseInt(comp.pins[1]);
        if (comp.controlling_source && vSourceMap[comp.controlling_source] !== undefined) {
          const ctrlCol = n + vSourceMap[comp.controlling_source];
          if (nodePos > 0) A[nodePos - 1][ctrlCol] += comp.value;
          if (nodeNeg > 0) A[nodeNeg - 1][ctrlCol] -= comp.value;
        }
      } else if (comp.type === 'diode') {
        const nodeAnode = parseInt(comp.pins[0]);
        const nodeCathode = parseInt(comp.pins[1]);
        stampConductance(A, nodeAnode, nodeCathode, 1.0 / 50.0);
      } else if (comp.type === 'diac') {
        const nodeA1 = parseInt(comp.pins[0]);
        const nodeA2 = parseInt(comp.pins[1]);
        stampConductance(A, nodeA1, nodeA2, 1.0 / 1e7);
      } else if (comp.type === 'scr') {
        const nodeA = parseInt(comp.pins[0]);
        const nodeK = parseInt(comp.pins[1]);
        const nodeG = parseInt(comp.pins[2]);
        stampConductance(A, nodeA, nodeK, 1.0 / 1e6);
        stampConductance(A, nodeG, nodeK, 1.0 / 50.0);
      } else if (comp.type === 'triac') {
        const nodeMt2 = parseInt(comp.pins[0]);
        const nodeMt1 = parseInt(comp.pins[1]);
        const nodeG = parseInt(comp.pins[2]);
        stampConductance(A, nodeMt2, nodeMt1, 1.0 / 1e6);
        stampConductance(A, nodeG, nodeMt1, 1.0 / 50.0);
      } else if (comp.type === 'tl431') {
        const nodeK = parseInt(comp.pins[0]);
        const nodeA = parseInt(comp.pins[1]);
        const nodeRef = parseInt(comp.pins[2]);
        const gm = 1.0;
        const vRefTarget = comp.refVoltage ?? (comp.value > 0 ? comp.value : 2.495);
        if (nodeK > 0) {
          if (nodeRef > 0) A[nodeK - 1][nodeRef - 1] += gm;
          if (nodeA > 0) A[nodeK - 1][nodeA - 1] -= gm;
          Z[nodeK - 1] += gm * vRefTarget;
        }
        if (nodeA > 0) {
          if (nodeRef > 0) A[nodeA - 1][nodeRef - 1] -= gm;
          if (nodeA > 0) A[nodeA - 1][nodeA - 1] += gm;
          Z[nodeA - 1] -= gm * vRefTarget;
        }
        stampConductance(A, nodeK, nodeA, 1.0 / 1e5);
      } else if (comp.type === 'wattmeter') {
        const nodeIin = parseInt(comp.pins[0]);
        const nodeIout = parseInt(comp.pins[1]);
        const nodeVpos = parseInt(comp.pins[2]);
        const nodeVneg = parseInt(comp.pins[3]);
        stampConductance(A, nodeIin, nodeIout, 1.0 / 0.001);
        stampConductance(A, nodeVpos, nodeVneg, 1.0 / 1e7);
      } else if (comp.type === 'logic_probe') {
        const nodeIn = parseInt(comp.pins[0]);
        stampConductance(A, nodeIn, 0, 1.0 / 1e7);
      } else if (comp.type === 'frequency_counter') {
        const nodeIn = parseInt(comp.pins[0]);
        const nodeCom = parseInt(comp.pins[1]);
        stampConductance(A, nodeIn, nodeCom, 1.0 / 1e7);
      } else if (comp.type === 'pulse_generator') {
        const nodeGnd = parseInt(comp.pins[0]);
        const nodeOut = parseInt(comp.pins[1]);
        const freq = comp.frequency ?? 1000;
        const period = 1.0 / Math.max(1, freq);
        const tMod = t % period;
        const duty = comp.dutyCycle ?? 0.5;
        const vHigh = comp.amplitude ?? 5.0;
        const vPulse = tMod < period * duty ? vHigh : 0.0;
        const rOut = 25.0;
        stampConductance(A, nodeOut, nodeGnd, 1.0 / rOut);
        if (nodeOut > 0) Z[nodeOut - 1] += vPulse / rOut;
        if (nodeGnd > 0) Z[nodeGnd - 1] -= vPulse / rOut;
      } else if (comp.type === 'nmos') {
        const nodeGate = parseInt(comp.pins[0]);
        const nodeDrain = parseInt(comp.pins[1]);
        const nodeSource = parseInt(comp.pins[2]);
        stampConductance(A, nodeDrain, nodeSource, 1.0 / 1e6);
        stampConductance(A, nodeGate, nodeSource, 1.0 / 1e9);
      } else if (comp.type === 'pmos') {
        const nodeGate = parseInt(comp.pins[0]);
        const nodeDrain = parseInt(comp.pins[1]);
        const nodeSource = parseInt(comp.pins[2]);
        stampConductance(A, nodeSource, nodeDrain, 1.0 / 1e6);
        stampConductance(A, nodeGate, nodeSource, 1.0 / 1e9);
      } else if (comp.type === 'npn' || comp.type === 'pnp') {
        const nodeBase = parseInt(comp.pins[0]);
        const nodeCollector = parseInt(comp.pins[1]);
        const nodeEmitter = parseInt(comp.pins[2]);
        stampConductance(A, nodeCollector, nodeEmitter, 1.0 / 1e6);
        stampConductance(A, nodeBase, nodeEmitter, 1.0 / 1e9);
      } else if (comp.type === 'isource') {
        const nodePos = parseInt(comp.pins[0]);
        const nodeNeg = parseInt(comp.pins[1]);

        const iVal = evaluateWaveformValue(comp, t);

        if (nodePos > 0) Z[nodePos - 1] -= iVal;
        if (nodeNeg > 0) Z[nodeNeg - 1] += iVal;
      } else if (comp.type === 'led') {
        const nodeAnode = parseInt(comp.pins[0]);
        const nodeCathode = parseInt(comp.pins[1]);
        stampConductance(A, nodeAnode, nodeCathode, 1.0 / 50.0);
      } else if (comp.type === 'switch') {
        const nodeA = parseInt(comp.pins[0]);
        const nodeB = parseInt(comp.pins[1]);
        const isClosed = comp.switchState ?? false;
        const ron = comp.switchRon ?? 0.01;
        const roff = comp.switchRoff ?? 1e9;
        const G = 1.0 / (isClosed ? ron : roff);
        stampConductance(A, nodeA, nodeB, G);
      } else if (comp.type === 'opamp' || comp.type === 'opamp_ideal') {
        const nodeInPos = parseInt(comp.pins[0]);
        const nodeInNeg = parseInt(comp.pins[1]);
        const nodeOut = parseInt(comp.pins.length >= 5 ? comp.pins[4] : comp.pins[2]);
        const aol = comp.opampAol ?? (comp.value > 0 ? comp.value : 100000.0);
        const rout = comp.opampRout ?? 75.0;
        const rin = comp.opampRin ?? 1e7;
        const vos = comp.opampVos ?? 0.0;
        const ib = comp.opampIb ?? 0.0;
        const ios = comp.opampIos ?? 0.0;

        const gIn = 1.0 / Math.max(1.0, rin);
        const gOut = 1.0 / Math.max(0.1, rout);
        const gm = aol * gOut;

        stampConductance(A, nodeInPos, nodeInNeg, gIn);
        const ibPos = ib + 0.5 * ios;
        const ibNeg = ib - 0.5 * ios;
        if (ibPos !== 0 && nodeInPos > 0) Z[nodeInPos - 1] -= ibPos;
        if (ibNeg !== 0 && nodeInNeg > 0) Z[nodeInNeg - 1] -= ibNeg;

        if (nodeOut > 0) {
          A[nodeOut - 1][nodeOut - 1] += gOut;
          if (nodeInPos > 0) A[nodeOut - 1][nodeInPos - 1] -= gm;
          if (nodeInNeg > 0) A[nodeOut - 1][nodeInNeg - 1] += gm;
          if (vos !== 0) Z[nodeOut - 1] += gm * vos;
        }
      }
    }

    // Estampar MCUs locales (8051 y AVR) usando modelo Norton
    for (const mcuId in mcuRuntimes) {
      const item = mcuRuntimes[mcuId];
      item.bridge.config.gpioPins.forEach((pin: GpioPin) => {
        const nodeStr = pin.connectedNodeId;
        if (!nodeStr) return;
        const nodeIdx = parseInt(nodeStr);
        if (nodeIdx <= 0) return;

        if (pin.direction !== 'input') {
          if (pin.state === 1) {
            stampConductance(A, nodeIdx, 0, 1.0 / 50.0);
            Z[nodeIdx - 1] += 5.0 / 50.0;
          } else if (pin.state === 0) {
            stampConductance(A, nodeIdx, 0, 1.0 / 50.0);
          } else {
            stampConductance(A, nodeIdx, 0, 1.0 / 1e6);
          }
        } else {
          stampConductance(A, nodeIdx, 0, 1.0 / 1e6);
        }
      });
    }

    // Estampar MCUs Rust (mocked) mediante modelo Norton
    for (const comp of netlist.components) {
      if (comp.type === 'arduino_uno' || comp.type === 'esp32' || comp.type === 'raspberry_pi_pico') {
        const vCC = comp.type === 'arduino_uno' ? 5.0 : 3.3;
        const outputs = rustMcuOutputs[comp.id] || {};

        comp.pins.forEach((nodeId, pinIdx) => {
          const nodeIdx = parseInt(nodeId);
          if (nodeIdx <= 0) return;

          if (pinIdx === 1) {
            const vOut = outputs[1] ?? 0.0;
            stampConductance(A, nodeIdx, 0, 1.0 / 50.0);
            Z[nodeIdx - 1] += vOut / 50.0;
          } else if (pinIdx === 3) {
            const vDac = outputs[3] ?? 0.0;
            stampConductance(A, nodeIdx, 0, 1.0 / 50.0);
            Z[nodeIdx - 1] += vDac / 50.0;
          } else if (pinIdx === 4) {
            stampConductance(A, nodeIdx, 0, 1.0 / 50.0);
            Z[nodeIdx - 1] += vCC / 50.0;
          } else {
            stampConductance(A, nodeIdx, 0, 1.0 / 1e6);
          }
        });
      }
    }

    // Estampar modelos companion Euler para elementos reactivos
    for (const comp of netlist.components) {
      if (comp.type === 'capacitor') {
        const nodePos = parseInt(comp.pins[0]);
        const nodeNeg = parseInt(comp.pins[1]);
        const prevVc = capStates[comp.id] || 0.0;
        stampCapacitorBackwardEuler(system, nodePos, nodeNeg, comp.value, dt, prevVc);

      } else if (comp.type === 'inductor') {
        const nodePos = parseInt(comp.pins[0]);
        const nodeNeg = parseInt(comp.pins[1]);
        const prevIl = indStates[comp.id] || 0.0;
        stampInductorBackwardEuler(system, nodePos, nodeNeg, comp.value, dt, prevIl);
      }
    }

    // Resolver sistema lineal del paso actual
    const X = solveGaussian(A, Z);
    if (!X) {
      return `Matriz singular transitoria en t=${t.toFixed(4)}`;
    }

    // Desempaquetar voltajes de nodo y corrientes de rama
    const stepVoltages: Record<string, number> = { "0": 0.0 };
    for (let i = 1; i <= n; i++) {
      stepVoltages[i.toString()] = X[i - 1];
    }

    const stepCurrents: Record<string, number> = {};
    vSources.forEach((vs, idx) => {
      stepCurrents[vs.id] = X[n + idx];
    });

    results.push({
      time: t,
      nodeVoltages: stepVoltages,
      branchCurrents: stepCurrents,
    });

    // Actualizar estados para el siguiente paso temporal
    for (const comp of netlist.components) {
      if (comp.type === 'capacitor') {
        const nodePos = parseInt(comp.pins[0]);
        const nodeNeg = parseInt(comp.pins[1]);
        capStates[comp.id] = updateCapacitorVoltageState(nodePos, nodeNeg, stepVoltages);

      } else if (comp.type === 'inductor') {
        const nodePos = parseInt(comp.pins[0]);
        const nodeNeg = parseInt(comp.pins[1]);
        const prevIl = indStates[comp.id] || 0.0;
        indStates[comp.id] = updateInductorCurrentState(
          nodePos,
          nodeNeg,
          comp.value,
          dt,
          prevIl,
          stepVoltages,
        );
      }
    }
  }

  return results;
}
