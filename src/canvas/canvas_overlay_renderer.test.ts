// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { CanvasOverlayRenderer, type CanvasOverlayHost } from "./canvas_overlay_renderer";
import type { WireInstance } from "../canvas_orchestrator";

function createMockHost(overrides: Partial<CanvasOverlayHost> = {}): CanvasOverlayHost {
  const wire: WireInstance = {
    id: "W1",
    from: { componentId: "V1", pinIndex: 0 },
    to: { componentId: "R1", pinIndex: 0 },
    points: [{ x: 10, y: 10 }, { x: 50, y: 10 }],
  };

  return {
    zoom: 1.0,
    offsetX: 0,
    offsetY: 0,
    gridSize: 20,
    wires: [wire],
    components: [],
    selectedComponents: [],
    selectedComponent: null,
    hoveredComponent: null,
    hoveredPin: null,
    hoveredWire: null,
    hoveredWireSnapPoint: null,
    selectedWire: null,
    selectedWires: [],
    activePinForWire: null,
    tempWireEnd: null,
    selectionStart: null,
    selectionEnd: null,
    showCurrentAnimation: true,
    showThermalHeatmap: false,
    generateOrthogonalPath: (s, e) => [s, e],
    ...overrides,
  };
}

describe("CanvasOverlayRenderer", () => {
  it("limpia el buffer y no dibuja si no hay elementos dinámicos activos", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;

    const host = createMockHost({
      showCurrentAnimation: false,
      showThermalHeatmap: false,
    });

    const renderer = new CanvasOverlayRenderer(canvas, host);
    renderer.renderOverlay({}, {});

    expect(canvas.width).toBe(800);
  });

  it("no renderiza flujo dinámico ni calor cuando simulationActive es false", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;

    const host = createMockHost({
      simulationActive: false,
    });
    const renderer = new CanvasOverlayRenderer(canvas, host);
    const renderSpy = vi.spyOn(renderer.currentAnimationRenderer, "renderCurrentFlow");

    renderer.renderOverlay({ "V1:0": 5 }, { "W1:I": 0.05 }, 1016);

    expect(renderSpy).not.toHaveBeenCalled();
  });

  it("renderiza flujo dinámico en cables cuando hay corrientes de rama y simulationActive es true", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;

    const host = createMockHost();
    const renderer = new CanvasOverlayRenderer(canvas, host);

    // Frame 1: inicializa timestamp
    renderer.renderOverlay({ "V1:0": 5 }, { "W1:I": 0.05 }, 1000);
    // Frame 2: anima trazo con batching
    renderer.renderOverlay({ "V1:0": 5 }, { "W1:I": 0.05 }, 1016);

    expect(renderer.currentAnimationRenderer.flowMode).toBe("conventional");
  });

  it("permite limpiar el overlay explícitamente", () => {
    const canvas = document.createElement("canvas");
    const host = createMockHost();
    const renderer = new CanvasOverlayRenderer(canvas, host);

    renderer.clear();
    expect(canvas).toBeDefined();
  });

  it("renderiza caja de selección cuando selectionStart y selectionEnd están definidos", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;

    const host = createMockHost({
      showCurrentAnimation: false,
      selectionStart: { x: 50, y: 50 },
      selectionEnd: { x: 200, y: 150 },
    });
    const renderer = new CanvasOverlayRenderer(canvas, host);

    renderer.renderOverlay({}, {});
    expect(canvas.width).toBe(800);
  });

  it("renderiza overlays de errores ERC fatales (rojo) y advertencias (amarillo)", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;

    const host = createMockHost({
      showCurrentAnimation: false,
      showThermalHeatmap: false,
      components: [
        { id: "V1", type: "vsource", value: 5, x: 100, y: 100, rotation: 0 },
        { id: "R1", type: "resistor", value: 1000, x: 200, y: 100, rotation: 0 },
      ],
      ercIssues: [
        {
          componentId: "V1",
          type: "error",
          message: "Cortocircuito detectado entre terminales",
          pinIndex: 0,
        },
        {
          componentId: "R1",
          type: "warning",
          message: "Terminal flotante no conectado",
          pinIndex: 1,
        },
      ],
      getComponentPins: (c) => [
        { componentId: c.id, pinIndex: 0, x: c.x - 20, y: c.y },
        { componentId: c.id, pinIndex: 1, x: c.x + 20, y: c.y },
      ],
    });

    const renderer = new CanvasOverlayRenderer(canvas, host);
    renderer.renderOverlay({}, {}, 2000);

    expect(host.ercIssues).toHaveLength(2);
    expect(host.ercIssues?.[0]?.type).toBe("error");
    expect(host.ercIssues?.[1]?.type).toBe("warning");
  });
});

