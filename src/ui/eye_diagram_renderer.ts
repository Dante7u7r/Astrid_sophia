/**
 * EyeDiagramRenderer — Renderizado Canvas 2D de Diagrama de Ojo y Análisis de Jitter
 *
 * Traza la cuadrícula calibrada en Intervalos Unitarios (UI) y Voltios (V),
 * el plegado multicapa fosforescente de trazas transitorias, la máscara de cumplimiento
 * central y las lecturas HUD de apertura y jitter.
 */

import type { EyeDiagramResult, EyeMaskDefinition } from "../simulation/eye_diagram_model";
import { formatSpiceValue } from "../simulation/spice_value_parser";

export interface EyeRenderOptions {
  width: number;
  height: number;
  result: EyeDiagramResult | null;
  showMask?: boolean;
  mask?: EyeMaskDefinition;
  showSamplingPoint?: boolean;
  colorScheme?: "cyan_phosphor" | "fire_heatmap" | "green_matrix";
}

const COLOR_SCHEMES = {
  cyan_phosphor: {
    stroke: "rgba(102, 252, 241, 0.45)",
    glow: "#66fcf1",
    centerMarker: "#a855f7",
  },
  fire_heatmap: {
    stroke: "rgba(249, 115, 22, 0.45)",
    glow: "#f97316",
    centerMarker: "#eab308",
  },
  green_matrix: {
    stroke: "rgba(34, 197, 94, 0.45)",
    glow: "#22c55e",
    centerMarker: "#66fcf1",
  },
};

