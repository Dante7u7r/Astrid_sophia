import { describe, expect, it } from "vitest";
import {
  calculateEyeDiagram,
  exportEyeDiagramReportToCsv,
  STANDARD_HEX_EYE_MASK,
} from "./eye_diagram_model";
import type { TimeStepResult } from "../ui/oscilloscope_panel";

describe("eye_diagram_model", () => {
  // Generador de señal de reloj / PRBS con frecuencia f = 10 MHz (UI = 100 ns)
  function generateClockWaveform(
    freq = 10e6,
    duration = 2e-6,
    dt = 1e-9,
    amplitude = 3.3,
    jitterStd = 0,
  ): TimeStepResult[] {
    const results: TimeStepResult[] = [];
    const ui = 1 / freq;
    let t = 0;

    while (t <= duration) {
      // Onda cuadrada suavizada con tanh
      const phase = (t / ui) % 1.0;
      const jitterVal = jitterStd > 0 ? (Math.random() - 0.5) * jitterStd : 0;
      const v = amplitude / (1 + Math.exp(-((phase + jitterVal - 0.5) * 20)));

      results.push({
        time: t,
        nodeVoltages: { "out": v },
        branchCurrents: {},
      });
      t += dt;
    }
    return results;
  }

  it("recupera reloj, Unit Interval y genera rodajas plegadas (folding)", () => {
    const transient = generateClockWaveform(10e6, 2e-6, 1e-9, 3.3);
    const result = calculateEyeDiagram(transient, "out");

    expect(result).not.toBeNull();
    expect(result!.unitInterval).toBeCloseTo(50e-9, 7);
    expect(result!.baudRate).toBeCloseTo(20e6, -4);
    expect(result!.slices.length).toBeGreaterThanOrEqual(15);
    expect(result!.eyeHeight).toBeGreaterThan(2.0); // Apertura clara de ojo
    expect(result!.eyeWidthUi).toBeGreaterThan(0.5); // Más del 50% de UI abierto
  });

  it("calcula métricas de Jitter (TIE, Period Jitter, Cycle-to-Cycle)", () => {
    const transient = generateClockWaveform(10e6, 2e-6, 1e-9, 3.3);
    const result = calculateEyeDiagram(transient, "out");

    expect(result).not.toBeNull();
    const jitter = result!.jitter;
    expect(jitter.tieSamples.length).toBeGreaterThan(0);
    expect(jitter.periodJitterSamples.length).toBeGreaterThan(0);
    expect(Number.isFinite(jitter.tieRms)).toBe(true);
    expect(Number.isFinite(jitter.periodJitterRms)).toBe(true);
    expect(Number.isFinite(jitter.cycleToCycleJitterRms)).toBe(true);
    expect(Number.isFinite(jitter.totalJitter)).toBe(true);
  });

  it("detecta violaciones de máscara central de cumplimiento", () => {
    const transient = generateClockWaveform(10e6, 2e-6, 1e-9, 3.3);
    const resultWithMask = calculateEyeDiagram(transient, "out", {
      mask: STANDARD_HEX_EYE_MASK,
    });

    expect(resultWithMask).not.toBeNull();
    expect(typeof resultWithMask!.maskViolationsCount).toBe("number");
  });

  it("exporta reporte completo de Eye Diagram y Jitter a formato CSV", () => {
    const transient = generateClockWaveform(10e6, 2e-6, 1e-9, 3.3);
    const result = calculateEyeDiagram(transient, "out")!;

    const csv = exportEyeDiagramReportToCsv(result, { circuitName: "Transmisor SerDes" });
    expect(csv).toContain("# Reporte de Diagrama de Ojo y Análisis de Jitter");
    expect(csv).toContain("Circuito: Transmisor SerDes");
    expect(csv).toContain("eye_height");
    expect(csv).toContain("tie_rms");
    expect(csv).toContain("period_jitter_rms");
    expect(csv).toContain("total_jitter_tj");
  });
});
