import { buildTyTracePoints, selectTraceSampleIndices } from "./oscilloscope_model";
import type { AcSweepResult, PvtTrace, TimeStepResult } from "./oscilloscope_panel";

export interface OscilloscopeChannelView {
  node: string | null;
  color: string;
  active: boolean;
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

  ctx.strokeStyle = "rgba(102, 252, 241, 0.08)";
  ctx.lineWidth = 1;
  for (const decade of [10, 100, 1_000, 10_000, 100_000]) {
    if (decade < fMin || decade > fMax) continue;
    const x = ((Math.log10(decade) - logMin) / logRange) * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height - 15);
    ctx.stroke();
    ctx.fillStyle = "rgba(102, 252, 241, 0.4)";
    ctx.font = "9px var(--font-sans)";
    ctx.textAlign = "center";
    ctx.fillText(decade >= 1_000 ? `${decade / 1_000} kHz` : `${decade} Hz`, x, height - 4);
  }

  for (const channel of channels) {
    if (!channel.active || !channel.node) continue;
    const amplitudes = results.nodeAmplitudes[channel.node];
    if (!amplitudes?.length) continue;

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
): void {
  ctx.strokeStyle = "rgba(102, 252, 241, 0.05)";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "#66fcf1";
  ctx.lineWidth = 2.5;
  ctx.shadowColor = "#66fcf1";
  ctx.shadowBlur = 6;
  ctx.beginPath();
  const indices = selectTraceSampleIndices(
    results.length,
    Math.max(64, Math.min(4_000, Math.ceil(width * 2))),
  );
  for (let sampleIndex = 0; sampleIndex < indices.length; sampleIndex++) {
    const point = results[indices[sampleIndex]];
    const x = width / 2 + ((point.nodeVoltages[xNode] ?? 0) / xVoltsPerDiv) * (width / 10) + xOffset;
    const y = height / 2 - ((point.nodeVoltages[yNode] ?? 0) / yVoltsPerDiv) * (height / 8) - yOffset;
    if (sampleIndex === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
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

  // 1. High-precision Dotted Sub-grid
  ctx.save();
  ctx.strokeStyle = "rgba(56, 189, 248, 0.12)";
  ctx.lineWidth = 1;
  ctx.setLineDash([1, 4]);

  for (let x = divWidth; x < width - 1; x += divWidth) {
    const rx = Math.floor(x) + 0.5;
    ctx.beginPath();
    ctx.moveTo(rx, 0);
    ctx.lineTo(rx, height);
    ctx.stroke();
  }

  for (let y = divHeight; y < height - 1; y += divHeight) {
    const ry = Math.floor(y) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, ry);
    ctx.lineTo(width, ry);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 2. Primary Center Crosshairs (Continuous glowing axis)
  const centerX = Math.floor(width / 2) + 0.5;
  const centerY = Math.floor(height / 2) + 0.5;

  ctx.strokeStyle = "rgba(56, 189, 248, 0.35)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.moveTo(centerX, 0);
  ctx.lineTo(centerX, height);
  ctx.stroke();

  // 3. Calibration Tick marks along center axes (5 sub-ticks per division)
  const subDivX = divWidth / 5;
  ctx.strokeStyle = "rgba(56, 189, 248, 0.55)";
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
    const statusText = trig.paused ? "STOP" : trig.triggered ? "TRIG'D" : trig.mode.toUpperCase();
    const statusColor = trig.paused ? "#f43f5e" : trig.triggered ? "#22c55e" : "#38bdf8";

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
    ctx.strokeStyle = trace.color;
    ctx.lineWidth = 1.8;
    ctx.shadowColor = trace.color;
    ctx.shadowBlur = 3;
    ctx.beginPath();
    const points = buildTyTracePoints(
      trace.results,
      node,
      { width, height },
      { voltsPerDiv, offsetPixels, timeDivValue },
      0,
    );
    for (let index = 0; index < points.length; index++) {
      if (index === 0) ctx.moveTo(points[index].x, points[index].y);
      else ctx.lineTo(points[index].x, points[index].y);
    }
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
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

  ctx.save();

  // Draw each channel's sub-grid
  for (let k = 0; k < n; k++) {
    const ch = activeChannels[k];
    const topY = k * slotHeight;
    const centerY = topY + slotHeight / 2;
    const divHeight = slotHeight / 8;

    // Slot separator
    if (k > 0) {
      ctx.strokeStyle = "rgba(56, 189, 248, 0.35)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, Math.floor(topY) + 0.5);
      ctx.lineTo(width, Math.floor(topY) + 0.5);
      ctx.stroke();
    }

    // Dotted sub-grid for this slot
    ctx.strokeStyle = "rgba(56, 189, 248, 0.08)";
    ctx.lineWidth = 1;
    ctx.setLineDash([1, 4]);
    for (let x = divWidth; x < width - 1; x += divWidth) {
      const rx = Math.floor(x) + 0.5;
      ctx.beginPath();
      ctx.moveTo(rx, topY);
      ctx.lineTo(rx, topY + slotHeight);
      ctx.stroke();
    }
    for (let y = divHeight; y < slotHeight - 1; y += divHeight) {
      const ry = Math.floor(topY + y) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, ry);
      ctx.lineTo(width, ry);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Center sub-axis
    ctx.strokeStyle = "rgba(56, 189, 248, 0.25)";
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
    const statusText = trigger.paused ? "STOP" : trigger.triggered ? "TRIG'D" : trigger.mode.toUpperCase();
    const statusColor = trigger.paused ? "#f43f5e" : trigger.triggered ? "#22c55e" : "#38bdf8";

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
  signalPeriod?: number,
): void {
  ctx.strokeStyle = "rgba(251, 191, 36, 0.7)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  const x1 = cursorT1 * width;
  const x2 = cursorT2 * width;
  ctx.beginPath();
  ctx.moveTo(x1, 0);
  ctx.lineTo(x1, height);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, 0);
  ctx.lineTo(x2, height);
  ctx.stroke();
  ctx.fillStyle = "rgba(251, 191, 36, 0.9)";
  ctx.font = "8px var(--font-mono)";
  ctx.fillText("t1", x1 + 4, 12);
  ctx.fillText("t2", x2 + 4, 12);

  const centerY = height / 2;
  const y1 = centerY - (cursorV1 / voltsPerDiv) * divHeight - voltageOffset;
  const y2 = centerY - (cursorV2 / voltsPerDiv) * divHeight - voltageOffset;
  ctx.strokeStyle = "rgba(244, 63, 94, 0.7)";
  ctx.beginPath();
  ctx.moveTo(0, y1);
  ctx.lineTo(width, y1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, y2);
  ctx.lineTo(width, y2);
  ctx.stroke();
  ctx.fillStyle = "rgba(244, 63, 94, 0.9)";
  ctx.fillText("v1", 4, y1 - 4);
  ctx.fillText("v2", 4, y2 - 4);
  ctx.setLineDash([]);

  const deltaTime = Math.abs(cursorT2 - cursorT1) * timeDivValue * 10;
  const deltaVoltage = Math.abs(cursorV2 - cursorV1);
  const frequency = deltaTime > 0 ? 1 / deltaTime : 0;
  const deltaSymbol = "\u0394";
  let label = `${deltaSymbol}t: ${(deltaTime * 1_000).toFixed(2)} ms | 1/${deltaSymbol}t: ${frequency.toFixed(1)} Hz | ${deltaSymbol}V: ${deltaVoltage.toFixed(2)} V`;
  if (signalPeriod && signalPeriod > 0) {
    const phaseDeg = ((deltaTime / signalPeriod) * 360) % 360;
    label += ` | Phase \u03B8: ${phaseDeg.toFixed(1)}\u00B0`;
  }

  ctx.font = "bold 9px var(--font-sans)";
  const textWidth = ctx.measureText(label).width;
  ctx.fillStyle = "rgba(10, 15, 25, 0.9)";
  ctx.strokeStyle = "rgba(251, 191, 36, 0.5)";
  ctx.beginPath();
  ctx.roundRect(width / 2 - textWidth / 2 - 8, 12, textWidth + 16, 18, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "hsl(174, 97%, 69%)";
  ctx.textAlign = "center";
  ctx.fillText(label, width / 2, 24);
}
