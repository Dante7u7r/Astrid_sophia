// ==========================================================================
// POWER ELECTRONICS & TRIGGER DEVICES DESCRIPTORS
// Tiristor SCR, Triac, Diac, Regulador Shunt TL431
// ==========================================================================

import {
  drawDiac,
  drawScr,
  drawTl431,
  drawTriac,
} from "../../canvas/component_discrete_extended_renderer";
import type { ComponentDefinition, LocalPinDefinition } from "../types";

// ─── 1. TIRISTOR SCR (2N5064 / BT151) ───────────────────────────────────────

const SCR_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: 0, y: -40, label: "A", name: "Ánodo (+)" },
  { index: 1, x: 0, y: 40, label: "K", name: "Cátodo (-)" },
  { index: 2, x: -40, y: 20, label: "G", name: "Puerta / Gate (Disparo)" },
];

export const ScrDefinition: ComponentDefinition = {
  type: "scr",
  name: "Tiristor SCR (Silicon Controlled Rectifier)",
  category: "semiconductores",
  prefix: "SCR",
  defaultProperties: { value: 0, holdingCurrent: 0.005, gateTriggerVoltage: 0.7 },
  halfExtents: { halfW: 45, halfH: 45 },
  hasStandardLeads: false,
  getPins: () => SCR_PINS,
  render: (ctx, comp, state, options) => {
    const isConducting = Boolean(comp.powerState?.isLatched);
    drawScr(ctx, comp, state.color, isConducting || options.voltageMap !== undefined && isConducting);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const vA = pinVoltages[0] ?? 0;
    const vK = pinVoltages[1] ?? 0;
    const vG = pinVoltages[2] ?? 0;

    const vAk = vA - vK;
    const vGk = vG - vK;

    const vGt = comp.gateTriggerVoltage ?? 0.7;
    const iH = comp.holdingCurrent ?? 0.005;

    if (!comp.powerState) {
      comp.powerState = { isLatched: false };
    }

    let isLatched = Boolean(comp.powerState.isLatched);

    // 1. Condición de disparo (Gate trigger)
    if (!isLatched) {
      if (vGk >= vGt && vAk > 0.6) {
        isLatched = true;
      }
    }

    // 2. Corriente de conducción y condición de desenclavamiento (Holding current & Zero crossing)
    let iAk = 0.0;
    const ron = 0.05; // 50 mOhms
    const vf = 1.0; // Caída de tensión directa

    if (isLatched) {
      if (vAk > vf) {
        iAk = (vAk - vf) / ron;
      } else {
        iAk = 0.0;
      }

      // Si la corriente cae por debajo de la corriente de mantenimiento o se invierte la tensión
      if (vAk <= 0 || iAk < iH) {
        isLatched = false;
        iAk = 0.0;
      }
    }

    comp.powerState.isLatched = isLatched;

    const iG = vGk > 0.6 ? Math.max(0, (vGk - 0.6) / 50.0) : 0.0;

    return {
      branchCurrents: { 0: iAk, 1: -(iAk + iG), 2: iG },
      dynamicState: { isLatched, vAk, iAk, iG },
    };
  },
};

// ─── 2. TRIAC (BT136 / BTA16) ───────────────────────────────────────────────

const TRIAC_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: 0, y: -40, label: "MT2", name: "Terminal Principal 2 (MT2)" },
  { index: 1, x: 0, y: 40, label: "MT1", name: "Terminal Principal 1 (MT1)" },
  { index: 2, x: -40, y: 20, label: "G", name: "Puerta / Gate" },
];

export const TriacDefinition: ComponentDefinition = {
  type: "triac",
  name: "Triac (Interruptor Bidireccional de CA)",
  category: "semiconductores",
  prefix: "TR",
  defaultProperties: { value: 0, holdingCurrent: 0.01, gateTriggerVoltage: 0.7 },
  halfExtents: { halfW: 45, halfH: 45 },
  hasStandardLeads: false,
  getPins: () => TRIAC_PINS,
  render: (ctx, comp, state, options) => {
    const isConducting = Boolean(comp.powerState?.isLatched);
    drawTriac(ctx, comp, state.color, isConducting || options.voltageMap !== undefined && isConducting);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const vMt2 = pinVoltages[0] ?? 0;
    const vMt1 = pinVoltages[1] ?? 0;
    const vG = pinVoltages[2] ?? 0;

    const vMt = vMt2 - vMt1;
    const vG_Mt1 = vG - vMt1;

    const vGt = comp.gateTriggerVoltage ?? 0.7;
    const iH = comp.holdingCurrent ?? 0.01;

    if (!comp.powerState) {
      comp.powerState = { isLatched: false };
    }

    let isLatched = Boolean(comp.powerState.isLatched);

    // 1. Disparo en cualquiera de los 4 cuadrantes (|Vgate| >= Vgt)
    if (!isLatched) {
      if (Math.abs(vG_Mt1) >= vGt && Math.abs(vMt) > 0.6) {
        isLatched = true;
      }
    }

    // 2. Conducción bidireccional
    let iMt = 0.0;
    const ron = 0.05;
    const vf = 1.0;

    if (isLatched) {
      const magV = Math.abs(vMt);
      if (magV > vf) {
        iMt = Math.sign(vMt) * ((magV - vf) / ron);
      }

      if (Math.abs(iMt) < iH) {
        isLatched = false;
        iMt = 0.0;
      }
    }

    comp.powerState.isLatched = isLatched;

    const iG = Math.abs(vG_Mt1) > 0.6 ? Math.sign(vG_Mt1) * ((Math.abs(vG_Mt1) - 0.6) / 50.0) : 0.0;

    return {
      branchCurrents: { 0: iMt, 1: -(iMt + iG), 2: iG },
      dynamicState: { isLatched, vMt, iMt },
    };
  },
};

