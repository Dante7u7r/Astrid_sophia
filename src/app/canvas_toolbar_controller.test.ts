// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { initCanvasToolbarController } from "./canvas_toolbar_controller";
import type { OscilloscopePanel } from "../ui/oscilloscope_panel";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function setupDom(): HTMLCanvasElement {
  document.body.innerHTML = `
    <button id="btn-clear-canvas"></button>
    <button id="btn-zoom-in"></button>
    <button id="btn-zoom-out"></button>
    <button id="btn-snap-grid" class="btn-active"></button>
    <canvas id="canvas"></canvas>
  `;

  const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
  Object.defineProperty(canvas, "clientWidth", { configurable: true, value: 400 });
  Object.defineProperty(canvas, "clientHeight", { configurable: true, value: 200 });
  return canvas;
}

describe("CanvasToolbarController", () => {
  it("limpia lienzo, resultados y voltajes", () => {
    const canvas = setupDom();
    const orchestrator = {
      components: [{ id: "R1" }],
      wires: [{ id: "W1" }],
      selectedComponent: { id: "R1" },
      gridSize: 20,
      zoomAt: vi.fn(),
    };
    const panel = {
      transientResults: [{ time: 0, voltages: {} }],
      acSweepResults: { frequencies: [], magnitudes: [], phases: [] },
      sweepTime: 1,
    } as unknown as OscilloscopePanel;
    const clearVoltages = vi.fn();
    const render = vi.fn();
    const markModified = vi.fn();

    initCanvasToolbarController({
      canvasElement: canvas,
      getOrchestrator: () => orchestrator,
      getOscilloscopePanel: () => panel,
      clearVoltages,
      resetPerformanceCaches: vi.fn(),
      updateCanvasRendering: render,
      markCurrentTabAsModified: markModified,
      addLog: vi.fn(),
    });

    document.querySelector<HTMLButtonElement>("#btn-clear-canvas")!.click();

    expect(orchestrator.components).toEqual([]);
    expect(orchestrator.wires).toEqual([]);
    expect(orchestrator.selectedComponent).toBeNull();
    expect(panel.transientResults).toEqual([]);
    expect(panel.acSweepResults).toBeNull();
    expect(clearVoltages).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledOnce();
    expect(markModified).toHaveBeenCalledOnce();
  });

  it("controla zoom y snap de rejilla", () => {
    const canvas = setupDom();
    const orchestrator = {
      components: [],
      wires: [],
      selectedComponent: null,
      gridSize: 20,
      zoomAt: vi.fn(),
    };

    initCanvasToolbarController({
      canvasElement: canvas,
      getOrchestrator: () => orchestrator,
      getOscilloscopePanel: () => null,
      clearVoltages: vi.fn(),
      resetPerformanceCaches: vi.fn(),
      updateCanvasRendering: vi.fn(),
      markCurrentTabAsModified: vi.fn(),
      addLog: vi.fn(),
    });

    document.querySelector<HTMLButtonElement>("#btn-zoom-in")!.click();
    document.querySelector<HTMLButtonElement>("#btn-zoom-out")!.click();
    document.querySelector<HTMLButtonElement>("#btn-snap-grid")!.click();

    expect(orchestrator.zoomAt).toHaveBeenNthCalledWith(1, 1.15, 200, 100);
    expect(orchestrator.zoomAt).toHaveBeenNthCalledWith(2, 0.85, 200, 100);
    expect(orchestrator.gridSize).toBe(1);
  });
});
