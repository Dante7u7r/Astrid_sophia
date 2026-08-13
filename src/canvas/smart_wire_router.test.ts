import { describe, expect, it } from "vitest";
import type { BoundingBox } from "../canvas_orchestrator";
import {
  generateSmartOrthogonalPath,
  isPointInObstacle,
  simplifyCollinearPoints,
} from "./smart_wire_router";

describe("smart_wire_router", () => {
  it("simplifica puntos colineales correctamente", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 20 },
      { x: 40, y: 40 },
    ];
    expect(simplifyCollinearPoints(points)).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
    ]);
  });

  it("detecta la colision de puntos con rectangulos de obstaculo", () => {
    const box: BoundingBox = { x: 40, y: 40, width: 40, height: 40 };
    expect(isPointInObstacle({ x: 50, y: 50 }, box)).toBe(true);
    expect(isPointInObstacle({ x: 0, y: 0 }, box)).toBe(false);
  });

  it("ruta de forma ortogonal directa cuando no hay obstaculos", () => {
    const path = generateSmartOrthogonalPath({ x: 0, y: 0 }, { x: 100, y: 60 }, 20, []);
    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path[path.length - 1]).toEqual({ x: 100, y: 60 });
  });

  it("rodea un componente obstaculo intermedio de forma ortogonal", () => {
    // Obstaculo en la trayectoria directa (entre (0,0) y (100,0))
    const obstacle: BoundingBox = { x: 30, y: -20, width: 40, height: 40 };
    const path = generateSmartOrthogonalPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 20, [obstacle]);

    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path[path.length - 1]).toEqual({ x: 100, y: 0 });

    // Verificar que ningun punto intermedio colisiona con el interior del obstaculo
    for (let i = 1; i < path.length - 1; i++) {
      expect(isPointInObstacle(path[i], obstacle, -1)).toBe(false);
    }
  });
});
