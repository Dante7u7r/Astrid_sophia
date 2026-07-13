import { describe, expect, it } from "vitest";
import type { ComponentInstance } from "../canvas_orchestrator";
import {
  ACTUATOR_MODEL_EDITORS,
  DEDICATED_VALUE_EDITORS,
  buildLiveMutations,
  clampSwitchProperties,
  clampTransformerProperties,
  finiteOr,
  getUnitDisplayConfig,
  getValueEditorPresentation,
  supportsLiveMutation,
} from "./property_model";

function component(id: string, type: ComponentInstance["type"]): ComponentInstance {
  return { id, type, value: 1, x: 0, y: 0, rotation: 0 };
}

describe("property_model", () => {
  it("clasifica editores de valor", () => {
    expect(DEDICATED_VALUE_EDITORS.has("dmm")).toBe(true);
    expect(DEDICATED_VALUE_EDITORS.has("resistor")).toBe(false);
    expect(ACTUATOR_MODEL_EDITORS.has("lamp")).toBe(true);
  });

  it("parsea numeros finitos con fallback", () => {
    expect(finiteOr("3.5", 1)).toBe(3.5);
    expect(finiteOr("nan", 1)).toBe(1);
  });

  it("devuelve rangos de unidad por tipo", () => {
    expect(getUnitDisplayConfig("resistor")).toEqual({
      label: "Ohmios (Ohm)",
      min: "1",
      max: "10000",
    });
    expect(getUnitDisplayConfig("nmos").min).toBe("-3");
    expect(getUnitDisplayConfig("ground").label).toBe("Valor Nominal");
  });

  it("describe que controles de valor debe mostrar cada tipo", () => {
    expect(getValueEditorPresentation("lamp")).toMatchObject({
      showValueGroup: true,
      showUnitGroup: false,
      valueLabel: "Modelo electrico",
      showSliderControls: false,
    });
    expect(getValueEditorPresentation("mcu_8051")).toMatchObject({
      showValueGroup: false,
      showUnitGroup: false,
    });
    expect(getValueEditorPresentation("arduino_uno").valueLabel).toBe("Modo de Simulacion (0-3)");
    expect(getValueEditorPresentation("resistor")).toMatchObject({
      showValueGroup: true,
      showUnitGroup: true,
      showSliderControls: true,
    });
  });

  it("limita parametros de switch", () => {
    const sw = component("S1", "switch");

    clampSwitchProperties(sw, {
      stateChecked: true,
      ron: "0",
      roff: "0",
      vth: "abc",
      vh: "-1",
    });

    expect(sw.switchState).toBe(true);
    expect(sw.switchRon).toBe(1e-6);
    expect(sw.switchRoff).toBe(sw.switchRon);
    expect(sw.switchVth).toBe(0.5);
    expect(sw.switchVh).toBe(0);
  });

  it("limita parametros de transformador", () => {
    const transformer = component("T1", "transformer");

    clampTransformerProperties(transformer, {
      l1: "0",
      l2: "2e-3",
      k: "2",
    });

    expect(transformer.primaryInductance).toBe(1e-9);
    expect(transformer.secondaryInductance).toBe(2e-3);
    expect(transformer.couplingCoefficient).toBe(0.9999);
    expect(transformer.value).toBe(transformer.primaryInductance);
  });

  it("construye mutaciones live para fuentes y switch", () => {
    const source = component("V1", "vsource");
    source.amplitude = 5;
    source.frequency = 1_000;
    expect(supportsLiveMutation(source.type)).toBe(true);
    expect(buildLiveMutations(source, 2)).toEqual([
      { componentId: "V1", field: "value", value: 2 },
      { componentId: "V1", field: "amplitude", value: 5 },
      { componentId: "V1", field: "frequency", value: 1_000 },
    ]);

    const sw = component("S1", "switch");
    sw.switchState = true;
    sw.switchRon = 0.01;
    expect(buildLiveMutations(sw, 0)).toEqual([
      { componentId: "S1", field: "switch_ron", value: 0.01 },
      { componentId: "S1", field: "switch_state", value: 1 },
    ]);
  });
});
