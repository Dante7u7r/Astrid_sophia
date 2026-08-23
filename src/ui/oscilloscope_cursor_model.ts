export type OscilloscopeCursor = "T1" | "T2" | "V1" | "V2";

export interface CursorState {
  cursorT1: number;
  cursorT2: number;
  cursorV1: number;
  cursorV2: number;
}

export interface CursorScale {
  width: number;
  height: number;
  voltsPerDiv?: number;
  offsetPixels?: number;
  voltsPerDivCh1?: number; // Legacy backwards-compatibility
  offsetCh1?: number; // Legacy backwards-compatibility
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
  const pxT1 = state.cursorT1 * scale.width;
  const pxT2 = state.cursorT2 * scale.width;
  if (Math.abs(x - pxT1) < tolerance) return "T1";
  if (Math.abs(x - pxT2) < tolerance) return "T2";

  const centerY = scale.height / 2;
  const vPerDiv = getEffectiveVoltsPerDiv(scale);
  const offsetPx = getEffectiveOffsetPixels(scale);

  const pyV1 = centerY - (state.cursorV1 / vPerDiv) * (scale.height / 8) - offsetPx;
  const pyV2 = centerY - (state.cursorV2 / vPerDiv) * (scale.height / 8) - offsetPx;
  if (Math.abs(y - pyV1) < tolerance) return "V1";
  if (Math.abs(y - pyV2) < tolerance) return "V2";
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
    next.cursorT1 = Math.max(0.02, Math.min(0.98, x / scale.width));
  } else if (draggingCursor === "T2") {
    next.cursorT2 = Math.max(0.02, Math.min(0.98, x / scale.width));
  } else if (draggingCursor === "V1") {
    next.cursorV1 = ((centerY - offsetPx - y) / (scale.height / 8)) * vPerDiv;
  } else if (draggingCursor === "V2") {
    next.cursorV2 = ((centerY - offsetPx - y) / (scale.height / 8)) * vPerDiv;
  }
  return next;
}
