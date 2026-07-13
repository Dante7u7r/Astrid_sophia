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
  const n = getMaxNodeIndex(netlist);
  const vSources = netlist.components.filter(c => c.type === 'vsource');
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
    } else if (comp.type === 'vsource') {
      const nodePos = parseInt(comp.pins[0]);
      const nodeNeg = parseInt(comp.pins[1]);
      const vsIdx = vSourceMap[comp.id];
      stampVoltageSource(system, n, vsIdx, nodePos, nodeNeg, comp.value);
    } else if (comp.type === 'isource') {
      const nodePos = parseInt(comp.pins[0]);
      const nodeNeg = parseInt(comp.pins[1]);
      if (nodePos > 0) Z[nodePos - 1] -= comp.value;
      if (nodeNeg > 0) Z[nodeNeg - 1] += comp.value;
    } else if (comp.type === 'diode') {
      const nodeAnode = parseInt(comp.pins[0]);
      const nodeCathode = parseInt(comp.pins[1]);
      stampConductance(A, nodeAnode, nodeCathode, 1.0 / 50.0);
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
    } else if (comp.type === 'opamp') {
      const nodeInPos = parseInt(comp.pins[0]);
      const nodeInNeg = parseInt(comp.pins[1]);
      const nodeOut = parseInt(comp.pins[4]);
      stampConductance(A, nodeInPos, nodeInNeg, 1.0 / 1e7);
      stampConductance(A, nodeOut, 0, 1.0 / 100.0);
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

  const X = solveGaussian(A, Z);
  if (!X) {
    return "No se pudo resolver el sistema de ecuaciones. La matriz MNA es singular.";
  }

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
    convergenceIterations: 1,
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
// Los MCUs locales (8051, AVR) se simulan mediante runtimes digitales
// que ejecutan ciclos de reloj completos en cada paso de tiempo. Sus
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
  const n = getMaxNodeIndex(netlist);
  const vSources = netlist.components.filter(c => c.type === 'vsource');
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
      } else if (comp.type === 'vsource') {
        const nodePos = parseInt(comp.pins[0]);
        const nodeNeg = parseInt(comp.pins[1]);
        const vsIdx = vSourceMap[comp.id];

        const vVal = evaluateWaveformValue(comp, t);

        stampVoltageSource(system, n, vsIdx, nodePos, nodeNeg, vVal);
      } else if (comp.type === 'diode') {
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
      } else if (comp.type === 'opamp') {
        const nodeInPos = parseInt(comp.pins[0]);
        const nodeInNeg = parseInt(comp.pins[1]);
        const nodeOut = parseInt(comp.pins[4]);
        stampConductance(A, nodeInPos, nodeInNeg, 1.0 / 1e7);
        stampConductance(A, nodeOut, 0, 1.0 / 100.0);
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
