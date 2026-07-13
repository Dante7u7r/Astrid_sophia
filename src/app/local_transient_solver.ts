import type { ComponentInstance } from "../canvas_orchestrator";
import type { CircuitNetlist } from "../simulation/netlist_extractor";
import type { TimeStepResult } from "../ui/oscilloscope_panel";

type SolverWorker = Pick<Worker, "postMessage" | "terminate"> & {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

type SolverWorkerFactory = () => SolverWorker;

export function collectComponentFirmware(
  components: readonly Pick<ComponentInstance, "id" | "firmware">[],
): Record<string, Uint8Array> {
  const firmware: Record<string, Uint8Array> = {};
  for (const component of components) {
    if (component.firmware) {
      firmware[component.id] = component.firmware;
    }
  }
  return firmware;
}

function createDefaultSolverWorker(): SolverWorker {
  return new Worker(
    new URL("../simulation/co_simulation_worker.ts", import.meta.url),
    { type: "module" },
  );
}

export async function solveTransientCircuitWithWorker(
  netlist: CircuitNetlist,
  dt: number,
  tMax: number,
  components: readonly Pick<ComponentInstance, "id" | "firmware">[],
  workerFactory: SolverWorkerFactory = createDefaultSolverWorker,
): Promise<TimeStepResult[] | string> {
  const firmware = collectComponentFirmware(components);
  const worker = workerFactory();

  return new Promise<TimeStepResult[] | string>((resolve) => {
    worker.onmessage = (event) => {
      const data = event.data;
      if (data.type === "success") {
        resolve(data.results);
      } else {
        resolve(data.error);
      }
      worker.terminate();
    };

    worker.onerror = (error) => {
      resolve(error.message || "Error desconocido en el Worker transitorio local");
      worker.terminate();
    };

    worker.postMessage({ type: "run_fallback", netlist, dt, tMax, firmware });
  });
}
