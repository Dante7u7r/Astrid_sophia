// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPendingTimeouts, dispatchSimulation, type DispatchCallbacks } from "./simulation_dispatcher";
import type { CircuitNetlist } from "./netlist_extractor";
import type { SimulationRunner } from "./simulation_runner";

const invoke = vi.hoisted(() => vi.fn());
const isNative = vi.hoisted(() => vi.fn(() => true));
vi.mock("./tauri_commands", () => ({ invokeTyped: invoke }));
vi.mock("./tauri_mock", () => ({ isTauriEnvironment: isNative }));

const netlist: CircuitNetlist = { components: [], wires: [] };
const result = { nodeVoltages: { "0": 0, "1": 5 }, branchCurrents: {}, converged: true };
function callbacks() {
  return {
    addLog: vi.fn(), onResultsReady: vi.fn(), onSolverResult: vi.fn(),
    onIpcStatusUpdate: vi.fn(), updateCanvasRendering: vi.fn(), onSimulationFinished: vi.fn(),
  } satisfies DispatchCallbacks;
}

afterEach(() => {
  clearPendingTimeouts();
  vi.useRealTimers();
  vi.resetAllMocks();
  isNative.mockReturnValue(true);
});

describe("evidencia estructurada del motor de simulación", () => {
  it("identifica como mock los datos prefabricados del transporte web", async () => {
    isNative.mockReturnValue(false);
    invoke.mockResolvedValue(result);
    const events = callbacks();
    await dispatchSimulation(netlist, "DC", {
      simSettings: { dt: 1e-4 }, transientDuration: 0.01,
    }, events);
    expect(events.onSolverResult).toHaveBeenCalledExactlyOnceWith("mock");
  });

  it("atribuye DC a Rust solo después de recibir el resultado IPC", async () => {
    const events = callbacks();
    let resolve!: (value: typeof result) => void;
    invoke.mockReturnValue(new Promise<typeof result>((done) => { resolve = done; }));
    const pending = dispatchSimulation(netlist, "DC", {
      simSettings: { dt: 1e-4 }, transientDuration: 0.01,
    }, events);
    expect(events.onSolverResult).not.toHaveBeenCalled();
    resolve(result);
    await pending;
    expect(events.onSolverResult).toHaveBeenCalledExactlyOnceWith("rust");
    expect(events.onResultsReady).toHaveBeenCalledWith("DC", result);
  });

  it.each([false, true])("solo atribuye el fallback cuando produce resultados (fallo=%s)", async (fails) => {
    vi.useFakeTimers();
    invoke.mockRejectedValue(new Error("window.__TAURI__ not found"));
    const events = callbacks();
    await dispatchSimulation(netlist, "DC", {
      simSettings: { dt: 1e-4 }, transientDuration: 0.01,
      solveCircuitTS: () => fails ? "matriz singular" : result,
    }, events);
    expect(events.onSolverResult).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(310);
    if (fails) expect(events.onSolverResult).not.toHaveBeenCalled();
    else expect(events.onSolverResult).toHaveBeenCalledExactlyOnceWith("typescript");
  });

  it("no considera el arranque TRAN como prueba de haber recibido muestras Rust", async () => {
    const events = callbacks();
    await dispatchSimulation(netlist, "TRAN", {
      simSettings: { dt: 1e-4 }, transientDuration: 0.01,
      simulationRunner: { startInteractiveTransient: vi.fn(async () => undefined) } as unknown as SimulationRunner,
    }, events);
    expect(events.onSolverResult).not.toHaveBeenCalled();
  });
});
