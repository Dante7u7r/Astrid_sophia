export interface CanvasViewportController {
  resizeCanvas(): void;
  dispose(): void;
}

export interface CanvasViewportControllerDeps {
  canvasElement: HTMLCanvasElement;
  requestRender(): void;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  devicePixelRatio(): number;
  createResizeObserver(callback: ResizeObserverCallback): ResizeObserver;
}

export function createCanvasViewportController(
  deps: CanvasViewportControllerDeps,
): CanvasViewportController {
  const viewport = deps.canvasElement.parentElement;
  let prevCanvasWidth = -1;
  let prevCanvasHeight = -1;
  let resizeObserver: ResizeObserver | null = null;

  const syncCanvasDimensions = (): void => {
    if (!viewport) return;

    const dpr = deps.devicePixelRatio();
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    const bufW = Math.round(width * dpr);
    const bufH = Math.round(height * dpr);

    if (bufW === prevCanvasWidth && bufH === prevCanvasHeight) return;

    prevCanvasWidth = bufW;
    prevCanvasHeight = bufH;
    deps.canvasElement.width = bufW;
    deps.canvasElement.height = bufH;
    deps.requestAnimationFrame(() => deps.requestRender());
  };

  if (viewport) {
    resizeObserver = deps.createResizeObserver(() => syncCanvasDimensions());
    resizeObserver.observe(viewport);
  }

  syncCanvasDimensions();

  return {
    resizeCanvas: syncCanvasDimensions,
    dispose: () => {
      resizeObserver?.disconnect();
      resizeObserver = null;
    },
  };
}
