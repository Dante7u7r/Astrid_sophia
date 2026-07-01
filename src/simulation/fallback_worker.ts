import { solveTransientCircuitTS } from "./fallback_solver";

self.onmessage = (e: MessageEvent) => {
  const { netlist, dt, tMax, firmware } = e.data;
  try {
    const results = solveTransientCircuitTS(netlist, dt, tMax, firmware);
    if (typeof results === "string") {
      self.postMessage({ type: "error", error: results });
    } else {
      self.postMessage({ type: "success", results });
    }
  } catch (err: any) {
    self.postMessage({ type: "error", error: err.message || String(err) });
  }
};
