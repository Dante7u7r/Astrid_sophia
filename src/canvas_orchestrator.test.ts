// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasOrchestrator, type PinInstance } from "./canvas_orchestrator";
import { duplicateSelection, mirrorSelection, removeSelection, rotateSelection } from "./canvas/component_actions";

// Polyfill Path2D for happy-dom if not present
if (typeof globalThis.Path2D === "undefined") {
  globalThis.Path2D = class Path2D {
    public addPath = vi.fn();
    public closePath = vi.fn();
    public moveTo = vi.fn();
    public lineTo = vi.fn();
    public bezierCurveTo = vi.fn();
    public quadraticCurveTo = vi.fn();
    public arc = vi.fn();
    public arcTo = vi.fn();
    public ellipse = vi.fn();
    public rect = vi.fn();
  } as unknown as typeof Path2D;
}

function createMockContext(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn(() => ({ width: 50, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 2 })),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    setTransform: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    transform: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    drawImage: vi.fn(),
    setLineDash: vi.fn(),
    getLineDash: vi.fn(() => []),
    resetTransform: vi.fn(),
    canvas: document.createElement("canvas"),
  } as unknown as CanvasRenderingContext2D;
}

function createTestCanvas(width = 800, height = 600): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const ctx = createMockContext();
  canvas.getContext = vi.fn().mockReturnValue(ctx) as unknown as typeof canvas.getContext;
  Object.defineProperties(canvas, {
    clientWidth: { value: width, configurable: true },
    clientHeight: { value: height, configurable: true },
    width: { value: width, writable: true },
    height: { value: height, writable: true },
  });
  return canvas;
}

