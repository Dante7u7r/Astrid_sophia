import { describe, expect, it } from "vitest";
import type { AcSweepResult, TimeStepResult } from "./oscilloscope_panel";
import {
  type ExportSnapshot,
  buildCsvExport,
  buildSvgExport,
  buildTouchstoneExport,
} from "./exporter_model";

function acResult(): AcSweepResult {
  return {
    frequencies: [10, 100],
    nodeAmplitudes: {
      "1": [-3.25, -6.5],
      "2": [-20, -10],
    },
    nodePhases: {
      "1": [45, 30],
      "2": [-10, -20],
    },
  };
}

function transientResults(): TimeStepResult[] {
  return [
    { time: 0, nodeVoltages: { "1": 0, "2": 1 }, branchCurrents: {} },
    { time: 0.001, nodeVoltages: { "1": 2, "2": -1 }, branchCurrents: {} },
  ];
}

function snapshot(overrides: Partial<ExportSnapshot> = {}): ExportSnapshot {
  return {
    activeAnalysisMode: "DC",
    acResults: null,
    transientResults: [],
    ch1Node: "1",
    ch2Node: "2",
    voltageMap: { "1": 5, "2": 2.5 },
    ...overrides,
  };
}

describe("exporter_model", () => {
  it("construye CSV para punto de operacion", () => {
    const result = buildCsvExport(snapshot());

    expect(result.filename).toBe("reporte_punto_operacion_cc.csv");
    expect(result.content).toContain("Nodo,Voltaje Operacion (V)");
    expect(result.content).toContain("1,5.00000");
  });

  it("construye CSV transitorio con canales", () => {
    const result = buildCsvExport(snapshot({
      activeAnalysisMode: "TRAN",
      transientResults: transientResults(),
    }));

    expect(result.filename).toBe("reporte_transitorio.csv");
    expect(result.content).toContain("0.001000,2.00000,-1.00000");
  });

  it("construye SVG AC con rutas de Bode", () => {
    const result = buildSvgExport(snapshot({
      activeAnalysisMode: "AC",
      acResults: acResult(),
    }));

    expect(result.filename).toBe("grafico_barrido_ca.svg");
    expect(result.content).toContain("<path");
    expect(result.content).toContain("Magnitud CH1 (1)");
  });

  it("construye Touchstone solo con barrido AC valido", () => {
    expect(buildTouchstoneExport(snapshot(), "2026-01-01T00:00:00.000Z")).toBeNull();

    const result = buildTouchstoneExport(snapshot({
      activeAnalysisMode: "AC",
      acResults: acResult(),
    }), "2026-01-01T00:00:00.000Z");

    expect(result?.filename).toBe("reporte_s2p.s2p");
    expect(result?.content).toContain("# Hz S DB R 50");
    expect(result?.content).toContain("10.0000 -3.250000 45.000000 -20.000000 -10.000000");
  });
});
