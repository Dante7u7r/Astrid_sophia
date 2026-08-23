import { describe, expect, it } from "vitest";
import { PackedTransientView } from "./packed_transient";
import type { TimeStepResult } from "../ui/oscilloscope_panel";

describe("PackedTransientView", () => {
  it("construye una vista empaquetada a partir de payload crudo", () => {
    const view = new PackedTransientView({
      nodeNames: ["1", "2"],
      branchNames: ["R1"],
      times: [0.0, 0.001, 0.002],
      nodeVoltages: [5.0, 2.5, 4.0, 2.0, 3.0, 1.5],
      branchCurrents: [0.005, 0.004, 0.003],
    });

    expect(view.stepCount).toBe(3);
    expect(view.nodeNames).toEqual(["1", "2"]);
    expect(view.branchNames).toEqual(["R1"]);

    expect(view.getTime(0)).toBe(0.0);
    expect(view.getTime(1)).toBe(0.001);
    expect(view.getTime(2)).toBe(0.002);

    expect(view.getNodeVoltage("1", 0)).toBe(5.0);
    expect(view.getNodeVoltage("2", 0)).toBe(2.5);
    expect(view.getNodeVoltage("1", 1)).toBe(4.0);
    expect(view.getNodeVoltage("2", 1)).toBe(2.0);

    expect(view.getBranchCurrent("R1", 0)).toBe(0.005);
    expect(view.getBranchCurrent("R1", 2)).toBe(0.003);

    // Nodos inexistentes retornan 0.0
    expect(view.getNodeVoltage("invalido", 0)).toBe(0.0);
  });

  it("extrae la forma de onda de un nodo como Float64Array contiguo", () => {
    const view = new PackedTransientView({
      nodeNames: ["A", "B"],
      branchNames: [],
      times: [0.0, 0.1, 0.2],
      nodeVoltages: [10.0, 1.0, 20.0, 2.0, 30.0, 3.0],
      branchCurrents: [],
    });

    const waveformA = view.getNodeWaveform("A");
    expect(waveformA).toBeInstanceOf(Float64Array);
    expect(Array.from(waveformA)).toEqual([10.0, 20.0, 30.0]);

    const waveformB = view.getNodeWaveform("B");
    expect(Array.from(waveformB)).toEqual([1.0, 2.0, 3.0]);
  });

  it("convierte bidireccionalmente entre TimeStepResult[] y PackedTransientView sin perdida", () => {
    const original: TimeStepResult[] = [
      {
        time: 0.0,
        nodeVoltages: { "out": 3.3, "in": 0.0 },
        branchCurrents: { "L1": 0.01 },
      },
      {
        time: 0.5,
        nodeVoltages: { "out": 3.2, "in": 1.0 },
        branchCurrents: { "L1": 0.015 },
      },
    ];

    const packed = PackedTransientView.fromTimeSteps(original);
    expect(packed.stepCount).toBe(2);
    expect(packed.getNodeVoltage("out", 0)).toBe(3.3);
    expect(packed.getNodeVoltage("in", 1)).toBe(1.0);
    expect(packed.getBranchCurrent("L1", 1)).toBe(0.015);

    const unpacked = packed.unpack();
    expect(unpacked).toHaveLength(2);
    expect(unpacked[0]?.time).toBe(0.0);
    expect(unpacked[0]?.nodeVoltages["out"]).toBe(3.3);
    expect(unpacked[1]?.time).toBe(0.5);
    expect(unpacked[1]?.nodeVoltages["in"]).toBe(1.0);
    expect(unpacked[1]?.branchCurrents?.["L1"]).toBe(0.015);
  });
});
