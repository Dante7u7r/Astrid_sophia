import type { CircuitNetlist, ExtractedComponent } from "./netlist_extractor";

export interface MnaSystem {
  A: number[][];
  Z: number[];
}

export function getMaxNodeIndex(netlist: CircuitNetlist): number {
  let maxNodeIdx = 0;
  for (const comp of netlist.components) {
    for (const pinNode of comp.pins) {
      const idx = parseInt(pinNode);
      if (idx > maxNodeIdx) maxNodeIdx = idx;
    }
  }
  return maxNodeIdx;
}

export function createMnaSystem(size: number): MnaSystem {
  return {
    A: Array(size).fill(0).map(() => Array(size).fill(0)),
    Z: Array(size).fill(0),
  };
}

export function createVoltageSourceMap(
  vSources: readonly ExtractedComponent[],
): Record<string, number> {
  const vSourceMap: Record<string, number> = {};
  vSources.forEach((vs, idx) => {
    vSourceMap[vs.id] = idx;
  });
  return vSourceMap;
}

export function stampConductance(
  A: number[][],
  nodeA: number,
  nodeB: number,
  conductance: number,
): void {
  if (nodeA > 0) A[nodeA - 1][nodeA - 1] += conductance;
  if (nodeB > 0) A[nodeB - 1][nodeB - 1] += conductance;
  if (nodeA > 0 && nodeB > 0) {
    A[nodeA - 1][nodeB - 1] -= conductance;
    A[nodeB - 1][nodeA - 1] -= conductance;
  }
}

export function stampVoltageSource(
  system: MnaSystem,
  nodeCount: number,
  vsourceIdx: number,
  nodePos: number,
  nodeNeg: number,
  voltage: number,
): void {
  const col = nodeCount + vsourceIdx;
  if (nodePos > 0) {
    system.A[nodePos - 1][col] += 1.0;
    system.A[col][nodePos - 1] += 1.0;
  }
  if (nodeNeg > 0) {
    system.A[nodeNeg - 1][col] -= 1.0;
    system.A[col][nodeNeg - 1] -= 1.0;
  }
  system.Z[col] = voltage;
}

export function evaluateWaveformValue(
  comp: Pick<ExtractedComponent, "value" | "waveType" | "amplitude" | "frequency" | "offset" | "dutyCycle">,
  t: number,
): number {
  let value = comp.value;
  if (!comp.waveType) return value;

  const amp = comp.amplitude ?? 0;
  const freq = comp.frequency ?? 1000;
  const offset = comp.offset ?? 0;
  const duty = comp.dutyCycle ?? 0.5;

  if (comp.waveType === "sine") {
    value = offset + amp * Math.sin(2 * Math.PI * freq * t);
  } else if (comp.waveType === "square") {
    const period = 1.0 / freq;
    const tMod = t % period;
    value = tMod < duty * period ? offset + amp : offset - amp;
  } else if (comp.waveType === "pulse") {
    const period = 1.0 / freq;
    const tMod = t % period;
    value = tMod < duty * period ? offset + amp : offset;
  }

  return value;
}

export function stampCapacitorBackwardEuler(
  system: MnaSystem,
  nodePos: number,
  nodeNeg: number,
  capacitance: number,
  dt: number,
  previousVoltage: number,
): void {
  const gEq = capacitance / dt;
  const iEq = gEq * previousVoltage;

  stampConductance(system.A, nodePos, nodeNeg, gEq);
  if (nodePos > 0) system.Z[nodePos - 1] += iEq;
  if (nodeNeg > 0) system.Z[nodeNeg - 1] -= iEq;
}

export function stampInductorBackwardEuler(
  system: MnaSystem,
  nodePos: number,
  nodeNeg: number,
  inductance: number,
  dt: number,
  previousCurrent: number,
): void {
  const gEq = dt / inductance;

  stampConductance(system.A, nodePos, nodeNeg, gEq);
  if (nodePos > 0) system.Z[nodePos - 1] -= previousCurrent;
  if (nodeNeg > 0) system.Z[nodeNeg - 1] += previousCurrent;
}

export function updateCapacitorVoltageState(
  nodePos: number,
  nodeNeg: number,
  stepVoltages: Readonly<Record<string, number>>,
): number {
  const vPos = nodePos > 0 ? stepVoltages[nodePos.toString()] ?? 0.0 : 0.0;
  const vNeg = nodeNeg > 0 ? stepVoltages[nodeNeg.toString()] ?? 0.0 : 0.0;
  return vPos - vNeg;
}

export function updateInductorCurrentState(
  nodePos: number,
  nodeNeg: number,
  inductance: number,
  dt: number,
  previousCurrent: number,
  stepVoltages: Readonly<Record<string, number>>,
): number {
  const vPos = nodePos > 0 ? stepVoltages[nodePos.toString()] ?? 0.0 : 0.0;
  const vNeg = nodeNeg > 0 ? stepVoltages[nodeNeg.toString()] ?? 0.0 : 0.0;
  return (dt / inductance) * (vPos - vNeg) + previousCurrent;
}
