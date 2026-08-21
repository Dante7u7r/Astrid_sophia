export interface CanvasViewportController {
  resizeCanvas(): void;
  dispose(): void;
}

export interface CanvasViewportControllerDeps {
  canvasElement: HTMLCanvasElement;
  overlayCanvasElement?: HTMLCanvasElement | null;
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

    if (width <= 0 || height <= 0) return;

    const bufW = Math.round(width * dpr);
    const bufH = Math.round(height * dpr);

    if (bufW === prevCanvasWidth && bufH === prevCanvasHeight) return;

    prevCanvasWidth = bufW;
    prevCanvasHeight = bufH;
    deps.canvasElement.width = bufW;
    deps.canvasElement.height = bufH;
    if (deps.overlayCanvasElement) {
      deps.overlayCanvasElement.width = bufW;
      deps.overlayCanvasElement.height = bufH;
    }
    deps.requestAnimationFrame(() => deps.requestRender());
  };

  const onVisibilityOrFocus = (): void => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      syncCanvasDimensions();
    }
  };

  if (viewport) {
    resizeObserver = deps.createResizeObserver(() => syncCanvasDimensions());
    resizeObserver.observe(viewport);
  }

  if (typeof window !== "undefined") {
    window.addEventListener("resize", syncCanvasDimensions);
    window.addEventListener("focus", syncCanvasDimensions);
    window.addEventListener("pageshow", syncCanvasDimensions);
    document.addEventListener("visibilitychange", onVisibilityOrFocus);
  }

  syncCanvasDimensions();

  return {
    resizeCanvas: syncCanvasDimensions,
    dispose: () => {
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", syncCanvasDimensions);
        window.removeEventListener("focus", syncCanvasDimensions);
        window.removeEventListener("pageshow", syncCanvasDimensions);
        document.removeEventListener("visibilitychange", onVisibilityOrFocus);
      }
    },
  };
}
