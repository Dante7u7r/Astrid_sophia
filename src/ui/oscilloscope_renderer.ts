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

export function drawTyReticle(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): { divWidth: number; divHeight: number } {
  const divWidth = width / 10;
  const divHeight = height / 8;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += divWidth) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += divHeight) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.moveTo(width / 2, 0);
  ctx.lineTo(width / 2, height);
  ctx.stroke();
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
  const label = `${deltaSymbol}t: ${(deltaTime * 1_000).toFixed(2)} ms | 1/${deltaSymbol}t: ${frequency.toFixed(1)} Hz | ${deltaSymbol}V: ${deltaVoltage.toFixed(2)} V`;
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
