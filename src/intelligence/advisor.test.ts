import { describe, expect, it } from "vitest";
import bsimCharacterization from "../../validation/reports/bsim-characterization.json";
import type { CircuitNetlist } from "../simulation/netlist_extractor";
import type { ERCResult } from "../simulation/simulation_dispatcher";
import type { SimulationSettings } from "../ui/settings_modal";
import {
  ADVISOR_RULES,
  evaluateAdvisor,
  evaluateCircuitHealth,
  type AdvisorContext,
} from "./advisor";
import {
  applyRecommendation,
  configureAdvisorRuntime,
  evaluateSimulationAdvice,
  undoRecommendation,
} from "./advisor_runtime";

const passedErc: ERCResult = { passed: true, errors: [], warnings: [] };
const baseNetlist: CircuitNetlist = {
  components: [
    { id: "V1", type: "vsource", value: 5, pins: ["1", "0"] },
    { id: "R1", type: "resistor", value: 1_000, pins: ["1", "0"] },
    { id: "G1", type: "ground", value: 0, pins: ["0"] },
  ],
  wires: [],
};
const defaultSettings: SimulationSettings = { dt: 1e-4, tolerance: 1e-5, maxIterations: 100 };

function context(patch: Partial<AdvisorContext> = {}): AdvisorContext {
  return {
    analysis: "DC",
    netlist: baseNetlist,
    erc: passedErc,
    settings: defaultSettings,
    transientDuration: 0.05,
    ...patch,
  };
}

