import { safeInvoke as invoke } from "./simulation/tauri_mock";
import "./components";
import { CanvasOrchestrator, ComponentInstance } from "./canvas_orchestrator";
import { TelemetryPanel } from "./ui/telemetry_panel";
import { DEFAULT_TRANSIENT_DURATION_SECONDS, SimulationSettings } from "./ui/settings_modal";
import { type AnalysisMode, type SimulationControls } from "./ui/simulation_controls";
import { OscilloscopePanel, TimeStepResult } from "./ui/oscilloscope_panel";
import {
  extractElectricalNetlist,
  invalidateTopologicalCache,
  type CircuitNetlist,
} from "./simulation/netlist_extractor";
import { McuDebugPanel } from "./ui/mcu_debug_panel";
import { type SimulationRunner } from "./simulation/simulation_runner";
import { createCircuitStateManager } from "./simulation/circuit_state_manager";
import { attachCanvasInput, attachCanvasDrop } from "./canvas/canvas_input_controller";
import { isTypingInFormField, installWebviewKeyGuards, installWebviewAutofillGuards } from "./canvas/keyboard_guards";
import { TooltipManager } from "./ui/tooltip_manager";
import { TabManager } from "./ui/tab_manager";
import { PropertyEditor } from "./ui/property_editor";
import { buildLiveMutations } from "./ui/property_model";
import { CircuitSnapshotHistory } from "./app/circuit_snapshot_history";
import { PanelLayoutManager } from "./ui/panel_layout_manager";
import { InstrumentsDock } from "./ui/instruments_dock";
import { FloatingInstrumentManager } from "./ui/floating_instrument_manager";
import type { InteractiveMutationField } from "./simulation/simulation_runner";
import { createInstrumentCenterController } from "./ui/instrument_center_controller";
import { createAutoHideController, type AutoHideController } from "./ui/auto_hide_controller";
import { getActiveSymbolStandard, initComponentPaletteController } from "./ui/component_palette_controller";
import { createSidePanelController, type SidePanelController } from "./ui/side_panel_controller";
import { createConsoleLogController } from "./ui/console_log_controller";
import { initAppKeyboardShortcuts } from "./ui/app_keyboard_shortcuts_controller";
import { resolveVisualAuditConfig } from "./testing/visual_audit_config";
import {
  installQaState,
  recordQaLog,
} from "./testing/qa_state";
import { installDesktopE2eBridge } from "./testing/desktop_e2e_bridge";
import { PerformanceMonitor } from "./performance/performance_monitor";
import { installPerformanceHarness } from "./performance/performance_harness";
import {
  initFilePersistenceController,
} from "./app/file_persistence_controller";
import {
  type CircuitDocumentController,
} from "./app/circuit_document_controller";
import { solveTransientCircuitWithWorker } from "./app/local_transient_solver";
import {
  type RenderController,
} from "./app/render_controller";
import {
  createProbePlacementController,
  type ProbeChannel,
} from "./app/probe_placement_controller";
import { createCanvasViewportController } from "./app/canvas_viewport_controller";
import { initCanvasToolbarController } from "./app/canvas_toolbar_controller";
import { createIpcStatusController } from "./app/ipc_status_controller";
import { runStartupSequence } from "./app/startup_sequence";
import { createDesktopControllerRegistry } from "./app/desktop_controller_registry";
import { type SimulationController } from "./app/simulation_controller";
import { initializeFeedbackRuntime } from "./feedback/runtime";
import { configureAdvisorRuntime } from "./intelligence/advisor_runtime";
import {
  createLiveStateExporter,
  type LiveStateExporter,
} from "./app/live_state_exporter";
import { GuideEngine } from "./guide";
import { CrashReporter } from "./app/crash_reporter";
import { FeedbackModal } from "./ui/feedback_modal";
import type { DiagnosticCollectorDeps } from "./feedback/diagnostic_collector";
// Variables Globales del Estado — centralizadas en CircuitStateManager
const circuitState = createCircuitStateManager();
const visualAudit = resolveVisualAuditConfig(window.location.search, {
  isDevelopment: import.meta.env.DEV,
  mode: import.meta.env.MODE,
});
const performanceAuditEnabled = (import.meta.env.DEV || import.meta.env.MODE === "audit")
  && new URLSearchParams(window.location.search).get("perf") === "1";
