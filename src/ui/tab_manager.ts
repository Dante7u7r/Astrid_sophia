import { type CanvasOrchestrator } from "../canvas_orchestrator";
import type { CircuitDocumentPort } from "../app/circuit_document_controller";
import { TabFileActions } from "./tab_file_actions";
import { type OscilloscopePanel } from "./oscilloscope_panel";
import { appendLiveTransientSample } from "../simulation/transient_history";
import { type AnalysisMode, type SimulationControls } from "./simulation_controls";
import type { McuDebugPanel } from "./mcu_debug_panel";
import { TabsView } from "./tabs_view";
import { WorkspaceStore } from "./workspace_store";
import {
  saveWorkspaceSession,
  restoreWorkspaceSession,
} from "./workspace_session_persister";
import {
  captureRuntimeIntoTab,
  restoreTabIntoRuntime,
  type InitialTabData,
  type Tab,
  type TabProbeState,
} from "./workspace_state";

export type { Tab, TabProbeState } from "./workspace_state";

export class TabManager {
  private readonly store = new WorkspaceStore();
  private readonly tabsView = new TabsView();
  private readonly fileActions: TabFileActions;
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private callbacks: {
      getOrchestrator: () => CanvasOrchestrator | null;
      getOscilloscopePanel: () => OscilloscopePanel | null;
      getMcuDebugPanel: () => McuDebugPanel | null;
      getSimulationControls: () => SimulationControls | null;
      extractNetlist: () => void;
      updateCanvasRendering: () => void;
      getActiveAnalysisMode: () => AnalysisMode;
      setActiveAnalysisMode: (mode: AnalysisMode) => void;
      getProbes: () => TabProbeState;
      setProbes: (probes: TabProbeState) => void;
      getSparPorts: () => { nodeId: string; z0: number }[];
      setSparPorts: (ports: { nodeId: string; z0: number }[]) => void;
      getVoltageSnapshot: () => Readonly<Record<string, number>>;
      setVoltageSnapshot: (voltages: Record<string, number>) => void;
      resetRuntimeState: () => void;
      onActiveTabChanged: (tabId: string) => void;
      canChangeActiveTab: () => boolean;
      documentController: Pick<CircuitDocumentPort, "serializeCircuit">;
      addLog: (text: string, type?: "system" | "send" | "receive" | "error") => void;
      invokeTauri: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    }
  ) {
    this.fileActions = new TabFileActions({
      getOrchestrator: callbacks.getOrchestrator,
      getOscilloscopePanel: callbacks.getOscilloscopePanel,
      getActiveAnalysisMode: callbacks.getActiveAnalysisMode,
      getProbes: callbacks.getProbes,
      getSparPorts: callbacks.getSparPorts,
      getVoltageSnapshot: callbacks.getVoltageSnapshot,
      documentController: callbacks.documentController,
      addLog: callbacks.addLog,
      invokeTauri: callbacks.invokeTauri,
      renderTabsBar: () => {
        this.renderTabsBar();
      },
    });
  }

  public get tabs(): Tab[] {
    return this.store.getTabs();
  }

  public get activeTabId(): string | null {
    return this.store.getActiveTabId();
  }

  public set activeTabId(tabId: string | null) {
    this.store.setActiveTabId(tabId);
  }

  public getTabs(): Tab[] {
    return this.store.getTabs();
  }

  public getActiveTabId(): string | null {
    return this.store.getActiveTabId();
  }

  public getActiveTab(): Tab | undefined {
    return this.store.getActiveTab();
  }

  public getTabById(tabId: string): Tab | undefined {
    return this.store.findTab(tabId);
  }

  public isActiveTab(tabId: string): boolean {
    return this.store.getActiveTabId() === tabId;
  }

  public appendTransientFrameToTab(
    tabId: string,
    frame: {
      time: number;
      nodeVoltages: Readonly<Record<string, number>>;
      branchCurrents: Readonly<Record<string, number>>;
    },
  ): Tab | undefined {
    const tab = this.store.findTab(tabId);
    if (!tab) return undefined;

    appendLiveTransientSample(tab.transientResults, {
      time: frame.time,
      nodeVoltages: { ...frame.nodeVoltages },
      branchCurrents: { ...frame.branchCurrents },
    });
    tab.voltageSnapshot = { ...frame.nodeVoltages };
    return tab;
  }

  public bindTransientResultsToTab(tabId: string, transientResults: Tab["transientResults"]): Tab | undefined {
    const tab = this.store.findTab(tabId);
    if (!tab) return undefined;

    tab.transientResults = transientResults;
    return tab;
  }

  public isTabEmpty(tab: Tab): boolean {
    return tab.components.length === 0
      && tab.wires.length === 0
      && tab.filePath === null
      && !tab.unsaved;
  }

  public applyLoadedFileToTab(
    tabId: string,
    metadata: { name: string; filePath: string | null; unsaved?: boolean },
  ): Tab | undefined {
    const tab = this.store.findTab(tabId);
    if (!tab) return undefined;

    tab.name = metadata.name;
    tab.filePath = metadata.filePath;
    tab.unsaved = metadata.unsaved ?? false;
    this.renderTabsBar();
    this.scheduleAutoSave(100);
    return tab;
  }

  public createNewTab(name?: string, initialData?: InitialTabData, analysisMode?: AnalysisMode): Tab | null {
    if (this.activeTabId && !this.callbacks.canChangeActiveTab()) {
      this.callbacks.addLog(
        "Deten la simulacion activa antes de crear otra pestana.",
        "error",
      );
      return null;
    }

    const tabId = Math.random().toString(36).substring(2, 9);
    const mode = analysisMode ?? this.callbacks.getActiveAnalysisMode();
    const newTab = this.store.createTab(tabId, name, initialData, mode);

    this.switchTab(tabId);
    return newTab;
  }

  public switchTab(tabId: string): boolean {
    if (this.activeTabId === tabId) return true;
    if (!this.store.hasTab(tabId)) return false;
    if (this.activeTabId && !this.callbacks.canChangeActiveTab()) {
      this.callbacks.addLog(
        "Deten la simulacion activa antes de cambiar de pestana.",
        "error",
      );
      return false;
    }

    const orchestrator = this.callbacks.getOrchestrator();
    const oscilloscopePanel = this.callbacks.getOscilloscopePanel();

    if (this.activeTabId && orchestrator) {
      const currentTab = this.store.findTab(this.activeTabId);
      if (currentTab) {
        captureRuntimeIntoTab(currentTab, {
          orchestrator,
          oscilloscopePanel,
          activeAnalysisMode: this.callbacks.getActiveAnalysisMode(),
          probes: this.callbacks.getProbes(),
          sparPorts: this.callbacks.getSparPorts(),
          voltageSnapshot: this.callbacks.getVoltageSnapshot(),
        });
      }
    }

    this.store.setActiveTabId(tabId);
    const targetTab = this.store.findTab(tabId);
    if (targetTab && orchestrator) {
      restoreTabIntoRuntime(targetTab, {
        orchestrator,
        oscilloscopePanel,
        simulationControls: this.callbacks.getSimulationControls(),
        setActiveAnalysisMode: this.callbacks.setActiveAnalysisMode,
        setProbes: this.callbacks.setProbes,
        setSparPorts: this.callbacks.setSparPorts,
        setVoltageSnapshot: this.callbacks.setVoltageSnapshot,
        resetRuntimeState: this.callbacks.resetRuntimeState,
      });
      document.querySelectorAll(".pvt-profile-btn").forEach(el => el.remove());

      this.callbacks.extractNetlist();
      this.callbacks.updateCanvasRendering();
      if (oscilloscopePanel) oscilloscopePanel.draw();

      const mcuDebugPanel = this.callbacks.getMcuDebugPanel();
      if (mcuDebugPanel) {
        mcuDebugPanel.hide();
      }
    }

    this.renderTabsBar();
    this.callbacks.onActiveTabChanged(tabId);
    this.scheduleAutoSave(100);
    return true;
  }

  public async closeTab(tabId: string) {
    const tabIndex = this.store.indexOf(tabId);
    if (tabIndex === -1) return;

    const targetTab = this.store.findTab(tabId);
    if (!targetTab) return;

    if (this.activeTabId === tabId && !this.callbacks.canChangeActiveTab()) {
      this.callbacks.addLog(
        "Deten la simulacion activa antes de cerrar esta pestana.",
        "error",
      );
      return;
    }

    if (targetTab.unsaved) {
      const confirmClose = confirm(`La pestana "${targetTab.name}" tiene cambios no guardados. Deseas cerrarla de todas formas?`);
      if (!confirmClose) return;
    }

    this.store.removeTab(tabId);

    const orchestrator = this.callbacks.getOrchestrator();

    if (this.activeTabId === tabId) {
      const fallbackTabId = this.store.getFallbackTabIdAfterRemoval(tabIndex);
      if (fallbackTabId) {
        this.store.setActiveTabId(null);
        this.switchTab(fallbackTabId);
      } else {
        this.store.setActiveTabId(null);
        if (orchestrator) {
          orchestrator.components = [];
          orchestrator.wires = [];
        }
        this.createNewTab("Circuito 1", undefined, this.callbacks.getActiveAnalysisMode());
      }
    } else {
      this.renderTabsBar();
      this.scheduleAutoSave(100);
    }
  }

  public async closeActiveTab(): Promise<void> {
    const activeTabId = this.store.getActiveTabId();
    if (activeTabId) {
      await this.closeTab(activeTabId);
    }
  }

  public renderTabsBar() {
    this.tabsView.render(this.store.getTabs(), this.store.getActiveTabId(), {
      onSelect: (tabId) => {
        this.switchTab(tabId);
      },
      onClose: (tabId) => {
        void this.closeTab(tabId);
      },
    });
  }

  public scheduleAutoSave(delayMs = 300): void {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }
    this.autoSaveTimer = setTimeout(() => {
      this.autoSaveTimer = null;
      this.flushAutoSaveNow();
    }, delayMs);
  }

  public flushAutoSaveNow(): void {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }

    const orchestrator = this.callbacks.getOrchestrator();
    const activeTabId = this.store.getActiveTabId();

    if (activeTabId && orchestrator) {
      const currentTab = this.store.findTab(activeTabId);
      if (currentTab) {
        captureRuntimeIntoTab(currentTab, {
          orchestrator,
          oscilloscopePanel: this.callbacks.getOscilloscopePanel(),
          activeAnalysisMode: this.callbacks.getActiveAnalysisMode(),
          probes: this.callbacks.getProbes(),
          sparPorts: this.callbacks.getSparPorts(),
          voltageSnapshot: this.callbacks.getVoltageSnapshot(),
        });
      }
    }

    saveWorkspaceSession(this.store.getTabs(), activeTabId);
  }

  public markCurrentTabAsModified() {
    if (this.store.markActiveTabAsModified()) {
      this.renderTabsBar();
      this.scheduleAutoSave();
    }
  }

  public async saveCircuitDirect() {
    const currentTab = this.store.getActiveTab();
    if (!currentTab) return;

    await this.fileActions.saveDirect(currentTab, () => this.saveCircuitAs());
    this.scheduleAutoSave(100);
  }

  public async saveCircuitAs() {
    const currentTab = this.store.getActiveTab();
    if (!currentTab) return;

    await this.fileActions.saveAs(currentTab);
    this.scheduleAutoSave(100);
  }

  public init(onAddTabShortcut: () => void) {
    const btnAddTab = document.querySelector("#btn-add-tab");
    if (btnAddTab) {
      btnAddTab.addEventListener("click", () => {
        this.createNewTab(undefined, undefined, this.callbacks.getActiveAnalysisMode());
      });
    }

    const savedSession = restoreWorkspaceSession(this.callbacks.getActiveAnalysisMode());
    const hasRestorableContent = savedSession
      && savedSession.tabs.length > 0
      && savedSession.tabs.some(t => t.components.length > 0 || t.wires.length > 0 || t.filePath !== null || t.unsaved);

    if (hasRestorableContent && savedSession) {
      this.store.loadTabs(savedSession.tabs, savedSession.activeTabId);
      const activeId = this.store.getActiveTabId();
      const orchestrator = this.callbacks.getOrchestrator();
      if (activeId && orchestrator) {
        const targetTab = this.store.findTab(activeId);
        if (targetTab) {
          restoreTabIntoRuntime(targetTab, {
            orchestrator,
            oscilloscopePanel: this.callbacks.getOscilloscopePanel(),
            simulationControls: this.callbacks.getSimulationControls(),
            setActiveAnalysisMode: this.callbacks.setActiveAnalysisMode,
            setProbes: this.callbacks.setProbes,
            setSparPorts: this.callbacks.setSparPorts,
            setVoltageSnapshot: this.callbacks.setVoltageSnapshot,
            resetRuntimeState: this.callbacks.resetRuntimeState,
          });
        }
      }
      this.renderTabsBar();
      this.callbacks.extractNetlist();
      this.callbacks.updateCanvasRendering();
      this.callbacks.addLog("Sesión de trabajo previa restaurada automáticamente.", "system");
    } else {
      this.createNewTab("Circuito 1", undefined, this.callbacks.getActiveAnalysisMode());
    }

    onAddTabShortcut();

    // Guardado preventivo en eventos de ciclo de vida del navegador / WebView
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => this.flushAutoSaveNow());
      window.addEventListener("pagehide", () => this.flushAutoSaveNow());
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
          this.flushAutoSaveNow();
        }
      });
    }
  }
}
