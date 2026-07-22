// @vitest-environment happy-dom

import { beforeEach, describe, expect, test, vi } from "vitest";
import type { CanvasOrchestrator } from "../canvas_orchestrator";
import { createDefaultOscilloscopeState } from "../persistence/circuit_file";
import type { OscilloscopePanel, PvtTrace, TimeStepResult } from "./oscilloscope_panel";
import { TabManager, type TabProbeState } from "./tab_manager";
import type { AnalysisMode } from "./simulation_controls";

function createHarness() {
  const orchestrator = {
    components: [],
    wires: [],
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    selectedComponent: null,
    selectedComponents: [],
    selectedWire: null,
    activePinForWire: null,
    tempWireEnd: null,
    selectionStart: null,
    selectionEnd: null,
  } as unknown as CanvasOrchestrator;

  let mode: AnalysisMode = "DC";
  let probes: TabProbeState = { ch1: "1", ch2: "2", ch3: "3", ch4: "4" };
  let sparPorts: { nodeId: string; z0: number }[] = [];
  let voltages: Record<string, number> = {};
  let canChange = true;
  let oscilloscopeState = createDefaultOscilloscopeState();

  const oscilloscope = {
    activeAnalysisMode: "DC",
    ch1ProbeNode: "1",
    ch2ProbeNode: "2",
    ch3ProbeNode: "3",
    ch4ProbeNode: "4",
    transientResults: [] as TimeStepResult[],
    acSweepResults: null,
    sweepTime: 0,
    pvtMode: false,
    pvtTraces: [] as PvtTrace[],
    sparResult: null,
    sparCh1Index: 0,
    sparCh2Index: 1,
    getPersistentState: () => ({
      ...oscilloscopeState,
      channelsEnabled: [...oscilloscopeState.channelsEnabled],
      voltsPerDiv: [...oscilloscopeState.voltsPerDiv],
      offsets: [...oscilloscopeState.offsets],
    }),
    applyPersistentState: vi.fn((state) => {
      oscilloscopeState = {
        ...state,
        channelsEnabled: [...state.channelsEnabled],
        voltsPerDiv: [...state.voltsPerDiv],
        offsets: [...state.offsets],
      };
    }),
    draw: vi.fn(),
  } as unknown as OscilloscopePanel;

  const addLog = vi.fn();
  const resetRuntimeState = vi.fn();
  const manager = new TabManager({
    getOrchestrator: () => orchestrator,
    getOscilloscopePanel: () => oscilloscope,
    getMcuDebugPanel: () => null,
    getSimulationControls: () => null,
    extractNetlist: vi.fn(),
    updateCanvasRendering: vi.fn(),
    getActiveAnalysisMode: () => mode,
    setActiveAnalysisMode: (nextMode) => { mode = nextMode; },
    getProbes: () => probes,
    setProbes: (nextProbes) => { probes = { ...nextProbes }; },
    getSparPorts: () => sparPorts,
    setSparPorts: (ports) => { sparPorts = ports.map(port => ({ ...port })); },
    getVoltageSnapshot: () => voltages,
    setVoltageSnapshot: (nextVoltages) => { voltages = { ...nextVoltages }; },
    resetRuntimeState,
    canChangeActiveTab: () => canChange,
    documentController: { serializeCircuit: () => "{}" },
    addLog,
    invokeTauri: vi.fn(),
  });

  return {
    manager,
    orchestrator,
    oscilloscope,
    addLog,
    resetRuntimeState,
    setMode: (nextMode: AnalysisMode) => { mode = nextMode; },
    getMode: () => mode,
    setProbes: (nextProbes: TabProbeState) => { probes = { ...nextProbes }; },
    getProbes: () => probes,
    setSparPorts: (ports: { nodeId: string; z0: number }[]) => { sparPorts = ports; },
    getSparPorts: () => sparPorts,
    setVoltages: (nextVoltages: Record<string, number>) => { voltages = nextVoltages; },
    getVoltages: () => voltages,
    setCanChange: (value: boolean) => { canChange = value; },
    setOscilloscopeState: (state: typeof oscilloscopeState) => { oscilloscopeState = state; },
    getOscilloscopeState: () => oscilloscopeState,
  };
}

