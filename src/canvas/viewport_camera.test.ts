import { describe, expect, it } from "vitest";
import type { ComponentInstance, WireInstance } from "../canvas_orchestrator";
import {
  fitBoundsToViewport,
  generateOrthogonalPath,
  getCircuitBounds,
  getCircuitGeometricCenter,
  screenToWorld,
  snapPointToGrid,
  worldToScreen,
  zoomAt,
} from "./viewport_camera";

function component(partial: Partial<ComponentInstance> & Pick<ComponentInstance, "id" | "type">): ComponentInstance {
  return {
    value: 1,
    x: 0,
    y: 0,
    rotation: 0,
    ...partial,
  };
}

describe("viewport_camera", () => {
  it("convierte coordenadas y aplica snap a rejilla", () => {
    const camera = { zoom: 2, offsetX: 10, offsetY: 20 };

    expect(screenToWorld(30, 60, camera)).toEqual({ x: 10, y: 20 });
    expect(worldToScreen(10, 20, camera)).toEqual({ x: 30, y: 60 });
    expect(snapPointToGrid({ x: 29, y: 31 }, 20)).toEqual({ x: 20, y: 40 });
  });

  it("genera rutas ortogonales con puntos intermedios alineados", () => {
    expect(generateOrthogonalPath({ x: 0, y: 0 }, { x: 100, y: 60 }, 20)).toEqual([
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 60 },
      { x: 100, y: 60 },
    ]);
  });

  it("calcula centro y bounds del circuito incluyendo cables", () => {
    const components = [
      component({ id: "R1", type: "resistor", x: 0, y: 0 }),
      component({ id: "C1", type: "capacitor", x: 100, y: 0 }),
    ];
    const wires: WireInstance[] = [{
      id: "W1",
      from: { componentId: "R1", pinIndex: 0 },
      to: { componentId: "C1", pinIndex: 0 },
      points: [{ x: -100, y: -50 }, { x: 200, y: 50 }],
    }];

    expect(getCircuitGeometricCenter(components).x).toBe(50);
    expect(getCircuitBounds(components, wires)).toEqual({
      x: -140,
      y: -90,
      width: 380,
      height: 180,
    });
  });

  it("ajusta zoom y offsets para encuadrar bounds", () => {
    expect(fitBoundsToViewport(
      { x: -50, y: -50, width: 100, height: 100 },
      { width: 400, height: 200 },
      { minZoom: 0.3, maxZoom: 3 },
    )).toEqual({ zoom: 2, offsetX: 200, offsetY: 100 });
  });

  it("hace zoom alrededor del punto de pantalla y respeta limites", () => {
    const next = zoomAt(
      { zoom: 1, offsetX: 0, offsetY: 0 },
      { minZoom: 0.3, maxZoom: 3 },
      { width: 400, height: 300 },
      { x: 0, y: 0 },
      2,
      { x: 100, y: 50 },
    );

    expect(next.zoom).toBe(2);
    expect(next.offsetX).toBeCloseTo(0);
    expect(next.offsetY).toBeCloseTo(0);
  });
});
