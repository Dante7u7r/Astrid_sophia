// ==========================================================================
// DIGITAL IC DESCRIPTORS — CD4017, 74HC90, 74HC193, 74HC138, 74HC151
// ==========================================================================

import {
  drawBcdCounter90,
  drawDecoder138,
  drawJohnsonCounter4017,
  drawMultiplexer151,
  drawUpDownCounter193,
} from "../../canvas/component_logic_renderer";
import type { ComponentDefinition, LocalPinDefinition } from "../types";

function getLogicLevel(voltage?: number, vth: number = 2.5): "1" | "0" | "X" | undefined {
  if (voltage === undefined) return undefined;
  if (voltage >= vth * 0.8) return "1";
  if (voltage <= vth * 0.35) return "0";
  return "X";
}

// ─── 1. CD4017 — CONTADOR DECÁDICO JOHNSON (10 SALIDAS) ────────────────────

const CD4017_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: -40, y: -20, label: "CLK", name: "Reloj (Flanco de Subida)" },
  { index: 1, x: -40, y: 0, label: "INH", name: "Inhibición de Reloj (Activo Alto)" },
  { index: 2, x: -40, y: 20, label: "RST", name: "Reset Asíncrono (Activo Alto)" },
  { index: 3, x: 40, y: -100, label: "Q0", name: "Salida Q0" },
  { index: 4, x: 40, y: -80, label: "Q1", name: "Salida Q1" },
  { index: 5, x: 40, y: -60, label: "Q2", name: "Salida Q2" },
  { index: 6, x: 40, y: -40, label: "Q3", name: "Salida Q3" },
  { index: 7, x: 40, y: -20, label: "Q4", name: "Salida Q4" },
  { index: 8, x: 40, y: 0, label: "Q5", name: "Salida Q5" },
  { index: 9, x: 40, y: 20, label: "Q6", name: "Salida Q6" },
  { index: 10, x: 40, y: 40, label: "Q7", name: "Salida Q7" },
  { index: 11, x: 40, y: 60, label: "Q8", name: "Salida Q8" },
  { index: 12, x: 40, y: 80, label: "Q9", name: "Salida Q9" },
  { index: 13, x: 40, y: 100, label: "CO", name: "Carry Out (Acarreo)" },
];

export const JohnsonCounter4017Definition: ComponentDefinition = {
  type: "ic_4017",
  name: "Contador Decádico Johnson (CD4017)",
  category: "logica-digital",
  prefix: "U",
  defaultProperties: { value: 5.0 },
  halfExtents: { halfW: 45, halfH: 115 },
  hasStandardLeads: false,
  optionalFloatingPins: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  getPins: () => CD4017_PINS,
  render: (ctx, comp, state, options) => {
    const numVal = Number(comp.value) || 5.0;
    const vth = numVal * 0.5;
    const vMap = options.voltageMap;

    const inLevels = [
      getLogicLevel(vMap?.[`${comp.id}:0`], vth),
      getLogicLevel(vMap?.[`${comp.id}:1`], vth),
      getLogicLevel(vMap?.[`${comp.id}:2`], vth),
    ];

    const outLevels: ("1" | "0" | "X" | undefined)[] = [];
    for (let i = 3; i <= 13; i++) {
      outLevels.push(getLogicLevel(vMap?.[`${comp.id}:${i}`], vth));
    }

    const activeStage = comp.sequentialState?.activeStage as number | undefined;

    drawJohnsonCounter4017(ctx, state.color, state.lineWidth, {
      inputLevels: inLevels,
      outputLevels: outLevels,
      activeIndex: activeStage ?? 0,
    });
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const voh = Number(comp.value) || 5.0;
    const vth = voh * 0.5;

    if (!comp.sequentialState) {
      comp.sequentialState = { activeStage: 0, prevClk: false };
    }

    const vClk = pinVoltages[0] ?? 0;
    const vInh = pinVoltages[1] ?? 0;
    const vRst = pinVoltages[2] ?? 0;

    const clk = vClk >= vth;
    const inh = vInh >= vth;
    const rst = vRst >= vth;

    let stage = (comp.sequentialState.activeStage as number) ?? 0;

    if (rst) {
      stage = 0;
    } else if (!inh) {
      const prevClk = Boolean(comp.sequentialState.prevClk);
      if (clk && !prevClk) {
        stage = (stage + 1) % 10;
      }
    }

    comp.sequentialState.activeStage = stage;
    comp.sequentialState.prevClk = clk;

    const rout = 25.0;
    const branchCurrents: Record<number, number> = { 0: 0, 1: 0, 2: 0 };

    for (let i = 0; i < 10; i++) {
      const pinIdx = 3 + i;
      const bitVal = stage === i;
      const vTarget = bitVal ? voh : 0.0;
      const vActual = pinVoltages[pinIdx] ?? 0.0;
      branchCurrents[pinIdx] = (vTarget - vActual) / rout;
    }

    // Carry Out (Alto para Q0-Q4, Bajo para Q5-Q9)
    const coVal = stage < 5;
    const vCoTarget = coVal ? voh : 0.0;
    const vCoActual = pinVoltages[13] ?? 0.0;
    branchCurrents[13] = (vCoTarget - vCoActual) / rout;

    return {
      branchCurrents,
      dynamicState: { stage, coVal },
    };
  },
};