const performanceMonitor = new PerformanceMonitor();
installQaState();
if (import.meta.env.MODE === "wdio") {
  void import("@wdio/tauri-plugin");
}
if (visualAudit.enabled) {
  document.documentElement.dataset.auditStage = visualAudit.stage;
  document.documentElement.dataset.auditStep = visualAudit.step;
}

const savedDefaultMode = (typeof localStorage !== "undefined"
  ? localStorage.getItem("astryd-default-analysis-mode")
  : null) as AnalysisMode | null;

const validModes: AnalysisMode[] = ["DC", "AC", "TRAN", "SENS", "PSS", "STB", "PVT", "SPAR"];
const initialMode: AnalysisMode = (savedDefaultMode && validModes.includes(savedDefaultMode))
  ? savedDefaultMode
  : "TRAN";

let simSettings: SimulationSettings = {
  dt: 0.0001,
  tolerance: 0.00001,
  maxIterations: 100,
  transientDuration: DEFAULT_TRANSIENT_DURATION_SECONDS,
  defaultAnalysisMode: initialMode,
};
configureAdvisorRuntime({
  getSettings: () => ({ ...simSettings }),
  setSettings: (settings) => {
    simSettings = { ...settings };
    window.dispatchEvent(new CustomEvent("astryd-settings-synchronized", {
      detail: { ...settings },
    }));
  },
});

let activeAnalysisMode: AnalysisMode = initialMode;
let mcuDebugPanel: McuDebugPanel | null = null;

let panelLayoutManager: PanelLayoutManager | null = null;
let instrumentsDock: InstrumentsDock | null = null;
let floatingInstrumentManager: FloatingInstrumentManager | null = null;
let sidePanelController: SidePanelController | null = null;



const ipcStatusController = createIpcStatusController();
const consoleLogController = createConsoleLogController({
  recordQaLog,
  now: () => new Date(),
});

// Instancia global del Canvas Orchestrator
let orchestrator: CanvasOrchestrator | null = null;

// Interfaz para la gestión de Pestañas (Workspace Tabs)
let tabManager: TabManager | null = null;
let propertyEditor: PropertyEditor | null = null;

// Instancias de submódulos UI modularizados
let oscilloscopePanel: OscilloscopePanel | null = null;
let circuitDocumentController: CircuitDocumentController | null = null;
let renderController: RenderController | null = null;
let autoHideController: AutoHideController | null = null;
const probePlacementController = createProbePlacementController({
  getOscilloscopePanel: () => oscilloscopePanel,
});

const circuitHistory = new CircuitSnapshotHistory({
  getActiveTabId: () => tabManager?.getActiveTabId() ?? null,
  serializeCircuit: () => circuitDocumentController?.serializeCircuit() ?? null,
  applyCircuit: (snapshot) => circuitDocumentController?.deserializeCircuit(snapshot) ?? false,
  onHistoryApplied: (direction) => {
    tabManager?.markCurrentTabAsModified();
    if (orchestrator) orchestrator.ercIssues = [];
    addLog(direction === "undo" ? "Cambio deshecho." : "Cambio rehecho.", "system");
  },
});

// Mapa global de voltajes resueltos para visualización
// (centralizado en circuitState.getVoltageMap())

// Mapa de correspondencia entre cada terminal física y su nodo eléctrico resuelto
// (centralizado en circuitState.getPinToNodeMap())

// --- ESTADOS DE SONDAS E INSTRUMENTACIÓN DEL OSCILOSCOPIO ---

// --- ESTADO DE SELECCIÓN DE PUERTOS RF PARA PARÁMETROS S ---
let sparPorts: { nodeId: string; z0: number }[] = [];
let sparFStart = 10.0;
let sparFEnd = 100000.0;
let sparPPD = 20;

let liveStateExporter: LiveStateExporter | null = null;
let guideEngine: GuideEngine | null = null;

function updateCanvasRendering(immediate = false): void {
  renderController?.updateCanvasRendering(immediate);
}

function updateOscilloscopeRendering(immediate = false): void {
  renderController?.updateOscilloscopeRendering(immediate);
}

function resetPerformanceCaches(): void {
  invalidateTopologicalCache();
  renderController?.resetPerformanceCaches();
}
// Instancia global del runner de simulación interactiva
let simulationRunner: SimulationRunner | null = null;
let simulationController: SimulationController | null = null;
let simulationControls: SimulationControls | null = null;

