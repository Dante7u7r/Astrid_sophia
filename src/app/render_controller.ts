import type { Point2D } from "../canvas_orchestrator";
import type { CanvasOrchestrator } from "../canvas_orchestrator";
import type { CircuitStateManager } from "../simulation/circuit_state_manager";
import { runCycles, resetRuntime } from "../simulation";
import { updateDmmReadings } from "../simulation/dmm";
import { parseBuzzerActuatorModel } from "../ui/actuator_helpers";
import type { InstrumentsDock } from "../ui/instruments_dock";
import type { OscilloscopePanel, TimeStepResult } from "../ui/oscilloscope_panel";
import { buildDmmRenderCacheKey } from "../performance/dmm_render_cache";
import type { PerformanceMonitor } from "../performance/performance_monitor";
import {
  findClosestTimeIndex,
  shouldRenderPlaybackCanvas as canRenderPlaybackCanvas,
} from "./playback_helpers";

export interface RenderControllerDependencies {
  getOrchestrator(): CanvasOrchestrator | null;
  getOscilloscopePanel(): OscilloscopePanel | null;
  getInstrumentsDock(): InstrumentsDock | null;
  getProbeFallbacks(): {
    ch1: string | null;
    ch2: string | null;
    ch3: string | null;
    ch4: string | null;
  };
  getSparPorts(): { nodeId: string; z0: number }[];
  updateMcuDebugPanel(): void;
  circuitState: CircuitStateManager;
  performanceMonitor: PerformanceMonitor;
  isVisualAuditStep(step: VisualAuditRenderStep): boolean;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  now(): number;
}

type VisualAuditRenderStep = "skip-render" | "skip-canvas-render" | "skip-osc-render";

export class RenderController {
  private renderFramePending = false;
  private oscilloscopeFramePending = false;
  private dmmRenderCacheKey = "";
  private playbackFrameIndex = 0;
  private playbackLastCanvasRenderAt = 0;
  private playbackLastFftSignature = "";

  constructor(private readonly dependencies: RenderControllerDependencies) {}

  updateCanvasRendering(immediate = false): void {
    if (immediate) {
      this.renderFramePending = false;
      this.doCanvasRender();
      return;
    }
    if (this.renderFramePending) return;
    this.renderFramePending = true;
    this.dependencies.requestAnimationFrame(() => {
      this.renderFramePending = false;
      this.doCanvasRender();
    });
  }

  updateOscilloscopeRendering(immediate = false): void {
    if (immediate) {
      this.oscilloscopeFramePending = false;
      this.doOscilloscopeRender();
      return;
    }
    if (this.oscilloscopeFramePending) return;
    this.oscilloscopeFramePending = true;
    this.dependencies.requestAnimationFrame(() => {
      this.oscilloscopeFramePending = false;
      this.doOscilloscopeRender();
    });
  }

  resetPerformanceCaches(): void {
    this.dmmRenderCacheKey = "";
    this.playbackFrameIndex = 0;
    this.playbackLastCanvasRenderAt = 0;
    this.playbackLastFftSignature = "";
  }

  findClosestPlaybackIndex(results: readonly TimeStepResult[], sweepTime: number): number {
    const index = findClosestTimeIndex(results, sweepTime, this.playbackFrameIndex);
    this.playbackFrameIndex = index;
    return index;
  }

  shouldRenderPlaybackCanvas(now = this.dependencies.now()): boolean {
    if (!canRenderPlaybackCanvas(now, this.playbackLastCanvasRenderAt)) return false;
    this.playbackLastCanvasRenderAt = now;
    return true;
  }

  updateFftDataIfNeeded(results: readonly TimeStepResult[]): void {
    const instrumentsDock = this.dependencies.getInstrumentsDock();
    const oscilloscopePanel = this.dependencies.getOscilloscopePanel();
    if (!instrumentsDock?.fftAnalyzer || !oscilloscopePanel || results.length === 0) return;

    const ch1Node = oscilloscopePanel.ch1ProbeNode || "";
    const ch2Node = oscilloscopePanel.ch2ProbeNode || "";
    const last = results[results.length - 1];
    const signature = `${results.length}:${last.time}:${ch1Node}:${ch2Node}`;
    if (signature === this.playbackLastFftSignature) return;

    this.playbackLastFftSignature = signature;
    const ch1Data = results.map(r => ({
      time: r.time,
      val: r.nodeVoltages[ch1Node] ?? 0,
    }));
    const ch2Data = results.map(r => ({
      time: r.time,
      val: r.nodeVoltages[ch2Node] ?? 0,
    }));
    instrumentsDock.fftAnalyzer.setTimeData(ch1Data, ch2Data);
  }

