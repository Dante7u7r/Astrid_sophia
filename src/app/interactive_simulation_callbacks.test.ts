import { describe, expect, it, vi } from "vitest";
import type { CanvasOrchestrator } from "../canvas_orchestrator";
import { createCircuitStateManager } from "../simulation/circuit_state_manager";
import type { SimulationFrame } from "../simulation/simulation_runner";
import type { OscilloscopePanel } from "../ui/oscilloscope_panel";
import type { Tab, TabManager } from "../ui/tab_manager";
import { createInteractiveSimulationCallbacks } from "./interactive_simulation_callbacks";

const isNative = vi.hoisted(() => vi.fn(() => true));
vi.mock("../simulation/tauri_mock", () => ({ isTauriEnvironment: isNative }));

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
  it.each([true, false])("aplica el frame de la pestaña activa e identifica su procedencia (nativo=%s)", (native) => {
    isNative.mockReturnValue(native);
    const onSolverResult = vi.fn();
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
      onSolverResult,
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
    expect(onSolverResult).toHaveBeenCalledWith(native ? "rust" : "typescript");
  });

  it("ignora el render de frames inactivos pero registra sus errores", () => {
    const onSolverResult = vi.fn();
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
      onSolverResult,
      updateCanvasRendering,
      updateOscilloscopeRendering: vi.fn(),
      addLog,
    });

    callbacks.onFrameReceived(createFrame(), { runId: 1, ownerTabId: "tab-1" });
    callbacks.onSimulationError("boom", { runId: 1, ownerTabId: "tab-1" });

    expect(circuitState.getVoltageMap()).toEqual({});
    expect(updateCanvasRendering).not.toHaveBeenCalled();
    expect(onSolverResult).not.toHaveBeenCalled();
    expect(addLog).toHaveBeenCalledWith(
      expect.stringContaining("Error en simulacion [tab-1]: boom"),
      "error",
    );
  });

  it("finaliza el estado visual al recibir el final del transitorio", () => {
    const circuitState = createCircuitStateManager();
    const setSimulationRunning = vi.fn();
    const ownerTab = {
      id: "tab-1",
      transientResults: [
        { time: 0.01, nodeVoltages: { "1": 5 }, branchCurrents: { V1: 0.02 } },
      ],
    } as Tab;
    const tabManager = {
      appendTransientFrameToTab: vi.fn(() => ownerTab),
      isActiveTab: vi.fn(() => true),
    } as unknown as TabManager;
    const oscilloscopePanel = {
      transientResults: ownerTab.transientResults,
      finish: vi.fn(),
    } as unknown as OscilloscopePanel;
    const callbacks = createInteractiveSimulationCallbacks({
      getTabManager: () => tabManager,
      getOrchestrator: () => ({ components: [] }) as unknown as CanvasOrchestrator,
      getOscilloscopePanel: () => oscilloscopePanel,
      getSimulationRunner: () => null,
      circuitState,
      setSimulationRunning,
      updateCanvasRendering: vi.fn(),
      updateOscilloscopeRendering: vi.fn(),
      addLog: vi.fn(),
    });

    callbacks.onFrameReceived(createFrame({ isFinal: true }), { runId: 1, ownerTabId: "tab-1" });
    callbacks.onSimulationStateChanged(false, { runId: 1, ownerTabId: "tab-1" });

    expect(oscilloscopePanel.finish).toHaveBeenCalledOnce();
    expect(setSimulationRunning).toHaveBeenCalledWith(false);
  });
});
