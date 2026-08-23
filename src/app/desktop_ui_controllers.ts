import type { CanvasOrchestrator } from "../canvas_orchestrator";
import type { CircuitStateManager } from "../simulation/circuit_state_manager";
import type { CircuitNetlist } from "../simulation/netlist_extractor";
import { runElectricalRuleCheck } from "../simulation/simulation_dispatcher";
import { McuDebugPanel } from "../ui/mcu_debug_panel";
import { OscilloscopePanel } from "../ui/oscilloscope_panel";
import { TelemetryPanel } from "../ui/telemetry_panel";
import { initInstrumentationMenu, parseErcIssues } from "../ui/instrumentation_menu";
import type { InstrumentsDock } from "../ui/instruments_dock";
import type { PanelLayoutManager } from "../ui/panel_layout_manager";
import type { SidePanelController } from "../ui/side_panel_controller";
import type { ProbePlacementController } from "./probe_placement_controller";
import { createRenderController, type RenderController } from "./render_controller";
import type { PerformanceMonitor } from "../performance/performance_monitor";
import type { VisualAuditConfig } from "../testing/visual_audit_config";

type LogType = "system" | "send" | "receive" | "error";

export interface DesktopUiControllers {
  telemetryPanel: TelemetryPanel;
  renderController: RenderController;
  oscilloscopePanel: OscilloscopePanel;
  mcuDebugPanel: McuDebugPanel | null;
}

export interface DesktopUiControllerDeps {
  visualAudit: VisualAuditConfig;
  performanceMonitor: PerformanceMonitor;
  circuitState: CircuitStateManager;
  probePlacementController: ProbePlacementController;
  getOrchestrator(): CanvasOrchestrator | null;
  getPanelLayoutManager(): PanelLayoutManager | null;
  getInstrumentsDock(): InstrumentsDock | null;
  getFloatingInstrumentManager?(): import("../ui/floating_instrument_manager").FloatingInstrumentManager | null;
  getSidePanelController(): SidePanelController | null;
  getSparPorts(): { nodeId: string; z0: number }[];
  extractNetlist(reportErrors?: boolean): CircuitNetlist | null;
  updateCanvasRendering(immediate?: boolean): void;
  updateOscilloscopeRendering(immediate?: boolean): void;
  addLog(text: string, type?: LogType): void;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  now(): number;
  getSimulationRunner?(): import("../simulation/simulation_runner").SimulationRunner | null;
  getSimulationSettings?(): import("../ui/settings_modal").SimulationSettings;
  setSimulationSettings?(settings: import("../ui/settings_modal").SimulationSettings): void;
}

export function createDesktopUiControllers(
  deps: DesktopUiControllerDeps,
): DesktopUiControllers {
  let mcuDebugPanel: McuDebugPanel | null = null;
  const oscilloscopePanel = new OscilloscopePanel();
  const renderController = createRenderController({
    getOrchestrator: deps.getOrchestrator,
    getOscilloscopePanel: () => oscilloscopePanel,
    getInstrumentsDock: deps.getInstrumentsDock,
    getProbeFallbacks: () => deps.probePlacementController.getNodes(),
    getSparPorts: deps.getSparPorts,
    updateMcuDebugPanel: () => mcuDebugPanel?.updateData(),
    circuitState: deps.circuitState,
    performanceMonitor: deps.performanceMonitor,
    isVisualAuditStep: (step) => deps.visualAudit.isStep(step),
    requestAnimationFrame: deps.requestAnimationFrame,
    now: deps.now,
  });

  window.addEventListener("panel-layout-change", () => {
    deps.updateOscilloscopeRendering();
  });
  oscilloscopePanel.onFrameUpdate = (sweepTime) => {
    renderController.handlePlaybackFrame(sweepTime);
  };
  oscilloscopePanel.onSpeedChanged = (speed) => {
    deps.getSimulationRunner?.()?.setSimulationSpeed(speed);
    const current = deps.getSimulationSettings?.();
    if (current) {
      deps.setSimulationSettings?.({ ...current, speedMultiplier: speed });
    }
    const orch = deps.getOrchestrator?.();
    if (orch) {
      orch.currentAnimationSpeed = speed;
      deps.updateCanvasRendering();
    }
  };

  initInstrumentationMenu({
    toggleLeftPanel: () => deps.getSidePanelController()?.toggleSidePanel("left"),
    toggleRightPanel: () => deps.getSidePanelController()?.toggleSidePanel("right"),
    toggleInstrumentCenter: () => deps.getPanelLayoutManager()?.togglePanel("dock"),
    openInstrument: (tabId) => {
      deps.getFloatingInstrumentManager?.()?.popOut(tabId);
    },
    runErc: () => {
      const netlist = deps.extractNetlist(true);
      const orchestrator = deps.getOrchestrator();
      if (!netlist || !orchestrator) return null;

      const result = runElectricalRuleCheck(
        netlist,
        orchestrator.components,
        orchestrator.wires,
        (component) => orchestrator.getComponentPins(component),
      );
      const issues = parseErcIssues(result.warnings, result.errors);
      orchestrator.ercIssues = issues;
      orchestrator.render();
      return { ...result, issues };
    },
    openSettings: () => {
      const trigger = document.querySelector<HTMLButtonElement>("#settings-trigger-btn");
      if (trigger) {
        trigger.focus();
        trigger.click();
      }
    },
    addLog: deps.addLog,
  });

  const rightPanelBody = document.querySelector<HTMLElement>("#sidebar-right .panel-body");
  if (rightPanelBody) {
    mcuDebugPanel = new McuDebugPanel(rightPanelBody, () => {
      deps.updateCanvasRendering();
    });
  }

  const telemetryPanel = new TelemetryPanel(() => deps.performanceMonitor.snapshot());
  if (!deps.visualAudit.enabled) {
    telemetryPanel.start();
  }

  return {
    telemetryPanel,
    renderController,
    oscilloscopePanel,
    mcuDebugPanel,
  };
}
