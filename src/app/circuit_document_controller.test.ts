import { describe, expect, it, vi } from "vitest";
import type { CanvasOrchestrator } from "../canvas_orchestrator";
import { createDefaultOscilloscopeState } from "../persistence/circuit_file";
import { createCircuitStateManager } from "../simulation/circuit_state_manager";
import type { OscilloscopePanel } from "../ui/oscilloscope_panel";
import type { AnalysisMode } from "../ui/simulation_controls";
import type { SimulationSettings } from "../ui/settings_modal";
import {
  createCircuitDocumentController,
  type ValidatedCircuitFile,
} from "./circuit_document_controller";

function createHarness() {
  const orchestrator = {
    components: [
      { id: "R1", type: "resistor", value: "1k", x: 10, y: 20, rotation: 0 },
    ],
    wires: [],
    zoom: 1,
    offsetX: 15,
    offsetY: 25,
    selectedComponent: null,
    selectedComponents: [],
    selectedWire: null,
    activePinForWire: null,
    tempWireEnd: null,
    selectionStart: null,
    selectionEnd: null,
    getComponentPins: vi.fn(() => []),
    syncWireConnections: vi.fn(),
  } as unknown as CanvasOrchestrator;

  const oscilloscopeState = createDefaultOscilloscopeState();
  const oscilloscope = {
    ch1ProbeNode: "1",
    ch2ProbeNode: "2",
    ch3ProbeNode: "3",
    ch4ProbeNode: "4",
    activeAnalysisMode: "DC",
    transientResults: [{ time: 0, nodeVoltages: {}, currents: {} }],
    acSweepResults: null,
    sweepTime: 0.4,
    draw: vi.fn(),
    getPersistentState: vi.fn(() => oscilloscopeState),
    applyPersistentState: vi.fn(),
  } as unknown as OscilloscopePanel;

  let simSettings: SimulationSettings = {
    dt: 0.0001,
    tolerance: 0.00001,
    maxIterations: 100,
  };
  let activeMode: AnalysisMode = "DC";
  let sparPorts: { nodeId: string; z0: number }[] = [];
  let probes = { ch1: "1", ch2: "2", ch3: "3", ch4: "4" };

  const deps = {
    getOrchestrator: () => orchestrator,
    getOscilloscopePanel: () => oscilloscope,
    getSimulationSettings: () => simSettings,
    setSimulationSettings: vi.fn((settings: SimulationSettings) => {
      simSettings = { ...settings };
    }),
    getActiveAnalysisMode: () => activeMode,
    setActiveAnalysisMode: vi.fn((mode: AnalysisMode) => {
      activeMode = mode;
    }),
    setSimulationControlMode: vi.fn(),
    getSparPorts: () => sparPorts,
    setSparPorts: vi.fn((ports: { nodeId: string; z0: number }[]) => {
      sparPorts = ports.map(port => ({ ...port }));
    }),
    setProbeNodes: vi.fn((nextProbes: typeof probes) => {
      probes = { ...nextProbes };
    }),
    circuitState: createCircuitStateManager(),
    resetPerformanceCaches: vi.fn(),
    extractNetlist: vi.fn(),
    updateCanvasRendering: vi.fn(),
    updateOscilloscopeRendering: vi.fn(),
    addLog: vi.fn(),
    logError: vi.fn(),
  };

  return {
    orchestrator,
    oscilloscope,
    deps,
    controller: createCircuitDocumentController(deps),
    getState: () => ({ simSettings, activeMode, sparPorts, probes }),
  };
}

function createValidatedFile(): ValidatedCircuitFile {
  return {
    migratedFrom: null,
    data: {
      version: "3.0",
      components: [
        { id: "C1", type: "capacitor", value: "1u", x: 100, y: 120, rotation: 0 },
      ],
      wires: [],
      viewport: { zoom: 1.4, offsetX: 30, offsetY: 40 },
      simSettings: { dt: 0.002, tolerance: 0.0002, maxIterations: 75 },
      activeAnalysisMode: "TRAN",
      probes: {
        ch1ProbeNode: "10",
        ch2ProbeNode: "20",
        ch3ProbeNode: null,
        ch4ProbeNode: "40",
      },
      sparPorts: [{ nodeId: "10", z0: 75 }],
      oscilloscope: createDefaultOscilloscopeState(),
    },
  };
}

describe("CircuitDocumentController", () => {
  it("serializa el documento activo desde canvas, ajustes e instrumentos", () => {
    const { controller } = createHarness();

    const parsed = JSON.parse(controller.serializeCircuit());

    expect(parsed.components).toHaveLength(1);
    expect(parsed.viewport).toEqual({ zoom: 1, offsetX: 15, offsetY: 25 });
    expect(parsed.probes.ch1ProbeNode).toBe("1");
    expect(parsed.activeAnalysisMode).toBe("DC");
  });

  it("aplica un archivo validado y actualiza runtime, vista y sondas", () => {
    const { controller, orchestrator, oscilloscope, deps, getState } = createHarness();
    const validated = createValidatedFile();

    expect(controller.deserializeCircuit("{}", validated)).toBe(true);

    expect(orchestrator.components).toEqual(validated.data.components);
    expect(orchestrator.zoom).toBe(1.4);
    expect(deps.setSimulationSettings).toHaveBeenCalledWith(validated.data.simSettings);
    expect(deps.setActiveAnalysisMode).toHaveBeenCalledWith("TRAN");
    expect(deps.setSimulationControlMode).toHaveBeenCalledWith("TRAN");
    expect(getState().probes).toEqual({ ch1: "10", ch2: "20", ch3: null, ch4: "40" });
    expect(getState().sparPorts).toEqual([{ nodeId: "10", z0: 75 }]);
    expect(oscilloscope.applyPersistentState).toHaveBeenCalledWith(validated.data.oscilloscope);
    expect(deps.extractNetlist).toHaveBeenCalledOnce();
    expect(deps.updateCanvasRendering).toHaveBeenCalledOnce();
    expect(deps.updateOscilloscopeRendering).toHaveBeenCalledOnce();
  });
});
