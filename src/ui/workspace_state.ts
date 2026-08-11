import type { CanvasOrchestrator, ComponentInstance, WireInstance } from "../canvas_orchestrator";
import type {
  AcSweepResult,
  OscilloscopePanel,
  PvtTrace,
  TimeStepResult,
} from "./oscilloscope_panel";
import type { SParameterResult } from "../simulation";
import type { AnalysisMode, SimulationControls } from "./simulation_controls";
import {
  cloneCircuitComponents,
  cloneCircuitWires,
  createDefaultOscilloscopeState,
  type PersistedOscilloscopeState,
} from "../persistence/circuit_file";

export interface TabProbeState {
  ch1: string | null;
  ch2: string | null;
  ch3: string | null;
  ch4: string | null;
}

export interface Tab {
  id: string;
  name: string;
  components: ComponentInstance[];
  wires: WireInstance[];
  zoom: number;
  offsetX: number;
  offsetY: number;
  filePath: string | null;
  unsaved: boolean;
  transientResults: TimeStepResult[];
  acSweepResults: AcSweepResult | null;
  pvtMode: boolean;
  pvtTraces: PvtTrace[];
  sparResult: SParameterResult | null;
  sparCh1Index: number;
  sparCh2Index: number;
  sparPorts: { nodeId: string; z0: number }[];
  voltageSnapshot: Record<string, number>;
  oscilloscopeState: PersistedOscilloscopeState;
  ch1ProbeNode: string | null;
  ch2ProbeNode: string | null;
  ch3ProbeNode: string | null;
  ch4ProbeNode: string | null;
  activeAnalysisMode: AnalysisMode;
}

export interface InitialTabData {
  components: ComponentInstance[];
  wires: WireInstance[];
  filePath: string | null;
}

export function createWorkspaceTab(
  id: string,
  name: string,
  initialData?: InitialTabData,
): Tab {
  return {
    id,
    name,
    components: initialData?.components ?? [],
    wires: initialData?.wires ?? [],
    zoom: 1.0,
    offsetX: 0,
    offsetY: 0,
    filePath: initialData?.filePath ?? null,
    unsaved: false,
    transientResults: [],
    acSweepResults: null,
    pvtMode: false,
    pvtTraces: [],
    sparResult: null,
    sparCh1Index: 0,
    sparCh2Index: 1,
    sparPorts: [],
    voltageSnapshot: {},
    oscilloscopeState: createDefaultOscilloscopeState(),
    ch1ProbeNode: "1",
    ch2ProbeNode: "2",
    ch3ProbeNode: "3",
    ch4ProbeNode: "4",
    activeAnalysisMode: "DC",
  };
}

export interface RuntimeCapture {
  orchestrator: CanvasOrchestrator;
  oscilloscopePanel: OscilloscopePanel | null;
  activeAnalysisMode: AnalysisMode;
  probes: TabProbeState;
  sparPorts: { nodeId: string; z0: number }[];
  voltageSnapshot: Readonly<Record<string, number>>;
}

export function captureRuntimeIntoTab(tab: Tab, runtime: RuntimeCapture): void {
  tab.components = cloneCircuitComponents(runtime.orchestrator.components);
  tab.wires = cloneCircuitWires(runtime.orchestrator.wires);
  tab.zoom = runtime.orchestrator.zoom;
  tab.offsetX = runtime.orchestrator.offsetX;
  tab.offsetY = runtime.orchestrator.offsetY;
  tab.activeAnalysisMode = runtime.activeAnalysisMode;
  tab.ch1ProbeNode = runtime.probes.ch1;
  tab.ch2ProbeNode = runtime.probes.ch2;
  tab.ch3ProbeNode = runtime.probes.ch3;
  tab.ch4ProbeNode = runtime.probes.ch4;
  tab.sparPorts = runtime.sparPorts.map(port => ({ ...port }));
  tab.voltageSnapshot = { ...runtime.voltageSnapshot };

  const oscilloscopePanel = runtime.oscilloscopePanel;
  if (oscilloscopePanel) {
    tab.transientResults = oscilloscopePanel.transientResults;
    tab.acSweepResults = oscilloscopePanel.acSweepResults;
    tab.pvtMode = oscilloscopePanel.pvtMode;
    tab.pvtTraces = oscilloscopePanel.pvtTraces;
    tab.sparResult = oscilloscopePanel.sparResult;
    tab.sparCh1Index = oscilloscopePanel.sparCh1Index;
    tab.sparCh2Index = oscilloscopePanel.sparCh2Index;
    tab.oscilloscopeState = oscilloscopePanel.getPersistentState();
  }
}

