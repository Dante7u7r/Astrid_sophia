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
  modelName?: string;
  pinCount?: number;
  pinLabels?: Record<number, string>;
  spiceNetlist?: string;
}

export function clientToCanvasPoint(
  rect: Pick<DOMRect, "left" | "top">,
  point: Partial<ClientPoint>,
): ScreenPoint {
  return {
    screenX: (point.clientX ?? 0) - (rect.left ?? 0),
    screenY: (point.clientY ?? 0) - (rect.top ?? 0),
  };
}

export function resolveWheelZoomStep(
  deltaY: number,
  currentZoom: number,
  limits: ZoomLimits,
  isPinch = false,
): ZoomStep {
  let requestedFactor: number;
  if (isPinch) {
    const rawFactor = Math.exp(-deltaY * 0.0035);
    requestedFactor = Math.min(Math.max(rawFactor, 0.90), 1.10);
  } else {
    requestedFactor = deltaY < 0 ? 1.1 : 0.9;
  }
  const requestedZoom = currentZoom * requestedFactor;
  const clampedZoom = Math.min(Math.max(requestedZoom, limits.minZoom), limits.maxZoom);
  return {
    zoomFactor: clampedZoom / currentZoom,
    clampedZoom,
  };
}

export function resolveTouchPinchStep(
  prevDistance: number,
  currDistance: number,
  currentZoom: number,
  limits: ZoomLimits,
): ZoomStep {
  if (prevDistance <= 0 || currDistance <= 0) {
    return { zoomFactor: 1, clampedZoom: currentZoom };
  }
  const ratio = currDistance / prevDistance;
  const requestedZoom = currentZoom * ratio;
  const clampedZoom = Math.min(Math.max(requestedZoom, limits.minZoom), limits.maxZoom);
  return {
    zoomFactor: clampedZoom / currentZoom,
    clampedZoom,
  };
}

export function resolveTouchPanStep(
  prevMidpoint: Point2D,
  currMidpoint: Point2D,
): Point2D {
  return {
    x: currMidpoint.x - prevMidpoint.x,
    y: currMidpoint.y - prevMidpoint.y,
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
  let pinLabels: Record<number, string> | undefined;
  if (dataset.pinLabels) {
    try {
      pinLabels = JSON.parse(dataset.pinLabels);
    } catch {
      pinLabels = undefined;
    }
  }

  const pinCountNum = dataset.pinCount ? parseInt(dataset.pinCount, 10) : undefined;

  return {
    type: (dataset.type || "resistor") as ComponentInstance["type"],
    value: Number.isFinite(numericValue) ? numericValue : rawValue,
    modelName: dataset.modelName,
    pinCount: Number.isFinite(pinCountNum) ? pinCountNum : undefined,
    pinLabels,
    spiceNetlist: dataset.spiceNetlist,
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
