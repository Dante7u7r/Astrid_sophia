import { describe, expect, it } from "vitest";
import {
  COMMERCIAL_BJTS,
  COMMERCIAL_DIODES,
  COMMERCIAL_MOSFETS,
} from "./commercial_models_catalog";

describe("Commercial Models Catalog", () => {
  it("contiene los diodos estándar comerciales con parámetros SPICE válidos", () => {
    expect(COMMERCIAL_DIODES["1N4148"]).toBeDefined();
    expect(COMMERCIAL_DIODES["1N4148"].is).toBeGreaterThan(0);
    expect(COMMERCIAL_DIODES["1N4148"].n).toBeGreaterThan(1);
    expect(COMMERCIAL_DIODES["1N4148"].bv).toBe(100);

    expect(COMMERCIAL_DIODES["1N4007"]).toBeDefined();
    expect(COMMERCIAL_DIODES["1N4007"].bv).toBe(1000);

    expect(COMMERCIAL_DIODES["1N5819"]).toBeDefined();
    expect(COMMERCIAL_DIODES["1N5819"].is).toBeGreaterThan(1e-6); // Schottky higher Is
  });

  it("contiene transistores BJT comerciales NPN y PNP", () => {
    const npn = COMMERCIAL_BJTS["2N2222"];
    expect(npn).toBeDefined();
    expect(npn.polarity).toBe("npn");
    expect(npn.bf).toBeGreaterThan(100);

    const pnp = COMMERCIAL_BJTS["2N3906"];
    expect(pnp).toBeDefined();
    expect(pnp.polarity).toBe("pnp");
    expect(pnp.bf).toBeGreaterThan(100);
  });

  it("contiene transistores MOSFET comerciales con Vth y RDSon físicos", () => {
    const irf540 = COMMERCIAL_MOSFETS["IRF540N"];
    expect(irf540).toBeDefined();
    expect(irf540.polarity).toBe("nmos");
    expect(irf540.vth).toBe(3.5);
    expect(irf540.ron).toBeLessThan(0.1);

    const pmos = COMMERCIAL_MOSFETS["IRF9540"];
    expect(pmos).toBeDefined();
    expect(pmos.polarity).toBe("pmos");
    expect(pmos.vth).toBeLessThan(0);
  });
});
