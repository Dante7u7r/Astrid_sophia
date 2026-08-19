/**
 * LogicAnalyzerRenderer — Renderizado Canvas 2D del Analizador Lógico Digital
 *
 * Traza diagramas de tiempos digitales multicanal (D0-D7), decodificación de bus paralelo (Hex),
 * paquetes serie (UART), regla temporal calibrada y cursores de medición de tiempos.
 */

import {
  evaluateLogicLevel,
  extractTransitions,
  formatTimeDiv,
  getLevelAtTime,
  type BusPacket,
  type LogicSample,
  type LogicThresholdConfig,
  type UartPacket,
} from "./logic_analyzer_model";

export interface LogicRendererChannel {
  index: number;         // 0..7
  nodeName: string | null;
  enabled: boolean;
  color: string;
  samples: readonly LogicSample[];
}

export interface LogicRenderOptions {
  width: number;
  height: number;
  channels: readonly LogicRendererChannel[];
  threshold: LogicThresholdConfig;
  timeWindow: {
    startTime: number;
    endTime: number;
  };
  triggerTime?: number | null;
  isBusEnabled?: boolean;
  busPackets?: readonly BusPacket[];
  uartPackets?: readonly UartPacket[];
  cursors?: {
    cursorT1: number | null; // Tiempo en segundos
    cursorT2: number | null; // Tiempo en segundos
  };
}

