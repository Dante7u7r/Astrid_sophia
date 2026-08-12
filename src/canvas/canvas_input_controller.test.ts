// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasOrchestrator } from "../canvas_orchestrator";
import { attachCanvasInput, type CanvasInputCallbacks } from "./canvas_input_controller";

function callbacks(): CanvasInputCallbacks {
  return {
    requestRender: vi.fn(),
    onWireConnected: vi.fn(),
    onCanvasModified: vi.fn(),
    onNetlistSync: vi.fn(),
    onSelectionChanged: vi.fn(),
    getPinNode: vi.fn(),
    log: vi.fn(),
    getProbePlacementMode: vi.fn(() => null),
    clearProbePlacementMode: vi.fn(),
    onProbePlaced: vi.fn(),
    getActiveAnalysisMode: vi.fn(() => "DC"),
    onSparPortAssign: vi.fn(() => false),
    onSwitchDoubleClick: vi.fn(async () => undefined),
    onHideMcuDebug: vi.fn(),
    onComponentPlaced: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onSelectAll: vi.fn(),
    onFitAll: vi.fn(),
    onEscape: vi.fn(),
    onWireMode: vi.fn(),
  };
}

describe("canvas_input_controller", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => cleanup?.());

  it("acerca y aleja con teclado sin requerir una selección", () => {
    const canvas = document.createElement("canvas");
    Object.defineProperties(canvas, {
      clientWidth: { value: 400 },
      clientHeight: { value: 200 },
    });
    document.body.appendChild(canvas);
    const zoomAt = vi.fn();
    const orchestrator = {
      zoomAt,
      minZoom: 0.3,
      maxZoom: 3,
      zoom: 1,
      selectedComponents: [],
      selectedComponent: null,
      selectedWire: null,
    } as unknown as CanvasOrchestrator;
    const inputCallbacks = callbacks();
    cleanup = attachCanvasInput(canvas, orchestrator, inputCallbacks);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "-", bubbles: true }));

    expect(zoomAt).toHaveBeenNthCalledWith(1, 1.15, 200, 100);
    expect(zoomAt).toHaveBeenNthCalledWith(2, 0.85, 200, 100);
    expect(inputCallbacks.requestRender).toHaveBeenCalledTimes(2);
  });
});
