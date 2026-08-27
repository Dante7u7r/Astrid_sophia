// ==========================================================================
// SEQUENTIAL LOGIC & DIGITAL IC DESCRIPTORS
// Flip-Flops D/JK, Decodificador BCD 7447, Registro 74595
// ==========================================================================

import {
  drawBcdTo7Seg,
  drawFlipFlopD,
  drawFlipFlopJK,
  drawShiftRegister595,
} from "../../canvas/component_logic_renderer";
import type { ComponentDefinition, LocalPinDefinition } from "../types";

function getLogicLevel(voltage?: number, vth: number = 2.5): "1" | "0" | "X" | undefined {
  if (voltage === undefined) return undefined;
  if (voltage >= vth * 0.8) return "1";
  if (voltage <= vth * 0.35) return "0";
  return "X";
}

// ─── 1. FLIP-FLOP D (74HC74) ───────────────────────────────────────────────

const FLIPFLOP_D_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: -40, y: -20, label: "D", name: "Entrada de Datos D" },
  { index: 1, x: -40, y: 0, label: "CLK", name: "Reloj (Flanco de Subida)" },
  { index: 2, x: 0, y: -40, label: "PRE", name: "Preset Asíncrono (Activo Bajo)" },
  { index: 3, x: 0, y: 40, label: "CLR", name: "Clear Asíncrono (Activo Bajo)" },
  { index: 4, x: 40, y: -20, label: "Q", name: "Salida Q" },
  { index: 5, x: 40, y: 20, label: "Q_NOT", name: "Salida Invertida Q̄" },
];

export const FlipFlopDDefinition: ComponentDefinition = {
  type: "flipflop_d",
  name: "Flip-Flop Tipo D (74HC74)",
  category: "logica-digital",
  prefix: "U",
  defaultProperties: { value: 5.0 },
  halfExtents: { halfW: 45, halfH: 45 },
  hasStandardLeads: false,
  optionalFloatingPins: [2, 3, 5], // PRE, CLR, Q_NOT pueden dejarse flotantes
  getPins: () => FLIPFLOP_D_PINS,
  render: (ctx, comp, state, options) => {
    const numVal = Number(comp.value) || 5.0;
    const vth = numVal * 0.5;

    const voltageMap = options.voltageMap;
    const vD = voltageMap?.[`${comp.id}:0`];
    const vClk = voltageMap?.[`${comp.id}:1`];
    const vPre = voltageMap?.[`${comp.id}:2`];
    const vClr = voltageMap?.[`${comp.id}:3`];
    const vQ = voltageMap?.[`${comp.id}:4`];
    const vQNot = voltageMap?.[`${comp.id}:5`];

    drawFlipFlopD(ctx, state.color, state.lineWidth, {
      levelD: getLogicLevel(vD, vth),
      levelClk: getLogicLevel(vClk, vth),
      levelPre: getLogicLevel(vPre, vth),
      levelClr: getLogicLevel(vClr, vth),
      levelQ: getLogicLevel(vQ, vth) ?? (comp.sequentialState?.q ? "1" : "0"),
      levelQNot: getLogicLevel(vQNot, vth) ?? (comp.sequentialState?.qNot ? "1" : "0"),
      symbolStandard: options.symbolStandard,
    });
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const voh = Number(comp.value) || 5.0;
    const vth = voh * 0.5;

    // Inicializar estado secuencial si no existe
    if (!comp.sequentialState) {
      comp.sequentialState = { q: false, qNot: true, prevClk: false };
    }

    const vD = pinVoltages[0] ?? 0;
    const vClk = pinVoltages[1] ?? 0;
    const vPre = pinVoltages[2] !== undefined ? pinVoltages[2] : voh; // PRE pull-up por defecto
    const vClr = pinVoltages[3] !== undefined ? pinVoltages[3] : voh; // CLR pull-up por defecto

    const d = vD >= vth;
    const clk = vClk >= vth;
    const pre = vPre >= vth; // Activo en bajo (false = activo)
    const clr = vClr >= vth; // Activo en bajo (false = activo)

    let q = comp.sequentialState.q ?? false;
    let qNot = comp.sequentialState.qNot ?? true;

    // 1. Prioridad asíncrona (Preset / Clear activos en bajo)
    if (!pre && clr) {
      q = true;
      qNot = false;
    } else if (pre && !clr) {
      q = false;
      qNot = true;
    } else if (!pre && !clr) {
      q = true;
      qNot = true; // Condición inestable en CI real
    } else {
      // 2. Sincronismo por flanco de subida de CLK (0 -> 1)
      const prevClk = comp.sequentialState.prevClk ?? false;
      if (clk && !prevClk) {
        q = d;
        qNot = !d;
      }
    }

    comp.sequentialState.q = q;
    comp.sequentialState.qNot = qNot;
    comp.sequentialState.prevClk = clk;

    const vQTarget = q ? voh : 0.0;
    const vQNotTarget = qNot ? voh : 0.0;
    const rout = 25.0;

    const vQActual = pinVoltages[4] ?? vQTarget;
    const vQNotActual = pinVoltages[5] ?? vQNotTarget;
    const iQ = (vQTarget - vQActual) / rout;
    const iQNot = (vQNotTarget - vQNotActual) / rout;

    return {
      branchCurrents: { 0: 0, 1: 0, 2: 0, 3: 0, 4: iQ, 5: iQNot },
      dynamicState: { q, qNot, vQTarget, vQNotTarget },
    };
  },
};

