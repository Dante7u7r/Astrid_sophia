// ==========================================================================
// ASTRYD SOPHIA — CIRCUIT PARAMETRIC OPTIMIZER & AUTO-TUNING MODEL
// ==========================================================================

import { invoke } from "@tauri-apps/api/core";
import type { CircuitNetlist } from "./netlist_extractor";

export interface OptimizableParam {
  componentId: string;
  property: "value" | "w" | "l" | "ron" | "igbt_kp" | "rth";
  minVal: number;
  maxVal: number;
  initialVal: number;
}

export type OptimizationTarget =
  | {
      type: "dcNodeVoltage";
      node: string;
      targetVoltage: number;
      weight: number;
    }
  | {
      type: "dcBranchCurrent";
      vsourceId: string;
      targetCurrent: number;
      weight: number;
    }
  | {
      type: "acGainAtFreq";
      node: string;
      freq: number;
      targetGainDb: number;
      weight: number;
    }
  | {
      type: "acCutoffFreq";
      node: string;
      refFreq: number;
      targetCutoffFreq: number;
      weight: number;
    }
  | {
      type: "transientRiseTime";
      node: string;
      targetRiseTime: number;
      tMax: number;
      weight: number;
    }
  | {
      type: "transientSettleVoltage";
      node: string;
      targetVoltage: number;
      tMax: number;
      weight: number;
    };

export interface OptimizationSettings {
  maxIterations?: number;
  tolerance?: number;
  initialMu?: number;
}

export interface OptimizationIteration {
  iteration: number;
  cost: number;
  parameters: Record<string, number>;
  achievedValues: Record<string, number>;
}

export interface OptimizationResult {
  converged: boolean;
  iterations: number;
  initialCost: number;
  finalCost: number;
  optimalParameters: Record<string, number>;
  history: OptimizationIteration[];
  achievedTargets: Record<string, number>;
}

/**
 * Valida la configuración de optimización antes del despacho numérico.
 */
export function validateOptimizationSetup(
  params: OptimizableParam[],
  targets: OptimizationTarget[],
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!params || params.length === 0) {
    errors.push("Debe especificarse al menos un parámetro optimizable.");
  } else {
    for (const p of params) {
      if (!p.componentId || p.componentId.trim() === "") {
        errors.push("Todo parámetro debe tener un componentId válido.");
      }
      if (p.minVal >= p.maxVal) {
        errors.push(`El límite inferior (${p.minVal}) de ${p.componentId} debe ser estrictamente menor que el superior (${p.maxVal}).`);
      }
      if (p.initialVal < p.minVal || p.initialVal > p.maxVal) {
        errors.push(`El valor inicial (${p.initialVal}) de ${p.componentId} debe estar dentro de las cotas [${p.minVal}, ${p.maxVal}].`);
      }
    }
  }

  if (!targets || targets.length === 0) {
    errors.push("Debe definirse al menos un objetivo de diseño.");
  } else {
    for (const t of targets) {
      if (t.weight <= 0) {
        errors.push("El peso (weight) de cada objetivo debe ser positivo.");
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Genera un resumen legible en español con los resultados de la optimización.
 */
export function formatOptimizationSummary(result: OptimizationResult): string {
  const status = result.converged ? "CONVERGIDO" : "NO CONVERGIDO (Límite de iteraciones alcanzado)";
  const lines: string[] = [
    `=== RESULTADOS DEL AUTO-TUNING DE CIRCUITO ===`,
    `Estado: ${status}`,
    `Iteraciones ejecutadas: ${result.iterations}`,
    `Costo inicial: ${result.initialCost.toExponential(4)}`,
    `Costo final: ${result.finalCost.toExponential(4)} (Reducción: ${(((result.initialCost - result.finalCost) / Math.max(1e-12, result.initialCost)) * 100).toFixed(2)}%)`,
    ``,
    `--- Parámetros Óptimos Encontrados ---`,
  ];

  for (const [key, val] of Object.entries(result.optimalParameters)) {
    lines.push(`  • ${key} = ${val.toPrecision(6)}`);
  }

  lines.push(``, `--- Métricas Alcanzadas ---`);
  for (const [key, val] of Object.entries(result.achievedTargets)) {
    lines.push(`  • ${key}: ${val.toFixed(4)}`);
  }

  return lines.join("\n");
}

/**
 * Ejecuta la optimización paramétrica a través del backend Tauri IPC.
 */
export async function executeCircuitOptimization(
  netlist: CircuitNetlist,
  params: OptimizableParam[],
  targets: OptimizationTarget[],
  settings?: OptimizationSettings,
): Promise<OptimizationResult> {
  const validation = validateOptimizationSetup(params, targets);
  if (!validation.valid) {
    throw new Error(`Configuración de optimización inválida:\n${validation.errors.join("\n")}`);
  }

  return await invoke<OptimizationResult>("run_circuit_optimization", {
    netlist,
    params,
    targets,
    settings: settings ?? {
      maxIterations: 40,
      tolerance: 1e-4,
      initialMu: 1e-3,
    },
  });
}
