import type { BoundingBox, Point2D } from "../canvas_orchestrator";
import { generateOrthogonalPath, snapPointToGrid } from "./viewport_camera";

export function simplifyCollinearPoints(points: readonly Point2D[]): Point2D[] {
  if (points.length <= 2) return [...points];

  const result: Point2D[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const next = points[i + 1];

    const isCollinearX = Math.abs(prev.x - curr.x) < 0.1 && Math.abs(curr.x - next.x) < 0.1;
    const isCollinearY = Math.abs(prev.y - curr.y) < 0.1 && Math.abs(curr.y - next.y) < 0.1;

    if (!isCollinearX && !isCollinearY) {
      result.push(curr);
    }
  }
  result.push(points[points.length - 1]);
  return result;
}

export function isPointInObstacle(pt: Point2D, bounds: BoundingBox, margin = 2): boolean {
  return (
    pt.x >= bounds.x - margin &&
    pt.x <= bounds.x + bounds.width + margin &&
    pt.y >= bounds.y - margin &&
    pt.y <= bounds.y + bounds.height + margin
  );
}

interface GridNode {
  x: number;
  y: number;
  g: number;
  h: number;
  f: number;
  parent: GridNode | null;
  dirX: number;
  dirY: number;
}

class MinHeap<T> {
  private readonly heap: T[] = [];
  constructor(private readonly compare: (a: T, b: T) => number) {}

  get length(): number {
    return this.heap.length;
  }

  push(item: T): void {
    this.heap.push(item);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): T | undefined {
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
 * Enrutador inteligente reactivo A* Manhattan para pistas conductoras con esquive de cajas de componentes.
 * Utiliza Min-Heap de prioridad y Map hash O(1) para ejecución en sub-milisegundos a 60 FPS.
 */
export function generateSmartOrthogonalPath(
  start: Point2D,
  end: Point2D,
  gridSize: number,
  obstacles: readonly BoundingBox[] = [],
): Point2D[] {
  if (obstacles.length === 0) {
    return generateOrthogonalPath(start, end, gridSize);
  }

  const startSnapped = snapPointToGrid(start, gridSize);
  const endSnapped = snapPointToGrid(end, gridSize);

  if (Math.abs(startSnapped.x - endSnapped.x) < 0.1 && Math.abs(startSnapped.y - endSnapped.y) < 0.1) {
    return [start, end];
  }

  // Filtrar obstáculos excluyendo las cajas que contienen el punto de origen o de destino
  const activeObstacles = obstacles.filter(
    (bounds) => !isPointInObstacle(startSnapped, bounds, -1) && !isPointInObstacle(endSnapped, bounds, -1),
  );

  if (activeObstacles.length === 0) {
    return generateOrthogonalPath(start, end, gridSize);
  }

  const step = gridSize;
  const endKey = `${endSnapped.x},${endSnapped.y}`;

  const openQueue = new MinHeap<GridNode>((a, b) => a.f - b.f);
  const openMap = new Map<string, GridNode>();
  const closedSet = new Set<string>();

  const manhattan = (p1: Point2D, p2: Point2D) => Math.abs(p1.x - p2.x) + Math.abs(p1.y - p2.y);

  const startH = manhattan(startSnapped, endSnapped);
  const startNode: GridNode = {
    x: startSnapped.x,
    y: startSnapped.y,
    g: 0,
    h: startH,
    f: startH,
    parent: null,
    dirX: 0,
    dirY: 0,
  };

  openQueue.push(startNode);
  openMap.set(`${startNode.x},${startNode.y}`, startNode);

  let stepsCount = 0;
  const maxSteps = 1500;
  let bestNode: GridNode | null = null;

  while (openQueue.length > 0 && stepsCount < maxSteps) {
    stepsCount++;
    const current = openQueue.pop()!;
    const currentKey = `${current.x},${current.y}`;
    openMap.delete(currentKey);

    if (currentKey === endKey) {
      bestNode = current;
      break;
    }

    closedSet.add(currentKey);

    const neighbors = [
      { dx: step, dy: 0 },
      { dx: -step, dy: 0 },
      { dx: 0, dy: step },
      { dx: 0, dy: -step },
    ];

    for (const { dx, dy } of neighbors) {
      const neighborPt: Point2D = { x: current.x + dx, y: current.y + dy };
      const neighborKey = `${neighborPt.x},${neighborPt.y}`;

      if (closedSet.has(neighborKey)) continue;

      if (neighborKey !== endKey && activeObstacles.some((obs) => isPointInObstacle(neighborPt, obs, 4))) {
        continue;
      }

      // Penalización por giro para preferir líneas rectas y ordenadas
      const isTurn = current.parent !== null && (current.dirX !== dx || current.dirY !== dy);
      const turnPenalty = isTurn ? step * 0.75 : 0;

      const tentativeG = current.g + step + turnPenalty;
      const existingOpen = openMap.get(neighborKey);

      if (!existingOpen) {
        const h = manhattan(neighborPt, endSnapped);
        const neighborNode: GridNode = {
          x: neighborPt.x,
          y: neighborPt.y,
          g: tentativeG,
          h,
          f: tentativeG + h,
          parent: current,
          dirX: dx,
          dirY: dy,
        };
        openQueue.push(neighborNode);
        openMap.set(neighborKey, neighborNode);
      } else if (tentativeG < existingOpen.g) {
        existingOpen.g = tentativeG;
        existingOpen.f = tentativeG + existingOpen.h;
        existingOpen.parent = current;
        existingOpen.dirX = dx;
        existingOpen.dirY = dy;
        openQueue.push(existingOpen);
      }
    }
  }

  if (!bestNode) {
    return generateOrthogonalPath(start, end, gridSize);
  }

  const rawPath: Point2D[] = [];
  let curr: GridNode | null = bestNode;
  while (curr) {
    rawPath.unshift({ x: curr.x, y: curr.y });
    curr = curr.parent;
  }

  rawPath[0] = { x: start.x, y: start.y };
  rawPath[rawPath.length - 1] = { x: end.x, y: end.y };

  return simplifyCollinearPoints(rawPath);
}

export * from "./multi_net_router";
export * from "./drc_engine";

