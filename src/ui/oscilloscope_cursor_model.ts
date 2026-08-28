import { extractSampleVoltage } from "./oscilloscope_model";
import type { TimeStepResult } from "./oscilloscope_panel";

export type CursorMode = "off" | "time" | "voltage" | "both" | "track";
export type OscilloscopeCursor = "T1" | "T2" | "V1" | "V2";

export interface CursorState {
  cursorT1: number;
  cursorT2: number;
  cursorV1: number;
  cursorV2: number;
  mode?: CursorMode;
  hoveredCursor?: OscilloscopeCursor | null;
}

export interface CursorScale {
  width: number;
  height: number;
  voltsPerDiv?: number;
  offsetPixels?: number;
  voltsPerDivCh1?: number; // Legacy backwards-compatibility
  offsetCh1?: number; // Legacy backwards-compatibility
  timeDivValue?: number;
  mode?: CursorMode;
}

export function getEffectiveVoltsPerDiv(scale: CursorScale): number {
  return scale.voltsPerDiv ?? scale.voltsPerDivCh1 ?? 1.0;
}

export function getEffectiveOffsetPixels(scale: CursorScale): number {
  return scale.offsetPixels ?? scale.offsetCh1 ?? 0.0;
}

export function hitTestOscilloscopeCursor(
  x: number,
  y: number,
  state: CursorState,
  scale: CursorScale,
  tolerance = 8,
): OscilloscopeCursor | null {
  const mode = scale.mode ?? state.mode ?? "both";
  if (mode === "off") return null;

  const testTime = mode === "time" || mode === "both" || mode === "track";
  const testVoltage = mode === "voltage" || mode === "both";

  const pxT1 = state.cursorT1 * scale.width;
  const pxT2 = state.cursorT2 * scale.width;

  const centerY = scale.height / 2;
  const vPerDiv = getEffectiveVoltsPerDiv(scale);
  const offsetPx = getEffectiveOffsetPixels(scale);

  const pyV1 = centerY - (state.cursorV1 / vPerDiv) * (scale.height / 8) - offsetPx;
  const pyV2 = centerY - (state.cursorV2 / vPerDiv) * (scale.height / 8) - offsetPx;

  // 1. Time Cursors & Bottom Bezel Tabs Check (avoids top HUD collision)
  if (testTime) {
    const handleTol = Math.max(tolerance * 1.5, 14);
    if (y >= scale.height - 24 && Math.abs(x - pxT1) < handleTol) return "T1";
    if (y >= scale.height - 24 && Math.abs(x - pxT2) < handleTol) return "T2";
    if (Math.abs(x - pxT1) < tolerance) return "T1";
    if (Math.abs(x - pxT2) < tolerance) return "T2";
  }

  // 2. Voltage Cursors & Left Bezel Tabs Check (shifted to x = 20..80 to avoid ground marker collision)
  if (testVoltage) {
    const handleTol = Math.max(tolerance * 1.5, 14);
    if (x >= 20 && x <= 80 && Math.abs(y - pyV1) < handleTol) return "V1";
    if (x >= 20 && x <= 80 && Math.abs(y - pyV2) < handleTol) return "V2";
    if (Math.abs(y - pyV1) < tolerance) return "V1";
    if (Math.abs(y - pyV2) < tolerance) return "V2";
  }

  return null;
}

export function dragOscilloscopeCursor(
  draggingCursor: OscilloscopeCursor,
  x: number,
  y: number,
  state: CursorState,
  scale: CursorScale,
): CursorState {
  const next = { ...state };
  const vPerDiv = getEffectiveVoltsPerDiv(scale);
  const offsetPx = getEffectiveOffsetPixels(scale);
  const centerY = scale.height / 2;

  if (draggingCursor === "T1") {
    next.cursorT1 = Math.max(0.01, Math.min(0.99, x / scale.width));
  } else if (draggingCursor === "T2") {
    next.cursorT2 = Math.max(0.01, Math.min(0.99, x / scale.width));
  } else if (draggingCursor === "V1") {
    next.cursorV1 = ((centerY - offsetPx - y) / (scale.height / 8)) * vPerDiv;
  } else if (draggingCursor === "V2") {
    next.cursorV2 = ((centerY - offsetPx - y) / (scale.height / 8)) * vPerDiv;
  }
  return next;
}

export function sampleVoltageAtNormalizedTime(
  results: readonly TimeStepResult[],
  nodeId: string | null | undefined,
  normTime: number,
  timeDivValue: number,
  triggerStartIdx = 0,
): number {
  if (!results.length || !nodeId) return 0.0;
  const startIdx = Math.max(0, Math.min(results.length - 1, triggerStartIdx));
  const t0 = results[startIdx]?.time ?? 0.0;
  const windowDuration = timeDivValue * 10;
  const targetTime = t0 + Math.max(0, Math.min(1, normTime)) * windowDuration;

  let low = startIdx;
  let high = results.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (results[mid].time < targetTime) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const idxAfter = Math.min(results.length - 1, Math.max(0, low));
  const idxBefore = Math.max(0, idxAfter - 1);

  const sampleA = results[idxBefore];
  const sampleB = results[idxAfter];

  if (!sampleA || !sampleB || idxBefore === idxAfter) {
    return extractSampleVoltage(sampleA?.nodeVoltages, nodeId);
  }

  const tA = sampleA.time;
  const tB = sampleB.time;
  const vA = extractSampleVoltage(sampleA.nodeVoltages, nodeId);
  const vB = extractSampleVoltage(sampleB.nodeVoltages, nodeId);

  if (Math.abs(tB - tA) <= 1e-18) return vA;
  const frac = Math.max(0, Math.min(1, (targetTime - tA) / (tB - tA)));
  return vA + frac * (vB - vA);
}

export function sampleArrayAtNormalizedTime(
  results: readonly TimeStepResult[],
  values: ArrayLike<number>,
  normTime: number,
  timeDivValue: number,
  triggerStartIdx = 0,
): number {
  if (!results.length || !values.length) return 0.0;
  const startIdx = Math.max(0, Math.min(results.length - 1, triggerStartIdx));
  const t0 = results[startIdx]?.time ?? 0.0;
  const windowDuration = timeDivValue * 10;
  const targetTime = t0 + Math.max(0, Math.min(1, normTime)) * windowDuration;

  let low = startIdx;
  let high = results.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (results[mid].time < targetTime) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const idxAfter = Math.min(results.length - 1, Math.max(0, low));
  const idxBefore = Math.max(0, idxAfter - 1);

  const sampleA = results[idxBefore];
  const sampleB = results[idxAfter];

  if (!sampleA || !sampleB || idxBefore === idxAfter) {
    return values[idxBefore] ?? 0.0;
  }

  const tA = sampleA.time;
  const tB = sampleB.time;
  const vA = values[idxBefore] ?? 0.0;
  const vB = values[idxAfter] ?? 0.0;

  if (Math.abs(tB - tA) <= 1e-18) return vA;
  const frac = Math.max(0, Math.min(1, (targetTime - tA) / (tB - tA)));
  return vA + frac * (vB - vA);
}