// ─── 2. 74HC90 — CONTADOR ASÍNCRONO DECÁDICO BCD ───────────────────────────

const IC7490_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: -40, y: -50, label: "CKA", name: "Reloj Sección A (÷2, Flanco Bajada)" },
  { index: 1, x: -40, y: -30, label: "CKB", name: "Reloj Sección B (÷5, Flanco Bajada)" },
  { index: 2, x: -40, y: -10, label: "R0_1", name: "Reset a 0 (Entrada 1)" },
  { index: 3, x: -40, y: 10, label: "R0_2", name: "Reset a 0 (Entrada 2)" },
  { index: 4, x: -40, y: 30, label: "R9_1", name: "Set a 9 (Entrada 1)" },
  { index: 5, x: -40, y: 50, label: "R9_2", name: "Set a 9 (Entrada 2)" },
  { index: 6, x: 40, y: -30, label: "QA", name: "Salida QA (2^0)" },
  { index: 7, x: 40, y: -10, label: "QB", name: "Salida QB (2^1)" },
  { index: 8, x: 40, y: 10, label: "QC", name: "Salida QC (2^2)" },
  { index: 9, x: 40, y: 30, label: "QD", name: "Salida QD (2^3)" },
];

export const BcdCounter90Definition: ComponentDefinition = {
  type: "ic_7490",
  name: "Contador Decádico BCD (74HC90)",
  category: "logica-digital",
  prefix: "U",
  defaultProperties: { value: 5.0 },
  halfExtents: { halfW: 45, halfH: 65 },
  hasStandardLeads: false,
  optionalFloatingPins: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  getPins: () => IC7490_PINS,
  render: (ctx, comp, state, options) => {
    const numVal = Number(comp.value) || 5.0;
    const vth = numVal * 0.5;
    const vMap = options.voltageMap;

    const inLevels = [0, 1, 2, 3, 4, 5].map((i) => getLogicLevel(vMap?.[`${comp.id}:${i}`], vth));
    const outLevels = [6, 7, 8, 9].map((i) => getLogicLevel(vMap?.[`${comp.id}:${i}`], vth));

    const countVal = comp.sequentialState?.count ?? 0;

    drawBcdCounter90(ctx, state.color, state.lineWidth, {
      inputLevels: inLevels,
      outputLevels: outLevels,
      displayValue: `CNT: ${countVal}`,
    });
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const voh = Number(comp.value) || 5.0;
    const vth = voh * 0.5;

    if (!comp.sequentialState) {
      comp.sequentialState = { qa: false, qbcd: 0, prevCka: true, prevCkb: true };
    }

    const vCka = pinVoltages[0] ?? voh;
    const vCkb = pinVoltages[1] ?? voh;
    const r0 = (pinVoltages[2] ?? 0) >= vth && (pinVoltages[3] ?? 0) >= vth;
    const r9 = (pinVoltages[4] ?? 0) >= vth && (pinVoltages[5] ?? 0) >= vth;

    const cka = vCka >= vth;
    const ckb = vCkb >= vth;

    let qa = Boolean(comp.sequentialState.qa);
    let qbcd = (comp.sequentialState.qbcd as number) ?? 0;

    if (r9) {
      qa = true;
      qbcd = 4; // 1 + 8 = 9 (QA=1, QD=1)
    } else if (r0) {
      qa = false;
      qbcd = 0;
    } else {
      // Flanco de bajada en CKA (Sección ÷2)
      const prevCka = Boolean(comp.sequentialState.prevCka);
      if (!cka && prevCka) {
        qa = !qa;
      }

      // Flanco de bajada en CKB (Sección ÷5: 0, 1, 2, 3, 4 -> 0)
      const prevCkb = Boolean(comp.sequentialState.prevCkb);
      if (!ckb && prevCkb) {
        qbcd = (qbcd + 1) % 5;
      }
    }

    comp.sequentialState.qa = qa;
    comp.sequentialState.qbcd = qbcd;
    comp.sequentialState.prevCka = cka;
    comp.sequentialState.prevCkb = ckb;

    const qb = (qbcd & 1) !== 0;
    const qc = (qbcd & 2) !== 0;
    const qd = (qbcd & 4) !== 0;
    const totalCount = (qa ? 1 : 0) + (qb ? 2 : 0) + (qc ? 4 : 0) + (qd ? 8 : 0);
    comp.sequentialState.count = totalCount;

    const rout = 25.0;
    const branchCurrents: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const bits = [qa, qb, qc, qd];

    for (let i = 0; i < 4; i++) {
      const pinIdx = 6 + i;
      const vTarget = bits[i] ? voh : 0.0;
      const vActual = pinVoltages[pinIdx] ?? 0.0;
      branchCurrents[pinIdx] = (vTarget - vActual) / rout;
    }

    return {
      branchCurrents,
      dynamicState: { count: totalCount, qa, qb, qc, qd },
    };
  },
};

