import { describe, expect, it, vi } from "vitest";
import type { CanvasOrchestrator } from "../canvas_orchestrator";
import { createDefaultOscilloscopeState } from "../persistence/circuit_file";
import type { OscilloscopePanel, TimeStepResult } from "./oscilloscope_panel";
import {
  captureRuntimeIntoTab,
  createWorkspaceTab,
  restoreTabIntoRuntime,
} from "./workspace_state";

function createRuntime() {
  const orchestrator = {
    components: [
      { id: "R1", type: "resistor", value: "1k", x: 10, y: 20, rotation: 0 },
    ],
    wires: [],
    zoom: 1.5,
    offsetX: 40,
    offsetY: 50,
    selectedComponent: { id: "R1" },
    selectedComponents: [{ id: "R1" }],
    selectedWire: { id: "w1" },
    activePinForWire: { componentId: "R1", pinIndex: 0 },
    tempWireEnd: { x: 1, y: 2 },
    selectionStart: { x: 0, y: 0 },
    selectionEnd: { x: 1, y: 1 },
  } as unknown as CanvasOrchestrator;

  const transientResults: TimeStepResult[] = [
    { time: 0.001, nodeVoltages: { "1": 5 }, branchCurrents: {} },
  ];
  const oscilloscopeState = {
    ...createDefaultOscilloscopeState(),
    timeDivValue: 0.005,
  };
  const oscilloscopePanel = {
    activeAnalysisMode: "DC",
    ch1ProbeNode: "1",
    ch2ProbeNode: "2",
    ch3ProbeNode: "3",
    ch4ProbeNode: "4",
    transientResults,
    acSweepResults: null,
    sweepTime: 0.4,
    pvtMode: true,
    pvtTraces: [],
    sparResult: null,
    sparCh1Index: 0,
    sparCh2Index: 1,
    getPersistentState: vi.fn(() => oscilloscopeState),
    applyPersistentState: vi.fn(),
  } as unknown as OscilloscopePanel;

  return { orchestrator, oscilloscopePanel, transientResults, oscilloscopeState };
}

describe("workspace_state", () => {
  it("crea una pestana con defaults de workspace", () => {
    const tab = createWorkspaceTab("tab-1", "Circuito 1");

    expect(tab.name).toBe("Circuito 1");
    expect(tab.zoom).toBe(1);
    expect(tab.ch1ProbeNode).toBe("1");
    expect(tab.activeAnalysisMode).toBe("DC");
  });

  it("captura estado runtime en una pestana", () => {
    const tab = createWorkspaceTab("tab-1", "Circuito 1");
    const runtime = createRuntime();

    captureRuntimeIntoTab(tab, {
      orchestrator: runtime.orchestrator,
      oscilloscopePanel: runtime.oscilloscopePanel,
      activeAnalysisMode: "PVT",
      probes: { ch1: "7", ch2: "8", ch3: "9", ch4: "10" },
      sparPorts: [{ nodeId: "7", z0: 50 }],
      voltageSnapshot: { "7": 3.3 },
    });

    expect(tab.components).toEqual(runtime.orchestrator.components);
    expect(tab.zoom).toBe(1.5);
    expect(tab.activeAnalysisMode).toBe("PVT");
    expect(tab.ch1ProbeNode).toBe("7");
    expect(tab.sparPorts).toEqual([{ nodeId: "7", z0: 50 }]);
    expect(tab.voltageSnapshot).toEqual({ "7": 3.3 });
    expect(tab.transientResults).toBe(runtime.transientResults);
    expect(tab.oscilloscopeState.timeDivValue).toBe(0.005);
  });

  it("restaura una pestana en runtime y limpia seleccion del canvas", () => {
    const tab = createWorkspaceTab("tab-1", "Circuito 1");
    tab.components = [
      { id: "C1", type: "capacitor", value: "1u", x: 100, y: 120, rotation: 0 },
    ];
    tab.zoom = 1.25;
    tab.activeAnalysisMode = "TRAN";
    tab.ch1ProbeNode = "10";
    tab.sparPorts = [{ nodeId: "10", z0: 75 }];
    tab.voltageSnapshot = { "10": 4.2 };
    const runtime = createRuntime();
    const setActiveAnalysisMode = vi.fn();
    const setProbes = vi.fn();
    const setSparPorts = vi.fn();
    const setVoltageSnapshot = vi.fn();
    const resetRuntimeState = vi.fn();

    restoreTabIntoRuntime(tab, {
      orchestrator: runtime.orchestrator,
      oscilloscopePanel: runtime.oscilloscopePanel,
      simulationControls: null,
      setActiveAnalysisMode,
      setProbes,
      setSparPorts,
      setVoltageSnapshot,
      resetRuntimeState,
    });

    expect(runtime.orchestrator.components).toEqual(tab.components);
    expect(runtime.orchestrator.selectedComponent).toBeNull();
    expect(runtime.orchestrator.zoom).toBe(1.25);
    expect(setActiveAnalysisMode).toHaveBeenCalledWith("TRAN");
    expect(setProbes).toHaveBeenCalledWith({ ch1: "10", ch2: "2", ch3: "3", ch4: "4" });
    expect(setSparPorts).toHaveBeenCalledWith([{ nodeId: "10", z0: 75 }]);
    expect(setVoltageSnapshot).toHaveBeenCalledWith({ "10": 4.2 });
    expect(resetRuntimeState).toHaveBeenCalledOnce();
    expect(runtime.oscilloscopePanel.applyPersistentState).toHaveBeenCalledWith(tab.oscilloscopeState);
  });
});
