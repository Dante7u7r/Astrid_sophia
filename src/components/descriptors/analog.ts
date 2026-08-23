// ==========================================================================
// ANALOG COMPONENT DESCRIPTORS — Op-Amps, Fuentes de Tensión y Corriente
// ==========================================================================

import { drawCompactComponent } from "../../canvas/component_compact_renderer";
import type { ComponentDefinition, LocalPinDefinition } from "../types";

const STANDARD_TWO_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: -40, y: 0, label: "+" },
  { index: 1, x: 40, y: 0, label: "-" },
];

export const OpampDefinition: ComponentDefinition = {
  type: "opamp",
  name: "Amplificador Operacional (Op-Amp)",
  category: "analogicos",
  prefix: "U",
  defaultProperties: { value: 0, openLoopGain: 100000 },
  halfExtents: { halfW: 45, halfH: 45 },
  hasStandardLeads: false,
  optionalFloatingPins: [2, 3], // Alimentaciones V+ y V- opcionales en macromodelo ideal
  getPins: () => [
    { index: 0, x: -40, y: -15, label: "+", name: "In+" },
    { index: 1, x: -40, y: 15, label: "-", name: "In-" },
    { index: 2, x: 0, y: -40, label: "V+", name: "VCC" },
    { index: 3, x: 0, y: 40, label: "V-", name: "VEE" },
    { index: 4, x: 40, y: 0, label: "OUT", name: "Salida" },
  ],
  render: (ctx, comp, state, options) => {
    if (options.detail === "compact") {
      drawCompactComponent(ctx, comp, state.color);
      return;
    }

    const vInPlus = options.voltageMap?.[`${comp.id}:0`] ?? 0;
    const vInMinus = options.voltageMap?.[`${comp.id}:1`] ?? 0;
    const vCC = options.voltageMap?.[`${comp.id}:2`] ?? 15;
    const vEE = options.voltageMap?.[`${comp.id}:3`] ?? -15;
    const vOut = options.voltageMap?.[`${comp.id}:4`] ?? 0;

    const diff = Math.abs(vInPlus - vInMinus);
    const isSaturatedPos = vOut >= vCC - 0.5;
    const isSaturatedNeg = vOut <= vEE + 0.5;
    const isVirtualGround = diff <= 0.05 && !isSaturatedPos && !isSaturatedNeg;

    ctx.save();
    // 1. Relleno pedagógico del cuerpo triangular
    ctx.beginPath();
    ctx.moveTo(-25, -30);
    ctx.lineTo(-25, 30);
    ctx.lineTo(25, 0);
    ctx.closePath();

    if (isSaturatedPos || isSaturatedNeg) {
      ctx.fillStyle = "rgba(239, 68, 68, 0.25)"; // Rojo/Ámbar de saturación en riel
    } else if (isVirtualGround) {
      ctx.fillStyle = "rgba(56, 189, 248, 0.2)"; // Azul cyan de equilibrio de lazo lineal
    } else {
      ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
    }
    ctx.fill();
    ctx.strokeStyle = isSaturatedPos || isSaturatedNeg ? "#EF4444" : (isVirtualGround ? "#38BDF8" : state.color);
    ctx.lineWidth = state.lineWidth;
    ctx.stroke();

    // 2. Terminales de entrada/salida y alimentación
    ctx.beginPath();
    ctx.moveTo(-40, -15);
    ctx.lineTo(-25, -15);
    ctx.moveTo(-40, 15);
    ctx.lineTo(-25, 15);
    ctx.moveTo(25, 0);
    ctx.lineTo(40, 0);

    ctx.moveTo(0, -40);
    ctx.lineTo(0, -15);
    ctx.moveTo(0, 40);
    ctx.lineTo(0, 15);
    ctx.stroke();

    // 3. Plus (+) en pin 0 (In+)
    ctx.strokeStyle = state.color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-21, -15);
    ctx.lineTo(-15, -15);
    ctx.moveTo(-18, -18);
    ctx.lineTo(-18, -12);

    // 4. Minus (-) en pin 1 (In-)
    ctx.moveTo(-21, 15);
    ctx.lineTo(-15, 15);
    ctx.stroke();

    // 5. Etiquetas de alimentación V+ (Pin 2 superior) y V- (Pin 3 inferior)
    ctx.font = "bold 8px 'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#F59E0B"; // Ámbar para positivo
    ctx.fillText("V+", 4, -28);

    ctx.fillStyle = "#38BDF8"; // Celeste para negativo
    ctx.fillText("V-", 4, 28);

    // 6. Indicador de estado de saturación / linealidad
    if (isSaturatedPos || isSaturatedNeg) {
      ctx.fillStyle = "#EF4444";
      ctx.font = "bold 8px 'Inter', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(isSaturatedPos ? "SAT+" : "SAT-", -5, 4);
    } else if (isVirtualGround) {
      ctx.fillStyle = "#38BDF8";
      ctx.font = "bold 7px 'Inter', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("LIN", -5, 3);
    }
    ctx.restore();
  },
};

