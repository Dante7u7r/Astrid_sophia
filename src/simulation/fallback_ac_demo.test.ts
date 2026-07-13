import { describe, expect, it } from "vitest";
import type { CircuitNetlist } from "./netlist_extractor";
import {
  collectNonGroundNodes,
  createFallbackAcDemoResult,
  createLogFrequencySweep,
} from "./fallback_ac_demo";

const netlist: CircuitNetlist = {
  components: [
    { id: "R1", type: "resistor", value: 1, pins: ["1", "0"] },
    { id: "R2", type: "resistor", value: 1, pins: ["2", "1"] },
  ],
  wires: [],
};

describe("fallback_ac_demo", () => {
  it("colecta nodos no tierra", () => {
    expect(collectNonGroundNodes(netlist).sort()).toEqual(["1", "2"]);
  });

  it("crea sweep logaritmico inclusivo", () => {
    const freqs = createLogFrequencySweep(10, 1000, 2);

    expect(freqs).toHaveLength(3);
    expect(freqs[0]).toBeCloseTo(10);
    expect(freqs[1]).toBeCloseTo(100);
    expect(freqs[2]).toBeCloseTo(1000);
  });

  it("genera amplitudes y fases por nodo", () => {
    const result = createFallbackAcDemoResult(netlist);

    expect(result.frequencies).toHaveLength(101);
    expect(result.nodeAmplitudes["1"]).toHaveLength(101);
    expect(result.nodePhases["2"]).toHaveLength(101);
    expect(result.nodeAmplitudes["1"][0]).toBeLessThanOrEqual(0);
  });
});
