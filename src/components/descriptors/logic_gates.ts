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
} from "../../canvas/component_logic_renderer";
import type { ComponentDefinition, LocalPinDefinition } from "../types";

const TWO_INPUT_GATE_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: -40, y: -10, label: "A" },
  { index: 1, x: -40, y: 10, label: "B" },
  { index: 2, x: 40, y: 0, label: "Y" },
];

export const AndGateDefinition: ComponentDefinition = {
  type: "and_gate",
  name: "Compuerta AND",
  category: "logica-digital",
  prefix: "U",
  defaultProperties: { value: 1 },
  halfExtents: { halfW: 45, halfH: 30 },
  hasStandardLeads: false,
  getPins: () => TWO_INPUT_GATE_PINS,
  render: (ctx) => {
    drawAndGate(ctx);
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
  render: (ctx) => {
    drawOrGate(ctx);
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
  render: (ctx) => {
    drawNotGate(ctx);
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
  render: (ctx) => {
    drawNandGate(ctx);
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
  render: (ctx) => {
    drawNorGate(ctx);
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
  render: (ctx) => {
    drawXorGate(ctx);
  },
};
