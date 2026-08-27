import type { ProcessCorner, PvtConfig } from "./mcu-types";
import type { PvtRunResult } from "../ui/oscilloscope_panel";
import { calculateAutomatedMeasurements, type AutomatedMeasurementItem } from "./automated_measurements";

export interface CornerSpec {
  id: string;
  name: string;
  metricKey: "vpp" | "vrms" | "vavg" | "risetime" | "falltime" | "overshoot" | "settlingtime" | "thd";
  node: string;
  min?: number;
  max?: number;
  unit: string;
}

export interface CornerSpecCheckResult {
  specId: string;
  specName: string;
  metricKey: string;
  node: string;
  measured: number;
  unit: string;
  min?: number;
  max?: number;
  pass: boolean;
  marginPercent?: number;
}

export interface CornerMatrixCell {
  corner: ProcessCorner;
  temperatureC: number;
  voltageScaling: number;
  converged: boolean;
  measuredValue: number;
  unit: string;
  pass: boolean;
  status: "pass" | "fail" | "not_converged";
  specChecks: CornerSpecCheckResult[];
  tooltip: string;
}

export interface CornerAnalysisReport {
  timestamp: string;
  circuitName: string;
  totalCorners: number;
  passedCorners: number;
  failedCorners: number;
  yieldPercent: number;
  specs: CornerSpec[];
  cells: CornerMatrixCell[];
  corners: ProcessCorner[];
  temperatures: number[];
  voltages: number[];
}

/**
 * Evalúa una métrica medida contra las restricciones mínimas y máximas de una especificación.
 */
export function evaluateSpecCheck(
  spec: CornerSpec,
  measured: number,
): CornerSpecCheckResult {
  let pass = true;
  let marginPercent: number | undefined = undefined;

  if (spec.min !== undefined && Number.isFinite(spec.min)) {
    if (measured < spec.min) {
      pass = false;
    }
  }

  if (spec.max !== undefined && Number.isFinite(spec.max)) {
    if (measured > spec.max) {
      pass = false;
    }
  }

  if (spec.max !== undefined && spec.min !== undefined && spec.max > spec.min) {
    const range = spec.max - spec.min;
    if (pass) {
      const distToClosestBound = Math.min(Math.abs(measured - spec.min), Math.abs(spec.max - measured));
      marginPercent = (distToClosestBound / range) * 100;
    } else {
      const violation = measured > spec.max ? measured - spec.max : spec.min - measured;
      marginPercent = -(violation / range) * 100;
    }
  }

  return {
    specId: spec.id,
    specName: spec.name,
    metricKey: spec.metricKey,
    node: spec.node,
    measured,
    unit: spec.unit,
    min: spec.min,
    max: spec.max,
    pass,
    marginPercent,
  };
}

/**
 * Extrae el valor numérico correspondiente a una clave de métrica a partir del reporte de mediciones.
 */
export function extractMetricValue(
  measurements: readonly AutomatedMeasurementItem[],
  metricKey: CornerSpec["metricKey"],
  node: string,
): number {
  const targetId = `meas-${node}-${metricKey.toLowerCase()}`;
  const found = measurements.find((m) => m.id === targetId || (m.node === node && m.name.toLowerCase().includes(metricKey)));
  return found?.value ?? 0.0;
}

/**
 * Genera el reporte matricial de análisis de esquinas (PVT Heatmap Report) con evaluación de specs.
 */
