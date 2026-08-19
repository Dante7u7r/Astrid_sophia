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
    // Main triangle
    ctx.moveTo(-25, -30);
    ctx.lineTo(-25, 30);
    ctx.lineTo(25, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Input/output terminals
    ctx.beginPath();
    ctx.moveTo(-40, -15);
    ctx.lineTo(-25, -15);
    ctx.moveTo(-40, 15);
    ctx.lineTo(-25, 15);
    ctx.moveTo(25, 0);
    ctx.lineTo(40, 0);

    // Power supply terminals
    ctx.moveTo(0, -40);
    ctx.lineTo(0, -15);
    ctx.moveTo(0, 40);
    ctx.lineTo(0, 15);
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

