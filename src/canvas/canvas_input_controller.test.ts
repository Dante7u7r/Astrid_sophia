// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasOrchestrator } from "../canvas_orchestrator";
import { attachCanvasInput, type CanvasInputCallbacks } from "./canvas_input_controller";
import { armStampTool, getArmedStampTool } from "../ui/component_palette_controller";

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

  it("acerca y aleja el lienzo directamente con la rueda del ratón", () => {
    const canvas = document.createElement("canvas");
    canvas.getBoundingClientRect = vi.fn(() => ({
      left: 10,
      top: 20,
      width: 800,
      height: 600,
      right: 810,
      bottom: 620,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    }));
    document.body.appendChild(canvas);

    const zoomAt = vi.fn();
    const orchestrator = {
      zoomAt,
      minZoom: 0.3,
      maxZoom: 3,
      zoom: 1.0,
      selectedComponents: [],
      selectedComponent: null,
      selectedWire: null,
    } as unknown as CanvasOrchestrator;
    const inputCallbacks = callbacks();
    cleanup = attachCanvasInput(canvas, orchestrator, inputCallbacks);

    // Rueda hacia adelante (deltaY < 0): Zoom in
    const wheelIn = new WheelEvent("wheel", { deltaY: -100, bubbles: true });
    Object.defineProperty(wheelIn, "clientX", { value: 210 });
    Object.defineProperty(wheelIn, "clientY", { value: 120 });
    canvas.dispatchEvent(wheelIn);
    expect(zoomAt).toHaveBeenNthCalledWith(1, 1.1, 200, 100);

    // Rueda hacia atrás (deltaY > 0): Zoom out
    const wheelOut = new WheelEvent("wheel", { deltaY: 100, bubbles: true });
    Object.defineProperty(wheelOut, "clientX", { value: 210 });
    Object.defineProperty(wheelOut, "clientY", { value: 120 });
    canvas.dispatchEvent(wheelOut);
    expect(zoomAt).toHaveBeenNthCalledWith(2, 0.9, 200, 100);
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

  it("despacha onSubcircuitDoubleClick al hacer doble clic sobre un subcircuito (tipo x)", async () => {
    const canvas = document.createElement("canvas");
    canvas.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      width: 400,
      height: 200,
      right: 400,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    document.body.appendChild(canvas);

    const subcircuitComp = {
      id: "X1",
      type: "x",
      subcircuitName: "Filtro_RC",
      x: 50,
      y: 50,
      rotation: 0,
    };

    const orchestrator = {
      screenToWorld: (x: number, y: number) => ({ x, y }),
      selectComponentAt: vi.fn(() => subcircuitComp),
      selectedComponents: [],
      selectedWires: [],
    } as unknown as CanvasOrchestrator;

    const onSubcircuitDoubleClick = vi.fn(async () => undefined);
    const inputCallbacks = {
      ...callbacks(),
      onSubcircuitDoubleClick,
    };

    cleanup = attachCanvasInput(canvas, orchestrator, inputCallbacks);

    canvas.dispatchEvent(new MouseEvent("dblclick", { clientX: 50, clientY: 50, bubbles: true }));

    expect(orchestrator.selectComponentAt).toHaveBeenCalledWith(50, 50);
    expect(onSubcircuitDoubleClick).toHaveBeenCalledWith(subcircuitComp);
  });

  it("inicia y completa el cableado entre dos terminales (pines) al hacer clic y arrastrar", () => {
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

    const pin1 = { componentId: "R1", pinIndex: 0, x: 100, y: 100 };
    const pin2 = { componentId: "R2", pinIndex: 1, x: 200, y: 100 };
    const connectPins = vi.fn();
    const updateRealtimeErc = vi.fn();

    const orchestrator = {
      screenToWorld: (x: number, y: number) => ({ x, y }),
      snapPointToGrid: (pt: { x: number; y: number }) => ({ ...pt }),
      checkHover: vi.fn((x: number, y: number) => {
        if (Math.hypot(x - 100, y - 100) < 10) {
          orchestrator.hoveredPin = pin1;
        } else if (Math.hypot(x - 200, y - 100) < 10) {
          orchestrator.hoveredPin = pin2;
        } else {
          orchestrator.hoveredPin = null;
        }
      }),
      selectComponentAt: vi.fn(() => null),
      stopDragging: vi.fn(),
      connectPins,
      updateRealtimeErc,
      selectedComponents: [],
      selectedWires: [],
      hoveredPin: null as typeof pin1 | null,
      hoveredWireHandle: null,
      hoveredWire: null,
      hoveredWireSnapPoint: null,
      activePinForWire: null as typeof pin1 | null,
      tempWireEnd: null as { x: number; y: number } | null,
      isDragging: false,
      isDraggingWireHandle: false,
    } as unknown as CanvasOrchestrator;

    const inputCallbacks = callbacks();
    cleanup = attachCanvasInput(canvas, orchestrator, inputCallbacks);

    // 1. Mover el ratón hacia el pin 1
    canvas.dispatchEvent(new MouseEvent("mousemove", { clientX: 100, clientY: 100, bubbles: true }));
    expect(orchestrator.checkHover).toHaveBeenCalledWith(100, 100);
    expect(orchestrator.hoveredPin).toEqual(pin1);

    // 2. Mousedown en el pin 1 -> inicia cable
    canvas.dispatchEvent(new MouseEvent("mousedown", { clientX: 100, clientY: 100, button: 0, bubbles: true }));
    expect(orchestrator.activePinForWire).toEqual(pin1);
    expect(orchestrator.tempWireEnd).toEqual({ x: 100, y: 100 });

    // 3. Arrastrar cable hacia el pin 2
    canvas.dispatchEvent(new MouseEvent("mousemove", { clientX: 200, clientY: 100, bubbles: true }));
    expect(orchestrator.tempWireEnd).toEqual({ x: 200, y: 100 });
    expect(orchestrator.hoveredPin).toEqual(pin2);
    expect(updateRealtimeErc).toHaveBeenCalled();

    // 4. Mouseup sobre el pin 2 -> completa conexión
    canvas.dispatchEvent(new MouseEvent("mouseup", { clientX: 200, clientY: 100, button: 0, bubbles: true }));
    expect(connectPins).toHaveBeenCalledWith(pin1, pin2);
    expect(inputCallbacks.onWireConnected).toHaveBeenCalledOnce();
    expect(inputCallbacks.onCanvasModified).toHaveBeenCalledOnce();
    expect(orchestrator.activePinForWire).toBeNull();
    expect(orchestrator.tempWireEnd).toBeNull();
  });

  it("desarma stamp tool tras colocar un componente unitario por defecto", () => {
    const canvas = document.createElement("canvas");
    canvas.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      width: 400,
      height: 200,
      right: 400,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    document.body.appendChild(canvas);

    const addComponent = vi.fn((type: string, x: number, y: number, value: any) => ({
      id: "R1",
      type,
      x,
      y,
      value,
    }));

    const orchestrator = {
      screenToWorld: (x: number, y: number) => ({ x, y }),
      snapPointToGrid: (pt: { x: number; y: number }) => ({ ...pt }),
      checkHover: vi.fn(),
      selectComponentAt: vi.fn(() => null),
      addComponent,
      stopDragging: vi.fn(),
      selectedComponents: [],
      selectedWires: [],
    } as unknown as CanvasOrchestrator;

    const inputCallbacks = callbacks();
    cleanup = attachCanvasInput(canvas, orchestrator, inputCallbacks);

    // Armar componente unitario
    armStampTool({
      type: "resistor",
      value: 1000,
      name: "Resistencia",
    });

    expect(getArmedStampTool()).not.toBeNull();

    canvas.dispatchEvent(new MouseEvent("mousedown", { clientX: 50, clientY: 60, button: 0, bubbles: true }));

    expect(addComponent).toHaveBeenCalledWith("resistor", 50, 60, 1000);
    expect(getArmedStampTool()).toBeNull(); // Se desarmó tras el clic
  });

  it("cancela el trazado de cable al hacer clic derecho", () => {
    const canvas = document.createElement("canvas");
    canvas.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      width: 400,
      height: 200,
      right: 400,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    document.body.appendChild(canvas);

    const pin = { componentId: "R1", pinIndex: 0, x: 10, y: 10 };
    const orchestrator = {
      screenToWorld: (x: number, y: number) => ({ x, y }),
      snapPointToGrid: (pt: { x: number; y: number }) => ({ ...pt }),
      checkHover: vi.fn(),
      selectComponentAt: vi.fn(() => null),
      activePinForWire: pin,
      tempWireEnd: { x: 10, y: 10 },
      stopDragging: vi.fn(),
      selectedComponents: [],
      selectedWires: [],
    } as unknown as CanvasOrchestrator;

    const inputCallbacks = callbacks();
    cleanup = attachCanvasInput(canvas, orchestrator, inputCallbacks);

    canvas.dispatchEvent(new MouseEvent("contextmenu", { clientX: 50, clientY: 50, button: 2, bubbles: true }));

    expect(orchestrator.activePinForWire).toBeNull();
    expect(orchestrator.tempWireEnd).toBeNull();
    expect(inputCallbacks.log).toHaveBeenCalledWith("Trazado de cable cancelado.", "system");
  });

  it("no abre el menú contextual si se realizó paneo arrastrando con el clic derecho", () => {
    const canvas = document.createElement("canvas");
    canvas.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      width: 400,
      height: 200,
      right: 400,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    document.body.appendChild(canvas);

    const pan = vi.fn();
    const orchestrator = {
      screenToWorld: (x: number, y: number) => ({ x, y }),
      snapPointToGrid: (pt: { x: number; y: number }) => ({ ...pt }),
      checkHover: vi.fn(),
      pan,
      selectComponentAt: vi.fn(() => null),
      stopDragging: vi.fn(),
      selectedComponents: [],
      selectedWires: [],
      components: [],
    } as unknown as CanvasOrchestrator;

    const inputCallbacks = callbacks();
    cleanup = attachCanvasInput(canvas, orchestrator, inputCallbacks);

    // 1. Mousedown botón derecho
    canvas.dispatchEvent(new MouseEvent("mousedown", { clientX: 50, clientY: 50, button: 2, bubbles: true }));
    // 2. Arrastre de paneo
    canvas.dispatchEvent(new MouseEvent("mousemove", { clientX: 100, clientY: 100, bubbles: true }));
    expect(pan).toHaveBeenCalledWith(50, 50);

    // 3. Contextmenu al soltar -> debe ser ignorado debido al arrastre de paneo
    canvas.dispatchEvent(new MouseEvent("contextmenu", { clientX: 100, clientY: 100, button: 2, bubbles: true }));

    // El menú no debe haberse insertado en el DOM
    expect(document.getElementById("canvas-context-menu")).toBeNull();
  });
});

