import type { BoundingBox, ComponentInstance, Point2D, WireInstance } from "../canvas_orchestrator";
import { getComponentBounds } from "./component_geometry";

export interface CameraState {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export interface CameraLimits {
  minZoom: number;
  maxZoom: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export function screenToWorld(
  screenX: number,
  screenY: number,
  camera: CameraState,
): Point2D {
  return {
    x: (screenX - camera.offsetX) / camera.zoom,
    y: (screenY - camera.offsetY) / camera.zoom,
  };
}

export function worldToScreen(
  worldX: number,
  worldY: number,
  camera: CameraState,
): Point2D {
  return {
    x: worldX * camera.zoom + camera.offsetX,
    y: worldY * camera.zoom + camera.offsetY,
  };
}

export function snapToGrid(coord: number, gridSize: number): number {
  return Math.round(coord / gridSize) * gridSize;
}

export function snapPointToGrid(point: Point2D, gridSize: number): Point2D {
  return {
    x: snapToGrid(point.x, gridSize),
    y: snapToGrid(point.y, gridSize),
  };
}

export function generateOrthogonalPath(start: Point2D, end: Point2D, gridSize: number): Point2D[] {
  const pts: Point2D[] = [{ x: start.x, y: start.y }];
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);

  if (dx < 0.1 || dy < 0.1) {
    pts.push({ x: end.x, y: end.y });
    return pts;
  }

  if (dx >= dy) {
    const midX = start.x + (end.x - start.x) / 2;
    pts.push(snapPointToGrid({ x: midX, y: start.y }, gridSize));
    pts.push(snapPointToGrid({ x: midX, y: end.y }, gridSize));
  } else {
    const midY = start.y + (end.y - start.y) / 2;
    pts.push(snapPointToGrid({ x: start.x, y: midY }, gridSize));
    pts.push(snapPointToGrid({ x: end.x, y: midY }, gridSize));
  }
  pts.push({ x: end.x, y: end.y });
  return pts;
}

export function getVisibleWorldBounds(camera: CameraState, viewport: ViewportSize): BoundingBox {
  const topLeft = screenToWorld(0, 0, camera);
  const bottomRight = screenToWorld(viewport.width, viewport.height, camera);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

export function boundsIntersect(a: BoundingBox, b: BoundingBox): boolean {
  return (
    a.x + a.width >= b.x &&
    a.x <= b.x + b.width &&
    a.y + a.height >= b.y &&
    a.y <= b.y + b.height
  );
}

export function isVisible(box: BoundingBox, camera: CameraState, viewport: ViewportSize): boolean {
  return boundsIntersect(box, getVisibleWorldBounds(camera, viewport));
}

export function getCircuitGeometricCenter(components: readonly ComponentInstance[]): Point2D {
  if (components.length === 0) return { x: 0, y: 0 };

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const comp of components) {
    const bounds = getComponentBounds(comp);
    minX = Math.min(minX, bounds.x);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    minY = Math.min(minY, bounds.y);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  };
}

export function clampCameraOffsets(
  camera: CameraState,
  center: Point2D,
  viewport: ViewportSize,
): CameraState {
  const minOffsetX = -center.x * camera.zoom;
  const maxOffsetX = viewport.width - center.x * camera.zoom;
  const minOffsetY = -center.y * camera.zoom;
  const maxOffsetY = viewport.height - center.y * camera.zoom;

  return {
    zoom: camera.zoom,
    offsetX: Math.min(Math.max(camera.offsetX, minOffsetX), maxOffsetX),
    offsetY: Math.min(Math.max(camera.offsetY, minOffsetY), maxOffsetY),
  };
}

export function zoomAt(
  camera: CameraState,
  limits: CameraLimits,
  viewport: ViewportSize,
  center: Point2D,
  zoomFactor: number,
  screenTarget: Point2D,
): CameraState {
  const worldTarget = screenToWorld(screenTarget.x, screenTarget.y, camera);
  const nextZoom = Math.min(Math.max(camera.zoom * zoomFactor, limits.minZoom), limits.maxZoom);
  if (nextZoom === camera.zoom) return camera;

  return clampCameraOffsets(
    {
      zoom: nextZoom,
      offsetX: screenTarget.x - worldTarget.x * nextZoom,
      offsetY: screenTarget.y - worldTarget.y * nextZoom,
    },
    center,
    viewport,
  );
}

export function getCircuitBounds(
  components: readonly ComponentInstance[],
  wires: readonly WireInstance[],
  margin = 40,
): BoundingBox | null {
  if (components.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const comp of components) {
    const bounds = getComponentBounds(comp);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }

  for (const wire of wires) {
    for (const pt of wire.points) {
      minX = Math.min(minX, pt.x);
      minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x);
      maxY = Math.max(maxY, pt.y);
    }
  }

  return {
    x: minX - margin,
    y: minY - margin,
    width: maxX - minX + margin * 2,
    height: maxY - minY + margin * 2,
  };
}

export function fitBoundsToViewport(
  bounds: BoundingBox,
  viewport: ViewportSize,
  limits: CameraLimits,
): CameraState | null {
  if (bounds.width <= 0 || bounds.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return null;
  }

  const zoomX = viewport.width / bounds.width;
  const zoomY = viewport.height / bounds.height;
  const zoom = Math.max(Math.min(zoomX, zoomY, limits.maxZoom), limits.minZoom);
  const minX = bounds.x;
  const minY = bounds.y;
  const maxX = bounds.x + bounds.width;
  const maxY = bounds.y + bounds.height;

  return {
    zoom,
    offsetX: (viewport.width - (minX + maxX) * zoom) / 2,
    offsetY: (viewport.height - (minY + maxY) * zoom) / 2,
  };
}
