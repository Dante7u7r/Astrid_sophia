import {
  buildTyTracePoints,
  extractSampleVoltage,
  selectTraceSampleIndices,
  type WaveformHistogram,
  type MaskToleranceDefinition,
  type MaskTestResult,
} from "./oscilloscope_model";
import type { AcSweepResult, PvtTrace, TimeStepResult } from "./oscilloscope_panel";
import { getInstrumentThemeColors } from "./instrument_theme";
import type { CursorMode, OscilloscopeCursor } from "./oscilloscope_cursor_model";

export interface OscilloscopeChannelView {
  node: string | null;
  color: string;
  active: boolean;
}

export interface OscilloscopeCursorOptions {
  mode?: CursorMode;
  hoveredCursor?: OscilloscopeCursor | null;
  draggingCursor?: OscilloscopeCursor | null;
  trackV1?: number | null;
  trackV2?: number | null;
  trackNodeLabel?: string;
  sourceLabel?: string;
  signalPeriod?: number;
  suppressTopBadge?: boolean;
}


export function drawAcSweep(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  results: AcSweepResult,
  channels: readonly OscilloscopeChannelView[],
): void {
  const frequencies = results.frequencies;
  const fMin = frequencies[0];
  const fMax = frequencies[frequencies.length - 1];
  const logMin = Math.log10(fMin);
  const logRange = Math.log10(fMax) - logMin;
  if (!Number.isFinite(logRange) || logRange <= 0) return;

  const theme = getInstrumentThemeColors();
  ctx.strokeStyle = theme.gridLine;
  ctx.lineWidth = 1;
  for (const decade of [10, 100, 1_000, 10_000, 100_000]) {
    if (decade < fMin || decade > fMax) continue;
    const x = ((Math.log10(decade) - logMin) / logRange) * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height - 15);
    ctx.stroke();
    ctx.fillStyle = theme.axisText;
    ctx.font = "9px var(--font-sans)";
    ctx.textAlign = "center";
    ctx.fillText(decade >= 1_000 ? `${decade / 1_000} kHz` : `${decade} Hz`, x, height - 4);
  }

  for (const channel of channels) {
    if (!channel.active || !channel.node) continue;
    const amplitudes = results.nodeAmplitudes[channel.node];
    if (!amplitudes?.length) continue;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    ctx.strokeStyle = channel.color;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    const sampleCount = Math.min(frequencies.length, amplitudes.length);
    for (let index = 0; index < sampleCount; index++) {
      const x = ((Math.log10(frequencies[index]) - logMin) / logRange) * width;
      const y = (height - 15) * (1 - (amplitudes[index] + 80) / 100);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

export function drawXyTrace(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  results: readonly TimeStepResult[],
  xNode: string,
  yNode: string,
  xVoltsPerDiv: number,
  yVoltsPerDiv: number,
  xOffset: number,
  yOffset: number,
  options?: {
    xLabel?: string;
    yLabel?: string;
    traceColor?: string;
  },
): void {
  const theme = getInstrumentThemeColors();
  const divWidth = width / 10;
  const divHeight = height / 8;
  const centerX = Math.floor(width / 2) + 0.5;
  const centerY = Math.floor(height / 2) + 0.5;

  ctx.save();

  // 1. Grid
  ctx.strokeStyle = theme.gridLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = divWidth; x < width - 1; x += divWidth) {
    const rx = Math.floor(x) + 0.5;
    ctx.moveTo(rx, 0);
    ctx.lineTo(rx, height);
  }
  for (let y = divHeight; y < height - 1; y += divHeight) {
    const ry = Math.floor(y) + 0.5;
    ctx.moveTo(0, ry);
    ctx.lineTo(width, ry);
  }
  ctx.stroke();

  // 2. Axes
  ctx.strokeStyle = theme.axisLine;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.moveTo(centerX, 0);
  ctx.lineTo(centerX, height);
  ctx.stroke();

  // 3. Header badge
  const xLbl = options?.xLabel ?? "CH1";
  const yLbl = options?.yLabel ?? "CH2";
  const badgeText = `MODO X-Y: ${xLbl} (X) vs ${yLbl} (Y)`;
  ctx.font = "bold 9px var(--font-mono)";
  const badgeW = ctx.measureText(badgeText).width + 16;
  ctx.fillStyle = "rgba(10, 15, 25, 0.85)";
  ctx.strokeStyle = "rgba(56, 189, 248, 0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(width / 2 - badgeW / 2, 8, badgeW, 18, 3);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#38bdf8";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(badgeText, width / 2, 17);

  // 4. Trace
  const traceColor = options?.traceColor ?? theme.traceColors.ch2 ?? "#38bdf8";
  const indices = selectTraceSampleIndices(
    results.length,
    Math.max(64, Math.min(4_000, Math.ceil(width * 2))),
  );

  const points: { x: number; y: number }[] = [];
  for (let sampleIndex = 0; sampleIndex < indices.length; sampleIndex++) {
    const point = results[indices[sampleIndex]];
    const x = centerX + ((extractSampleVoltage(point.nodeVoltages, xNode)) / (xVoltsPerDiv || 1)) * divWidth + xOffset;
    const y = centerY - ((extractSampleVoltage(point.nodeVoltages, yNode)) / (yVoltsPerDiv || 1)) * divHeight - yOffset;
    points.push({ x, y });
  }

  if (points.length >= 2) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Glow pass
    ctx.strokeStyle = traceColor;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    renderSmoothTracePath(ctx, points);
    ctx.stroke();

    // Crisp line
    ctx.globalAlpha = 1.0;
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    renderSmoothTracePath(ctx, points);
    ctx.stroke();

    ctx.restore();
  }

  ctx.restore();
}