export const OpampIdealDefinition: ComponentDefinition = {
  type: "opamp_ideal",
  name: "Op-Amp Ideal (3 pines)",
  category: "analogicos",
  prefix: "U",
  defaultProperties: { value: 0, openLoopGain: 100000 },
  halfExtents: { halfW: 45, halfH: 35 },
  hasStandardLeads: false,
  getPins: () => [
    { index: 0, x: -40, y: -15, label: "+", name: "In+" },
    { index: 1, x: -40, y: 15, label: "-", name: "In-" },
    { index: 2, x: 40, y: 0, label: "OUT", name: "Salida" },
  ],
  render: (ctx, comp, state, options) => {
    if (options.detail === "compact") {
      drawCompactComponent(ctx, comp, state.color);
      return;
    }

    const vInPlus = options.voltageMap?.[`${comp.id}:0`] ?? 0;
    const vInMinus = options.voltageMap?.[`${comp.id}:1`] ?? 0;
    const diff = Math.abs(vInPlus - vInMinus);
    const isVirtualGround = diff <= 0.05;

    ctx.save();
    // Main triangle
    ctx.beginPath();
    ctx.moveTo(-25, -30);
    ctx.lineTo(-25, 30);
    ctx.lineTo(25, 0);
    ctx.closePath();
    ctx.fillStyle = isVirtualGround ? "rgba(56, 189, 248, 0.2)" : "rgba(15, 23, 42, 0.85)";
    ctx.fill();
    ctx.strokeStyle = isVirtualGround ? "#38BDF8" : state.color;
    ctx.lineWidth = state.lineWidth;
    ctx.stroke();

    // Input terminals (+ and -) and output terminal (OUT)
    ctx.beginPath();
    ctx.moveTo(-40, -15);
    ctx.lineTo(-25, -15);
    ctx.moveTo(-40, 15);
    ctx.lineTo(-25, 15);
    ctx.moveTo(25, 0);
    ctx.lineTo(40, 0);
    ctx.stroke();

    // Plus (+) at pin 0 (-15)
    ctx.strokeStyle = state.color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-21, -15);
    ctx.lineTo(-15, -15);
    ctx.moveTo(-18, -18);
    ctx.lineTo(-18, -12);

    // Minus (-) at pin 1 (+15)
    ctx.moveTo(-21, 15);
    ctx.lineTo(-15, 15);
    ctx.stroke();
    ctx.restore();
  },
};

/**
 * Dibuja un glifo miniatura de la forma de onda dentro del círculo de la fuente.
 * Se invoca solo cuando waveType !== "dc" y !== undefined.
 */
