// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createCanvasViewportController } from "./canvas_viewport_controller";

class TestResizeObserver implements ResizeObserver {
  static callback: ResizeObserverCallback | null = null;
  observed: Element | null = null;

  constructor(callback: ResizeObserverCallback) {
    TestResizeObserver.callback = callback;
  }

  observe(target: Element): void {
    this.observed = target;
  }

  unobserve(): void {
    this.observed = null;
  }

  disconnect(): void {
    this.observed = null;
  }
}

afterEach(() => {
  document.body.innerHTML = "";
  TestResizeObserver.callback = null;
  vi.restoreAllMocks();
});

describe("CanvasViewportController", () => {
  it("sincroniza el buffer del canvas con el viewport y evita renders duplicados", () => {
    document.body.innerHTML = `<div id="viewport"><canvas id="canvas"></canvas></div>`;
    const viewport = document.querySelector<HTMLElement>("#viewport")!;
    const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
    const render = vi.fn();

    Object.defineProperty(viewport, "clientWidth", { configurable: true, value: 320 });
    Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 180 });

    const controller = createCanvasViewportController({
      canvasElement: canvas,
      requestRender: render,
      requestAnimationFrame: (callback) => {
        callback(0);
        return 1;
      },
      devicePixelRatio: () => 2,
      createResizeObserver: (callback) => new TestResizeObserver(callback),
    });

    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(360);
    expect(render).toHaveBeenCalledTimes(1);

    controller.resizeCanvas();

    expect(render).toHaveBeenCalledTimes(1);
  });
});
