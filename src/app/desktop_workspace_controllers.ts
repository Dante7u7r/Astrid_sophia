import type { CanvasOrchestrator } from "../canvas_orchestrator";
import type { CircuitStateManager } from "../simulation/circuit_state_manager";
import type { CircuitNetlist } from "../simulation/netlist_extractor";
import type { SimulationRunner } from "../simulation/simulation_runner";
import type { McuDebugPanel } from "../ui/mcu_debug_panel";
import type { OscilloscopePanel } from "../ui/oscilloscope_panel";
import type { AnalysisMode, SimulationControls } from "../ui/simulation_controls";
import { SettingsModal, type SimulationSettings } from "../ui/settings_modal";
import { MnaInspectorModal } from "../ui/mna_inspector_modal";
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
  markCurrentTabAsModified(): void;
  onActiveTabChanged(tabId: string): void;
  onCircuitLoaded(): void;
  addLog(text: string, type?: LogType): void;
  logError(message: string): void;
  getInstrumentsDock?(): import("../ui/instruments_dock").InstrumentsDock | null;
  invokeTauri: InvokeTauri;
}

export function createDesktopWorkspaceControllers(
  deps: DesktopWorkspaceControllerDeps,
): DesktopWorkspaceControllers {
  let tabManager: TabManager | null = null;
  let propertyEditor: PropertyEditor | null = null;

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
    clearPropertiesPanel: () => propertyEditor?.clearPropertiesPanel?.(),
    onCircuitLoaded: deps.onCircuitLoaded,
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
    onActiveTabChanged: deps.onActiveTabChanged,
    canChangeActiveTab: () => !(deps.getSimulationControls()?.isSimulationRunning() ?? false),
    documentController: circuitDocumentController,
    addLog: deps.addLog,
    invokeTauri: deps.invokeTauri,
  });

  propertyEditor = new PropertyEditor({
    getOrchestrator: deps.getOrchestrator,
    getMcuDebugPanel: deps.getMcuDebugPanel,
    getSimulationRunner: deps.getSimulationRunner,
    getVoltageMap: () => deps.circuitState.getVoltageMap(),
    getCurrentMap: () => deps.circuitState.getCurrentMap(),
    getPinNode: (pinKey: string) => deps.circuitState.getPinNode(pinKey),
    setProbeNode: (channel, nodeId) => {
      const current = deps.probePlacementController.getNodes();
      deps.probePlacementController.setNodes({
        ...current,
        [channel]: nodeId,
      });
      deps.updateCanvasRendering();
      deps.updateOscilloscopeRendering();
    },
    getProbeNodes: () => {
      const probes = deps.probePlacementController.getNodes();
      return { ch1: probes.ch1, ch2: probes.ch2 };
    },
    highlightNet: (nodeId) => {
      const orch = deps.getOrchestrator();
      if (!orch) return;
      if (!nodeId) {
        orch.hoveredPin = null;
        deps.updateCanvasRendering();
        return;
      }
      for (const comp of orch.components) {
        const pins = typeof orch.getComponentPins === "function" ? orch.getComponentPins(comp) : [];
        for (let idx = 0; idx < pins.length; idx++) {
          const pinKey = `${comp.id}:${idx}`;
          if (deps.circuitState.getPinNode(pinKey) === nodeId) {
            orch.hoveredPin = {
              componentId: comp.id,
              pinIndex: idx,
              x: 0,
              y: 0,
            };
            deps.updateCanvasRendering();
            return;
          }
        }
      }
      orch.hoveredPin = null;
      deps.updateCanvasRendering();
    },
    addLog: deps.addLog,
    updateCanvasRendering: deps.updateCanvasRendering,
    markCurrentTabAsModified: deps.markCurrentTabAsModified,
    extractNetlist: deps.extractNetlist,
    onComponentPropertiesApplied: (comp) => {
      if (comp.type === "vsource" || comp.type === "isource") {
        const dock = deps.getInstrumentsDock?.();
        dock?.generator?.syncFromExternalSource(comp);
      }
    },
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
    getComponents: () => deps.getOrchestrator()?.components ?? [],
    getWires: () => deps.getOrchestrator()?.wires ?? [],
    getCircuitTitle: () => tabManager.getActiveTab()?.name ?? "Circuito Biaani",
  });

  new SettingsModal(deps.getSimulationSettings(), (newSettings) => {
    deps.setSimulationSettings({ ...newSettings });
    const settings = deps.getSimulationSettings();
    const orch = deps.getOrchestrator();
    if (orch) {
      if (settings.currentFlowMode) orch.currentFlowMode = settings.currentFlowMode;
      if (settings.currentAnimationSpeed) orch.currentAnimationSpeed = settings.currentAnimationSpeed;
      if (settings.showCurrentAnimation !== undefined) orch.showCurrentAnimation = settings.showCurrentAnimation;
      if (settings.showThermalHeatmap !== undefined) orch.showThermalHeatmap = settings.showThermalHeatmap;
      if (settings.showReactiveFields !== undefined) orch.showReactiveFields = settings.showReactiveFields;
      if (settings.showTelemetryHud !== undefined) orch.showTelemetryHud = settings.showTelemetryHud;
    }
    if (settings.defaultAnalysisMode) {
      if (typeof localStorage !== "undefined") {
        try {
          localStorage.setItem("astryd-default-analysis-mode", settings.defaultAnalysisMode);
        } catch {
          // ignore
        }
      }
      deps.setActiveAnalysisMode(settings.defaultAnalysisMode);
      deps.getSimulationControls()?.setActiveModeButton(settings.defaultAnalysisMode);
      const activeTab = tabManager.getActiveTab();
      if (activeTab) {
        activeTab.activeAnalysisMode = settings.defaultAnalysisMode;
      }
    }
    deps.updateCanvasRendering();
    const extra = (settings.currentFlowMode || settings.currentAnimationSpeed)
      ? `, flujo=${settings.currentFlowMode ?? "convencional"}, vel=${settings.currentAnimationSpeed ?? 1.0}x`
      : "";
    const tTranLabel = (settings.transientDuration === 0 || !settings.transientDuration)
      ? "Infinito (continuo)"
      : `${settings.transientDuration} s`;
    deps.addLog(
      `Ajustes guardados: dt=${settings.dt}, tTRAN=${tTranLabel}, tol=${settings.tolerance}, iterMax=${settings.maxIterations}${extra}`,
      "system",
    );
  });

  new MnaInspectorModal({
    getNetlist: () => deps.extractNetlist(false) ?? { components: [], wires: [] },
  });

  return {
    circuitDocumentController,
    tabManager,
    propertyEditor,
    exporterPanel,
  };
}
