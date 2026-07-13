import { describe, expect, it, vi } from "vitest";
import type { CanvasOrchestrator } from "../canvas_orchestrator";
import { createCircuitStateManager } from "../simulation/circuit_state_manager";
import type { SimulationFrame } from "../simulation/simulation_runner";
import type { OscilloscopePanel } from "../ui/oscilloscope_panel";
import type { Tab, TabManager } from "../ui/tab_manager";
import { createInteractiveSimulationCallbacks } from "./interactive_simulation_callbacks";

function createFrame(overrides: Partial<SimulationFrame> = {}): SimulationFrame {
  return {
    runId: 1,
    time: 0.01,
    nodeVoltages: { "1": 5 },
    branchCurrents: { V1: 0.02 },
    frameIndex: 1,
    isFinal: false,
    triggerEvent: null,
    ...overrides,
  };
}

describe("createInteractiveSimulationCallbacks", () => {
  it("aplica un frame de la pestana activa al estado, osciloscopio y render", () => {
    const circuitState = createCircuitStateManager();
    const transientResults = [
      { time: 0.01, nodeVoltages: { "1": 5 }, branchCurrents: { V1: 0.02 } },
    ];
    const ownerTab = { id: "tab-1", transientResults } as Tab;
    const tabManager = {
      appendTransientFrameToTab: vi.fn(() => ownerTab),
      isActiveTab: vi.fn(() => true),
    } as unknown as TabManager;
    const oscilloscopePanel = { transientResults: [] } as unknown as OscilloscopePanel;
    const callbacks = createInteractiveSimulationCallbacks({
      getTabManager: () => tabManager,
      getOrchestrator: () => ({ components: [] }) as unknown as CanvasOrchestrator,
      getOscilloscopePanel: () => oscilloscopePanel,
      getSimulationRunner: () => null,
      circuitState,
      setSimulationRunning: vi.fn(),
      updateCanvasRendering: vi.fn(),
      updateOscilloscopeRendering: vi.fn(),
      addLog: vi.fn(),
    });

    callbacks.onFrameReceived(createFrame(), { runId: 1, ownerTabId: "tab-1" });

    expect(tabManager.appendTransientFrameToTab).toHaveBeenCalledWith(
      "tab-1",
      expect.objectContaining({ time: 0.01 }),
    );
    expect(circuitState.getVoltageMap()).toEqual({ "1": 5 });
    expect(oscilloscopePanel.transientResults).toBe(transientResults);
  });

  it("ignora errores y frames de pestanas inactivas", () => {
    const circuitState = createCircuitStateManager();
    const tabManager = {
      appendTransientFrameToTab: vi.fn(() => ({
        id: "tab-1",
        transientResults: [],
      })),
      isActiveTab: vi.fn(() => false),
    } as unknown as TabManager;
    const addLog = vi.fn();
    const updateCanvasRendering = vi.fn();
    const callbacks = createInteractiveSimulationCallbacks({
      getTabManager: () => tabManager,
      getOrchestrator: () => null,
      getOscilloscopePanel: () => null,
      getSimulationRunner: () => ({ stopInteractiveTransient: vi.fn() }) as any,
      circuitState,
      setSimulationRunning: vi.fn(),
      updateCanvasRendering,
      updateOscilloscopeRendering: vi.fn(),
      addLog,
    });

    callbacks.onFrameReceived(createFrame(), { runId: 1, ownerTabId: "tab-1" });
    callbacks.onSimulationError("boom", { runId: 1, ownerTabId: "tab-1" });

    expect(circuitState.getVoltageMap()).toEqual({});
    expect(updateCanvasRendering).not.toHaveBeenCalled();
    expect(addLog).not.toHaveBeenCalled();
  });
});