function addLog(text: string, type: 'system' | 'send' | 'receive' | 'error' = 'system') {
  consoleLogController.addLog(text, type);
}

function initSidebars() {
  sidePanelController = createSidePanelController({
    getPanelLayoutManager: () => panelLayoutManager,
    isTypingInFormField,
    matchMedia: (query) => window.matchMedia(query),
    requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  });
  sidePanelController.init();
}
function initInstrumentCenter(): void {
  createInstrumentCenterController({
    getPanelLayoutManager: () => panelLayoutManager,
    isTypingInFormField,
    onResizeRequested: () => window.dispatchEvent(new Event("resize")),
  }).init();
}

function initAutoHide(): void {
  autoHideController = createAutoHideController({
    getPanelLayoutManager: () => panelLayoutManager,
    isTypingInFormField,
    isGuideActive: () => Boolean(guideEngine?.getState().isActive),
  });
  autoHideController.init();
}
// --- ACTUALIZACIÓN DE PROPIEDADES EN EL PANEL DERECHO DELEGADO ---

function updatePropertiesPanel(comp: ComponentInstance) {
  propertyEditor?.updatePropertiesPanel(comp);
}



// --- ALGORITMO DE EXTRACCIÓN DE NODOS ELÉCTRICOS (DSU / DISJOINT SETS) ---
// Adaptador puro: convierte el estado global del orchestrator en la
// netlist eléctrica y actualiza el mapa de terminales a nodos.

function extractNetlist(reportErrors = false): CircuitNetlist | null {
  if (!orchestrator) return null;
  const result = extractElectricalNetlist(
    orchestrator.components,
    orchestrator.wires,
    (c) => orchestrator!.getComponentPins(c),
  );

  if (result.error) {
    if (reportErrors) {
      TelemetryPanel.logError(result.error);
      addLog(`[Pre-flight ERC] ${result.error}`, "error");
    }
    if (orchestrator.simulationActive || simulationRunner?.isSimulationActive()) {
      void simulationController?.stopSimulation();
      addLog("[Simulación] Circuito modificado o abierto. Simulación detenida.", "system");
    }
    return null;
  }

  circuitState.setPinToNodeMap(result.pinToNodeMap);
  return result.netlist;
}

// --- WRAPPER LOCAL PARA EL SOLVER TRANSITORIO DE RESPALDO ---
// Extrae los firmwares del orchestrator global y los pasa como
// parámetro explícito a la función pura de fallback_solver.

function solveTransientCircuitLocal(netlist: CircuitNetlist, dt: number, tMax: number): Promise<TimeStepResult[] | string> {
  return solveTransientCircuitWithWorker(netlist, dt, tMax, orchestrator?.components ?? []);
}

// --- INTERACTIVIDAD INTERNA DEL OSCILOSCOPIO ---

