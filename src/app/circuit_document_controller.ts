import type { CanvasOrchestrator } from "../canvas_orchestrator";
import {
  parseCircuitFile,
  serializeCircuitFile,
  type CircuitFileData,
} from "../persistence/circuit_file";
import type { CircuitStateManager } from "../simulation/circuit_state_manager";
import { validateSchematicIntegrity } from "../simulation/netlist_extractor";
import type { AnalysisMode } from "../ui/simulation_controls";
import type { SimulationSettings } from "../ui/settings_modal";
import type { OscilloscopePanel } from "../ui/oscilloscope_panel";

export interface ValidatedCircuitFile {
  data: CircuitFileData;
  migratedFrom: string | null;
}

export interface CircuitDocumentPort {
  serializeCircuit(): string;
  validateCircuitFileForLoad(jsonStr: string): ValidatedCircuitFile | null;
  deserializeCircuit(jsonStr: string, validatedFile?: ValidatedCircuitFile): boolean;
}

export interface CircuitDocumentControllerDependencies {
  getOrchestrator(): CanvasOrchestrator | null;
  getOscilloscopePanel(): OscilloscopePanel | null;
  getSimulationSettings(): SimulationSettings;
  setSimulationSettings(settings: SimulationSettings): void;
  getActiveAnalysisMode(): AnalysisMode;
  setActiveAnalysisMode(mode: AnalysisMode): void;
  setSimulationControlMode(mode: AnalysisMode): void;
  getSparPorts(): { nodeId: string; z0: number }[];
  setSparPorts(ports: { nodeId: string; z0: number }[]): void;
  setProbeNodes(probes: {
    ch1: string | null;
    ch2: string | null;
    ch3: string | null;
    ch4: string | null;
  }): void;
  circuitState: CircuitStateManager;
  resetPerformanceCaches(): void;
  extractNetlist(): void;
  updateCanvasRendering(): void;
  updateOscilloscopeRendering(): void;
  addLog(text: string, type?: "system" | "send" | "receive" | "error"): void;
  logError(message: string): void;
}

export class CircuitDocumentController implements CircuitDocumentPort {
  constructor(private readonly dependencies: CircuitDocumentControllerDependencies) {}

  serializeCircuit(): string {
    const orchestrator = this.dependencies.getOrchestrator();
    const oscilloscopePanel = this.dependencies.getOscilloscopePanel();
    if (!orchestrator || !oscilloscopePanel) return "{}";

    const simSettings = this.dependencies.getSimulationSettings();
    return serializeCircuitFile({
      components: orchestrator.components,
      wires: orchestrator.wires,
      viewport: {
        zoom: orchestrator.zoom,
        offsetX: orchestrator.offsetX,
        offsetY: orchestrator.offsetY,
      },
      simSettings: {
        dt: simSettings.dt,
        tolerance: simSettings.tolerance,
        maxIterations: simSettings.maxIterations,
      },
      activeAnalysisMode: this.dependencies.getActiveAnalysisMode(),
      probes: {
        ch1ProbeNode: oscilloscopePanel.ch1ProbeNode,
        ch2ProbeNode: oscilloscopePanel.ch2ProbeNode,
        ch3ProbeNode: oscilloscopePanel.ch3ProbeNode,
        ch4ProbeNode: oscilloscopePanel.ch4ProbeNode,
      },
      sparPorts: this.dependencies.getSparPorts(),
      oscilloscope: oscilloscopePanel.getPersistentState(),
    });
  }

  validateCircuitFileForLoad(jsonStr: string): ValidatedCircuitFile | null {
    const orchestrator = this.dependencies.getOrchestrator();
    if (!orchestrator) return null;

    const parsed = parseCircuitFile(jsonStr);
    if (!parsed.ok) {
      this.dependencies.addLog(parsed.error, "error");
      this.dependencies.logError(parsed.error);
      return null;
    }

    const integrityError = validateSchematicIntegrity(
      parsed.data.components,
      parsed.data.wires,
      component => orchestrator.getComponentPins(component),
    );
    if (integrityError) {
      const message = `Archivo .astryd rechazado: ${integrityError}`;
      this.dependencies.addLog(message, "error");
      this.dependencies.logError(message);
      return null;
    }

    return { data: parsed.data, migratedFrom: parsed.migratedFrom };
  }

  deserializeCircuit(jsonStr: string, validatedFile?: ValidatedCircuitFile): boolean {
    const orchestrator = this.dependencies.getOrchestrator();
    if (!orchestrator) return false;

    const candidate = validatedFile ?? this.validateCircuitFileForLoad(jsonStr);
    if (!candidate) return false;

    try {
      const data = candidate.data;
      const oscilloscopePanel = this.dependencies.getOscilloscopePanel();

      this.dependencies.circuitState.prepareForDemoLoad(oscilloscopePanel, orchestrator);
      orchestrator.components = data.components;
      orchestrator.wires = data.wires;
      orchestrator.selectedComponent = null;
      orchestrator.selectedComponents = [];
      orchestrator.selectedWire = null;
      orchestrator.activePinForWire = null;
      orchestrator.tempWireEnd = null;
      orchestrator.selectionStart = null;
      orchestrator.selectionEnd = null;

      this.dependencies.circuitState.clearVoltages();
      if (oscilloscopePanel) {
        oscilloscopePanel.transientResults = [];
        oscilloscopePanel.acSweepResults = null;
        oscilloscopePanel.sweepTime = 0.0;
      }
      this.dependencies.resetPerformanceCaches();

      orchestrator.syncWireConnections();
      orchestrator.zoom = data.viewport.zoom;
      orchestrator.offsetX = data.viewport.offsetX;
      orchestrator.offsetY = data.viewport.offsetY;

      this.dependencies.setSimulationSettings({
        dt: data.simSettings.dt,
        tolerance: data.simSettings.tolerance,
        maxIterations: data.simSettings.maxIterations,
      });

      this.dependencies.setActiveAnalysisMode(data.activeAnalysisMode);
      this.dependencies.setSimulationControlMode(data.activeAnalysisMode);
      this.dependencies.setProbeNodes({
        ch1: data.probes.ch1ProbeNode,
        ch2: data.probes.ch2ProbeNode,
        ch3: data.probes.ch3ProbeNode,
        ch4: data.probes.ch4ProbeNode,
      });
      this.dependencies.setSparPorts(data.sparPorts.map(port => ({ ...port })));

      if (oscilloscopePanel) {
        oscilloscopePanel.ch1ProbeNode = data.probes.ch1ProbeNode;
        oscilloscopePanel.ch2ProbeNode = data.probes.ch2ProbeNode;
        oscilloscopePanel.ch3ProbeNode = data.probes.ch3ProbeNode;
        oscilloscopePanel.ch4ProbeNode = data.probes.ch4ProbeNode;
        oscilloscopePanel.activeAnalysisMode = data.activeAnalysisMode;
        oscilloscopePanel.applyPersistentState(data.oscilloscope);
      }

      this.dependencies.extractNetlist();
      this.dependencies.updateCanvasRendering();
      this.dependencies.updateOscilloscopeRendering();

      if (candidate.migratedFrom) {
        this.dependencies.addLog(`Archivo migrado de la version ${candidate.migratedFrom} a la ${data.version}.`, "system");
      }
      return true;
    } catch (err) {
      this.dependencies.addLog(`Error al aplicar el archivo .astryd: ${(err as Error).message}`, "error");
      return false;
    }
  }
}

export function createCircuitDocumentController(
  dependencies: CircuitDocumentControllerDependencies,
): CircuitDocumentController {
  return new CircuitDocumentController(dependencies);
}
