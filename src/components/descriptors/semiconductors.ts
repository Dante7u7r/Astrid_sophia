// ==========================================================================
// SEMICONDUCTOR COMPONENT DESCRIPTORS — Diodos, LEDs, BJTs, MOSFETs, JFETs
// ==========================================================================

import { drawCompactComponent } from "../../canvas/component_compact_renderer";
import { drawLed } from "../../canvas/component_discrete_renderer";
import { drawJfet, drawOptocoupler } from "../../canvas/component_discrete_extended_renderer";
import type { ComponentDefinition, LocalPinDefinition } from "../types";

const STANDARD_TWO_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: -40, y: 0, label: "A", name: "Ánodo" },
  { index: 1, x: 40, y: 0, label: "K", name: "Cátodo" },
];

const THREE_TERMINAL_PINS = (gateLabel: string, dLabel: string, sLabel: string): readonly LocalPinDefinition[] => [
  { index: 0, x: -40, y: 0, label: gateLabel },
  { index: 1, x: 20, y: -40, label: dLabel },
  { index: 2, x: 20, y: 40, label: sLabel },
];

export const DiodeDefinition: ComponentDefinition = {
  type: "diode",
  name: "Diodo Rectificador",
  category: "semiconductores",
  prefix: "D",
  defaultProperties: { value: 0 },
  halfExtents: { halfW: 45, halfH: 45 },
  getPins: () => STANDARD_TWO_PINS,
  render: (ctx, comp, state, options) => {
    if (options.detail === "compact") {
      drawCompactComponent(ctx, comp, state.color);
      return;
    }
    ctx.moveTo(-12, -10);
    ctx.lineTo(-12, 10);
    ctx.lineTo(8, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(8, -10);
    ctx.lineTo(8, 10);
    ctx.stroke();
  },
  evaluateLiveBehavior: (pinVoltages) => {
    const v0 = pinVoltages[0] ?? 0;
    const v1 = pinVoltages[1] ?? 0;
    const vDiff = v0 - v1;
    const i = vDiff > 0.5 ? Math.max(0, (vDiff - 0.6) / 10) : 0;
    return { branchCurrents: { 0: i, 1: -i } };
  },
};

export const LedDefinition: ComponentDefinition = {
  type: "led",
  name: "Diodo Emisor de Luz (LED)",
  category: "semiconductores",
  prefix: "LED",
  defaultProperties: { value: 0 },
  halfExtents: { halfW: 40, halfH: 40 },
  getPins: () => STANDARD_TWO_PINS,
  render: (ctx, comp, state, options) => {
    if (options.detail === "compact") {
      drawCompactComponent(ctx, comp, state.color);
      return;
    }
    drawLed(ctx, comp, state.color);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const v0 = pinVoltages[0] ?? 0;
    const v1 = pinVoltages[1] ?? 0;
    const vDiff = v0 - v1;

    let vThresh = 1.5;
    const colorKey = comp.ledColor?.toLowerCase() || "red";
    if (colorKey === "green" || colorKey === "yellow" || colorKey === "orange") {
      vThresh = 1.8;
    } else if (colorKey === "blue" || colorKey === "white") {
      vThresh = 2.6;
    } else if (colorKey === "uv") {
      vThresh = 2.9;
    } else if (colorKey === "ir") {
      vThresh = 1.1;
    }

    const isForward = vDiff > 0.4;
    const glow = isForward
      ? Math.max(0.15, Math.min(1.0, (vDiff - 0.4) / Math.max(0.2, vThresh - 0.4)))
      : 0;
    comp.glowLevel = glow;
    const i = isForward ? Math.max(0, (vDiff - 0.6) / 20) : 0;
    return {
      glowLevel: glow,
      branchCurrents: { 0: i, 1: -i },
    };
  },
};

export const NmosDefinition: ComponentDefinition = {
  type: "nmos",
  name: "MOSFET Canal N",
  category: "semiconductores",
  prefix: "M",
  defaultProperties: { value: 1.5 },
  halfExtents: { halfW: 45, halfH: 45 },
  hasStandardLeads: false,
  getPins: () => THREE_TERMINAL_PINS("G", "D", "S"),
  render: (ctx, comp, state, options) => {
    if (options.detail === "compact") {
      drawCompactComponent(ctx, comp, state.color);
      return;
    }
    // Canal vertical central
    ctx.moveTo(10, -20);
    ctx.lineTo(10, 20);

    // Placa a la izquierda (Puerta / Gate)
    ctx.moveTo(-10, -15);
    ctx.lineTo(-10, 15);

    // Terminal de la Puerta (Gate)
    ctx.moveTo(-10, 0);
    ctx.lineTo(-40, 0);

    // Terminal del Drenaje (Drain)
    ctx.moveTo(10, -15);
    ctx.lineTo(20, -15);
    ctx.lineTo(20, -40);

    // Terminal de la Fuente (Source)
    ctx.moveTo(10, 15);
    ctx.lineTo(20, 15);
    ctx.lineTo(20, 40);

    // Flecha característica apuntando al sustrato (canal N)
    ctx.moveTo(10, 15);
    ctx.lineTo(15, 11);
    ctx.moveTo(10, 15);
    ctx.lineTo(15, 19);
    ctx.stroke();
  },
};

export const PmosDefinition: ComponentDefinition = {
  type: "pmos",
  name: "MOSFET Canal P",
  category: "semiconductores",
  prefix: "M",
  defaultProperties: { value: -1.5 },
  halfExtents: { halfW: 45, halfH: 45 },
  hasStandardLeads: false,
  getPins: () => THREE_TERMINAL_PINS("G", "D", "S"),
  render: (ctx, comp, state, options) => {
    if (options.detail === "compact") {
      drawCompactComponent(ctx, comp, state.color);
      return;
    }
    // Canal vertical central
    ctx.moveTo(10, -20);
    ctx.lineTo(10, 20);

    // Burbuja de inversión en puerta
    ctx.moveTo(-6, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-11, 0, 4, 0, Math.PI * 2);
    ctx.stroke();

    // Placa a la izquierda (Puerta / Gate)
    ctx.beginPath();
    ctx.moveTo(-6, -15);
    ctx.lineTo(-6, 15);

    // Terminal de la Puerta (Gate)
    ctx.moveTo(-15, 0);
    ctx.lineTo(-40, 0);

    // Terminal del Drenaje (Drain)
    ctx.moveTo(10, -15);
    ctx.lineTo(20, -15);
    ctx.lineTo(20, -40);

    // Terminal de la Fuente (Source)
    ctx.moveTo(10, 15);
    ctx.lineTo(20, 15);
    ctx.lineTo(20, 40);

    // Flecha característica apuntando hacia afuera
    ctx.moveTo(10, 15);
    ctx.lineTo(5, 11);
    ctx.moveTo(10, 15);
    ctx.lineTo(5, 19);
    ctx.stroke();
  },
};

export const NpnDefinition: ComponentDefinition = {
  type: "npn",
  name: "Transistor BJT NPN",
  category: "semiconductores",
  prefix: "Q",
  defaultProperties: { value: 100 },
  halfExtents: { halfW: 45, halfH: 45 },
  hasStandardLeads: false,
  getPins: () => THREE_TERMINAL_PINS("B", "C", "E"),
  render: (ctx, comp, state, options) => {
    if (options.detail === "compact") {
      drawCompactComponent(ctx, comp, state.color);
      return;
    }
    // Barra vertical de la Base
    ctx.moveTo(-10, -20);
    ctx.lineTo(-10, 20);

    // Terminal de la Base (Base)
    ctx.moveTo(-10, 0);
    ctx.lineTo(-40, 0);

    // Colector (Collector)
    ctx.moveTo(-10, -10);
    ctx.lineTo(20, -25);
    ctx.lineTo(20, -40);

    // Emisor (Emitter)
    ctx.moveTo(-10, 10);
    ctx.lineTo(20, 25);
    ctx.lineTo(20, 40);

    // Flecha en el emisor apuntando hacia AFUERA
    ctx.moveTo(20, 25);
    ctx.lineTo(12, 23);
    ctx.moveTo(20, 25);
    ctx.lineTo(15, 17);
    ctx.stroke();
  },
};

export const PnpDefinition: ComponentDefinition = {
  type: "pnp",
  name: "Transistor BJT PNP",
  category: "semiconductores",
  prefix: "Q",
  defaultProperties: { value: 100 },
  halfExtents: { halfW: 45, halfH: 45 },
  hasStandardLeads: false,
  getPins: () => THREE_TERMINAL_PINS("B", "C", "E"),
  render: (ctx, comp, state, options) => {
    if (options.detail === "compact") {
      drawCompactComponent(ctx, comp, state.color);
      return;
    }
    // Barra vertical de la Base
    ctx.moveTo(-10, -20);
    ctx.lineTo(-10, 20);

    // Terminal de la Base (Base)
    ctx.moveTo(-10, 0);
    ctx.lineTo(-40, 0);

    // Colector (Collector)
    ctx.moveTo(-10, -10);
    ctx.lineTo(20, -25);
    ctx.lineTo(20, -40);

    // Emisor (Emitter)
    ctx.moveTo(-10, 10);
    ctx.lineTo(20, 25);
    ctx.lineTo(20, 40);

    // Flecha en el emisor apuntando hacia ADENTRO
    ctx.moveTo(-10, 10);
    ctx.lineTo(-2, 12);
    ctx.moveTo(-10, 10);
    ctx.lineTo(-5, 18);
    ctx.stroke();
  },
};

export const NjfDefinition: ComponentDefinition = {
  type: "njf",
  name: "JFET Canal N",
  category: "semiconductores",
  prefix: "J",
  defaultProperties: { value: -2 },
  halfExtents: { halfW: 45, halfH: 45 },
  hasStandardLeads: false,
  getPins: () => THREE_TERMINAL_PINS("G", "D", "S"),
  render: (ctx, comp, state) => {
    drawJfet(ctx, comp, false, state.color);
  },
};

export const PjfDefinition: ComponentDefinition = {
  type: "pjf",
  name: "JFET Canal P",
  category: "semiconductores",
  prefix: "J",
  defaultProperties: { value: 2 },
  halfExtents: { halfW: 45, halfH: 45 },
  hasStandardLeads: false,
  getPins: () => THREE_TERMINAL_PINS("G", "D", "S"),
  render: (ctx, comp, state) => {
    drawJfet(ctx, comp, true, state.color);
  },
};

export const OptoDefinition: ComponentDefinition = {
  type: "opto",
  name: "Optoacoplador",
  category: "semiconductores",
  prefix: "OK",
  defaultProperties: { value: 1 },
  halfExtents: { halfW: 45, halfH: 35 },
  hasStandardLeads: false,
  getPins: () => [
    { index: 0, x: -40, y: -20, label: "A" },
    { index: 1, x: -40, y: 20, label: "K" },
    { index: 2, x: 40, y: -20, label: "C" },
    { index: 3, x: 40, y: 20, label: "E" },
  ],
  render: (ctx, comp, state) => {
    drawOptocoupler(ctx, comp, state.color);
  },
};

const FOUR_TERMINAL_MOS_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: -40, y: 0, label: "G", name: "Puerta (Gate)" },
  { index: 1, x: 20, y: -40, label: "D", name: "Drenaje (Drain)" },
  { index: 2, x: 20, y: 40, label: "S", name: "Fuente (Source)" },
  { index: 3, x: 20, y: 0, label: "B", name: "Sustrato (Bulk)" },
];

