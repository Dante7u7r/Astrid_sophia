import { describe, expect, it } from "vitest";
import {
  COMPONENT_PRESETS,
  snapToStandardValue,
  STANDARD_SERIES_E12,
  STANDARD_SERIES_E24,
} from "./engineering_standards";

describe("engineering_standards", () => {
  it("contiene las series normalizadas E12 y E24 completas", () => {
    expect(STANDARD_SERIES_E12.length).toBe(12);
    expect(STANDARD_SERIES_E24.length).toBe(24);
    expect(STANDARD_SERIES_E12[0]).toBe(1.0);
    expect(STANDARD_SERIES_E24[0]).toBe(1.0);
  });

  it("ajusta valores arbitrarios a la serie E24 más cercana", () => {
    // 4620 Ohms -> 4700 Ohms
    expect(snapToStandardValue(4620, "E24")).toBe(4700);

    // 104 Ohms -> 100 Ohms
    expect(snapToStandardValue(104, "E24")).toBe(100);

    // 2180 Ohms -> 2200 Ohms
    expect(snapToStandardValue(2180, "E24")).toBe(2200);

    // 98 nF (9.8e-8) -> 100 nF (1e-7)
    expect(snapToStandardValue(9.8e-8, "E24")).toBeCloseTo(1e-7);

    // 3.4 µF (3.4e-6) -> 3.3 µF (3.3e-6)
    expect(snapToStandardValue(3.4e-6, "E24")).toBeCloseTo(3.3e-6);
  });

  it("ajusta valores a la serie E12", () => {
    // 1040 Ohms -> 1000 Ohms, 1160 Ohms -> 1200 Ohms (E12 tiene 1.0 y 1.2)
    expect(snapToStandardValue(1040, "E12")).toBe(1000);
    expect(snapToStandardValue(1160, "E12")).toBe(1200);
  });

  it("conserva valores no finitos o menores o iguales a cero", () => {
    expect(snapToStandardValue(0)).toBe(0);
    expect(snapToStandardValue(-10)).toBe(-10);
    expect(snapToStandardValue(NaN)).toBeNaN();
  });

  it("proporciona presets válidos para componentes principales", () => {
    expect(COMPONENT_PRESETS.resistor.length).toBeGreaterThanOrEqual(4);
    expect(COMPONENT_PRESETS.capacitor.length).toBeGreaterThanOrEqual(4);
    expect(COMPONENT_PRESETS.inductor.length).toBeGreaterThanOrEqual(3);
    expect(COMPONENT_PRESETS.diode.length).toBeGreaterThanOrEqual(4);

    const pullup = COMPONENT_PRESETS.resistor.find(p => p.id === "pullup_10k");
    expect(pullup?.values.value).toBe(10000);
    expect(pullup?.values.tolerance).toBe(1);

    const zener = COMPONENT_PRESETS.diode.find(p => p.id === "zener_5v1");
    expect(zener?.values.diodeBv).toBe(5.1);
  });
});
