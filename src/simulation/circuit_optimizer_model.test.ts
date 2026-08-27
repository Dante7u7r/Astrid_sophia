import { describe, expect, it } from "vitest";
import {
  validateOptimizationSetup,
  formatOptimizationSummary,
  type OptimizableParam,
  type OptimizationTarget,
  type OptimizationResult,
} from "./circuit_optimizer_model";

describe("circuit_optimizer_model", () => {
  it("valida correctamente parámetros y objetivos válidos", () => {
    const params: OptimizableParam[] = [
      {
        componentId: "R2",
        property: "value",
        minVal: 10,
        maxVal: 10000,
        initialVal: 1000,
      },
    ];

    const targets: OptimizationTarget[] = [
      {
        type: "dcNodeVoltage",
        node: "2",
        targetVoltage: 3.3,
        weight: 1.0,
      },
    ];

    const result = validateOptimizationSetup(params, targets);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("detecta violaciones de límites en parámetros y objetivos vacíos", () => {
    const invalidParams: OptimizableParam[] = [
      {
        componentId: "",
        property: "value",
        minVal: 1000,
        maxVal: 100, // min > max
        initialVal: 50, // fuera de cotas
      },
    ];

    const invalidTargets: OptimizationTarget[] = [
      {
        type: "dcNodeVoltage",
        node: "out",
        targetVoltage: 5.0,
        weight: -1.0, // peso no positivo
      },
    ];

    const result = validateOptimizationSetup(invalidParams, invalidTargets);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it("formatea adecuadamente el resumen de resultados de optimización", () => {
    const mockResult: OptimizationResult = {
      converged: true,
      iterations: 12,
      initialCost: 1.25,
      finalCost: 1.45e-7,
      optimalParameters: {
        "R2.value": 500.0,
        "C1.value": 1.5915e-8,
      },
      history: [
        {
          iteration: 0,
          cost: 1.25,
          parameters: { "R2.value": 100.0 },
          achievedValues: { target_0_DcNodeVoltage_2: 0.909 },
        },
        {
          iteration: 12,
          cost: 1.45e-7,
          parameters: { "R2.value": 500.0 },
          achievedValues: { target_0_DcNodeVoltage_2: 3.3333 },
        },
      ],
      achievedTargets: {
        "target_0_DcNodeVoltage_2": 3.3333,
      },
    };

    const summary = formatOptimizationSummary(mockResult);
    expect(summary).toContain("=== RESULTADOS DEL AUTO-TUNING DE CIRCUITO ===");
    expect(summary).toContain("Estado: CONVERGIDO");
    expect(summary).toContain("Iteraciones ejecutadas: 12");
    expect(summary).toContain("R2.value = 500.000");
    expect(summary).toContain("target_0_DcNodeVoltage_2: 3.3333");
  });
});
