import { describe, expect, it } from "vitest";
import type { ComponentInstance } from "../canvas_orchestrator";
import {
  ACTUATOR_MODEL_EDITORS,
  DEDICATED_VALUE_EDITORS,
  analyzeBatchSelection,
  buildLiveMutations,
  calculateComponentOperatingPoint,
  clampSwitchProperties,
  clampTransformerProperties,
  finiteOr,
  formatComponentSpiceCard,
  formatEngineeringBadge,
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
      label: "Ohmios (Ω)",
      unitSymbol: "Ω",
      min: "1",
      max: "10000000",
    });
    expect(getUnitDisplayConfig("nmos").min).toBe("-10");
    expect(getUnitDisplayConfig("ground").label).toBe("Referencia 0 V");
  });

  it("describe que controles de valor debe mostrar cada tipo", () => {
    expect(getValueEditorPresentation("ground")).toMatchObject({
      showValueGroup: false,
      showUnitGroup: false,
      showSliderControls: false,
    });
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
      showSliderControls: false,
      showSnapSeries: true,
    });
    expect(getValueEditorPresentation("net_label")).toMatchObject({
      showValueGroup: true,
      showUnitGroup: false,
      valueLabel: "Nombre de Red",
      showSliderControls: false,
      showSnapSeries: false,
    });
    expect(getValueEditorPresentation("text_note")).toMatchObject({
      showValueGroup: true,
      showUnitGroup: false,
      valueLabel: "Contenido de la Nota",
      showSliderControls: false,
      showSnapSeries: false,
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

  it("formatea badges de ingeniería en tiempo real con notación SPICE y expresiones", () => {
    const rBadge = formatEngineeringBadge("4.7k", "resistor");
    expect(rBadge.valid).toBe(true);
    expect(rBadge.badgeText).toContain("4.7k Ω");
    expect(rBadge.baseValue).toBe(4700);

    const cBadge = formatEngineeringBadge("100n", "capacitor");
    expect(cBadge.valid).toBe(true);
    expect(cBadge.badgeText).toContain("100n F");
    expect(cBadge.baseValue).toBeCloseTo(1e-7);

    const exprBadge = formatEngineeringBadge("{R_LOAD / 2}", "resistor");
    expect(exprBadge.valid).toBe(true);
    expect(exprBadge.isExpression).toBe(true);
    expect(exprBadge.badgeText).toBe("Expresión: R_LOAD / 2");

    const netBadge = formatEngineeringBadge("TP1", "net_label");
    expect(netBadge.valid).toBe(true);
    expect(netBadge.badgeText).toBe("Puerto / Red: TP1");

    const noteBadge = formatEngineeringBadge("Anotacion de prueba", "text_note");
    expect(noteBadge.valid).toBe(true);
    expect(noteBadge.badgeText).toContain("Nota");

    const gndBadge = formatEngineeringBadge("0", "ground");
    expect(gndBadge.valid).toBe(true);
    expect(gndBadge.badgeText).toBe("Referencia Global (0 V)");

    const invalidBadge = formatEngineeringBadge("4.7xyz", "resistor");
    expect(invalidBadge.valid).toBe(false);
  });

  it("omite telemetría de caída de tensión para componentes puramente topológicos", () => {
    const net = component("NET1", "net_label");
    const pinNodes = [{ pinIndex: 0, pinName: "Pin 1", nodeId: "1" }];
    const op = calculateComponentOperatingPoint(net, pinNodes, { "1": 5.0 }, {});
    expect(op).toBeNull();
  });

  it("calcula telemetría de punto de operación y pequeña señal para transistores", () => {
    const bjt = component("Q1", "npn");
    bjt.bjtBf = 200;
    bjt.bjtVaf = 100;

    const pinNodes = [
      { pinIndex: 0, pinName: "Base (B)", nodeId: "NET_B" },
      { pinIndex: 1, pinName: "Colector (C)", nodeId: "NET_C" },
      { pinIndex: 2, pinName: "Emisor (E)", nodeId: "0" },
    ];
    const nodeVoltages = { NET_B: 0.75, NET_C: 5.0, "0": 0.0 };
    const branchCurrents = { Q1: 0.002 }; // 2 mA

    const op = calculateComponentOperatingPoint(bjt, pinNodes, nodeVoltages, branchCurrents);
    expect(op).not.toBeNull();
    expect(op!.region).toContain("Activa Directa");
    expect(op!.smallSignal).toBeDefined();
    expect(op!.smallSignal!.gm).toBeGreaterThan(0.05); // ~ 2mA / 25.85mV ≈ 0.077 S
    expect(op!.smallSignal!.rpi).toBeGreaterThan(1000);
    expect(op!.smallSignal!.ro).toBeGreaterThan(10000);
    expect(op!.pins.length).toBe(3);
  });

  it("analiza selecciones múltiples homogéneas y heterogéneas para edición por lote", () => {
    const r1 = component("R1", "resistor");
    r1.value = 1000;
    r1.tolerance = 1;
    const r2 = component("R2", "resistor");
    r2.value = 1000;
    r2.tolerance = 1;
    const r3 = component("R3", "resistor");
    r3.value = 4700;
    r3.tolerance = 1;

    const homogeneousBatch = analyzeBatchSelection([r1, r2]);
    expect(homogeneousBatch.isMultiple).toBe(true);
    expect(homogeneousBatch.isHomogeneous).toBe(true);
    expect(homogeneousBatch.typeLabel).toBe("Resistores");
    expect(homogeneousBatch.hasMixedValues).toBe(false);
    expect(homogeneousBatch.sharedValue).toBe(1000);
    expect(homogeneousBatch.sharedTolerance).toBe(1);

    const mixedValuesBatch = analyzeBatchSelection([r1, r2, r3]);
    expect(mixedValuesBatch.isMultiple).toBe(true);
    expect(mixedValuesBatch.isHomogeneous).toBe(true);
    expect(mixedValuesBatch.hasMixedValues).toBe(true);
    expect(mixedValuesBatch.sharedValue).toBeUndefined();
    expect(mixedValuesBatch.sharedTolerance).toBe(1);

    const c1 = component("C1", "capacitor");
    const heterogeneousBatch = analyzeBatchSelection([r1, c1]);
    expect(heterogeneousBatch.isMultiple).toBe(true);
    expect(heterogeneousBatch.isHomogeneous).toBe(false);
    expect(heterogeneousBatch.typeLabel).toBe("Componentes Mixtos");
  });

  it("genera directivas SPICE precisas para diferentes componentes", () => {
    const r = component("R1", "resistor");
    r.value = 4700;
    r.tolerance = 1;
    r.powerRating = 0.5;
    const rCard = formatComponentSpiceCard(r, [
      { pinName: "1", nodeId: "NET_IN" },
      { pinName: "2", nodeId: "NET_OUT" },
    ]);
    expect(rCard).toBe("R_R1 NET_IN NET_OUT 4.7k tol=1% pwr=0.5W");

    const cap = component("C1", "capacitor");
    cap.value = 1e-7;
    cap.esr = 0.05;
    cap.initialCondition = 5.0;
    const capCard = formatComponentSpiceCard(cap, [
      { pinName: "1", nodeId: "NET_OUT" },
      { pinName: "2", nodeId: "0" },
    ]);
    expect(capCard).toBe("C_C1 NET_OUT 0 100n esr=50m IC=5V");

    const bjt = component("Q1", "npn");
    bjt.modelName = "2N2222";
    bjt.bjtBf = 200;
    const bjtCard = formatComponentSpiceCard(bjt, [
      { pinName: "B", nodeId: "NET_B" },
      { pinName: "C", nodeId: "NET_C" },
      { pinName: "E", nodeId: "0" },
    ]);
    expect(bjtCard).toContain("Q_Q1 NET_C NET_B 0 2N2222");
    expect(bjtCard).toContain(".MODEL 2N2222 NPN (IS=1e-14 BF=200 VAF=100)");
  });
});