// ─── 3. 74HC193 — CONTADOR SÍNCRONO UP/DOWN 4 BITS ────────────────────────

const IC74193_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: -40, y: -70, label: "CPU", name: "Reloj de Incremento (Flanco Subida)" },
  { index: 1, x: -40, y: -50, label: "CPD", name: "Reloj de Decremento (Flanco Subida)" },
  { index: 2, x: -40, y: -30, label: "PL", name: "Carga Paralela Asíncrona (Activo Bajo)" },
  { index: 3, x: -40, y: -10, label: "D0", name: "Dato Paralelo D0" },
  { index: 4, x: -40, y: 10, label: "D1", name: "Dato Paralelo D1" },
  { index: 5, x: -40, y: 30, label: "D2", name: "Dato Paralelo D2" },
  { index: 6, x: -40, y: 50, label: "D3", name: "Dato Paralelo D3" },
  { index: 7, x: -40, y: 70, label: "MR", name: "Master Reset (Activo Alto)" },
  { index: 8, x: 40, y: -50, label: "Q0", name: "Salida Q0 (LSB)" },
  { index: 9, x: 40, y: -30, label: "Q1", name: "Salida Q1" },
  { index: 10, x: 40, y: -10, label: "Q2", name: "Salida Q2" },
  { index: 11, x: 40, y: 10, label: "Q3", name: "Salida Q3 (MSB)" },
  { index: 12, x: 40, y: 30, label: "TCU", name: "Acarreo Terminal Up (Activo Bajo)" },
  { index: 13, x: 40, y: 50, label: "TCD", name: "Acarreo Terminal Down (Activo Bajo)" },
];

