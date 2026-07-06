import { describe, expect, test, vi } from "vitest";
import { dispatchSimulation, type DispatchCallbacks } from "./simulation_dispatcher";
import type { CircuitNetlist } from "./netlist_extractor";

const netlist: CircuitNetlist = { components: [], wires: [] };

function callbacks(onFinished: () => void): DispatchCallbacks {
  return {
    addLog: vi.fn(),
    onResultsReady: vi.fn(),
    onIpcStatusUpdate: vi.fn(),
    updateCanvasRendering: vi.fn(),
    onSimulationFinished: onFinished,
  };
}

describe("dispatchSimulation modos especiales", () => {
  test("libera el estado de ejecucion despues de PVT", async () => {
    const onSpecialMode = vi.fn(async () => undefined);
    const onFinished = vi.fn();

    await dispatchSimulation(
      netlist,
      "PVT",
      { simSettings: { dt: 1e-4 }, transientDuration: 0.05, onSpecialMode },
      callbacks(onFinished),
    );

    expect(onSpecialMode).toHaveBeenCalledWith(netlist, "PVT");
    expect(onFinished).toHaveBeenCalledOnce();
  });

  test("libera el estado incluso si SPAR falla", async () => {
    const onFinished = vi.fn();
    const failure = new Error("fallo controlado");

    await expect(dispatchSimulation(
      netlist,
      "SPAR",
      {
        simSettings: { dt: 1e-4 },
        transientDuration: 0.05,
        onSpecialMode: async () => {
          throw failure;
        },
      },
      callbacks(onFinished),
    )).rejects.toThrow("fallo controlado");

    expect(onFinished).toHaveBeenCalledOnce();
  });
});