export function drawXyNotice(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  message?: string,
): void {
  drawTyReticle(ctx, width, height);

  ctx.save();
  const title = "MODO X-Y (Lissajous)";
  const desc = message ?? "Se requieren al menos 2 canales activos (ej. CH1 y CH4) para graficar X vs Y";

  ctx.font = "bold 13px var(--font-sans, system-ui)";
  const w1 = ctx.measureText(title).width;
  ctx.font = "11px var(--font-sans, system-ui)";
  const w2 = ctx.measureText(desc).width;
  const boxW = Math.max(w1, w2) + 36;
  const boxH = 64;
  const boxX = Math.floor(width / 2 - boxW / 2);
  const boxY = Math.floor(height / 2 - boxH / 2);

  ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
  ctx.strokeStyle = "rgba(56, 189, 248, 0.5)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 12px var(--font-sans, system-ui)";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(title, width / 2, boxY + 12);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "11px var(--font-sans, system-ui)";
  ctx.fillText(desc, width / 2, boxY + 34);

  ctx.restore();
}


export interface ReticleChannelMarker {
  num: number;
  color: string;
  offsetPixels: number;
  active: boolean;
}

export interface ReticleTriggerMarker {
  levelVolts: number;
  voltsPerDiv: number;
  mode: "auto" | "normal" | "single";
  triggered: boolean;
  paused: boolean;
}

export interface ReticleOverlayOptions {
  channels?: readonly ReticleChannelMarker[];
  trigger?: ReticleTriggerMarker | null;
}

