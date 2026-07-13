import type { CanvasOrchestrator } from "../canvas_orchestrator";
import type { CircuitStateManager } from "../simulation/circuit_state_manager";
import { solveCircuitTS } from "../simulation/fallback_solver";
import {
  clearPendingTimeouts,
  dispatchSimulation,
  runElectricalRuleCheck,
} from "../simulation/simulation_dispatcher";
import type { SimulationRunner } from "../simulation/simulation_runner";
import type { CircuitNetlist } from "../simulation/netlist_extractor";
import type {
  DcSimulationResult,
  PssSimulationResult,
  SensitivityAnalysisResult,
  SimulationDispatchResult,
} from "../simulation/tauri_commands";
import type { AcSweepResult, TimeStepResult } from "../ui/oscilloscope_panel";
import type { OscilloscopePanel } from "../ui/oscilloscope_panel";
import type { AnalysisMode, SimulationControlHandlers } from "../ui/simulation_controls";
import type { SimulationSettings } from "../ui/settings_modal";
import { parseErcIssues } from "../ui/instrumentation_menu";

export interface SimulationControllerDependencies {
  getOrchestrator(): CanvasOrchestrator | null;
  getOscilloscopePanel(): OscilloscopePanel | null;
  getSimulationRunner(): SimulationRunner | null;
  getSimulationSettings(): SimulationSettings;
  setSimulationRunning(running: boolean): void;
  setActiveAnalysisMode(mode: AnalysisMode): void;
  getActiveTabId(): string | null;
  bindTransientResultsToTab(tabId: string, transientResults: TimeStepResult[]): void;
  extractNetlist(reportErrors?: boolean): CircuitNetlist | null;
  solveTransientCircuitLocal(
    netlist: CircuitNetlist,
    dt: number,
    tMax: number,
  ): Promise<TimeStepResult[] | string>;
  runPvtAnalysis(netlist: CircuitNetlist): Promise<void>;
  runSparamExport(netlist: CircuitNetlist): Promise<void>;
  circuitState: CircuitStateManager;
  resetPerformanceCaches(): void;
  updateCanvasRendering(): void;
  updateOscilloscopeRendering(): void;
  setInstrumentDockCollapsed(collapsed: boolean): void;
  setIpcStatus(text: string, color: string): void;
  addLog(text: string, type?: "system" | "send" | "receive" | "error"): void;
}

const ANALYSIS_LABELS: Record<AnalysisMode, string> = {
  DC: "Corriente Continua",
  AC: "Barrido CA",
  TRAN: "Transitorio",
  SENS: "Sensibilidad",
  PSS: "Régimen Permanente Periódico",
  STB: "Estabilidad",
  PVT: "PVT Corner Analysis",
  SPAR: "Parámetros S",
};

export class SimulationController {
  constructor(private readonly dependencies: SimulationControllerDependencies) {}

  createControlHandlers(): SimulationControlHandlers {
    return {
      onRunSimulation: async (_netlist, mode) => this.runSimulation(mode),
      onStopSimulation: async () => this.stopSimulation(),
      setActiveAnalysisMode: (mode) => this.setActiveAnalysisMode(mode),
      addLog: (text, type) => this.dependencies.addLog(text, type),
      updateCanvasRendering: () => this.dependencies.updateCanvasRendering(),
    };
  }

  async runSimulation(mode: AnalysisMode): Promise<void> {
    const orchestrator = this.dependencies.getOrchestrator();
    this.dependencies.addLog(
      `Iniciando simulación física de análisis [${ANALYSIS_LABELS[mode]}]...`,
      "system",
    );
    this.dependencies.setInstrumentDockCollapsed(false);

    if (!orchestrator || orchestrator.components.length === 0) {
      this.dependencies.addLog("Error: El lienzo está vacío. Coloca componentes antes de simular.", "error");
      this.dependencies.setSimulationRunning(false);
      return;
    }

    const netlist = this.dependencies.extractNetlist(true);
    if (!netlist) {
      this.dependencies.setSimulationRunning(false);
      return;
    }

    const ercResult = runElectricalRuleCheck(
      netlist,
      orchestrator.components,
      orchestrator.wires,
      component => orchestrator.getComponentPins(component),
    );
    for (const warn of ercResult.warnings) {
      this.dependencies.addLog(`[ERC Advertencia] ${warn}`, "error");
    }

    orchestrator.ercIssues = parseErcIssues(ercResult.warnings, ercResult.errors);
    orchestrator.render();

    if (!ercResult.passed) {
      this.dependencies.addLog("----------------------------------------------------------------", "error");
      this.dependencies.addLog("¡ERC FALLIDO! La simulación se ha abortado para prevenir bloqueos matemáticos:", "error");
      for (const err of ercResult.errors) {
        this.dependencies.addLog(`▶ [ERC Error] ${err}`, "error");
      }
      this.dependencies.addLog("Corrige estos errores topológicos en el lienzo para poder simular.", "error");
      this.dependencies.addLog("----------------------------------------------------------------", "error");
      this.dependencies.setSimulationRunning(false);
      return;
    }

    const oscilloscopePanel = this.dependencies.getOscilloscopePanel();
    if (oscilloscopePanel) {
      oscilloscopePanel.transientResults = [];
      oscilloscopePanel.sweepTime = 0.0;
      this.dependencies.resetPerformanceCaches();
      if (mode !== "PVT") {
        oscilloscopePanel.pvtMode = false;
        oscilloscopePanel.pvtTraces = [];
      }
      oscilloscopePanel.start();
    }

    const simulationOwnerId = this.dependencies.getActiveTabId();
    if (!simulationOwnerId) {
      this.dependencies.setSimulationRunning(false);
      this.dependencies.addLog("No hay una pestaña activa para asociar la simulación.", "error");
      return;
    }
    if (oscilloscopePanel) {
      this.dependencies.bindTransientResultsToTab(
        simulationOwnerId,
        oscilloscopePanel.transientResults,
      );
    }

    await dispatchSimulation(netlist, mode, {
      simSettings: this.dependencies.getSimulationSettings(),
      transientDuration: 0.05,
      simulationOwnerId,
      simulationRunner: this.dependencies.getSimulationRunner(),
      solveCircuitTS,
      solveTransientCircuitLocal: this.dependencies.solveTransientCircuitLocal,
      onSpecialMode: async (specialNetlist, specialMode) => {
        if (specialMode === "PVT") await this.dependencies.runPvtAnalysis(specialNetlist);
        if (specialMode === "SPAR") await this.dependencies.runSparamExport(specialNetlist);
      },
    }, {
      addLog: (text, type) => this.dependencies.addLog(text, type),
      onResultsReady: (resultMode, results) => this.applyResults(resultMode, results),
      onIpcStatusUpdate: (text, color) => this.dependencies.setIpcStatus(text, color),
      updateCanvasRendering: () => this.dependencies.updateCanvasRendering(),
      onSimulationFinished: () => this.dependencies.setSimulationRunning(false),
      onHighlightElement: (id) => this.highlightElement(id),
    });
  }

