import type { PinInstance, WireInstance } from "../canvas_orchestrator";
import { calculateWireMidpoint } from "./wiring_model";
import { getInstrumentThemeColors } from "../ui/instrument_theme";

export interface TelemetryHistorySample {
  readonly time?: number;
  readonly nodeVoltages?: Readonly<Record<string, number>>;
  readonly branchCurrents?: Readonly<Record<string, number>>;
}

/**
 * Formatea un valor numérico con prefijos de ingeniería estándar (p, n, µ, m, k, M, G).
 */
export function formatEngineeringValue(val: number | undefined, unit: string): string {
  if (val === undefined || !Number.isFinite(val)) {
    return `-- ${unit}`;
  }

  const abs = Math.abs(val);
  if (abs === 0 || abs < 1e-12) {
    return `0.000 ${unit}`;
  }

  const sign = val < 0 ? "-" : "";

  if (abs >= 1e6) {
    return `${sign}${(abs / 1e6).toFixed(3)} M${unit}`;
  }
  if (abs >= 1e3) {
    return `${sign}${(abs / 1e3).toFixed(3)} k${unit}`;
  }
  if (abs >= 1) {
    return `${sign}${abs.toFixed(3)} ${unit}`;
  }
  if (abs >= 1e-3) {
    return `${sign}${(abs * 1e3).toFixed(3)} m${unit}`;
  }
  if (abs >= 1e-6) {
    return `${sign}${(abs * 1e6).toFixed(3)} µ${unit}`;
  }
  if (abs >= 1e-9) {
    return `${sign}${(abs * 1e9).toFixed(3)} n${unit}`;
  }
  return `${sign}${(abs * 1e12).toFixed(3)} p${unit}`;
}

/**
 * Extrae puntos recientes de una serie temporal para graficar un mini-osciloscopio sparkline.
 */
export function extractSparklinePoints(
  history: readonly TelemetryHistorySample[] | undefined,
  key: string,
  isCurrent = false,
  maxPoints = 40,
): number[] {
  if (!history || history.length === 0) return [];
  const start = Math.max(0, history.length - maxPoints);
  const points: number[] = [];
  for (let i = start; i < history.length; i++) {
    const s = history[i];
    const map = isCurrent ? s.branchCurrents : s.nodeVoltages;
    const v = map?.[key];
    if (v !== undefined && Number.isFinite(v)) {
      points.push(v);
    }
  }
  return points;
}

/**
 * Dibuja un mini osciloscopio vectorial (Sparkline Scope) de alta resolución.
 */