export function drawTyReticle(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options?: ReticleOverlayOptions,
): { divWidth: number; divHeight: number } {
  const divWidth = width / 10;
  const divHeight = height / 8;
  const theme = getInstrumentThemeColors();

  // 1. High-precision Crisp Sub-grid
  ctx.save();
  ctx.strokeStyle = theme.gridLine;
  ctx.lineWidth = 1;

  ctx.beginPath();
  for (let x = divWidth; x < width - 1; x += divWidth) {
    const rx = Math.floor(x) + 0.5;
    ctx.moveTo(rx, 0);
    ctx.lineTo(rx, height);
  }

  for (let y = divHeight; y < height - 1; y += divHeight) {
    const ry = Math.floor(y) + 0.5;
    ctx.moveTo(0, ry);
    ctx.lineTo(width, ry);
  }
  ctx.stroke();

  // 2. Primary Center Crosshairs (Continuous glowing axis)
  const centerX = Math.floor(width / 2) + 0.5;
  const centerY = Math.floor(height / 2) + 0.5;

  ctx.strokeStyle = theme.axisLine;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.moveTo(centerX, 0);
  ctx.lineTo(centerX, height);
  ctx.stroke();

  // 3. Calibration Tick marks along center axes (5 sub-ticks per division)
  const subDivX = divWidth / 5;
  ctx.strokeStyle = theme.axisLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= width; x += subDivX) {
    const rx = Math.floor(x) + 0.5;
    ctx.moveTo(rx, centerY - 3);
    ctx.lineTo(rx, centerY + 3);
  }
  const subDivY = divHeight / 5;
  for (let y = 0; y <= height; y += subDivY) {
    const ry = Math.floor(y) + 0.5;
    ctx.moveTo(centerX - 3, ry);
    ctx.lineTo(centerX + 3, ry);
  }
  ctx.stroke();

  // 4. Ground reference tags on the left bezel for active channels
  if (options?.channels) {
    for (const ch of options.channels) {
      if (!ch.active) continue;
      const tagY = Math.max(8, Math.min(height - 8, centerY - ch.offsetPixels));
      ctx.fillStyle = ch.color;
      ctx.beginPath();
      ctx.moveTo(0, tagY - 6);
      ctx.lineTo(12, tagY - 6);
      ctx.lineTo(18, tagY);
      ctx.lineTo(12, tagY + 6);
      ctx.lineTo(0, tagY + 6);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#030712";
      ctx.font = "bold 9px var(--font-mono)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${ch.num}`, 7, tagY);
    }
  }

  // 5. Trigger level indicator tag on the right bezel
  if (options?.trigger) {
    const trig = options.trigger;
    const trigOffsetPx = (trig.levelVolts / (trig.voltsPerDiv || 1)) * divHeight;
    const trigY = Math.max(8, Math.min(height - 8, centerY - trigOffsetPx));

    // Trigger tag on right edge
    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    ctx.moveTo(width, trigY - 6);
    ctx.lineTo(width - 12, trigY - 6);
    ctx.lineTo(width - 18, trigY);
    ctx.lineTo(width - 12, trigY + 6);
    ctx.lineTo(width, trigY + 6);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#030712";
    ctx.font = "bold 9px var(--font-mono)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("T", width - 7, trigY);

    // Trigger Status Badge at top right
    const statusText = trig.paused
      ? "STOP"
      : trig.triggered
        ? "TRIG'D"
        : trig.mode === "single"
          ? "READY"
          : trig.mode === "normal"
            ? "WAIT"
            : "AUTO";
    const statusColor = trig.paused
      ? "#f43f5e"
      : trig.triggered
        ? "#22c55e"
        : trig.mode === "single" || trig.mode === "normal"
          ? "#f59e0b"
          : "#38bdf8";

    ctx.font = "bold 9px var(--font-mono)";
    const badgeW = ctx.measureText(statusText).width + 12;
    const badgeX = width - badgeW - 10;
    const badgeY = 8;

    ctx.fillStyle = "rgba(10, 15, 25, 0.85)";
    ctx.strokeStyle = statusColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeW, 16, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = statusColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(statusText, badgeX + badgeW / 2, badgeY + 8);
  }

  ctx.restore();
  return { divWidth, divHeight };
}

export function drawPvtTraces(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  traces: readonly PvtTrace[],
  node: string,
  voltsPerDiv: number,
  offsetPixels: number,
  timeDivValue: number,
): void {
  drawTyReticle(ctx, width, height);
  for (const trace of traces) {
    if (!trace.visible || trace.results.length < 2) continue;
    const points = buildTyTracePoints(
      trace.results,
      node,
      { width, height },
      { voltsPerDiv, offsetPixels, timeDivValue },
      0,
    );
    if (points.length < 2) continue;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Glow pass
    ctx.strokeStyle = trace.color;
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = 4.2;
    ctx.beginPath();
    renderSmoothTracePath(ctx, points);
    ctx.stroke();

    // Center crisp line
    ctx.globalAlpha = 1.0;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    renderSmoothTracePath(ctx, points);
    ctx.stroke();

    ctx.restore();
  }

  // Draw Legend Box in upper-right corner for Parametric / PVT curves
  if (traces.length > 0) {
    ctx.save();
    ctx.font = "10px monospace";
    let legendY = 18;
    for (const trace of traces) {
      if (!trace.visible) continue;
      const label = trace.label ?? trace.name ?? trace.config?.corner ?? "TRAZA";
      ctx.fillStyle = trace.color;
      ctx.fillRect(width - 130, legendY - 8, 8, 8);
      ctx.fillStyle = "rgba(226, 232, 240, 0.9)";
      ctx.fillText(label, width - 116, legendY);
      legendY += 13;
    }
    ctx.restore();
  }
}

