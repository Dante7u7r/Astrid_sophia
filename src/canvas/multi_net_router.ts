import type { BoundingBox, ComponentInstance, Point2D, WireInstance } from "../canvas_orchestrator";
import { globalComponentRegistry } from "../components/registry";
import { isPointInObstacle, simplifyCollinearPoints } from "./smart_wire_router";
import { generateOrthogonalPath, snapPointToGrid } from "./viewport_camera";

export type RoutingLayer = "top" | "bottom";

export interface Via {
  x: number;
  y: number;
  fromLayer: RoutingLayer;
  toLayer: RoutingLayer;
}

export interface RoutedSegment {
  start: Point2D;
  end: Point2D;
  layer: RoutingLayer;
}

export interface NetRouteRequest {
  id: string;
  netId?: string;
  start: Point2D;
  end: Point2D;
  fromComponentId?: string;
  toComponentId?: string;
  priority?: number;
  preferredLayer?: RoutingLayer;
}

export interface NetRouteOutput {
  id: string;
  netId?: string;
  points: Point2D[];
  layer: RoutingLayer;
  vias: Via[];
  routedSegments: RoutedSegment[];
  success: boolean;
}

export interface MultiNetRouteOptions {
  gridSize?: number;
  maxIterations?: number;
  allowLayerTransitions?: boolean;
  viaCost?: number;
  turnPenalty?: number;
  crossLayerCost?: number;
  maxSearchSteps?: number;
}

interface GridNode3D {
  x: number;
  y: number;
  layer: RoutingLayer;
  g: number;
  h: number;
  f: number;
  parent: GridNode3D | null;
  dirX: number;
  dirY: number;
}

class MinHeap3D {
  private readonly heap: GridNode3D[] = [];

  constructor(private readonly compare: (a: GridNode3D, b: GridNode3D) => number) {}

  get length(): number {
    return this.heap.length;
  }

  push(item: GridNode3D): void {
    this.heap.push(item);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): GridNode3D | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const bottom = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = bottom;
      this.bubbleDown(0);
    }
    return top;
  }

  private bubbleUp(index: number): void {
    const item = this.heap[index];
    while (index > 0) {
      const parentIdx = (index - 1) >> 1;
      const parent = this.heap[parentIdx];
      if (this.compare(item, parent) >= 0) break;
      this.heap[index] = parent;
      index = parentIdx;
    }
    this.heap[index] = item;
  }

  private bubbleDown(index: number): void {
    const length = this.heap.length;
    const item = this.heap[index];
    while (true) {
      const leftIdx = (index << 1) + 1;
      const rightIdx = leftIdx + 1;
      let smallest = index;

      if (leftIdx < length && this.compare(this.heap[leftIdx], this.heap[smallest]) < 0) {
        smallest = leftIdx;
      }
      if (rightIdx < length && this.compare(this.heap[rightIdx], this.heap[smallest]) < 0) {
        smallest = rightIdx;
      }
      if (smallest === index) break;

      this.heap[index] = this.heap[smallest];
      this.heap[smallest] = item;
      index = smallest;
    }
  }
}

/**
 * Genera clave de ocupación en rejilla 3D (x, y, layer)
 */
function gridNodeKey(x: number, y: number, layer: RoutingLayer): string {
  return `${Math.round(x)},${Math.round(y)},${layer}`;
}

/**
 * Determina si un punto 2D intersecta un segmento de cable ortogonal
 */
export function isPointOnSegment(pt: Point2D, p1: Point2D, p2: Point2D, tolerance = 1.0): boolean {
  const minX = Math.min(p1.x, p2.x) - tolerance;
  const maxX = Math.max(p1.x, p2.x) + tolerance;
  const minY = Math.min(p1.y, p2.y) - tolerance;
  const maxY = Math.max(p1.y, p2.y) + tolerance;

  if (pt.x < minX || pt.x > maxX || pt.y < minY || pt.y > maxY) {
    return false;
  }

  // Segmento horizontal
  if (Math.abs(p1.y - p2.y) < tolerance) {
    return Math.abs(pt.y - p1.y) <= tolerance;
  }
  // Segmento vertical
  if (Math.abs(p1.x - p2.x) < tolerance) {
    return Math.abs(pt.x - p1.x) <= tolerance;
  }

  return false;
}

/**
 * Enrutador A* 3D para una conexión individual en el contexto de un mapa de ocupación multi-red.
 */
