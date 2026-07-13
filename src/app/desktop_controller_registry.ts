import type { CanvasOrchestrator } from "../canvas_orchestrator";
import type { McuDebugPanel } from "../ui/mcu_debug_panel";
import type { OscilloscopePanel, TimeStepResult } from "../ui/oscilloscope_panel";
import { TelemetryPanel } from "../ui/telemetry_panel";
import { type SimulationSettings } from "../ui/settings_modal";
import type { TabManager } from "../ui/tab_manager";
import type { PropertyEditor } from "../ui/property_editor";
import type { ExporterPanel } from "../ui/exporter_panel";
import { type AnalysisMode, type SimulationControls } from "../ui/simulation_controls";
import type { PanelLayoutManager } from "../ui/panel_layout_manager";
import type { InstrumentsDock } from "../ui/instruments_dock";
import type { SidePanelController } from "../ui/side_panel_controller";
import type { ProbePlacementController } from "./probe_placement_controller";
import type { CircuitNetlist } from "../simulation/netlist_extractor";
import type { CircuitStateManager } from "../simulation/circuit_state_manager";
import type { VisualAuditConfig } from "../testing/visual_audit_config";
import type { PerformanceMonitor } from "../performance/performance_monitor";
import type { RenderController } from "./render_controller";
import type { CircuitDocumentController } from "./circuit_document_controller";
import type { SimulationController } from "./simulation_controller";
import type { SimulationRunner } from "../simulation/simulation_runner";
import type { SParameterExportController } from "./sparameter_export_controller";
import type { PvtAnalysisController } from "./pvt_analysis_controller";
import { updateQaState } from "../testing/qa_state";
import { createDesktopWorkspaceControllers } from "./desktop_workspace_controllers";
import { createDesktopSimulationControllers } from "./desktop_simulation_controllers";
import { createDesktopUiControllers } from "./desktop_ui_controllers";

type LogType = "system" | "send" | "receive" | "error";
type InvokeTauri = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export interface DesktopControllerRegistry {
  telemetryPanel: TelemetryPanel;
  renderController: RenderController;
  circuitDocumentController: CircuitDocumentController;
  tabManager: TabManager;
  propertyEditor: PropertyEditor;
  exporterPanel: ExporterPanel;
  simulationRunner: SimulationRunner;
  oscilloscopePanel: OscilloscopePanel;
  mcuDebugPanel: McuDebugPanel | null;
  sparameterExportController: SParameterExportController;
  pvtAnalysisController: PvtAnalysisController;
  simulationController: SimulationController;
  simulationControls: SimulationControls;
}

export interface DesktopControllerRegistryDeps {
  visualAudit: VisualAuditConfig;
  performanceMonitor: PerformanceMonitor;
  circuitState: CircuitStateManager;
  probePlacementController: ProbePlacementController;
  getOrchestrator(): CanvasOrchestrator | null;
  getPanelLayoutManager(): PanelLayoutManager | null;
  getInstrumentsDock(): InstrumentsDock | null;
  getSidePanelController(): SidePanelController | null;
  getSimulationSettings(): SimulationSettings;
  setSimulationSettings(settings: SimulationSettings): void;
  getActiveAnalysisMode(): AnalysisMode;
  setActiveAnalysisMode(mode: AnalysisMode): void;
  getSparPorts(): { nodeId: string; z0: number }[];
  setSparPorts(ports: { nodeId: string; z0: number }[]): void;
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
  logError(message: string): void;
  invokeTauri: InvokeTauri;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  now(): number;
}