export function drawSplitTyReticle(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  activeChannels: Array<{ num: number; color: string; offsetPixels: number; voltsPerDiv: number }>,
  trigger?: ReticleOverlayOptions["trigger"],
): void {
  const n = activeChannels.length;
  if (n <= 1) return;
  const slotHeight = height / n;
  const divWidth = width / 10;
  const theme = getInstrumentThemeColors();

  ctx.save();

  // Draw each channel's sub-grid
  for (let k = 0; k < n; k++) {
    const ch = activeChannels[k];
    const topY = k * slotHeight;
    const centerY = topY + slotHeight / 2;
    const divHeight = slotHeight / 8;

    // Slot separator
    if (k > 0) {
      ctx.strokeStyle = theme.axisLine;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, Math.floor(topY) + 0.5);
      ctx.lineTo(width, Math.floor(topY) + 0.5);
      ctx.stroke();
    }

    // Crisp sub-grid for this slot
    ctx.strokeStyle = theme.gridLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = divWidth; x < width - 1; x += divWidth) {
      const rx = Math.floor(x) + 0.5;
      ctx.moveTo(rx, topY);
      ctx.lineTo(rx, topY + slotHeight);
    }
    for (let y = divHeight; y < slotHeight - 1; y += divHeight) {
      const ry = Math.floor(topY + y) + 0.5;
      ctx.moveTo(0, ry);
      ctx.lineTo(width, ry);
    }
    ctx.stroke();

    // Center sub-axis
    ctx.strokeStyle = theme.axisLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.floor(centerY) + 0.5);
    ctx.lineTo(width, Math.floor(centerY) + 0.5);
    ctx.stroke();

    // Ground indicator tag
    const tagY = Math.max(topY + 6, Math.min(topY + slotHeight - 6, centerY - ch.offsetPixels));
    ctx.fillStyle = ch.color;
    ctx.beginPath();
    ctx.moveTo(0, tagY - 6);
    ctx.lineTo(12, tagY - 6);
    ctx.lineTo(18, tagY);
    ctx.lineTo(12, tagY + 6);
    ctx.lineTo(0, tagY + 6);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#030712";
    ctx.font = "bold 9px var(--font-mono)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${ch.num}`, 7, tagY);

    // Channel label badge in top-left of the slot
    ctx.fillStyle = ch.color;
    ctx.font = "bold 9px var(--font-mono)";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`CH${ch.num} (${ch.voltsPerDiv} V/div)`, 24, topY + 4);
  }

  // Trigger Status Badge at top right
  if (trigger) {
    const statusText = trigger.paused
      ? "STOP"
      : trigger.triggered
        ? "TRIG'D"
        : trigger.mode === "single"
          ? "READY"
          : trigger.mode === "normal"
            ? "WAIT"
            : "AUTO";
    const statusColor = trigger.paused
      ? "#f43f5e"
      : trigger.triggered
        ? "#22c55e"
        : trigger.mode === "single" || trigger.mode === "normal"
          ? "#f59e0b"
          : "#38bdf8";

    ctx.font = "bold 9px var(--font-mono)";
    const badgeW = ctx.measureText(statusText).width + 12;
    const badgeX = width - badgeW - 24;
    const badgeY = 8;

    ctx.fillStyle = "rgba(10, 15, 25, 0.85)";
    ctx.strokeStyle = statusColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeW, 16, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = statusColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(statusText, badgeX + badgeW / 2, badgeY + 8);
  }

  ctx.restore();
}

export function formatCursorTime(valSeconds: number): string {
  const abs = Math.abs(valSeconds);
  const sign = valSeconds < 0 ? "-" : "";
  if (abs < 1e-6) return `${sign}${(abs * 1e9).toFixed(1)} ns`;
  if (abs < 1e-3) return `${sign}${(abs * 1e6).toFixed(1)} µs`;
  if (abs < 1.0) return `${sign}${(abs * 1e3).toFixed(2)} ms`;
  return `${sign}${abs.toFixed(3)} s`;
}

export function formatCursorVoltage(valVolts: number): string {
  const abs = Math.abs(valVolts);
  const sign = valVolts >= 0 ? "+" : "-";
  if (abs < 1e-3) return `${sign}${(abs * 1e3).toFixed(1)} mV`;
  return `${sign}${abs.toFixed(2)} V`;
}

