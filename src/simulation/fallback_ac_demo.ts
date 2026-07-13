import type { CircuitNetlist } from "./netlist_extractor";

export interface FallbackAcDemoResult {
  frequencies: number[];
  nodeAmplitudes: Record<string, number[]>;
  nodePhases: Record<string, number[]>;
}

export function collectNonGroundNodes(netlist: CircuitNetlist): string[] {
  const nodes = new Set<string>();
  netlist.components.forEach(comp => {
    comp.pins.forEach(pin => {
      if (pin !== "0") nodes.add(pin);
    });
  });
  return [...nodes];
}

export function createLogFrequencySweep(
  fStart: number,
  fEnd: number,
  points: number,
): number[] {
  const logMin = Math.log10(fStart);
  const logMax = Math.log10(fEnd);
  const frequencies: number[] = [];
  for (let i = 0; i <= points; i++) {
    const logVal = logMin + (i / points) * (logMax - logMin);
    frequencies.push(Math.pow(10, logVal));
  }
  return frequencies;
}

export function createFallbackAcDemoResult(netlist: CircuitNetlist): FallbackAcDemoResult {
  const frequencies = createLogFrequencySweep(10, 100000, 100);
  const nodeAmplitudes: Record<string, number[]> = {};
  const nodePhases: Record<string, number[]> = {};

  for (const nodeId of collectNonGroundNodes(netlist)) {
    const fc = nodeId === "1" ? 1000 : nodeId === "2" ? 10000 : 5000;
    const amps: number[] = [];
    const phases: number[] = [];
    for (const f of frequencies) {
      const ratio = f / fc;
      const mag = 1.0 / Math.sqrt(1 + ratio * ratio);
      const phase = -Math.atan(ratio) * (180 / Math.PI);
      amps.push(20 * Math.log10(mag));
      phases.push(phase);
    }
    nodeAmplitudes[nodeId] = amps;
    nodePhases[nodeId] = phases;
  }

  return { frequencies, nodeAmplitudes, nodePhases };
}
