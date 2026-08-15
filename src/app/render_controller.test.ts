import { describe, expect, it, vi } from "vitest";
import type { CanvasOrchestrator } from "../canvas_orchestrator";
import { createCircuitStateManager } from "../simulation/circuit_state_manager";
import { PerformanceMonitor } from "../performance/performance_monitor";
import { createRenderController } from "./render_controller";

function createHarness(options: {
  oscilloscopePanel?: unknown;
  instrumentsDock?: unknown;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
} = {}) {
  const circuitState = createCircuitStateManager();
  circuitState.setPinToNodeMap({ "R1:0": "1", "R1:1": "0" });
  circuitState.setVoltagesFromSnapshot({ "0": 0, "1": 5 });

  const orchestrator = {
    components: [
      { id: "R1", type: "resistor", value: "1k", x: 0, y: 0, rotation: 0 },
    ],
    wires: [],
    render: vi.fn(),
    getComponentPins: vi.fn(() => [
      { x: -40, y: 0, pinIndex: 0 },
      { x: 40, y: 0, pinIndex: 1 },
    ]),
  } as unknown as CanvasOrchestrator;

  let now = 100;
  let inRaf = false;
  const controller = createRenderController({
    getOrchestrator: () => orchestrator,
    getOscilloscopePanel: () => options.oscilloscopePanel as never ?? null,
    getInstrumentsDock: () => options.instrumentsDock as never ?? null,
    getProbeFallbacks: () => ({ ch1: "1", ch2: "2", ch3: "3", ch4: "4" }),
    getSparPorts: () => [],
    updateMcuDebugPanel: vi.fn(),
    circuitState,
    performanceMonitor: new PerformanceMonitor(),
    isVisualAuditStep: () => false,
    requestAnimationFrame: options.requestAnimationFrame ?? vi.fn(() => 1),
    now: () => now,
  });

  return {
    controller,
    circuitState,
    orchestrator,
    setNow: (nextNow: number) => { now = nextNow; },
  };
}

describe("RenderController", () => {
  it("renderiza el canvas con marcadores de sonda", () => {
    const { controller, orchestrator } = createHarness();

    controller.updateCanvasRendering(true);

    expect(orchestrator.render).toHaveBeenCalledOnce();
    const [, probeMarkers] = vi.mocked(orchestrator.render).mock.calls[0];
    expect(probeMarkers.ch1).toEqual({ x: -40, y: 0 });
  });

  it("limita renders de playback demasiado seguidos", () => {
    const { controller, setNow } = createHarness();

    setNow(100);
    expect(controller.shouldRenderPlaybackCanvas()).toBe(true);
    setNow(120);
    expect(controller.shouldRenderPlaybackCanvas()).toBe(false);
    setNow(134);
    expect(controller.shouldRenderPlaybackCanvas()).toBe(true);
  });

  it("procesa frames de playback y alimenta instrumentos", () => {
    const logicAnalyzer = { recordTimeStep: vi.fn() };
    const { controller, circuitState, orchestrator, setNow } = createHarness({
      oscilloscopePanel: {
      transientResults: [
        { time: 0, nodeVoltages: { "1": 1 }, branchCurrents: {} },
        { time: 0.1, nodeVoltages: { "1": 4 }, branchCurrents: {} },
      ],
      ch1ProbeNode: "1",
      ch2ProbeNode: "2",
      },
      instrumentsDock: { logicAnalyzer },
    });

    setNow(200);
    controller.handlePlaybackFrame(0.09);

    expect(circuitState.getNodeVoltage("1")).toBe(4);
    expect(logicAnalyzer.recordTimeStep).toHaveBeenCalledWith(0.1, { "1": 4 });
    expect(orchestrator.render).toHaveBeenCalledOnce();
  });

  it("renderiza en modo por capas (base + overlay) cuando el orchestrator tiene layered rendering", () => {
    const renderBase = vi.fn();
    const renderOverlay = vi.fn();
    const clearOverlay = vi.fn();

    const { controller, orchestrator } = createHarness();
    (orchestrator as any).hasLayeredRendering = vi.fn(() => true);
    (orchestrator as any).renderBase = renderBase;
    (orchestrator as any).renderOverlay = renderOverlay;
    (orchestrator as any).clearOverlay = clearOverlay;

    controller.updateCanvasRendering(true);

    expect(renderBase).toHaveBeenCalledOnce();
    expect(renderOverlay).toHaveBeenCalledOnce();
  });
});