function initOscilloscopeInterface() {
  const oscCh1Btn = document.querySelector("#osc-ch1-btn") as HTMLButtonElement | null;
  const oscCh2Btn = document.querySelector("#osc-ch2-btn") as HTMLButtonElement | null;
  const oscCh3Btn = document.querySelector("#osc-ch3-btn") as HTMLButtonElement | null;
  const oscCh4Btn = document.querySelector("#osc-ch4-btn") as HTMLButtonElement | null;
  const oscPauseBtn = document.querySelector("#osc-pause-btn") as HTMLButtonElement | null;

  const handleProbeActivation = (mode: ProbeChannel) => {
    const netlist = extractNetlist();
    if (!netlist || netlist.components.length === 0) {
      addLog("Coloca componentes en el lienzo antes de colocar una sonda.", "error");
      return;
    }
    probePlacementController.setMode(mode);
    addLog(`[Osciloscopio] Modo colocación de sonda del ${mode} activo. Haz clic sobre un terminal del componente en el lienzo para conectar la sonda.`, "system");
  };

  if (oscilloscopePanel) {
    oscilloscopePanel.onPickProbeRequested = (channel) => {
      const mode = channel.toUpperCase() as ProbeChannel;
      handleProbeActivation(mode);
    };
    oscilloscopePanel.onProbeNodeChanged = () => {
      updateCanvasRendering();
    };
  }

  const setupChBtn = (btn: HTMLButtonElement | null, channel: ProbeChannel, getProbe: () => string | null, colorName: string) => {
    if (!btn) return;
    btn.addEventListener("click", (e) => {
      if (e.shiftKey) {
        handleProbeActivation(channel);
      } else {
        btn.classList.toggle("active");
        const node = getProbe();
        addLog(`Canal ${channel.replace("CH", "")} (Sonda en Nodo ${node}, color ${colorName}) ${btn.classList.contains('active') ? 'visible' : 'oculto'}.`, "system");
        if (oscilloscopePanel && !oscilloscopePanel.isSimulating) {
          updateOscilloscopeRendering();
        }
      }
    });
  };

  setupChBtn(oscCh1Btn, 'CH1', () => probePlacementController.getNode("CH1"), 'Amarillo');
  setupChBtn(oscCh2Btn, 'CH2', () => probePlacementController.getNode("CH2"), 'Celeste');
  setupChBtn(oscCh3Btn, 'CH3', () => probePlacementController.getNode("CH3"), 'Rosa');
  setupChBtn(oscCh4Btn, 'CH4', () => probePlacementController.getNode("CH4"), 'Verde');

  const oscAutofitBtn = document.querySelector("#osc-autofit-btn") as HTMLButtonElement | null;
  oscAutofitBtn?.addEventListener("click", () => {
    if (!oscilloscopePanel?.autoFit()) {
      addLog("[Osciloscopio] No hay una traza con datos para auto-escalar.", "error");
      return;
    }
    addLog("[Osciloscopio] Escalas ajustadas automáticamente.", "system");
  });

  if (oscPauseBtn) {
    oscPauseBtn.addEventListener("click", async () => {
      if (simulationRunner?.isSimulationPaused()) {
        await simulationController?.resumeSimulation();
      } else if (simulationControls?.isSimulationRunning()) {
        await simulationController?.pauseSimulation();
      } else if (oscilloscopePanel) {
        if (!oscilloscopePanel.isOscPaused) {
          oscilloscopePanel.pause();
          circuitState.audioOrchestrator.stopAll();
        } else {
          oscilloscopePanel.resume();
        }
        oscPauseBtn.classList.toggle("active");
        oscPauseBtn.textContent = oscilloscopePanel.isOscPaused ? "Reanudar" : "Pausa";
      }
    });
  }

  setTimeout(() => {
    updateOscilloscopeRendering();
  }, 100);
}

// --- INICIALIZACIÓN DEL MOTOR DE LIENZO INTERACTIVO (CANVAS CAD) ---