  async stopSimulation(): Promise<void> {
    this.dependencies.addLog("Deteniendo simulación física del circuito.", "system");
    clearPendingTimeouts();
    await this.dependencies.getSimulationRunner()?.stopInteractiveTransient();
    this.dependencies.circuitState.audioOrchestrator.stopAll();
    this.dependencies.getOscilloscopePanel()?.stop();
    this.dependencies.circuitState.resetAll();
  }

  setActiveAnalysisMode(mode: AnalysisMode): void {
    this.dependencies.setActiveAnalysisMode(mode);
    const oscilloscopePanel = this.dependencies.getOscilloscopePanel();
    if (oscilloscopePanel) {
      oscilloscopePanel.activeAnalysisMode = mode;
      this.dependencies.updateOscilloscopeRendering();
    }
    if (mode !== "PVT") {
      document.querySelectorAll(".pvt-profile-btn").forEach(el => el.remove());
    }
  }

  private applyResults(mode: AnalysisMode, results: SimulationDispatchResult): void {
    const oscilloscopePanel = this.dependencies.getOscilloscopePanel();
    const orchestrator = this.dependencies.getOrchestrator();

    if (mode === "AC") {
      if (oscilloscopePanel && isAcSweepResult(results)) {
        oscilloscopePanel.acSweepResults = results;
      }
    } else if (mode === "SENS") {
      if (isSensitivityAnalysisResult(results)) {
        this.dependencies.circuitState.setVoltagesFromSnapshot(results.nominalVoltages ?? {});
      }
    } else if (mode === "PSS") {
      const pssResults = isPssSimulationResult(results) ? results : [];
      if (oscilloscopePanel) oscilloscopePanel.transientResults = pssResults;
      const transientResults = oscilloscopePanel ? oscilloscopePanel.transientResults : [];
      if (transientResults.length > 0) {
        this.dependencies.circuitState.setVoltagesFromSnapshot(transientResults[transientResults.length - 1].nodeVoltages);
      }
    } else if (mode === "TRAN" && Array.isArray(results)) {
      if (oscilloscopePanel) oscilloscopePanel.transientResults = results;
      if (results.length > 0) {
        this.dependencies.circuitState.setVoltagesFromSnapshot(results[results.length - 1].nodeVoltages);
      }
      if (orchestrator) {
        this.dependencies.circuitState.actuatorHistory.precompute(
          orchestrator.components,
          results,
          { ...this.dependencies.circuitState.getPinToNodeMap() },
        );
      }
    } else {
      const dcResults: DcSimulationResult = isDcSimulationResult(results)
        ? results
        : { nodeVoltages: {} };
      this.dependencies.circuitState.setVoltagesFromSnapshot(dcResults.nodeVoltages ?? {});
    }
    this.dependencies.updateOscilloscopeRendering();
  }

  private highlightElement(id: string): void {
    const orchestrator = this.dependencies.getOrchestrator();
    if (!orchestrator) return;

    const comp = orchestrator.components.find(component => component.id === id);
    if (!comp) return;
    orchestrator.selectedComponents = [comp];
    orchestrator.selectedComponent = comp;
    orchestrator.render();
  }
}

export function createSimulationController(
  dependencies: SimulationControllerDependencies,
): SimulationController {
  return new SimulationController(dependencies);
}

function isAcSweepResult(result: SimulationDispatchResult): result is AcSweepResult {
  return !Array.isArray(result)
    && "frequencies" in result
    && "nodeAmplitudes" in result
    && "nodePhases" in result;
}

function isSensitivityAnalysisResult(
  result: SimulationDispatchResult,
): result is SensitivityAnalysisResult {
  return !Array.isArray(result)
    && "sensitivities" in result
    && "worstCaseLimits" in result;
}

function isPssSimulationResult(result: SimulationDispatchResult): result is PssSimulationResult {
  return Array.isArray(result);
}

function isDcSimulationResult(result: SimulationDispatchResult): result is DcSimulationResult {
  return !Array.isArray(result)
    && ("nodeVoltages" in result || "node_voltages" in result);
}