export function drawSparkline(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  points: readonly number[],
  strokeColor?: string,
): void {
  if (points.length < 2) return;

  const theme = getInstrumentThemeColors();
  const effectiveStroke = strokeColor ?? (theme.isClassroom ? "#0284C7" : "#38BDF8");

  let min = points[0];
  let max = points[0];
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p < min) min = p;
    if (p > max) max = p;
  }

  ctx.save();

  // Mini pantalla de osciloscopio adaptada al tema
  ctx.fillStyle = theme.isClassroom ? "#F8FAFC" : "rgba(10, 15, 26, 0.90)";
  ctx.strokeStyle = theme.isClassroom ? "rgba(2, 132, 199, 0.35)" : "rgba(56, 189, 248, 0.30)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 3);
  ctx.fill();
  ctx.stroke();

  // Retícula central
  ctx.strokeStyle = theme.isClassroom ? "rgba(2, 132, 199, 0.12)" : "rgba(255, 255, 255, 0.08)";
  ctx.beginPath();
  ctx.moveTo(x, y + height / 2);
  ctx.lineTo(x + width, y + height / 2);
  ctx.moveTo(x + width / 2, y);
  ctx.lineTo(x + width / 2, y + height);
  ctx.stroke();

  const span = max - min;
  const paddingY = 3;
  const plotH = Math.max(height - paddingY * 2, 2);
  const plotY = y + paddingY;

  // Línea de referencia 0V si la señal cruza por cero
  if (min < 0 && max > 0 && span > 1e-9) {
    const zeroY = plotY + plotH * (1 - (0 - min) / span);
    ctx.strokeStyle = theme.isClassroom ? "rgba(100, 116, 139, 0.5)" : "rgba(148, 163, 184, 0.4)";
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(x, zeroY);
    ctx.lineTo(x + width, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Trazo vectorial de la forma de onda
  ctx.beginPath();
  const stepX = width / (points.length - 1);
  for (let i = 0; i < points.length; i++) {
    const ptX = x + i * stepX;
    const normY = span < 1e-9 ? 0.5 : (points[i] - min) / span;
    const ptY = plotY + plotH * (1 - normY);
    if (i === 0) ctx.moveTo(ptX, ptY);
    else ctx.lineTo(ptX, ptY);
  }

  ctx.strokeStyle = effectiveStroke;
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // Indicador de amplitud pico a pico (Vpp / Ipp)
  ctx.font = "6px 'JetBrains Mono', monospace";
  ctx.fillStyle = theme.isClassroom ? "rgba(51, 65, 85, 0.85)" : "rgba(226, 232, 240, 0.75)";
  ctx.textAlign = "right";
  const ppLabel = span >= 1 ? `${span.toFixed(2)}V` : `${(span * 1000).toFixed(0)}mV`;
  ctx.fillText(ppLabel, x + width - 3, y + 8);

  ctx.restore();
}

/**
 * Dibuja un HUD de telemetría flotante para un Pin/Nodo con Mini-Osciloscopio integrado.
 */
export function renderPinTelemetryHud(
  ctx: CanvasRenderingContext2D,
  pin: PinInstance,
  nodeId: string,
  voltage: number | undefined,
  current: number | undefined,
  history?: readonly TelemetryHistorySample[],
): void {
  const theme = getInstrumentThemeColors();
  const pinDescriptor = pin.name ? ` [${pin.name}]` : (pin.label ? ` [${pin.label}]` : "");
  const pinHeader = `${pin.componentId}${pinDescriptor}`;
  const nodeTitle = nodeId === "0" ? `${pinHeader} ➔ GND (0V)` : `${pinHeader} ➔ Nodo ${nodeId}`;
  const voltText = `V: ${formatEngineeringValue(voltage, "V")}`;
  const currText = `I: ${formatEngineeringValue(current, "A")}`;

  const headerColor = theme.isClassroom ? "#0284C7" : "#38BDF8";
  const voltColor = theme.isClassroom ? "#0F172A" : "#E6EAF0";
  const currColor = theme.isClassroom ? "#B45309" : "#F2C94C";

  const lines = [
    { text: nodeTitle, color: headerColor, font: "bold 9px 'Inter', sans-serif" },
    { text: voltText, color: voltColor, font: "600 9px 'JetBrains Mono', monospace" },
    { text: currText, color: currColor, font: "600 9px 'JetBrains Mono', monospace" },
  ];

  const sparkPoints = extractSparklinePoints(history, nodeId, false, 35);
  const sparkline = sparkPoints.length >= 2 ? { points: sparkPoints, color: headerColor } : undefined;

  renderHudBox(ctx, pin.x, pin.y - 12, lines, "bottom", sparkline);
}

/**
 * Dibuja un HUD de telemetría flotante para un Cable con Mini-Osciloscopio integrado.
 */
export function renderWireTelemetryHud(
  ctx: CanvasRenderingContext2D,
  wire: WireInstance,
  voltage: number | undefined,
  current: number | undefined,
  nodeId?: string,
  history?: readonly TelemetryHistorySample[],
): void {
  const mid = calculateWireMidpoint(wire.points);
  if (!mid) return;

  const theme = getInstrumentThemeColors();
  const arrow = current !== undefined && Math.abs(current) > 1e-7
    ? (current >= 0 ? " ➔" : " ⬅")
    : "";

  const voltText = `V: ${formatEngineeringValue(voltage, "V")}`;
  const currText = `I: ${formatEngineeringValue(Math.abs(current ?? 0), "A")}${arrow}`;

  const headerColor = theme.isClassroom ? "#0284C7" : "#38BDF8";
  const voltColor = theme.isClassroom ? "#0F172A" : "#E6EAF0";
  const currColor = theme.isClassroom ? "#B45309" : "#F2C94C";

  const lines = [
    { text: wire.label ? `Red: ${wire.label}` : "Pista Conductora", color: headerColor, font: "bold 9px 'Inter', sans-serif" },
    { text: voltText, color: voltColor, font: "600 9px 'JetBrains Mono', monospace" },
    { text: currText, color: currColor, font: "600 9px 'JetBrains Mono', monospace" },
  ];

  const lookupKey = nodeId || `${wire.from.componentId}:${wire.from.pinIndex}`;
  const sparkPoints = extractSparklinePoints(history, lookupKey, false, 35);
  const sparkline = sparkPoints.length >= 2 ? { points: sparkPoints, color: headerColor } : undefined;

  renderHudBox(ctx, mid.x, mid.y - 10, lines, "bottom", sparkline);
}

function renderHudBox(
  ctx: CanvasRenderingContext2D,
  anchorX: number,
  anchorY: number,
  lines: { text: string; color: string; font: string }[],
  placement: "bottom" | "top" = "bottom",
  sparkline?: { points: readonly number[]; color: string },
): void {
  const theme = getInstrumentThemeColors();
  ctx.save();

  const lineHeight = 13;
  const paddingX = 9;
  const paddingY = 6;
  const hasSpark = Boolean(sparkline && sparkline.points.length >= 2);
  const sparkHeight = hasSpark ? 26 : 0;
  const sparkMarginTop = hasSpark ? 5 : 0;

  let maxWidth = 0;
  for (const line of lines) {
    ctx.font = line.font;
    const w = ctx.measureText(line.text).width;
    if (w > maxWidth) maxWidth = w;
  }

  const minBoxWidth = hasSpark ? 105 : 75;
  const boxW = Math.max(maxWidth + paddingX * 2, minBoxWidth);
  const boxH = lines.length * lineHeight + paddingY * 2 + sparkHeight + sparkMarginTop;
  const boxX = anchorX - boxW / 2;
  const boxY = placement === "bottom" ? anchorY - boxH : anchorY;

  // Fondo adaptativo de alto contraste
  ctx.fillStyle = theme.isClassroom ? "rgba(255, 255, 255, 0.96)" : "rgba(15, 23, 42, 0.96)";
  ctx.strokeStyle = theme.isClassroom ? "#CBD5E1" : "#334155";
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, 6);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = "left";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    ctx.font = line.font;
    ctx.fillStyle = line.color;
    ctx.fillText(line.text, boxX + paddingX, boxY + paddingY + (i + 0.75) * lineHeight);
  }

  if (hasSpark && sparkline) {
    const sparkX = boxX + paddingX;
    const sparkY = boxY + paddingY + lines.length * lineHeight + sparkMarginTop;
    const sparkW = boxW - paddingX * 2;
    drawSparkline(ctx, sparkX, sparkY, sparkW, sparkHeight, sparkline.points, sparkline.color);
  }

  ctx.restore();
}
