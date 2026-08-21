import { describe, expect, it } from "vitest";
import { COMMERCIAL_MOSFETS } from "./commercial_models_catalog";

describe("Modelos de Dispositivos Avanzados: SiC / GaN Power MOSFETs", () => {
  describe("1. Catálogo de Modelos Comerciales WBG (SiC & GaN)", () => {
    it("contiene modelos estándar de la industria (Wolfspeed, onsemi, GaN Systems, EPC)", () => {
      const sicWolfspeed = COMMERCIAL_MOSFETS["C3M0065090D"];
      expect(sicWolfspeed).toBeDefined();
      expect(sicWolfspeed.vth).toBe(3.0);
      expect(sicWolfspeed.ron).toBe(0.065); // 65 mΩ
      expect(sicWolfspeed.description).toContain("SiC MOSFET");
      expect(sicWolfspeed.description).toContain("3rd Quadrant");

      const ganSystems = COMMERCIAL_MOSFETS["GS66508T"];
      expect(ganSystems).toBeDefined();
      expect(ganSystems.vth).toBe(1.4);
      expect(ganSystems.ron).toBe(0.050); // 50 mΩ
      expect(ganSystems.description).toContain("GaN E-HEMT");
      expect(ganSystems.description).toContain("Qrr=0");

      const epcGaN = COMMERCIAL_MOSFETS["EPC2001C"];
      expect(epcGaN).toBeDefined();
      expect(epcGaN.ron).toBe(0.0056); // 5.6 mΩ ultra-baja
    });
  });

  describe("2. Características Físicas y Capacitancias de Conmutación Rápida", () => {
    it("valida que los dispositivos GaN posean capacidades parásitas de Miller ultra-bajas", () => {
      const gan = COMMERCIAL_MOSFETS["GS66508T"];
      const siStandard = COMMERCIAL_MOSFETS["IRF540N"];

      // Capacidad de transferencia inversa Cgd (Miller): GaN << Si
      expect(gan.cgd).toBeLessThan(siStandard.cgd! * 0.1); // < 10% de la capacidad de Si
      expect(gan.cgs).toBeLessThan(siStandard.cgs! * 0.3);
    });

    it("valida parámetros de alta tensión para SiC (1200V EliteSiC)", () => {
      const sic1200v = COMMERCIAL_MOSFETS["NVH4L020N120SC1"];
      expect(sic1200v.vth).toBeCloseTo(2.7, 1);
      expect(sic1200v.ron).toBe(0.020); // 20 mΩ a 1200V
    });
  });
});