describe("CanvasOrchestrator", () => {
  let orchestrator: CanvasOrchestrator;
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = createTestCanvas();
    orchestrator = new CanvasOrchestrator(canvas);
  });

  describe("Transformaciones de coordenadas y Grid", () => {
    it("convierte entre coordenadas de pantalla y mundo", () => {
      orchestrator.offsetX = 100;
      orchestrator.offsetY = 50;
      orchestrator.zoom = 2.0;

      const world = orchestrator.screenToWorld(300, 250);
      expect(world.x).toBe((300 - 100) / 2.0);
      expect(world.y).toBe((250 - 50) / 2.0);

      const screen = orchestrator.worldToScreen(world.x, world.y);
      expect(screen.x).toBeCloseTo(300);
      expect(screen.y).toBeCloseTo(250);
    });

    it("ajusta a la grilla con snapToGrid y snapPointToGrid", () => {
      orchestrator.gridSize = 20;
      expect(orchestrator.snapToGrid(23)).toBe(20);
      expect(orchestrator.snapToGrid(35)).toBe(40);
      expect(orchestrator.snapPointToGrid({ x: 23, y: 35 })).toEqual({ x: 20, y: 40 });
    });

    it("calcula coordenadas de pantalla ajustadas a la grilla", () => {
      orchestrator.offsetX = 0;
      orchestrator.offsetY = 0;
      orchestrator.zoom = 1.0;
      const snapped = orchestrator.screenToWorldSnapped(47, 88);
      expect(snapped).toEqual({ x: 40, y: 80 });
    });
  });

  describe("Gestión de Componentes y Selección", () => {
    it("añade y posiciona componentes en el esquemático", () => {
      const comp = orchestrator.addComponent("resistor", 100, 100, 1000);
      expect(comp).toBeDefined();
      expect(orchestrator.components.length).toBe(1);
      expect(orchestrator.components[0].type).toBe("resistor");
      expect(orchestrator.components[0].value).toBe(1000);
    });

    it("selecciona componentes y gestiona selección múltiple", () => {
      const c1 = orchestrator.addComponent("resistor", 100, 100, 1000);
      orchestrator.addComponent("capacitor", 200, 100, 1e-6);

      orchestrator.selectComponentAt(100, 100, false);
      expect(orchestrator.selectedComponent?.id).toBe(c1.id);
      expect(orchestrator.selectedComponents.length).toBe(1);

      orchestrator.selectedComponent = null;
      orchestrator.selectedComponents = [];
      expect(orchestrator.selectedComponent).toBeNull();
      expect(orchestrator.selectedComponents.length).toBe(0);
    });

    it("rota, espeja y duplica componentes seleccionados con component_actions", () => {
      const comp = orchestrator.addComponent("resistor", 100, 100, 1000);
      orchestrator.selectedComponent = comp;
      orchestrator.selectedComponents = [comp];

      const initialRot = comp.rotation ?? 0;
      rotateSelection([comp], comp, 90);
      expect(comp.rotation).toBe((initialRot + 90) % 360);

      mirrorSelection([comp], comp);
      expect(comp.mirror).toBe(true);

      const duplicated = duplicateSelection(
        orchestrator.selectedComponents,
        orchestrator.selectedComponent,
        (type, x, y, val) => orchestrator.addComponent(type, x, y, val),
      );
      expect(duplicated.selectedComponents.length).toBe(1);
      expect(orchestrator.components.length).toBe(2);
    });

    it("elimina componentes del circuito", () => {
      const c1 = orchestrator.addComponent("resistor", 100, 100, 1000);
      orchestrator.removeComponent(c1.id);
      expect(orchestrator.components.length).toBe(0);
    });

    it("renombra componentes en el esquemático y sincroniza cables", () => {
      const c1 = orchestrator.addComponent("resistor", 100, 100, 1000);
      const err = orchestrator.renameComponent(c1, "R_LOAD");
      expect(err).toBeNull();
      expect(c1.id).toBe("R_LOAD");
    });

    it("copia, corta y pega componentes conservando cables y propiedades", () => {
      const r1 = orchestrator.addComponent("resistor", 100, 100, 1000);
      const c1 = orchestrator.addComponent("capacitor", 200, 100, 1e-6);
      orchestrator.connectPins(
        { componentId: r1.id, pinIndex: 1, x: 140, y: 100 },
        { componentId: c1.id, pinIndex: 0, x: 180, y: 100 },
      );

      orchestrator.selectedComponents = [r1, c1];
      expect(orchestrator.hasClipboardData()).toBe(false);

      const count = orchestrator.copySelected();
      expect(count).toBe(2);
      expect(orchestrator.hasClipboardData()).toBe(true);

      const pasted = orchestrator.paste({ x: 300, y: 300 });
      expect(pasted).not.toBeNull();
      expect(pasted!.components.length).toBe(2);
      expect(pasted!.wires.length).toBe(1);
      expect(orchestrator.components.length).toBe(4);
      expect(orchestrator.wires.length).toBe(2);

      // Cortar los pegados
      orchestrator.selectedComponents = pasted!.components;
      const cutCount = orchestrator.cutSelected();
      expect(cutCount).toBe(2);
      expect(orchestrator.components.length).toBe(2);
    });
  });

  describe("Conexionado y Enrutamiento de Cables", () => {
    it("conecta pines entre dos componentes creando un cable", () => {
      const r1 = orchestrator.addComponent("resistor", 100, 100, 1000);
      const r2 = orchestrator.addComponent("resistor", 200, 100, 1000);

      const p1: PinInstance = { componentId: r1.id, pinIndex: 1, x: 140, y: 100 };
      const p2: PinInstance = { componentId: r2.id, pinIndex: 0, x: 160, y: 100 };

      orchestrator.connectPins(p1, p2);
      expect(orchestrator.wires.length).toBe(1);
      expect(orchestrator.wires[0].from.componentId).toBe(r1.id);
      expect(orchestrator.wires[0].to.componentId).toBe(r2.id);
    });

    it("sincroniza extremos de cables al mover componentes", () => {
      const r1 = orchestrator.addComponent("resistor", 100, 100, 1000);
      const r2 = orchestrator.addComponent("resistor", 200, 100, 1000);
      const p1: PinInstance = { componentId: r1.id, pinIndex: 1, x: 140, y: 100 };
      const p2: PinInstance = { componentId: r2.id, pinIndex: 0, x: 160, y: 100 };
      orchestrator.connectPins(p1, p2);

      r1.x = 120;
      r1.y = 120;
      orchestrator.syncWireConnections();
      expect(orchestrator.wires.length).toBe(1);
    });
  });

  describe("Operaciones de Cámara y Viewport", () => {
    it("aplica zoomAt y respeta límites minZoom y maxZoom", () => {
      orchestrator.zoom = 1.0;
      orchestrator.zoomAt(1.5, 400, 300);
      expect(orchestrator.zoom).toBe(1.5);

      orchestrator.zoomAt(10.0, 400, 300);
      expect(orchestrator.zoom).toBe(orchestrator.maxZoom);

      orchestrator.zoomAt(0.01, 400, 300);
      expect(orchestrator.zoom).toBe(orchestrator.minZoom);
    });

    it("desplaza la cámara con pan", () => {
      orchestrator.offsetX = 0;
      orchestrator.offsetY = 0;
      orchestrator.pan(50, 80);
      expect(orchestrator.offsetX).toBe(50);
      expect(orchestrator.offsetY).toBe(80);
    });

    it("calcula el centro geométrico del circuito y ajusta a pantalla", () => {
      expect(orchestrator.getCircuitGeometricCenter()).toEqual({ x: 0, y: 0 });
      orchestrator.addComponent("resistor", 100, 200, 1000);
      orchestrator.addComponent("capacitor", 300, 400, 1e-6);
      const center = orchestrator.getCircuitGeometricCenter();
      expect(center.x).toBe(200);
      expect(center.y).toBe(300);

      const fitted = orchestrator.fitToScreen();
      expect(fitted).toBe(true);
    });
  });

  describe("Reglas Eléctricas (ERC) y Renderizado", () => {
    it("evalúa reglas ERC en tiempo real", () => {
      orchestrator.updateRealtimeErc();
      expect(orchestrator.ercIssues).toEqual([]);

      orchestrator.addComponent("vsource", 100, 100, 5);
      orchestrator.updateRealtimeErc();
      expect(orchestrator.ercIssues.length).toBeGreaterThan(0);
    });

    it("soporta renderizado por capas con overlay canvas", () => {
      expect(orchestrator.hasLayeredRendering()).toBe(false);
      const overlayCanvas = createTestCanvas();
      orchestrator.attachOverlayCanvas(overlayCanvas);
      expect(orchestrator.hasLayeredRendering()).toBe(true);
    });

    it("ejecuta ciclo de renderizado sin excepciones", () => {
      orchestrator.addComponent("resistor", 100, 100, 1000);
      orchestrator.addComponent("ground", 100, 200, 0);
      expect(() => orchestrator.render()).not.toThrow();
    });
  });
});
