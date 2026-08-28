import { describe, expect, it, vi } from "vitest";
import type { CanvasOrchestrator } from "../canvas_orchestrator";
import { createCircuitStateManager } from "../simulation/circuit_state_manager";
import type { CircuitNetlist } from "../simulation/netlist_extractor";
import type { OscilloscopePanel } from "../ui/oscilloscope_panel";
import type { SimulationSettings } from "../ui/settings_modal";
import { createSimulationController } from "./simulation_controller";

function createHarness(overrides: {
  orchestrator?: Partial<CanvasOrchestrator>;
  netlist?: CircuitNetlist | null;
} = {}) {
  const orchestrator = {
    components: [],
    wires: [],
    ercIssues: [],
    render: vi.fn(),
    getComponentPins: vi.fn(() => []),
    ...overrides.orchestrator,
  } as unknown as CanvasOrchestrator;

  const oscilloscopePanel = {
    transientResults: [],
    acSweepResults: null,
    sweepTime: 0,
    pvtMode: false,
    pvtTraces: [],
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  } as unknown as OscilloscopePanel;

  const settings: SimulationSettings = {
    dt: 0.0001,
    tolerance: 0.00001,
    maxIterations: 100,
  };

  const deps = {
    getOrchestrator: () => orchestrator,
    getOscilloscopePanel: () => oscilloscopePanel,
    getSimulationRunner: () => null,
    getSimulationSettings: () => settings,
    setSimulationRunning: vi.fn(),
    setActiveAnalysisMode: vi.fn(),
    getActiveTabId: () => "tab-1",
    bindTransientResultsToTab: vi.fn(),
    extractNetlist: vi.fn(() => overrides.netlist ?? null),
    solveTransientCircuitLocal: vi.fn(async () => []),
    runPvtAnalysis: vi.fn(async () => undefined),
    runSparamExport: vi.fn(async () => undefined),
    circuitState: createCircuitStateManager(),
    resetPerformanceCaches: vi.fn(),
    updateCanvasRendering: vi.fn(),
    updateOscilloscopeRendering: vi.fn(),
    setIpcStatus: vi.fn(),
    addLog: vi.fn(),
  };

  return {
    controller: createSimulationController(deps),
    deps,
    orchestrator,
    oscilloscopePanel,
  };
}

