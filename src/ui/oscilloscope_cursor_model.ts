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
  voltsPerDivCh1: number;
  offsetCh1: number;
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
  const pyV1 = centerY - (state.cursorV1 / scale.voltsPerDivCh1) * (scale.height / 8) - scale.offsetCh1;
  const pyV2 = centerY - (state.cursorV2 / scale.voltsPerDivCh1) * (scale.height / 8) - scale.offsetCh1;
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
  if (draggingCursor === "T1") {
    next.cursorT1 = Math.max(0.02, Math.min(0.98, x / scale.width));
  } else if (draggingCursor === "T2") {
    next.cursorT2 = Math.max(0.02, Math.min(0.98, x / scale.width));
  } else if (draggingCursor === "V1") {
    const centerY = scale.height / 2;
    next.cursorV1 = ((centerY - scale.offsetCh1 - y) / (scale.height / 8)) * scale.voltsPerDivCh1;
  } else if (draggingCursor === "V2") {
    const centerY = scale.height / 2;
    next.cursorV2 = ((centerY - scale.offsetCh1 - y) / (scale.height / 8)) * scale.voltsPerDivCh1;
  }
  return next;
}