// ─── 3. DIAC (DB3 / BR100) ──────────────────────────────────────────────────

const DIAC_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: 0, y: -40, label: "A1", name: "Ánodo 1 (A1)" },
  { index: 1, x: 0, y: 40, label: "A2", name: "Ánodo 2 (A2)" },
];

export const DiacDefinition: ComponentDefinition = {
  type: "diac",
  name: "Diac (Diodo de Disparo Bidireccional)",
  category: "semiconductores",
  prefix: "DIAC",
  defaultProperties: { value: 32, breakoverVoltage: 32 },
  halfExtents: { halfW: 25, halfH: 45 },
  hasStandardLeads: false,
  getPins: () => DIAC_PINS,
  render: (ctx, comp, state, options) => {
    const isConducting = Boolean(comp.powerState?.isLatched);
    drawDiac(ctx, comp, state.color, isConducting || options.voltageMap !== undefined && isConducting);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const v1 = pinVoltages[0] ?? 0;
    const v2 = pinVoltages[1] ?? 0;
    const vDiff = v1 - v2;

    const vBo = comp.breakoverVoltage ?? (Number(comp.value) || 32.0);
    const iH = comp.holdingCurrent ?? 0.001;

    if (!comp.powerState) {
      comp.powerState = { isLatched: false };
    }

    let isLatched = Boolean(comp.powerState.isLatched);

    // Disparo por ruptura por avalancha
    if (!isLatched && Math.abs(vDiff) >= vBo) {
      isLatched = true;
    }

    let i = 0.0;
    const vSnapback = vBo - 5.0; // Caída de tensión negativa (Snapback)
    const ron = 5.0; // Resistencia dinámica en conducción

    if (isLatched) {
      const magV = Math.abs(vDiff);
      if (magV > vSnapback) {
        i = Math.sign(vDiff) * ((magV - vSnapback) / ron);
      }

      if (Math.abs(i) < iH) {
        isLatched = false;
        i = 0.0;
      }
    }

    comp.powerState.isLatched = isLatched;

    return {
      branchCurrents: { 0: i, 1: -i },
      dynamicState: { isLatched, vDiff, i },
    };
  },
};

// ─── 4. REGULADOR SHUNT DE PRECISIÓN TL431 ──────────────────────────────────

const TL431_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: 0, y: -40, label: "K", name: "Cátodo (K)" },
  { index: 1, x: 0, y: 40, label: "A", name: "Ánodo (A)" },
  { index: 2, x: -40, y: 0, label: "REF", name: "Referencia de Tensión (2.495V)" },
];

export const Tl431Definition: ComponentDefinition = {
  type: "tl431",
  name: "Regulador Shunt de Precisión TL431",
  category: "semiconductores",
  prefix: "U",
  defaultProperties: { value: 2.495, refVoltage: 2.495 },
  halfExtents: { halfW: 45, halfH: 45 },
  hasStandardLeads: false,
  getPins: () => TL431_PINS,
  render: (ctx, comp, state, options) => {
    const isRegulating = Boolean(comp.powerState?.isLatched);
    drawTl431(ctx, comp, state.color, isRegulating || options.voltageMap !== undefined && isRegulating);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const vK = pinVoltages[0] ?? 0;
    const vA = pinVoltages[1] ?? 0;
    const vRef = pinVoltages[2] ?? 0;

    const vKa = vK - vA;
    const vRefA = vRef - vA;

    const vRefTarget = comp.refVoltage ?? (Number(comp.value) || 2.495);

    if (!comp.powerState) {
      comp.powerState = { isLatched: false };
    }

    let iK = 0.0;
    const isRegulating = vRefA >= vRefTarget - 0.005 && vKa >= 1.8;
    comp.powerState.isLatched = isRegulating;

    if (vKa >= 1.8) {
      const vDelta = vRefA - vRefTarget;
      if (vDelta >= 0) {
        // Transconductancia gm = 1.0 A/V
        iK = 0.001 + vDelta * 1.0;
      } else {
        // Corriente de reposo I_off ≈ 1 µA
        iK = 1e-6;
      }
    } else {
      iK = 1e-6;
    }

    // Corriente de entrada de referencia muy baja (Iref ≈ 2 µA)
    const iRef = 2e-6;

    return {
      branchCurrents: { 0: iK, 1: -(iK + iRef), 2: iRef },
      dynamicState: { isRegulating, vKa, vRefA, iK },
    };
  },
};
