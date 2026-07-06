import { type ComponentInstance, type CanvasOrchestrator } from "../canvas_orchestrator";
import {
  type AcSweepResult,
  type OscilloscopePanel,
  type PvtTrace,
  type TimeStepResult,
} from "./oscilloscope_panel";
import { type SParameterResult } from "../simulation";
import { type AnalysisMode } from "./simulation_controls";
import {
  cloneCircuitComponents,
  cloneCircuitWires,
  createDefaultOscilloscopeState,
  type PersistedOscilloscopeState,
} from "../persistence/circuit_file";

export interface TabProbeState {
  ch1: string | null;
  ch2: string | null;
  ch3: string | null;
  ch4: string | null;
}

export interface Tab {
  id: string;
  name: string;
  components: ComponentInstance[];
  wires: any[];
  zoom: number;
  offsetX: number;
  offsetY: number;
  filePath: string | null;
  unsaved: boolean;
  transientResults: TimeStepResult[];
  acSweepResults: AcSweepResult | null;
  pvtMode: boolean;
  pvtTraces: PvtTrace[];
  sparResult: SParameterResult | null;
  sparCh1Index: number;
  sparCh2Index: number;
  sparPorts: { nodeId: string; z0: number }[];
  voltageSnapshot: Record<string, number>;
  oscilloscopeState: PersistedOscilloscopeState;
  ch1ProbeNode: string | null;
  ch2ProbeNode: string | null;
  ch3ProbeNode: string | null;
  ch4ProbeNode: string | null;
  activeAnalysisMode: AnalysisMode;
}

export class TabManager {
  public tabs: Tab[] = [];
  public activeTabId: string | null = null;

  constructor(
    private callbacks: {
      getOrchestrator: () => CanvasOrchestrator | null;
      getOscilloscopePanel: () => OscilloscopePanel | null;
      getMcuDebugPanel: () => any;
      getSimulationControls: () => any;
      extractNetlist: () => void;
      updateCanvasRendering: () => void;
      getActiveAnalysisMode: () => AnalysisMode;
      setActiveAnalysisMode: (mode: AnalysisMode) => void;
      getProbes: () => TabProbeState;
      setProbes: (probes: TabProbeState) => void;
      getSparPorts: () => { nodeId: string; z0: number }[];
      setSparPorts: (ports: any[]) => void;
      getVoltageSnapshot: () => Readonly<Record<string, number>>;
      setVoltageSnapshot: (voltages: Record<string, number>) => void;
      resetRuntimeState: () => void;
      canChangeActiveTab: () => boolean;
      serializeCircuit: () => string;
      addLog: (text: string, type?: 'system' | 'send' | 'receive' | 'error') => void;
      invokeTauri: <T>(cmd: string, args?: any) => Promise<T>;
    }
  ) {}

  public getTabs(): Tab[] {
    return this.tabs;
  }

  public getActiveTabId(): string | null {
    return this.activeTabId;
  }

  public getActiveTab(): Tab | undefined {
    return this.tabs.find(t => t.id === this.activeTabId);
  }

  public createNewTab(name?: string, initialData?: { components: any[], wires: any[], filePath: string | null }): Tab | null {
    if (this.activeTabId && !this.callbacks.canChangeActiveTab()) {
      this.callbacks.addLog(
        "Detén la simulación activa antes de crear otra pestaña.",
        "error",
      );
      return null;
    }

    const tabId = Math.random().toString(36).substring(2, 9);
    const tabName = name || `Circuito ${this.tabs.length + 1}`;
    
    const newTab: Tab = {
      id: tabId,
      name: tabName,
      components: initialData?.components || [],
      wires: initialData?.wires || [],
      zoom: 1.0,
      offsetX: 0,
      offsetY: 0,
      filePath: initialData?.filePath || null,
      unsaved: false,
      transientResults: [],
      acSweepResults: null,
      pvtMode: false,
      pvtTraces: [],
      sparResult: null,
      sparCh1Index: 0,
      sparCh2Index: 1,
      sparPorts: [],
      voltageSnapshot: {},
      oscilloscopeState: createDefaultOscilloscopeState(),
      ch1ProbeNode: "1",
      ch2ProbeNode: "2",
      ch3ProbeNode: "3",
      ch4ProbeNode: "4",
      activeAnalysisMode: 'DC'
    };

    this.tabs.push(newTab);
    this.switchTab(tabId);
    return newTab;
  }

