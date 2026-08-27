// ==========================================================================
// ADVANCED INSTRUMENTATION COMPONENT DESCRIPTORS
// Vatímetro, Sonda Lógica Digital, Inyector de Pulsos, Frecuencímetro
// ==========================================================================

import {
  drawFrequencyCounter,
  drawLogicProbe,
  drawPulseGenerator,
  drawStbProbe,
  drawWattmeter,
} from "../../canvas/component_instrument_renderer";
import type { ComponentDefinition, LocalPinDefinition } from "../types";

// ─── 1. VATÍMETRO / ANALIZADOR DE POTENCIA ─────────────────────────────────

const WATTMETER_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: -40, y: -20, label: "I+", name: "Entrada de Corriente (+)" },
  { index: 1, x: 40, y: -20, label: "I-", name: "Salida de Corriente (-)" },
  { index: 2, x: -40, y: 20, label: "V+", name: "Tensión Positiva (+)" },
  { index: 3, x: 40, y: 20, label: "V-", name: "Tensión Negativa (-)" },
];

export const WattmeterDefinition: ComponentDefinition = {
  type: "wattmeter",
  name: "Vatímetro / Analizador de Potencia",
  category: "pasivos",
  prefix: "W",
  defaultProperties: { value: 0, activePower: 0, powerFactor: 1.0 },
  halfExtents: { halfW: 45, halfH: 35 },
  hasStandardLeads: false,
  getPins: () => WATTMETER_PINS,
  render: (ctx, comp, state) => {
    drawWattmeter(ctx, comp, state.color);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const vIin = pinVoltages[0] ?? 0;
    const vIout = pinVoltages[1] ?? 0;
    const vPos = pinVoltages[2] ?? 0;
    const vNeg = pinVoltages[3] ?? 0;

    const rShunt = 0.001; // 1 mOhm
    const i = (vIin - vIout) / rShunt;
    const v = vPos - vNeg;
    const p = v * i;

    comp.activePower = Math.abs(p) < 1e-12 ? 0 : p;
    comp.apparentPower = Math.abs(v * i);
    comp.powerFactor = 1.0;

    return {
      branchCurrents: { 0: i, 1: -i, 2: 0, 3: 0 },
      dynamicState: { activePower: comp.activePower, voltage: v, current: i },
    };
  },
};

// ─── 2. SONDA LÓGICA DIGITAL ───────────────────────────────────────────────

const LOGIC_PROBE_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: 0, y: 20, label: "IN", name: "Punta de Prueba Lógica" },
];

export const LogicProbeDefinition: ComponentDefinition = {
  type: "logic_probe",
  name: "Sonda Lógica Digital",
  category: "logica-digital",
  prefix: "LP",
  defaultProperties: { value: "X", logicState: "X" },
  halfExtents: { halfW: 20, halfH: 35 },
  hasStandardLeads: false,
  hasValueLabel: false,
  getPins: () => LOGIC_PROBE_PINS,
  render: (ctx, comp, state) => {
    drawLogicProbe(ctx, comp, state.color);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const v = pinVoltages[0];

    if (v === undefined || isNaN(v)) {
      comp.logicState = "X";
    } else if (v >= 2.0) {
      comp.logicState = "1";
    } else if (v <= 0.8) {
      comp.logicState = "0";
    } else {
      comp.logicState = "X";
    }

    return {
      branchCurrents: { 0: 0 },
      dynamicState: { logicState: comp.logicState, voltage: v },
    };
  },
};

// ─── 3. INYECTOR / GENERADOR DE PULSOS LÓGICOS ─────────────────────────────

const PULSE_GEN_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: -20, y: 0, label: "⏚", name: "Tierra de Referencia (COM)" },
  { index: 1, x: 20, y: 0, label: "OUT", name: "Salida de Pulsos TTL (5V)" },
];

export const PulseGeneratorDefinition: ComponentDefinition = {
  type: "pulse_generator",
  name: "Inyector de Pulsos Lógicos",
  category: "logica-digital",
  prefix: "PULSE",
  defaultProperties: { value: 1000, frequency: 1000, amplitude: 5.0, dutyCycle: 0.5 },
  halfExtents: { halfW: 30, halfH: 30 },
  hasStandardLeads: false,
  getPins: () => PULSE_GEN_PINS,
  render: (ctx, comp, state) => {
    drawPulseGenerator(ctx, comp, state.color);
  },
  evaluateLiveBehavior: (_pinVoltages, comp) => {
    const vOut = comp.amplitude ?? 5.0;
    const rOut = 25.0; // 25 Ohms
    const i = vOut / rOut;
    return {
      branchCurrents: { 0: -i, 1: i },
      dynamicState: { vOut, frequency: comp.frequency ?? 1000 },
    };
  },
};

// ─── 4. FRECUENCÍMETRO DIGITAL ─────────────────────────────────────────────

const FREQ_COUNTER_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: -40, y: 0, label: "IN", name: "Entrada de Señal" },
  { index: 1, x: 40, y: 0, label: "COM", name: "Referencia Común (GND)" },
];

export const FrequencyCounterDefinition: ComponentDefinition = {
  type: "frequency_counter",
  name: "Frecuencímetro Digital",
  category: "pasivos",
  prefix: "FC",
  defaultProperties: { value: 1000, frequencyReading: 1000 },
  halfExtents: { halfW: 45, halfH: 30 },
  hasStandardLeads: false,
  getPins: () => FREQ_COUNTER_PINS,
  render: (ctx, comp, state) => {
    drawFrequencyCounter(ctx, comp, state.color);
  },
  evaluateLiveBehavior: (_pinVoltages, comp) => {
    const f = typeof comp.value === "number" && comp.value > 0 ? comp.value : 1000;
    comp.frequencyReading = f;
    return {
      branchCurrents: { 0: 0, 1: 0 },
      dynamicState: { frequency: f },
    };
  },
};

// ─── 5. SONDA DE ESTABILIDAD TIAN / MIDDLEBROOK ─────────────────────────────

const STB_PROBE_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: -20, y: 0, label: "A", name: "Inyección de Lazo (Salida / Nodo A)" },
  { index: 1, x: 20, y: 0, label: "B", name: "Retorno de Lazo (Entrada / Nodo B)" },
];

export const StbProbeDefinition: ComponentDefinition = {
  type: "stb_probe",
  name: "Sonda de Estabilidad Tian (STB)",
  category: "pasivos",
  prefix: "STB",
  defaultProperties: { value: 0 },
  halfExtents: { halfW: 20, halfH: 15 },
  hasStandardLeads: false,
  getPins: () => STB_PROBE_PINS,
  render: (ctx, comp, state) => {
    drawStbProbe(ctx, comp, state.color);
  },
  evaluateLiveBehavior: (pinVoltages, _comp) => {
    const vA = pinVoltages[0] ?? 0;
    const vB = pinVoltages[1] ?? 0;
    const rConductance = 1e6; // 1 µΩ transparente en DC / TRAN
    const current = (vA - vB) * rConductance;
    return {
      branchCurrents: { 0: current, 1: -current },
      dynamicState: { vA, vB },
    };
  },
};