export function routeSingleNetAStar(
  request: NetRouteRequest,
  gridSize: number,
  obstacles: readonly BoundingBox[],
  occupancyMap: Map<string, { netId: string; wireId: string }>,
  options: MultiNetRouteOptions = {},
): NetRouteOutput {
  const startSnapped = snapPointToGrid(request.start, gridSize);
  const endSnapped = snapPointToGrid(request.end, gridSize);
  const startLayer: RoutingLayer = request.preferredLayer ?? "top";

  if (Math.abs(startSnapped.x - endSnapped.x) < 0.1 && Math.abs(startSnapped.y - endSnapped.y) < 0.1) {
    return {
      id: request.id,
      netId: request.netId,
      points: [request.start, request.end],
      layer: startLayer,
      vias: [],
      routedSegments: [{ start: request.start, end: request.end, layer: startLayer }],
      success: true,
    };
  }

  const activeObstacles = obstacles.filter(
    (bounds) => !isPointInObstacle(startSnapped, bounds, -1) && !isPointInObstacle(endSnapped, bounds, -1),
  );

  const step = gridSize;
  const allowVias = options.allowLayerTransitions ?? true;
  const viaCost = options.viaCost ?? step * 4;
  const turnPenalty = options.turnPenalty ?? step * 0.75;
  const maxSteps = options.maxSearchSteps ?? 3000;

  const manhattan = (p1: Point2D, p2: Point2D) => Math.abs(p1.x - p2.x) + Math.abs(p1.y - p2.y);

  const openQueue = new MinHeap3D((a, b) => a.f - b.f);
  const openMap = new Map<string, GridNode3D>();
  const closedSet = new Set<string>();

  const startH = manhattan(startSnapped, endSnapped);
  const startNode: GridNode3D = {
    x: startSnapped.x,
    y: startSnapped.y,
    layer: startLayer,
    g: 0,
    h: startH,
    f: startH,
    parent: null,
    dirX: 0,
    dirY: 0,
  };

  const startKey = gridNodeKey(startNode.x, startNode.y, startNode.layer);
  openQueue.push(startNode);
  openMap.set(startKey, startNode);

  let stepsCount = 0;
  let bestNode: GridNode3D | null = null;

  while (openQueue.length > 0 && stepsCount < maxSteps) {
    stepsCount++;
    const current = openQueue.pop()!;
    const currentKey = gridNodeKey(current.x, current.y, current.layer);
    openMap.delete(currentKey);

    if (
      Math.abs(current.x - endSnapped.x) < 0.1 &&
      Math.abs(current.y - endSnapped.y) < 0.1
    ) {
      bestNode = current;
      break;
    }

    closedSet.add(currentKey);

    // Movimientos en el mismo plano (X, Y)
    const planarNeighbors = [
      { dx: step, dy: 0 },
      { dx: -step, dy: 0 },
      { dx: 0, dy: step },
      { dx: 0, dy: -step },
    ];

    for (const { dx, dy } of planarNeighbors) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      const nPt: Point2D = { x: nx, y: ny };
      const nKey = gridNodeKey(nx, ny, current.layer);

      if (closedSet.has(nKey)) continue;

      const isTarget = Math.abs(nx - endSnapped.x) < 0.1 && Math.abs(ny - endSnapped.y) < 0.1;

      // Colisión con obstáculos de componentes físicos
      if (!isTarget && activeObstacles.some((obs) => isPointInObstacle(nPt, obs, 4))) {
        continue;
      }

      // Colisión con cables de otras redes en la misma capa
      const occupant = occupancyMap.get(nKey);
      if (occupant && occupant.wireId !== request.id) {
        if (!request.netId || occupant.netId !== request.netId) {
          if (!isTarget) continue;
        }
      }

      // Penalización por giro de codo
      const isTurn = current.parent !== null && (current.dirX !== dx || current.dirY !== dy);
      const bendCost = isTurn ? turnPenalty : 0;

      const tentativeG = current.g + step + bendCost;
      const existingOpen = openMap.get(nKey);

      if (!existingOpen) {
        const h = manhattan(nPt, endSnapped);
        const neighborNode: GridNode3D = {
          x: nx,
          y: ny,
          layer: current.layer,
          g: tentativeG,
          h,
          f: tentativeG + h,
          parent: current,
          dirX: dx,
          dirY: dy,
        };
        openQueue.push(neighborNode);
        openMap.set(nKey, neighborNode);
      } else if (tentativeG < existingOpen.g) {
        existingOpen.g = tentativeG;
        existingOpen.f = tentativeG + existingOpen.h;
        existingOpen.parent = current;
        existingOpen.dirX = dx;
        existingOpen.dirY = dy;
        openQueue.push(existingOpen);
      }
    }

    // Transición de capa (Vía 3D vertical)
    if (allowVias) {
      const nextLayer: RoutingLayer = current.layer === "top" ? "bottom" : "top";
      const viaKey = gridNodeKey(current.x, current.y, nextLayer);

      if (!closedSet.has(viaKey)) {
        const occupant = occupancyMap.get(viaKey);
        const isBlocked = occupant && occupant.wireId !== request.id && (!request.netId || occupant.netId !== request.netId);

        if (!isBlocked) {
          const tentativeG = current.g + viaCost;
          const existingOpen = openMap.get(viaKey);

          if (!existingOpen) {
            const h = manhattan({ x: current.x, y: current.y }, endSnapped);
            const viaNode: GridNode3D = {
              x: current.x,
              y: current.y,
              layer: nextLayer,
              g: tentativeG,
              h,
              f: tentativeG + h,
              parent: current,
              dirX: 0,
              dirY: 0,
            };
            openQueue.push(viaNode);
            openMap.set(viaKey, viaNode);
          } else if (tentativeG < existingOpen.g) {
            existingOpen.g = tentativeG;
            existingOpen.f = tentativeG + existingOpen.h;
            existingOpen.parent = current;
            existingOpen.dirX = 0;
            existingOpen.dirY = 0;
            openQueue.push(existingOpen);
          }
        }
      }
    }
  }

  if (!bestNode) {
    // Fallback ortogonal estándar en caso de no hallar ruta completa
    const fallbackPath = generateOrthogonalPath(request.start, request.end, gridSize);
    return {
      id: request.id,
      netId: request.netId,
      points: fallbackPath,
      layer: startLayer,
      vias: [],
      routedSegments: [{ start: request.start, end: request.end, layer: startLayer }],
      success: false,
    };
  }

  // Reconstrucción de la ruta y extracción de vías y segmentos
  const rawNodes: GridNode3D[] = [];
  let curr: GridNode3D | null = bestNode;
  while (curr) {
    rawNodes.unshift(curr);
    curr = curr.parent;
  }

  const vias: Via[] = [];
  const segments: RoutedSegment[] = [];
  const points2D: Point2D[] = [];

  let currentSegmentStart: Point2D = { x: rawNodes[0].x, y: rawNodes[0].y };
  let currentSegmentLayer: RoutingLayer = rawNodes[0].layer;
  points2D.push(currentSegmentStart);

  for (let i = 1; i < rawNodes.length; i++) {
    const prev = rawNodes[i - 1];
    const node = rawNodes[i];

    if (node.layer !== prev.layer) {
      // Vía detectada
      vias.push({
        x: node.x,
        y: node.y,
        fromLayer: prev.layer,
        toLayer: node.layer,
      });

      segments.push({
        start: currentSegmentStart,
        end: { x: node.x, y: node.y },
        layer: currentSegmentLayer,
      });

      currentSegmentStart = { x: node.x, y: node.y };
      currentSegmentLayer = node.layer;
    } else {
      points2D.push({ x: node.x, y: node.y });
    }
  }

  segments.push({
    start: currentSegmentStart,
    end: { x: rawNodes[rawNodes.length - 1].x, y: rawNodes[rawNodes.length - 1].y },
    layer: currentSegmentLayer,
  });

  const simplifiedPoints = simplifyCollinearPoints(points2D);
  simplifiedPoints[0] = { x: request.start.x, y: request.start.y };
  simplifiedPoints[simplifiedPoints.length - 1] = { x: request.end.x, y: request.end.y };

  return {
    id: request.id,
    netId: request.netId,
    points: simplifiedPoints,
    layer: rawNodes[0].layer,
    vias,
    routedSegments: segments,
    success: true,
  };
}

