import { describe, expect, it } from "vitest";
import {
  HARDENING_LEVEL_PRESETS,
  LET_TO_CHARGE_PC_PER_UM,
  RadiationEngine,
  type SingleEventTransientSpec,
} from "./radiation_models";

describe("Radiation Effects (TID / SEE / SET / SEU) Models", () => {
  describe("1. Total Ionizing Dose (TID)", () => {
    it("modela la degradación por dosis y corrimientos de Vth por Not y Nit", () => {
      const params = HARDENING_LEVEL_PRESETS.Unmitigated_COTS;

      const dose10k = RadiationEngine.evaluateTidDegradation(10.0, params, 70.0);
      const dose100k = RadiationEngine.evaluateTidDegradation(100.0, params, 70.0);

      expect(dose10k.deltaVthNot).toBeLessThan(0);
      expect(dose100k.deltaVthNot).toBeLessThan(dose10k.deltaVthNot);
      expect(dose100k.stiLeakageCurrentA).toBeGreaterThan(dose10k.stiLeakageCurrentA);
      expect(dose100k.subthresholdSwingMvDec).toBeGreaterThan(70.0);
    });

    it("valida la inmunidad de transistores endurecidos por diseño (RHBD) a 100 krad", () => {
      const paramsCOTS = HARDENING_LEVEL_PRESETS.Unmitigated_COTS;
      const paramsRHBD = HARDENING_LEVEL_PRESETS.RadHard_RHBD;

      const dose100kCOTS = RadiationEngine.evaluateTidDegradation(100.0, paramsCOTS, 70.0);
      const dose100kRHBD = RadiationEngine.evaluateTidDegradation(100.0, paramsRHBD, 70.0);

      expect(Math.abs(dose100kRHBD.deltaVthNmos)).toBeLessThan(
        Math.abs(dose100kCOTS.deltaVthNmos) * 0.1
      );
      expect(dose100kRHBD.stiLeakageCurrentA).toBeLessThan(1.0e-10);
      expect(dose100kRHBD.functionalStatusOk).toBe(true);
    });
  });

  describe("2. Single-Event Transient (SET) Injection", () => {
    it("genera pulsos de corriente doble-exponenciales proporcionales al LET incidente", () => {
      const spec: SingleEventTransientSpec = {
        strikeTimeSeconds: 1.0e-9, // 1 ns
        letMevCm2Mg: 60.0,
        collectionDepthUm: 2.5,
        tauRiseSeconds: 15.0e-12, // 15 ps
        tauFallSeconds: 250.0e-12, // 250 ps
      };

      // Antes del impacto
      expect(RadiationEngine.calculateSetCurrentInstant(spec, 0.5e-9)).toBe(0.0);

      // Cerca del pico
      const iPeak = RadiationEngine.calculateSetCurrentInstant(spec, 1.03e-9);
      expect(iPeak).toBeGreaterThan(0.001); // > 1 mA

      // Integración numérica de carga
      const qExpectedC =
        spec.letMevCm2Mg * spec.collectionDepthUm * LET_TO_CHARGE_PC_PER_UM * 1.0e-12;
      const dt = 1.0e-13; // 0.1 ps
      let qNumC = 0.0;
      for (let t = spec.strikeTimeSeconds; t < spec.strikeTimeSeconds + 3.0e-9; t += dt) {
        qNumC += RadiationEngine.calculateSetCurrentInstant(spec, t) * dt;
      }

      const relErr = Math.abs(qNumC - qExpectedC) / qExpectedC;
      expect(relErr).toBeLessThan(0.05);
    });
  });

  describe("3. Single-Event Upset (SEU) Vulnerability", () => {
    it("evalúa la probabilidad de inversión lógica frente a la carga crítica Qcrit", () => {
      const specProton: SingleEventTransientSpec = {
        strikeTimeSeconds: 0,
        letMevCm2Mg: 1.0, // Protón / ión ligero
        collectionDepthUm: 2.0,
        tauRiseSeconds: 10.0e-12,
        tauFallSeconds: 200.0e-12,
      };

      // Célula no endurecida C = 1.5 fF, VDD = 0.9V
      const resCots = RadiationEngine.evaluateSeuVulnerability(1.5e-15, 0.9, specProton);
      expect(resCots.upsetOccurred).toBe(true);
      expect(resCots.safetyMargin).toBeLessThan(1.0);

      // Célula endurecida (DICE / TMR) C = 60 fF
      const resHardened = RadiationEngine.evaluateSeuVulnerability(60.0e-15, 0.9, specProton);
      expect(resHardened.upsetOccurred).toBe(false);
      expect(resHardened.safetyMargin).toBeGreaterThan(1.0);
    });
  });
});
