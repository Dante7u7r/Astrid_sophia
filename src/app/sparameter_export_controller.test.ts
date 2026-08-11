import { describe, expect, it, vi } from "vitest";
import type { CircuitNetlist } from "../simulation/netlist_extractor";
import type { SParameterResult } from "../simulation";
import type { OscilloscopePanel } from "../ui/oscilloscope_panel";
import { createSParameterExportController } from "./sparameter_export_controller";

function createNetlist(): CircuitNetlist {
  return {
    components: [
      { id: "R1", type: "resistor", value: 50, pins: ["1", "0"] },
    ],
    wires: [],
  };
}

function createResult(overrides: Partial<SParameterResult> = {}): SParameterResult {
  return {
    converged: true,
    frequencies: [1000],
    sMatrices: [[[{ re: 0.5, im: 0 }]]],
    referenceImpedance: 50,
    format: "ma",
    ports: [{ name: "Puerto 1", positiveNode: "1", negativeNode: "0", referenceImpedance: 50 }],
    ...overrides,
  };
}

function createHarness(options: {
  ports?: { nodeId: string; z0: number }[];
  result?: SParameterResult;
} = {}) {
  const oscilloscopePanel = {
    sparResult: null,
    activeAnalysisMode: "DC",
    start: vi.fn(),
  } as unknown as OscilloscopePanel;
  const invokeTauri = vi.fn(async (cmd: string) => {
    if (cmd === "extract_sparameter") return options.result ?? createResult();
    if (cmd === "export_touchstone_file") return "C:/tmp/out.s1p";
    return null;
  });
  const dependencies = {
    getOscilloscopePanel: () => oscilloscopePanel,
    getPorts: () => options.ports ?? [{ nodeId: "1", z0: 50 }],
    clearProbePlacementMode: vi.fn(),
    resetPerformanceCaches: vi.fn(),
    setIpcStatus: vi.fn(),
    addLog: vi.fn(),
    invokeTauri,
  };
  const controller = createSParameterExportController(dependencies, {
    fStart: 10,
    fEnd: 100000,
    pointsPerDecade: 20,
  });

  return { controller, dependencies, oscilloscopePanel, invokeTauri };
}

describe("SParameterExportController", () => {
  it("activa seleccion de puertos si no hay puertos RF", async () => {
    const { controller, dependencies, invokeTauri } = createHarness({ ports: [] });

    await controller.run(createNetlist());

    expect(dependencies.clearProbePlacementMode).toHaveBeenCalledOnce();
    expect(invokeTauri).not.toHaveBeenCalled();
  });

  it("extrae parametros S, actualiza osciloscopio y exporta Touchstone", async () => {
    const { controller, dependencies, oscilloscopePanel, invokeTauri } = createHarness();

    await controller.run(createNetlist());

    expect(invokeTauri).toHaveBeenCalledWith("extract_sparameter", expect.objectContaining({
      settings: expect.objectContaining({ fStart: 10, fEnd: 100000, pointsPerDecade: 20 }),
    }));
    expect(oscilloscopePanel.activeAnalysisMode).toBe("SPAR");
    expect(oscilloscopePanel.start).toHaveBeenCalledOnce();
    expect(invokeTauri).toHaveBeenCalledWith("export_touchstone_file", expect.objectContaining({
      nPorts: 1,
    }));
    expect(dependencies.setIpcStatus).toHaveBeenCalledWith(
      "S-Parameter Solver Activo",
      "var(--accent-cyan)",
    );
  });

  it("reporta error si el solver no converge", async () => {
    const { controller, dependencies, oscilloscopePanel } = createHarness({
      result: createResult({ converged: false, error: "singular" }),
    });

    await controller.run(createNetlist());

    expect(dependencies.addLog).toHaveBeenCalledWith("Error en extraccion S: singular", "error");
    expect(oscilloscopePanel.start).not.toHaveBeenCalled();
  });
});