/**
 * Enruta múltiples redes simultáneamente o mediante negociación iterativa Rip-up & Re-route.
 */
export function generateMultiNetOrthogonalRoutes(
  requests: readonly NetRouteRequest[],
  gridSize: number,
  obstacles: readonly BoundingBox[] = [],
  options: MultiNetRouteOptions = {},
): NetRouteOutput[] {
  const sortedRequests = [...requests].sort((a, b) => {
    // Prioridad explícita o distancia Manhattan ascendente
    const prioDiff = (b.priority ?? 0) - (a.priority ?? 0);
    if (prioDiff !== 0) return prioDiff;
    const distA = Math.abs(a.start.x - a.end.x) + Math.abs(a.start.y - a.end.y);
    const distB = Math.abs(b.start.x - b.end.x) + Math.abs(b.start.y - b.end.y);
    return distA - distB;
  });

  const maxIterations = options.maxIterations ?? 2;
  const occupancyMap = new Map<string, { netId: string; wireId: string }>();
  let routedResults: Map<string, NetRouteOutput> = new Map();

  for (let iter = 0; iter < maxIterations; iter++) {
    occupancyMap.clear();

    // Registrar ocupación de rutas exitosas de la iteración previa
    for (const res of routedResults.values()) {
      if (res.success) {
        for (const seg of res.routedSegments) {
          const dx = Math.sign(seg.end.x - seg.start.x) * gridSize;
          const dy = Math.sign(seg.end.y - seg.start.y) * gridSize;
          let curX = seg.start.x;
          let curY = seg.start.y;
          const steps = Math.max(
            Math.round(Math.abs(seg.end.x - seg.start.x) / gridSize),
            Math.round(Math.abs(seg.end.y - seg.start.y) / gridSize),
          );

          for (let s = 0; s <= steps; s++) {
            const key = gridNodeKey(curX, curY, seg.layer);
            occupancyMap.set(key, { netId: res.netId ?? res.id, wireId: res.id });
            curX += dx;
            curY += dy;
          }
        }
      }
    }

    const currentIterResults = new Map<string, NetRouteOutput>();

    for (const req of sortedRequests) {
      // Liberar la ocupación de esta red si ya estaba trazada para rip-up
      for (const [key, val] of Array.from(occupancyMap.entries())) {
        if (val.wireId === req.id) {
          occupancyMap.delete(key);
        }
      }

      // Filtrar obstáculos excluyendo componentes de inicio y fin
      const netObstacles = obstacles.filter((_, idx) => {
        const compId = `comp_${idx}`;
        return compId !== req.fromComponentId && compId !== req.toComponentId;
      });

      const route = routeSingleNetAStar(req, gridSize, netObstacles, occupancyMap, options);
      currentIterResults.set(req.id, route);

      // Registrar ocupación de la nueva ruta
      for (const seg of route.routedSegments) {
        const dx = Math.sign(seg.end.x - seg.start.x) * gridSize;
        const dy = Math.sign(seg.end.y - seg.start.y) * gridSize;
        let curX = seg.start.x;
        let curY = seg.start.y;
        const steps = Math.max(
          Math.round(Math.abs(seg.end.x - seg.start.x) / gridSize),
          Math.round(Math.abs(seg.end.y - seg.start.y) / gridSize),
        );

        for (let s = 0; s <= steps; s++) {
          const key = gridNodeKey(curX, curY, seg.layer);
          occupancyMap.set(key, { netId: req.netId ?? req.id, wireId: req.id });
          curX += dx;
          curY += dy;
        }
      }
    }

    routedResults = currentIterResults;

    const allSuccess = Array.from(routedResults.values()).every((r) => r.success);
    if (allSuccess) break;
  }

  // Preservar orden original de solicitudes
  return requests.map((req) => routedResults.get(req.id)!);
}

