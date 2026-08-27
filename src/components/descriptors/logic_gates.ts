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
  getGateInputYOffsets,
  type LogicGateRenderOptions,
} from "../../canvas/component_logic_renderer";
import type { ComponentDefinition, LocalPinDefinition } from "../types";
import type { ComponentInstance } from "../../canvas_orchestrator";

function getLogicGatePins(comp?: { gateInputs?: number }): readonly LocalPinDefinition[] {
  const inputs = comp?.gateInputs ?? 2;
  const yOffsets = getGateInputYOffsets(inputs);
  const pins: LocalPinDefinition[] = yOffsets.map((y, idx) => {
    const label = String.fromCharCode(65 + idx);
    return {
      index: idx,
      x: -40,
      y,
      label,
      name: `Entrada ${label}`,
    };
  });
  pins.push({
    index: inputs,
    x: 40,
    y: 0,
    label: "Y",
    name: "Salida Y",
  });
  return pins;
}

function getLogicLevel(voltage?: number, vth: number = 2.5): "1" | "0" | "X" | undefined {
  if (voltage === undefined) return undefined;
  if (voltage >= vth * 0.8) return "1";
  if (voltage <= vth * 0.35) return "0";
  return "X";
}

function extractGateLevels(
  comp: ComponentInstance,
  voltageMap?: Record<string, number>,
  symbolStandard?: "IEEE" | "IEC",
): LogicGateRenderOptions {
  const inputs = comp.gateInputs ?? 2;
  const numVal = Number(comp.value) || 5.0;
  const vth = comp.offset !== undefined ? comp.offset : (comp.logicFamily === "ttl" ? 1.4 : numVal * 0.5);
  const std = comp.symbolStandard ?? symbolStandard ?? "IEEE";
  if (!voltageMap) {
    return {
      inputCount: inputs,
      schmittTrigger: comp.schmittTrigger,
      openCollector: comp.openCollector,
      symbolStandard: std,
    };
  }

  const inputLevels: ("1" | "0" | "X" | undefined)[] = [];
  for (let i = 0; i < inputs; i++) {
    const v = voltageMap[`${comp.id}:${i}`];
    inputLevels.push(getLogicLevel(v, vth));
  }
  const vY = voltageMap[`${comp.id}:${inputs}`];
  const levelY = getLogicLevel(vY, vth);

  return {
    levelA: inputLevels[0],
    levelB: inputLevels[1],
    levelY,
    inputLevels,
    inputCount: inputs,
    schmittTrigger: comp.schmittTrigger,
    openCollector: comp.openCollector,
    symbolStandard: std,
  };
}

function evaluateGateLiveBehavior(
  pinVoltages: Record<number, number | undefined>,
  comp: ComponentInstance,
  op: (inputs: boolean[]) => boolean,
) {
  const inputCount = comp.gateInputs ?? 2;
  const numVal = Number(comp.value) || 5.0;
  const vth = comp.offset !== undefined ? comp.offset : (comp.logicFamily === "ttl" ? 1.4 : numVal * 0.5);
  const voh = numVal;

  const booleanInputs: boolean[] = [];
  for (let i = 0; i < inputCount; i++) {
    const v = pinVoltages[i] ?? 0;
    booleanInputs.push(v >= vth);
  }

  const outBool = op(booleanInputs);
  const targetVout = outBool ? voh : 0.0;
  const actualVout = pinVoltages[inputCount] ?? targetVout;
  const rout = comp.gateRout ?? 50.0;
  const iOut = (targetVout - actualVout) / Math.max(1.0, rout);

  const branchCurrents: Record<number, number> = {};
  for (let i = 0; i < inputCount; i++) {
    branchCurrents[i] = 1e-9;
  }
  branchCurrents[inputCount] = iOut;

  return { branchCurrents };
}

export const AndGateDefinition: ComponentDefinition = {
  type: "and_gate",
  name: "Compuerta AND",
  category: "logica-digital",
  prefix: "U",
  defaultProperties: { value: 5.0, offset: 2.5, gateInputs: 2 },
  halfExtents: (comp) => {
    const inputs = comp?.gateInputs ?? 2;
    return { halfW: 45, halfH: inputs >= 8 ? 85 : (inputs >= 4 ? 45 : (inputs >= 3 ? 35 : 30)) };
  },
  hasStandardLeads: false,
  getPins: (comp) => getLogicGatePins(comp),
  render: (ctx, comp, _state, options) => {
    const opts = extractGateLevels(comp, options.voltageMap, options.symbolStandard);
    drawAndGate(ctx, opts);
  },
  evaluateLiveBehavior: (pinVoltages, comp) =>
    evaluateGateLiveBehavior(pinVoltages, comp, (ins) => ins.every((v) => v)),
};