export function drawLogicAnalyzer(
  ctx: CanvasRenderingContext2D,
  options: LogicRenderOptions,
): void {
  const {
    width,
    height,
    channels,
    threshold,
    timeWindow,
    triggerTime = null,
    isBusEnabled = false,
    busPackets = [],
    uartPackets = [],
    cursors,
  } = options;

  // 1. Limpieza de fondo
  ctx.fillStyle = "#030508";
  ctx.fillRect(0, 0, width, height);

  if (width <= 20 || height <= 20) return;

  const leftMargin = 85; // Margen para etiquetas D0-D7
  const rulerHeight = 22;
  const plotWidth = width - leftMargin;
  const tStart = timeWindow.startTime;
  const tEnd = timeWindow.endTime;
  const totalDuration = Math.max(1e-9, tEnd - tStart);

  // 2. Dibujar Regla de Tiempo Superior (Time Ruler)
  ctx.fillStyle = "rgba(10, 16, 30, 0.9)";
  ctx.fillRect(0, 0, width, rulerHeight);

  ctx.strokeStyle = "rgba(79, 156, 249, 0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, rulerHeight);
  ctx.lineTo(width, rulerHeight);
  ctx.moveTo(leftMargin, 0);
  ctx.lineTo(leftMargin, height);
  ctx.stroke();

  // Divisiones de tiempo (10 divisiones)
  const numDivs = 10;
  const divWidth = plotWidth / numDivs;
  const timePerDiv = totalDuration / numDivs;

  ctx.fillStyle = "rgba(148, 163, 184, 0.8)";
  ctx.font = "9px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let d = 0; d <= numDivs; d++) {
    const x = leftMargin + d * divWidth;
    const t = tStart + d * timePerDiv;

    // Tick en la regla
    ctx.strokeStyle = "rgba(79, 156, 249, 0.4)";
    ctx.beginPath();
    ctx.moveTo(x, rulerHeight - 5);
    ctx.lineTo(x, rulerHeight);
    ctx.stroke();

    // Línea de cuadrícula vertical sutil
    ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
    ctx.beginPath();
    ctx.moveTo(x, rulerHeight);
    ctx.lineTo(x, height);
    ctx.stroke();

    // Texto de tiempo
    const timeStr = t >= 1 ? `${t.toFixed(2)}s` : t >= 1e-3 ? `${(t * 1e3).toFixed(1)}ms` : `${(t * 1e6).toFixed(0)}µs`;
    ctx.fillText(timeStr, x, rulerHeight / 2);
  }

  // Indicador de escala (ns/div, µs/div, etc.) en la esquina superior izquierda
  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "left";
  ctx.fillText(formatTimeDiv(timePerDiv), 8, rulerHeight / 2);

  // 3. Calcular filas a dibujar (8 Canales + Bus opcional + UART opcional)
  const rowsCount = Math.max(1, 8 + (isBusEnabled ? 1 : 0) + (uartPackets.length > 0 ? 1 : 0));
  const rowHeight = (height - rulerHeight) / rowsCount;

  const timeToX = (time: number) => leftMargin + ((time - tStart) / totalDuration) * plotWidth;

  // 4. Dibujar Canales Digitales D0-D7
  for (let i = 0; i < 8; i++) {
    const ch = channels[i];
    const topY = rulerHeight + i * rowHeight;
    const bottomY = topY + rowHeight;
    const waveHighY = topY + 7;
    const waveLowY = bottomY - 7;
    const waveMidY = topY + rowHeight / 2;

    // Separador de canal
    ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, bottomY);
    ctx.lineTo(width, bottomY);
    ctx.stroke();

    // Etiqueta de Canal y Estado actual en el margen izquierdo
    const lastSample = ch.samples[ch.samples.length - 1];
    const currentLvl = lastSample ? evaluateLogicLevel(lastSample.val, threshold) : "X";
    const lvlColor = currentLvl === 1 ? "#4ade80" : currentLvl === 0 ? "#94a3b8" : "#f59e0b";

    ctx.fillStyle = ch.color;
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`D${i}`, 8, topY + rowHeight / 2);

    ctx.fillStyle = ch.enabled && ch.nodeName ? "rgba(255,255,255,0.7)" : "rgba(148,163,184,0.3)";
    ctx.font = "9px monospace";
    const nodeLabel = ch.nodeName ? `N:${ch.nodeName}` : "OFF";
    ctx.fillText(nodeLabel, 28, topY + rowHeight / 2);

    if (ch.enabled && ch.nodeName) {
      ctx.fillStyle = lvlColor;
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "right";
      ctx.fillText(String(currentLvl), leftMargin - 6, topY + rowHeight / 2);
    }

    if (!ch.enabled || !ch.nodeName || ch.samples.length === 0) {
      // Línea atenuada en bajo para canales apagados
      ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(leftMargin, waveLowY);
      ctx.lineTo(width, waveLowY);
      ctx.stroke();
      continue;
    }

    // Trazar forma de onda con transiciones verticales digitales
    const transitions = extractTransitions(ch.samples, threshold);
    if (transitions.length === 0) continue;

    ctx.strokeStyle = ch.color;
    ctx.lineWidth = 1.8;
    ctx.shadowColor = ch.color;
    ctx.shadowBlur = 4;
    ctx.beginPath();

    const getPixelY = (lvl: 0 | 1 | "X") => (lvl === 1 ? waveHighY : lvl === 0 ? waveLowY : waveMidY);

    let prevLevel = getLevelAtTime(transitions, tStart);
    let prevY = getPixelY(prevLevel);
    ctx.moveTo(leftMargin, prevY);

    for (const tr of transitions) {
      if (tr.time < tStart) {
        prevLevel = tr.level;
        prevY = getPixelY(prevLevel);
        continue;
      }
      if (tr.time > tEnd) break;

      const x = timeToX(tr.time);
      const currY = getPixelY(tr.level);

      // Línea horizontal hasta la transición
      ctx.lineTo(x, prevY);
      // Flanco vertical
      ctx.lineTo(x, currY);

      prevLevel = tr.level;
      prevY = currY;
    }

    // Completar hasta el borde derecho
    ctx.lineTo(width, prevY);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
  }

  // 5. Dibujar Bus Paralelo Decodificado (si está activo)
  if (isBusEnabled) {
    const busTopY = rulerHeight + 8 * rowHeight;
    const busBottomY = busTopY + rowHeight;
    const busMidY = busTopY + rowHeight / 2;

    ctx.strokeStyle = "rgba(168, 85, 247, 0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, busBottomY);
    ctx.lineTo(width, busBottomY);
    ctx.stroke();

    ctx.fillStyle = "#a855f7";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("BUS", 8, busMidY);

    for (const pkt of busPackets) {
      const x1 = Math.max(leftMargin, timeToX(pkt.startTime));
      const x2 = Math.min(width, timeToX(pkt.endTime));
      if (x2 <= leftMargin || x1 >= width) continue;

      const packetW = x2 - x1;
      const hH = (rowHeight - 10) / 2;

      // Dibujar burbuja romboidal de paquete de bus
      ctx.fillStyle = "rgba(168, 85, 247, 0.15)";
      ctx.strokeStyle = "#a855f7";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x1, busMidY);
      ctx.lineTo(Math.min(x1 + 4, x1 + packetW / 2), busMidY - hH);
      ctx.lineTo(Math.max(x2 - 4, x1 + packetW / 2), busMidY - hH);
      ctx.lineTo(x2, busMidY);
      ctx.lineTo(Math.max(x2 - 4, x1 + packetW / 2), busMidY + hH);
      ctx.lineTo(Math.min(x1 + 4, x1 + packetW / 2), busMidY + hH);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Etiqueta Hexadecimal centrada
      if (packetW > 28) {
        ctx.fillStyle = "#e2e8f0";
        ctx.font = "bold 9px monospace";
        ctx.textAlign = "center";
        ctx.fillText(pkt.hexLabel, x1 + packetW / 2, busMidY);
      }
    }
  }

  // 6. Dibujar Marcador de Disparo (Trigger Line / Flag)
  if (triggerTime !== null && triggerTime >= tStart && triggerTime <= tEnd) {
    const trigX = timeToX(triggerTime);

    ctx.strokeStyle = "rgba(234, 179, 8, 0.7)";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(trigX, rulerHeight);
    ctx.lineTo(trigX, height);
    ctx.stroke();
    ctx.setLineDash([]);

    // Bandera 'T'
    ctx.fillStyle = "#eab308";
    ctx.beginPath();
    ctx.moveTo(trigX, rulerHeight);
    ctx.lineTo(trigX - 5, rulerHeight - 7);
    ctx.lineTo(trigX + 5, rulerHeight - 7);
    ctx.closePath();
    ctx.fill();
  }

  // 7. Dibujar Cursores de Tiempo T1 y T2
  if (cursors) {
    const { cursorT1, cursorT2 } = cursors;

    if (cursorT1 !== null && cursorT1 >= tStart && cursorT1 <= tEnd) {
      const x1 = timeToX(cursorT1);
      ctx.strokeStyle = "#eab308";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x1, 0);
      ctx.lineTo(x1, height);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "#eab308";
      ctx.font = "bold 9px monospace";
      ctx.fillText("T1", x1 + 4, rulerHeight + 10);
    }

    if (cursorT2 !== null && cursorT2 >= tStart && cursorT2 <= tEnd) {
      const x2 = timeToX(cursorT2);
      ctx.strokeStyle = "#ec4899";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x2, 0);
      ctx.lineTo(x2, height);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "#ec4899";
      ctx.font = "bold 9px monospace";
      ctx.fillText("T2", x2 + 4, rulerHeight + 10);
    }
  }
}
