import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";
import type { CircuitNetlist } from "../simulation/netlist_extractor";
import type { PvtConfig } from "../simulation";
import type { OscilloscopePanel, PvtRunResult } from "../ui/oscilloscope_panel";
import { createPvtAnalysisController } from "./pvt_analysis_controller";

function createNetlist(): CircuitNetlist {
  return {
    components: [
      { id: "V1", type: "voltage_source", value: 5, pins: ["1", "0"] },
    ],
    wires: [],
  };
}

function createPvtResult(config: PvtConfig): PvtRunResult {
  return {
    config,
    transient: [
      { time: 0, nodeVoltages: { "1": 5 }, branchCurrents: {} },
    ],
    converged: true,
    error: null,
  };
}

function createHarness() {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = `
    <div id="simulation-bar">
      <button id="run">Simular</button>
      <div style="width: 1px"></div>
    </div>
  `;

  const oscilloscopePanel = {
    ch1ProbeNode: "1",
    ch2ProbeNode: "2",
    ch3ProbeNode: null,
    ch4ProbeNode: null,
    pvtTraces: [],
    pvtMode: false,
    transientResults: [{ time: 1, nodeVoltages: {}, branchCurrents: {} }],
    sweepTime: 1,
    activeAnalysisMode: "DC",
    start: vi.fn(),
  } as unknown as OscilloscopePanel;

  const invokeTauri = vi.fn(async (_cmd: string, args: { pvtConfigs: PvtConfig[] }) => (
    args.pvtConfigs.map((config) => createPvtResult(config))
  ));

  const dependencies = {
    getOscilloscopePanel: () => oscilloscopePanel,
    getSimulationSettings: () => ({ dt: 0.0001, tolerance: 0.00001, maxIterations: 100 }),
    getSimulationBar: () => document.querySelector("#simulation-bar"),
    setSimulationRunning: vi.fn(),
    resetPerformanceCaches: vi.fn(),
    setIpcStatus: vi.fn(),
    addLog: vi.fn(),
    invokeTauri,
    documentRef: document,
  };

  const controller = createPvtAnalysisController(dependencies);
  return { controller, dependencies, document, invokeTauri, oscilloscopePanel };
}

describe("PvtAnalysisController", () => {
  it("crea botones de perfil PVT y limpia botones previos", () => {
    const { controller, document } = createHarness();
    const staleButton = document.createElement("button");
    staleButton.className = "pvt-profile-btn";
    document.body.appendChild(staleButton);

    controller.run(createNetlist());

    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".pvt-profile-btn"));
    expect(buttons).toHaveLength(3);
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Comercial (0-70 C)",
      "Industrial (-40-85 C)",
      "Automotriz (-40-125 C)",
    ]);
  });

  it("ejecuta matriz PVT y actualiza el osciloscopio", async () => {
    const { controller, dependencies, invokeTauri, oscilloscopePanel } = createHarness();

    await controller.executeMatrix(createNetlist(), [
      { corner: "tt", temperatureC: 25, voltageScaling: 1 },
    ]);

    expect(invokeTauri).toHaveBeenCalledWith("run_pvt_matrix_analysis", expect.objectContaining({
      monitoredNodes: ["1", "2"],
      transientSettings: expect.objectContaining({ tMax: 0.05, fixedStep: true }),
    }));
    expect(oscilloscopePanel.pvtMode).toBe(true);
    expect(oscilloscopePanel.pvtTraces).toHaveLength(1);
    expect(oscilloscopePanel.transientResults).toEqual([]);
    expect(oscilloscopePanel.activeAnalysisMode).toBe("PVT");
    expect(oscilloscopePanel.start).toHaveBeenCalledOnce();
    expect(dependencies.resetPerformanceCaches).toHaveBeenCalledOnce();
    expect(dependencies.setIpcStatus).toHaveBeenCalledWith(
      "PVT Matrix Solver Activo",
      "var(--accent-cyan)",
    );
  });

  it("deshabilita botones mientras corre el perfil seleccionado", async () => {
    const { controller, dependencies, document } = createHarness();
    controller.run(createNetlist());

    const firstButton = document.querySelector<HTMLButtonElement>(".pvt-profile-btn");
    firstButton?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(dependencies.setSimulationRunning).toHaveBeenNthCalledWith(1, true);
    expect(dependencies.setSimulationRunning).toHaveBeenLastCalledWith(false);
    expect(firstButton?.classList.contains("active")).toBe(true);
    expect(firstButton?.disabled).toBe(false);
  });
});