function initCanvasCAD() {
  const canvasElement = document.querySelector("#circuit-canvas") as HTMLCanvasElement;
  const overlayCanvasElement = document.querySelector("#circuit-canvas-overlay") as HTMLCanvasElement | null;
  if (!canvasElement) return;

  orchestrator = new CanvasOrchestrator(canvasElement, overlayCanvasElement);
  orchestrator.setSymbolStandard(getActiveSymbolStandard());
  window.addEventListener("symbol-standard-changed", (e: Event) => {
    const customEvt = e as CustomEvent<"IEEE" | "IEC">;
    if (customEvt.detail === "IEEE" || customEvt.detail === "IEC") {
      orchestrator?.setSymbolStandard(customEvt.detail);
    }
  });
  installPerformanceHarness({
    enabled: performanceAuditEnabled,
    getOrchestrator: () => orchestrator,
    clearVoltages: () => circuitState.clearVoltages(),
    resetPerformanceCaches,
    updateCanvasRendering,
    performanceMonitor,
  });
  if (visualAudit.isStep("orchestrator")) return;

  const canvasViewportController = createCanvasViewportController({
    canvasElement,
    overlayCanvasElement,
    requestRender: () => updateCanvasRendering(),
    requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
    devicePixelRatio: () => window.devicePixelRatio || 1,
    createResizeObserver: (callback) => new ResizeObserver(callback),
  });
  if (visualAudit.isStep("resize")) return;

  // Inicializar PanelLayoutManager con callback de resize del canvas
  const appRoot = document.querySelector("#app-viewport") as HTMLElement;
  if (appRoot) {
    panelLayoutManager = new PanelLayoutManager(appRoot, canvasViewportController.resizeCanvas);
  }
  if (visualAudit.isStep("layout")) return;

  const bottomDock = document.querySelector("#bottom-dock") as HTMLElement;
  if (bottomDock && orchestrator) {
    instrumentsDock = new InstrumentsDock(bottomDock, orchestrator, {
      onCanvasModified: () => {
        markCurrentTabAsModified();
        if (orchestrator) orchestrator.updateRealtimeErc();
      },
      onNetlistSync: () => extractNetlist(),
      requestRender: (immediate: boolean) => updateCanvasRendering(immediate),
      getPinNode: (pinKey: string) => circuitState.getPinNode(pinKey),
      log: (text: string, type: "system" | "error" = "system") => addLog(text, type),
      isSimulating: () => simulationRunner?.isSimulationActive() ?? false,
      onSourceMutated: (source) => {
        if (orchestrator?.selectedComponent?.id === source.id) {
          propertyEditor?.updatePropertiesPanel(source);
        }
        if (simulationRunner?.isSimulationActive()) {
          const mutations = buildLiveMutations(source, Number(source.value) || 0);
          for (const m of mutations) {
            void simulationRunner.mutateComponent(
              m.componentId,
              m.field as InteractiveMutationField,
              m.value,
            );
          }
        }
      },
    });
    floatingInstrumentManager = new FloatingInstrumentManager();
  }

  attachCanvasInput(canvasElement, orchestrator, {
    requestRender: (immediate) => updateCanvasRendering(immediate),
    onWireConnected: () => {
      extractNetlist();
      if (orchestrator) orchestrator.updateRealtimeErc();
      addLog(
        `Cable conectado entre terminales del lienzo.`,
        "system",
      );
    },
    onCanvasModified: () => {
      markCurrentTabAsModified();
      if (orchestrator) {
        orchestrator.updateRealtimeErc();
      }
    },
    onNetlistSync: () => extractNetlist(),
    onSelectionChanged: (comp) => {
      if (comp) {
        updatePropertiesPanel(comp);
        if (panelLayoutManager) {
          if (sidePanelController?.isCompactDrawerViewport()) {
            panelLayoutManager.setPanelCollapsed("left", true);
          }
          panelLayoutManager.setPanelCollapsed("right", false);
          sidePanelController?.syncDrawerState();
        }
      } else if (orchestrator?.selectedWire) {
        propertyEditor?.updateWirePropertiesPanel(orchestrator.selectedWire);
        if (panelLayoutManager) {
          if (sidePanelController?.isCompactDrawerViewport()) {
            panelLayoutManager.setPanelCollapsed("left", true);
          }
          panelLayoutManager.setPanelCollapsed("right", false);
          sidePanelController?.syncDrawerState();
        }
      } else {
        propertyEditor?.clearPropertiesPanel();
        if (panelLayoutManager) {
          panelLayoutManager.setPanelCollapsed("right", true);
          sidePanelController?.syncDrawerState();
        }
      }
    },
    getPinNode: (pinKey) => circuitState.getPinNode(pinKey),
    log: (text, type = "system") => addLog(text, type),
    getProbePlacementMode: () => probePlacementController.getMode(),
    clearProbePlacementMode: () => { probePlacementController.clearMode(); },
    onProbePlaced: (channel, nodeId) => {
      addLog(probePlacementController.placeProbe(channel, nodeId), "system");
    },
    getActiveAnalysisMode: () => activeAnalysisMode,
    onSparPortAssign: (nodeId) => {
      if (sparPorts.some(p => p.nodeId === nodeId)) {
        addLog(`El Nodo ${nodeId} ya está asignado como puerto RF.`, "system");
        return false;
      }
      sparPorts.push({ nodeId, z0: 50 });
      addLog(`Puerto RF ${sparPorts.length} asignado al Nodo ${nodeId} (Z0 = 50 Ω).`, "system");
      return true;
    },
    onSwitchDoubleClick: async (comp) => {
      if (comp.type === "switch_spdt" || comp.type === "switch_dpdt") {
        const curPos = comp.switchPosition ?? (comp.switchState ? 1 : 0);
        comp.switchPosition = curPos === 0 ? 1 : 0;
        comp.switchState = comp.switchPosition === 1;
      } else {
        comp.switchState = !(comp.switchState ?? false);
      }

      if (simulationRunner && simulationRunner.isSimulationActive()) {
        try {
          await simulationRunner.mutateComponent(
            comp.id,
            "switch_state",
            comp.switchState ? 1.0 : 0.0,
          );
          const stateLabel = comp.type === "switch_spdt" || comp.type === "switch_dpdt"
            ? `Posición ${comp.switchPosition === 0 ? "T1" : "T2"}`
            : (comp.switchState ? "Cerrado" : "Abierto");
          addLog(
            `Interruptor [${comp.id}] → ${stateLabel} (mutación en caliente)`,
            "system",
          );
        } catch (err) {
          addLog(`Error al mutar interruptor: ${err}`, "error");
        }
      }
    },
    onSubcircuitDoubleClick: async (comp) => {
      if (!tabManager) return;
      const subName = comp.subcircuitName || String(comp.value || "SUBCKT");
      const targetTab = tabManager.openOrCreateSubcircuitTab(subName, comp);
      if (targetTab) {
        addLog(
          `Abriendo hoja jerárquica del subcircuito [${comp.id}: ${targetTab.name}]...`,
          "system",
        );
      }
    },
    onHideMcuDebug: () => mcuDebugPanel?.hide(),
    onComponentPlaced: (comp) => {
      updatePropertiesPanel(comp);
    },
    onUndo: () => circuitHistory.undo(),
    onRedo: () => circuitHistory.redo(),
    onSelectAll: () => orchestrator?.selectAll(),
    onFitAll: () => orchestrator?.resetCameraToCircuit(),
    onEscape: () => orchestrator?.cancelWire(),
    onWireMode: () => addLog("Modo cable activo: haz doble clic en un pin y despues en el pin destino.", "system"),
  });
  if (visualAudit.isStep("input")) return;

  const canvasViewport = document.querySelector("#canvas-viewport") as HTMLElement;
  if (canvasViewport) {
    attachCanvasDrop(canvasViewport, canvasElement, orchestrator, {
      requestRender: (immediate) => updateCanvasRendering(immediate),
      onNetlistSync: () => extractNetlist(),
      onCanvasModified: () => {
        markCurrentTabAsModified();
        if (orchestrator) {
          orchestrator.ercIssues = [];
        }
      },
      onComponentPlaced: (comp) => updatePropertiesPanel(comp),
      log: (text, type = "system") => addLog(text, type),
      getPinNode: (pinKey) => circuitState.getPinNode(pinKey),
      onProbePlaced: (channel, nodeId) => {
        addLog(probePlacementController.placeProbe(channel, nodeId), "system");
        updateCanvasRendering();
      },
    });
  }
  if (visualAudit.isStep("drop")) return;

  initCanvasToolbarController({
    canvasElement,
    getOrchestrator: () => orchestrator,
    getOscilloscopePanel: () => oscilloscopePanel,
    clearVoltages: () => circuitState.clearVoltages(),
    resetPerformanceCaches,
    updateCanvasRendering,
    markCurrentTabAsModified,
    addLog,
    onUndo: () => circuitHistory.undo(),
    onRedo: () => circuitHistory.redo(),
    onWireMode: () => addLog("Modo cable activo: haz clic en un pin para trazar la conexión.", "system"),
  });

  initComponentPaletteController();
}