// ─── 2. FLIP-FLOP JK (74HC73) ──────────────────────────────────────────────

const FLIPFLOP_JK_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: -40, y: -20, label: "J", name: "Entrada J (Set)" },
  { index: 1, x: -40, y: 0, label: "CLK", name: "Reloj (Flanco de Subida)" },
  { index: 2, x: -40, y: 20, label: "K", name: "Entrada K (Reset)" },
  { index: 3, x: 0, y: 40, label: "CLR", name: "Clear Asíncrono (Activo Bajo)" },
  { index: 4, x: 40, y: -20, label: "Q", name: "Salida Q" },
  { index: 5, x: 40, y: 20, label: "Q_NOT", name: "Salida Invertida Q̄" },
];

export const FlipFlopJKDefinition: ComponentDefinition = {
  type: "flipflop_jk",
  name: "Flip-Flop JK (74HC73)",
  category: "logica-digital",
  prefix: "U",
  defaultProperties: { value: 5.0 },
  halfExtents: { halfW: 45, halfH: 45 },
  hasStandardLeads: false,
  optionalFloatingPins: [3, 5],
  getPins: () => FLIPFLOP_JK_PINS,
  render: (ctx, comp, state, options) => {
    const numVal = Number(comp.value) || 5.0;
    const vth = numVal * 0.5;

    const voltageMap = options.voltageMap;
    const vJ = voltageMap?.[`${comp.id}:0`];
    const vClk = voltageMap?.[`${comp.id}:1`];
    const vK = voltageMap?.[`${comp.id}:2`];
    const vClr = voltageMap?.[`${comp.id}:3`];
    const vQ = voltageMap?.[`${comp.id}:4`];
    const vQNot = voltageMap?.[`${comp.id}:5`];

    drawFlipFlopJK(ctx, state.color, state.lineWidth, {
      levelJ: getLogicLevel(vJ, vth),
      levelClk: getLogicLevel(vClk, vth),
      levelK: getLogicLevel(vK, vth),
      levelClr: getLogicLevel(vClr, vth),
      levelQ: getLogicLevel(vQ, vth) ?? (comp.sequentialState?.q ? "1" : "0"),
      levelQNot: getLogicLevel(vQNot, vth) ?? (comp.sequentialState?.qNot ? "1" : "0"),
      symbolStandard: options.symbolStandard,
    });
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const voh = Number(comp.value) || 5.0;
    const vth = voh * 0.5;

    if (!comp.sequentialState) {
      comp.sequentialState = { q: false, qNot: true, prevClk: false };
    }

    const vJ = pinVoltages[0] ?? 0;
    const vClk = pinVoltages[1] ?? 0;
    const vK = pinVoltages[2] ?? 0;
    const vClr = pinVoltages[3] !== undefined ? pinVoltages[3] : voh;

    const j = vJ >= vth;
    const clk = vClk >= vth;
    const k = vK >= vth;
    const clr = vClr >= vth;

    let q = comp.sequentialState.q ?? false;
    let qNot = comp.sequentialState.qNot ?? true;

    // Asíncrono CLR
    if (!clr) {
      q = false;
      qNot = true;
    } else {
      // Flanco de subida
      const prevClk = comp.sequentialState.prevClk ?? false;
      if (clk && !prevClk) {
        if (!j && !k) {
          // Hold
        } else if (!j && k) {
          q = false;
          qNot = true;
        } else if (j && !k) {
          q = true;
          qNot = false;
        } else if (j && k) {
          // Toggle
          q = !q;
          qNot = !q;
        }
      }
    }

    comp.sequentialState.q = q;
    comp.sequentialState.qNot = qNot;
    comp.sequentialState.prevClk = clk;

    const vQTarget = q ? voh : 0.0;
    const vQNotTarget = qNot ? voh : 0.0;
    const rout = 25.0;

    const vQActual = pinVoltages[4] ?? vQTarget;
    const vQNotActual = pinVoltages[5] ?? vQNotTarget;
    const iQ = (vQTarget - vQActual) / rout;
    const iQNot = (vQNotTarget - vQNotActual) / rout;

    return {
      branchCurrents: { 0: 0, 1: 0, 2: 0, 3: 0, 4: iQ, 5: iQNot },
      dynamicState: { q, qNot, vQTarget, vQNotTarget },
    };
  },
};

