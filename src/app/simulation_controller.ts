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
  StabilityAnalysisResult,
  SimulationDispatchResult,
} from "../simulation/tauri_commands";
import type { AcSweepResult, TimeStepResult } from "../ui/oscilloscope_panel";
import type { OscilloscopePanel } from "../ui/oscilloscope_panel";
import type { InstrumentsDock } from "../ui/instruments_dock";
import type { AnalysisMode, SimulationControlHandlers } from "../ui/simulation_controls";
import {
  DEFAULT_TRANSIENT_DURATION_SECONDS,
  type SimulationSettings,
} from "../ui/settings_modal";
import { parseErcIssues } from "../ui/instrumentation_menu";
import { DiagnosticModal, type DiagnosticIssue } from "../ui/diagnostic_modal";
import { ExperimentalWarningModal } from "../ui/experimental_warning_modal";
import { TelemetryPanel } from "../ui/telemetry_panel";
import {
  beginFeedbackRun,
  failFeedbackRun,
  recordCircuitSummary,
  recordErc,
  type FeedbackRunHandle,
} from "../feedback/instrumentation";
import { evaluateSimulationAdvice } from "../intelligence/advisor_runtime";

export interface SimulationControllerDependencies {
  getOrchestrator(): CanvasOrchestrator | null;
  getOscilloscopePanel(): OscilloscopePanel | null;
  getInstrumentsDock?(): InstrumentsDock | null;
  getSimulationRunner(): SimulationRunner | null;
  getSimulationSettings(): SimulationSettings;
  setSimulationSettings?(settings: SimulationSettings): void;
  setSimulationRunning(running: boolean): void;
  setSimulationPaused?(paused: boolean): void;
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
  runSparamExport(netlist: CircuitNetlist, feedbackRun?: FeedbackRunHandle): Promise<void>;
  circuitState: CircuitStateManager;
  resetPerformanceCaches(): void;
  updateCanvasRendering(): void;
  updateOscilloscopeRendering(): void;
  setIpcStatus(text: string, color: string): void;
  onSolverResult?(solver: "rust" | "typescript" | "mock"): void;
  addLog(text: string, type?: "system" | "send" | "receive" | "error"): void;
}

const ANALYSIS_LABELS: Record<AnalysisMode, string> = {
  DC: "Corriente Continua",
  AC: "Barrido CA",
  TRAN: "Transitorio",
  SENS: "Sensibilidad",
  PSS: "PSS experimental",
  STB: "Polos y ceros experimentales",
  PVT: "PVT Corner Analysis",
  SPAR: "Parámetros S",
};

export class SimulationController {
  constructor(private readonly dependencies: SimulationControllerDependencies) {}

  updateSimulationSettings(partial: Partial<SimulationSettings>): void {
    const current = this.dependencies.getSimulationSettings();
    Object.assign(current, partial);
    this.dependencies.setSimulationSettings?.(current);
  }

  createControlHandlers(): SimulationControlHandlers {
    return {
      onRunSimulation: async (_netlist, mode) => this.runSimulation(mode),
      onStopSimulation: async () => this.stopSimulation(),
      onPauseSimulation: async () => this.pauseSimulation(),
      onResumeSimulation: async () => this.resumeSimulation(),
      setActiveAnalysisMode: (mode) => this.setActiveAnalysisMode(mode),
      addLog: (text, type) => this.dependencies.addLog(text, type),
      updateCanvasRendering: () => this.dependencies.updateCanvasRendering(),
    };
  }

