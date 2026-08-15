// ==========================================================================
// ACTUATOR COMPONENT DESCRIPTORS — Lámparas, Relés, Zumbadores, Interruptores
// ==========================================================================

import { drawBuzzer, drawLamp, drawRelay } from "../../canvas/component_actuator_renderer";
import { drawSwitch } from "../../canvas/component_discrete_renderer";
import type { ComponentDefinition, LocalPinDefinition } from "../types";

const STANDARD_TWO_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: -40, y: 0, label: "1" },
  { index: 1, x: 40, y: 0, label: "2" },
];

export const LampDefinition: ComponentDefinition = {
  type: "lamp",
  name: "Lámpara Incandescente",
  category: "actuadores",
  prefix: "LP",
  defaultProperties: { value: "120;rhot=120;rcold=26.4;vnom=12;pnom=1.2;heat=90;cool=160" },
  halfExtents: { halfW: 40, halfH: 40 },
  getPins: () => STANDARD_TWO_PINS,
  render: (ctx, comp) => {
    drawLamp(ctx, comp);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const v0 = pinVoltages[0] ?? 0;
    const v1 = pinVoltages[1] ?? 0;
    const vDiff = Math.abs(v0 - v1);
    const glow = vDiff > 1.0 ? Math.min(1.0, (vDiff * vDiff) / 144) : 0;
    comp.glowLevel = glow;
    const rLamp = 120;
    const i = (v0 - v1) / rLamp;
    return {
      glowLevel: glow,
      branchCurrents: { 0: i, 1: -i },
    };
  },
};

export const RelayDefinition: ComponentDefinition = {
  type: "relay",
  name: "Relé Electromecánico",
  category: "actuadores",
  prefix: "RY",
  defaultProperties: { value: "80m;rcoil=120;pull=30m;hold=16m;ron=50m;roff=100Meg;ton=2.5;toff=1.2" },
  halfExtents: { halfW: 45, halfH: 25 },
  hasStandardLeads: false,
  getPins: () => [
    { index: 0, x: -40, y: -20, label: "COIL1" },
    { index: 1, x: -40, y: 20, label: "COIL2" },
    { index: 2, x: 40, y: -20, label: "COM" },
    { index: 3, x: 40, y: 20, label: "NO" },
  ],
  render: (ctx, comp) => {
    drawRelay(ctx, comp);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const v0 = pinVoltages[0] ?? 0;
    const v1 = pinVoltages[1] ?? 0;
    const coilCurrent = Math.abs(v0 - v1) / 120;
    const isClosed = coilCurrent >= 0.03;
    comp.relayClosed = isClosed;
    return {
      relayClosed: isClosed,
      branchCurrents: { 0: (v0 - v1) / 120, 1: (v1 - v0) / 120 },
    };
  },
};

export const BuzzerDefinition: ComponentDefinition = {
  type: "buzzer",
  name: "Zumbador Piezoeléctrico (Buzzer)",
  category: "actuadores",
  prefix: "BZ",
  defaultProperties: { value: "90;ron=65;roff=252;vnom=5;vstart=1.1;tone=2400;q=1.8;ton=7;toff=18" },
  halfExtents: { halfW: 40, halfH: 40 },
  getPins: () => STANDARD_TWO_PINS,
  render: (ctx, comp) => {
    drawBuzzer(ctx, comp);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const v0 = pinVoltages[0] ?? 0;
    const v1 = pinVoltages[1] ?? 0;
    const vDrop = Math.abs(v0 - v1);
    const buzzerLevel = Math.max(0, Math.min(1, (vDrop - 1.1) / 3.9));
    comp.buzzerLevel = buzzerLevel;
    const rBuzzer = 200;
    const i = (v0 - v1) / rBuzzer;
    return {
      buzzerLevel,
      branchCurrents: { 0: i, 1: -i },
    };
  },
};

export const SwitchDefinition: ComponentDefinition = {
  type: "switch",
  name: "Interruptor SPST",
  category: "actuadores",
  prefix: "SW",
  defaultProperties: { value: 0, switchState: false },
  halfExtents: { halfW: 45, halfH: 15 },
  getPins: () => STANDARD_TWO_PINS,
  render: (ctx, comp) => {
    drawSwitch(ctx, comp);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const isClosed = comp.switchState ?? false;
    if (!isClosed) return { branchCurrents: { 0: 0, 1: 0 } };
    const v0 = pinVoltages[0] ?? 0;
    const v1 = pinVoltages[1] ?? 0;
    const i = (v0 - v1) / 0.05;
    return {
      branchCurrents: { 0: i, 1: -i },
    };
  },
};