function drawWaveformGlyph(
  ctx: CanvasRenderingContext2D,
  waveType: string,
  color: string,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();

  const w = 12;  // Mitad del ancho del glifo
  const h = 7;   // Mitad de la altura del glifo

  switch (waveType) {
    case "sine":
      // Mini senoidale ∿
      ctx.moveTo(-w, 0);
      ctx.bezierCurveTo(-w * 0.5, -h * 2, w * 0.5, h * 2, w, 0);
      break;

    case "square":
      // Mini cuadrada ⊓⊔
      ctx.moveTo(-w, h);
      ctx.lineTo(-w, -h);
      ctx.lineTo(0, -h);
      ctx.lineTo(0, h);
      ctx.lineTo(w, h);
      ctx.lineTo(w, -h);
      break;

    case "triangle":
      // Mini triangular /\/
      ctx.moveTo(-w, 0);
      ctx.lineTo(-w * 0.5, -h);
      ctx.lineTo(0, 0);
      ctx.lineTo(w * 0.5, h);
      ctx.lineTo(w, 0);
      break;

    case "sawtooth":
      // Mini diente de sierra /|/|
      ctx.moveTo(-w, h);
      ctx.lineTo(0, -h);
      ctx.lineTo(0, h);
      ctx.lineTo(w, -h);
      break;

    case "pulse":
      // Mini pulso con duty estrecho
      ctx.moveTo(-w, h);
      ctx.lineTo(-w, -h);
      ctx.lineTo(-w * 0.3, -h);
      ctx.lineTo(-w * 0.3, h);
      ctx.lineTo(w, -h);
      ctx.lineTo(w, h);
      break;

    case "am":
      // Glifo de Modulación en Amplitud (AM)
      ctx.font = "bold 9px 'JetBrains Mono', 'Fira Code', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = color;
      ctx.fillText("AM", 0, 0);
      break;
  }

  if (waveType !== "am") {
    ctx.stroke();
  }
  ctx.restore();
}

/** Dibuja los símbolos +/- estándar de una fuente DC */
function drawDcPolaritySymbols(
  ctx: CanvasRenderingContext2D,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  // Plus (+) near positive side
  ctx.moveTo(-11, 0);
  ctx.lineTo(-5, 0);
  ctx.moveTo(-8, -3);
  ctx.lineTo(-8, 3);
  // Minus (-) near negative side
  ctx.moveTo(5, 0);
  ctx.lineTo(11, 0);
  ctx.stroke();
}

export const VsourceDefinition: ComponentDefinition = {
  type: "vsource",
  name: "Fuente de Tensión",
  category: "analogicos",
  prefix: "V",
  defaultProperties: { value: 5 },
  halfExtents: { halfW: 40, halfH: 40 },
  getPins: () => STANDARD_TWO_PINS,
  render: (ctx, comp, state, options) => {
    if (options.detail === "compact") {
      drawCompactComponent(ctx, comp, state.color);
      return;
    }
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const wt = comp.waveType as string | undefined;
    if (wt && wt !== "dc") {
      drawWaveformGlyph(ctx, wt, state.color);
    } else {
      drawDcPolaritySymbols(ctx, state.color);
    }
  },
};

export const IsourceDefinition: ComponentDefinition = {
  type: "isource",
  name: "Fuente de Corriente",
  category: "analogicos",
  prefix: "I",
  defaultProperties: { value: 0.01 },
  halfExtents: { halfW: 40, halfH: 40 },
  getPins: () => STANDARD_TWO_PINS,
  render: (ctx, comp, state, options) => {
    if (options.detail === "compact") {
      drawCompactComponent(ctx, comp, state.color);
      return;
    }
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const wt = comp.waveType as string | undefined;
    if (wt && wt !== "dc") {
      drawWaveformGlyph(ctx, wt, state.color);
    } else {
      // Flecha de sentido de corriente
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.lineTo(10, 0);
      ctx.lineTo(4, -5);
      ctx.moveTo(10, 0);
      ctx.lineTo(4, 5);
      ctx.stroke();
    }
  },
};

