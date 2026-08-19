/**
 * SensitivityPlotRenderer — Renderizado Gráfico Canvas 2D de Análisis de Sensibilidad y Peor Caso
 *
 * Muestra barras de impacto porcentual normalizado de cada componente (∂V/∂R o ∂I/∂R)
 * y clasifica los componentes en Críticos (>20%), Moderados (5-20%) y Tolerantes (<5%).
 */

import type { SensitivityAnalysisResult } from "../simulation/tauri_commands";

export function drawSensitivityPlot(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  result: SensitivityAnalysisResult | null,
): void {
  // Fondo
  ctx.fillStyle = "#070a14";
  ctx.fillRect(0, 0, width, height);

  const padLeft = 80;
  const padRight = 80;
  const padTop = 32;
  const padBottom = 28;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  if (plotWidth <= 20 || plotHeight <= 20) return;

  // Título
  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 10px 'JetBrains Mono', Consolas, monospace";
  ctx.textAlign = "left";
  ctx.fillText("ANÁLISIS DE SENSIBILIDAD NORMALIZADA (% DE IMPACTO RELATIVO)", padLeft, padTop - 12);

  if (!result || !result.sensitivities || result.sensitivities.length === 0) {
    ctx.fillStyle = "rgba(226, 232, 240, 0.4)";
    ctx.font = "10px 'JetBrains Mono', Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText("Sin datos de sensibilidad. Ejecuta un análisis de sensibilidad en el circuito.", width / 2, height / 2);
    return;
  }

  // Ordenar componentes por magnitud de sensibilidad descendente
  const entries = [...result.sensitivities].sort((a, b) => {
    const maxA = Math.max(...Object.values(a.normalizedSensitivities).map(Math.abs), 0);
    const maxB = Math.max(...Object.values(b.normalizedSensitivities).map(Math.abs), 0);
    return maxB - maxA;
  }).slice(0, 12); // Mostrar los 12 más influyentes

  // Encontrar el valor máximo absoluto para normalizar el ancho de barra
  let maxVal = 0.01;
  for (const entry of entries) {
    for (const val of Object.values(entry.normalizedSensitivities)) {
      if (Math.abs(val) > maxVal) maxVal = Math.abs(val);
    }
  }

  const rowHeight = Math.min(28, plotHeight / Math.max(1, entries.length));
  const midX = padLeft + plotWidth / 2;

  // Eje central de referencia (0%)
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(midX, padTop);
  ctx.lineTo(midX, padTop + plotHeight);
  ctx.stroke();

  // Dibujar barras para cada componente
  entries.forEach((entry, idx) => {
    const y = padTop + idx * rowHeight + 4;
    const barH = rowHeight - 8;

    // Tomar la primera sensibilidad nodal representativa
    const firstNode = Object.keys(entry.normalizedSensitivities)[0] || "";
    const sensVal = entry.normalizedSensitivities[firstNode] || 0;
    const pct = sensVal * 100;

    // Longitud de barra proporcional
    const barLen = (Math.abs(sensVal) / maxVal) * (plotWidth / 2 - 20);

    // Color por criticidad
    const absSens = Math.abs(sensVal);
    const color = absSens > 0.20 ? "#f87171" : absSens > 0.05 ? "#f59e0b" : "#38bdf8";

    // Etiqueta del componente
    ctx.fillStyle = "#fff";
    ctx.font = "bold 9px 'JetBrains Mono', Consolas, monospace";
    ctx.textAlign = "right";
    ctx.fillText(entry.componentId, midX - (sensVal < 0 ? barLen + 8 : 8), y + barH / 2 + 3);

    // Barra
    ctx.fillStyle = color;
    if (sensVal >= 0) {
      ctx.fillRect(midX, y, barLen, barH);
    } else {
      ctx.fillRect(midX - barLen, y, barLen, barH);
    }

    // Valor en porcentaje
    ctx.fillStyle = color;
    ctx.font = "8px 'JetBrains Mono', Consolas, monospace";
    ctx.textAlign = sensVal >= 0 ? "left" : "right";
    const xText = sensVal >= 0 ? midX + barLen + 6 : midX - barLen - 6;
    ctx.fillText(`${sensVal >= 0 ? "+" : ""}${pct.toFixed(2)}%`, xText, y + barH / 2 + 3);
  });
}
