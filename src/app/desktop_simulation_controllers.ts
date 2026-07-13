import type { CanvasOrchestrator } from "../canvas_orchestrator";
import type { CircuitStateManager } from "../simulation/circuit_state_manager";
import type { CircuitNetlist } from "../simulation/netlist_extractor";
import {
  createSimulationRunner,
  type SimulationRunner,
} from "../simulation/simulation_runner";
import {
  initSimulationControls,
  type AnalysisMode,
  type SimulationControls,
} from "../ui/simulation_controls";
import type { OscilloscopePanel, TimeStepResult } from "../ui/oscilloscope_panel";
import type { SimulationSettings } from "../ui/settings_modal";
import type { TabManager } from "../ui/tab_manager";
import type { ProbePlacementController } from "./probe_placement_controller";
import { createInteractiveSimulationCallbacks } from "./interactive_simulation_callbacks";
import {
  createPvtAnalysisController,
  type PvtAnalysisController,
} from "./pvt_analysis_controller";
import {
  createSParameterExportController,
  type SParameterExportController,
} from "./sparameter_export_controller";
import {
  createSimulationController,
  type SimulationController,
} from "./simulation_controller";
import { updateQaState } from "../testing/qa_state";

type LogType = "system" | "send" | "receive" | "error";
type InvokeTauri = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export interface DesktopSimulationControllers {
  simulationRunner: SimulationRunner;
  sparameterExportController: SParameterExportController;
  pvtAnalysisController: PvtAnalysisController;
  simulationController: SimulationController;
  simulationControls: SimulationControls;
}

export interface DesktopSimulationControllerDeps {
  circuitState: CircuitStateManager;
  probePlacementController: ProbePlacementController;
  getTabManager(): TabManager | null;
  getOrchestrator(): CanvasOrchestrator | null;
  getOscilloscopePanel(): OscilloscopePanel | null;
  getSimulationSettings(): SimulationSettings;
  setActiveAnalysisMode(mode: AnalysisMode): void;
  getSparPorts(): { nodeId: string; z0: number }[];
  getSparSweepSettings(): { fStart: number; fEnd: number; pointsPerDecade: number };
  extractNetlist(reportErrors?: boolean): CircuitNetlist | null;
  solveTransientCircuitLocal(
    netlist: CircuitNetlist,
    dt: number,
    tMax: number,
  ): Promise<TimeStepResult[] | string>;
  resetPerformanceCaches(): void;
  updateCanvasRendering(immediate?: boolean): void;
  updateOscilloscopeRendering(immediate?: boolean): void;
  setInstrumentDockCollapsed(collapsed: boolean): void;
  setIpcStatus(text: string, color: string): void;
  addLog(text: string, type?: LogType): void;
  invokeTauri: InvokeTauri;
}

export function createDesktopSimulationControllers(
  deps: DesktopSimulationControllerDeps,
): DesktopSimulationControllers {
  let simulationControls: SimulationControls | null = null;
  let simulationRunner: SimulationRunner | null = null;
  let pvtAnalysisController: PvtAnalysisController | null = null;
  let sparameterExportController: SParameterExportController | null = null;

  const setSimulationRunning = (running: boolean): void => {
    simulationControls?.setSimulationRunning(running);
    updateQaState({ simulationRunning: running });
  };

  const setActiveAnalysisMode = (mode: AnalysisMode): void => {
    deps.setActiveAnalysisMode(mode);
    updateQaState({ lastSimulationMode: mode });
  };

  simulationRunner = createSimulationRunner(createInteractiveSimulationCallbacks({
    getTabManager: deps.getTabManager,
    getOrchestrator: deps.getOrchestrator,
    getOscilloscopePanel: deps.getOscilloscopePanel,
    getSimulationRunner: () => simulationRunner,
    circuitState: deps.circuitState,
    setSimulationRunning,
    updateCanvasRendering: deps.updateCanvasRendering,
    updateOscilloscopeRendering: deps.updateOscilloscopeRendering,
    addLog: deps.addLog,
  }));

  sparameterExportController = createSParameterExportController({
    getOscilloscopePanel: deps.getOscilloscopePanel,
    getPorts: deps.getSparPorts,
    clearProbePlacementMode: () => { deps.probePlacementController.clearMode(); },
    resetPerformanceCaches: deps.resetPerformanceCaches,
    setIpcStatus: deps.setIpcStatus,
    addLog: deps.addLog,
    invokeTauri: deps.invokeTauri,
  }, deps.getSparSweepSettings());

  pvtAnalysisController = createPvtAnalysisController({
    getOscilloscopePanel: deps.getOscilloscopePanel,
    getSimulationSettings: deps.getSimulationSettings,
    getSimulationBar: () => document.querySelector("#simulation-bar"),
    setSimulationRunning,
    resetPerformanceCaches: deps.resetPerformanceCaches,
    setIpcStatus: deps.setIpcStatus,
    addLog: deps.addLog,
    invokeTauri: deps.invokeTauri,
  });

  const simulationController = createSimulationController({
    getOrchestrator: deps.getOrchestrator,
    getOscilloscopePanel: deps.getOscilloscopePanel,
    getSimulationRunner: () => simulationRunner,
    getSimulationSettings: deps.getSimulationSettings,
    setSimulationRunning,
    setActiveAnalysisMode,
    getActiveTabId: () => deps.getTabManager()?.getActiveTabId() ?? null,
    bindTransientResultsToTab: (tabId, transientResults) => {
      deps.getTabManager()?.bindTransientResultsToTab(tabId, transientResults);
    },
    extractNetlist: deps.extractNetlist,
    solveTransientCircuitLocal: deps.solveTransientCircuitLocal,
    runPvtAnalysis: (netlist) => pvtAnalysisController?.run(netlist) ?? Promise.resolve(),
    runSparamExport: (netlist) => sparameterExportController?.run(netlist) ?? Promise.resolve(),
    circuitState: deps.circuitState,
    resetPerformanceCaches: deps.resetPerformanceCaches,
    updateCanvasRendering: deps.updateCanvasRendering,
    updateOscilloscopeRendering: deps.updateOscilloscopeRendering,
    setInstrumentDockCollapsed: deps.setInstrumentDockCollapsed,
    setIpcStatus: deps.setIpcStatus,
    addLog: deps.addLog,
  });

  simulationControls = initSimulationControls(simulationController.createControlHandlers());

  return {
    simulationRunner,
    sparameterExportController,
    pvtAnalysisController,
    simulationController,
    simulationControls,
  };
}
