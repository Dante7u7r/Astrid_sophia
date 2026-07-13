import { safeInvoke } from "./tauri_mock";
import type { CircuitNetlist } from "./netlist_extractor";
import type { AcSweepResult, TimeStepResult } from "../ui/oscilloscope_panel";

export interface DcSimulationResult {
  nodeVoltages?: Record<string, number>;
  node_voltages?: Record<string, number>;
  branchCurrents?: Record<string, number>;
  branch_currents?: Record<string, number>;
  iterations?: number;
  converged?: boolean;
  error?: string | null;
}

export interface SensitivityEntry {
  componentId: string;
  parameterName: string;
  parameterValue: number;
  absoluteSensitivities: Record<string, number>;
  normalizedSensitivities: Record<string, number>;
}

export interface WorstCaseLimit {
  nominalValue: number;
  maxDeviation: number;
  worstCaseLow: number;
  worstCaseHigh: number;
}

export interface SensitivityAnalysisResult {
  sensitivities: SensitivityEntry[];
  worstCaseLimits: Record<string, WorstCaseLimit>;
  nominalVoltages?: Record<string, number>;
  converged?: boolean;
}

export interface StabilityPole {
  re: number;
  im: number;
}

export interface StabilityAnalysisResult {
  isStable: boolean;
  phaseMargin: number;
  gainMargin: number;
  poles: StabilityPole[];
  zeros?: StabilityPole[];
  converged?: boolean;
}

export type PssSimulationResult = TimeStepResult[];

export interface TauriCommandMap {
  run_dc_simulation: {
    args: { netlist: CircuitNetlist };
    result: DcSimulationResult;
  };
  run_ac_sweep: {
    args: {
      netlist: CircuitNetlist;
      settings: { fStart: number; fEnd: number; pointsPerDecade: number };
    };
    result: AcSweepResult;
  };
  run_sensitivity_analysis: {
    args: { netlist: CircuitNetlist };
    result: SensitivityAnalysisResult;
  };
  run_pss_simulation: {
    args: {
      netlist: CircuitNetlist;
      settings: {
        period: number;
        maxShootingIters: number;
        shootingTolerance: number;
      };
    };
    result: PssSimulationResult;
  };
  run_stability_analysis: {
    args: { netlist: CircuitNetlist };
    result: StabilityAnalysisResult;
  };
}

export type KnownTauriCommand = keyof TauriCommandMap;

export async function invokeTyped<C extends KnownTauriCommand>(
  cmd: C,
  args: TauriCommandMap[C]["args"],
): Promise<TauriCommandMap[C]["result"]> {
  return safeInvoke<TauriCommandMap[C]["result"]>(cmd, args);
}

export type SimulationDispatchResult =
  | DcSimulationResult
  | AcSweepResult
  | SensitivityAnalysisResult
  | PssSimulationResult
  | StabilityAnalysisResult
  | TimeStepResult[];
