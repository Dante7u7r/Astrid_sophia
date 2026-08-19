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

  it("inicia, actualiza y completa cuadro de selección con el ratón", () => {
    const canvas = document.createElement("canvas");
    Object.defineProperties(canvas, {
      clientWidth: { value: 800 },
      clientHeight: { value: 600 },
    });
    canvas.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    document.body.appendChild(canvas);

    const completeBoxSelection = vi.fn();
    const orchestrator = {
      screenToWorld: (x: number, y: number) => ({ x, y }),
      checkHover: vi.fn(),
      selectComponentAt: vi.fn(() => null),
      completeBoxSelection,
      stopDragging: vi.fn(),
      selectedComponents: [],
      selectedWires: [],
      selectionStart: null as { x: number; y: number } | null,
      selectionEnd: null as { x: number; y: number } | null,
      hoveredPin: null,
      hoveredWireHandle: null,
      hoveredWire: null,
      activePinForWire: null,
      isDragging: false,
      isDraggingWireHandle: false,
    } as unknown as CanvasOrchestrator;

    const inputCallbacks = callbacks();
    cleanup = attachCanvasInput(canvas, orchestrator, inputCallbacks);

    // 1. Mouse down en espacio vacío
    canvas.dispatchEvent(new MouseEvent("mousedown", { clientX: 100, clientY: 100, button: 0, bubbles: true }));
    expect(orchestrator.selectionStart).toEqual({ x: 100, y: 100 });
    expect(orchestrator.selectionEnd).toEqual({ x: 100, y: 100 });

    // 2. Mouse move arrastrando
    canvas.dispatchEvent(new MouseEvent("mousemove", { clientX: 250, clientY: 200, bubbles: true }));
    expect(orchestrator.selectionEnd).toEqual({ x: 250, y: 200 });

    // 3. Mouse up completa selección
    canvas.dispatchEvent(new MouseEvent("mouseup", { clientX: 250, clientY: 200, button: 0, bubbles: true }));
    expect(completeBoxSelection).toHaveBeenCalledOnce();
  });
});
