import { describe, expect, it } from "vitest";
import {
  ElectromigrationEngine,
  type InterconnectSegmentSpec,
} from "./electromigration_models";

describe("Electromigration (EM) & IR Drop Models", () => {
  describe("1. Resistencia de Pistas y Caída IR", () => {
    it("calcula la resistencia y la caída de tensión con coeficiente de temperatura", () => {
      const r300K = ElectromigrationEngine.calculateTraceResistance(
        100.0,
        0.2,
        200.0,
        "Copper_Cu",
        300.0
      );
      const r373K = ElectromigrationEngine.calculateTraceResistance(
        100.0,
        0.2,
        200.0,
        "Copper_Cu",
        373.15
      );

      expect(r300K).toBeGreaterThan(30.0);
      expect(r300K).toBeLessThan(60.0);
      expect(r373K).toBeGreaterThan(r300K);

      const spec: InterconnectSegmentSpec = {
        segmentId: "M3_PWR_01",
        sourceNode: "VDD_CORE",
        targetNode: "MAC_UNIT_VDD",
        lengthUm: 100.0,
        widthUm: 0.2,
        thicknessNm: 200.0,
        material: "Copper_Cu",
        currentA: 0.5e-3,
        temperatureK: 350.0,
      };

      const ir = ElectromigrationEngine.evaluateSegmentIrDrop(spec, 0.9, 3.0);
      expect(ir.voltageDropV).toBeGreaterThan(0.015);
      expect(ir.voltageDropV).toBeLessThan(0.035);
      expect(ir.voltageDropPercent).toBeLessThan(4.0);
    });
  });

  describe("2. Efecto Blech e Inmortalidad de Pistas Cortas", () => {
    it("valida la inmunidad de pistas cortas donde J * L < (J * L)crit", () => {
      const specShort: InterconnectSegmentSpec = {
        segmentId: "M1_LOCAL_SHORT",
        sourceNode: "INV_OUT",
        targetNode: "NAND_IN",
        lengthUm: 10.0,
        widthUm: 0.1,
        thicknessNm: 100.0,
        material: "Copper_Cu",
        currentA: 0.1e-3, // J = 1.0 MA/cm², L = 10 µm -> J*L = 1000 A/cm < 2500 A/cm
        temperatureK: 378.15,
      };

      const emShort = ElectromigrationEngine.evaluateSegmentEm(specShort, 1.0e14);
      expect(emShort.isBlechImmortal).toBe(true);
      expect(emShort.emViolation).toBe(false);
      expect(emShort.mttfHours).toBe(Number.POSITIVE_INFINITY);

      const specLong: InterconnectSegmentSpec = {
        segmentId: "M1_GLOBAL_LONG",
        sourceNode: "PLL_VDD",
        targetNode: "SRAM_VDD",
        lengthUm: 500.0,
        widthUm: 0.1,
        thicknessNm: 100.0,
        material: "Copper_Cu",
        currentA: 0.1e-3, // J*L = 50000 A/cm > 2500 A/cm
        temperatureK: 378.15,
      };

      const emLong = ElectromigrationEngine.evaluateSegmentEm(specLong, 1.0e14);
      expect(emLong.isBlechImmortal).toBe(false);
      expect(Number.isFinite(emLong.mttfYears)).toBe(true);
    });
  });

  describe("3. Ecuación de Black y Aceleración Térmica", () => {
    it("modela la reducción drástica de vida útil (MTTF) al aumentar la temperatura", () => {
      const spec300K: InterconnectSegmentSpec = {
        segmentId: "M2_BUS_01",
        sourceNode: "N1",
        targetNode: "N2",
        lengthUm: 200.0,
        widthUm: 0.2,
        thicknessNm: 200.0,
        material: "Copper_Cu",
        currentA: 0.8e-3,
        temperatureK: 300.0,
      };

      const spec398K: InterconnectSegmentSpec = {
        ...spec300K,
        temperatureK: 398.15, // 125 °C
      };

      const em300K = ElectromigrationEngine.evaluateSegmentEm(spec300K, 5.0e5);
      const em398K = ElectromigrationEngine.evaluateSegmentEm(spec398K, 5.0e5);

      expect(em300K.mttfYears).toBeGreaterThan(em398K.mttfYears * 50.0);
    });
  });

  describe("4. Análisis de Red PDN Completa", () => {
    it("analiza segmentos en red identificando violaciones de EM y caída IR", () => {
      const segments: InterconnectSegmentSpec[] = [
        {
          segmentId: "VDD_MAIN_TRUNK",
          sourceNode: "PAD_VDD",
          targetNode: "SPINE_01",
          lengthUm: 50.0,
          widthUm: 2.0,
          thicknessNm: 500.0,
          material: "Copper_Cu",
          currentA: 2.0e-3,
          temperatureK: 330.0,
        },
        {
          segmentId: "VDD_HOTSPOT_THIN",
          sourceNode: "SPINE_01",
          targetNode: "ALU_CORE",
          lengthUm: 400.0,
          widthUm: 0.1,
          thicknessNm: 100.0,
          material: "Aluminum_Al",
          currentA: 1.2e-3, // Exceso de corriente en pista fina
          temperatureK: 390.0,
        },
      ];

      const pdn = ElectromigrationEngine.analyzePdnNetwork(segments, 0.9, 3.0, 1.0e14);
      expect(pdn.totalSegments).toBe(2);
      expect(pdn.maxCurrentDensityMaPerCm2).toBeGreaterThan(5.0);
      expect(pdn.totalEmViolations).toBe(1);
      expect(pdn.totalIrDropViolations).toBe(1);
    });
  });
});