describe("SimulationController", () => {
  it("rechaza la simulacion si el lienzo esta vacio", async () => {
    const { controller, deps } = createHarness();

    await controller.runSimulation("DC");

    expect(deps.extractNetlist).not.toHaveBeenCalled();
    expect(deps.setSimulationRunning).toHaveBeenCalledWith(false);
    expect(deps.addLog).toHaveBeenCalledWith(
      "Error: El lienzo está vacío. Coloca componentes antes de simular.",
      "error",
    );
  });

  it("aborta si ERC encuentra errores topologicos", async () => {
    const netlist: CircuitNetlist = {
      components: [
        { id: "R1", type: "resistor", value: 1000, pins: ["1", "2"] },
      ],
      wires: [],
    };
    const { controller, deps, orchestrator, oscilloscopePanel } = createHarness({
      netlist,
      orchestrator: {
        components: [
          { id: "R1", type: "resistor", value: "1k", x: 0, y: 0, rotation: 0 },
        ],
        wires: [],
        getComponentPins: vi.fn(() => [
          { x: -40, y: 0, pinIndex: 0 },
          { x: 40, y: 0, pinIndex: 1 },
        ]),
      },
    });

    await controller.runSimulation("DC");

    expect(orchestrator.ercIssues.length).toBeGreaterThan(0);
    expect(orchestrator.render).toHaveBeenCalled();
    expect(oscilloscopePanel.start).not.toHaveBeenCalled();
    expect(deps.setSimulationRunning).toHaveBeenCalledWith(false);
  });

  it("enlaza resultados transitorios del osciloscopio a la pestana activa", async () => {
    const netlist: CircuitNetlist = {
      components: [
        { id: "V1", type: "vsource", value: 5, pins: ["1", "0"] },
        { id: "R1", type: "resistor", value: 1000, pins: ["1", "0"] },
        { id: "GND1", type: "ground", value: 0, pins: ["0"] },
      ],
      wires: [],
    };
    const { controller, deps, oscilloscopePanel } = createHarness({
      netlist,
      orchestrator: {
        components: [
          { id: "V1", type: "vsource", value: "5", x: 0, y: 0, rotation: 0 },
          { id: "R1", type: "resistor", value: "1k", x: 80, y: 0, rotation: 0 },
          { id: "GND1", type: "ground", value: "0", x: 0, y: 80, rotation: 0 },
        ],
        wires: [
          { id: "w1", from: { componentId: "V1", pinIndex: 1 }, to: { componentId: "GND1", pinIndex: 0 }, points: [] },
          { id: "w2", from: { componentId: "V1", pinIndex: 0 }, to: { componentId: "R1", pinIndex: 0 }, points: [] },
          { id: "w3", from: { componentId: "R1", pinIndex: 1 }, to: { componentId: "GND1", pinIndex: 0 }, points: [] },
        ],
        getComponentPins: vi.fn((component: { id: string }) => (
          component.id === "GND1"
            ? [{ x: 0, y: 60, pinIndex: 0 }]
            : component.id === "V1"
              ? [{ x: -20, y: 0, pinIndex: 0 }, { x: 20, y: 0, pinIndex: 1 }]
              : [{ x: 60, y: 0, pinIndex: 0 }, { x: 100, y: 0, pinIndex: 1 }]
        )),
      },
    });

    await controller.runSimulation("PVT");

    expect(oscilloscopePanel.start).toHaveBeenCalled();
    expect(deps.bindTransientResultsToTab).toHaveBeenCalledWith(
      "tab-1",
      oscilloscopePanel.transientResults,
    );
    expect(deps.runPvtAnalysis).toHaveBeenCalledWith(netlist);
  });

  it("cancela la reproduccion visual al detener la simulacion", async () => {
    const stopInteractiveTransient = vi.fn(async () => undefined);
    const { controller, deps, oscilloscopePanel } = createHarness();
    deps.getSimulationRunner = () => ({ stopInteractiveTransient }) as never;

    await controller.stopSimulation();

    expect(stopInteractiveTransient).toHaveBeenCalledOnce();
    expect(oscilloscopePanel.stop).toHaveBeenCalledOnce();
    expect(deps.resetPerformanceCaches).toHaveBeenCalledOnce();
    expect(deps.setSimulationRunning).toHaveBeenCalledWith(false);
  });

  it("gestiona pausar y reanudar simulación correctamente", async () => {
    const pauseInteractiveTransient = vi.fn(async () => undefined);
    const resumeInteractiveTransient = vi.fn(async () => undefined);
    const setSimulationPaused = vi.fn();
    const { controller, deps, oscilloscopePanel } = createHarness();
    deps.getSimulationRunner = () => ({
      pauseInteractiveTransient,
      resumeInteractiveTransient,
    }) as never;
    (deps as Record<string, unknown>).setSimulationPaused = setSimulationPaused;

    await controller.pauseSimulation();

    expect(pauseInteractiveTransient).toHaveBeenCalledOnce();
    expect(oscilloscopePanel.pause).toHaveBeenCalledOnce();
    expect(setSimulationPaused).toHaveBeenCalledWith(true);

    await controller.resumeSimulation();

    expect(resumeInteractiveTransient).toHaveBeenCalledOnce();
    expect(oscilloscopePanel.resume).toHaveBeenCalledOnce();
    expect(setSimulationPaused).toHaveBeenCalledWith(false);
  });

  it("inicia simulación transitoria interactiva en modo continuo indefinido por defecto", async () => {
    const startInteractiveTransient = vi.fn(async () => undefined);
    const netlist: CircuitNetlist = {
      components: [
        { id: "V1", type: "vsource", value: 5, pins: ["1", "0"] },
        { id: "R1", type: "resistor", value: 1000, pins: ["1", "0"] },
        { id: "GND1", type: "ground", value: 0, pins: ["0"] },
      ],
      wires: [],
    };
    const { controller, deps } = createHarness({
      netlist,
      orchestrator: {
        components: [
          { id: "V1", type: "vsource", value: "5", x: 0, y: 0, rotation: 0 },
          { id: "R1", type: "resistor", value: "1k", x: 80, y: 0, rotation: 0 },
          { id: "GND1", type: "ground", value: "0", x: 0, y: 80, rotation: 0 },
        ],
        wires: [],
        getComponentPins: vi.fn(() => [{ x: 0, y: 0, pinIndex: 0 }]),
      },
    });
    deps.getSimulationRunner = () => ({ startInteractiveTransient }) as never;

    await controller.runSimulation("TRAN");

    expect(startInteractiveTransient).toHaveBeenCalledOnce();
    const [, settings] = startInteractiveTransient.mock.calls[0];
    // Modo continuo: tMax = 0
    expect(settings.tMax).toBe(0);
  });
});
