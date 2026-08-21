import { describe, expect, it } from "vitest";
import type { BoundingBox, ComponentInstance, WireInstance } from "../canvas_orchestrator";
import {
  autoRouteCircuitWires,
  generateMultiNetOrthogonalRoutes,
  isPointOnSegment,
  routeSingleNetAStar,
  type NetRouteRequest,
} from "./multi_net_router";
import { isPointInObstacle } from "./smart_wire_router";

describe("multi_net_router", () => {
  it("detecta correctamente si un punto pertenece a un segmento ortogonal", () => {
    const p1 = { x: 0, y: 40 };
    const p2 = { x: 100, y: 40 };

    expect(isPointOnSegment({ x: 50, y: 40 }, p1, p2)).toBe(true);
    expect(isPointOnSegment({ x: 0, y: 40 }, p1, p2)).toBe(true);
    expect(isPointOnSegment({ x: 100, y: 40 }, p1, p2)).toBe(true);
    expect(isPointOnSegment({ x: 50, y: 50 }, p1, p2)).toBe(false);
    expect(isPointOnSegment({ x: 120, y: 40 }, p1, p2)).toBe(false);
  });

  it("enruta una red individual A* ortogonal respetando la rejilla de 20px", () => {
    const req: NetRouteRequest = {
      id: "wire1",
      start: { x: 0, y: 0 },
      end: { x: 80, y: 60 },
    };

    const route = routeSingleNetAStar(req, 20, [], new Map());

    expect(route.success).toBe(true);
    expect(route.points[0]).toEqual({ x: 0, y: 0 });
    expect(route.points[route.points.length - 1]).toEqual({ x: 80, y: 60 });

    // Todos los puntos deben estar alineados a múltiplos de 20px
    for (const pt of route.points) {
      expect(pt.x % 20).toBe(0);
      expect(pt.y % 20).toBe(0);
    }
  });

  it("esquiva obstáculos de componentes en la rejilla", () => {
    const obstacle: BoundingBox = { x: 20, y: -20, width: 40, height: 40 };
    const req: NetRouteRequest = {
      id: "wire1",
      start: { x: 0, y: 0 },
      end: { x: 80, y: 0 },
    };

    const route = routeSingleNetAStar(req, 20, [obstacle], new Map());

    expect(route.success).toBe(true);
    expect(route.points[0]).toEqual({ x: 0, y: 0 });
    expect(route.points[route.points.length - 1]).toEqual({ x: 80, y: 0 });

    // Ningún punto intermedio debe penetrar el obstáculo
    for (let i = 1; i < route.points.length - 1; i++) {
      expect(isPointInObstacle(route.points[i], obstacle, -1)).toBe(false);
    }
  });

  it("asigna capas (Top/Bottom) y genera vías cuando dos redes se cruzan obligatoriamente", () => {
    // Red 1 horizontal: (0, 40) -> (100, 40)
    // Red 2 vertical: (50, 0) -> (50, 100)
    const req1: NetRouteRequest = {
      id: "netA",
      netId: "N1",
      start: { x: 0, y: 40 },
      end: { x: 100, y: 40 },
      priority: 10,
    };
    const req2: NetRouteRequest = {
      id: "netB",
      netId: "N2",
      start: { x: 40, y: 0 },
      end: { x: 40, y: 100 },
      priority: 5,
    };

    const routes = generateMultiNetOrthogonalRoutes([req1, req2], 20, [], {
      allowLayerTransitions: true,
    });

    expect(routes.length).toBe(2);
    expect(routes[0].success).toBe(true);
    expect(routes[1].success).toBe(true);

    // Si una red se mantiene en la capa "top", la otra debe evitar cruce directo o usar vías para cambiar a "bottom"
    const routeA = routes.find((r) => r.id === "netA")!;
    const routeB = routes.find((r) => r.id === "netB")!;

    expect(routeA).toBeDefined();
    expect(routeB).toBeDefined();

    // Las rutas deben alcanzar sus terminales
    expect(routeA.points[0]).toEqual({ x: 0, y: 40 });
    expect(routeA.points[routeA.points.length - 1]).toEqual({ x: 100, y: 40 });
    expect(routeB.points[0]).toEqual({ x: 40, y: 0 });
    expect(routeB.points[routeB.points.length - 1]).toEqual({ x: 40, y: 100 });
  });

  it("ejecuta autoRouteCircuitWires sobre un circuito esquemático completo", () => {
    const components: ComponentInstance[] = [
      {
        id: "R1",
        type: "resistor",
        x: 40,
        y: 40,
        rotation: 0,
        value: 1000,
      },
      {
        id: "C1",
        type: "capacitor",
        x: 140,
        y: 40,
        rotation: 0,
        value: 1e-6,
      },
    ];

    const wires: WireInstance[] = [
      {
        id: "wire_R1_p1_to_C1_p0",
        from: { componentId: "R1", pinIndex: 1 },
        to: { componentId: "C1", pinIndex: 0 },
        points: [
          { x: 60, y: 40 },
          { x: 120, y: 40 },
        ],
      },
    ];

    const routedWires = autoRouteCircuitWires(components, wires, { gridSize: 20 });

    expect(routedWires.length).toBe(1);
    expect(routedWires[0].points.length).toBeGreaterThanOrEqual(2);
    expect(routedWires[0].points[0]).toEqual({ x: 60, y: 40 });
    expect(routedWires[0].points[routedWires[0].points.length - 1]).toEqual({ x: 120, y: 40 });
  });
});