  handlePlaybackFrame(sweepTime: number): void {
    const oscilloscopePanel = this.dependencies.getOscilloscopePanel();
    const orchestrator = this.dependencies.getOrchestrator();
    if (oscilloscopePanel && orchestrator) {
      const results = oscilloscopePanel.transientResults;
      if (results.length > 0) {
        const closestIdx = this.findClosestPlaybackIndex(results, sweepTime);
        const closest = results[closestIdx];
        if (closest) {
          this.dependencies.circuitState.setVoltagesFromSnapshot(closest.nodeVoltages);
          this.syncMcuPlaybackState(orchestrator, sweepTime);
          this.feedPlaybackInstruments(closest, results);
          this.applyActuatorPlaybackState(orchestrator, closestIdx);
        }
      }
    }

    if (this.shouldRenderPlaybackCanvas()) {
      this.updateCanvasRendering();
    }
  }

  private doCanvasRender(): void {
    if (this.dependencies.isVisualAuditStep("skip-render")) return;

    const orchestrator = this.dependencies.getOrchestrator();
    if (!orchestrator) return;

    const pinVoltageMap = this.dependencies.circuitState.buildPinVoltageMap();
    const voltageMap = this.dependencies.circuitState.getVoltageMap();
    const pinToNodeMap = this.dependencies.circuitState.getPinToNodeMap();

    const dmmCacheKey = buildDmmRenderCacheKey(
      orchestrator.components,
      orchestrator.wires,
      pinToNodeMap,
      voltageMap,
    );
    if (dmmCacheKey !== this.dmmRenderCacheKey) {
      updateDmmReadings(
        orchestrator.components,
        orchestrator.wires,
        pinToNodeMap,
        voltageMap,
      );
      this.dmmRenderCacheKey = dmmCacheKey;
    } else {
      this.dependencies.performanceMonitor.recordSkippedDmmUpdate();
    }

    const { probeMarkers, sparMarkers } = this.resolveMarkers(orchestrator);

    if (!this.dependencies.isVisualAuditStep("skip-canvas-render")) {
      orchestrator.render(
        pinVoltageMap,
        probeMarkers,
        pinToNodeMap,
        sparMarkers.length > 0 ? sparMarkers : undefined,
      );
      this.dependencies.performanceMonitor.recordCanvasFrame();
    }
  }

  private doOscilloscopeRender(): void {
    if (this.dependencies.isVisualAuditStep("skip-osc-render")) return;
    this.dependencies.getOscilloscopePanel()?.refreshVisibility();
    this.dependencies.performanceMonitor.recordOscilloscopeFrame();
  }

  private syncMcuPlaybackState(orchestrator: CanvasOrchestrator, sweepTime: number): void {
    for (const component of orchestrator.components) {
      if (!this.isMcuComponent(component.type)) continue;

      const pins = orchestrator.getComponentPins(component);
      const pinStates: Record<number, number | string> = {};
      const vcc = component.type === "mcu_8051" || component.type === "arduino_uno" ? 5.0 : 3.3;

      pins.forEach((_, pinIndex) => {
        const nodeKey = this.dependencies.circuitState.getPinNode(`${component.id}:${pinIndex}`);
        if (!nodeKey) {
          pinStates[pinIndex] = "Z";
          return;
        }

        const voltage = this.dependencies.circuitState.getNodeVoltage(nodeKey) ?? 0.0;
        if (voltage > 0.7 * vcc) {
          pinStates[pinIndex] = 1;
        } else if (voltage < 0.3 * vcc) {
          pinStates[pinIndex] = 0;
        } else {
          pinStates[pinIndex] = "Z";
        }
      });
      component.mcuPinStates = pinStates;

      if (orchestrator.selectedComponent?.id === component.id && component.mcuRuntime) {
        const clockSpeed = component.mcuClockSpeed
          ?? (component.type === "mcu_avr" ? 16e6 : 12e6);
        const targetCycle = Math.round(sweepTime * clockSpeed);
        if (component.mcuRuntime.state.cycle < targetCycle) {
          const diff = targetCycle - component.mcuRuntime.state.cycle;
          runCycles(component.mcuRuntime, Math.min(diff, 200_000));
        } else if (component.mcuRuntime.state.cycle > targetCycle) {
          resetRuntime(component.mcuRuntime);
          runCycles(component.mcuRuntime, Math.min(targetCycle, 200_000));
        }
        this.dependencies.updateMcuDebugPanel();
      }
    }
  }