describe("asesor determinista", () => {
  it.each(["bsim3nmos", "bsim3pmos", "bsim4nmos", "bsim4pmos"] as const)("mantiene %s experimental sin generalizar los cinco puntos NMOS BSIM3", (type) => {
    const recommendation = evaluateAdvisor(context({
      netlist: {
        ...baseNetlist,
        components: [...baseNetlist.components, { id: "M1", type, value: 0.4, pins: ["1", "0", "0", "0"] }],
      },
    })).find(item => item.ruleId === "model.experimental-bsim");
    const relativeErrors = bsimCharacterization.cases[0].observations.map(observation => observation.relativeError * 100);

    expect(recommendation?.safetyClass).toBe("scientific-review-required");
    expect(recommendation?.title).toContain("experimental");
    expect(recommendation?.explanation).toContain("no certifica BSIM completo ni BSIM4");
    expect(recommendation?.evidence).toContain("5/5 puntos NMOS BSIM3");
    expect(recommendation?.evidence).toContain(`${Math.min(...relativeErrors).toFixed(2)} % a ${Math.max(...relativeErrors).toFixed(2)} %`);
    expect(recommendation?.evidence).toContain("VGS=0.8–1.6 V, VDS=1 V, W=10 µm, L=0.18 µm, 27 °C");
    expect(recommendation?.evidence).toContain("tolerancia relativa del 25 %");
    expect(recommendation?.evidence).toContain("validation/reports/bsim-characterization.md");
  });

  it("incluye veintitrés reglas versionadas y no recomienda sobre el caso sano", () => {
    expect(ADVISOR_RULES).toHaveLength(23);
    expect(new Set(ADVISOR_RULES.map((rule) => rule.id)).size).toBe(23);
    expect(evaluateAdvisor(context())).toEqual([]);
  });

  it("supera 90% de precisión en el banco positivo/negativo curado", () => {
    const largeComponents = [
      ...baseNetlist.components,
      ...Array.from({ length: 501 }, (_, index) => ({
        id: `R${index + 2}`,
        type: "resistor",
        value: 1_000,
        pins: ["1", "0"],
      })),
    ];
    const cases: Array<{ input: AdvisorContext; expected: readonly string[] }> = [
      { input: context(), expected: [] },
      { input: context({ settings: { ...defaultSettings, tolerance: 1e-2 } }), expected: ["solver.loose-tolerance"] },
      { input: context({ settings: { ...defaultSettings, tolerance: 1e-13 } }), expected: ["solver.overstrict-tolerance"] },
      { input: context({ settings: { ...defaultSettings, maxIterations: 3_000 } }), expected: ["solver.excessive-iteration-limit"] },
      { input: context({ analysis: "AC" }), expected: ["ac.no-reactive-device"] },
      { input: context({ analysis: "PSS" }), expected: ["pss.no-periodic-source"] },
      { input: context({ netlist: { ...baseNetlist, components: largeComponents } }), expected: ["topology.large-circuit"] },
      { input: context({ netlist: { ...baseNetlist, components: [...baseNetlist.components, { id: "M1", type: "bsim4nmos", value: 1, pins: ["1", "0", "0", "0"] }] } }), expected: ["model.experimental-bsim"] },
      { input: context({ netlist: { ...baseNetlist, components: [...baseNetlist.components, { id: "A1", type: "arduino_uno", value: 1, pins: ["1", "0"], firmware: new Uint8Array([1]) }] } }), expected: ["model.firmware-present"] },
      { input: context({ analysis: "TRAN", settings: { ...defaultSettings, dt: 1e-3 }, netlist: { ...baseNetlist, components: [...baseNetlist.components, { id: "C1", type: "capacitor", value: 1e-6, pins: ["1", "0"] }] } }), expected: ["tran.rc-time-step"] },
      { input: context({ analysis: "TRAN", settings: { ...defaultSettings, dt: 1e-3 }, netlist: { ...baseNetlist, components: [...baseNetlist.components, { id: "L1", type: "inductor", value: 1e-3, pins: ["1", "0"] }, { id: "C1", type: "capacitor", value: 1e-6, pins: ["1", "0"] }] } }), expected: ["tran.rc-time-step", "tran.lc-resonance-step"] },
      { input: context({ erc: { passed: false, errors: ["Referencia a Tierra ausente (GND)"], warnings: [] } }), expected: ["erc.missing-ground"] },
      { input: context({ erc: { passed: true, errors: [], warnings: ["Pin flotante detectado"] } }), expected: ["erc.floating-pin"] },
    ];
    let truePositives = 0;
    let predictions = 0;
    for (const testCase of cases) {
      const actual = evaluateAdvisor(testCase.input).map((item) => item.ruleId);
      predictions += actual.length;
      truePositives += actual.filter((ruleId) => testCase.expected.includes(ruleId)).length;
      expect(new Set(actual)).toEqual(new Set(testCase.expected));
    }
    expect(truePositives / Math.max(1, predictions)).toBeGreaterThan(0.9);
  });

  it("aplica y revierte sólo ajustes acotados y reversibles", () => {
    let settings = { ...defaultSettings, tolerance: 1e-2 };
    configureAdvisorRuntime({
      getSettings: () => ({ ...settings }),
      setSettings: (next) => { settings = { ...next }; },
    });
    const recommendations = evaluateSimulationAdvice({
      ...context({ settings }),
      settings,
    });
    const recommendation = recommendations.find((item) => item.ruleId === "solver.loose-tolerance");
    expect(recommendation).toBeDefined();
    expect(applyRecommendation(recommendation!.recommendationId)).toBe(true);
    expect(settings.tolerance).toBe(1e-5);
    expect(undoRecommendation(recommendation!.recommendationId)).toBe(true);
    expect(settings.tolerance).toBe(1e-2);
  });

  it("respeta el kill switch local de reglas", () => {
    const disabled = new Set(["solver.loose-tolerance"]);
    expect(evaluateAdvisor(
      context({ settings: { ...defaultSettings, tolerance: 1e-2 } }),
      disabled,
    )).toEqual([]);
  });

  it("evalúa el puntaje global de salud del circuito (Circuit Health Score)", () => {
    // Caso sano: 100% -> Grado A+
    const healthyHealth = evaluateCircuitHealth(context());
    expect(healthyHealth.score).toBe(100);
    expect(healthyHealth.grade).toBe("A+");

    // Caso con error de tierra (ERC error -25 pts + rec -3 pts)
    const errHealth = evaluateCircuitHealth(context({
      erc: { passed: false, errors: ["Referencia a Tierra ausente (GND)"], warnings: [] },
    }));
    expect(errHealth.score).toBeLessThanOrEqual(75);
    expect(errHealth.grade).not.toBe("A+");
  });
});