// ─── 3. DECODIFICADOR BCD A 7 SEGMENTOS (74HC47) ───────────────────────────

const BCD_7SEG_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: -40, y: -60, label: "A", name: "Entrada BCD A (2^0 LSB)" },
  { index: 1, x: -40, y: -20, label: "B", name: "Entrada BCD B (2^1)" },
  { index: 2, x: -40, y: 20, label: "C", name: "Entrada BCD C (2^2)" },
  { index: 3, x: -40, y: 60, label: "D", name: "Entrada BCD D (2^3 MSB)" },
  { index: 4, x: 40, y: -60, label: "a", name: "Salida Segmento a" },
  { index: 5, x: 40, y: -40, label: "b", name: "Salida Segmento b" },
  { index: 6, x: 40, y: -20, label: "c", name: "Salida Segmento c" },
  { index: 7, x: 40, y: 0, label: "d", name: "Salida Segmento d" },
  { index: 8, x: 40, y: 20, label: "e", name: "Salida Segmento e" },
  { index: 9, x: 40, y: 40, label: "f", name: "Salida Segmento f" },
  { index: 10, x: 40, y: 60, label: "g", name: "Salida Segmento g" },
];

// Tabla de decodificación BCD a 7 segmentos estándar (0-9 activo en alto)
// Formato: [a, b, c, d, e, f, g]
const BCD_TABLE: Record<number, boolean[]> = {
  0: [true, true, true, true, true, true, false],
  1: [false, true, true, false, false, false, false],
  2: [true, true, false, true, true, false, true],
  3: [true, true, true, true, false, false, true],
  4: [false, true, true, false, false, true, true],
  5: [true, false, true, true, false, true, true],
  6: [true, false, true, true, true, true, true],
  7: [true, true, true, false, false, false, false],
  8: [true, true, true, true, true, true, true],
  9: [true, true, true, true, false, true, true],
};

