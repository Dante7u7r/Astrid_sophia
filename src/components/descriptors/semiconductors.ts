// ==========================================================================
// SEMICONDUCTOR COMPONENT DESCRIPTORS — Diodos, LEDs, BJTs, MOSFETs, JFETs
// ==========================================================================

import { drawCompactComponent } from "../../canvas/component_compact_renderer";
import { drawLed } from "../../canvas/component_discrete_renderer";
import { drawDiodeBridge, drawIgbt, drawJfet, drawOptocoupler } from "../../canvas/component_discrete_extended_renderer";
import type { ComponentDefinition, LocalPinDefinition } from "../types";

const STANDARD_TWO_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: -40, y: 0, label: "A", name: "Ánodo (+)" },
  { index: 1, x: 40, y: 0, label: "K", name: "Cátodo (-)" },
];

const THREE_TERMINAL_PINS = (
  gateLabel: string,
  dLabel: string,
  sLabel: string,
  gateName?: string,
  dName?: string,
  sName?: string,
): readonly LocalPinDefinition[] => [
  { index: 0, x: -40, y: 0, label: gateLabel, name: gateName },
  { index: 1, x: 20, y: -40, label: dLabel, name: dName },
  { index: 2, x: 20, y: 40, label: sLabel, name: sName },
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

    const v0 = options.voltageMap?.[`${comp.id}:0`] ?? 0;
    const v1 = options.voltageMap?.[`${comp.id}:1`] ?? 0;
    const vDiff = v0 - v1;
    const isConduction = vDiff >= 0.55;
    const iBranch = Math.abs(
      options.branchCurrents?.[`${comp.id}:I`] ??
      options.branchCurrents?.[`${comp.id}:0`] ??
      options.branchCurrents?.[comp.id] ??
      0,
    );

    const isOverCurrent = iBranch > 1.5;
    const isReverseBreakdown = vDiff < -100;

    const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";

    ctx.save();
    if (isOverCurrent || isReverseBreakdown) {
      ctx.fillStyle = "rgba(239, 68, 68, 0.85)";
      ctx.strokeStyle = "#EF4444";
    } else if (isConduction) {
      ctx.fillStyle = isClassroom ? "rgba(5, 150, 105, 0.85)" : "rgba(16, 185, 129, 0.85)"; // Verde de conducción directa activa
      ctx.strokeStyle = isClassroom ? "#059669" : "#34D399";
    } else {
      ctx.fillStyle = isClassroom ? "rgba(226, 232, 240, 0.6)" : "rgba(15, 23, 42, 0.8)";
      ctx.strokeStyle = state.color;
    }

    ctx.beginPath();
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

    if (isOverCurrent || isReverseBreakdown) {
      ctx.fillStyle = "#EF4444";
      ctx.font = "bold 8px 'Inter', sans-serif";
      ctx.fillText(isReverseBreakdown ? "⚡ RUPTURA VRRM" : "🔥 SOBRECORRIENTE", -36, -14);
    }
    ctx.restore();
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
    const v0 = options.voltageMap?.[`${comp.id}:0`] ?? 0;
    const v1 = options.voltageMap?.[`${comp.id}:1`] ?? 0;
    const vDiff = v0 - v1;
    const iBranch = Math.abs(
      options.branchCurrents?.[`${comp.id}:I`] ??
      options.branchCurrents?.[`${comp.id}:0`] ??
      options.branchCurrents?.[comp.id] ??
      0,
    );

    const isOverCurrent = iBranch > 0.04 || (vDiff > 4.5 && comp.ledColor !== "uv");
    const isReverseOvervoltage = vDiff < -6.0;
    const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";

    drawLed(ctx, comp, state.color);

    if (isOverCurrent || isReverseOvervoltage) {
      ctx.save();
      ctx.fillStyle = "#EF4444";
      ctx.font = "bold 8px 'Inter', sans-serif";
      ctx.fillText(isReverseOvervoltage ? "💥 VRRM EXCEDIDO" : "🔥 SOBRECORRIENTE", -36, -14);
      ctx.restore();
    } else if (isClassroom && vDiff < -1.2) {
      ctx.save();
      ctx.fillStyle = "#B45309";
      ctx.font = "bold 8px 'Inter', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("🚫 POLARIDAD INVERSA", 0, -14);
      ctx.restore();
    }
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
  getPins: () => THREE_TERMINAL_PINS("G", "D", "S", "Puerta (G / Gate)", "Drenador (D / Drain)", "Fuente (S / Source)"),
  render: (ctx, comp, state, options) => {
    if (options.detail === "compact") {
      drawCompactComponent(ctx, comp, state.color);
      return;
    }

    const vG = options.voltageMap?.[`${comp.id}:0`] ?? 0;
    const vS = options.voltageMap?.[`${comp.id}:2`] ?? 0;
    const vGS = vG - vS;
    const vth = Number(comp.value) || 1.5;
    const isChannelFormed = vGS >= vth;

    ctx.save();
    // 1. Canal vertical central (se ilumina si se forma el canal de inversión)
    ctx.beginPath();
    ctx.moveTo(10, -20);
    ctx.lineTo(10, 20);
    if (isChannelFormed) {
      ctx.strokeStyle = "#38BDF8";
      ctx.lineWidth = 3.0;
    } else {
      ctx.strokeStyle = state.color;
      ctx.lineWidth = state.lineWidth;
    }
    ctx.stroke();

    // 2. Placa a la izquierda (Puerta / Gate)
    ctx.beginPath();
    ctx.moveTo(-10, -15);
    ctx.lineTo(-10, 15);
    ctx.strokeStyle = isChannelFormed ? "#38BDF8" : state.color;
    ctx.lineWidth = state.lineWidth;
    ctx.stroke();

    // 3. Terminales de Gate, Drain, Source
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(-40, 0);
    ctx.moveTo(10, -15);
    ctx.lineTo(20, -15);
    ctx.lineTo(20, -40);
    ctx.moveTo(10, 15);
    ctx.lineTo(20, 15);
    ctx.lineTo(20, 40);

    // Flecha característica apuntando al sustrato (canal N)
    ctx.moveTo(10, 15);
    ctx.lineTo(15, 11);
    ctx.moveTo(10, 15);
    ctx.lineTo(15, 19);
    ctx.strokeStyle = state.color;
    ctx.lineWidth = state.lineWidth;
    ctx.stroke();
    ctx.restore();
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const vG = pinVoltages[0] ?? 0;
    const vD = pinVoltages[1] ?? 0;
    const vS = pinVoltages[2] ?? 0;
    const vGS = vG - vS;
    const vDS = vD - vS;
    const vth = comp.mosVth ?? (Number(comp.value) || 1.5);
    const ron = comp.mosRon ?? 0.05;
    if (vGS > vth && vDS > 0) {
      const vov = vGS - vth;
      const iD = vDS < vov ? vDS / ron : (vov * vov) / (2 * ron);
      return { branchCurrents: { 0: 0, 1: iD, 2: -iD } };
    }
    return { branchCurrents: { 0: 0, 1: 0, 2: 0 } };
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
  getPins: () => THREE_TERMINAL_PINS("G", "D", "S", "Puerta (G / Gate)", "Drenador (D / Drain)", "Fuente (S / Source)"),
  render: (ctx, comp, state, options) => {
    if (options.detail === "compact") {
      drawCompactComponent(ctx, comp, state.color);
      return;
    }

    const vG = options.voltageMap?.[`${comp.id}:0`] ?? 0;
    const vS = options.voltageMap?.[`${comp.id}:2`] ?? 0;
    const vSG = vS - vG;
    const isChannelFormed = vSG >= 1.5;

    ctx.save();
    // 1. Canal vertical
    ctx.beginPath();
    ctx.moveTo(10, -20);
    ctx.lineTo(10, 20);
    if (isChannelFormed) {
      ctx.strokeStyle = "#A855F7";
      ctx.lineWidth = 3.0;
    } else {
      ctx.strokeStyle = state.color;
      ctx.lineWidth = state.lineWidth;
    }
    ctx.stroke();

    // 2. Burbuja de inversión en puerta
    ctx.beginPath();
    ctx.arc(-11, 0, 4, 0, Math.PI * 2);
    ctx.strokeStyle = state.color;
    ctx.lineWidth = state.lineWidth;
    ctx.stroke();

    // 3. Placa a la izquierda (Puerta / Gate)
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
    ctx.restore();
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const vG = pinVoltages[0] ?? 0;
    const vD = pinVoltages[1] ?? 0;
    const vS = pinVoltages[2] ?? 0;
    const vSG = vS - vG;
    const vSD = vS - vD;
    const vth = Math.abs(comp.mosVth ?? (Number(comp.value) || -1.5));
    const ron = comp.mosRon ?? 0.05;
    if (vSG > vth && vSD > 0) {
      const vov = vSG - vth;
      const iD = vSD < vov ? vSD / ron : (vov * vov) / (2 * ron);
      return { branchCurrents: { 0: 0, 1: -iD, 2: iD } };
    }
    return { branchCurrents: { 0: 0, 1: 0, 2: 0 } };
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
  getPins: () => THREE_TERMINAL_PINS("B", "C", "E", "Base (B)", "Colector (C)", "Emisor (E)"),
  render: (ctx, comp, state, options) => {
    if (options.detail === "compact") {
      drawCompactComponent(ctx, comp, state.color);
      return;
    }

    const vB = options.voltageMap?.[`${comp.id}:0`] ?? 0;
    const vC = options.voltageMap?.[`${comp.id}:1`] ?? 0;
    const vE = options.voltageMap?.[`${comp.id}:2`] ?? 0;
    const vBE = vB - vE;
    const vCE = vC - vE;

    // Región de operación: Activa (verde), Saturación (cyan), Corte (normal)
    const isConducting = vBE >= 0.55;
    const isSaturated = isConducting && vCE <= 0.25;

    ctx.save();
    // 1. Barra vertical de la Base
    ctx.beginPath();
    ctx.moveTo(-10, -20);
    ctx.lineTo(-10, 20);
    if (isSaturated) {
      ctx.strokeStyle = "#38BDF8"; // Saturación
      ctx.lineWidth = 2.8;
    } else if (isConducting) {
      ctx.strokeStyle = "#10B981"; // Zona activa lineal
      ctx.lineWidth = 2.4;
    } else {
      ctx.strokeStyle = state.color;
      ctx.lineWidth = state.lineWidth;
    }
    ctx.stroke();

    // 2. Terminal de la Base
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(-40, 0);

    // 3. Colector y Emisor
    ctx.moveTo(-10, -10);
    ctx.lineTo(20, -25);
    ctx.lineTo(20, -40);

    ctx.moveTo(-10, 10);
    ctx.lineTo(20, 25);
    ctx.lineTo(20, 40);

    // Flecha en el emisor apuntando hacia AFUERA
    ctx.moveTo(20, 25);
    ctx.lineTo(12, 23);
    ctx.moveTo(20, 25);
    ctx.lineTo(15, 17);
    ctx.strokeStyle = isConducting ? (isSaturated ? "#38BDF8" : "#10B981") : state.color;
    ctx.lineWidth = state.lineWidth;
    ctx.stroke();
    ctx.restore();
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const vB = pinVoltages[0] ?? 0;
    const vC = pinVoltages[1] ?? 0;
    const vE = pinVoltages[2] ?? 0;
    const vBE = vB - vE;
    const vCE = vC - vE;
    if (vBE > 0.55 && vCE > 0) {
      const bf = comp.bjtBf ?? (Number(comp.value) || 100);
      const iB = Math.max(0, (vBE - 0.65) / 500);
      const iC = Math.min(iB * bf, Math.max(0, vCE / 2.0));
      const iE = iB + iC;
      return { branchCurrents: { 0: iB, 1: iC, 2: -iE } };
    }
    return { branchCurrents: { 0: 0, 1: 0, 2: 0 } };
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
  getPins: () => THREE_TERMINAL_PINS("B", "C", "E", "Base (B)", "Colector (C)", "Emisor (E)"),
  render: (ctx, comp, state, options) => {
    if (options.detail === "compact") {
      drawCompactComponent(ctx, comp, state.color);
      return;
    }

    const vB = options.voltageMap?.[`${comp.id}:0`] ?? 0;
    const vC = options.voltageMap?.[`${comp.id}:1`] ?? 0;
    const vE = options.voltageMap?.[`${comp.id}:2`] ?? 0;
    const vEB = vE - vB;
    const vEC = vE - vC;
    const isConducting = vEB >= 0.55;
    const isSaturated = isConducting && vEC <= 0.25;

    ctx.save();
    // 1. Barra vertical de la Base
    ctx.beginPath();
    ctx.moveTo(-10, -20);
    ctx.lineTo(-10, 20);
    if (isSaturated) {
      ctx.strokeStyle = "#38BDF8";
      ctx.lineWidth = 2.8;
    } else if (isConducting) {
      ctx.strokeStyle = "#10B981";
      ctx.lineWidth = 2.4;
    } else {
      ctx.strokeStyle = state.color;
      ctx.lineWidth = state.lineWidth;
    }
    ctx.stroke();

    // 2. Terminal de Base
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(-40, 0);

    // 3. Colector y Emisor
    ctx.moveTo(-10, -10);
    ctx.lineTo(20, -25);
    ctx.lineTo(20, -40);

    ctx.moveTo(-10, 10);
    ctx.lineTo(20, 25);
    ctx.lineTo(20, 40);

    // Flecha en el emisor apuntando hacia ADENTRO
    ctx.moveTo(-10, 10);
    ctx.lineTo(-2, 12);
    ctx.moveTo(-10, 10);
    ctx.lineTo(-5, 18);
    ctx.strokeStyle = isConducting ? (isSaturated ? "#38BDF8" : "#10B981") : state.color;
    ctx.lineWidth = state.lineWidth;
    ctx.stroke();
    ctx.restore();
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const vB = pinVoltages[0] ?? 0;
    const vC = pinVoltages[1] ?? 0;
    const vE = pinVoltages[2] ?? 0;
    const vEB = vE - vB;
    const vEC = vE - vC;
    if (vEB > 0.55 && vEC > 0) {
      const bf = comp.bjtBf ?? (Number(comp.value) || 100);
      const iB = Math.max(0, (vEB - 0.65) / 500);
      const iC = Math.min(iB * bf, Math.max(0, vEC / 2.0));
      const iE = iB + iC;
      return { branchCurrents: { 0: -iB, 1: -iC, 2: iE } };
    }
    return { branchCurrents: { 0: 0, 1: 0, 2: 0 } };
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
  getPins: () => THREE_TERMINAL_PINS("G", "D", "S", "Puerta (G / Gate)", "Drenador (D / Drain)", "Fuente (S / Source)"),
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
  getPins: () => THREE_TERMINAL_PINS("G", "D", "S", "Puerta (G / Gate)", "Drenador (D / Drain)", "Fuente (S / Source)"),
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
    { index: 0, x: -40, y: -20, label: "A", name: "Ánodo LED (+)" },
    { index: 1, x: -40, y: 20, label: "K", name: "Cátodo LED (-)" },
    { index: 2, x: 40, y: -20, label: "C", name: "Colector (C)" },
    { index: 3, x: 40, y: 20, label: "E", name: "Emisor (E)" },
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

export const ZenerDiodeDefinition: ComponentDefinition = {
  type: "zener_diode",
  name: "Diodo Zener",
  category: "semiconductores",
  prefix: "DZ",
  defaultProperties: { value: 5.1 },
  halfExtents: { halfW: 45, halfH: 45 },
  getPins: () => STANDARD_TWO_PINS,
  render: (ctx, comp, state, options) => {
    if (options.detail === "compact") {
      drawCompactComponent(ctx, comp, state.color);
      return;
    }

    const v0 = options.voltageMap?.[`${comp.id}:0`] ?? 0;
    const v1 = options.voltageMap?.[`${comp.id}:1`] ?? 0;
    const vDiff = v0 - v1;
    const vz = Math.max(Number(comp.value) || 5.1, 0.1);
    const isForward = vDiff >= 0.55;
    const isZenerBreakdown = (v1 - v0) >= vz * 0.95;

    const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";

    ctx.save();
    if (isForward) {
      ctx.fillStyle = isClassroom ? "rgba(5, 150, 105, 0.85)" : "rgba(16, 185, 129, 0.85)"; // Verde de conducción directa
      ctx.strokeStyle = isClassroom ? "#059669" : "#34D399";
    } else if (isZenerBreakdown) {
      ctx.fillStyle = isClassroom ? "rgba(124, 58, 237, 0.85)" : "rgba(168, 85, 247, 0.85)"; // Violeta de regulación Zener
      ctx.strokeStyle = isClassroom ? "#7C3AED" : "#C084FC";
    } else {
      ctx.fillStyle = isClassroom ? "rgba(226, 232, 240, 0.6)" : "rgba(15, 23, 42, 0.8)";
      ctx.strokeStyle = state.color;
    }

    // Triángulo
    ctx.beginPath();
    ctx.moveTo(-12, -10);
    ctx.lineTo(-12, 10);
    ctx.lineTo(8, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Barra de cátodo en Z de Zener
    ctx.beginPath();
    ctx.moveTo(4, -13);
    ctx.lineTo(8, -10);
    ctx.lineTo(8, 10);
    ctx.lineTo(12, 13);
    ctx.stroke();
    ctx.restore();
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const v0 = pinVoltages[0] ?? 0;
    const v1 = pinVoltages[1] ?? 0;
    const vDiff = v0 - v1;
    const vz = Math.max(Number(comp.value) || 5.1, 0.1);
    let i = 0;
    if (vDiff > 0.5) {
      i = Math.max(0, (vDiff - 0.6) / 10);
    } else if (vDiff < -vz) {
      i = -(Math.abs(vDiff) - vz) / 5;
    }
    return { branchCurrents: { 0: i, 1: -i } };
  },
};

export const SchottkyDiodeDefinition: ComponentDefinition = {
  type: "schottky_diode",
  name: "Diodo Schottky",
  category: "semiconductores",
  prefix: "DS",
  defaultProperties: { value: 0.3 },
  halfExtents: { halfW: 45, halfH: 45 },
  getPins: () => STANDARD_TWO_PINS,
  render: (ctx, comp, state, options) => {
    if (options.detail === "compact") {
      drawCompactComponent(ctx, comp, state.color);
      return;
    }

    const v0 = options.voltageMap?.[`${comp.id}:0`] ?? 0;
    const v1 = options.voltageMap?.[`${comp.id}:1`] ?? 0;
    const vDiff = v0 - v1;
    const isForward = vDiff >= 0.25; // Conducción rápida de baja caída
    const isClassroom = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "classroom";

    ctx.save();
    if (isForward) {
      ctx.fillStyle = isClassroom ? "rgba(2, 132, 199, 0.85)" : "rgba(14, 165, 233, 0.85)"; // Azul cyan de conmutación rápida
      ctx.strokeStyle = isClassroom ? "#0284C7" : "#38BDF8";
    } else {
      ctx.fillStyle = isClassroom ? "rgba(226, 232, 240, 0.6)" : "rgba(15, 23, 42, 0.8)";
      ctx.strokeStyle = state.color;
    }

    // Triángulo
    ctx.beginPath();
    ctx.moveTo(-12, -10);
    ctx.lineTo(-12, 10);
    ctx.lineTo(8, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Barra de cátodo en S de Schottky
    ctx.beginPath();
    ctx.moveTo(4, -10);
    ctx.lineTo(8, -10);
    ctx.lineTo(8, 10);
    ctx.lineTo(12, 10);
    ctx.stroke();
    ctx.restore();
  },
  evaluateLiveBehavior: (pinVoltages) => {
    const v0 = pinVoltages[0] ?? 0;
    const v1 = pinVoltages[1] ?? 0;
    const vDiff = v0 - v1;
    const i = vDiff > 0.2 ? Math.max(0, (vDiff - 0.25) / 5) : 0;
    return { branchCurrents: { 0: i, 1: -i } };
  },
};

export const IgbtDefinition: ComponentDefinition = {
  type: "igbt",
  name: "Transistor IGBT (Hefner)",
  description: "Transistor bipolar de puerta aislada con modelo físico de Hefner (conducción MOS + PNP con cola de corriente).",
  category: "semiconductores",
  prefix: "Q",
  defaultProperties: { value: 5.0, igbtKp: 15.0, igbtAlpha: 0.55, igbtTau: 1.8e-6, igbtWb: 90e-6 },
  halfExtents: { halfW: 45, halfH: 45 },
  hasStandardLeads: false,
  getPins: () => THREE_TERMINAL_PINS("G", "C", "E", "Puerta (G / Gate)", "Colector (C / Collector)", "Emisor (E / Emitter)"),
  render: (ctx, comp, state, options) => {
    if (options.detail === "compact") {
      drawCompactComponent(ctx, comp, state.color);
      return;
    }
    drawIgbt(ctx, comp, state.color, options.voltageMap);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const vG = pinVoltages[0] ?? 0;
    const vC = pinVoltages[1] ?? 0;
    const vE = pinVoltages[2] ?? 0;
    const vGE = vG - vE;
    const vCE = vC - vE;
    const vth = Number(comp.value) || 5.0;
    if (vGE > vth && vCE > 0.6) {
      const vov = vGE - vth;
      const iC = Math.max(0, (vov * vov * 2.0) * (1.0 + 0.002 * vCE));
      return { branchCurrents: { 0: 0, 1: iC, 2: -iC } };
    }
    return { branchCurrents: { 0: 0, 1: 0, 2: 0 } };
  },
};

export const DiodeBridgeDefinition: ComponentDefinition = {
  type: "diode_bridge",
  name: "Puente Rectificador de Diodos",
  description: "Puente rectificador de onda completa integrado (Graetz) de 4 terminales (AC1, AC2, DC+, DC-).",
  category: "semiconductores",
  prefix: "BR",
  defaultProperties: { value: "DB107", modelName: "DB107", forwardVoltage: 1.0 },
  halfExtents: { halfW: 40, halfH: 30 },
  hasStandardLeads: false,
  getPins: () => [
    { index: 0, x: -40, y: -20, label: "~", name: "Entrada CA 1 (AC1 / ~)" },
    { index: 1, x: -40, y: 20, label: "~", name: "Entrada CA 2 (AC2 / ~)" },
    { index: 2, x: 40, y: -20, label: "+", name: "Salida Continua Positiva (DC+ / +)" },
    { index: 3, x: 40, y: 20, label: "-", name: "Salida Continua Negativa (DC- / -)" },
  ],
  render: (ctx, comp, state, options) => {
    if (options?.detail === "compact") {
      drawCompactComponent(ctx, comp, state.color);
      return;
    }
    drawDiodeBridge(ctx, comp, state.color);
  },
};
