import { describe, expect, it, vi } from "vitest";
import type { ComponentInstance } from "../canvas_orchestrator";
import {
  CccsDefinition,
  CcvsDefinition,
  VccsDefinition,
  VcvsDefinition,
} from "../components/descriptors/analog";
import { extractElectricalNetlist } from "./netlist_extractor";
import { solveCircuitTS } from "./fallback_solver";

describe("Controlled / Dependent Sources (VCVS, VCCS, CCVS, CCCS)", () => {
  it("Valida metadatos, prefijos SPICE y alineación a 20px de las 4 fuentes", () => {
    const defs = [
      { def: VcvsDefinition, type: "vcvs", prefix: "E" },
      { def: VccsDefinition, type: "vccs", prefix: "G" },
      { def: CcvsDefinition, type: "ccvs", prefix: "H" },
      { def: CccsDefinition, type: "cccs", prefix: "F" },
    ];

    for (const item of defs) {
      expect(item.def.type).toBe(item.type);
      expect(item.def.prefix).toBe(item.prefix);
      expect(item.def.category).toBe("analogicos");

      const comp: ComponentInstance = {
        id: `${item.prefix}1`,
        type: item.type as ComponentInstance["type"],
        x: 0,
        y: 0,
        rotation: 0,
        value: 1.0,
      };

      const pins = item.def.getPins(comp);
      expect(pins).toHaveLength(4);

      for (const pin of pins) {
        expect(Math.abs(pin.x % 20)).toBe(0);
        expect(Math.abs(pin.y % 20)).toBe(0);
      }
    }
  });

  it("Evalúa comportamiento de pequeña señal en vivo (evaluateLiveBehavior)", () => {
    // 1. VCVS: Vin = 2.5V, Gain = 4 -> Vout = 10.0V
    const vcvsComp: ComponentInstance = { id: "E1", type: "vcvs", x: 0, y: 0, rotation: 0, value: 4.0 };
    const liveVcvs = VcvsDefinition.evaluateLiveBehavior!({ 0: 10, 1: 0, 2: 2.5, 3: 0 }, vcvsComp);
    expect(liveVcvs.dynamicState?.vIn).toBe(2.5);
    expect(liveVcvs.dynamicState?.targetVout).toBe(10.0);

    // 2. VCCS: Vin = 2.0V, gm = 5mS -> Iout = 10mA
    const vccsComp: ComponentInstance = { id: "G1", type: "vccs", x: 0, y: 0, rotation: 0, value: 0.005 };
    const liveVccs = VccsDefinition.evaluateLiveBehavior!({ 0: 0, 1: 0, 2: 2.0, 3: 0 }, vccsComp);
    expect(liveVccs.branchCurrents[0]).toBeCloseTo(0.01);
    expect(liveVccs.branchCurrents[1]).toBeCloseTo(-0.01);

    // 3. CCVS: Iin = 2mA, Rm = 5k -> Vout = 10.0V
    const ccvsComp: ComponentInstance = { id: "H1", type: "ccvs", x: 0, y: 0, rotation: 0, value: 5000 };
    const liveCcvs = CcvsDefinition.evaluateLiveBehavior!({ 0: 0, 1: 0, 2: 0.002, 3: 0 }, ccvsComp);
    expect(liveCcvs.dynamicState?.targetVout).toBeCloseTo(10.0);

    // 4. CCCS: Iin = 1mA, Ai = 100 -> Iout = 100mA
    const cccsComp: ComponentInstance = { id: "F1", type: "cccs", x: 0, y: 0, rotation: 0, value: 100 };
    const liveCccs = CccsDefinition.evaluateLiveBehavior!({ 0: 0, 1: 0, 2: 0.001, 3: 0 }, cccsComp);
    expect(liveCccs.dynamicState?.iOut).toBeCloseTo(0.1);
  });

  it("Extrae netlists SPICE estructuradas con 4 nodos y fuentes de sensado auxiliares", () => {
    const getPins = (c: ComponentInstance) => {
      if (c.type === "ground") {
        return [{ componentId: c.id, pinIndex: 0, x: 0, y: 0 }];
      }
      return [
        { componentId: c.id, pinIndex: 0, x: 40, y: -20 },
        { componentId: c.id, pinIndex: 1, x: 40, y: 20 },
        { componentId: c.id, pinIndex: 2, x: -40, y: -20 },
        { componentId: c.id, pinIndex: 3, x: -40, y: 20 },
      ];
    };

    const components: ComponentInstance[] = [
      { id: "GND1", type: "ground", x: 0, y: 0, rotation: 0, value: 0 },
      { id: "E1", type: "vcvs", x: 100, y: 100, rotation: 0, value: 5.0 },
      { id: "G1", type: "vccs", x: 200, y: 100, rotation: 0, value: 0.002 },
      { id: "H1", type: "ccvs", x: 300, y: 100, rotation: 0, value: 1000 },
      { id: "F1", type: "cccs", x: 400, y: 100, rotation: 0, value: 50 },
    ];

    const wires = [
      // Wires conectando cada pin de cada fuente a GND1:0 para formar redes cerradas válidas
      ...[0, 1, 2, 3].map((pin) => ({
        id: `w_e1_${pin}`,
        from: { componentId: "E1", pinIndex: pin },
        to: { componentId: "GND1", pinIndex: 0 },
      })),
      ...[0, 1, 2, 3].map((pin) => ({
        id: `w_g1_${pin}`,
        from: { componentId: "G1", pinIndex: pin },
        to: { componentId: "GND1", pinIndex: 0 },
      })),
      ...[0, 1, 2, 3].map((pin) => ({
        id: `w_h1_${pin}`,
        from: { componentId: "H1", pinIndex: pin },
        to: { componentId: "GND1", pinIndex: 0 },
      })),
      ...[0, 1, 2, 3].map((pin) => ({
        id: `w_f1_${pin}`,
        from: { componentId: "F1", pinIndex: pin },
        to: { componentId: "GND1", pinIndex: 0 },
      })),
    ];

    const extraction = extractElectricalNetlist(components, wires, getPins);
    expect(extraction.error).toBeUndefined();

    const extracted = extraction.netlist.components;

    // VCVS
    const e1 = extracted.find((c) => c.id === "E1");
    expect(e1).toBeDefined();
    expect(e1?.type).toBe("vcvs");
    expect(e1?.value).toBe(5.0);
    expect(e1?.pins).toHaveLength(4);

    // VCCS
    const g1 = extracted.find((c) => c.id === "G1");
    expect(g1).toBeDefined();
    expect(g1?.type).toBe("vccs");
    expect(g1?.value).toBe(0.002);
    expect(g1?.pins).toHaveLength(4);

    // CCVS con sensor 0V
    const h1 = extracted.find((c) => c.id === "H1");
    expect(h1).toBeDefined();
    expect(h1?.type).toBe("ccvs");
    expect(h1?.controlling_source).toBe("V_SENSE_H1");
    const vSenseH1 = extracted.find((c) => c.id === "V_SENSE_H1");
    expect(vSenseH1).toBeDefined();
    expect(vSenseH1?.type).toBe("vsource");
    expect(vSenseH1?.value).toBe(0.0);

    // CCCS con sensor 0V
    const f1 = extracted.find((c) => c.id === "F1");
    expect(f1).toBeDefined();
    expect(f1?.type).toBe("cccs");
    expect(f1?.controlling_source).toBe("V_SENSE_F1");
    const vSenseF1 = extracted.find((c) => c.id === "V_SENSE_F1");
    expect(vSenseF1).toBeDefined();
    expect(vSenseF1?.type).toBe("vsource");
  });

  it("Resuelve analíticamente circuitos con VCVS y VCCS en el solver MNA de respaldo", () => {
    // 1. Circuito con VCVS: V1 = 2V, E1 = 10x Vin, Rload = 1k
    const netlistVcvs = {
      components: [
        { id: "V1", type: "vsource", value: 2.0, pins: ["1", "0"] },
        { id: "E1", type: "vcvs", value: 10.0, pins: ["2", "0", "1", "0"] },
        { id: "Rload", type: "resistor", value: 1000.0, pins: ["2", "0"] },
      ],
      wires: [],
    };

    const resVcvs = solveCircuitTS(netlistVcvs);
    expect(typeof resVcvs).not.toBe("string");
    if (typeof resVcvs !== "string") {
      expect(resVcvs.nodeVoltages["1"]).toBeCloseTo(2.0);
      expect(resVcvs.nodeVoltages["2"]).toBeCloseTo(20.0); // 2V * 10 = 20V
    }

    // 2. Circuito con VCCS: V1 = 2V, G1 inyecta corriente desde 0 hacia 2 (G1 0 2 1 0 2mS), Rload = 1k -> V(2) = 4V
    const netlistVccs = {
      components: [
        { id: "V1", type: "vsource", value: 2.0, pins: ["1", "0"] },
        { id: "G1", type: "vccs", value: 0.002, pins: ["0", "2", "1", "0"] },
        { id: "Rload", type: "resistor", value: 1000.0, pins: ["2", "0"] },
      ],
      wires: [],
    };

    const resVccs = solveCircuitTS(netlistVccs);
    expect(typeof resVccs).not.toBe("string");
    if (typeof resVccs !== "string") {
      expect(resVccs.nodeVoltages["1"]).toBeCloseTo(2.0);
      expect(resVccs.nodeVoltages["2"]).toBeCloseTo(4.0); // 0.002 * 2V * 1000 = 4V
    }
  });

  it("Renderiza en Canvas 2D los símbolos vectoriales en rombo para las 4 fuentes", () => {
    const createMockCtx = () => ({
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillText: vi.fn(),
      font: "",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      textAlign: "left",
      textBaseline: "middle",
    }) as unknown as CanvasRenderingContext2D;

    const ctx = createMockCtx();
    const state = { color: "#38BDF8", lineWidth: 1.5, selected: false, hovered: false, isDark: true };
    const options = { detail: "full" as const, symbolStandard: "IEEE" as const };

    const comp: ComponentInstance = { id: "E1", type: "vcvs", x: 0, y: 0, rotation: 0, value: 5 };

    VcvsDefinition.render(ctx, comp, state, options);
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith("5x", expect.any(Number), expect.any(Number));

    VccsDefinition.render(ctx, { ...comp, type: "vccs", value: 0.002 }, state, options);
    CcvsDefinition.render(ctx, { ...comp, type: "ccvs", value: 2000 }, state, options);
    CccsDefinition.render(ctx, { ...comp, type: "cccs", value: 50 }, state, options);
  });
});