  private feedPlaybackInstruments(
    closest: TimeStepResult,
    results: readonly TimeStepResult[],
  ): void {
    const instrumentsDock = this.dependencies.getInstrumentsDock();
    instrumentsDock?.logicAnalyzer?.recordTimeStep(closest.time, closest.nodeVoltages);
    this.updateFftDataIfNeeded(results);
  }

  private applyActuatorPlaybackState(
    orchestrator: CanvasOrchestrator,
    closestIdx: number,
  ): void {
    for (const component of orchestrator.components) {
      const history = this.dependencies.circuitState.actuatorHistory.history.get(component.id);
      const actuatorState = history?.[closestIdx];
      if (!actuatorState) continue;

      component.glowLevel = actuatorState.glowLevel;
      component.relayClosed = actuatorState.relayClosed;
      component.buzzerLevel = actuatorState.buzzerLevel;

      if (component.type === "buzzer") {
        const model = parseBuzzerActuatorModel(component.value?.toString() ?? "");
        const level = component.buzzerLevel ?? 0;
        if (level > 0.05) {
          this.dependencies.circuitState.audioOrchestrator.updateBuzzer(
            component.id,
            model.resonantFrequencyHz,
            level,
          );
        } else {
          this.dependencies.circuitState.audioOrchestrator.stopBuzzer(component.id);
        }
      }
    }
  }

  private isMcuComponent(type: string): boolean {
    return type === "mcu_8051"
      || type === "mcu_avr"
      || type === "arduino_uno"
      || type === "esp32"
      || type === "raspberry_pi_pico";
  }

  private resolveMarkers(orchestrator: CanvasOrchestrator): {
    probeMarkers: {
      ch1?: Point2D;
      ch2?: Point2D;
      ch3?: Point2D;
      ch4?: Point2D;
    };
    sparMarkers: { index: number; x: number; y: number }[];
  } {
    const oscilloscopePanel = this.dependencies.getOscilloscopePanel();
    const fallback = this.dependencies.getProbeFallbacks();
    const probeNodes = {
      ch1: oscilloscopePanel ? oscilloscopePanel.ch1ProbeNode : fallback.ch1,
      ch2: oscilloscopePanel ? oscilloscopePanel.ch2ProbeNode : fallback.ch2,
      ch3: oscilloscopePanel ? oscilloscopePanel.ch3ProbeNode : fallback.ch3,
      ch4: oscilloscopePanel ? oscilloscopePanel.ch4ProbeNode : fallback.ch4,
    };
    const sparPorts = this.dependencies.getSparPorts();
    const sparMarkers: { index: number; x: number; y: number }[] = [];
    const probeMarkers: {
      ch1?: Point2D;
      ch2?: Point2D;
      ch3?: Point2D;
      ch4?: Point2D;
    } = {};

    for (const comp of orchestrator.components) {
      const pins = orchestrator.getComponentPins(comp);
      for (const pin of pins) {
        const pinKey = `${comp.id}:${pin.pinIndex}`;
        const nodeId = this.dependencies.circuitState.getPinNode(pinKey);

        for (const sparPort of sparPorts) {
          if (nodeId === sparPort.nodeId) {
            const index = sparPorts.indexOf(sparPort) + 1;
            if (!sparMarkers.some(marker => marker.index === index)) {
              sparMarkers.push({ index, x: pin.x, y: pin.y });
            }
          }
        }

        if (nodeId === probeNodes.ch1 && !probeMarkers.ch1) probeMarkers.ch1 = { x: pin.x, y: pin.y };
        if (nodeId === probeNodes.ch2 && !probeMarkers.ch2) probeMarkers.ch2 = { x: pin.x, y: pin.y };
        if (nodeId === probeNodes.ch3 && !probeMarkers.ch3) probeMarkers.ch3 = { x: pin.x, y: pin.y };
        if (nodeId === probeNodes.ch4 && !probeMarkers.ch4) probeMarkers.ch4 = { x: pin.x, y: pin.y };
      }
    }

    return { probeMarkers, sparMarkers };
  }
}

export function createRenderController(
  dependencies: RenderControllerDependencies,
): RenderController {
  return new RenderController(dependencies);
}
