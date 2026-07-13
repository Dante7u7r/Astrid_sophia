import type { BoundingBox, ComponentInstance } from "../canvas_orchestrator";
import { getComponentBounds } from "./component_geometry";
import { boundsIntersect } from "./viewport_camera";

export type RenderDetail = "full" | "compact";

export interface CanvasBufferSize {
  bufferWidth: number;
  bufferHeight: number;
}

export interface GridRenderPlan {
  startX: number;
  endX: number;
  startY: number;
  endY: number;
  gridStep: number;
  dotSize: number;
  cacheKey: string;
}

export function getCanvasBufferSize(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): CanvasBufferSize {
  return {
    bufferWidth: Math.round(cssWidth * dpr),
    bufferHeight: Math.round(cssHeight * dpr),
  };
}

export function ensureCanvasBuffer(
  canvas: HTMLCanvasElement,
  dpr: number,
): CanvasBufferSize {
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  const size = getCanvasBufferSize(cssWidth, cssHeight, dpr);

  if (canvas.width !== size.bufferWidth || canvas.height !== size.bufferHeight) {
    canvas.width = size.bufferWidth;
    canvas.height = size.bufferHeight;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
  }

  return size;
}

export function createComponentLookup(
  components: readonly ComponentInstance[],
): Map<string, ComponentInstance> {
  return new Map(components.map(component => [component.id, component]));
}

export function getVisibleComponents(
  components: readonly ComponentInstance[],
  visibleWorldBounds: BoundingBox,
): ComponentInstance[] {
  return components.filter((component) => boundsIntersect(
    getComponentBounds(component),
    visibleWorldBounds,
  ));
}

export function createSelectedComponentIds(
  selectedComponents: readonly ComponentInstance[],
): Set<string> {
  return new Set(selectedComponents.map(component => component.id));
}

export function resolveRenderDetail(
  zoom: number,
  visibleComponentCount: number,
): RenderDetail {
  if (zoom < 0.55) return "compact";
  if (visibleComponentCount > 360 && zoom < 0.85) return "compact";
  return "full";
}

export function createGridRenderPlan(options: {
  topLeft: { x: number; y: number };
  bottomRight: { x: number; y: number };
  gridSize: number;
  zoom: number;
  maxGridDots?: number;
}): GridRenderPlan | null {
  const { topLeft, bottomRight, gridSize, zoom } = options;
  if (gridSize <= 0 || zoom <= 0 || !Number.isFinite(zoom)) return null;

  const startX = Math.floor(topLeft.x / gridSize) * gridSize;
  const endX = Math.ceil(bottomRight.x / gridSize) * gridSize;
  const startY = Math.floor(topLeft.y / gridSize) * gridSize;
  const endY = Math.ceil(bottomRight.y / gridSize) * gridSize;
  if (![startX, endX, startY, endY].every(Number.isFinite)) return null;

  const columns = Math.max(0, Math.floor((endX - startX) / gridSize) + 1);
  const rows = Math.max(0, Math.floor((endY - startY) / gridSize) + 1);
  const maxGridDots = options.maxGridDots ?? 8000;
  const densityStep = columns * rows > maxGridDots
    ? Math.ceil(Math.sqrt((columns * rows) / maxGridDots))
    : 1;
  const gridStep = gridSize * densityStep;
  const dotSize = Math.max(0.7, 1.5 / zoom);
  const cacheKey = [
    startX,
    endX,
    startY,
    endY,
    gridStep,
    dotSize.toFixed(3),
  ].join(":");

  return { startX, endX, startY, endY, gridStep, dotSize, cacheKey };
}