export const BcdTo7SegDefinition: ComponentDefinition = {
  type: "bcd_to_7seg",
  name: "Decodificador BCD a 7 Segmentos (74HC47)",
  category: "logica-digital",
  prefix: "U",
  defaultProperties: { value: 5.0 },
  halfExtents: { halfW: 45, halfH: 75 },
  hasStandardLeads: false,
  optionalFloatingPins: [4, 5, 6, 7, 8, 9, 10],
  getPins: () => BCD_7SEG_PINS,
  render: (ctx, comp, state, options) => {
    const numVal = Number(comp.value) || 5.0;
    const vth = numVal * 0.5;

    const voltageMap = options.voltageMap;
    const inLevels: ("1" | "0" | "X" | undefined)[] = [];
    for (let i = 0; i < 4; i++) {
      const v = voltageMap?.[`${comp.id}:${i}`];
      inLevels.push(getLogicLevel(v, vth));
    }

    const outLevels: ("1" | "0" | "X" | undefined)[] = [];
    for (let i = 4; i <= 10; i++) {
      const v = voltageMap?.[`${comp.id}:${i}`];
      outLevels.push(getLogicLevel(v, vth));
    }

    const digit = comp.sequentialState?.decodedDigit as number | undefined;

    drawBcdTo7Seg(ctx, state.color, state.lineWidth, {
      inputLevels: inLevels,
      outputLevels: outLevels,
      decodedDigit: digit,
    });
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const voh = Number(comp.value) || 5.0;
    const vth = voh * 0.5;

    const vA = pinVoltages[0] ?? 0;
    const vB = pinVoltages[1] ?? 0;
    const vC = pinVoltages[2] ?? 0;
    const vD = pinVoltages[3] ?? 0;

    const a = vA >= vth ? 1 : 0;
    const b = vB >= vth ? 2 : 0;
    const c = vC >= vth ? 4 : 0;
    const d = vD >= vth ? 8 : 0;

    const bcdVal = a + b + c + d;
    const segments = BCD_TABLE[bcdVal] ?? [false, false, false, false, false, false, false];

    if (!comp.sequentialState) {
      comp.sequentialState = {};
    }
    comp.sequentialState.decodedDigit = bcdVal <= 9 ? bcdVal : undefined;

    const rout = 25.0;
    const branchCurrents: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
    const segOutputs: Record<string, boolean> = {};

    const segNames = ["a", "b", "c", "d", "e", "f", "g"];
    for (let i = 0; i < 7; i++) {
      const pinIdx = 4 + i;
      const isActive = segments[i] ?? false;
      segOutputs[segNames[i]] = isActive;
      const vTarget = isActive ? voh : 0.0;
      const vActual = pinVoltages[pinIdx] ?? vTarget;
      branchCurrents[pinIdx] = (vTarget - vActual) / rout;
    }

    return {
      branchCurrents,
      dynamicState: { bcdVal, segOutputs },
    };
  },
};

// ─── 4. REGISTRO DE DESPLAZAMIENTO 8-BIT SIPO (74HC595) ─────────────────────

const SHIFT_REG_595_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: -40, y: -40, label: "SER", name: "Entrada de Datos Serie" },
  { index: 1, x: -40, y: -20, label: "SRCLK", name: "Reloj de Desplazamiento" },
  { index: 2, x: -40, y: 0, label: "RCLK", name: "Reloj de Registro / Latch" },
  { index: 3, x: -40, y: 20, label: "OE", name: "Habilitación de Salida (Activo Bajo)" },
  { index: 4, x: -40, y: 40, label: "SRCLR", name: "Reset de Desplazamiento (Activo Bajo)" },
  { index: 5, x: 40, y: -80, label: "Q0", name: "Salida Paralela Q0" },
  { index: 6, x: 40, y: -60, label: "Q1", name: "Salida Paralela Q1" },
  { index: 7, x: 40, y: -40, label: "Q2", name: "Salida Paralela Q2" },
  { index: 8, x: 40, y: -20, label: "Q3", name: "Salida Paralela Q3" },
  { index: 9, x: 40, y: 0, label: "Q4", name: "Salida Paralela Q4" },
  { index: 10, x: 40, y: 20, label: "Q5", name: "Salida Paralela Q5" },
  { index: 11, x: 40, y: 40, label: "Q6", name: "Salida Paralela Q6" },
  { index: 12, x: 40, y: 60, label: "Q7", name: "Salida Paralela Q7" },
  { index: 13, x: 40, y: 80, label: "QH'", name: "Salida Serie Cascada" },
];