// --- CARGA GENERAL DEL DOM ---



window.addEventListener("DOMContentLoaded", () => {
  // Instalar protectores de teclado del WebView contra recarga accidental
  installWebviewKeyGuards(import.meta.env.DEV);
  // Desactivar popups de autocompletado e historial del navegador en inputs
  installWebviewAutofillGuards();

  // Inicializar gestor de tooltips premium
  TooltipManager.init();

  consoleLogController.init();

  initSidebars();
  initInstrumentCenter();
  initAutoHide();

  const controllers = createDesktopControllerRegistry({
    visualAudit,
    performanceMonitor,
    circuitState,
    probePlacementController,
    getOrchestrator: () => orchestrator,
    getPanelLayoutManager: () => panelLayoutManager,
    getInstrumentsDock: () => instrumentsDock,
    getFloatingInstrumentManager: () => floatingInstrumentManager,
    getSidePanelController: () => sidePanelController,
    getSimulationSettings: () => simSettings,
    setSimulationSettings: (settings) => { simSettings = { ...settings }; },
    getActiveAnalysisMode: () => activeAnalysisMode,
    setActiveAnalysisMode: (mode) => { activeAnalysisMode = mode; },
    getSparPorts: () => sparPorts,
    setSparPorts: (ports) => { sparPorts = ports; },
    getSparSweepSettings: () => ({
      fStart: sparFStart,
      fEnd: sparFEnd,
      pointsPerDecade: sparPPD,
    }),
    extractNetlist,
    solveTransientCircuitLocal,
    resetPerformanceCaches,
    updateCanvasRendering,
    updateOscilloscopeRendering,
    markCurrentTabAsModified,
    onActiveTabChanged: () => circuitHistory.syncActiveState(),
    onCircuitLoaded: () => circuitHistory.syncActiveState(true),
    setIpcStatus: (text, color) => ipcStatusController.setStatus(text, color),
    addLog,
    logError: (message) => TelemetryPanel.logError(message),
    invokeTauri: invoke,
    requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
    now: () => performance.now(),
  });

  renderController = controllers.renderController;
  circuitDocumentController = controllers.circuitDocumentController;
  tabManager = controllers.tabManager;
  propertyEditor = controllers.propertyEditor;
  simulationRunner = controllers.simulationRunner;
  simulationController = controllers.simulationController;
  simulationControls = controllers.simulationControls;
  oscilloscopePanel = controllers.oscilloscopePanel;
  mcuDebugPanel = controllers.mcuDebugPanel;
  runStartupSequence(visualAudit, {
    initOscilloscopeInterface,
    initCanvasCAD,
    initFilePersistence,
    initTabManager,
    addLog,
  });
  installDesktopE2eBridge({
    getOrchestrator: () => orchestrator,
    getDocumentController: () => circuitDocumentController,
    getActiveTabName: () => tabManager?.getActiveTab()?.name ?? null,
    getOscilloscopePanel: () => oscilloscopePanel,
    updateCanvasRendering: () => updateCanvasRendering(true),
    setDisablePacing: (disable) => {
      simulationController?.updateSimulationSettings({ disablePacing: disable });
    },
  });
  consoleLogController.bindClearButton();
  void initializeFeedbackRuntime(addLog);

  // Recuperación automática de renderizado y estado tras suspensión del sistema o display sleep
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      updateCanvasRendering(true);
      updateOscilloscopeRendering(true);
      window.dispatchEvent(new Event("resize"));
    } else {
      tabManager?.flushAutoSaveNow();
    }
  });

  window.addEventListener("focus", () => {
    updateCanvasRendering(true);
  });

  window.addEventListener("pageshow", () => {
    updateCanvasRendering(true);
  });

  liveStateExporter = createLiveStateExporter({
    getOrchestrator: () => orchestrator,
    getTabManager: () => tabManager,
    getActiveAnalysisMode: () => activeAnalysisMode,
    getVoltageMap: () => circuitState.getVoltageMap(),
    getBranchCurrents: () => circuitState.getCurrentMap(),
    isSimulationActive: () => Boolean(orchestrator?.simulationActive || simulationRunner?.isSimulationActive()),
    getRecentLogs: () => consoleLogController.getLogs(),
    invokeTauri: invoke,
  });
  liveStateExporter.scheduleExport(500);

  // Inicialización del Tour Guiado Interactivo (desacoplado)
  guideEngine = new GuideEngine({
    onPanelOpenRequest: (panel) => {
      panelLayoutManager?.setPanelCollapsed(panel, false);
      sidePanelController?.syncDrawerState();
    },
    onInstrumentTabRequest: (tabId) => {
      panelLayoutManager?.setPanelCollapsed("dock", false);
      sidePanelController?.syncDrawerState();
      instrumentsDock?.switchTab(tabId);
    },
    onActionTrigger: (actionId) => {
      if (actionId === "load_demo_rc") {
        const selectDemo = document.querySelector<HTMLSelectElement>("#btn-open-demo");
        if (selectDemo) {
          selectDemo.value = "01_filtro_rc.biaani";
          selectDemo.dispatchEvent(new Event("change"));
        }
      } else if (actionId === "open_oscilloscope") {
        panelLayoutManager?.setPanelCollapsed("dock", false);
        sidePanelController?.syncDrawerState();
        instrumentsDock?.switchTab("oscilloscope");
        document.querySelector<HTMLElement>("#btn-dock-toggle-bottom")?.focus();
      } else if (actionId === "open_mna_inspector") {
        guideEngine?.exit();
        document.querySelector<HTMLElement>("#btn-mna-inspector")?.click();
      } else if (actionId === "open_settings") {
        guideEngine?.exit();
        document.querySelector<HTMLElement>("#settings-trigger-btn")?.click();
      } else if (actionId === "open_spotlight") {
        guideEngine?.exit();
        const btnSpotlight = document.querySelector<HTMLButtonElement>("#btn-palette-spotlight");
        if (btnSpotlight) {
          btnSpotlight.click();
        } else {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
        }
      } else if (actionId === "open_optimizer") {
        panelLayoutManager?.setPanelCollapsed("dock", false);
        sidePanelController?.syncDrawerState();
        instrumentsDock?.switchTab("optimizer");
      } else if (actionId === "open_feedback") {
        guideEngine?.exit();
        document.querySelector<HTMLElement>("#btn-feedback-trigger")?.click();
      }
    },
  });

  const btnGuideTour = document.querySelector<HTMLButtonElement>("#btn-guide-tour");
  btnGuideTour?.addEventListener("click", () => {
    guideEngine?.toggle();
  });

  // Inicializar Capturador Global de Crashes y Emergencia
  CrashReporter.install({
    deps: getDiagnosticCollectorDeps(),
    onCrashObserved: (err) => {
      addLog(`Error crítico interceptado: ${String(err)}`, "error");
    },
  });

  // Comprobar si hay un circuito recuperado tras un crash previo
  if (circuitDocumentController) {
    CrashReporter.checkAndPromptEmergencyRecovery(circuitDocumentController, {
      onRestored: () => {
        addLog("Circuito recuperado tras cierre de emergencia.", "system");
      },
    });
  }

  // Botón de Feedback en Barra Superior
  const btnFeedbackTrigger = document.querySelector<HTMLButtonElement>("#btn-feedback-trigger");
  btnFeedbackTrigger?.addEventListener("click", () => {
    FeedbackModal.show({
      deps: getDiagnosticCollectorDeps(),
    });
  });

  setTimeout(() => {
    guideEngine?.showWelcomeToastIfFirstVisit();
  }, 1200);

  addLog("Entorno de escritorio cargado con telemetría de rendimiento activa.", "system");
  addLog("Colocación de sondas interactivas: Haz Shift+Click en Canal 1 o Canal 2 para conectar las sondas en el circuito.", "system");
});

