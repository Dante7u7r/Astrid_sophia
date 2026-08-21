import { describe, expect, it } from "vitest";
import {
  calculateAutomatedMeasurements,
  exportMeasurementsToCsv,
  exportMeasurementsToJson,
} from "./automated_measurements";
import type { AcSweepResult, TimeStepResult } from "../ui/oscilloscope_panel";

describe("AutomatedMeasurements", () => {
  it("calcula tiempos de subida, bajada, sobreimpulso y establecimiento en respuesta al escalón", () => {
    // Generar escalón subamortiguado con sobreimpulso
    const transient: TimeStepResult[] = [];
    const N = 100;
    for (let i = 0; i < N; i++) {
      const t = (i / N) * 0.01; // 0 a 10 ms
      // V(t) = 1.0 - exp(-t/0.002)*cos(2*pi*500*t)
      const v = i === 0 ? 0.0 : 1.0 - Math.exp(-t / 0.002) * Math.cos(2 * Math.PI * 500 * t);
      transient.push({
        time: t,
        nodeVoltages: { "out": v },
        branchCurrents: {},
      });
    }

    const items = calculateAutomatedMeasurements(transient, null, ["out"]);

    const riseTime = items.find((i) => i.id === "meas-out-risetime");
    expect(riseTime).toBeDefined();
    expect(riseTime!.value).toBeGreaterThan(0);
    expect(riseTime!.value).toBeLessThan(0.005);

    const overshoot = items.find((i) => i.id === "meas-out-overshoot");
    expect(overshoot).toBeDefined();
    expect(overshoot!.value).toBeGreaterThan(10.0);
    expect(overshoot!.value).toBeLessThan(70.0);

    const settlingTime = items.find((i) => i.id === "meas-out-settlingtime");
    expect(settlingTime).toBeDefined();
    expect(settlingTime!.value).toBeGreaterThan(0);
  });

  it("calcula THD en señal distorsionada", () => {
    const transient: TimeStepResult[] = [];
    const N = 128;
    const freq = 1000;
    const T = 0.01;
    for (let i = 0; i < N; i++) {
      const t = (i / N) * T;
      // Fundamental 1V + 3er armónico 0.1V (10% distorsión)
      const v = Math.sin(2 * Math.PI * freq * t) + 0.1 * Math.sin(2 * Math.PI * 3 * freq * t);
      transient.push({
        time: t,
        nodeVoltages: { "1": v },
        branchCurrents: {},
      });
    }

    const items = calculateAutomatedMeasurements(transient, null, ["1"]);
    const thd = items.find((i) => i.id === "meas-1-thd");
    expect(thd).toBeDefined();
    expect(thd!.value).toBeGreaterThan(5.0);
    expect(thd!.value).toBeLessThan(20.0);
  });

  it("calcula ancho de banda (-3dB) y margen de fase a partir de un barrido AC", () => {
    // Filtro pasa-bajos RC de 1er orden: fc = 1000 Hz
    const freqs = [10, 100, 500, 1000, 2000, 10000];
    const amps = [1.0, 0.995, 0.894, 0.7071, 0.447, 0.0995];
    const phases = [-0.5, -5.7, -26.5, -45.0, -63.4, -84.3];

    const acSweep: AcSweepResult = {
      frequencies: freqs,
      nodeAmplitudes: { "out": amps },
      nodePhases: { "out": phases },
    };

    const items = calculateAutomatedMeasurements([], acSweep, ["out"]);

    const bw = items.find((i) => i.id === "meas-out-bw");
    expect(bw).toBeDefined();
    expect(bw!.value).toBeCloseTo(1000, -2); // ~1000 Hz

    const pm = items.find((i) => i.id === "meas-out-pm");
    expect(pm).toBeDefined();
    // A 1.0 (10 Hz), phase is -0.5°, pm = 180 + (-0.5) ≈ 179.5°
    expect(pm!.value).toBeGreaterThan(100);
  });

  it("exporta mediciones correctamente a CSV y JSON", () => {
    const transient: TimeStepResult[] = [
      { time: 0.0, nodeVoltages: { "1": 0.0 }, branchCurrents: {} },
      { time: 0.001, nodeVoltages: { "1": 3.3 }, branchCurrents: {} },
      { time: 0.002, nodeVoltages: { "1": 3.3 }, branchCurrents: {} },
    ];

    const items = calculateAutomatedMeasurements(transient, null, ["1"]);

    const csv = exportMeasurementsToCsv(items, { circuitName: "Test RC", timestamp: "2026-08-21T00:00:00Z" });
    expect(csv).toContain("# Circuito: Test RC");
    expect(csv).toContain("ID,Nombre,Categoría,Nodo,Valor,Unidad,ValorFormateado,Descripción");
    expect(csv).toContain("meas-1-vpp");

    const jsonStr = exportMeasurementsToJson(items, { circuitName: "Test RC" });
    const parsed = JSON.parse(jsonStr);
    expect(parsed.circuitName).toBe("Test RC");
    expect(parsed.measurements.length).toBeGreaterThan(0);
    expect(parsed.measurements[0].node).toBe("1");
  });
});
