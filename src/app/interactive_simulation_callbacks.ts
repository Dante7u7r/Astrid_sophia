import type { CanvasOrchestrator } from "../canvas_orchestrator";
import type { CircuitStateManager } from "../simulation/circuit_state_manager";
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
      dependencies.circuitState.setVoltagesFromFrame(frame);

      const oscilloscopePanel = dependencies.getOscilloscopePanel();
      if (oscilloscopePanel) {
        oscilloscopePanel.transientResults = ownerTab.transientResults;
        dependencies.updateOscilloscopeRendering();
      }

      dependencies.updateCanvasRendering();

      if (frame.isFinal) {
        dependencies.addLog(
          `Simulacion interactiva completada en t = ${frame.time.toFixed(6)} s.`,
          "receive",
        );
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
      const tabManager = dependencies.getTabManager();
      if (!tabManager?.isActiveTab(context.ownerTabId)) return;

      dependencies.addLog(`Error en simulacion: ${error}`, "error");
      void dependencies.getSimulationRunner()?.stopInteractiveTransient();
      TelemetryPanel.logError(`Error en simulacion transitoria: ${error}`);
    },
    onSimulationComplete: (finalTime, context) => {
      const tabManager = dependencies.getTabManager();
      if (!tabManager?.isActiveTab(context.ownerTabId)) return;

      dependencies.addLog(
        `Simulacion completada en t = ${finalTime.toFixed(6)} s.`,
        "receive",
      );
    },
    onSimulationStateChanged: (active, context) => {
      const tabManager = dependencies.getTabManager();
      if (!tabManager?.isActiveTab(context.ownerTabId)) return;

      const orchestrator = dependencies.getOrchestrator();
      if (orchestrator) orchestrator.simulationActive = active;
      dependencies.setSimulationRunning(active);
    },
  };
}
