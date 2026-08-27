import { describe, expect, it } from "vitest";
import { calculateLoadLineAndQPoint, DEVICE_PRESETS, generateDeviceTrace } from "./curve_tracer_model";

describe("CurveTracerModel", () => {
  it("traza la curva I-V de un diodo 1N4148 y extrae Vf @ 1mA", () => {
    const preset = DEVICE_PRESETS.find((d) => d.id === "1N4148");
    expect(preset).toBeDefined();
    if (!preset) return;

    const result = generateDeviceTrace(preset, {
      vMax: 1.5,
      mode: "output",
      numPoints: 100,
    });

    expect(result.traces.length).toBe(1);
    expect(result.category).toBe("diode");
    expect(result.params.vf1mA).toBeGreaterThan(0.5);
    expect(result.params.vf1mA).toBeLessThan(0.85);
    expect(result.params.dynamicRes).toBeGreaterThan(0);
  });

  it("traza la curva bipolar de un diodo Zener 1N4733A y detecta ruptura Zener", () => {
    const preset = DEVICE_PRESETS.find((d) => d.id === "1N4733A");
    expect(preset).toBeDefined();
    if (!preset) return;

    const result = generateDeviceTrace(preset, {
      vMax: 7.0,
      mode: "bipolar",
      numPoints: 200,
    });

    expect(result.category).toBe("diode");
    expect(result.params.zenerVoltage).toBeCloseTo(5.1, 1);
    expect(result.vMin).toBeLessThan(-5.0);
  });

  it("genera la familia de curvas de salida de un BJT 2N2222A con 5 pasos de corriente de base", () => {
    const preset = DEVICE_PRESETS.find((d) => d.id === "2N2222A");
    expect(preset).toBeDefined();
    if (!preset) return;

    const result = generateDeviceTrace(preset, {
      vMax: 10.0,
      mode: "output",
      numSteps: 5,
      numPoints: 100,
    });

    expect(result.traces.length).toBe(5);
    expect(result.params.hFE_DC).toBe(200);
    expect(result.params.earlyVoltage).toBe(100);
    // Cada paso superior debe tener mayor corriente que el anterior
    const lastPts = result.traces.map((t) => t.points[t.points.length - 1].i);
    for (let i = 1; i < lastPts.length; i++) {
      expect(lastPts[i]).toBeGreaterThan(lastPts[i - 1]);
    }
  });

  it("genera la familia de curvas de salida y transferencia de un MOSFET 2N7000", () => {
    const preset = DEVICE_PRESETS.find((d) => d.id === "2N7000");
    expect(preset).toBeDefined();
    if (!preset) return;

    const outResult = generateDeviceTrace(preset, {
      vMax: 12.0,
      mode: "output",
      numSteps: 5,
      numPoints: 100,
    });

    expect(outResult.traces.length).toBe(5);
    expect(outResult.params.vth).toBeCloseTo(2.1, 1);
    expect(outResult.params.rdsOn).toBeGreaterThan(0);

    const transResult = generateDeviceTrace(preset, {
      vMax: 12.0,
      mode: "transfer",
      numPoints: 100,
    });

    expect(transResult.traces.length).toBe(1);
    expect(transResult.params.gm).toBeGreaterThan(0);
  });

  it("traza la curva lineal óhmica de un resistor de 1 kΩ", () => {
    const preset = DEVICE_PRESETS.find((d) => d.id === "RES_1K");
    expect(preset).toBeDefined();
    if (!preset) return;

    const result = generateDeviceTrace(preset, {
      vMax: 10.0,
      mode: "output",
      numPoints: 50,
    });

    expect(result.traces.length).toBe(1);
    expect(result.params.resistance).toBe(1000);
    const lastPt = result.traces[0].points[result.traces[0].points.length - 1];
    expect(lastPt.v).toBeCloseTo(10.0, 4);
    expect(lastPt.i).toBeCloseTo(0.010, 4); // 10V / 1kΩ = 10mA
  });

  it("calcula la recta de carga DC y el punto de polarización Q en la curva central", () => {
    const preset = DEVICE_PRESETS.find((d) => d.id === "2N2222A")!;
    const result = generateDeviceTrace(preset, {
      vMax: 10.0,
      mode: "output",
      numSteps: 5,
      numPoints: 100,
    });

    const { loadLinePoints, qPoint } = calculateLoadLineAndQPoint(10.0, 1000, result.traces);
    expect(loadLinePoints).toHaveLength(2);
    expect(loadLinePoints[0].v).toBe(0);
    expect(loadLinePoints[0].i).toBeCloseTo(0.010, 4); // 10V / 1kΩ = 10mA
    expect(loadLinePoints[1].v).toBe(10);
    expect(loadLinePoints[1].i).toBe(0);

    expect(qPoint).not.toBeNull();
    expect(qPoint!.v).toBeGreaterThan(0);
    expect(qPoint!.v).toBeLessThan(10);
    expect(qPoint!.i).toBeGreaterThan(0);
  });
});