export const UpDownCounter193Definition: ComponentDefinition = {
  type: "ic_74193",
  name: "Contador Up/Down 4-Bits (74HC193)",
  category: "logica-digital",
  prefix: "U",
  defaultProperties: { value: 5.0 },
  halfExtents: { halfW: 45, halfH: 85 },
  hasStandardLeads: false,
  optionalFloatingPins: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  getPins: () => IC74193_PINS,
  render: (ctx, comp, state, options) => {
    const numVal = Number(comp.value) || 5.0;
    const vth = numVal * 0.5;
    const vMap = options.voltageMap;

    const inLevels = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => getLogicLevel(vMap?.[`${comp.id}:${i}`], vth));
    const outLevels = [8, 9, 10, 11, 12, 13].map((i) => getLogicLevel(vMap?.[`${comp.id}:${i}`], vth));
    const countVal = Number(comp.sequentialState?.count) || 0;

    drawUpDownCounter193(ctx, state.color, state.lineWidth, {
      inputLevels: inLevels,
      outputLevels: outLevels,
      displayValue: `0x${(countVal & 0xf).toString(16).toUpperCase()}`,
    });
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const voh = Number(comp.value) || 5.0;
    const vth = voh * 0.5;

    if (!comp.sequentialState) {
      comp.sequentialState = { count: 0, prevCpu: false, prevCpd: false };
    }

    const vCpu = pinVoltages[0] ?? 0;
    const vCpd = pinVoltages[1] ?? 0;
    const vPl = pinVoltages[2] !== undefined ? pinVoltages[2] : voh;
    const vMr = pinVoltages[7] ?? 0;

    const cpu = vCpu >= vth;
    const cpd = vCpd >= vth;
    const pl = vPl >= vth; // Activo en bajo
    const mr = vMr >= vth; // Activo en alto

    let count = (comp.sequentialState.count as number) ?? 0;

    if (mr) {
      count = 0;
    } else if (!pl) {
      // Carga asíncrona
      const d0 = (pinVoltages[3] ?? 0) >= vth ? 1 : 0;
      const d1 = (pinVoltages[4] ?? 0) >= vth ? 2 : 0;
      const d2 = (pinVoltages[5] ?? 0) >= vth ? 4 : 0;
      const d3 = (pinVoltages[6] ?? 0) >= vth ? 8 : 0;
      count = d0 | d1 | d2 | d3;
    } else {
      const prevCpu = Boolean(comp.sequentialState.prevCpu);
      const prevCpd = Boolean(comp.sequentialState.prevCpd);

      if (cpu && !prevCpu && cpd) {
        count = (count + 1) & 0xf;
      } else if (cpd && !prevCpd && cpu) {
        count = (count - 1 + 16) & 0xf;
      }
    }

    comp.sequentialState.count = count;
    comp.sequentialState.prevCpu = cpu;
    comp.sequentialState.prevCpd = cpd;

    const rout = 25.0;
    const branchCurrents: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };

    for (let i = 0; i < 4; i++) {
      const pinIdx = 8 + i;
      const bitVal = Boolean((count >> i) & 1);
      const vTarget = bitVal ? voh : 0.0;
      const vActual = pinVoltages[pinIdx] ?? 0.0;
      branchCurrents[pinIdx] = (vTarget - vActual) / rout;
    }

    // TCU (Bajo cuando count=15 y CPU está bajo)
    const tcu = !(count === 15 && !cpu);
    branchCurrents[12] = ((tcu ? voh : 0.0) - (pinVoltages[12] ?? 0.0)) / rout;

    // TCD (Bajo cuando count=0 y CPD está bajo)
    const tcd = !(count === 0 && !cpd);
    branchCurrents[13] = ((tcd ? voh : 0.0) - (pinVoltages[13] ?? 0.0)) / rout;

    return {
      branchCurrents,
      dynamicState: { count, tcu, tcd },
    };
  },
};

