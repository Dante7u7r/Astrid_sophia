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
  comp: Pick<
    ExtractedComponent,
    "value" | "waveType" | "amplitude" | "frequency" | "offset" | "dutyCycle" | "phase" | "modFrequency" | "modIndex"
  >,
  t: number,
): number {
  if (!comp.waveType || comp.waveType === "dc") return comp.value;

  const amp = comp.amplitude ?? 0;
  const freq = comp.frequency ?? 1000;
  const offset = comp.offset ?? 0;
  const duty = comp.dutyCycle ?? 0.5;
  const phaseRad = (((comp.phase ?? 0) * Math.PI) / 180);

  switch (comp.waveType) {
    case "sine":
      return offset + amp * Math.sin(2 * Math.PI * freq * t + phaseRad);

    case "square": {
      const period = 1.0 / freq;
      const tMod = t % period;
      return tMod < duty * period ? offset + amp : offset - amp;
    }

    case "pulse": {
      const period = 1.0 / freq;
      const tMod = t % period;
      return tMod < duty * period ? offset + amp : offset;
    }

    case "triangle": {
      const period = 1.0 / freq;
      const tMod = t % period;
      const phase = tMod / period;
      // Rampa ascendente 0→1 en [0, 0.5], descendente 1→0 en [0.5, 1]
      const normalized = phase < 0.5
        ? phase * 2.0
        : 2.0 - phase * 2.0;
      return offset + amp * (2.0 * normalized - 1.0);
    }

    case "sawtooth": {
      const period = 1.0 / freq;
      const tMod = t % period;
      // Rampa lineal ascendente de -amp a +amp en un período
      return offset + amp * (2.0 * (tMod / period) - 1.0);
    }

    case "am": {
      // Modulación de Amplitud (AM): v(t) = Offset + Ac * [1 + m * sin(2*pi*fm*t)] * sin(2*pi*fc*t + phase)
      const carrierFreq = freq;
      const modFreq = comp.modFrequency ?? (freq / 10);
      const modIndex = comp.modIndex ?? 0.8;
      const carrier = Math.sin(2 * Math.PI * carrierFreq * t + phaseRad);
      const modulation = 1.0 + modIndex * Math.sin(2 * Math.PI * modFreq * t);
      return offset + amp * modulation * carrier;
    }

    default:
      return comp.value;
  }
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
