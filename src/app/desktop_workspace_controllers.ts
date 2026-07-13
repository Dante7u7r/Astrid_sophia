import type { CanvasOrchestrator } from "../canvas_orchestrator";
import type { CircuitStateManager } from "../simulation/circuit_state_manager";
import type { CircuitNetlist } from "../simulation/netlist_extractor";
import type { SimulationRunner } from "../simulation/simulation_runner";
import type { McuDebugPanel } from "../ui/mcu_debug_panel";
import type { OscilloscopePanel } from "../ui/oscilloscope_panel";
import type { AnalysisMode, SimulationControls } from "../ui/simulation_controls";
import { SettingsModal, type SimulationSettings } from "../ui/settings_modal";
import { TabManager } from "../ui/tab_manager";
import { PropertyEditor } from "../ui/property_editor";
import { ExporterPanel } from "../ui/exporter_panel";
import type { ProbePlacementController } from "./probe_placement_controller";
import {
  createCircuitDocumentController,
  type CircuitDocumentController,
} from "./circuit_document_controller";

type LogType = "system" | "send" | "receive" | "error";
type InvokeTauri = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export interface DesktopWorkspaceControllers {
  circuitDocumentController: CircuitDocumentController;
  tabManager: TabManager;
  propertyEditor: PropertyEditor;
  exporterPanel: ExporterPanel;
}

export interface DesktopWorkspaceControllerDeps {
  circuitState: CircuitStateManager;
  probePlacementController: ProbePlacementController;
  getOrchestrator(): CanvasOrchestrator | null;
  getOscilloscopePanel(): OscilloscopePanel | null;
  getMcuDebugPanel(): McuDebugPanel | null;
  getSimulationRunner(): SimulationRunner | null;
  getSimulationControls(): SimulationControls | null;
  getSimulationSettings(): SimulationSettings;
  setSimulationSettings(settings: SimulationSettings): void;
  getActiveAnalysisMode(): AnalysisMode;
  setActiveAnalysisMode(mode: AnalysisMode): void;
  getSparPorts(): { nodeId: string; z0: number }[];
  setSparPorts(ports: { nodeId: string; z0: number }[]): void;
  extractNetlist(reportErrors?: boolean): CircuitNetlist | null;
  resetPerformanceCaches(): void;
  updateCanvasRendering(immediate?: boolean): void;
  updateOscilloscopeRendering(immediate?: boolean): void;
  addLog(text: string, type?: LogType): void;
  logError(message: string): void;
  invokeTauri: InvokeTauri;
}

export function createDesktopWorkspaceControllers(
  deps: DesktopWorkspaceControllerDeps,
): DesktopWorkspaceControllers {
  let tabManager: TabManager | null = null;

  const circuitDocumentController = createCircuitDocumentController({
    getOrchestrator: deps.getOrchestrator,
    getOscilloscopePanel: deps.getOscilloscopePanel,
    getSimulationSettings: deps.getSimulationSettings,
    setSimulationSettings: deps.setSimulationSettings,
    getActiveAnalysisMode: deps.getActiveAnalysisMode,
    setActiveAnalysisMode: deps.setActiveAnalysisMode,
    setSimulationControlMode: (mode) => deps.getSimulationControls()?.setActiveModeButton(mode),
    getSparPorts: deps.getSparPorts,
    setSparPorts: deps.setSparPorts,
    setProbeNodes: (probes) => deps.probePlacementController.setNodes(probes),
    circuitState: deps.circuitState,
    resetPerformanceCaches: deps.resetPerformanceCaches,
    extractNetlist: deps.extractNetlist,
    updateCanvasRendering: deps.updateCanvasRendering,
    updateOscilloscopeRendering: deps.updateOscilloscopeRendering,
    addLog: deps.addLog,
    logError: deps.logError,
  });

  tabManager = new TabManager({
    getOrchestrator: deps.getOrchestrator,
    getOscilloscopePanel: deps.getOscilloscopePanel,
    getMcuDebugPanel: deps.getMcuDebugPanel,
    getSimulationControls: deps.getSimulationControls,
    extractNetlist: deps.extractNetlist,
    updateCanvasRendering: () => deps.updateCanvasRendering(),
    getActiveAnalysisMode: deps.getActiveAnalysisMode,
    setActiveAnalysisMode: deps.setActiveAnalysisMode,
    getProbes: () => deps.probePlacementController.getNodes(),
    setProbes: (probes) => deps.probePlacementController.setNodes(probes),
    getSparPorts: deps.getSparPorts,
    setSparPorts: deps.setSparPorts,
    getVoltageSnapshot: () => deps.circuitState.getVoltageMap(),
    setVoltageSnapshot: (voltages) => deps.circuitState.setVoltagesFromSnapshot(voltages),
    resetRuntimeState: () => {
      deps.circuitState.actuatorHistory.clear();
      deps.circuitState.audioOrchestrator.stopAll();
    },
    canChangeActiveTab: () => !(deps.getSimulationControls()?.isSimulationRunning() ?? false),
    documentController: circuitDocumentController,
    addLog: deps.addLog,
    invokeTauri: deps.invokeTauri,
  });

  const propertyEditor = new PropertyEditor({
    getOrchestrator: deps.getOrchestrator,
    getMcuDebugPanel: deps.getMcuDebugPanel,
    getSimulationRunner: deps.getSimulationRunner,
    addLog: deps.addLog,
    updateCanvasRendering: deps.updateCanvasRendering,
    markCurrentTabAsModified: () => tabManager?.markCurrentTabAsModified(),
    invokeTauri: deps.invokeTauri,
  });

  const exporterPanel = new ExporterPanel({
    getOscilloscopePanel: deps.getOscilloscopePanel,
    getActiveAnalysisMode: deps.getActiveAnalysisMode,
    getProbeNodes: () => {
      const probes = deps.probePlacementController.getNodes();
      return { ch1: probes.ch1, ch2: probes.ch2 };
    },
    getVoltageMap: () => deps.circuitState.getVoltageMap(),
    addLog: deps.addLog,
  });

  new SettingsModal(deps.getSimulationSettings(), (newSettings) => {
    deps.setSimulationSettings({ ...newSettings });
    const settings = deps.getSimulationSettings();
    deps.addLog(
      `Ajustes guardados: dt=${settings.dt}, tol=${settings.tolerance}, iterMax=${settings.maxIterations}`,
      "system",
    );
  });

  return {
    circuitDocumentController,
    tabManager,
    propertyEditor,
    exporterPanel,
  };
}