export const Bsim3NmosDefinition: ComponentDefinition = {
  type: "bsim3nmos",
  name: "BSIM3v3 NMOS (Experimental)",
  description: "Modelo submicrónico BSIM3v3. Modelo experimental: requiere habilitar flag de físicas experimentales.",
  category: "semiconductores",
  prefix: "M",
  defaultProperties: { value: 1.0, w: 10e-6, l: 0.18e-6 },
  halfExtents: { halfW: 45, halfH: 45 },
  hasStandardLeads: false,
  getPins: () => FOUR_TERMINAL_MOS_PINS,
  render: (ctx, comp, state, options) => {
    NmosDefinition.render(ctx, comp, state, options);
    // Terminal Bulk adicional
    ctx.moveTo(10, 0);
    ctx.lineTo(20, 0);
    ctx.stroke();
  },
};

export const Bsim3PmosDefinition: ComponentDefinition = {
  type: "bsim3pmos",
  name: "BSIM3v3 PMOS (Experimental)",
  description: "Modelo submicrónico BSIM3v3 PMOS. Modelo experimental: requiere habilitar flag de físicas experimentales.",
  category: "semiconductores",
  prefix: "M",
  defaultProperties: { value: -1.0, w: 20e-6, l: 0.18e-6 },
  halfExtents: { halfW: 45, halfH: 45 },
  hasStandardLeads: false,
  getPins: () => FOUR_TERMINAL_MOS_PINS,
  render: (ctx, comp, state, options) => {
    PmosDefinition.render(ctx, comp, state, options);
    ctx.moveTo(10, 0);
    ctx.lineTo(20, 0);
    ctx.stroke();
  },
};