export interface RuntimeRestore {
  orchestrator: CanvasOrchestrator;
  oscilloscopePanel: OscilloscopePanel | null;
  simulationControls: SimulationControls | null;
  setActiveAnalysisMode(mode: AnalysisMode): void;
  setProbes(probes: TabProbeState): void;
  setSparPorts(ports: { nodeId: string; z0: number }[]): void;
  setVoltageSnapshot(voltages: Record<string, number>): void;
  resetRuntimeState(): void;
}

export function resetOrchestratorSelection(orchestrator: CanvasOrchestrator): void {
  orchestrator.selectedComponent = null;
  orchestrator.selectedComponents = [];
  orchestrator.selectedWire = null;
  orchestrator.activePinForWire = null;
  orchestrator.tempWireEnd = null;
  orchestrator.selectionStart = null;
  orchestrator.selectionEnd = null;
}

export function restoreTabIntoRuntime(tab: Tab, runtime: RuntimeRestore): void {
  resetOrchestratorSelection(runtime.orchestrator);

  runtime.orchestrator.components = cloneCircuitComponents(tab.components);
  runtime.orchestrator.wires = cloneCircuitWires(tab.wires);
  runtime.orchestrator.zoom = tab.zoom;
  runtime.orchestrator.offsetX = tab.offsetX;
  runtime.orchestrator.offsetY = tab.offsetY;

  runtime.setActiveAnalysisMode(tab.activeAnalysisMode);
  runtime.setProbes({
    ch1: tab.ch1ProbeNode,
    ch2: tab.ch2ProbeNode,
    ch3: tab.ch3ProbeNode,
    ch4: tab.ch4ProbeNode,
  });
  runtime.simulationControls?.setActiveModeButton(tab.activeAnalysisMode);

  const oscilloscopePanel = runtime.oscilloscopePanel;
  if (oscilloscopePanel) {
    oscilloscopePanel.activeAnalysisMode = tab.activeAnalysisMode;
    oscilloscopePanel.ch1ProbeNode = tab.ch1ProbeNode;
    oscilloscopePanel.ch2ProbeNode = tab.ch2ProbeNode;
    oscilloscopePanel.ch3ProbeNode = tab.ch3ProbeNode;
    oscilloscopePanel.ch4ProbeNode = tab.ch4ProbeNode;
    oscilloscopePanel.transientResults = tab.transientResults;
    oscilloscopePanel.acSweepResults = tab.acSweepResults;
    oscilloscopePanel.sweepTime = 0.0;
    oscilloscopePanel.pvtMode = tab.pvtMode;
    oscilloscopePanel.pvtTraces = tab.pvtTraces;
    oscilloscopePanel.sparResult = tab.sparResult;
    oscilloscopePanel.sparCh1Index = tab.sparCh1Index;
    oscilloscopePanel.sparCh2Index = tab.sparCh2Index;
    oscilloscopePanel.applyPersistentState(tab.oscilloscopeState);
  }

  runtime.setSparPorts(tab.sparPorts.map(port => ({ ...port })));
  runtime.resetRuntimeState();
  runtime.setVoltageSnapshot({ ...tab.voltageSnapshot });
}