  async runSimulation(mode: AnalysisMode): Promise<void> {
    const orchestrator = this.dependencies.getOrchestrator();
    const simulationSettings = this.dependencies.getSimulationSettings();
    const isContinuousTransient = mode === "TRAN" && (!simulationSettings.transientDuration || simulationSettings.transientDuration <= 0);
    const transientDuration = isContinuousTransient
      ? 0
      : (simulationSettings.transientDuration ?? DEFAULT_TRANSIENT_DURATION_SECONDS);
    this.dependencies.addLog(
      `Iniciando simulación física de análisis [${ANALYSIS_LABELS[mode]}]...`,
      "system",
    );

    if (!orchestrator || orchestrator.components.length === 0) {
      const emptyRun = beginFeedbackRun({
        analysis: mode,
        workspaceId: this.dependencies.getActiveTabId(),
        settings: simulationSettings,
      });
      failFeedbackRun(emptyRun, "Empty schematic", "preflight", "SCHEMATIC_EMPTY");
      this.dependencies.addLog("Error: El lienzo está vacío. Coloca componentes antes de simular.", "error");
      this.dependencies.setSimulationRunning(false);
      return;
    }

    const netlist = this.dependencies.extractNetlist(true);
    if (!netlist) {
      const extractionRun = beginFeedbackRun({
        analysis: mode,
        workspaceId: this.dependencies.getActiveTabId(),
        settings: simulationSettings,
      });
      failFeedbackRun(extractionRun, "Netlist extraction failed", "extraction", "NETLIST_EXTRACTION_FAILED");
      this.dependencies.setSimulationRunning(false);
      return;
    }

    const feedbackRun = mode === "PVT" ? undefined : beginFeedbackRun({
      analysis: mode,
      workspaceId: this.dependencies.getActiveTabId(),
      netlist,
      settings: simulationSettings,
      ...(mode === "TRAN" && transientDuration > 0
        ? { requestedPointCount: Math.ceil(transientDuration / simulationSettings.dt) + 1 }
        : {}),
    });
    if (feedbackRun) {
      recordCircuitSummary(feedbackRun, netlist, orchestrator.wires.length);
    }

    const hasBsim = netlist.components.some(component =>
      component.type === "bsim3nmos"
      || component.type === "bsim3pmos"
      || component.type === "bsim4nmos"
      || component.type === "bsim4pmos"
    );
    const isExperimental = mode === "PSS" || mode === "STB" || hasBsim;
    if (isExperimental && !simulationSettings.enableExperimentalPhysics) {
      const featureName = mode === "PSS"
        ? "Análisis PSS (Periodic Steady State)"
        : mode === "STB"
          ? "Análisis de Estabilidad (Polos y Ceros STB)"
          : "Modelos de Transistor BSIM3/4";

      this.dependencies.setSimulationRunning(false);
      this.dependencies.addLog(
        `⛔ ${featureName} bloqueado: requiere confirmación explícita de física experimental.`,
        "error",
      );

      ExperimentalWarningModal.show({
        featureName,
        onConfirm: () => {
          const updatedSettings: SimulationSettings = {
            ...simulationSettings,
            enableExperimentalPhysics: true,
          };
          this.dependencies.setSimulationSettings?.(updatedSettings);
          window.dispatchEvent(
            new CustomEvent("astryd-settings-synchronized", { detail: updatedSettings }),
          );
          this.dependencies.addLog("Flag de física experimental activado.", "system");
          void this.runSimulation(mode);
        },
        onCancel: () => {
          this.dependencies.setSimulationRunning(false);
        },
      });
      return;
    }

    if (netlist.components.some(component =>
      component.type === "mcu_8051" || component.type === "mcu_avr"
    )) {
      this.dependencies.addLog(
        "MCU EXPERIMENTAL: el runtime no ejecuta la ISA, registros, memoria, interrupciones ni periféricos completos. No es cycle-accurate.",
        "error",
      );
    }
    if (netlist.components.some(component =>
      component.type === "arduino_uno"
      || component.type === "esp32"
      || component.type === "raspberry_pi_pico"
    )) {
      this.dependencies.addLog(
        "MCU DE PLACA: se usa un modelo funcional analógico de alto nivel; no se ejecuta firmware real.",
        "error",
      );
    }
    if (hasBsim) {
      this.dependencies.addLog(
        "BSIM EXPERIMENTAL: implementación parcial. El reporte versionado registra 5/5 puntos DC de NMOS BSIM3 frente a ngspice dentro de tolerancia (VGS=0.8–1.6 V, VDS=1 V, W=10 µm, L=0.18 µm, 27 °C), con errores relativos de corriente de 1.27 % a 6.89 % y tolerancia relativa del 25 %. Esto no certifica BSIM completo ni BSIM4; no usar como validación general para predicción física. Referencia: validation/reports/bsim-characterization.md.",
        "error",
      );
    }

    const ercStartedAt = performance.now();
    const ercResult = runElectricalRuleCheck(
      netlist,
      orchestrator.components,
      orchestrator.wires,
      component => orchestrator.getComponentPins(component),
    );
    recordErc(feedbackRun, ercResult, performance.now() - ercStartedAt);
    evaluateSimulationAdvice({
      analysis: mode,
      netlist,
      erc: ercResult,
      settings: simulationSettings,
      transientDuration,
      feedbackRun,
    });
    for (const warn of ercResult.warnings) {
      this.dependencies.addLog(`[ERC Advertencia] ${warn}`, "error");
    }

    orchestrator.ercIssues = parseErcIssues(ercResult.warnings, ercResult.errors);
    orchestrator.render();

    if (!ercResult.passed) {
      if (feedbackRun) failFeedbackRun(feedbackRun, ercResult.errors, "preflight", "ERC_FAILED");
      this.dependencies.addLog("----------------------------------------------------------------", "error");
      this.dependencies.addLog("¡ERC FALLIDO! La simulación se ha abortado para prevenir bloqueos matemáticos:", "error");
      for (const err of ercResult.errors) {
        this.dependencies.addLog(`▶ [ERC Error] ${err}`, "error");
      }
      this.dependencies.addLog("Corrige estos errores topológicos en el lienzo para poder simular.", "error");
      this.dependencies.addLog("----------------------------------------------------------------", "error");
      this.dependencies.setSimulationRunning(false);

      const diagnosticIssues: DiagnosticIssue[] = [];
      for (const err of ercResult.errors) {
        const compMatch = err.match(/\[([a-zA-Z0-9_,\s]+)\]/);
        const compId = compMatch ? compMatch[1].split(",")[0].trim() : undefined;
        let remedy = "Revisa las conexiones de este componente.";
        if (err.toLowerCase().includes("tierra") || err.toLowerCase().includes("ground") || err.toLowerCase().includes("nodo 0")) {
          remedy = "Añade un símbolo de Tierra (GND) y conéctalo al polo negativo del circuito.";
        } else if (err.toLowerCase().includes("cortocircuito")) {
          remedy = "Elimina el cable que une los dos terminales de la misma fuente.";
        } else if (err.toLowerCase().includes("flotante")) {
          remedy = "Conecta este terminal a un cable o elimina el componente si no lo necesitas.";
        }

        diagnosticIssues.push({
          id: `erc-err-${diagnosticIssues.length}`,
          severity: "error",
          title: "Inconsistencia Topológica (ERC)",
          message: err,
          remedy,
          componentId: compId,
        });
      }

      for (const warn of ercResult.warnings) {
        const compMatch = warn.match(/\[([a-zA-Z0-9_]+)\]/);
        const compId = compMatch ? compMatch[1] : undefined;
        const pinMatch = warn.match(/terminal index (\d+)/);
        const pinIdx = pinMatch ? parseInt(pinMatch[1], 10) : undefined;
        diagnosticIssues.push({
          id: `erc-warn-${diagnosticIssues.length}`,
          severity: "warning",
          title: "Advertencia Eléctrica",
          message: warn,
          remedy: "Verifica si este terminal requiere conexión en tu diseño.",
          componentId: compId,
          pinIndex: pinIdx,
        });
      }

      DiagnosticModal.show({
        title: "Chequeo Eléctrico (ERC) Fallido",
        subtitle: "Se encontraron problemas topológicos que impiden resolver las ecuaciones del circuito:",
        issues: diagnosticIssues,
        onFocusComponent: (componentId) => {
          orchestrator.focusComponent(componentId);
          this.dependencies.updateCanvasRendering();
        },
        onOpenSettings: () => {
          const settingsBtn = document.querySelector("#settings-trigger-btn") as HTMLButtonElement | null;
          settingsBtn?.click();
        },
      });

      TelemetryPanel.showToast("La simulación no pudo iniciar por errores en el circuito.", "error", {
        title: "Chequeo ERC Fallido",
        durationMs: 8000,
        actions: [
          {
            label: "Ver Diagnóstico Completo",
            primary: true,
            onClick: () => {
              DiagnosticModal.show({
                title: "Chequeo Eléctrico (ERC) Fallido",
                subtitle: "Problemas detectados en el esquema:",
                issues: diagnosticIssues,
                onFocusComponent: (componentId) => {
                  orchestrator.focusComponent(componentId);
                  this.dependencies.updateCanvasRendering();
                },
              });
            },
          },
        ],
      });

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
      if (feedbackRun) failFeedbackRun(feedbackRun, "No active workspace", "preflight", "WORKSPACE_MISSING");
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

    this.dependencies.setSimulationRunning(true);
    await dispatchSimulation(netlist, mode, {
      simSettings: simulationSettings,
      transientDuration,
      simulationOwnerId,
      simulationRunner: this.dependencies.getSimulationRunner(),
      feedbackRun,
      solveCircuitTS,
      solveTransientCircuitLocal: this.dependencies.solveTransientCircuitLocal,
      onSpecialMode: async (specialNetlist, specialMode) => {
        if (specialMode === "PVT") await this.dependencies.runPvtAnalysis(specialNetlist);
        if (specialMode === "SPAR") {
          await this.dependencies.runSparamExport(specialNetlist, feedbackRun);
        }
      },
    }, {
      addLog: (text, type) => this.dependencies.addLog(text, type),
      onResultsReady: (resultMode, results) => this.applyResults(resultMode, results),
      onSolverResult: (solver) => this.dependencies.onSolverResult?.(solver),
      onIpcStatusUpdate: (text, color) => this.dependencies.setIpcStatus(text, color),
      updateCanvasRendering: () => this.dependencies.updateCanvasRendering(),
      onSimulationFinished: () => this.dependencies.setSimulationRunning(false),
      onHighlightElement: (id) => this.highlightElement(id),
    });
  }

  async pauseSimulation(): Promise<void> {
    this.dependencies.addLog("Pausando simulación física interactiva.", "system");
    await this.dependencies.getSimulationRunner()?.pauseInteractiveTransient();
    this.dependencies.circuitState.audioOrchestrator.stopAll();
    this.dependencies.getOscilloscopePanel()?.pause();
    this.dependencies.setSimulationPaused?.(true);
    this.dependencies.updateCanvasRendering();
    this.dependencies.updateOscilloscopeRendering();
  }

  async resumeSimulation(): Promise<void> {
    this.dependencies.addLog("Reanudando simulación física interactiva.", "system");
    await this.dependencies.getSimulationRunner()?.resumeInteractiveTransient();
    this.dependencies.getOscilloscopePanel()?.resume();
    this.dependencies.setSimulationPaused?.(false);
    this.dependencies.updateCanvasRendering();
    this.dependencies.updateOscilloscopeRendering();
  }

  async stopSimulation(): Promise<void> {
    this.dependencies.addLog("Deteniendo simulación física del circuito.", "system");
    clearPendingTimeouts();
    await this.dependencies.getSimulationRunner()?.stopInteractiveTransient();
    this.dependencies.circuitState.audioOrchestrator.stopAll();
    this.dependencies.getOscilloscopePanel()?.stop();
    this.dependencies.circuitState.resetAll();
    const orchestrator = this.dependencies.getOrchestrator();
    if (orchestrator) {
      for (const comp of orchestrator.components) {
        comp.glowLevel = 0;
      }
    }
    // También invalida cualquier reproducción visual de resultados ya
    // calculados; «Detener» debe dejar el lienzo inmediatamente en reposo.
    this.dependencies.resetPerformanceCaches();
    this.dependencies.setSimulationPaused?.(false);
    this.dependencies.setSimulationRunning(false);
    this.dependencies.updateCanvasRendering();
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
    const dock = this.dependencies.getInstrumentsDock ? this.dependencies.getInstrumentsDock() : null;

    if (mode === "AC") {
      if (oscilloscopePanel && isAcSweepResult(results)) {
        oscilloscopePanel.acSweepResults = results;
      }
      if (dock?.bodeAnalyzer && isAcSweepResult(results)) {
        dock.bodeAnalyzer.setAcSweepResult(results);
        dock.switchTab("bode");
      }
    } else if (mode === "SENS") {
      if (isSensitivityAnalysisResult(results)) {
        this.dependencies.circuitState.setVoltagesFromSnapshot(results.nominalVoltages ?? {});
        if (dock?.bodeAnalyzer) {
          dock.bodeAnalyzer.setSensitivityResult(results);
          dock.switchTab("bode");
        }
      }
    } else if (mode === "STB") {
      if (isStabilityAnalysisResult(results)) {
        if (dock?.bodeAnalyzer) {
          dock.bodeAnalyzer.setStabilityResult(results);
          dock.switchTab("bode");
        }
      }
    } else if (mode === "PSS") {
      const pssResults = isPssSimulationResult(results) ? results : [];
      if (oscilloscopePanel) oscilloscopePanel.transientResults = pssResults;
      const transientResults = oscilloscopePanel ? oscilloscopePanel.transientResults : [];
      if (transientResults.length > 0) {
        const lastStep = transientResults[transientResults.length - 1];
        this.dependencies.circuitState.setVoltagesFromSnapshot(lastStep.nodeVoltages, lastStep.branchCurrents ?? {});
      }
    } else if (mode === "TRAN" && Array.isArray(results)) {
      if (oscilloscopePanel) oscilloscopePanel.transientResults = results;
      if (results.length > 0) {
        const lastStep = results[results.length - 1];
        this.dependencies.circuitState.setVoltagesFromSnapshot(lastStep.nodeVoltages, lastStep.branchCurrents ?? {});
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
      this.dependencies.circuitState.setVoltagesFromSnapshot(dcResults.nodeVoltages ?? {}, dcResults.branchCurrents ?? {});
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

function isStabilityAnalysisResult(
  result: SimulationDispatchResult,
): result is StabilityAnalysisResult {
  return !Array.isArray(result)
    && "isStable" in result
    && "poles" in result;
}

function isPssSimulationResult(result: SimulationDispatchResult): result is PssSimulationResult {
  return Array.isArray(result);
}

function isDcSimulationResult(result: SimulationDispatchResult): result is DcSimulationResult {
  return !Array.isArray(result)
    && ("nodeVoltages" in result || "node_voltages" in result);
}