export function buildCornerAnalysisReport(
  pvtResults: readonly PvtRunResult[],
  specs: readonly CornerSpec[],
  circuitName = "Circuito Biaani",
  primarySpecMetric?: CornerSpec["metricKey"],
): CornerAnalysisReport {
  const cornersSet = new Set<ProcessCorner>();
  const tempsSet = new Set<number>();
  const voltsSet = new Set<number>();

  const cells: CornerMatrixCell[] = [];
  let passedCorners = 0;

  for (const res of pvtResults) {
    cornersSet.add(res.config.corner);
    tempsSet.add(res.config.temperatureC);
    voltsSet.add(res.config.voltageScaling);

    if (!res.converged || res.transient.length < 2) {
      cells.push({
        corner: res.config.corner,
        temperatureC: res.config.temperatureC,
        voltageScaling: res.config.voltageScaling,
        converged: false,
        measuredValue: 0,
        unit: "",
        pass: false,
        status: "not_converged",
        specChecks: [],
        tooltip: `${res.config.corner.toUpperCase()} | ${res.config.temperatureC}°C | ${(res.config.voltageScaling * 100).toFixed(0)}% VDD: NO CONVERGIÓ`,
      });
      continue;
    }

    const activeNodes = Array.from(new Set(specs.map((s) => s.node)));
    const measurements = calculateAutomatedMeasurements(
      res.transient,
      null,
      activeNodes.length > 0 ? activeNodes : ["1", "2", "out"],
    );

    const specChecks: CornerSpecCheckResult[] = [];
    let allPassed = true;

    for (const spec of specs) {
      const val = extractMetricValue(measurements, spec.metricKey, spec.node);
      const check = evaluateSpecCheck(spec, val);
      specChecks.push(check);
      if (!check.pass) {
        allPassed = false;
      }
    }

    if (allPassed && (specs.length === 0 || specChecks.length > 0)) {
      passedCorners++;
    }

    const primarySpec = specs.find((s) => s.metricKey === primarySpecMetric) || specs[0];
    const primaryVal = primarySpec ? extractMetricValue(measurements, primarySpec.metricKey, primarySpec.node) : (measurements[0]?.value ?? 0);
    const primaryUnit = primarySpec?.unit ?? measurements[0]?.unit ?? "";

    const status = allPassed ? "pass" : "fail";
    const tooltip = `${res.config.corner.toUpperCase()} | ${res.config.temperatureC}°C | ${(res.config.voltageScaling * 100).toFixed(0)}% VDD\n${primarySpec ? `${primarySpec.name}: ${primaryVal.toFixed(3)}${primaryUnit}` : ""}\nEstado: ${allPassed ? "PASS ✓" : "FAIL ✗"}`;

    cells.push({
      corner: res.config.corner,
      temperatureC: res.config.temperatureC,
      voltageScaling: res.config.voltageScaling,
      converged: true,
      measuredValue: primaryVal,
      unit: primaryUnit,
      pass: allPassed,
      status,
      specChecks,
      tooltip,
    });
  }

  const total = pvtResults.length;
  const yieldPercent = total > 0 ? (passedCorners / total) * 100 : 100;

  const sortedCorners = Array.from(cornersSet).sort();
  const sortedTemps = Array.from(tempsSet).sort((a, b) => a - b);
  const sortedVolts = Array.from(voltsSet).sort((a, b) => a - b);

  return {
    timestamp: new Date().toISOString(),
    circuitName,
    totalCorners: total,
    passedCorners,
    failedCorners: total - passedCorners,
    yieldPercent,
    specs: [...specs],
    cells,
    corners: sortedCorners,
    temperatures: sortedTemps,
    voltages: sortedVolts,
  };
}

/**
 * Genera la matriz completa de esquinas industriales (3x3x3 o 5x3x3).
 */
export function generateFullPvtMatrixConfigs(
  corners: readonly ProcessCorner[] = ["tt", "ff", "ss", "fs", "sf"],
  temperatures: readonly number[] = [-40, 27, 125],
  voltageScalings: readonly number[] = [0.90, 1.0, 1.10],
): PvtConfig[] {
  const configs: PvtConfig[] = [];
  for (const corner of corners) {
    for (const temperatureC of temperatures) {
      for (const voltageScaling of voltageScalings) {
        configs.push({ corner, temperatureC, voltageScaling });
      }
    }
  }
  return configs;
}

/**
 * Exporta el reporte matricial de esquinas a formato CSV estructurado.
 */
export function exportCornerAnalysisToCsv(report: CornerAnalysisReport): string {
  const lines: string[] = [
    `# Dashboard de Análisis de Esquinas PVT - Biaani`,
    `# Circuito: ${report.circuitName}`,
    `# Fecha: ${report.timestamp}`,
    `# Esquinas Totales: ${report.totalCorners} | Aprobadas: ${report.passedCorners} | Fallidas: ${report.failedCorners} | Rendimiento (Yield): ${report.yieldPercent.toFixed(1)}%`,
    `#`,
    `Corner,Temperatura_C,Voltaje_Scaling_VDD,Estado_Convergencia,Resultado_Global,${report.specs.map((s) => `"${s.name} (${s.unit})"`).join(",")}`,
  ];

  for (const cell of report.cells) {
    const specCols = cell.specChecks.map((sc) => `${sc.measured.toFixed(4)} [${sc.pass ? "PASS" : "FAIL"}]`).join(",");
    lines.push(`${cell.corner.toUpperCase()},${cell.temperatureC},${cell.voltageScaling.toFixed(2)},${cell.converged ? "SI" : "NO"},${cell.pass ? "PASS" : "FAIL"},${specCols}`);
  }

  return lines.join("\r\n");
}