export function drawEyeDiagram(
  ctx: CanvasRenderingContext2D,
  options: EyeRenderOptions,
): void {
  const {
    width,
    height,
    result,
    showMask = true,
    mask,
    showSamplingPoint = true,
    colorScheme = "cyan_phosphor",
  } = options;

  // 1. Limpieza de pantalla
  ctx.fillStyle = "#030508";
  ctx.fillRect(0, 0, width, height);

  if (width <= 60 || height <= 60) return;

  const leftMargin = 55;
  const rightMargin = 15;
  const topMargin = 28;
  const bottomMargin = 32;

  const plotW = width - leftMargin - rightMargin;
  const plotH = height - topMargin - bottomMargin;

  // 2. Fondo del Área de Trazado
  ctx.fillStyle = "rgba(4, 9, 20, 0.95)";
  ctx.fillRect(leftMargin, topMargin, plotW, plotH);

  // 3. Cuadrícula Reticular de Intervalos Unitarios (UI)
  // Mostramos 2 UI = 8 divisiones horizontales (0.25 UI por división) y 6 divisiones verticales
  const numDivsX = 8;
  const numDivsY = 6;

  ctx.strokeStyle = "rgba(79, 156, 249, 0.12)";
  ctx.lineWidth = 1;

  for (let d = 0; d <= numDivsX; d++) {
    const x = leftMargin + (d * plotW) / numDivsX;
    ctx.beginPath();
    ctx.moveTo(x, topMargin);
    ctx.lineTo(x, topMargin + plotH);
    ctx.stroke();
  }

  for (let d = 0; d <= numDivsY; d++) {
    const y = topMargin + (d * plotH) / numDivsY;
    ctx.beginPath();
    ctx.moveTo(leftMargin, y);
    ctx.lineTo(leftMargin + plotW, y);
    ctx.stroke();
  }

  if (!result || result.slices.length === 0) {
    ctx.fillStyle = "#64748b";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Sin datos de señal para Diagrama de Ojo. Ejecuta una simulación con reloj/datos.", width / 2, height / 2);
    return;
  }

  const { vMin, vMax, unitInterval, slices } = result;
  const vRange = Math.max(1e-6, vMax - vMin);
  const uiSpan = 2; // 2 UI span
  const totalDuration = uiSpan * unitInterval;

  const scheme = COLOR_SCHEMES[colorScheme] ?? COLOR_SCHEMES.cyan_phosphor;

  // 4. Trazado de las trazas plegadas (Eye Slices)
  ctx.save();
  ctx.beginPath();
  ctx.rect(leftMargin, topMargin, plotW, plotH);
  ctx.clip();

  ctx.strokeStyle = scheme.stroke;
  ctx.lineWidth = 1.4;
  ctx.shadowColor = scheme.glow;
  ctx.shadowBlur = 2;

  for (const slice of slices) {
    const pts = slice.points;
    if (pts.length < 2) continue;

    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const xNorm = pts[i].tRel / totalDuration;
      const yNorm = (pts[i].voltage - vMin) / vRange;

      const px = leftMargin + xNorm * plotW;
      const py = topMargin + (1 - yNorm) * plotH;

      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  // 5. Renderizar Máscara de Ojo (Eye Mask Testing)
  if (showMask && mask) {
    ctx.fillStyle = "rgba(239, 68, 68, 0.18)";
    ctx.strokeStyle = "rgba(239, 68, 68, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    const poly = mask.centralPolygon;
    for (let i = 0; i < poly.length; i++) {
      const [tNormUi, vNorm] = poly[i];
      const px = leftMargin + (tNormUi / uiSpan) * plotW;
      const py = topMargin + (1 - vNorm) * plotH;

      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // 6. Marcador de Punto Óptimo de Muestreo (1.0 UI en el centro)
  if (showSamplingPoint) {
    const sampleX = leftMargin + (1.0 / uiSpan) * plotW;
    ctx.strokeStyle = scheme.centerMarker;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(sampleX, topMargin);
    ctx.lineTo(sampleX, topMargin + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();

  // 7. Etiquetas de Ejes
  ctx.fillStyle = "#94a3b8";
  ctx.font = "10px monospace";

  // Eje X: UI (0.0 UI .. 2.0 UI)
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let d = 0; d <= 4; d++) {
    const uiVal = (d * 0.5).toFixed(1);
    const x = leftMargin + (d / 4) * plotW;
    ctx.fillText(`${uiVal} UI`, x, topMargin + plotH + 6);
  }

  // Eje Y: Voltajes
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let d = 0; d <= numDivsY; d++) {
    const vVal = vMin + (1 - d / numDivsY) * vRange;
    const y = topMargin + (d * plotH) / numDivsY;
    ctx.fillText(`${vVal.toFixed(2)}V`, leftMargin - 6, y);
  }

  // 8. HUD Header de Métricas Principales
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(
    `OJO V(${result.node}) | Bitrate: ${formatSpiceValue(result.baudRate)}bps | Altura: ${formatSpiceValue(result.eyeHeight)}V | Ancho: ${(result.eyeWidthUi * 100).toFixed(1)}% UI | TIE RMS: ${formatSpiceValue(result.jitter.tieRms)}s`,
    leftMargin,
    8,
  );
}

export interface JitterHistogramOptions {
  width: number;
  height: number;
  samples: readonly number[];
  title?: string;
  unit?: string;
}

export function drawJitterHistogram(
  ctx: CanvasRenderingContext2D,
  options: JitterHistogramOptions,
): void {
  const { width, height, samples, title = "Histograma de Jitter TIE", unit = "s" } = options;

  ctx.fillStyle = "#030508";
  ctx.fillRect(0, 0, width, height);

  if (samples.length < 4 || width <= 40 || height <= 40) return;

  const left = 45;
  const right = 15;
  const top = 25;
  const bottom = 25;
  const plotW = width - left - right;
  const plotH = height - top - bottom;

  let min = Infinity;
  let max = -Infinity;
  for (const s of samples) {
    if (s < min) min = s;
    if (s > max) max = s;
  }
  const range = Math.max(1e-15, max - min);

  // Crear 30 bins
  const binCount = 30;
  const bins = new Uint32Array(binCount);
  for (const s of samples) {
    const b = Math.min(binCount - 1, Math.floor(((s - min) / range) * binCount));
    bins[b]++;
  }

  let maxBin = 0;
  for (let i = 0; i < binCount; i++) {
    if (bins[i] > maxBin) maxBin = bins[i];
  }
  if (maxBin === 0) maxBin = 1;

  // Dibujar barras del histograma
  const barW = plotW / binCount;
  ctx.fillStyle = "rgba(102, 252, 241, 0.75)";
  ctx.strokeStyle = "#66fcf1";
  ctx.lineWidth = 1;

  for (let i = 0; i < binCount; i++) {
    const h = (bins[i] / maxBin) * plotH;
    const x = left + i * barW;
    const y = top + plotH - h;
    ctx.fillRect(x, y, barW - 1, h);
  }

  // Título
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`${title} (${samples.length} muestras) [${formatSpiceValue(min)}${unit} .. ${formatSpiceValue(max)}${unit}]`, left, 6);
}
