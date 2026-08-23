// ==========================================================================
// LOGIC GATE COMPONENT DESCRIPTORS — Compuertas Lógicas Digitales
// ==========================================================================

import {
  drawAndGate,
  drawNandGate,
  drawNorGate,
  drawNotGate,
  drawOrGate,
  drawXorGate,
  type LogicGateRenderOptions,
} from "../../canvas/component_logic_renderer";
import type { ComponentDefinition, LocalPinDefinition } from "../types";

const TWO_INPUT_GATE_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: -40, y: -10, label: "A" },
  { index: 1, x: -40, y: 10, label: "B" },
  { index: 2, x: 40, y: 0, label: "Y" },
];

function getLogicLevel(voltage?: number): "1" | "0" | "X" | undefined {
  if (voltage === undefined) return undefined;
  if (voltage >= 2.0) return "1";
  if (voltage <= 0.8) return "0";
  return "X";
}

function extractTwoInputGateLevels(
  comp: { id: string },
  voltageMap?: Record<string, number>,
): LogicGateRenderOptions {
  if (!voltageMap) return {};
  const vA = voltageMap[`${comp.id}:0`];
  const vB = voltageMap[`${comp.id}:1`];
  const vY = voltageMap[`${comp.id}:2`];
  return {
    levelA: getLogicLevel(vA),
    levelB: getLogicLevel(vB),
    levelY: getLogicLevel(vY),
  };
}

export const AndGateDefinition: ComponentDefinition = {
  type: "and_gate",
  name: "Compuerta AND",
  category: "logica-digital",
  prefix: "U",
  defaultProperties: { value: 1 },
  halfExtents: { halfW: 45, halfH: 30 },
  hasStandardLeads: false,
  getPins: () => TWO_INPUT_GATE_PINS,
  render: (ctx, comp, _state, options) => {
    const opts = extractTwoInputGateLevels(comp, options.voltageMap);
    drawAndGate(ctx, opts);
  },
};

export const OrGateDefinition: ComponentDefinition = {
  type: "or_gate",
  name: "Compuerta OR",
  category: "logica-digital",
  prefix: "U",
  defaultProperties: { value: 1 },
  halfExtents: { halfW: 45, halfH: 30 },
  hasStandardLeads: false,
  getPins: () => TWO_INPUT_GATE_PINS,
  render: (ctx, comp, _state, options) => {
    const opts = extractTwoInputGateLevels(comp, options.voltageMap);
    drawOrGate(ctx, opts);
  },
};

export const NotGateDefinition: ComponentDefinition = {
  type: "not_gate",
  name: "Compuerta NOT (Inversor)",
  category: "logica-digital",
  prefix: "U",
  defaultProperties: { value: 1 },
  halfExtents: { halfW: 45, halfH: 30 },
  hasStandardLeads: false,
  getPins: () => [
    { index: 0, x: -40, y: 0, label: "A" },
    { index: 1, x: 40, y: 0, label: "Y" },
  ],
  render: (ctx, comp, _state, options) => {
    const vA = options.voltageMap?.[`${comp.id}:0`];
    const vY = options.voltageMap?.[`${comp.id}:1`];
    drawNotGate(ctx, {
      levelA: getLogicLevel(vA),
      levelY: getLogicLevel(vY),
    });
  },
};

export const NandGateDefinition: ComponentDefinition = {
  type: "nand_gate",
  name: "Compuerta NAND",
  category: "logica-digital",
  prefix: "U",
  defaultProperties: { value: 1 },
  halfExtents: { halfW: 45, halfH: 30 },
  hasStandardLeads: false,
  getPins: () => TWO_INPUT_GATE_PINS,
  render: (ctx, comp, _state, options) => {
    const opts = extractTwoInputGateLevels(comp, options.voltageMap);
    drawNandGate(ctx, opts);
  },
};

export const NorGateDefinition: ComponentDefinition = {
  type: "nor_gate",
  name: "Compuerta NOR",
  category: "logica-digital",
  prefix: "U",
  defaultProperties: { value: 1 },
  halfExtents: { halfW: 45, halfH: 30 },
  hasStandardLeads: false,
  getPins: () => TWO_INPUT_GATE_PINS,
  render: (ctx, comp, _state, options) => {
    const opts = extractTwoInputGateLevels(comp, options.voltageMap);
    drawNorGate(ctx, opts);
  },
};

export const XorGateDefinition: ComponentDefinition = {
  type: "xor_gate",
  name: "Compuerta XOR",
  category: "logica-digital",
  prefix: "U",
  defaultProperties: { value: 1 },
  halfExtents: { halfW: 45, halfH: 30 },
  hasStandardLeads: false,
  getPins: () => TWO_INPUT_GATE_PINS,
  render: (ctx, comp, _state, options) => {
    const opts = extractTwoInputGateLevels(comp, options.voltageMap);
    drawXorGate(ctx, opts);
  },
};
