import { describe, expect, it } from "vitest";
import {
  evaluateSpecCheck,
  buildCornerAnalysisReport,
  generateFullPvtMatrixConfigs,
  exportCornerAnalysisToCsv,
  type CornerSpec,
} from "./corner_analysis_model";
import type { PvtRunResult } from "../ui/oscilloscope_panel";

describe("corner_analysis_model", () => {
  it("evalúa especificaciones de cota mínima, máxima y cálculo de margen", () => {
    const spec: CornerSpec = {
      id: "spec-1",
      name: "Voltaje Vpp",
      metricKey: "vpp",
      node: "out",
      min: 3.0,
      max: 5.0,
      unit: "V",
    };

    // Caso 1: Valor en rango (4.0 V) -> PASS
    const passCheck = evaluateSpecCheck(spec, 4.0);
    expect(passCheck.pass).toBe(true);
    expect(passCheck.marginPercent).toBeCloseTo(50.0);

    // Caso 2: Violación de cota inferior (2.5 V) -> FAIL
    const failMin = evaluateSpecCheck(spec, 2.5);
    expect(failMin.pass).toBe(false);
    expect(failMin.marginPercent).toBeLessThan(0);

    // Caso 3: Violación de cota superior (5.5 V) -> FAIL
    const failMax = evaluateSpecCheck(spec, 5.5);
    expect(failMax.pass).toBe(false);
    expect(failMax.marginPercent).toBeLessThan(0);
  });

  it("genera matriz completa de configuraciones PVT", () => {
    const configs = generateFullPvtMatrixConfigs(["tt", "ff", "ss"], [27, 70], [1.0, 1.1]);
    expect(configs).toHaveLength(12); // 3 corners * 2 temps * 2 volts
    expect(configs[0]).toEqual({ corner: "tt", temperatureC: 27, voltageScaling: 1.0 });
  });

  it("construye reporte matricial de esquinas y calcula rendimiento (yield)", () => {
    const mockPvtResults: PvtRunResult[] = [
      {
        config: { corner: "tt", temperatureC: 27, voltageScaling: 1.0 },
        converged: true,
        transient: [
          { time: 0, nodeVoltages: { "out": 0 }, branchCurrents: {} },
          { time: 0.001, nodeVoltages: { "out": 3.3 }, branchCurrents: {} },
        ],
        error: null,
      },
      {
        config: { corner: "ss", temperatureC: -40, voltageScaling: 0.9 },
        converged: true,
        transient: [
          { time: 0, nodeVoltages: { "out": 0 }, branchCurrents: {} },
          { time: 0.001, nodeVoltages: { "out": 2.0 }, branchCurrents: {} },
        ],
        error: null,
      },
    ];

    const specs: CornerSpec[] = [
      {
        id: "spec-vpp",
        name: "Vpp > 3.0V",
        metricKey: "vpp",
        node: "out",
        min: 3.0,
        unit: "V",
      },
    ];

    const report = buildCornerAnalysisReport(mockPvtResults, specs, "Inversor CMOS");
    expect(report.totalCorners).toBe(2);
    expect(report.passedCorners).toBe(1);
    expect(report.failedCorners).toBe(1);
    expect(report.yieldPercent).toBe(50.0);

    const csv = exportCornerAnalysisToCsv(report);
    expect(csv).toContain("# Dashboard de Análisis de Esquinas PVT - Astryd Sophia");
    expect(csv).toContain("Rendimiento (Yield): 50.0%");
    expect(csv).toContain("TT,27,1.00,SI,PASS");
    expect(csv).toContain("SS,-40,0.90,SI,FAIL");
  });
});