export function createDesktopControllerRegistry(
  deps: DesktopControllerRegistryDeps,
): DesktopControllerRegistry {
  let tabManager: TabManager | null = null;
  let simulationControls: SimulationControls | null = null;
  let simulationRunner: SimulationRunner | null = null;
  let oscilloscopePanel: OscilloscopePanel | null = null;
  let mcuDebugPanel: McuDebugPanel | null = null;

  const setActiveAnalysisMode = (mode: AnalysisMode): void => {
    deps.setActiveAnalysisMode(mode);
    updateQaState({ lastSimulationMode: mode });
  };

  const uiControllers = createDesktopUiControllers({
    visualAudit: deps.visualAudit,
    performanceMonitor: deps.performanceMonitor,
    circuitState: deps.circuitState,
    probePlacementController: deps.probePlacementController,
    getOrchestrator: deps.getOrchestrator,
    getPanelLayoutManager: deps.getPanelLayoutManager,
    getInstrumentsDock: deps.getInstrumentsDock,
    getSidePanelController: deps.getSidePanelController,
    getSparPorts: deps.getSparPorts,
    extractNetlist: deps.extractNetlist,
    updateCanvasRendering: deps.updateCanvasRendering,
    updateOscilloscopeRendering: deps.updateOscilloscopeRendering,
    addLog: deps.addLog,
    requestAnimationFrame: deps.requestAnimationFrame,
    now: deps.now,
  });
  const renderController = uiControllers.renderController;
  oscilloscopePanel = uiControllers.oscilloscopePanel;
  mcuDebugPanel = uiControllers.mcuDebugPanel;

  const workspaceControllers = createDesktopWorkspaceControllers({
    circuitState: deps.circuitState,
    probePlacementController: deps.probePlacementController,
    getOrchestrator: deps.getOrchestrator,
    getOscilloscopePanel: () => oscilloscopePanel,
    getMcuDebugPanel: () => mcuDebugPanel,
    getSimulationRunner: () => simulationRunner,
    getSimulationControls: () => simulationControls,
    getSimulationSettings: deps.getSimulationSettings,
    setSimulationSettings: deps.setSimulationSettings,
    getActiveAnalysisMode: deps.getActiveAnalysisMode,
    setActiveAnalysisMode,
    getSparPorts: deps.getSparPorts,
    setSparPorts: deps.setSparPorts,
    extractNetlist: deps.extractNetlist,
    resetPerformanceCaches: deps.resetPerformanceCaches,
    updateCanvasRendering: deps.updateCanvasRendering,
    updateOscilloscopeRendering: deps.updateOscilloscopeRendering,
    addLog: deps.addLog,
    logError: deps.logError,
    invokeTauri: deps.invokeTauri,
  });
  const circuitDocumentController = workspaceControllers.circuitDocumentController;
  tabManager = workspaceControllers.tabManager;
  const propertyEditor = workspaceControllers.propertyEditor;
  const exporterPanel = workspaceControllers.exporterPanel;

  propertyEditor.init();
  exporterPanel.init();

  const simulationControllers = createDesktopSimulationControllers({
    circuitState: deps.circuitState,
    probePlacementController: deps.probePlacementController,
    getTabManager: () => tabManager,
    getOrchestrator: deps.getOrchestrator,
    getOscilloscopePanel: () => oscilloscopePanel,
    getSimulationSettings: deps.getSimulationSettings,
    setActiveAnalysisMode: deps.setActiveAnalysisMode,
    getSparPorts: deps.getSparPorts,
    getSparSweepSettings: deps.getSparSweepSettings,
    extractNetlist: deps.extractNetlist,
    solveTransientCircuitLocal: deps.solveTransientCircuitLocal,
    resetPerformanceCaches: deps.resetPerformanceCaches,
    updateCanvasRendering: deps.updateCanvasRendering,
    updateOscilloscopeRendering: deps.updateOscilloscopeRendering,
    setInstrumentDockCollapsed: deps.setInstrumentDockCollapsed,
    setIpcStatus: deps.setIpcStatus,
    addLog: deps.addLog,
    invokeTauri: deps.invokeTauri,
  });
  simulationRunner = simulationControllers.simulationRunner;
  simulationControls = simulationControllers.simulationControls;
  return {
    telemetryPanel: uiControllers.telemetryPanel,
    renderController,
    circuitDocumentController,
    tabManager,
    propertyEditor,
    exporterPanel,
    simulationRunner,
    oscilloscopePanel,
    mcuDebugPanel,
    sparameterExportController: simulationControllers.sparameterExportController,
    pvtAnalysisController: simulationControllers.pvtAnalysisController,
    simulationController: simulationControllers.simulationController,
    simulationControls,
  };
}
