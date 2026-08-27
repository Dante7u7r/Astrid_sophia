import { describe, expect, it } from "vitest";
import {
  COMMERCIAL_BJTS,
  COMMERCIAL_DIODES,
  COMMERCIAL_MOSFETS,
  COMMERCIAL_JFETS,
  COMMERCIAL_OPAMPS,
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

    expect(COMMERCIAL_DIODES["BAT54"]).toBeDefined();
    expect(COMMERCIAL_DIODES["BAT54"].bv).toBe(30);

    expect(COMMERCIAL_DIODES["BZX55C5V1"]).toBeDefined();
    expect(COMMERCIAL_DIODES["BZX55C5V1"].bv).toBe(5.1);

    expect(COMMERCIAL_DIODES["1N4733A"]).toBeDefined();
    expect(COMMERCIAL_DIODES["1N4733A"].bv).toBe(5.1);

    expect(COMMERCIAL_DIODES["LED_RED"]).toBeDefined();
    expect(COMMERCIAL_DIODES["LED_YELLOW"]).toBeDefined();
    expect(COMMERCIAL_DIODES["LED_WHITE"]).toBeDefined();
  });

  it("contiene transistores BJT comerciales NPN y PNP", () => {
    const npn = COMMERCIAL_BJTS["2N2222"];
    expect(npn).toBeDefined();
    expect(npn.polarity).toBe("npn");
    expect(npn.bf).toBeGreaterThan(100);

    const bc549 = COMMERCIAL_BJTS["BC549"];
    expect(bc549).toBeDefined();
    expect(bc549.bf).toBe(450);

    const tip31 = COMMERCIAL_BJTS["TIP31C"];
    expect(tip31).toBeDefined();
    expect(tip31.bf).toBe(50);

    const pnp = COMMERCIAL_BJTS["2N3906"];
    expect(pnp).toBeDefined();
    expect(pnp.polarity).toBe("pnp");
    expect(pnp.bf).toBeGreaterThan(100);

    const pnp2907 = COMMERCIAL_BJTS["2N2907"];
    expect(pnp2907).toBeDefined();
    expect(pnp2907.polarity).toBe("pnp");

    const darlington = COMMERCIAL_BJTS["TIP120"];
    expect(darlington).toBeDefined();
    expect(darlington.bf).toBe(1000);
  });

  it("contiene transistores MOSFET comerciales con Vth y RDSon físicos", () => {
    const irf540 = COMMERCIAL_MOSFETS["IRF540N"];
    expect(irf540).toBeDefined();
    expect(irf540.polarity).toBe("nmos");
    expect(irf540.vth).toBe(3.5);
    expect(irf540.ron).toBeLessThan(0.1);

    const bss138 = COMMERCIAL_MOSFETS["BSS138"];
    expect(bss138).toBeDefined();
    expect(bss138.vth).toBe(1.3);

    const bss84 = COMMERCIAL_MOSFETS["BSS84"];
    expect(bss84).toBeDefined();
    expect(bss84.polarity).toBe("pmos");
    expect(bss84.vth).toBe(-1.4);

    const irfz44 = COMMERCIAL_MOSFETS["IRFZ44N"];
    expect(irfz44).toBeDefined();
    expect(irfz44.ron).toBeLessThan(0.02);

    const pmos = COMMERCIAL_MOSFETS["IRF9540"];
    expect(pmos).toBeDefined();
    expect(pmos.polarity).toBe("pmos");
    expect(pmos.vth).toBeLessThan(0);
  });

  it("contiene transistores JFET comerciales con Vp e Idss físicos", () => {
    const jfetN = COMMERCIAL_JFETS["2N5457"];
    expect(jfetN).toBeDefined();
    expect(jfetN.polarity).toBe("njf");
    expect(jfetN.vto).toBeLessThan(0);
    expect(jfetN.beta).toBeGreaterThan(0);

    const j111 = COMMERCIAL_JFETS["J111"];
    expect(j111).toBeDefined();
    expect(j111.vto).toBe(-3.0);

    const j176 = COMMERCIAL_JFETS["J176"];
    expect(j176).toBeDefined();
    expect(j176.polarity).toBe("pjf");
    expect(j176.vto).toBe(2.5);

    const jfetP = COMMERCIAL_JFETS["2N5460"];
    expect(jfetP).toBeDefined();
    expect(jfetP.polarity).toBe("pjf");
    expect(jfetP.vto).toBeGreaterThan(0);
  });

  it("contiene amplificadores operacionales comerciales con GBW, SR y Aol físicos", () => {
    const lm741 = COMMERCIAL_OPAMPS["LM741"];
    expect(lm741).toBeDefined();
    expect(lm741.aol).toBeGreaterThanOrEqual(100000);
    expect(lm741.gbwHz).toBe(1e6);

    const tl072 = COMMERCIAL_OPAMPS["TL072"];
    expect(tl072).toBeDefined();
    expect(tl072.rin).toBeGreaterThan(1e9); // JFET high input impedance
    expect(tl072.slewRateVUs).toBe(13.0);
  });
});

