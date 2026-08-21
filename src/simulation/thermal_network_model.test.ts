import { describe, expect, it } from "vitest";
import {
  ThermalNetworkModel,
  STANDARD_THERMAL_MODELS,
} from "./thermal_network_model";

describe("Thermal RC Networks: Foster & Cauer Multi-Node Electro-Thermal Coupling", () => {
  describe("1. Redes Foster Multi-Etapa (TO-247 SiC MOSFET)", () => {
    it("calcula la resistencia térmica total y converge exactamente al régimen permanente", () => {
      const model = STANDARD_THERMAL_MODELS.TO247_4STAGE_FOSTER();
      const rthTotal = model.getTotalRth();
      expect(rthTotal).toBeCloseTo(0.50, 4);

      // Simular disipación continua de 80W a Tamb = 300K
      const pDiss = 80.0;
      const dt = 0.005; // 5 ms
      const steps = 1000; // 5 segundos totales (mucho mayor que tau_max = 100ms)
      let tj = 300.0;

      for (let i = 0; i < steps; i++) {
        tj = model.step(pDiss, dt, 300.0);
      }

      // Delta T = 80W * 0.50 K/W = 40 K -> Tj = 340 K
      expect(tj).toBeCloseTo(340.0, 1);
    });

    it("evalúa la curva analítica de impedancia térmica transitoria Zth(t)", () => {
      const model = STANDARD_THERMAL_MODELS.TO247_4STAGE_FOSTER();
      const zth100us = model.calculateZth(1e-4);
      const zth10ms = model.calculateZth(1e-2);
      const zth10s = model.calculateZth(10.0);

      expect(zth100us).toBeGreaterThan(0);
      expect(zth10ms).toBeGreaterThan(zth100us);
      expect(zth10s).toBeCloseTo(model.getTotalRth(), 3);
    });
  });

  describe("2. Redes Cauer en Escalera (Física por Capas)", () => {
    it("simula el retraso de propagación térmica entre el die interno y el disipador exterior", () => {
      const cauer = STANDARD_THERMAL_MODELS.GAN_SMD_4STAGE_CAUER();

      // Pulso corto de 100W durante 0.5 ms
      const tjPulse = cauer.step(100.0, 0.0005, 300.0);

      expect(tjPulse).toBeGreaterThan(300.0);
      // El nodo exterior (disipador) apenas debe haber variado en 0.5ms
      const tSink = cauer.nodalTemperatures[3];
      expect(tSink - 300.0).toBeLessThan((tjPulse - 300.0) * 0.05);
    });
  });

  describe("3. Conversión Foster <-> Cauer", () => {
    it("preserva la resistencia térmica global Rth_total al convertir a Cauer", () => {
      const foster = STANDARD_THERMAL_MODELS.TO220_3STAGE_FOSTER();
      const cauer = foster.toCauer();

      expect(cauer.getTotalRth()).toBeCloseTo(foster.getTotalRth(), 4);
      expect(cauer.networkType).toBe("Cauer");
    });
  });
});
