//! WebAssembly Solver Bridge for Astryd Sophia
//! Loads and runs high-performance Rust MNA solver compiled to WASM in browser environments

import type { CircuitNetlist } from "./netlist_extractor";
import type { DcSimulationResult } from "./tauri_commands";
import type { AcSweepResult, TimeStepResult } from "../ui/oscilloscope_panel";

export type TransientSimulationResult = {
  timeSteps: TimeStepResult[];
  converged: boolean;
  error?: string | null;
};

type WasmSolverModule = {
  solve_dc_wasm_core: (netlistJson: string) => string;
  solve_transient_wasm_core: (netlistJson: string, tStop: number, maxStep: number) => string;
  solve_ac_wasm_core: (netlistJson: string, fStart: number, fStop: number, pointsPerDecade: number) => string;
};

let wasmModule: WasmSolverModule | null = null;
let wasmLoadAttempted = false;

export async function initWasmSolver(): Promise<boolean> {
  if (wasmModule) return true;
  if (wasmLoadAttempted) return false;
  wasmLoadAttempted = true;

  try {
    // Attempt dynamic import if wasm package is available
    // @ts-expect-error - wasm module is dynamically loaded or bundled
    const wasm = await import("./wasm_pkg/astryd_sophia_wasm.js").catch(() => null);
    if (wasm && typeof wasm.solve_dc_wasm_core === "function") {
      wasmModule = wasm;
      return true;
    }
  } catch {
    // WASM bundle not present, fallback to TS solver
  }
  return false;
}

export function isWasmSolverAvailable(): boolean {
  return wasmModule !== null;
}

export async function solveDcWasm(netlist: CircuitNetlist): Promise<DcSimulationResult> {
  if (!wasmModule) {
    throw new Error("WASM solver is not loaded");
  }
  const json = JSON.stringify(netlist);
  const resultJson = wasmModule.solve_dc_wasm_core(json);
  return JSON.parse(resultJson) as DcSimulationResult;
}

export async function solveTransientWasm(
  netlist: CircuitNetlist,
  tStop: number,
  maxStep: number
): Promise<TransientSimulationResult> {
  if (!wasmModule) {
    throw new Error("WASM solver is not loaded");
  }
  const json = JSON.stringify(netlist);
  const resultJson = wasmModule.solve_transient_wasm_core(json, tStop, maxStep);
  return JSON.parse(resultJson) as TransientSimulationResult;
}

export async function solveAcWasm(
  netlist: CircuitNetlist,
  fStart: number,
  fStop: number,
  pointsPerDecade: number
): Promise<AcSweepResult> {
  if (!wasmModule) {
    throw new Error("WASM solver is not loaded");
  }
  const json = JSON.stringify(netlist);
  const resultJson = wasmModule.solve_ac_wasm_core(json, fStart, fStop, pointsPerDecade);
  return JSON.parse(resultJson) as AcSweepResult;
}