function getDiagnosticCollectorDeps(): DiagnosticCollectorDeps {
  return {
    getOrchestrator: () => orchestrator,
    getCircuitDocumentController: () => circuitDocumentController,
    getSimulationSettings: () => simSettings,
    getActiveAnalysisMode: () => activeAnalysisMode,
    isSimulationActive: () => Boolean(orchestrator?.simulationActive || simulationRunner?.isSimulationActive()),
    getRecentLogs: () => consoleLogController.getLogs(),
    getCanvasElement: () => document.querySelector<HTMLCanvasElement>("#circuit-canvas"),
    getActiveTabName: () => tabManager?.getActiveTab()?.name || "Esquema 1",
  };
}

// --- EXPORTADORES PREMIUM DE REPORTES CIENTÍFICOS (DELEGADOS) ---
// (Ver src/ui/exporter_panel.ts)

// --- SISTEMA DE PERSISTENCIA LOCAL DE CIRCUITOS (DELEGADO) ---

function initFilePersistence() {
  if (!circuitDocumentController) return;

  initFilePersistenceController({
    getTabManager: () => tabManager,
    documentController: circuitDocumentController,
    addLog,
    invokeTauri: invoke,
  });
}

// --- GESTOR DE PESTAÑAS (WORKSPACE TABS DELEGADO) ---

function markCurrentTabAsModified() {
  circuitHistory.recordCurrentState();
  tabManager?.markCurrentTabAsModified();
  liveStateExporter?.scheduleExport(300);
}

function initTabManager() {
  tabManager!.init(() => initAppKeyboardShortcuts({
    getTabManager: () => tabManager,
    getPanelLayoutManager: () => panelLayoutManager,
    getSidePanelController: () => sidePanelController,
    isTypingInFormField,
    getOpenCircuitButton: () => document.querySelector("#btn-open-circuit"),
    getGuideTourButton: () => document.querySelector("#btn-guide-tour"),
    onOpenGuide: () => guideEngine?.toggle(),
    getFeedbackButton: () => document.querySelector("#btn-feedback-trigger"),
    onOpenFeedback: () => FeedbackModal.show({ deps: getDiagnosticCollectorDeps() }),
    onToggleZenMode: () => autoHideController?.toggleZenMode(),
  }));
  initComponentPaletteController();
}