export const Bsim4NmosDefinition: ComponentDefinition = {
  type: "bsim4nmos",
  name: "BSIM4 NMOS (Experimental)",
  description: "Modelo nanométrico BSIM4 NMOS. Modelo experimental: requiere habilitar flag de físicas experimentales.",
  category: "semiconductores",
  prefix: "M",
  defaultProperties: { value: 1.0, w: 10e-6, l: 0.09e-6 },
  halfExtents: { halfW: 45, halfH: 45 },
  hasStandardLeads: false,
  getPins: () => FOUR_TERMINAL_MOS_PINS,
  render: (ctx, comp, state, options) => {
    NmosDefinition.render(ctx, comp, state, options);
    ctx.moveTo(10, 0);
    ctx.lineTo(20, 0);
    ctx.stroke();
  },
};

export const Bsim4PmosDefinition: ComponentDefinition = {
  type: "bsim4pmos",
  name: "BSIM4 PMOS (Experimental)",
  description: "Modelo nanométrico BSIM4 PMOS. Modelo experimental: requiere habilitar flag de físicas experimentales.",
  category: "semiconductores",
  prefix: "M",
  defaultProperties: { value: -1.0, w: 20e-6, l: 0.09e-6 },
  halfExtents: { halfW: 45, halfH: 45 },
  hasStandardLeads: false,
  getPins: () => FOUR_TERMINAL_MOS_PINS,
  render: (ctx, comp, state, options) => {
    PmosDefinition.render(ctx, comp, state, options);
    ctx.moveTo(10, 0);
    ctx.lineTo(20, 0);
    ctx.stroke();
  },
};