export const ShiftRegister595Definition: ComponentDefinition = {
  type: "shift_register_595",
  name: "Registro de Desplazamiento 8-Bit SIPO (74HC595)",
  category: "logica-digital",
  prefix: "U",
  defaultProperties: { value: 5.0 },
  halfExtents: { halfW: 45, halfH: 95 },
  hasStandardLeads: false,
  optionalFloatingPins: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  getPins: () => SHIFT_REG_595_PINS,
  render: (ctx, comp, state, options) => {
    const numVal = Number(comp.value) || 5.0;
    const vth = numVal * 0.5;

    const voltageMap = options.voltageMap;
    const inLevels: ("1" | "0" | "X" | undefined)[] = [];
    for (let i = 0; i < 5; i++) {
      const v = voltageMap?.[`${comp.id}:${i}`];
      inLevels.push(getLogicLevel(v, vth));
    }

    const outLevels: ("1" | "0" | "X" | undefined)[] = [];
    for (let i = 5; i <= 13; i++) {
      const v = voltageMap?.[`${comp.id}:${i}`];
      outLevels.push(getLogicLevel(v, vth));
    }

    const latchVal = comp.sequentialState?.latchReg as number | undefined;

    drawShiftRegister595(ctx, state.color, state.lineWidth, {
      inputLevels: inLevels,
      outputLevels: outLevels,
      latchValue: latchVal,
    });
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const voh = Number(comp.value) || 5.0;
    const vth = voh * 0.5;

    if (!comp.sequentialState) {
      comp.sequentialState = { shiftReg: 0, latchReg: 0, prevSrclk: false, prevRclk: false };
    }

    const vSer = pinVoltages[0] ?? 0;
    const vSrclk = pinVoltages[1] ?? 0;
    const vRclk = pinVoltages[2] ?? 0;
    const vOe = pinVoltages[3] !== undefined ? pinVoltages[3] : 0; // OE pull-down por defecto (habilitado)
    const vSrclr = pinVoltages[4] !== undefined ? pinVoltages[4] : voh; // SRCLR pull-up por defecto

    const ser = vSer >= vth;
    const srclk = vSrclk >= vth;
    const rclk = vRclk >= vth;
    const oe = vOe >= vth; // Activo en bajo (false = salidas habilitadas)
    const srclr = vSrclr >= vth; // Activo en bajo (false = reset activo)

    let shiftReg = (comp.sequentialState.shiftReg as number) ?? 0;
    let latchReg = (comp.sequentialState.latchReg as number) ?? 0;

    // 1. Reset asíncrono del registro de desplazamiento
    if (!srclr) {
      shiftReg = 0;
    } else {
      // 2. Flanco de subida en SRCLK
      const prevSrclk = Boolean(comp.sequentialState.prevSrclk);
      if (srclk && !prevSrclk) {
        shiftReg = ((shiftReg << 1) | (ser ? 1 : 0)) & 0xff;
      }
    }

    // 3. Flanco de subida en RCLK (actualización del cerrojo / latch)
    const prevRclk = Boolean(comp.sequentialState.prevRclk);
    if (rclk && !prevRclk) {
      latchReg = shiftReg;
    }

    comp.sequentialState.shiftReg = shiftReg;
    comp.sequentialState.latchReg = latchReg;
    comp.sequentialState.prevSrclk = srclk;
    comp.sequentialState.prevRclk = rclk;

    const rout = 25.0;
    const branchCurrents: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };

    // Si OE está activo en bajo (!oe), transferir a los pines Q0..Q7
    for (let i = 0; i < 8; i++) {
      const pinIdx = 5 + i;
      const bitVal = !oe ? Boolean((latchReg >> i) & 1) : false;
      const vTarget = bitVal ? voh : 0.0;
      const vActual = pinVoltages[pinIdx] ?? 0.0;
      branchCurrents[pinIdx] = !oe ? (vTarget - vActual) / rout : 0.0;
    }

    // QH' (Salida serie directa del bit más significativo del shift register)
    const qhBit = Boolean((shiftReg >> 7) & 1);
    const vQhTarget = qhBit ? voh : 0.0;
    const vQhActual = pinVoltages[13] ?? 0.0;
    branchCurrents[13] = (vQhTarget - vQhActual) / rout;

    return {
      branchCurrents,
      dynamicState: { shiftReg, latchReg, qhBit },
    };
  },
};