describe("TabManager", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="tabs-container"></div>';
  });

  test("restaura resultados, cuatro sondas, puertos RF y voltajes por pestana", () => {
    const harness = createHarness();
    const first = harness.manager.createNewTab("Primera");
    expect(first).not.toBeNull();

    const firstResults: TimeStepResult[] = [{
      time: 0.001,
      nodeVoltages: { "7": 3.3 },
      branchCurrents: { V1: 0.01 },
    }];
    harness.setMode("PVT");
    harness.setProbes({ ch1: "7", ch2: "8", ch3: "9", ch4: "10" });
    harness.setSparPorts([{ nodeId: "7", z0: 50 }]);
    harness.setVoltages({ "7": 3.3 });
    harness.oscilloscope.transientResults = firstResults;
    harness.oscilloscope.pvtMode = true;
    harness.oscilloscope.pvtTraces = [{
      config: { corner: "tt", temperatureC: 27, voltageScaling: 1 },
      results: firstResults,
      visible: true,
      color: "#fff",
    }];
    harness.setOscilloscopeState({
      ...createDefaultOscilloscopeState(),
      timeDivValue: 0.005,
      channelsEnabled: [true, true, false, false],
    });

    const second = harness.manager.createNewTab("Segunda");
    expect(second).not.toBeNull();
    expect(harness.getMode()).toBe("DC");
    expect(harness.getProbes()).toEqual({ ch1: "1", ch2: "2", ch3: "3", ch4: "4" });
    expect(harness.getSparPorts()).toEqual([]);
    expect(harness.getVoltages()).toEqual({});
    expect(harness.oscilloscope.pvtTraces).toEqual([]);

    expect(harness.manager.switchTab(first!.id)).toBe(true);
    expect(harness.getMode()).toBe("PVT");
    expect(harness.getProbes()).toEqual({ ch1: "7", ch2: "8", ch3: "9", ch4: "10" });
    expect(harness.getSparPorts()).toEqual([{ nodeId: "7", z0: 50 }]);
    expect(harness.getVoltages()).toEqual({ "7": 3.3 });
    expect(harness.oscilloscope.transientResults).toBe(firstResults);
    expect(harness.oscilloscope.pvtMode).toBe(true);
    expect(harness.oscilloscope.pvtTraces).toHaveLength(1);
    expect(harness.getOscilloscopeState().timeDivValue).toBe(0.005);
    expect(harness.resetRuntimeState).toHaveBeenCalled();
  });

  test("bloquea crear, cambiar y cerrar la pestana activa durante una simulacion", async () => {
    const harness = createHarness();
    const first = harness.manager.createNewTab("Primera")!;
    const second = harness.manager.createNewTab("Segunda")!;
    expect(harness.manager.switchTab(first.id)).toBe(true);

    harness.setCanChange(false);
    expect(harness.manager.switchTab(second.id)).toBe(false);
    expect(harness.manager.createNewTab("Tercera")).toBeNull();
    await harness.manager.closeTab(first.id);

    expect(harness.manager.activeTabId).toBe(first.id);
    expect(harness.manager.tabs).toHaveLength(2);
    expect(harness.addLog).toHaveBeenCalledTimes(3);
  });

  test("registra frames transitorios en la pestana duena sin exponer el arreglo interno", () => {
    const harness = createHarness();
    const first = harness.manager.createNewTab("Primera")!;

    const updatedTab = harness.manager.appendTransientFrameToTab(first.id, {
      time: 0.01,
      nodeVoltages: { "1": 5 },
      branchCurrents: { V1: 0.02 },
    });

    expect(updatedTab).toBe(first);
    expect(harness.manager.isActiveTab(first.id)).toBe(true);
    expect(first.transientResults).toEqual([{
      time: 0.01,
      nodeVoltages: { "1": 5 },
      branchCurrents: { V1: 0.02 },
    }]);
    expect(first.voltageSnapshot).toEqual({ "1": 5 });
  });

  test("limita el historial interactivo por pestana", () => {
    const harness = createHarness();
    const first = harness.manager.createNewTab("Primera")!;
    first.transientResults = Array.from({ length: 60_000 }, (_, index) => ({
      time: index,
      nodeVoltages: {},
      branchCurrents: {},
    }));

    harness.manager.appendTransientFrameToTab(first.id, {
      time: 60_000,
      nodeVoltages: { "1": 5 },
      branchCurrents: {},
    });

    expect(first.transientResults).toHaveLength(54_001);
    expect(first.transientResults[0].time).toBe(6_000);
    expect(first.transientResults[first.transientResults.length - 1]?.time).toBe(60_000);
  });

  test("cierra la pestana activa mediante metodo de intencion", async () => {
    const harness = createHarness();
    const first = harness.manager.createNewTab("Primera")!;
    const second = harness.manager.createNewTab("Segunda")!;
    expect(harness.manager.getActiveTabId()).toBe(second.id);

    await harness.manager.closeActiveTab();

    expect(harness.manager.getActiveTabId()).toBe(first.id);
    expect(harness.manager.getTabById(second.id)).toBeUndefined();
  });
});
