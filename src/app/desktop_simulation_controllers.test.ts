// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopSimulationControllers } from "./desktop_simulation_controllers";

const mocks = vi.hoisted(() => ({
  simulationRunner: {},
  interactiveCallbacks: null as Record<string, unknown> | null,
  sparameterController: { run: vi.fn(() => Promise.resolve()) },
  sparameterDeps: null as Record<string, unknown> | null,
  pvtController: { run: vi.fn(() => Promise.resolve()) },
  pvtDeps: null as Record<string, unknown> | null,
  simulationController: {
    createControlHandlers: vi.fn(() => ({ onRunSimulation: vi.fn() })),
  },
  simulationControllerDeps: null as Record<string, unknown> | null,
  simulationControls: { setSimulationRunning: vi.fn() },
  updateQaState: vi.fn(),
}));

vi.mock("../simulation/simulation_runner", () => ({
  createSimulationRunner: vi.fn(() => mocks.simulationRunner),
}));

vi.mock("./interactive_simulation_callbacks", () => ({
  createInteractiveSimulationCallbacks: vi.fn((callbacks: Record<string, unknown>) => {
    mocks.interactiveCallbacks = callbacks;
    return callbacks;
  }),
}));

vi.mock("./sparameter_export_controller", () => ({
  createSParameterExportController: vi.fn((deps: Record<string, unknown>) => {
    mocks.sparameterDeps = deps;
    return mocks.sparameterController;
  }),
}));

vi.mock("./pvt_analysis_controller", () => ({
  createPvtAnalysisController: vi.fn((deps: Record<string, unknown>) => {
    mocks.pvtDeps = deps;
    return mocks.pvtController;
  }),
}));

vi.mock("./simulation_controller", () => ({
  createSimulationController: vi.fn((deps: Record<string, unknown>) => {
    mocks.simulationControllerDeps = deps;
    return mocks.simulationController;
  }),
}));

vi.mock("../ui/simulation_controls", () => ({
  initSimulationControls: vi.fn(() => mocks.simulationControls),
}));

vi.mock("../testing/qa_state", () => ({
  updateQaState: mocks.updateQaState,
}));

afterEach(() => {
  vi.clearAllMocks();
  mocks.interactiveCallbacks = null;
  mocks.sparameterDeps = null;
  mocks.pvtDeps = null;
  mocks.simulationControllerDeps = null;
});

describe("createDesktopSimulationControllers", () => {
  it("cablea runner, analisis avanzados, controller y controles", async () => {
    const setActiveAnalysisMode = vi.fn();
    const bindTransientResultsToTab = vi.fn();
    const tabManager = {
      getActiveTabId: vi.fn(() => "tab-1"),
      bindTransientResultsToTab,
    };
    const deps = {
      circuitState: {},
      probePlacementController: { clearMode: vi.fn() },
      getTabManager: () => tabManager,
      getOrchestrator: () => null,
      getOscilloscopePanel: () => null,
      getSimulationSettings: () => ({ dt: 1, tolerance: 2, maxIterations: 3 }),
      setActiveAnalysisMode,
      getSparPorts: vi.fn(() => []),
      getSparSweepSettings: vi.fn(() => ({ fStart: 1, fEnd: 10, pointsPerDecade: 2 })),
      extractNetlist: vi.fn(() => null),
      solveTransientCircuitLocal: vi.fn(),
      resetPerformanceCaches: vi.fn(),
      updateCanvasRendering: vi.fn(),
      updateOscilloscopeRendering: vi.fn(),
      setInstrumentDockCollapsed: vi.fn(),
      setIpcStatus: vi.fn(),
      addLog: vi.fn(),
      invokeTauri: vi.fn(),
    };

    const controllers = createDesktopSimulationControllers(deps as never);

    expect(controllers.simulationRunner).toBe(mocks.simulationRunner);
    expect(controllers.sparameterExportController).toBe(mocks.sparameterController);
    expect(controllers.pvtAnalysisController).toBe(mocks.pvtController);
    expect(controllers.simulationController).toBe(mocks.simulationController);
    expect(controllers.simulationControls).toBe(mocks.simulationControls);

    (mocks.interactiveCallbacks!.setSimulationRunning as (running: boolean) => void)(true);
    expect(mocks.simulationControls.setSimulationRunning).toHaveBeenCalledWith(true);
    expect(mocks.updateQaState).toHaveBeenCalledWith({ simulationRunning: true });

    (mocks.simulationControllerDeps!.setActiveAnalysisMode as (mode: string) => void)("AC");
    expect(setActiveAnalysisMode).toHaveBeenCalledWith("AC");
    expect(mocks.updateQaState).toHaveBeenCalledWith({ lastSimulationMode: "AC" });

    expect((mocks.simulationControllerDeps!.getActiveTabId as () => string | null)()).toBe("tab-1");
    (mocks.simulationControllerDeps!.bindTransientResultsToTab as (tabId: string, results: unknown[]) => void)("tab-1", []);
    expect(bindTransientResultsToTab).toHaveBeenCalledWith("tab-1", []);

    await (mocks.simulationControllerDeps!.runPvtAnalysis as (netlist: unknown) => Promise<void>)({});
    await (mocks.simulationControllerDeps!.runSparamExport as (netlist: unknown) => Promise<void>)({});
    expect(mocks.pvtController.run).toHaveBeenCalledOnce();
    expect(mocks.sparameterController.run).toHaveBeenCalledOnce();

    (mocks.sparameterDeps!.clearProbePlacementMode as () => void)();
    expect(deps.probePlacementController.clearMode).toHaveBeenCalledOnce();
  });
});
