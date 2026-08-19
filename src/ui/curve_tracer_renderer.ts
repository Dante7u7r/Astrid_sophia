/**
 * CurveTracerRenderer — Renderizado Gráfico Canvas 2D del Trazador de Curvas I-V
 *
 * Traza la cuadrícula reticular de laboratorio XY, la familia de curvas paramétricas
 * con codificación cromática neón, etiquetas de pasos (Ib/Vgs) y el cursor de punto de trabajo Q.
 */

import type { TraceResult } from "./curve_tracer_model";

export interface CurveTracerRenderOptions {
  width: number;
  height: number;
  result: TraceResult | null;
  qPoint?: { v: number; i: number } | null; // Punto de operación Q interactivo
  showTangent?: boolean;
}

export function drawCurveTracer(
  ctx: CanvasRenderingContext2D,
  options: CurveTracerRenderOptions,
): void {
  const { width, height, result, qPoint = null, showTangent = true } = options;

  // 1. Limpieza de fondo
  ctx.fillStyle = "#030508";
  ctx.fillRect(0, 0, width, height);

  if (width <= 40 || height <= 40) return;

  const leftMargin = 52;
  const rightMargin = 16;
  const topMargin = 24;
  const bottomMargin = 28;

  const plotW = width - leftMargin - rightMargin;
  const plotH = height - topMargin - bottomMargin;

  // 2. Fondo del Área de Gráfica
  ctx.fillStyle = "rgba(4, 9, 20, 0.95)";
  ctx.fillRect(leftMargin, topMargin, plotW, plotH);

  if (!result || result.traces.length === 0) {
    ctx.strokeStyle = "rgba(79, 156, 249, 0.12)";
    ctx.lineWidth = 1;
    // Cuadrícula vacía
    for (let d = 0; d <= 10; d++) {
      const x = leftMargin + (d * plotW) / 10;
      ctx.beginPath();
      ctx.moveTo(x, topMargin);
      ctx.lineTo(x, topMargin + plotH);
      ctx.stroke();
    }
    for (let d = 0; d <= 8; d++) {
      const y = topMargin + (d * plotH) / 8;
      ctx.beginPath();
      ctx.moveTo(leftMargin, y);
      ctx.lineTo(leftMargin + plotW, y);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(79, 156, 249, 0.35)";
    ctx.strokeRect(leftMargin, topMargin, plotW, plotH);

    ctx.fillStyle = "rgba(148, 163, 184, 0.4)";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Selecciona un semiconductor y pulsa 'Ejecutar Trazado I-V'", leftMargin + plotW / 2, topMargin + plotH / 2);
    return;
  }

  const { vMin, vMax, iMin, iMax } = result;
  const vSpan = Math.max(1e-6, vMax - vMin);
  const iSpan = Math.max(1e-6, iMax - iMin);

  const valToX = (v: number) => leftMargin + ((v - vMin) / vSpan) * plotW;
  const valToY = (i: number) => topMargin + plotH - ((i - iMin) / iSpan) * plotH;

  // 3. Cuadrícula Reticular de Laboratorio (10 Divs Horizontales, 8 Divs Verticales)
  const numDivsX = 10;
  const numDivsY = 8;

  ctx.strokeStyle = "rgba(79, 156, 249, 0.12)";
  ctx.lineWidth = 1;

  for (let d = 0; d <= numDivsX; d++) {
    const x = leftMargin + (d * plotW) / numDivsX;
    ctx.beginPath();
    ctx.moveTo(x, topMargin);
    ctx.lineTo(x, topMargin + plotH);
    ctx.stroke();

    // Etiquetas eje X (Tensión)
    const vVal = vMin + (d * vSpan) / numDivsX;
    const vStr = Math.abs(vVal) >= 1 ? `${vVal.toFixed(1)}V` : `${(vVal * 1e3).toFixed(0)}mV`;
    ctx.fillStyle = "rgba(148, 163, 184, 0.75)";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(vStr, x, topMargin + plotH + 5);
  }

  for (let d = 0; d <= numDivsY; d++) {
    const y = topMargin + (d * plotH) / numDivsY;
    ctx.beginPath();
    ctx.moveTo(leftMargin, y);
    ctx.lineTo(leftMargin + plotW, y);
    ctx.stroke();

    // Etiquetas eje Y (Corriente)
    const iVal = iMax - (d * iSpan) / numDivsY;
    const iStr =
      Math.abs(iVal) >= 1.0 ? `${iVal.toFixed(2)}A` :
      Math.abs(iVal) >= 1e-3 ? `${(iVal * 1e3).toFixed(1)}mA` :
      `${(iVal * 1e6).toFixed(0)}µA`;
    ctx.fillStyle = "rgba(148, 163, 184, 0.75)";
    ctx.font = "9px monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(iStr, leftMargin - 4, y);
  }

  // Ejes centrales (si cruzan por cero)
  ctx.strokeStyle = "rgba(79, 156, 249, 0.4)";
  ctx.lineWidth = 1.5;
  if (vMin < 0 && vMax > 0) {
    const zeroX = valToX(0);
    ctx.beginPath();
    ctx.moveTo(zeroX, topMargin);
    ctx.lineTo(zeroX, topMargin + plotH);
    ctx.stroke();
  }
  if (iMin < 0 && iMax > 0) {
    const zeroY = valToY(0);
    ctx.beginPath();
    ctx.moveTo(leftMargin, zeroY);
    ctx.lineTo(leftMargin + plotW, zeroY);
    ctx.stroke();
  }

  // Marco exterior
  ctx.strokeStyle = "rgba(79, 156, 249, 0.45)";
  ctx.strokeRect(leftMargin, topMargin, plotW, plotH);

  // Encabezado
  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(`DISPOSITIVO: ${result.deviceName} | MODO: ${result.mode.toUpperCase()}`, leftMargin, topMargin / 2);

  // 4. Trazado de Familia de Curvas
  for (const trace of result.traces) {
    if (trace.points.length < 2) continue;

    ctx.strokeStyle = trace.color;
    ctx.lineWidth = 2.0;
    ctx.shadowColor = trace.color;
    ctx.shadowBlur = 4;
    ctx.beginPath();

    for (let ptIdx = 0; ptIdx < trace.points.length; ptIdx++) {
      const pt = trace.points[ptIdx];
      const x = valToX(pt.v);
      const y = Math.max(topMargin, Math.min(topMargin + plotH, valToY(pt.i)));

      if (ptIdx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";

    // Etiqueta del paso en el extremo final de la curva
    if (result.traces.length > 1) {
      const lastPt = trace.points[trace.points.length - 1];
      const tagX = Math.min(leftMargin + plotW - 4, Math.max(leftMargin + 4, valToX(lastPt.v)));
      const tagY = Math.max(topMargin + 6, Math.min(topMargin + plotH - 6, valToY(lastPt.i)));

      ctx.fillStyle = trace.color;
      ctx.font = "bold 8px monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(trace.stepLabel, tagX, tagY - 6);
    }
  }

  // 5. Cursor de Punto de Operación Q interactivo (si está presente)
  if (qPoint) {
    const qX = valToX(qPoint.v);
    const qY = valToY(qPoint.i);

    if (qX >= leftMargin && qX <= leftMargin + plotW && qY >= topMargin && qY <= topMargin + plotH) {
      // Líneas cruzadas de proyección
      ctx.strokeStyle = "#eab308";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(qX, topMargin);
      ctx.lineTo(qX, topMargin + plotH);
      ctx.moveTo(leftMargin, qY);
      ctx.lineTo(leftMargin + plotW, qY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Punto Q
      ctx.fillStyle = "#eab308";
      ctx.beginPath();
      ctx.arc(qX, qY, 4, 0, Math.PI * 2);
      ctx.fill();

      // Tangente de resistencia dinámica o transconductancia
      if (showTangent && result.traces[0]?.points.length > 2) {
        ctx.strokeStyle = "rgba(234, 179, 8, 0.6)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(qX - 25, qY + 15);
        ctx.lineTo(qX + 25, qY - 15);
        ctx.stroke();
      }

      // Etiqueta HUD de Q
      const vQStr = Math.abs(qPoint.v) >= 1 ? `${qPoint.v.toFixed(2)}V` : `${(qPoint.v * 1e3).toFixed(1)}mV`;
      const iQStr =
        Math.abs(qPoint.i) >= 1.0 ? `${qPoint.i.toFixed(3)}A` :
        Math.abs(qPoint.i) >= 1e-3 ? `${(qPoint.i * 1e3).toFixed(2)}mA` :
        `${(qPoint.i * 1e6).toFixed(1)}µA`;
      const qBadge = `Punto Q: (${vQStr}, ${iQStr})`;

      ctx.font = "bold 8px monospace";
      const qW = ctx.measureText(qBadge).width;
      const bX = Math.max(leftMargin + qW / 2 + 4, Math.min(leftMargin + plotW - qW / 2 - 4, qX));

      ctx.fillStyle = "rgba(3, 5, 8, 0.9)";
      ctx.strokeStyle = "#eab308";
      ctx.lineWidth = 1;
      ctx.fillRect(bX - qW / 2 - 4, qY - 18, qW + 8, 14);
      ctx.strokeRect(bX - qW / 2 - 4, qY - 18, qW + 8, 14);

      ctx.fillStyle = "#eab308";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(qBadge, bX, qY - 11);
    }
  }
}