// ─── 4. 74HC138 — DECODIFICADOR / DEMUX 3 A 8 LÍNEAS ──────────────────────

const IC74138_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: -40, y: -50, label: "A0", name: "Entrada de Dirección A0" },
  { index: 1, x: -40, y: -30, label: "A1", name: "Entrada de Dirección A1" },
  { index: 2, x: -40, y: -10, label: "A2", name: "Entrada de Dirección A2" },
  { index: 3, x: -40, y: 10, label: "G1", name: "Habilitación G1 (Activo Alto)" },
  { index: 4, x: -40, y: 30, label: "G2A", name: "Habilitación G2A (Activo Bajo)" },
  { index: 5, x: -40, y: 50, label: "G2B", name: "Habilitación G2B (Activo Bajo)" },
  { index: 6, x: 40, y: -70, label: "Y0", name: "Salida Invertida Y0" },
  { index: 7, x: 40, y: -50, label: "Y1", name: "Salida Invertida Y1" },
  { index: 8, x: 40, y: -30, label: "Y2", name: "Salida Invertida Y2" },
  { index: 9, x: 40, y: -10, label: "Y3", name: "Salida Invertida Y3" },
  { index: 10, x: 40, y: 10, label: "Y4", name: "Salida Invertida Y4" },
  { index: 11, x: 40, y: 30, label: "Y5", name: "Salida Invertida Y5" },
  { index: 12, x: 40, y: 50, label: "Y6", name: "Salida Invertida Y6" },
  { index: 13, x: 40, y: 70, label: "Y7", name: "Salida Invertida Y7" },
];

export const Decoder138Definition: ComponentDefinition = {
  type: "ic_74138",
  name: "Decodificador/Demux 3:8 (74HC138)",
  category: "logica-digital",
  prefix: "U",
  defaultProperties: { value: 5.0 },
  halfExtents: { halfW: 45, halfH: 85 },
  hasStandardLeads: false,
  optionalFloatingPins: [6, 7, 8, 9, 10, 11, 12, 13],
  getPins: () => IC74138_PINS,
  render: (ctx, comp, state, options) => {
    const numVal = Number(comp.value) || 5.0;
    const vth = numVal * 0.5;
    const vMap = options.voltageMap;

    const inLevels = [0, 1, 2, 3, 4, 5].map((i) => getLogicLevel(vMap?.[`${comp.id}:${i}`], vth));
    const outLevels = [6, 7, 8, 9, 10, 11, 12, 13].map((i) => getLogicLevel(vMap?.[`${comp.id}:${i}`], vth));

    drawDecoder138(ctx, state.color, state.lineWidth, {
      inputLevels: inLevels,
      outputLevels: outLevels,
    });
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const voh = Number(comp.value) || 5.0;
    const vth = voh * 0.5;

    const a0 = (pinVoltages[0] ?? 0) >= vth ? 1 : 0;
    const a1 = (pinVoltages[1] ?? 0) >= vth ? 2 : 0;
    const a2 = (pinVoltages[2] ?? 0) >= vth ? 4 : 0;
    const addr = a0 | a1 | a2;

    const g1 = (pinVoltages[3] !== undefined ? pinVoltages[3] : voh) >= vth;
    const g2a = (pinVoltages[4] ?? 0) >= vth;
    const g2b = (pinVoltages[5] ?? 0) >= vth;

    const enabled = g1 && !g2a && !g2b;

    const rout = 25.0;
    const branchCurrents: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

    for (let i = 0; i < 8; i++) {
      const pinIdx = 6 + i;
      // Salidas activas en bajo
      const isLow = enabled && addr === i;
      const vTarget = isLow ? 0.0 : voh;
      const vActual = pinVoltages[pinIdx] ?? voh;
      branchCurrents[pinIdx] = (vTarget - vActual) / rout;
    }

    return {
      branchCurrents,
      dynamicState: { enabled, addr },
    };
  },
};

