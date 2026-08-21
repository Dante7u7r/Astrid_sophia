import { describe, expect, it } from "vitest";
import {
  AgingEngine,
  TECHNOLOGY_NODE_PRESETS,
  type AgingStressProfile,
} from "./aging_models";

describe("Aging Models (NBTI / PBTI / HCI) & Lifetime Reliability Estimation", () => {
  describe("1. NBTI (Negative Bias Temperature Instability) en pMOS", () => {
    it("modela la aceleración exponencial por temperatura y tensión de compuerta", () => {
      const params = TECHNOLOGY_NODE_PRESETS["28nm_HKMG"];

      const stress300K: AgingStressProfile = {
        vgsStress: -1.1,
        vdsStress: 0.0,
        temperatureK: 300.0,
        dutyCycle: 1.0,
        isPmos: true,
      };

      const stress125C: AgingStressProfile = {
        vgsStress: -1.1,
        vdsStress: 0.0,
        temperatureK: 398.15, // 125 °C
        dutyCycle: 1.0,
        isPmos: true,
      };

      const time1Year = 365.25 * 86400;
      const dVth300K = AgingEngine.evaluateNbti(stress300K, params, time1Year);
      const dVth125C = AgingEngine.evaluateNbti(stress125C, params, time1Year);

      expect(dVth300K).toBeGreaterThan(0);
      expect(dVth125C).toBeGreaterThan(dVth300K * 1.5);
    });

    it("modela la recuperación dinámica parcial en AC según el ciclo de trabajo", () => {
      const params = TECHNOLOGY_NODE_PRESETS["28nm_HKMG"];

      const stressDC: AgingStressProfile = {
        vgsStress: -1.0,
        vdsStress: 0.0,
        temperatureK: 350.0,
        dutyCycle: 1.0, // 100% DC
        isPmos: true,
      };

      const stressAC: AgingStressProfile = {
        vgsStress: -1.0,
        vdsStress: 0.0,
        temperatureK: 350.0,
        dutyCycle: 0.5, // 50% conmutación AC
        isPmos: true,
      };

      const time10Y = 10 * 365.25 * 86400;
      const dVthDC = AgingEngine.evaluateNbti(stressDC, params, time10Y);
      const dVthAC = AgingEngine.evaluateNbti(stressAC, params, time10Y);

      expect(dVthAC).toBeLessThan(dVthDC);
      expect(dVthAC).toBeGreaterThan(0);
    });
  });

  describe("2. PBTI (Positive Bias Temperature Instability) en nMOS High-κ", () => {
    it("muestra mayor atrapamiento en nodos con dieléctrico High-κ que en SiO2 planar", () => {
      const paramsPlanar = TECHNOLOGY_NODE_PRESETS["180nm_Planar"];
      const paramsHKMG = TECHNOLOGY_NODE_PRESETS["28nm_HKMG"];

      const stressNmos: AgingStressProfile = {
        vgsStress: 1.0,
        vdsStress: 0.0,
        temperatureK: 350.0,
        dutyCycle: 1.0,
        isPmos: false,
      };

      const time10Y = 10 * 365.25 * 86400;
      const pbtiPlanar = AgingEngine.evaluatePbti(stressNmos, paramsPlanar, time10Y);
      const pbtiHKMG = AgingEngine.evaluatePbti(stressNmos, paramsHKMG, time10Y);

      expect(pbtiHKMG).toBeGreaterThan(pbtiPlanar * 4.0);
    });
  });

  describe("3. HCI (Hot Carrier Injection) en Saturación", () => {
    it("calcula degradación acelerada por tensión de drenador Vds", () => {
      const params = TECHNOLOGY_NODE_PRESETS["65nm_Bulk"];

      const stressHCI: AgingStressProfile = {
        vgsStress: 0.9,
        vdsStress: 1.8,
        temperatureK: 300.0,
        dutyCycle: 0.5,
        isPmos: false,
      };

      const time5Y = 5 * 365.25 * 86400;
      const dVthHci = AgingEngine.evaluateHci(stressHCI, params, time5Y);

      expect(dVthHci).toBeGreaterThan(0.010); // > 10 mV
    });
  });

  describe("4. Estimación de Vida Útil (Lifetime / Time-to-Failure)", () => {
    it("evalúa degradación acumulada y proyecta TTF a 10 años", () => {
      const params = TECHNOLOGY_NODE_PRESETS["28nm_HKMG"];

      const stressNominal: AgingStressProfile = {
        vgsStress: -0.9,
        vdsStress: -0.9,
        temperatureK: 340.0,
        dutyCycle: 0.5,
        isPmos: true,
      };

      const lifetime = AgingEngine.estimateLifetime(stressNominal, params, 0.050, 10.0);

      expect(lifetime.timeToFailureYears).toBeGreaterThan(5.0);
      expect(lifetime.dominantMechanism).toBe("NBTI");
      expect(lifetime.degradationAt10Years.deltaVthTotal).toBeGreaterThan(0);
      expect(lifetime.degradationAt10Years.deltaIdsPercent).toBeGreaterThan(0);
    });
  });
});