  public switchTab(tabId: string): boolean {
    if (this.activeTabId === tabId) return true;
    if (!this.tabs.some(tab => tab.id === tabId)) return false;
    if (this.activeTabId && !this.callbacks.canChangeActiveTab()) {
      this.callbacks.addLog(
        "Detén la simulación activa antes de cambiar de pestaña.",
        "error",
      );
      return false;
    }

    const orchestrator = this.callbacks.getOrchestrator();
    const oscilloscopePanel = this.callbacks.getOscilloscopePanel();
    const activeAnalysisMode = this.callbacks.getActiveAnalysisMode();
    const probes = this.callbacks.getProbes();

    // 1. Guardar el estado del tab actual
    if (this.activeTabId && orchestrator) {
      const currentTab = this.tabs.find(t => t.id === this.activeTabId);
      if (currentTab) {
        currentTab.components = cloneCircuitComponents(orchestrator.components);
        currentTab.wires = cloneCircuitWires(orchestrator.wires);
        currentTab.zoom = orchestrator.zoom;
        currentTab.offsetX = orchestrator.offsetX;
        currentTab.offsetY = orchestrator.offsetY;
        currentTab.activeAnalysisMode = activeAnalysisMode;
        currentTab.ch1ProbeNode = probes.ch1;
        currentTab.ch2ProbeNode = probes.ch2;
        currentTab.ch3ProbeNode = probes.ch3;
        currentTab.ch4ProbeNode = probes.ch4;
        currentTab.sparPorts = this.callbacks.getSparPorts().map(port => ({ ...port }));
        currentTab.voltageSnapshot = { ...this.callbacks.getVoltageSnapshot() };
        if (oscilloscopePanel) {
          currentTab.transientResults = oscilloscopePanel.transientResults;
          currentTab.acSweepResults = oscilloscopePanel.acSweepResults;
          currentTab.pvtMode = oscilloscopePanel.pvtMode;
          currentTab.pvtTraces = oscilloscopePanel.pvtTraces;
          currentTab.sparResult = oscilloscopePanel.sparResult;
          currentTab.sparCh1Index = oscilloscopePanel.sparCh1Index;
          currentTab.sparCh2Index = oscilloscopePanel.sparCh2Index;
          currentTab.oscilloscopeState = oscilloscopePanel.getPersistentState();
        }
      }
    }

    // 2. Cargar el estado del nuevo tab activo
    this.activeTabId = tabId;
    const targetTab = this.tabs.find(t => t.id === tabId);
    if (targetTab && orchestrator) {
      orchestrator.selectedComponent = null;
      orchestrator.selectedComponents = [];
      orchestrator.selectedWire = null;
      orchestrator.activePinForWire = null;
      orchestrator.tempWireEnd = null;
      orchestrator.selectionStart = null;
      orchestrator.selectionEnd = null;

      orchestrator.components = cloneCircuitComponents(targetTab.components);
      orchestrator.wires = cloneCircuitWires(targetTab.wires);
      orchestrator.zoom = targetTab.zoom;
      orchestrator.offsetX = targetTab.offsetX;
      orchestrator.offsetY = targetTab.offsetY;

      this.callbacks.setActiveAnalysisMode(targetTab.activeAnalysisMode);
      this.callbacks.setProbes({
        ch1: targetTab.ch1ProbeNode,
        ch2: targetTab.ch2ProbeNode,
        ch3: targetTab.ch3ProbeNode,
        ch4: targetTab.ch4ProbeNode,
      });

      const simulationControls = this.callbacks.getSimulationControls();
      if (simulationControls) {
        simulationControls.setActiveModeButton(targetTab.activeAnalysisMode);
      }

      if (oscilloscopePanel) {
        oscilloscopePanel.activeAnalysisMode = targetTab.activeAnalysisMode;
        oscilloscopePanel.ch1ProbeNode = targetTab.ch1ProbeNode;
        oscilloscopePanel.ch2ProbeNode = targetTab.ch2ProbeNode;
        oscilloscopePanel.ch3ProbeNode = targetTab.ch3ProbeNode;
        oscilloscopePanel.ch4ProbeNode = targetTab.ch4ProbeNode;
        oscilloscopePanel.transientResults = targetTab.transientResults;
        oscilloscopePanel.acSweepResults = targetTab.acSweepResults;
        oscilloscopePanel.sweepTime = 0.0;
        oscilloscopePanel.pvtMode = targetTab.pvtMode;
        oscilloscopePanel.pvtTraces = targetTab.pvtTraces;
        oscilloscopePanel.sparResult = targetTab.sparResult;
        oscilloscopePanel.sparCh1Index = targetTab.sparCh1Index;
        oscilloscopePanel.sparCh2Index = targetTab.sparCh2Index;
        oscilloscopePanel.applyPersistentState(targetTab.oscilloscopeState);
      }
      this.callbacks.setSparPorts(targetTab.sparPorts.map(port => ({ ...port })));
      this.callbacks.resetRuntimeState();
      this.callbacks.setVoltageSnapshot({ ...targetTab.voltageSnapshot });
      document.querySelectorAll('.pvt-profile-btn').forEach(el => el.remove());

      this.callbacks.extractNetlist();
      this.callbacks.updateCanvasRendering();
      if (oscilloscopePanel) oscilloscopePanel.draw();

      const mcuDebugPanel = this.callbacks.getMcuDebugPanel();
      if (mcuDebugPanel) {
        mcuDebugPanel.hide();
      }
    }

    this.renderTabsBar();
    return true;
  }

