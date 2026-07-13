import { describe, expect, it } from "vitest";
import type { CircuitNetlist, ExtractedComponent } from "./netlist_extractor";
import {
  createMnaSystem,
  createVoltageSourceMap,
  evaluateWaveformValue,
  getMaxNodeIndex,
  stampConductance,
  stampCapacitorBackwardEuler,
  stampInductorBackwardEuler,
  stampVoltageSource,
  updateCapacitorVoltageState,
  updateInductorCurrentState,
} from "./fallback_mna";

function component(id: string, type: string, pins: string[], value = 1): ExtractedComponent {
  return { id, type, pins, value };
}

describe("fallback_mna", () => {
  it("calcula el mayor nodo numerico", () => {
    const netlist: CircuitNetlist = {
      components: [
        component("R1", "resistor", ["1", "0"]),
        component("R2", "resistor", ["4", "2"]),
      ],
      wires: [],
    };
    expect(getMaxNodeIndex(netlist)).toBe(4);
  });

  it("estampa conductancia entre dos nodos", () => {
    const system = createMnaSystem(2);

    stampConductance(system.A, 1, 2, 0.5);

    expect(system.A).toEqual([
      [0.5, -0.5],
      [-0.5, 0.5],
    ]);
  });

  it("estampa fuente de voltaje en MNA", () => {
    const system = createMnaSystem(3);

    stampVoltageSource(system, 2, 0, 1, 0, 5);

    expect(system.A[0][2]).toBe(1);
    expect(system.A[2][0]).toBe(1);
    expect(system.Z[2]).toBe(5);
  });

  it("crea mapa de fuentes de voltaje", () => {
    expect(createVoltageSourceMap([
      component("V1", "vsource", ["1", "0"]),
      component("V2", "vsource", ["2", "0"]),
    ])).toEqual({ V1: 0, V2: 1 });
  });

  it("evalua formas de onda soportadas", () => {
    expect(evaluateWaveformValue({
      value: 1,
      waveType: "sine",
      amplitude: 2,
      frequency: 1,
      offset: 3,
    }, 0.25)).toBeCloseTo(5);

    expect(evaluateWaveformValue({
      value: 0,
      waveType: "square",
      amplitude: 2,
      frequency: 1,
      offset: 1,
      dutyCycle: 0.5,
    }, 0.75)).toBe(-1);

    expect(evaluateWaveformValue({
      value: 0,
      waveType: "pulse",
      amplitude: 2,
      frequency: 1,
      offset: 1,
      dutyCycle: 0.5,
    }, 0.25)).toBe(3);
  });

  it("estampa modelos companion de capacitor e inductor", () => {
    const capSystem = createMnaSystem(2);
    stampCapacitorBackwardEuler(capSystem, 1, 2, 1e-6, 1e-3, 2);
    expect(capSystem.A).toEqual([
      [0.001, -0.001],
      [-0.001, 0.001],
    ]);
    expect(capSystem.Z).toEqual([0.002, -0.002]);

    const indSystem = createMnaSystem(2);
    stampInductorBackwardEuler(indSystem, 1, 0, 1e-3, 1e-4, 0.5);
    expect(indSystem.A[0][0]).toBeCloseTo(0.1);
    expect(indSystem.Z[0]).toBeCloseTo(-0.5);
  });

  it("actualiza estados reactivos para el siguiente paso", () => {
    const voltages = { "0": 0, "1": 5, "2": 2 };
    expect(updateCapacitorVoltageState(1, 2, voltages)).toBe(3);
    expect(updateInductorCurrentState(1, 2, 1e-3, 1e-4, 0.2, voltages)).toBeCloseTo(0.5);
  });
});
