import type { ComponentInstance, Point2D } from "../canvas_orchestrator";

export interface ScreenPoint {
  screenX: number;
  screenY: number;
}

export interface ClientPoint {
  clientX: number;
  clientY: number;
}

export interface ZoomLimits {
  minZoom: number;
  maxZoom: number;
}

export interface ZoomStep {
  zoomFactor: number;
  clampedZoom: number;
}

export interface PaletteComponentData {
  type: ComponentInstance["type"];
  value: ComponentInstance["value"];
}

export function clientToCanvasPoint(
  rect: Pick<DOMRect, "left" | "top">,
  point: ClientPoint,
): ScreenPoint {
  return {
    screenX: point.clientX - rect.left,
    screenY: point.clientY - rect.top,
  };
}

export function resolveWheelZoomStep(
  deltaY: number,
  currentZoom: number,
  limits: ZoomLimits,
): ZoomStep {
  const requestedFactor = deltaY < 0 ? 1.1 : 0.9;
  const requestedZoom = currentZoom * requestedFactor;
  const clampedZoom = Math.min(Math.max(requestedZoom, limits.minZoom), limits.maxZoom);
  return {
    zoomFactor: clampedZoom / currentZoom,
    clampedZoom,
  };
}

export function hasCanvasSelection(state: {
  selectedComponents: readonly ComponentInstance[];
  selectedComponent: ComponentInstance | null;
  selectedWire: unknown | null;
}): boolean {
  return state.selectedComponents.length > 0
    || state.selectedComponent !== null
    || state.selectedWire !== null;
}

export function parsePaletteComponentData(dataset: DOMStringMap): PaletteComponentData {
  const rawValue = dataset.default || "1000";
  const numericValue = Number.parseFloat(rawValue);
  return {
    type: (dataset.type || "resistor") as ComponentInstance["type"],
    value: Number.isFinite(numericValue) ? numericValue : rawValue,
  };
}

export function isPointInsideRect(
  rect: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  point: ClientPoint,
): boolean {
  return point.clientX >= rect.left
    && point.clientX <= rect.right
    && point.clientY >= rect.top
    && point.clientY <= rect.bottom;
}

export function shouldStartPaletteDrag(
  start: Point2D,
  current: Point2D,
  threshold = 6,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}
