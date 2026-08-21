import { describe, expect, it } from "vitest";
import type { ComponentInstance, WireInstance } from "../canvas_orchestrator";
import type { Tab } from "../ui/workspace_state";
import {
  generateSubcircuitFromTab,
  gatherHierarchicalSubcircuitDefinitions,
  sanitizeSpiceName,
} from "./hierarchical_netlist";

describe("hierarchical_netlist", () => {
  it("sanitiza nombres de subcircuito para SPICE", () => {
    expect(sanitizeSpiceName("Filtro Paso-Bajas 10k")).toBe("Filtro_Paso_Bajas_10k");
    expect(sanitizeSpiceName("OpAmp@Dual#1")).toBe("OpAmp_Dual_1");
    expect(sanitizeSpiceName("   ")).toBe("SUBCKT_BLOCK");
  });

  it("genera definición SPICE (.subckt ... .ends) a partir de una hoja esquemática hija", () => {
    const childComponents: ComponentInstance[] = [
      {
        id: "PORT_IN",
        type: "net_label",
        label: "IN",
        terminalType: "signal",
        x: 0,
        y: 0,
        rotation: 0,
      },
      {
        id: "R1",
        type: "resistor",
        value: 1000,
        x: 50,
        y: 0,
        rotation: 0,
      },
      {
        id: "R2",
        type: "resistor",
        value: 2000,
        x: 100,
        y: 0,
        rotation: 0,
      },
      {
        id: "PORT_OUT",
        type: "net_label",
        label: "OUT",
        terminalType: "signal",
        x: 150,
        y: 0,
        rotation: 0,
      },
      {
        id: "PORT_REF",
        type: "net_label",
        label: "REF",
        terminalType: "signal",
        x: 100,
        y: 50,
        rotation: 0,
      },
    ];

    const childWires: WireInstance[] = [
      {
        id: "w1",
        from: { componentId: "PORT_IN", pinIndex: 0 },
        to: { componentId: "R1", pinIndex: 0 },
        points: [],
      },
      {
        id: "w2",
        from: { componentId: "R1", pinIndex: 1 },
        to: { componentId: "R2", pinIndex: 0 },
        points: [],
      },
      {
        id: "w3",
        from: { componentId: "R2", pinIndex: 0 },
        to: { componentId: "PORT_OUT", pinIndex: 0 },
        points: [],
      },
      {
        id: "w4",
        from: { componentId: "R2", pinIndex: 1 },
        to: { componentId: "PORT_REF", pinIndex: 0 },
        points: [],
      },
    ];

    const tab = {
      name: "Divisor_Resistivo",
      subcircuitName: "Divisor_Resistivo",
      components: childComponents,
      wires: childWires,
    };

    const sub = generateSubcircuitFromTab(tab);

    expect(sub.name).toBe("Divisor_Resistivo");
    expect(sub.ports).toContain("IN");
    expect(sub.ports).toContain("OUT");
    expect(sub.ports).toContain("REF");
    expect(sub.spiceText).toContain(".subckt Divisor_Resistivo");
    expect(sub.spiceText).toContain("R_R1");
    expect(sub.spiceText).toContain("R_R2");
    expect(sub.spiceText).toContain(".ends Divisor_Resistivo");
  });

  it("recolecta recursivamente subcircuitos jerárquicos multinivel", () => {
    // Hoja Nieta: Filtro RC
    const grandchildTab = {
      id: "tab_filter",
      name: "Filtro_RC",
      subcircuitName: "Filtro_RC",
      components: [
        { id: "P_IN", type: "net_label", label: "IN", terminalType: "signal", x: 0, y: 0, rotation: 0 },
        { id: "R_F", type: "resistor", value: 10000, x: 50, y: 0, rotation: 0 },
        { id: "C_F", type: "capacitor", value: 1e-9, x: 100, y: 0, rotation: 0 },
        { id: "P_OUT", type: "net_label", label: "OUT", terminalType: "signal", x: 150, y: 0, rotation: 0 },
      ],
      wires: [
        { id: "w_f1", from: { componentId: "P_IN", pinIndex: 0 }, to: { componentId: "R_F", pinIndex: 0 }, points: [] },
        { id: "w_f2", from: { componentId: "R_F", pinIndex: 1 }, to: { componentId: "C_F", pinIndex: 0 }, points: [] },
        { id: "w_f3", from: { componentId: "C_F", pinIndex: 0 }, to: { componentId: "P_OUT", pinIndex: 0 }, points: [] },
      ],
    } as Tab;

    // Hoja Hija: Etapa Amplificadora con Filtro_RC anidado
    const childTab = {
      id: "tab_stage",
      name: "Etapa_Amp",
      subcircuitName: "Etapa_Amp",
      components: [
        { id: "P_SIG_IN", type: "net_label", label: "SIG_IN", terminalType: "signal", x: 0, y: 0, rotation: 0 },
        { id: "X_FILT", type: "x", subcircuitName: "Filtro_RC", subcircuitTabId: "tab_filter", x: 50, y: 0, rotation: 0 },
        { id: "P_SIG_OUT", type: "net_label", label: "SIG_OUT", terminalType: "signal", x: 150, y: 0, rotation: 0 },
      ],
      wires: [
        { id: "w_s1", from: { componentId: "P_SIG_IN", pinIndex: 0 }, to: { componentId: "X_FILT", pinIndex: 0 }, points: [] },
        { id: "w_s2", from: { componentId: "X_FILT", pinIndex: 1 }, to: { componentId: "P_SIG_OUT", pinIndex: 0 }, points: [] },
      ],
    } as Tab;

    // Circuito Raíz: Usa Etapa_Amp
    const rootComponents: ComponentInstance[] = [
      { id: "V_SOURCE", type: "vsource", value: 1, x: 0, y: 0, rotation: 0 },
      { id: "X_STAGE1", type: "x", subcircuitName: "Etapa_Amp", subcircuitTabId: "tab_stage", x: 50, y: 0, rotation: 0 },
    ];

    const allTabs: Tab[] = [childTab, grandchildTab];

    const defs = gatherHierarchicalSubcircuitDefinitions(rootComponents, allTabs);

    expect(defs).toContain(".subckt Etapa_Amp");
    expect(defs).toContain(".subckt Filtro_RC");
    expect(defs).toContain(".ends Etapa_Amp");
    expect(defs).toContain(".ends Filtro_RC");
  });
});
