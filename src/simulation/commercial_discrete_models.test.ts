import { describe, expect, it } from "vitest";
import {
  ALL_COMMERCIAL_DISCRETE_MODELS,
  getCommercialDiscreteModel,
  getDiscreteModelsByType,
} from "./commercial_discrete_models";

describe("commercial_discrete_models", () => {
  it("contiene todos los modelos discretos comerciales estándar", () => {
    expect(ALL_COMMERCIAL_DISCRETE_MODELS.length).toBeGreaterThanOrEqual(18);
  });

  it("recupera modelos de diodos Zener y rectificadores por nombre sin importar mayúsculas/minúsculas", () => {
    const zener = getCommercialDiscreteModel("1n4733a");
    expect(zener).toBeDefined();
    expect(zener?.name).toBe("1N4733A");
    expect(zener?.type).toBe("d");
    expect(zener?.parameters?.["BV"]).toBe(5.1);

    const schottky = getCommercialDiscreteModel("1N5819");
    expect(schottky).toBeDefined();
    expect(schottky?.parameters?.["BV"]).toBe(40);
  });

  it("recupera transistores BJT y MOSFET de potencia correctamente", () => {
    const tip31 = getCommercialDiscreteModel("tip31c");
    expect(tip31).toBeDefined();
    expect(tip31?.type).toBe("npn");
    expect(tip31?.parameters?.["BF"]).toBe(50);

    const irfz44 = getCommercialDiscreteModel("IRFZ44N");
    expect(irfz44).toBeDefined();
    expect(irfz44?.type).toBe("nmos");
    expect(irfz44?.parameters?.["RD"]).toBe(0.0175);
  });

  it("filtra modelos discretos por tipo SPICE", () => {
    const npns = getDiscreteModelsByType("npn");
    expect(npns.length).toBeGreaterThanOrEqual(5);
    expect(npns.every((m) => m.type === "npn")).toBe(true);

    const diodes = getDiscreteModelsByType("d");
    expect(diodes.length).toBeGreaterThanOrEqual(8);
  });
});
