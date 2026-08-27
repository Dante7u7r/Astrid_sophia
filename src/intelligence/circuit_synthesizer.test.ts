import { describe, expect, it } from "vitest";
import {
  findNearestStandardValue,
  synthesizeBjtVoltageDividerBias,
  synthesizeRfAttenuator,
  synthesizeSallenKeyFilter,
  synthesizeTimer555Astable,
  synthesizeZenerRegulator,
} from "./circuit_synthesizer";

describe("CircuitSynthesizer — Asistente de Síntesis y Dimensionamiento", () => {
  it("encuentra el valor normalizado comercial E24/E96 más cercano", () => {
    // 4.62 kΩ en E24 debe aproximarse a 4.7 kΩ
    expect(findNearestStandardValue(4620, "E24")).toBe(4700);

    // 10.3 kΩ en E24 -> 10.0 kΩ
    expect(findNearestStandardValue(10300, "E24")).toBe(10000);

    // 4.95 kΩ en E96 -> 4.99 kΩ
    expect(findNearestStandardValue(4950, "E96")).toBe(4990);
  });

  it("sintetiza un filtro activo Sallen-Key Butterworth de 2do orden a 10 kHz", () => {
    const result = synthesizeSallenKeyFilter("lowpass", "butterworth", 10000, 10e-9);

    expect(result.filterType).toBe("lowpass");
    expect(result.approximation).toBe("butterworth");
    expect(result.targetCutoffHz).toBe(10000);
    expect(result.r1_standard).toBeGreaterThan(500);
    expect(result.r2_standard).toBeGreaterThan(500);
    expect(result.c1_standard).toBe(10e-9);
    // La frecuencia real con componentes estándar debe estar a menos del 15% del objetivo
    expect(result.actualCutoffHz).toBeGreaterThan(8500);
    expect(result.actualCutoffHz).toBeLessThan(11500);
  });

  it("sintetiza una red de auto-polarización para BJT (Vcc=12V, Ic=2mA, Vce=6V)", () => {
    const result = synthesizeBjtVoltageDividerBias(12.0, 0.002, 6.0, 100);

    expect(result.vcc).toBe(12.0);
    expect(result.rc_standard).toBeGreaterThan(1000);
    expect(result.re_standard).toBeGreaterThan(100);
    expect(result.r1_standard).toBeGreaterThan(result.r2_standard);
    // Factor de estabilidad S < 15
    expect(result.stabilityFactor).toBeLessThan(15);
    // Ic real calculada con valores comerciales debe estar cerca de 2 mA
    expect(result.actualIcAmps).toBeGreaterThan(0.0015);
    expect(result.actualIcAmps).toBeLessThan(0.0025);
  });

  it("sintetiza un regulador Zener de 5.1V para entrada de 9V-15V", () => {
    const result = synthesizeZenerRegulator(9.0, 15.0, 5.1, 0.02); // 20 mA carga

    expect(result.isSafe).toBe(true);
    expect(result.rs_standard).toBeGreaterThan(50);
    expect(result.rs_powerWatts).toBeGreaterThan(0);
    expect(result.zener_maxPowerWatts).toBeGreaterThan(0);
  });

  it("sintetiza un temporizador 555 astable a 1 kHz con 60% duty cycle", () => {
    const result = synthesizeTimer555Astable(1000, 60, 100e-9);

    expect(result.ra_standard).toBeGreaterThan(100);
    expect(result.rb_standard).toBeGreaterThan(100);
    expect(result.actualFreqHz).toBeGreaterThan(800);
    expect(result.actualFreqHz).toBeLessThan(1200);
    expect(result.actualDutyPercent).toBeGreaterThan(50);
    expect(result.actualDutyPercent).toBeLessThan(75);
  });

  it("sintetiza un atenuador pasivo RF de 6 dB a 50 ohmios (red Pi)", () => {
    const result = synthesizeRfAttenuator(6, 50, "PI");

    expect(result.z0).toBe(50);
    expect(result.attenuationDb).toBe(6);
    expect(result.type).toBe("PI");
    // Para 6 dB / 50 ohms Pi: R_shunt ~ 150.5 ohms, R_series ~ 37.4 ohms
    expect(result.r1_series_std).toBeCloseTo(150, -1);
    expect(result.r2_shunt_std).toBeCloseTo(37.4, -1);
  });
});
