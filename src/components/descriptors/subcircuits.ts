// ==========================================================================
// SUBCIRCUIT COMPONENT DESCRIPTORS — Macromodelos SPICE (.SUBCKT)
// ==========================================================================

import type { ComponentInstance } from "../../canvas_orchestrator";
import {
  detectSubcircuitLayoutStyle,
  drawTranspiledSubcircuit,
  generateTranspiledPins,
  evaluateTranspiledBehavior,
  type SubcircuitLayoutStyle,
} from "../../simulation/spice_to_component_transpiler";
import type { ComponentDefinition } from "../types";

export const SubcircuitDefinition: ComponentDefinition = {
  type: "x",
  name: "Macromodelo SPICE (.SUBCKT)",
  category: "macromodelos",
  prefix: "X",
  defaultProperties: { value: "SUBCKT_MACRO", pinCount: 4 },
  halfExtents: (comp: ComponentInstance) => {
    const pinCount = comp.pinCount ?? 4;
    const pinNames: string[] = [];
    for (let i = 0; i < pinCount; i++) {
      pinNames.push(comp.pinLabels?.[i] ?? `P${i + 1}`);
    }

    const layoutStyle =
      (comp.terminalType as SubcircuitLayoutStyle) ||
      detectSubcircuitLayoutStyle(String(comp.modelName || comp.value || ""), pinNames);

    const { halfExtents } = generateTranspiledPins(layoutStyle, pinNames);
    return halfExtents;
  },
  hasStandardLeads: false,
  hasValueLabel: false,
  getPins: (comp: ComponentInstance) => {
    const pinCount = comp.pinCount ?? 4;
    const pinNames: string[] = [];
    for (let i = 0; i < pinCount; i++) {
      pinNames.push(comp.pinLabels?.[i] ?? `P${i + 1}`);
    }

    const layoutStyle =
      (comp.terminalType as SubcircuitLayoutStyle) ||
      detectSubcircuitLayoutStyle(String(comp.modelName || comp.value || ""), pinNames);

    const { pins } = generateTranspiledPins(layoutStyle, pinNames);
    return pins;
  },
  render: (ctx, comp, state) => {
    drawTranspiledSubcircuit(ctx, comp, state.color, state.lineWidth);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    return evaluateTranspiledBehavior(pinVoltages, comp);
  },
};

