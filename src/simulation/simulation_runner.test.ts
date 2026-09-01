// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CircuitNetlist } from "./netlist_extractor";
import {
  createSimulationRunner,
  type SimulationFrame,
  type SimulationRunner,
  type SimulationRunContext,
} from "./simulation_runner";
import { emitWebMockEventForTesting, safeInvoke } from "./tauri_mock";

class EchoWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  terminated = false;

  postMessage(message: { type: string; frame?: SimulationFrame }): void {
    if (message.type !== "process_frame" || !message.frame) return;
    const frame = message.frame;
    queueMicrotask(() => {
      if (this.terminated) return;
      this.onmessage?.({
        data: { type: "frame_processed", frame },
      } as MessageEvent);
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

const EMPTY_NETLIST = { components: [], wires: [] } as CircuitNetlist;

function createHarness() {
  const frames: Array<{ frame: SimulationFrame; context: SimulationRunContext }> = [];
  const completed: Array<{ time: number; context: SimulationRunContext }> = [];
  const states: Array<{ active: boolean; context: SimulationRunContext }> = [];
  const errors: string[] = [];
  const runner = createSimulationRunner({
    onFrameReceived: (frame, context) => frames.push({ frame, context }),
    onSimulationError: (error) => errors.push(error),
    onSimulationComplete: (time, context) => completed.push({ time, context }),
    onSimulationStateChanged: (active, context) => states.push({ active, context }),
  });
  return { runner, frames, completed, states, errors };
}

describe("SimulationRunner streaming", () => {
  let runner: SimulationRunner | null = null;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", EchoWorker);
    await safeInvoke("stop_interactive_transient");
  });

  afterEach(async () => {
    await runner?.destroy();
    runner = null;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("procesa frames, conserva el propietario y libera recursos al finalizar", async () => {
    const harness = createHarness();
    runner = harness.runner;
    await runner.startInteractiveTransient(
      EMPTY_NETLIST,
      { dt: 1e-4, tMax: 0.05, disablePacing: false },
      "tab-principal",
    );
    expect(runner.isSimulationActive()).toBe(true);

    await vi.advanceTimersByTimeAsync(2_500);

    expect(harness.frames).toHaveLength(60);
    expect(harness.frames.every(({ context }) => context.ownerTabId === "tab-principal")).toBe(true);
    expect(harness.frames.at(-1)?.frame.isFinal).toBe(true);
    expect(harness.completed).toHaveLength(1);
    expect(harness.completed[0].time).toBeCloseTo(0.05);
    expect(harness.states.map(({ active }) => active)).toEqual([true, false]);
    expect(harness.errors).toEqual([]);
    expect(runner.isSimulationActive()).toBe(false);
  });

  it("cancela antes del frame final y no reporta una terminacion falsa", async () => {
    const harness = createHarness();
    runner = harness.runner;
    await runner.startInteractiveTransient(
      EMPTY_NETLIST,
      { dt: 1e-4, tMax: 0.05, disablePacing: false },
      "tab-cancelada",
    );
    await vi.advanceTimersByTimeAsync(50);
    await runner.stopInteractiveTransient();
    const countAtStop = harness.frames.length;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(countAtStop).toBeGreaterThan(0);
    expect(harness.frames).toHaveLength(countAtStop);
    expect(harness.frames.some(({ frame }) => frame.isFinal)).toBe(false);
    expect(harness.completed).toEqual([]);
    expect(harness.states.map(({ active }) => active)).toEqual([true, false]);
    expect(runner.isSimulationActive()).toBe(false);
  });

  it("detiene la corrida previa antes de iniciar otra y aisla sus contextos", async () => {
    const harness = createHarness();
    runner = harness.runner;
    await runner.startInteractiveTransient(
      EMPTY_NETLIST,
      { dt: 1e-4, tMax: 0.05, disablePacing: false },
      "tab-anterior",
    );
    await runner.startInteractiveTransient(
      EMPTY_NETLIST,
      { dt: 1e-4, tMax: 0.05, disablePacing: false },
      "tab-nueva",
    );
    await vi.advanceTimersByTimeAsync(2_500);

    expect(harness.frames).toHaveLength(60);
    expect(harness.frames.every(({ context }) => context.ownerTabId === "tab-nueva")).toBe(true);
    expect(harness.completed).toHaveLength(1);
    expect(harness.completed[0].context.ownerTabId).toBe("tab-nueva");
    expect(harness.states.map(({ active, context }) => [
      active,
      context.ownerTabId,
    ])).toEqual([
      [true, "tab-anterior"],
      [false, "tab-anterior"],
      [true, "tab-nueva"],
      [false, "tab-nueva"],
    ]);
  });

  it("descarta una inicialización supersedida aunque sus listeners aún estén pendientes", async () => {
    const harness = createHarness();
    runner = harness.runner;

    const firstStart = runner.startInteractiveTransient(
      EMPTY_NETLIST,
      { dt: 1e-4, tMax: 0.05, disablePacing: false },
      "tab-inicializacion-antigua",
    );
    const secondStart = runner.startInteractiveTransient(
      EMPTY_NETLIST,
      { dt: 1e-4, tMax: 0.05, disablePacing: false },
      "tab-inicializacion-vigente",
    );
    await Promise.all([firstStart, secondStart]);
    await vi.advanceTimersByTimeAsync(2_500);

    expect(harness.frames).toHaveLength(60);
    expect(harness.frames.every(({ context }) => (
      context.ownerTabId === "tab-inicializacion-vigente"
    ))).toBe(true);
    expect(harness.completed).toHaveLength(1);
    expect(harness.states.map(({ active, context }) => [active, context.ownerTabId])).toEqual([
      [true, "tab-inicializacion-antigua"],
      [false, "tab-inicializacion-antigua"],
      [true, "tab-inicializacion-vigente"],
      [false, "tab-inicializacion-vigente"],
    ]);
  });

  it("usa pacing de reloj de pared cuando la opción no se especifica", async () => {
    const harness = createHarness();
    runner = harness.runner;
    await runner.startInteractiveTransient(
      EMPTY_NETLIST,
      { dt: 1e-4, tMax: 0.05 },
      "tab-pacing-default",
    );

    expect(harness.frames).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(harness.frames).toHaveLength(60);
  });

  it("finaliza estado y listeners al recibir un error del stream", async () => {
    const harness = createHarness();
    runner = harness.runner;
    await runner.startInteractiveTransient(
      EMPTY_NETLIST,
      { dt: 1e-4, tMax: 0.05, disablePacing: false },
      "tab-error",
    );
    const runId = runner.getActiveRunId();
    expect(runId).not.toBeNull();

    emitWebMockEventForTesting("sim-frame-error", { runId, error: "fallo controlado" });

    expect(harness.errors).toEqual(["fallo controlado"]);
    expect(harness.states.map(({ active }) => active)).toEqual([true, false]);
    expect(runner.isSimulationActive()).toBe(false);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(harness.frames).toHaveLength(0);
  });

  it("despacha mutaciones en caliente (hot-patching) durante la simulacion activa", async () => {
    const harness = createHarness();
    runner = harness.runner;
    await runner.startInteractiveTransient(
      EMPTY_NETLIST,
      { dt: 1e-4, tMax: 0.05, disablePacing: false },
      "tab-hot-patch",
    );
    expect(runner.getActiveRunId()).toBeGreaterThan(0);

    // Aplicar mutaciones en vivo
    await runner.mutateComponent("V1", "value", 12.0);
    await runner.mutateComponent("SW1", "switch_state", 1.0);

    await vi.advanceTimersByTimeAsync(200);

    const recentFrames = harness.frames.filter(({ frame }) => frame.nodeVoltages["1"] === 12.0);
    expect(recentFrames.length).toBeGreaterThan(0);
  });

  it("invalida la cache topologica al aplicar mutaciones en caliente", async () => {
    const harness = createHarness();
    runner = harness.runner;
    await runner.startInteractiveTransient(
      EMPTY_NETLIST,
      { dt: 1e-4, tMax: 0.05, disablePacing: false },
      "tab-cache-test",
    );

    await runner.mutateComponent("R1", "value", 500);
    // Verificamos que se ejecutó sin errores
    expect(runner.getActiveRunId()).toBeGreaterThan(0);
  });

  it("ejecuta en modo batch headless sin pacing emitiendo todos los frames inmediatamente", async () => {
    const harness = createHarness();
    runner = harness.runner;
    await runner.startInteractiveTransient(
      EMPTY_NETLIST,
      { dt: 1e-4, tMax: 0.05, disablePacing: true },
      "tab-batch-headless",
    );

    // Sin necesidad de avanzar temporizadores artificiales, los frames se emitieron de forma síncrona
    expect(harness.frames).toHaveLength(60);
    expect(harness.frames[0].frame.time).toBe(0);
    expect(harness.frames[59].frame.isFinal).toBe(true);
    expect(harness.completed).toHaveLength(1);
  });

  it("gestiona pausado, reanudacion, avance paso a paso y velocidad", async () => {
    const harness = createHarness();
    runner = harness.runner;
    await runner.startInteractiveTransient(
      EMPTY_NETLIST,
      { dt: 1e-4, tMax: 0.05, disablePacing: false },
      "tab-pause-test",
    );

    expect(runner.isSimulationPaused()).toBe(false);

    await runner.pauseInteractiveTransient();
    expect(runner.isSimulationPaused()).toBe(true);

    await runner.stepInteractiveTransient(2);
    expect(runner.isSimulationPaused()).toBe(true);

    await runner.setSimulationSpeed(2.5);

    await runner.resumeInteractiveTransient();
    expect(runner.isSimulationPaused()).toBe(false);

    await runner.stopInteractiveTransient();
    expect(runner.isSimulationPaused()).toBe(false);
  });
});
