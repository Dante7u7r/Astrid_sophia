import { describe, expect, it } from "vitest";
import type { ComponentInstance } from "../canvas_orchestrator";
import {
  clientToCanvasPoint,
  hasCanvasSelection,
  isPointInsideRect,
  parsePaletteComponentData,
  resolveWheelZoomStep,
  shouldStartPaletteDrag,
} from "./canvas_input_model";

function component(): ComponentInstance {
  return { id: "R1", type: "resistor", value: 1, x: 0, y: 0, rotation: 0 };
}

describe("canvas_input_model", () => {
  it("convierte coordenadas cliente a canvas", () => {
    expect(clientToCanvasPoint({ left: 10, top: 20 }, { clientX: 25, clientY: 45 })).toEqual({
      screenX: 15,
      screenY: 25,
    });
  });

  it("calcula zoom con limites", () => {
    expect(resolveWheelZoomStep(-1, 1, { minZoom: 0.3, maxZoom: 3 })).toEqual({
      zoomFactor: 1.1,
      clampedZoom: 1.1,
    });
    expect(resolveWheelZoomStep(-1, 3, { minZoom: 0.3, maxZoom: 3 })).toEqual({
      zoomFactor: 1,
      clampedZoom: 3,
    });
    expect(resolveWheelZoomStep(1, 0.3, { minZoom: 0.3, maxZoom: 3 })).toEqual({
      zoomFactor: 1,
      clampedZoom: 0.3,
    });
  });

  it("detecta seleccion existente", () => {
    expect(hasCanvasSelection({ selectedComponents: [], selectedComponent: null, selectedWire: null })).toBe(false);
    expect(hasCanvasSelection({ selectedComponents: [component()], selectedComponent: null, selectedWire: null })).toBe(true);
    expect(hasCanvasSelection({ selectedComponents: [], selectedComponent: component(), selectedWire: null })).toBe(true);
    expect(hasCanvasSelection({ selectedComponents: [], selectedComponent: null, selectedWire: {} })).toBe(true);
  });

  it("parsea datos de paleta", () => {
    expect(parsePaletteComponentData({ type: "capacitor", default: "1e-6" } as DOMStringMap)).toEqual({
      type: "capacitor",
      value: 1e-6,
    });
    expect(parsePaletteComponentData({ type: "lamp", default: "modelo; extra" } as DOMStringMap)).toEqual({
      type: "lamp",
      value: "modelo; extra",
    });
  });

  it("evalua bounds y umbral de drag", () => {
    expect(isPointInsideRect({ left: 0, right: 100, top: 0, bottom: 50 }, { clientX: 50, clientY: 25 })).toBe(true);
    expect(isPointInsideRect({ left: 0, right: 100, top: 0, bottom: 50 }, { clientX: 101, clientY: 25 })).toBe(false);
    expect(shouldStartPaletteDrag({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(false);
    expect(shouldStartPaletteDrag({ x: 0, y: 0 }, { x: 6, y: 0 })).toBe(true);
  });
});
