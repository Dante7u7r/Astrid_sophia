/**
 * BodePlotRenderer — Renderizado Gráfico Canvas 2D del Diagrama de Bode
 *
 * Dibuja la retícula semilogarítmica de frecuencia, las curvas de Ganancia (dB)
 * y Fase (grados), marcadores de fc (-3 dB), cursores F1/F2 y leyendas de estabilidad.
 */

import type { BodeDataSet } from "./bode_plot_model";
import { getInstrumentThemeColors } from "./instrument_theme";

export interface BodeRenderOptions {
  readonly fMin?: number;
  readonly fMax?: number;
  readonly dbMin?: number;
  readonly dbMax?: number;
  readonly phaseMin?: number;
  readonly phaseMax?: number;
  readonly isCursorsEnabled?: boolean;
  readonly cursorF1?: number | null;
  readonly cursorF2?: number | null;
  readonly hoveredPoint?: { freq: number; magDb: number; phaseDeg: number } | null;
}

export function drawBodePlot(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dataSet: BodeDataSet | null,
  options: BodeRenderOptions = {},
): void {
  const theme = getInstrumentThemeColors();

  // Fondo de laboratorio / aula
  ctx.fillStyle = theme.screenBg;
  ctx.fillRect(0, 0, width, height);

  const padLeft = 55;
  const padRight = 55;
  const padTop = 24;
  const padBottom = 28;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  if (plotWidth <= 20 || plotHeight <= 20) return;

  // División del viewport: 50% Superior para Magnitud, 50% Inferior para Fase
  const magHeight = Math.floor(plotHeight * 0.52);
  const phaseTop = padTop + magHeight + 14;
  const phaseHeight = plotHeight - magHeight - 14;

  // Rangos de frecuencia (Log10)
  const pts = dataSet?.points ?? [];
  let fMin = options.fMin ?? 1;
  let fMax = options.fMax ?? 1e6;
  if (pts.length > 1) {
    fMin = Math.max(1e-3, pts[0].freq);
    fMax = Math.max(fMin * 10, pts[pts.length - 1].freq);
  }
  const logFMin = Math.log10(fMin);
  const logFMax = Math.log10(fMax);
  const logFRange = Math.max(0.1, logFMax - logFMin);

  // Rangos de Magnitud y Fase
  const dbMin = options.dbMin ?? -80;
  const dbMax = options.dbMax ?? 40;
  const dbRange = dbMax - dbMin;

  const phaseMin = options.phaseMin ?? -200;
  const phaseMax = options.phaseMax ?? 50;
  const phaseRange = phaseMax - phaseMin;

  // Funciones de Transformación de Coordenadas
  const freqToX = (f: number): number => {
    const logF = Math.log10(Math.max(1e-12, f));
    return padLeft + ((logF - logFMin) / logFRange) * plotWidth;
  };

  const dbToY = (db: number): number => {
    const clamped = Math.max(dbMin, Math.min(dbMax, db));
    return padTop + (1 - (clamped - dbMin) / dbRange) * magHeight;
  };

  const phaseToY = (ph: number): number => {
    const clamped = Math.max(phaseMin, Math.min(phaseMax, ph));
    return phaseTop + (1 - (clamped - phaseMin) / phaseRange) * phaseHeight;
  };

  // 1. Fondos de los dos paneles
  ctx.fillStyle = theme.plotAreaBg;
  ctx.fillRect(padLeft, padTop, plotWidth, magHeight);
  ctx.fillRect(padLeft, phaseTop, plotWidth, phaseHeight);

  // 2. Retícula de Frecuencia (Décadas y Subdécadas)
  ctx.lineWidth = 1;
  const startDecade = Math.floor(logFMin);
  const endDecade = Math.ceil(logFMax);

  for (let dec = startDecade; dec <= endDecade; dec++) {
    for (let sub = 1; sub <= 9; sub++) {
      const freq = Math.pow(10, dec) * sub;
      if (freq < fMin || freq > fMax) continue;
      const x = freqToX(freq);

      const isMainDecade = sub === 1;
      ctx.strokeStyle = isMainDecade ? theme.axisLine : theme.gridLine;
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, padTop + magHeight);
      ctx.moveTo(x, phaseTop);
      ctx.lineTo(x, phaseTop + phaseHeight);
      ctx.stroke();

      // Etiquetas en décadas principales
      if (isMainDecade) {
        ctx.fillStyle = theme.axisText;
        ctx.font = "9px 'JetBrains Mono', Consolas, monospace";
        ctx.textAlign = "center";
        const fStr = formatFreq(freq);
        ctx.fillText(fStr, x, phaseTop + phaseHeight + 14);
      }
    }
  }

  // 3. Retícula y Escalas de Magnitud (dB)
  ctx.textAlign = "right";
  ctx.font = "9px 'JetBrains Mono', Consolas, monospace";
  for (let db = Math.ceil(dbMin / 20) * 20; db <= dbMax; db += 20) {
    const y = dbToY(db);
    ctx.strokeStyle = db === 0 ? theme.axisLine : theme.gridLine;
    ctx.setLineDash(db === 0 ? [4, 3] : []);
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + plotWidth, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = db === 0 ? theme.traceColors.ch2 : theme.axisText;
    ctx.fillText(`${db > 0 ? "+" : ""}${db} dB`, padLeft - 6, y + 3);
  }

  // 4. Retícula y Escalas de Fase (Grados)
  for (let ph = Math.ceil(phaseMin / 45) * 45; ph <= phaseMax; ph += 45) {
    const y = phaseToY(ph);
    ctx.strokeStyle = ph === 0 || ph === -180 ? theme.axisLine : theme.gridLine;
    ctx.setLineDash(ph === -180 ? [3, 3] : []);
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + plotWidth, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = ph === -180 ? theme.traceColors.ch3 : theme.axisText;
    ctx.fillText(`${ph}°`, padLeft - 6, y + 3);
  }

  // Títulos de Paneles
  ctx.font = "bold 9px 'JetBrains Mono', Consolas, monospace";
  ctx.textAlign = "left";
  ctx.fillStyle = "#38bdf8";
  ctx.fillText("MAGNITUD |H(jω)| (dB)", padLeft + 6, padTop + 14);

  ctx.fillStyle = "#f59e0b";
  ctx.fillText("FASE ∠H(jω) (Grados)", padLeft + 6, phaseTop + 14);

  // 5. Trazado de Curvas si existen puntos
  if (pts.length > 1) {
    // Curva de Magnitud (Cian Neón vectorial)
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const x = freqToX(pts[i].freq);
      const y = dbToY(pts[i].magDb);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Curva de Fase (Ámbar Neón vectorial)
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const x = freqToX(pts[i].freq);
      const y = phaseToY(pts[i].phaseDeg);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 6. Marcador de Frecuencia de Corte a -3 dB
    if (dataSet?.metrics.cutoffFreq3dB) {
      const fc = dataSet.metrics.cutoffFreq3dB;
      if (fc >= fMin && fc <= fMax) {
        const xFc = freqToX(fc);
        const yFc = dbToY(dataSet.metrics.dcGainDb - 3.01);

        ctx.strokeStyle = "#22c55e";
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(xFc, padTop);
        ctx.lineTo(xFc, padTop + magHeight);
        ctx.stroke();
        ctx.setLineDash([]);

        // Punto diana en -3 dB
        ctx.fillStyle = "#22c55e";
        ctx.beginPath();
        ctx.arc(xFc, yFc, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = "bold 8px 'JetBrains Mono', Consolas, monospace";
        ctx.textAlign = "left";
        ctx.fillText(`fc = ${formatFreq(fc)} (-3dB)`, xFc + 6, yFc - 4);
      }
    }

    // 7. Marcadores de Estabilidad: Frecuencia de cruce de ganancia (PM) y cruce de fase (GM)
    if (dataSet?.metrics.gainCrossoverFreq && dataSet.metrics.phaseMarginDeg !== null) {
      const f0dB = dataSet.metrics.gainCrossoverFreq;
      if (f0dB >= fMin && f0dB <= fMax) {
        const x0dB = freqToX(f0dB);
        const yPhase = phaseToY(dataSet.metrics.phaseMarginDeg - 180);

        ctx.strokeStyle = "#eab308";
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(x0dB, padTop);
        ctx.lineTo(x0dB, phaseTop + phaseHeight);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = "#eab308";
        ctx.beginPath();
        ctx.arc(x0dB, yPhase, 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = "bold 8px monospace";
        ctx.textAlign = "left";
        ctx.fillText(`PM = ${dataSet.metrics.phaseMarginDeg.toFixed(1)}°`, x0dB + 5, yPhase - 3);
      }
    }
  }

  // 8. Cursores F1 y F2
  if (options.isCursorsEnabled) {
    if (options.cursorF1 && options.cursorF1 >= fMin && options.cursorF1 <= fMax) {
      drawCursorLine(ctx, freqToX(options.cursorF1), padTop, plotHeight + 14, "#38bdf8", "F1", formatFreq(options.cursorF1));
    }
    if (options.cursorF2 && options.cursorF2 >= fMin && options.cursorF2 <= fMax) {
      drawCursorLine(ctx, freqToX(options.cursorF2), padTop, plotHeight + 14, "#ec4899", "F2", formatFreq(options.cursorF2));
    }
  }

  // Bordes finales
  ctx.strokeStyle = "rgba(56, 189, 248, 0.25)";
  ctx.strokeRect(padLeft, padTop, plotWidth, magHeight);
  ctx.strokeRect(padLeft, phaseTop, plotWidth, phaseHeight);
}

/**
 * Renderizado del Diagrama Polar de Nyquist en el Plano Complejo Re(G) vs Im(G).
 */
export function drawNyquistPlot(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dataSet: BodeDataSet | null,
): void {
  ctx.fillStyle = "#070a14";
  ctx.fillRect(0, 0, width, height);

  if (width <= 40 || height <= 40) return;

  const cx = width / 2;
  const cy = height / 2;
  const maxRadius = Math.min(width, height) * 0.42;

  // Escala de ganancia (1.0 = radio del círculo unitario)
  let maxLinearGain = 1.5;
  if (dataSet?.nyquistPoints) {
    for (const pt of dataSet.nyquistPoints) {
      if (pt.magLinear > maxLinearGain && pt.magLinear < 100) {
        maxLinearGain = pt.magLinear;
      }
    }
  }
  const scale = maxRadius / maxLinearGain;

  // Círculos concéntricos de referencia
  ctx.lineWidth = 1;
  const radii = [0.5, 1.0, 2.0];
  for (const r of radii) {
    const pixelR = r * scale;
    if (pixelR > maxRadius * 1.5) continue;
    ctx.strokeStyle = r === 1.0 ? "rgba(234, 179, 8, 0.5)" : "rgba(79, 156, 249, 0.15)";
    ctx.beginPath();
    ctx.arc(cx, cy, pixelR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = r === 1.0 ? "#eab308" : "rgba(148, 163, 184, 0.5)";
    ctx.font = "8px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`|G|=${r.toFixed(1)}`, cx + pixelR + 2, cy - 2);
  }

  // Ejes ortogonales Re e Im
  ctx.strokeStyle = "rgba(79, 156, 249, 0.4)";
  ctx.beginPath();
  ctx.moveTo(10, cy);
  ctx.lineTo(width - 10, cy);
  ctx.moveTo(cx, 10);
  ctx.lineTo(cx, height - 10);
  ctx.stroke();

  ctx.fillStyle = "#94a3b8";
  ctx.font = "9px monospace";
  ctx.textAlign = "right";
  ctx.fillText("Re", width - 12, cy - 4);
  ctx.textAlign = "left";
  ctx.fillText("Im", cx + 4, 16);

  // Punto crítico (-1, 0j)
  const critX = cx - 1.0 * scale;
  const critY = cy;
  ctx.fillStyle = "#ef4444";
  ctx.beginPath();
  ctx.arc(critX, critY, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f87171";
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "center";
  ctx.fillText("(-1, 0)", critX, critY + 12);

  // Traza del contorno de Nyquist
  const nyqPts = dataSet?.nyquistPoints ?? [];
  if (nyqPts.length > 1) {
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < nyqPts.length; i++) {
      const pt = nyqPts[i];
      const px = cx + pt.real * scale;
      const py = cy - pt.imag * scale;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}

function drawCursorLine(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  height: number,
  color: string,
  label: string,
  valStr: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 2]);
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, top + height);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = color;
  ctx.font = "bold 8px 'JetBrains Mono', Consolas, monospace";
  ctx.textAlign = "center";
  ctx.fillText(`${label}: ${valStr}`, x, top - 4);
}

function formatFreq(hz: number): string {
  if (hz >= 1e9) return `${(hz / 1e9).toFixed(1)} GHz`;
  if (hz >= 1e6) return `${(hz / 1e6).toFixed(hz % 1e6 === 0 ? 0 : 1)} MHz`;
  if (hz >= 1e3) return `${(hz / 1e3).toFixed(hz % 1e3 === 0 ? 0 : 1)} kHz`;
  return `${hz.toFixed(hz % 1 === 0 ? 0 : 1)} Hz`;
}