/**
 * Ejecuta el auto-enrutamiento multi-red completo para todos los cables de un circuito esquemático.
 */
export function autoRouteCircuitWires(
  components: readonly ComponentInstance[],
  wires: readonly WireInstance[],
  options: MultiNetRouteOptions = {},
): WireInstance[] {
  const gridSize = options.gridSize ?? 20;

  const obstacles: BoundingBox[] = components.map((comp) => globalComponentRegistry.getBounds(comp));

  const requests: NetRouteRequest[] = [];

  for (const wire of wires) {
    if (!wire.points || wire.points.length < 2) continue;
    const start = wire.points[0];
    const end = wire.points[wire.points.length - 1];

    requests.push({
      id: wire.id,
      netId: wire.label,
      start,
      end,
      fromComponentId: wire.from.componentId,
      toComponentId: wire.to.componentId,
      preferredLayer: wire.layer,
    });
  }

  const routes = generateMultiNetOrthogonalRoutes(requests, gridSize, obstacles, options);
  const routeMap = new Map(routes.map((r) => [r.id, r]));

  return wires.map((wire) => {
    const route = routeMap.get(wire.id);
    if (!route) return { ...wire };

    return {
      ...wire,
      points: route.points,
      layer: route.layer,
      vias: route.vias,
      routedSegments: route.routedSegments,
    };
  });
}
