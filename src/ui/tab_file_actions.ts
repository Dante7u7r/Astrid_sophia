import type { CanvasOrchestrator } from "../canvas_orchestrator";
import type { CircuitDocumentPort } from "../app/circuit_document_controller";
import type { OscilloscopePanel } from "./oscilloscope_panel";
import type { AnalysisMode } from "./simulation_controls";
import { captureRuntimeIntoTab, type Tab, type TabProbeState } from "./workspace_state";

export interface TabFileActionDependencies {
  getOrchestrator(): CanvasOrchestrator | null;
  getOscilloscopePanel(): OscilloscopePanel | null;
  getActiveAnalysisMode(): AnalysisMode;
  getProbes(): TabProbeState;
  getSparPorts(): { nodeId: string; z0: number }[];
  getVoltageSnapshot(): Readonly<Record<string, number>>;
  documentController: Pick<CircuitDocumentPort, "serializeCircuit">;
  addLog(text: string, type?: "system" | "send" | "receive" | "error"): void;
  invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  renderTabsBar(): void;
}

export class TabFileActions {
  constructor(private readonly dependencies: TabFileActionDependencies) {}

  public captureActiveRuntime(tab: Tab): void {
    const orchestrator = this.dependencies.getOrchestrator();
    if (!orchestrator) return;

    captureRuntimeIntoTab(tab, {
      orchestrator,
      oscilloscopePanel: this.dependencies.getOscilloscopePanel(),
      activeAnalysisMode: this.dependencies.getActiveAnalysisMode(),
      probes: this.dependencies.getProbes(),
      sparPorts: this.dependencies.getSparPorts(),
      voltageSnapshot: this.dependencies.getVoltageSnapshot(),
    });
  }

  public async saveDirect(tab: Tab, fallbackToSaveAs: () => Promise<void>): Promise<void> {
    if (!tab.filePath) {
      await fallbackToSaveAs();
      return;
    }

    this.dependencies.addLog(`Guardando esquematico directamente en: [${tab.filePath}]...`, "system");
    try {
      this.captureActiveRuntime(tab);
      const jsonStr = this.dependencies.documentController.serializeCircuit();
      await this.dependencies.invokeTauri("save_circuit_to_path", {
        path: tab.filePath,
        content: jsonStr,
      });
      tab.unsaved = false;
      this.dependencies.renderTabsBar();
      this.dependencies.addLog("Esquematico guardado con exito.", "receive");
    } catch (err) {
      this.dependencies.addLog(`Error al guardar esquematico: ${err}`, "error");
    }
  }

  public async saveAs(tab: Tab): Promise<void> {
    this.dependencies.addLog("Abriendo dialogo para guardar esquematico...", "system");
    try {
      this.captureActiveRuntime(tab);
      const jsonStr = this.dependencies.documentController.serializeCircuit();
      const savedPath = await this.dependencies.invokeTauri<string>("save_circuit_file", {
        content: jsonStr,
      });

      if (!savedPath) return;

      tab.filePath = savedPath;
      tab.name = savedPath.split(/[/\\]/).pop() || "esquematico.astryd";
      tab.unsaved = false;
      this.dependencies.renderTabsBar();
      this.dependencies.addLog(`Esquematico guardado con exito en: [${savedPath}]`, "receive");
    } catch (err) {
      if (err !== "Operacion cancelada por el usuario") {
        this.dependencies.addLog(`Error al guardar esquematico: ${err}`, "error");
      } else {
        this.dependencies.addLog("Operacion de guardado cancelada.", "system");
      }
    }
  }
}
