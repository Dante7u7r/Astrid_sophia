import type { CanvasOrchestrator } from "../canvas_orchestrator";
import type { CircuitStateManager } from "../simulation/circuit_state_manager";
import { isTauriEnvironment } from "../simulation/tauri_mock";
import type {
  SimulationRunner,
  SimulationRunnerCallbacks,
} from "../simulation/simulation_runner";
import type { OscilloscopePanel } from "../ui/oscilloscope_panel";
import { TelemetryPanel } from "../ui/telemetry_panel";
import type { TabManager } from "../ui/tab_manager";

export interface InteractiveSimulationCallbackDependencies {
  getTabManager(): TabManager | null;
  getOrchestrator(): CanvasOrchestrator | null;
  getOscilloscopePanel(): OscilloscopePanel | null;
  getSimulationRunner(): SimulationRunner | null;
  circuitState: CircuitStateManager;
  setSimulationRunning(active: boolean): void;
  onSolverResult?(solver: "rust" | "typescript"): void;
  updateCanvasRendering(): void;
  updateOscilloscopeRendering(): void;
  addLog(text: string, type?: "system" | "send" | "receive" | "error"): void;
}

export function createInteractiveSimulationCallbacks(
  dependencies: InteractiveSimulationCallbackDependencies,
): SimulationRunnerCallbacks {
  return {
    onFrameReceived: (frame, context) => {
      const tabManager = dependencies.getTabManager();
      const ownerTab = tabManager?.appendTransientFrameToTab(context.ownerTabId, frame);
      if (!ownerTab) return;

      if (!tabManager?.isActiveTab(context.ownerTabId)) return;
      dependencies.onSolverResult?.(isTauriEnvironment() ? "rust" : "typescript");
      dependencies.circuitState.setVoltagesFromFrame(frame);

      const oscilloscopePanel = dependencies.getOscilloscopePanel();
      if (oscilloscopePanel) {
        oscilloscopePanel.transientResults = ownerTab.transientResults;
        dependencies.updateOscilloscopeRendering();
      }

      const orchestrator = dependencies.getOrchestrator();
      if (orchestrator) {
        orchestrator.transientResults = ownerTab.transientResults;
      }

      dependencies.updateCanvasRendering();

      if (frame.isFinal) {
        const orchestrator = dependencies.getOrchestrator();
        if (oscilloscopePanel && orchestrator) {
          dependencies.circuitState.actuatorHistory.precompute(
            orchestrator.components,
            oscilloscopePanel.transientResults,
            { ...dependencies.circuitState.getPinToNodeMap() },
          );
        }
      }
    },
    onSimulationError: (error, context) => {
      dependencies.addLog(
        `Error en simulacion [${context.ownerTabId}]: ${error}`,
        "error",
      );
      TelemetryPanel.logError(`Error en simulacion transitoria: ${error}`);
    },
    onSimulationComplete: (finalTime, context) => {
      dependencies.addLog(
        `Simulacion [${context.ownerTabId}] completada en t = ${finalTime.toFixed(6)} s.`,
        "receive",
      );
    },
    onSimulationStateChanged: (active, context) => {
      const tabManager = dependencies.getTabManager();
      dependencies.setSimulationRunning(active);
      if (!tabManager?.isActiveTab(context.ownerTabId)) return;

      const orchestrator = dependencies.getOrchestrator();
      if (orchestrator) orchestrator.simulationActive = active;
      if (!active) dependencies.getOscilloscopePanel()?.finish();
    },
  };
}
