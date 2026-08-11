import { describe, expect, it, vi } from "vitest";
import type { CircuitNetlist } from "../simulation/netlist_extractor";
import {
  collectComponentFirmware,
  solveTransientCircuitWithWorker,
} from "./local_transient_solver";

function createNetlist(): CircuitNetlist {
  return {
    components: [
      { id: "R1", type: "resistor", value: 1000, pins: ["1", "0"] },
    ],
    wires: [],
  };
}

describe("local_transient_solver", () => {
  it("colecta firmware solo de componentes que lo tienen", () => {
    const firmware = new Uint8Array([1, 2, 3]);

    expect(collectComponentFirmware([
      { id: "U1", firmware },
      { id: "R1" },
    ])).toEqual({ U1: firmware });
  });

  it("envia netlist, tiempo y firmware al worker local", async () => {
    const terminate = vi.fn();
    const postMessage = vi.fn(function (this: any) {
      this.onmessage?.({
        data: {
          type: "success",
          results: [{ time: 0, nodeVoltages: { "1": 5 }, branchCurrents: {} }],
        },
      });
    });
    const worker = {
      onmessage: null,
      onerror: null,
      postMessage,
      terminate,
    } as any;
    const firmware = new Uint8Array([7]);
    const netlist = createNetlist();

    const result = await solveTransientCircuitWithWorker(
      netlist,
      0.001,
      0.05,
      [{ id: "U1", firmware }],
      () => worker,
    );

    expect(result).toEqual([{ time: 0, nodeVoltages: { "1": 5 }, branchCurrents: {} }]);
    expect(postMessage).toHaveBeenCalledWith({
      type: "run_fallback",
      netlist,
      dt: 0.001,
      tMax: 0.05,
      firmware: { U1: firmware },
    });
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("resuelve con mensaje de error y termina worker si falla", async () => {
    const terminate = vi.fn();
    const postMessage = vi.fn(function (this: any) {
      this.onerror?.({ message: "worker roto" });
    });
    const worker = {
      onmessage: null,
      onerror: null,
      postMessage,
      terminate,
    } as any;

    await expect(solveTransientCircuitWithWorker(
      createNetlist(),
      0.001,
      0.05,
      [],
      () => worker,
    )).resolves.toBe("worker roto");
    expect(terminate).toHaveBeenCalledOnce();
  });
});