// ─── 5. 74HC151 — MULTIPLEXOR DE DATOS 8 A 1 ──────────────────────────────

const IC74151_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: -40, y: -90, label: "D0", name: "Entrada de Dato D0" },
  { index: 1, x: -40, y: -70, label: "D1", name: "Entrada de Dato D1" },
  { index: 2, x: -40, y: -50, label: "D2", name: "Entrada de Dato D2" },
  { index: 3, x: -40, y: -30, label: "D3", name: "Entrada de Dato D3" },
  { index: 4, x: -40, y: -10, label: "D4", name: "Entrada de Dato D4" },
  { index: 5, x: -40, y: 10, label: "D5", name: "Entrada de Dato D5" },
  { index: 6, x: -40, y: 30, label: "D6", name: "Entrada de Dato D6" },
  { index: 7, x: -40, y: 50, label: "D7", name: "Entrada de Dato D7" },
  { index: 8, x: -40, y: 70, label: "S0", name: "Selector S0" },
  { index: 9, x: -40, y: 85, label: "S1", name: "Selector S1" },
  { index: 10, x: -40, y: 100, label: "S2", name: "Selector S2" },
  { index: 11, x: -40, y: 115, label: "E", name: "Habilitación Strobe (Activo Bajo)" },
  { index: 12, x: 40, y: -20, label: "Y", name: "Salida de Datos Directa Y" },
  { index: 13, x: 40, y: 20, label: "W", name: "Salida Invertida W (Y_NOT)" },
];

export const Multiplexer151Definition: ComponentDefinition = {
  type: "ic_74151",
  name: "Multiplexor 8:1 (74HC151)",
  category: "logica-digital",
  prefix: "U",
  defaultProperties: { value: 5.0 },
  halfExtents: { halfW: 45, halfH: 125 },
  hasStandardLeads: false,
  optionalFloatingPins: [12, 13],
  getPins: () => IC74151_PINS,
  render: (ctx, comp, state, options) => {
    const numVal = Number(comp.value) || 5.0;
    const vth = numVal * 0.5;
    const vMap = options.voltageMap;

    const inLevels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) =>
      getLogicLevel(vMap?.[`${comp.id}:${i}`], vth),
    );
    const outLevels = [12, 13].map((i) => getLogicLevel(vMap?.[`${comp.id}:${i}`], vth));

    drawMultiplexer151(ctx, state.color, state.lineWidth, {
      inputLevels: inLevels,
      outputLevels: outLevels,
    });
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const voh = Number(comp.value) || 5.0;
    const vth = voh * 0.5;

    const s0 = (pinVoltages[8] ?? 0) >= vth ? 1 : 0;
    const s1 = (pinVoltages[9] ?? 0) >= vth ? 2 : 0;
    const s2 = (pinVoltages[10] ?? 0) >= vth ? 4 : 0;
    const sel = s0 | s1 | s2;

    const e = (pinVoltages[11] ?? 0) >= vth; // Activo en bajo

    let selectedBit = false;
    if (!e) {
      const vSelected = pinVoltages[sel] ?? 0;
      selectedBit = vSelected >= vth;
    }

    const rout = 25.0;
    const branchCurrents: Record<number, number> = {
      0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0,
    };

    // Salida Y
    const vYTarget = selectedBit ? voh : 0.0;
    const vYActual = pinVoltages[12] ?? 0.0;
    branchCurrents[12] = (vYTarget - vYActual) / rout;

    // Salida W (Invertida)
    const vWTarget = !selectedBit ? voh : 0.0;
    const vWActual = pinVoltages[13] ?? voh;
    branchCurrents[13] = (vWTarget - vWActual) / rout;

    return {
      branchCurrents,
      dynamicState: { sel, selectedBit, enabled: !e },
    };
  },
};