  public async closeTab(tabId: string) {
    const tabIndex = this.tabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) return;

    const targetTab = this.tabs[tabIndex];

    if (this.activeTabId === tabId && !this.callbacks.canChangeActiveTab()) {
      this.callbacks.addLog(
        "Detén la simulación activa antes de cerrar esta pestaña.",
        "error",
      );
      return;
    }

    if (targetTab.unsaved) {
      const confirmClose = confirm(`La pestaña "${targetTab.name}" tiene cambios no guardados. ¿Deseas cerrarla de todas formas?`);
      if (!confirmClose) return;
    }

    this.tabs.splice(tabIndex, 1);

    const orchestrator = this.callbacks.getOrchestrator();

    if (this.activeTabId === tabId) {
      if (this.tabs.length > 0) {
        const nextActiveIdx = Math.max(0, tabIndex - 1);
        this.activeTabId = null;
        this.switchTab(this.tabs[nextActiveIdx].id);
      } else {
        this.activeTabId = null;
        if (orchestrator) {
          orchestrator.components = [];
          orchestrator.wires = [];
        }
        this.createNewTab("Circuito 1");
      }
    } else {
      this.renderTabsBar();
    }
  }

  public renderTabsBar() {
    const container = document.querySelector("#tabs-container");
    if (!container) return;

    container.innerHTML = "";

    this.tabs.forEach(tab => {
      const tabEl = document.createElement("div");
      tabEl.className = `tab-item${tab.id === this.activeTabId ? " active" : ""}`;
      tabEl.setAttribute("data-id", tab.id);

      const nameSpan = document.createElement("span");
      nameSpan.textContent = tab.name;
      tabEl.appendChild(nameSpan);

      if (tab.unsaved) {
        const dot = document.createElement("span");
        dot.className = "tab-unsaved";
        tabEl.appendChild(dot);
      }

      const closeBtn = document.createElement("button");
      closeBtn.className = "tab-close";
      closeBtn.innerHTML = "&times;";
      closeBtn.type = "button";
      closeBtn.title = "Cerrar pestaña";
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closeTab(tab.id);
      });

      tabEl.appendChild(closeBtn);

      tabEl.addEventListener("click", () => {
        this.switchTab(tab.id);
      });

      container.appendChild(tabEl);
    });
  }

  public markCurrentTabAsModified() {
    const currentTab = this.tabs.find(t => t.id === this.activeTabId);
    if (currentTab && !currentTab.unsaved) {
      currentTab.unsaved = true;
      this.renderTabsBar();
    }
  }

  public async saveCircuitDirect() {
    const currentTab = this.tabs.find(t => t.id === this.activeTabId);
    if (!currentTab) return;

    const orchestrator = this.callbacks.getOrchestrator();

    if (currentTab.filePath) {
      this.callbacks.addLog(`Guardando esquemático directamente en: [${currentTab.filePath}]...`, "system");
      try {
        if (orchestrator) {
          currentTab.components = cloneCircuitComponents(orchestrator.components);
          currentTab.wires = cloneCircuitWires(orchestrator.wires);
          currentTab.zoom = orchestrator.zoom;
          currentTab.offsetX = orchestrator.offsetX;
          currentTab.offsetY = orchestrator.offsetY;
        }

        const jsonStr = this.callbacks.serializeCircuit();
        await this.callbacks.invokeTauri("save_circuit_to_path", { path: currentTab.filePath, content: jsonStr });
        currentTab.unsaved = false;
        this.renderTabsBar();
        this.callbacks.addLog(`Esquemático guardado con éxito.`, "receive");
      } catch (err) {
        this.callbacks.addLog(`Error al guardar esquemático: ${err}`, "error");
      }
    } else {
      this.saveCircuitAs();
    }
  }

  public async saveCircuitAs() {
    const currentTab = this.tabs.find(t => t.id === this.activeTabId);
    if (!currentTab) return;

    this.callbacks.addLog("Abriendo diálogo para guardar esquemático...", "system");
    const orchestrator = this.callbacks.getOrchestrator();
    try {
      if (orchestrator) {
        currentTab.components = cloneCircuitComponents(orchestrator.components);
        currentTab.wires = cloneCircuitWires(orchestrator.wires);
        currentTab.zoom = orchestrator.zoom;
        currentTab.offsetX = orchestrator.offsetX;
        currentTab.offsetY = orchestrator.offsetY;
      }

      const jsonStr = this.callbacks.serializeCircuit();
      const savedPath = await this.callbacks.invokeTauri<string>("save_circuit_file", { content: jsonStr });
      if (savedPath) {
        currentTab.filePath = savedPath;
        currentTab.name = savedPath.split(/[/\\]/).pop() || "esquematico.astryd";
        currentTab.unsaved = false;
        this.renderTabsBar();
        this.callbacks.addLog(`Esquemático guardado con éxito en: [${savedPath}]`, "receive");
      }
    } catch (err) {
      if (err !== "Operación cancelada por el usuario") {
        this.callbacks.addLog(`Error al guardar esquemático: ${err}`, "error");
      } else {
        this.callbacks.addLog("Operación de guardado cancelada.", "system");
      }
    }
  }

  public init(onAddTabShortcut: () => void) {
    const btnAddTab = document.querySelector("#btn-add-tab");
    if (btnAddTab) {
      btnAddTab.addEventListener("click", () => {
        this.createNewTab();
      });
    }

    // Crear primera pestaña por defecto
    this.createNewTab("Circuito 1");
    onAddTabShortcut();
  }
}
