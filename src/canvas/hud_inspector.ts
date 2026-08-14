import type { PinInstance, WireInstance } from "../canvas_orchestrator";
import { calculateWireMidpoint } from "./wiring_model";

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
 * Dibuja un HUD de telemetría flotante para un Pin/Nodo.
 */
export function renderPinTelemetryHud(
  ctx: CanvasRenderingContext2D,
  pin: PinInstance,
  nodeId: string,
  voltage: number | undefined,
  current: number | undefined,
): void {
  const nodeTitle = nodeId === "0" ? "Nodo 0 (GND)" : `Nodo ${nodeId}`;
  const voltText = `V: ${formatEngineeringValue(voltage, "V")}`;
  const currText = `I: ${formatEngineeringValue(current, "A")}`;

  const lines = [
    { text: nodeTitle, color: "#38BDF8", font: "bold 9px var(--font-sans)" },
    { text: voltText, color: "#E6EAF0", font: "600 9px var(--font-mono)" },
    { text: currText, color: "#F2C94C", font: "600 9px var(--font-mono)" },
  ];

  renderHudBox(ctx, pin.x, pin.y - 12, lines, "bottom");
}

/**
 * Dibuja un HUD de telemetría flotante para un Cable (Pista / Wire).
 */
export function renderWireTelemetryHud(
  ctx: CanvasRenderingContext2D,
  wire: WireInstance,
  voltage: number | undefined,
  current: number | undefined,
): void {
  const mid = calculateWireMidpoint(wire.points);
  if (!mid) return;

  const arrow = current !== undefined && Math.abs(current) > 1e-7
    ? (current >= 0 ? " ➔" : " ⬅")
    : "";

  const voltText = `V: ${formatEngineeringValue(voltage, "V")}`;
  const currText = `I: ${formatEngineeringValue(Math.abs(current ?? 0), "A")}${arrow}`;

  const lines = [
    { text: wire.label ? `Red: ${wire.label}` : "Pista Conductora", color: "#38BDF8", font: "bold 9px var(--font-sans)" },
    { text: voltText, color: "#E6EAF0", font: "600 9px var(--font-mono)" },
    { text: currText, color: "#F2C94C", font: "600 9px var(--font-mono)" },
  ];

  renderHudBox(ctx, mid.x, mid.y - 10, lines, "bottom");
}

function renderHudBox(
  ctx: CanvasRenderingContext2D,
  anchorX: number,
  anchorY: number,
  lines: { text: string; color: string; font: string }[],
  placement: "bottom" | "top" = "bottom",
): void {
  ctx.save();

  const lineHeight = 13;
  const paddingX = 9;
  const paddingY = 6;

  let maxWidth = 0;
  for (const line of lines) {
    ctx.font = line.font;
    const w = ctx.measureText(line.text).width;
    if (w > maxWidth) maxWidth = w;
  }

  const boxW = Math.max(maxWidth + paddingX * 2, 75);
  const boxH = lines.length * lineHeight + paddingY * 2;
  const boxX = anchorX - boxW / 2;
  const boxY = placement === "bottom" ? anchorY - boxH : anchorY;

  // Fondo glassmorphism oscuro CAD
  ctx.fillStyle = "rgba(29, 36, 44, 0.96)";
  ctx.strokeStyle = "#38434F";
  ctx.lineWidth = 1;
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = 8;

  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, 5);
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.textAlign = "left";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    ctx.font = line.font;
    ctx.fillStyle = line.color;
    ctx.fillText(line.text, boxX + paddingX, boxY + paddingY + (i + 0.75) * lineHeight);
  }

  ctx.restore();
}
