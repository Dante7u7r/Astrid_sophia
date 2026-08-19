/**
 * FftAnalyzerRenderer — Renderizado Gráfico Canvas 2D del Analizador de Espectro (FFT)
 *
 * Traza la cuadrícula espectral calibrada en frecuencia (Hz) y amplitud (dBV/dBm/Lineal),
 * el espectro en tiempo real con brillo fósforo, envolvente Max-Hold, marcas de armónicos (f0..6f0)
 * y cursores de frecuencia F1/F2.
 */

import { type FftAnalysisResult, type FftScaleMode } from "./fft_analyzer_model";

export interface FftRenderOptions {
  width: number;
  height: number;
  result: FftAnalysisResult | null;
  maxHoldMagnitudes?: Float64Array | null;
  scaleMode: FftScaleMode;
  refLevelDb: number; // Nivel de referencia en dB (ej: 0 dBV o +10 dBV)
  rangeDb: number;    // Rango dinámico visible (ej: 80 dB)
  showHarmonics?: boolean;
  cursors?: {
    cursorF1: number | null; // Frecuencia en Hz
    cursorF2: number | null; // Frecuencia en Hz
  };
}

export function drawFftSpectrum(
  ctx: CanvasRenderingContext2D,
  options: FftRenderOptions,
): void {
  const {
    width,
    height,
    result,
    maxHoldMagnitudes = null,
    scaleMode,
    refLevelDb,
    rangeDb,
    showHarmonics = true,
    cursors,
  } = options;

  // 1. Limpieza de pantalla
  ctx.fillStyle = "#030508";
  ctx.fillRect(0, 0, width, height);

  if (width <= 40 || height <= 40) return;

  const leftMargin = 48;
  const rightMargin = 12;
  const topMargin = 22;
  const bottomMargin = 26;

  const plotW = width - leftMargin - rightMargin;
  const plotH = height - topMargin - bottomMargin;

  const dbMax = refLevelDb;

  // 2. Fondo del Área de Trazado
  ctx.fillStyle = "rgba(4, 9, 20, 0.95)";
  ctx.fillRect(leftMargin, topMargin, plotW, plotH);

  // 3. Cuadrícula Reticular de Laboratorio (10 Divs Horizontales, 8 Divs Verticales)
  const numDivsX = 10;
  const numDivsY = 8;

  ctx.strokeStyle = "rgba(79, 156, 249, 0.12)";
  ctx.lineWidth = 1;

  // Líneas verticales (Frecuencia)
  for (let d = 0; d <= numDivsX; d++) {
    const x = leftMargin + (d * plotW) / numDivsX;
    ctx.beginPath();
    ctx.moveTo(x, topMargin);
    ctx.lineTo(x, topMargin + plotH);
    ctx.stroke();
  }

  // Líneas horizontales (Amplitud en dB)
  for (let d = 0; d <= numDivsY; d++) {
    const y = topMargin + (d * plotH) / numDivsY;
    ctx.beginPath();
    ctx.moveTo(leftMargin, y);
    ctx.lineTo(leftMargin + plotW, y);
    ctx.stroke();

    // Etiquetas del eje Y (dB / V)
    const dbVal = dbMax - (d * rangeDb) / numDivsY;
    ctx.fillStyle = "rgba(148, 163, 184, 0.7)";
    ctx.font = "9px monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(`${dbVal.toFixed(0)}`, leftMargin - 4, y);
  }

  // Marco exterior
  ctx.strokeStyle = "rgba(79, 156, 249, 0.35)";
  ctx.strokeRect(leftMargin, topMargin, plotW, plotH);

  // 4. Etiquetas de Frecuencia en Eje X
  const maxFreq = result ? result.samplingFreq / 2 : 10000;
  const freqPerDiv = maxFreq / numDivsX;

  ctx.fillStyle = "rgba(148, 163, 184, 0.8)";
  ctx.font = "9px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  for (let d = 0; d <= numDivsX; d += 2) {
    const x = leftMargin + (d * plotW) / numDivsX;
    const f = d * freqPerDiv;
    const fStr = f >= 1e6 ? `${(f / 1e6).toFixed(1)}M` : f >= 1e3 ? `${(f / 1e3).toFixed(1)}k` : `${f.toFixed(0)}`;
    ctx.fillText(`${fStr}Hz`, x, topMargin + plotH + 6);
  }

  // Encabezado con escala y RBW
  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const rbw = result ? result.samplingFreq / result.numPoints : 0;
  const rbwStr = rbw >= 1e3 ? `${(rbw / 1e3).toFixed(2)} kHz` : `${rbw.toFixed(1)} Hz`;
  ctx.fillText(`ESCALA: ${(rangeDb / numDivsY).toFixed(0)} dB/div | RBW: ${rbwStr} | REF: ${refLevelDb} dB`, leftMargin, topMargin / 2);

  if (!result || result.frequencies.length < 2) {
    ctx.fillStyle = "rgba(148, 163, 184, 0.4)";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Esperando datos de señal transitoria...", leftMargin + plotW / 2, topMargin + plotH / 2);
    return;
  }

  const numBins = result.frequencies.length;
  const freqToX = (freq: number) => leftMargin + (freq / maxFreq) * plotW;
  const dbToY = (db: number) => topMargin + ((dbMax - db) / rangeDb) * plotH;

  // 5. Trazar Envolvente Max-Hold (si existe)
  if (maxHoldMagnitudes && maxHoldMagnitudes.length === numBins) {
    ctx.strokeStyle = "rgba(234, 179, 8, 0.4)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();

    for (let i = 1; i < numBins; i++) {
      const f = result.frequencies[i];
      const db = 20 * Math.log10(Math.max(1e-12, maxHoldMagnitudes[i]));
      const x = freqToX(f);
      const y = Math.max(topMargin, Math.min(topMargin + plotH, dbToY(db)));

      if (i === 1) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // 6. Trazar Espectro en Vivo (Live Trace con Brillo Fósforo)
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 1.8;
  ctx.shadowColor = "#38bdf8";
  ctx.shadowBlur = 5;
  ctx.beginPath();

  for (let i = 1; i < numBins; i++) {
    const f = result.frequencies[i];
    let db = result.magnitudesDbv[i];
    if (scaleMode === "dbm") {
      db += 13.01;
    }

    const x = freqToX(f);
    const y = Math.max(topMargin, Math.min(topMargin + plotH, dbToY(db)));

    if (i === 1) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";

  // 7. Marcas de Armónicos Neón (f0, 2f0, 3f0..6f0)
  if (showHarmonics && result.harmonics.length > 0) {
    const harmonicColors = ["#38bdf8", "#a855f7", "#f97316", "#22c55e", "#eab308", "#ec4899"];

    for (const h of result.harmonics) {
      if (h.freq > maxFreq) break;

      const hX = freqToX(h.freq);
      let hDb = h.magnitudeDbv;
      if (scaleMode === "dbm") hDb += 13.01;
      const hY = Math.max(topMargin + 10, Math.min(topMargin + plotH - 5, dbToY(hDb)));
      const col = harmonicColors[(h.order - 1) % harmonicColors.length];

      // Línea de proyección vertical
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(hX, hY);
      ctx.lineTo(hX, topMargin + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      // Punto del armónico
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(hX, hY, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Etiqueta flotante
      const orderLabel = h.order === 1 ? "f0" : `${h.order}f0`;
      const fLabel = h.freq >= 1e6 ? `${(h.freq / 1e6).toFixed(2)}MHz` : h.freq >= 1e3 ? `${(h.freq / 1e3).toFixed(1)}kHz` : `${h.freq.toFixed(0)}Hz`;
      const badgeText = `${orderLabel}: ${fLabel} (${hDb.toFixed(1)}dB)`;

      ctx.font = "bold 8px monospace";
      const txtW = ctx.measureText(badgeText).width;
      const tagX = Math.max(leftMargin + txtW / 2 + 2, Math.min(width - rightMargin - txtW / 2 - 2, hX));

      ctx.fillStyle = "rgba(3, 5, 8, 0.85)";
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.fillRect(tagX - txtW / 2 - 3, hY - 15, txtW + 6, 12);
      ctx.strokeRect(tagX - txtW / 2 - 3, hY - 15, txtW + 6, 12);

      ctx.fillStyle = col;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(badgeText, tagX, hY - 9);
    }
  }

  // 8. Cursores de Frecuencia F1 y F2
  if (cursors) {
    const { cursorF1, cursorF2 } = cursors;

    if (cursorF1 !== null && cursorF1 >= 0 && cursorF1 <= maxFreq) {
      const x1 = freqToX(cursorF1);
      ctx.strokeStyle = "#eab308";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x1, topMargin);
      ctx.lineTo(x1, topMargin + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "#eab308";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "left";
      ctx.fillText("F1", x1 + 4, topMargin + 10);
    }

    if (cursorF2 !== null && cursorF2 >= 0 && cursorF2 <= maxFreq) {
      const x2 = freqToX(cursorF2);
      ctx.strokeStyle = "#ec4899";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x2, topMargin);
      ctx.lineTo(x2, topMargin + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "#ec4899";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "left";
      ctx.fillText("F2", x2 + 4, topMargin + 10);
    }
  }
}
