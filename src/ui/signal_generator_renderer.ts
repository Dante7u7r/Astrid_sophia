/**
 * SignalGeneratorRenderer — Renderizado Canvas 2D del Sintetizador de Ondas
 *
 * Traza la forma de onda generada en tiempo real con retícula fósforo,
 * guías de pico/offset y visualización analógica fluida a 60 FPS.
 */

import {
  evaluateSignalPoint,
  formatFrequency,
  formatVoltage,
  type SignalGeneratorParams,
  type WaveformMetrics,
} from "./signal_generator_model";

export interface RenderGeneratorOptions {
  width: number;
  height: number;
  params: SignalGeneratorParams;
  metrics: WaveformMetrics;
  phaseOffsetTime?: number; // Para animación fluida en vivo
}

export function drawSignalGeneratorPreview(
  ctx: CanvasRenderingContext2D,
  options: RenderGeneratorOptions,
): void {
  const { width, height, params, metrics, phaseOffsetTime = 0 } = options;

  // 1. Limpieza con fondo profundo de osciloscopio
  ctx.fillStyle = "#030508";
  ctx.fillRect(0, 0, width, height);

  if (width <= 10 || height <= 10) return;

  // 2. Cálculo de escala vertical (V/div) adaptativa
  const peakMagnitude = Math.max(0.5, Math.abs(params.offset) + Math.max(0.1, params.amplitude) * 1.35);
  // Escala en 6 divisiones verticales (3 arriba, 3 abajo)
  const voltsPerDiv = peakMagnitude / 3;
  const divHeight = height / 6;
  const centerY = height / 2;

  // 3. Dibujar retícula milimétrica
  ctx.strokeStyle = "rgba(79, 156, 249, 0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();

  // 8 divisiones horizontales
  const divWidth = width / 8;
  for (let i = 1; i < 8; i++) {
    const x = i * divWidth;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  // 6 divisiones verticales
  for (let j = 1; j < 6; j++) {
    const y = j * divHeight;
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();

  // Eje central (0V o Centro de Pantalla)
  const gndY = centerY + (params.offset !== 0 ? (params.offset / voltsPerDiv) * divHeight : 0);
  const clampedGndY = Math.max(12, Math.min(height - 12, gndY));

  ctx.strokeStyle = "rgba(102, 252, 241, 0.25)";
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Línea de referencia a Tierra real (0V) si difiere del centro
  if (Math.abs(params.offset) > 0.05) {
    ctx.strokeStyle = "rgba(234, 179, 8, 0.35)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(0, clampedGndY);
    ctx.lineTo(width, clampedGndY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Etiqueta 0V
    ctx.fillStyle = "#eab308";
    ctx.font = "600 9px monospace";
    ctx.fillText("0V", 6, clampedGndY - 3);
  }

  // 4. Si la salida está deshabilitada, trazar línea plana en 0V
  if (!params.enabled) {
    ctx.strokeStyle = "rgba(148, 163, 184, 0.4)";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, clampedGndY);
    ctx.lineTo(width, clampedGndY);
    ctx.stroke();

    // Badge de estado apagado
    ctx.fillStyle = "rgba(239, 68, 68, 0.15)";
    ctx.strokeStyle = "rgba(239, 68, 68, 0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(width / 2 - 60, height / 2 - 14, 120, 28, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#f87171";
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SALIDA EN ESPERA", width / 2, height / 2);
    return;
  }

  // 5. Trazar la señal sintetizada sobre 2.5 períodos visuales
  const f = Math.max(1e-5, params.frequency);
  const visualPeriods = 2.5;
  const timeWindow = visualPeriods / f;

  const pointsCount = Math.max(80, Math.min(500, Math.round(width * 1.2)));
  const dt = timeWindow / pointsCount;

  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 2.2;
  ctx.beginPath();

  for (let i = 0; i <= pointsCount; i++) {
    const t = phaseOffsetTime + i * dt;
    const v = evaluateSignalPoint(t, params);
    const x = (i / pointsCount) * width;
    // v = 0 -> centerY. v > 0 -> arriba (y < centerY).
    const y = centerY - (v / voltsPerDiv) * divHeight;

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // 6. Guías de Tensión Pico (+Vmax y -Vmin)
  const yMax = centerY - (metrics.vmax / voltsPerDiv) * divHeight;
  const yMin = centerY - (metrics.vmin / voltsPerDiv) * divHeight;

  if (yMax >= 8 && yMax <= height - 8) {
    ctx.strokeStyle = "rgba(56, 189, 248, 0.3)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(width - 65, yMax);
    ctx.lineTo(width, yMax);
    ctx.stroke();

    ctx.fillStyle = "rgba(56, 189, 248, 0.85)";
    ctx.font = "9px monospace";
    ctx.textAlign = "right";
    ctx.fillText(`+${formatVoltage(metrics.vmax)}`, width - 6, yMax - 3);
  }

  if (yMin >= 8 && yMin <= height - 8) {
    ctx.strokeStyle = "rgba(56, 189, 248, 0.3)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(width - 65, yMin);
    ctx.lineTo(width, yMin);
    ctx.stroke();

    ctx.fillStyle = "rgba(56, 189, 248, 0.85)";
    ctx.font = "9px monospace";
    ctx.textAlign = "right";
    ctx.fillText(`${formatVoltage(metrics.vmin)}`, width - 6, yMin + 10);
  }
  ctx.setLineDash([]);

  // 7. Mini HUD de Parámetros en la esquina superior izquierda
  ctx.fillStyle = "rgba(3, 5, 8, 0.75)";
  ctx.strokeStyle = "rgba(56, 189, 248, 0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(8, 8, 145, 46, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 10px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`f : ${formatFrequency(params.frequency)}`, 14, 14);

  ctx.fillStyle = "#e2e8f0";
  ctx.font = "9px monospace";
  ctx.fillText(`Vpp: ${formatVoltage(metrics.vpp)} | Vrms: ${formatVoltage(metrics.vrms)}`, 14, 27);
  ctx.fillText(`Offset: ${formatVoltage(params.offset)}`, 14, 39);
}