export function drawOscilloscopeCursors(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  divHeight: number,
  cursorT1: number,
  cursorT2: number,
  cursorV1: number,
  cursorV2: number,
  voltsPerDiv: number,
  voltageOffset: number,
  timeDivValue: number,
  signalPeriodOrOptions?: number | OscilloscopeCursorOptions,
  sourceLabel?: string,
): void {
  const options: OscilloscopeCursorOptions =
    typeof signalPeriodOrOptions === "object" && signalPeriodOrOptions !== null
      ? signalPeriodOrOptions
      : {
          signalPeriod: typeof signalPeriodOrOptions === "number" ? signalPeriodOrOptions : undefined,
          sourceLabel,
        };

  const mode = options.mode ?? "both";
  if (mode === "off") return;

  const drawTime = mode === "time" || mode === "both" || mode === "track";
  const drawVoltage = mode === "voltage" || mode === "both";
  const isTrack = mode === "track";

  const hovered = options.hoveredCursor ?? null;
  const dragging = options.draggingCursor ?? null;
  const centerY = height / 2;

  ctx.save();

  // 1. RENDER TIME CURSORS (T1 & T2)
  const x1 = Math.round(cursorT1 * width) + 0.5;
  const x2 = Math.round(cursorT2 * width) + 0.5;
  const t1Sec = cursorT1 * timeDivValue * 10;
  const t2Sec = cursorT2 * timeDivValue * 10;

  if (drawTime) {
    // --- T1 Cursor ---
    const isT1Active = hovered === "T1" || dragging === "T1";
    ctx.strokeStyle = isT1Active ? "#FDE047" : "rgba(250, 204, 21, 0.85)";
    ctx.lineWidth = isT1Active ? 2 : 1.2;
    ctx.setLineDash(isT1Active ? [] : [4, 3]);

    if (isT1Active) {
      // Glow pass
      ctx.save();
      ctx.strokeStyle = "rgba(250, 204, 21, 0.35)";
      ctx.lineWidth = 5;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x1, 0);
      ctx.lineTo(x1, height);
      ctx.stroke();
      ctx.restore();
    }

    ctx.beginPath();
    ctx.moveTo(x1, 0);
    ctx.lineTo(x1, height);
    ctx.stroke();

    // Bottom Bezel Handle Tab for T1 (prevents collision with top HUD overlay)
    const t1Text = `T1: ${formatCursorTime(t1Sec)}`;
    ctx.font = "bold 9px var(--font-mono)";
    const t1W = Math.max(56, ctx.measureText(t1Text).width + 12);
    const t1TabX = Math.max(4, Math.min(width - t1W - 4, x1 - t1W / 2));
    const t1TabY = height - 19;

    ctx.fillStyle = isT1Active ? "rgba(30, 41, 59, 0.96)" : "rgba(15, 23, 42, 0.92)";
    ctx.strokeStyle = isT1Active ? "#FDE047" : "#FACC15";
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.roundRect(t1TabX, t1TabY, t1W, 16, 3);
    ctx.fill();
    ctx.stroke();

    // Small notch pointing up to vertical line
    ctx.fillStyle = isT1Active ? "#FDE047" : "#FACC15";
    ctx.beginPath();
    ctx.moveTo(x1 - 3, t1TabY);
    ctx.lineTo(x1 + 3, t1TabY);
    ctx.lineTo(x1, t1TabY - 3);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = isT1Active ? "#FEF08A" : "#FACC15";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t1Text, t1TabX + t1W / 2, t1TabY + 8);

    // --- T2 Cursor ---
    const isT2Active = hovered === "T2" || dragging === "T2";
    ctx.strokeStyle = isT2Active ? "#FDE047" : "rgba(250, 204, 21, 0.85)";
    ctx.lineWidth = isT2Active ? 2 : 1.2;
    ctx.setLineDash(isT2Active ? [] : [4, 3]);

    if (isT2Active) {
      ctx.save();
      ctx.strokeStyle = "rgba(250, 204, 21, 0.35)";
      ctx.lineWidth = 5;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x2, 0);
      ctx.lineTo(x2, height);
      ctx.stroke();
      ctx.restore();
    }

    ctx.beginPath();
    ctx.moveTo(x2, 0);
    ctx.lineTo(x2, height);
    ctx.stroke();

    // Bottom Bezel Handle Tab for T2
    const t2Text = `T2: ${formatCursorTime(t2Sec)}`;
    const t2W = Math.max(56, ctx.measureText(t2Text).width + 12);
    const t2TabX = Math.max(4, Math.min(width - t2W - 4, x2 - t2W / 2));
    const t2TabY = height - 19;

    ctx.fillStyle = isT2Active ? "rgba(30, 41, 59, 0.96)" : "rgba(15, 23, 42, 0.92)";
    ctx.strokeStyle = isT2Active ? "#FDE047" : "#FACC15";
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.roundRect(t2TabX, t2TabY, t2W, 16, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isT2Active ? "#FDE047" : "#FACC15";
    ctx.beginPath();
    ctx.moveTo(x2 - 3, t2TabY);
    ctx.lineTo(x2 + 3, t2TabY);
    ctx.lineTo(x2, t2TabY - 3);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = isT2Active ? "#FEF08A" : "#FACC15";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t2Text, t2TabX + t2W / 2, t2TabY + 8);
  }

  // 2. RENDER VOLTAGE CURSORS (V1 & V2)
  const v1Actual = isTrack && options.trackV1 !== undefined && options.trackV1 !== null ? options.trackV1 : cursorV1;
  const v2Actual = isTrack && options.trackV2 !== undefined && options.trackV2 !== null ? options.trackV2 : cursorV2;
  const y1 = Math.round(centerY - (v1Actual / voltsPerDiv) * divHeight - voltageOffset) + 0.5;
  const y2 = Math.round(centerY - (v2Actual / voltsPerDiv) * divHeight - voltageOffset) + 0.5;

  const chColorKey = (options.sourceLabel || "ch1").toLowerCase();
  const chColors = chColorKey === "ch2"
    ? { main: "#38BDF8", glow: "rgba(56, 189, 248, 0.4)", text: "#BAE6FD", hover: "#7DD3FC" }
    : chColorKey === "ch3"
      ? { main: "#F43F5E", glow: "rgba(244, 63, 94, 0.4)", text: "#FECDD3", hover: "#FB7185" }
      : chColorKey === "ch4"
        ? { main: "#34D399", glow: "rgba(52, 211, 153, 0.4)", text: "#A7F3D0", hover: "#6EE7B7" }
        : chColorKey === "math"
          ? { main: "#C084FC", glow: "rgba(192, 132, 252, 0.4)", text: "#F3E8FF", hover: "#D8B4FE" }
          : { main: "#FACC15", glow: "rgba(250, 204, 21, 0.4)", text: "#FEF08A", hover: "#FDE047" };

  if (drawVoltage) {
    // --- V1 Cursor ---
    const isV1Active = hovered === "V1" || dragging === "V1";
    ctx.strokeStyle = isV1Active ? chColors.hover : chColors.main;
    ctx.lineWidth = isV1Active ? 2 : 1.2;
    ctx.setLineDash(isV1Active ? [] : [4, 3]);

    if (isV1Active) {
      ctx.save();
      ctx.strokeStyle = chColors.glow;
      ctx.lineWidth = 5;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(0, y1);
      ctx.lineTo(width, y1);
      ctx.stroke();
      ctx.restore();
    }

    ctx.beginPath();
    ctx.moveTo(0, y1);
    ctx.lineTo(width, y1);
    ctx.stroke();

    // Left Bezel Handle Tab for V1 (offset to x=22 to clear ground tags at x=0..18)
    const v1Text = `V1: ${formatCursorVoltage(v1Actual)}`;
    ctx.font = "bold 9px var(--font-mono)";
    const v1W = Math.max(54, ctx.measureText(v1Text).width + 10);
    const v1TabY = Math.max(4, Math.min(height - 20, y1 - 8));
    const v1TabX = 22;

    ctx.fillStyle = isV1Active ? "rgba(30, 41, 59, 0.96)" : "rgba(15, 23, 42, 0.92)";
    ctx.strokeStyle = isV1Active ? chColors.hover : chColors.main;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.roundRect(v1TabX, v1TabY, v1W, 16, 3);
    ctx.fill();
    ctx.stroke();

    // Left pointer notch
    ctx.fillStyle = isV1Active ? chColors.hover : chColors.main;
    ctx.beginPath();
    ctx.moveTo(v1TabX, y1 - 3);
    ctx.lineTo(v1TabX, y1 + 3);
    ctx.lineTo(v1TabX - 3, y1);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = isV1Active ? chColors.text : chColors.main;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(v1Text, v1TabX + v1W / 2, v1TabY + 8);

    // --- V2 Cursor ---
    const isV2Active = hovered === "V2" || dragging === "V2";
    ctx.strokeStyle = isV2Active ? chColors.hover : chColors.main;
    ctx.lineWidth = isV2Active ? 2 : 1.2;
    ctx.setLineDash(isV2Active ? [] : [4, 3]);

    if (isV2Active) {
      ctx.save();
      ctx.strokeStyle = chColors.glow;
      ctx.lineWidth = 5;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(0, y2);
      ctx.lineTo(width, y2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.beginPath();
    ctx.moveTo(0, y2);
    ctx.lineTo(width, y2);
    ctx.stroke();

    // Left Bezel Handle Tab for V2 (offset to x=22 to clear ground tags at x=0..18)
    const v2Text = `V2: ${formatCursorVoltage(v2Actual)}`;
    const v2W = Math.max(54, ctx.measureText(v2Text).width + 10);
    const v2TabY = Math.max(4, Math.min(height - 20, y2 - 8));
    const v2TabX = 22;

    ctx.fillStyle = isV2Active ? "rgba(30, 41, 59, 0.96)" : "rgba(15, 23, 42, 0.92)";
    ctx.strokeStyle = isV2Active ? chColors.hover : chColors.main;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.roundRect(v2TabX, v2TabY, v2W, 16, 3);
    ctx.fill();
    ctx.stroke();

    // Left pointer notch
    ctx.fillStyle = isV2Active ? chColors.hover : chColors.main;
    ctx.beginPath();
    ctx.moveTo(v2TabX, y2 - 3);
    ctx.lineTo(v2TabX, y2 + 3);
    ctx.lineTo(v2TabX - 3, y2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = isV2Active ? chColors.text : chColors.main;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(v2Text, v2TabX + v2W / 2, v2TabY + 8);
  }

  // 3. TRACK MODE WAVEFORM CROSSHAIR MARKERS
  if (isTrack) {
    const renderTrackTarget = (xPos: number, yPos: number, label: string, val: number) => {
      ctx.save();
      ctx.setLineDash([]);

      // Glowing outer ring in target channel color
      ctx.strokeStyle = chColors.main;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(xPos, yPos, 6, 0, Math.PI * 2);
      ctx.stroke();

      // Crosshair spokes
      ctx.beginPath();
      ctx.moveTo(xPos - 9, yPos);
      ctx.lineTo(xPos + 9, yPos);
      ctx.moveTo(xPos, yPos - 9);
      ctx.lineTo(xPos, yPos + 9);
      ctx.stroke();

      // Center solid dot
      ctx.fillStyle = chColors.text;
      ctx.beginPath();
      ctx.arc(xPos, yPos, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Track Tag next to target
      const tagText = `${label}: ${formatCursorVoltage(val)}`;
      ctx.font = "bold 8.5px var(--font-mono)";
      const tagW = ctx.measureText(tagText).width + 8;
      const tagX = Math.min(width - tagW - 4, xPos + 10);
      const tagY = Math.max(22, Math.min(height - 20, yPos - 8));

      ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
      ctx.strokeStyle = chColors.main;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(tagX, tagY, tagW, 16, 3);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = chColors.text;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(tagText, tagX + tagW / 2, tagY + 8);

      ctx.restore();
    };

    renderTrackTarget(x1, y1, "T1", v1Actual);
    renderTrackTarget(x2, y2, "T2", v2Actual);
  }

  ctx.restore();
}


export function drawWaveformHistogram(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  histogram: WaveformHistogram,
  color = "#FACC15",
): void {
  if (histogram.totalSamples === 0 || histogram.counts.length === 0) return;

  ctx.save();
  const maxCount = Math.max(1, ...histogram.counts);
  const barMaxWidth = Math.min(100, width * 0.22);
  const chartX = width - barMaxWidth - 10;
  const binCount = histogram.counts.length;
  const binHeight = height / binCount;

  ctx.fillStyle = "rgba(15, 23, 42, 0.65)";
  ctx.strokeStyle = "rgba(250, 204, 21, 0.25)";
  ctx.lineWidth = 1;
  ctx.fillRect(chartX - 5, 0, barMaxWidth + 15, height);
  ctx.strokeRect(chartX - 5, 0, barMaxWidth + 15, height);

  // Render horizontal density bars
  for (let i = 0; i < binCount; i++) {
    const count = histogram.counts[i];
    const barWidth = (count / maxCount) * barMaxWidth;
    // Map bin index (0 = minV, max = maxV) to canvas y coordinate (inverted)
    const y = height - (i + 1) * binHeight;

    ctx.fillStyle = color;
    ctx.globalAlpha = 0.45;
    ctx.fillRect(chartX, y, barWidth, binHeight - 1);

    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = color;
    ctx.strokeRect(chartX, y, barWidth, binHeight - 1);
  }

  // Label: Mean & StdDev HUD badge
  ctx.globalAlpha = 1.0;
  ctx.font = "bold 8px var(--font-mono)";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "right";
  ctx.fillText(`µ: ${histogram.mean.toFixed(2)}V`, width - 12, 14);
  ctx.fillText(`σ: ${histogram.stdDev.toFixed(2)}V`, width - 12, 26);

  ctx.restore();
}

export function drawMaskOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  results: readonly TimeStepResult[],
  _testNodeId: string,
  mask: MaskToleranceDefinition,
  voltsPerDiv: number,
  offsetPixels: number,
  timeDivValue: number,
  triggerStartIdx = 0,
  violations?: MaskTestResult,
): void {
  if (results.length < 2) return;

  const windowDuration = timeDivValue * 10;
  const firstTime = results[triggerStartIdx]?.time ?? 0;
  const divHeight = height / 8;
  const centerY = height / 2;

  ctx.save();

  // Draw shaded tolerance envelope
  ctx.fillStyle = "rgba(56, 189, 248, 0.12)";
  ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);

  const upperPoints: Array<{ x: number; y: number }> = [];
  const lowerPoints: Array<{ x: number; y: number }> = [];

  for (let i = triggerStartIdx; i < results.length; i++) {
    const pt = results[i];
    const relTime = pt.time - firstTime;
    if (relTime > windowDuration) break;

    const x = (relTime / windowDuration) * width;
    let refV = 0;
    if (mask.referenceNodeId) {
      refV = pt.nodeVoltages[mask.referenceNodeId] ?? 0;
    } else if (mask.centerPoints && mask.centerPoints.length > 0) {
      refV = mask.centerPoints[0].voltage;
    }

    const yUpper = centerY - ((refV + mask.deltaV) / voltsPerDiv) * divHeight - offsetPixels;
    const yLower = centerY - ((refV - mask.deltaV) / voltsPerDiv) * divHeight - offsetPixels;

    upperPoints.push({ x, y: yUpper });
    lowerPoints.push({ x, y: yLower });
  }

  if (upperPoints.length > 1) {
    ctx.beginPath();
    ctx.moveTo(upperPoints[0].x, upperPoints[0].y);
    for (let i = 1; i < upperPoints.length; i++) {
      ctx.lineTo(upperPoints[i].x, upperPoints[i].y);
    }
    for (let i = lowerPoints.length - 1; i >= 0; i--) {
      ctx.lineTo(lowerPoints[i].x, lowerPoints[i].y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Highlight violation points in red circles
  if (violations && violations.violationPoints.length > 0) {
    ctx.setLineDash([]);
    ctx.fillStyle = "#ef4444";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;

    for (const vPoint of violations.violationPoints) {
      const relTime = vPoint.time - firstTime;
      if (relTime < 0 || relTime > windowDuration) continue;
      const x = (relTime / windowDuration) * width;
      const y = centerY - (vPoint.voltage / voltsPerDiv) * divHeight - offsetPixels;

      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // Draw Mask Test Status Badge
  const pass = violations ? violations.passed : true;
  const statusText = pass ? "MASK: PASS" : `MASK: FAIL (${violations?.violationCount} err)`;
  const statusColor = pass ? "#22c55e" : "#ef4444";

  ctx.font = "bold 9px var(--font-mono)";
  const badgeW = ctx.measureText(statusText).width + 16;
  ctx.fillStyle = "rgba(10, 15, 25, 0.85)";
  ctx.strokeStyle = statusColor;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.roundRect(14, 12, badgeW, 18, 4);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = statusColor;
  ctx.textAlign = "left";
  ctx.fillText(statusText, 22, 24);

  ctx.restore();
}

/**
 * Renderiza un trazado ultra-suave interpolando puntos intermedios mediante curvas de Bézier cuadráticas,
 * eliminando los ángulos secos y logrando el aspecto orgánico y fluido de un osciloscopio analógico/digital de alta gama.
 */
export function renderSmoothTracePath(
  ctx: CanvasRenderingContext2D,
  points: readonly { x: number; y: number }[],
): void {
  const len = points.length;
  if (len < 2) return;
  if (len === 2) {
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    return;
  }

  ctx.moveTo(points[0].x, points[0].y);
  const hasQuad = typeof ctx.quadraticCurveTo === "function";
  for (let i = 0; i < len - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    if (hasQuad) {
      const midX = (p0.x + p1.x) / 2;
      const midY = (p0.y + p1.y) / 2;
      ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
    } else {
      ctx.lineTo(p0.x, p0.y);
    }
  }
  const last = points[len - 1];
  ctx.lineTo(last.x, last.y);
}