export const OrGateDefinition: ComponentDefinition = {
  type: "or_gate",
  name: "Compuerta OR",
  category: "logica-digital",
  prefix: "U",
  defaultProperties: { value: 5.0, offset: 2.5, gateInputs: 2 },
  halfExtents: (comp) => {
    const inputs = comp?.gateInputs ?? 2;
    return { halfW: 45, halfH: inputs >= 8 ? 85 : (inputs >= 4 ? 45 : (inputs >= 3 ? 35 : 30)) };
  },
  hasStandardLeads: false,
  getPins: (comp) => getLogicGatePins(comp),
  render: (ctx, comp, _state, options) => {
    const opts = extractGateLevels(comp, options.voltageMap, options.symbolStandard);
    drawOrGate(ctx, opts);
  },
  evaluateLiveBehavior: (pinVoltages, comp) =>
    evaluateGateLiveBehavior(pinVoltages, comp, (ins) => ins.some((v) => v)),
};

export const NotGateDefinition: ComponentDefinition = {
  type: "not_gate",
  name: "Compuerta NOT (Inversor)",
  category: "logica-digital",
  prefix: "U",
  defaultProperties: { value: 5.0, offset: 2.5, gateInputs: 1 },
  halfExtents: { halfW: 45, halfH: 30 },
  hasStandardLeads: false,
  getPins: () => [
    { index: 0, x: -40, y: 0, label: "A", name: "Entrada A" },
    { index: 1, x: 40, y: 0, label: "Y", name: "Salida Y" },
  ],
  render: (ctx, comp, _state, options) => {
    const vth = comp.offset !== undefined ? comp.offset : (comp.logicFamily === "ttl" ? 1.4 : 2.5);
    const vA = options.voltageMap?.[`${comp.id}:0`];
    const vY = options.voltageMap?.[`${comp.id}:1`];
    drawNotGate(ctx, {
      levelA: getLogicLevel(vA, vth),
      levelY: getLogicLevel(vY, vth),
      schmittTrigger: comp.schmittTrigger,
      openCollector: comp.openCollector,
      symbolStandard: comp.symbolStandard ?? options.symbolStandard ?? "IEEE",
    });
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const vth = comp.offset !== undefined ? comp.offset : (comp.logicFamily === "ttl" ? 1.4 : 2.5);
    const voh = Number(comp.value) || 5.0;
    const vA = pinVoltages[0] ?? 0;
    const outBool = vA < vth;
    const targetVout = outBool ? voh : 0.0;
    const actualVout = pinVoltages[1] ?? targetVout;
    const rout = comp.gateRout ?? 50.0;
    const iOut = (targetVout - actualVout) / Math.max(1.0, rout);
    return { branchCurrents: { 0: 1e-9, 1: iOut } };
  },
};

export const NandGateDefinition: ComponentDefinition = {
  type: "nand_gate",
  name: "Compuerta NAND",
  category: "logica-digital",
  prefix: "U",
  defaultProperties: { value: 5.0, offset: 2.5, gateInputs: 2 },
  halfExtents: (comp) => {
    const inputs = comp?.gateInputs ?? 2;
    return { halfW: 45, halfH: inputs >= 8 ? 85 : (inputs >= 4 ? 45 : (inputs >= 3 ? 35 : 30)) };
  },
  hasStandardLeads: false,
  getPins: (comp) => getLogicGatePins(comp),
  render: (ctx, comp, _state, options) => {
    const opts = extractGateLevels(comp, options.voltageMap, options.symbolStandard);
    drawNandGate(ctx, opts);
  },
  evaluateLiveBehavior: (pinVoltages, comp) =>
    evaluateGateLiveBehavior(pinVoltages, comp, (ins) => !ins.every((v) => v)),
};

export const NorGateDefinition: ComponentDefinition = {
  type: "nor_gate",
  name: "Compuerta NOR",
  category: "logica-digital",
  prefix: "U",
  defaultProperties: { value: 5.0, offset: 2.5, gateInputs: 2 },
  halfExtents: (comp) => {
    const inputs = comp?.gateInputs ?? 2;
    return { halfW: 45, halfH: inputs >= 8 ? 85 : (inputs >= 4 ? 45 : (inputs >= 3 ? 35 : 30)) };
  },
  hasStandardLeads: false,
  getPins: (comp) => getLogicGatePins(comp),
  render: (ctx, comp, _state, options) => {
    const opts = extractGateLevels(comp, options.voltageMap, options.symbolStandard);
    drawNorGate(ctx, opts);
  },
  evaluateLiveBehavior: (pinVoltages, comp) =>
    evaluateGateLiveBehavior(pinVoltages, comp, (ins) => !ins.some((v) => v)),
};

export const XorGateDefinition: ComponentDefinition = {
  type: "xor_gate",
  name: "Compuerta XOR",
  category: "logica-digital",
  prefix: "U",
  defaultProperties: { value: 5.0, offset: 2.5, gateInputs: 2 },
  halfExtents: (comp) => {
    const inputs = comp?.gateInputs ?? 2;
    return { halfW: 45, halfH: inputs >= 8 ? 85 : (inputs >= 4 ? 45 : (inputs >= 3 ? 35 : 30)) };
  },
  hasStandardLeads: false,
  getPins: (comp) => getLogicGatePins(comp),
  render: (ctx, comp, _state, options) => {
    const opts = extractGateLevels(comp, options.voltageMap, options.symbolStandard);
    drawXorGate(ctx, opts);
  },
  evaluateLiveBehavior: (pinVoltages, comp) =>
    evaluateGateLiveBehavior(pinVoltages, comp, (ins) => ins.filter((v) => v).length % 2 !== 0),
};

