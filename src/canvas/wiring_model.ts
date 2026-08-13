import type { BoundingBox, ComponentInstance, PinInstance, Point2D, WireEndpoint, WireInstance } from "../canvas_orchestrator";
import { createWireId } from "./wire_identity";

export function wirePathIntersects(points: readonly Point2D[], bounds: BoundingBox): boolean {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return (
    maxX >= bounds.x &&
    minX <= bounds.x + bounds.width &&
    maxY >= bounds.y &&
    minY <= bounds.y + bounds.height
  );
}

export function findHoveredWire(
  wires: readonly WireInstance[],
  worldX: number,
  worldY: number,
  tolerance = 6,
): WireInstance | null {
  for (const wire of wires) {
    if (!wire.points || wire.points.length < 2) continue;
    for (let i = 0; i < wire.points.length - 1; i++) {
      const p1 = wire.points[i];
      const p2 = wire.points[i + 1];

      let dist = Infinity;
      if (Math.abs(p1.y - p2.y) < 0.1) {
        const minX = Math.min(p1.x, p2.x);
        const maxX = Math.max(p1.x, p2.x);
        if (worldX >= minX - 4 && worldX <= maxX + 4) {
          dist = Math.abs(worldY - p1.y);
        }
      } else if (Math.abs(p1.x - p2.x) < 0.1) {
        const minY = Math.min(p1.y, p2.y);
        const maxY = Math.max(p1.y, p2.y);
        if (worldY >= minY - 4 && worldY <= maxY + 4) {
          dist = Math.abs(worldX - p1.x);
        }
      }

      if (dist < tolerance) return wire;
    }
  }
  return null;
}

export function wireExists(
  wires: readonly WireInstance[],
  from: WireEndpoint,
  to: WireEndpoint,
): boolean {
  return wires.some((wire) => (
    (wire.from.componentId === from.componentId && wire.from.pinIndex === from.pinIndex &&
      wire.to.componentId === to.componentId && wire.to.pinIndex === to.pinIndex) ||
    (wire.from.componentId === to.componentId && wire.from.pinIndex === to.pinIndex &&
      wire.to.componentId === from.componentId && wire.to.pinIndex === from.pinIndex)
  ));
}

export function connectPins(
  wires: WireInstance[],
  from: WireEndpoint,
  to: WireEndpoint,
): boolean {
  if (from.componentId === to.componentId) return false;
  if (wireExists(wires, from, to)) return false;

  wires.push({
    id: createWireId(from, to),
    from: { componentId: from.componentId, pinIndex: from.pinIndex },
    to: { componentId: to.componentId, pinIndex: to.pinIndex },
    points: [],
  });
  return true;
}

export function syncWireConnections(
  components: readonly ComponentInstance[],
  wires: readonly WireInstance[],
  getPins: (component: ComponentInstance) => PinInstance[],
  generatePath: (start: Point2D, end: Point2D, fromCompId?: string, toCompId?: string) => Point2D[],
): void {
  for (const wire of wires) {
    const fromComp = components.find((component) => component.id === wire.from.componentId);
    const toComp = components.find((component) => component.id === wire.to.componentId);
    if (!fromComp || !toComp) continue;

    const startPt = getPins(fromComp).find((pin) => pin.pinIndex === wire.from.pinIndex);
    const endPt = getPins(toComp).find((pin) => pin.pinIndex === wire.to.pinIndex);
    if (!startPt || !endPt) continue;

    if (wire.customPath && wire.points && wire.points.length >= 2) {
      wire.points[0] = { x: startPt.x, y: startPt.y };
      wire.points[wire.points.length - 1] = { x: endPt.x, y: endPt.y };
    } else {
      wire.points = generatePath(startPt, endPt, fromComp.id, toComp.id);
    }
  }
}

export function findConnectedWireIds(
  wires: readonly WireInstance[],
  activeWireId: string,
  nodeMap?: Record<string, string>,
): Set<string> {
  const result = new Set<string>();
  if (!activeWireId) return result;

  const targetWire = wires.find((w) => w.id === activeWireId);
  if (!targetWire) return result;

  result.add(targetWire.id);

  if (nodeMap) {
    const fromKey = `${targetWire.from.componentId}:${targetWire.from.pinIndex}`;
    const targetNode = nodeMap[fromKey];
    if (targetNode) {
      for (const wire of wires) {
        const k1 = `${wire.from.componentId}:${wire.from.pinIndex}`;
        const k2 = `${wire.to.componentId}:${wire.to.pinIndex}`;
        if (nodeMap[k1] === targetNode || nodeMap[k2] === targetNode) {
          result.add(wire.id);
        }
      }
      return result;
    }
  }

  // Fallback a propagación de vecinos si no hay nodeMap
  let added = true;
  while (added) {
    added = false;
    for (const wire of wires) {
      if (result.has(wire.id)) continue;
      const isConnected = Array.from(result).some((rId) => {
        const rWire = wires.find((w) => w.id === rId);
        if (!rWire) return false;
        return (
          (wire.from.componentId === rWire.from.componentId && wire.from.pinIndex === rWire.from.pinIndex) ||
          (wire.from.componentId === rWire.to.componentId && wire.from.pinIndex === rWire.to.pinIndex) ||
          (wire.to.componentId === rWire.from.componentId && wire.to.pinIndex === rWire.from.pinIndex) ||
          (wire.to.componentId === rWire.to.componentId && wire.to.pinIndex === rWire.to.pinIndex)
        );
      });
      if (isConnected) {
        result.add(wire.id);
        added = true;
      }
    }
  }
  return result;
}

export function findWireJunctionPoints(wires: readonly WireInstance[]): Point2D[] {
  const pointCounts = new Map<string, { pt: Point2D; count: number }>();

  for (const wire of wires) {
    if (!wire.points || wire.points.length === 0) continue;
    const endpoints = [wire.points[0], wire.points[wire.points.length - 1]];
    for (const pt of endpoints) {
      const key = `${Math.round(pt.x)},${Math.round(pt.y)}`;
      const entry = pointCounts.get(key);
      if (entry) {
        entry.count++;
      } else {
        pointCounts.set(key, { pt: { x: pt.x, y: pt.y }, count: 1 });
      }
    }
  }

  const junctions: Point2D[] = [];
  for (const entry of pointCounts.values()) {
    if (entry.count >= 3) {
      junctions.push(entry.pt);
    }
  }
  return junctions;
}

export function findWireCrossings(
  wires: readonly WireInstance[],
  nodeMap?: Record<string, string>,
): Map<string, Point2D[]> {
  const crossingsMap = new Map<string, Point2D[]>();

  for (let i = 0; i < wires.length; i++) {
    const w1 = wires[i];
    const pts1 = w1.points && w1.points.length >= 2 ? w1.points : null;
    if (!pts1) continue;

    const k1 = `${w1.from.componentId}:${w1.from.pinIndex}`;
    const n1 = nodeMap?.[k1];

    for (let j = i + 1; j < wires.length; j++) {
      const w2 = wires[j];
      const pts2 = w2.points && w2.points.length >= 2 ? w2.points : null;
      if (!pts2) continue;

      const k2 = `${w2.from.componentId}:${w2.from.pinIndex}`;
      const n2 = nodeMap?.[k2];

      // Ignorar si pertenecen al mismo nodo o comparten extremos
      if (n1 && n2 && n1 === n2) continue;
      if (
        w1.from.componentId === w2.from.componentId ||
        w1.from.componentId === w2.to.componentId ||
        w1.to.componentId === w2.from.componentId ||
        w1.to.componentId === w2.to.componentId
      ) {
        continue;
      }

      // Probar cruces entre segmentos de w1 y w2
      for (let s1 = 0; s1 < pts1.length - 1; s1++) {
        const p1a = pts1[s1];
        const p1b = pts1[s1 + 1];

        const isHoriz1 = Math.abs(p1a.y - p1b.y) < 0.5;
        const isVert1 = Math.abs(p1a.x - p1b.x) < 0.5;

        for (let s2 = 0; s2 < pts2.length - 1; s2++) {
          const p2a = pts2[s2];
          const p2b = pts2[s2 + 1];

          const isHoriz2 = Math.abs(p2a.y - p2b.y) < 0.5;
          const isVert2 = Math.abs(p2a.x - p2b.x) < 0.5;

          // Cruce de un segmento horizontal y uno vertical
          if (isHoriz1 && isVert2) {
            const crossX = p2a.x;
            const crossY = p1a.y;
            const minX1 = Math.min(p1a.x, p1b.x) + 0.5;
            const maxX1 = Math.max(p1a.x, p1b.x) - 0.5;
            const minY2 = Math.min(p2a.y, p2b.y) + 0.5;
            const maxY2 = Math.max(p2a.y, p2b.y) - 0.5;

            if (crossX > minX1 && crossX < maxX1 && crossY > minY2 && crossY < maxY2) {
              // El cable horizontal (w1) hace el salto sobre w2
              let list = crossingsMap.get(w1.id);
              if (!list) {
                list = [];
                crossingsMap.set(w1.id, list);
              }
              list.push({ x: crossX, y: crossY });
            }
          } else if (isVert1 && isHoriz2) {
            const crossX = p1a.x;
            const crossY = p2a.y;
            const minX2 = Math.min(p2a.x, p2b.x) + 0.5;
            const maxX2 = Math.max(p2a.x, p2b.x) - 0.5;
            const minY1 = Math.min(p1a.y, p1b.y) + 0.5;
            const maxY1 = Math.max(p1a.y, p1b.y) - 0.5;

            if (crossX > minX2 && crossX < maxX2 && crossY > minY1 && crossY < maxY1) {
              // El cable horizontal (w2) hace el salto sobre w1
              let list = crossingsMap.get(w2.id);
              if (!list) {
                list = [];
                crossingsMap.set(w2.id, list);
              }
              list.push({ x: crossX, y: crossY });
            }
          }
        }
      }
    }
  }

  return crossingsMap;
}

export function calculateWireMidpoint(points: readonly Point2D[]): Point2D | null {
  if (!points || points.length < 2) return null;

  let totalLength = 0;
  const segmentLengths: number[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const len = Math.hypot(dx, dy);
    segmentLengths.push(len);
    totalLength += len;
  }

  if (totalLength === 0) return { ...points[0] };

  const targetDist = totalLength / 2;
  let accumulated = 0;

  for (let i = 0; i < segmentLengths.length; i++) {
    const segLen = segmentLengths[i];
    if (accumulated + segLen >= targetDist) {
      const remaining = targetDist - accumulated;
      const ratio = segLen > 0 ? remaining / segLen : 0;
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * ratio,
        y: points[i].y + (points[i + 1].y - points[i].y) * ratio,
      };
    }
    accumulated += segLen;
  }

  return { ...points[Math.floor(points.length / 2)] };
}

export type WireHandleType = 'vertex' | 'segment';

export interface WireHandleHit {
  wire: WireInstance;
  type: WireHandleType;
  index: number;
  point: Point2D;
}

export function hitTestWireHandles(
  wires: readonly WireInstance[],
  worldX: number,
  worldY: number,
  vertexThreshold = 8,
  segmentThreshold = 6,
): WireHandleHit | null {
  for (let w = wires.length - 1; w >= 0; w--) {
    const wire = wires[w];
    if (!wire.points || wire.points.length < 2) continue;

    // 1. Probar vértices interiores (esquinas)
    for (let i = 1; i < wire.points.length - 1; i++) {
      const pt = wire.points[i];
      if (Math.hypot(pt.x - worldX, pt.y - worldY) <= vertexThreshold) {
        return { wire, type: 'vertex', index: i, point: { ...pt } };
      }
    }

    // 2. Probar segmentos intermedios
    for (let i = 0; i < wire.points.length - 1; i++) {
      const p1 = wire.points[i];
      const p2 = wire.points[i + 1];

      const minX = Math.min(p1.x, p2.x) - segmentThreshold;
      const maxX = Math.max(p1.x, p2.x) + segmentThreshold;
      const minY = Math.min(p1.y, p2.y) - segmentThreshold;
      const maxY = Math.max(p1.y, p2.y) + segmentThreshold;

      if (worldX >= minX && worldX <= maxX && worldY >= minY && worldY <= maxY) {
        const isHoriz = Math.abs(p1.y - p2.y) < 1;
        const dist = isHoriz ? Math.abs(worldY - p1.y) : Math.abs(worldX - p1.x);

        if (dist <= segmentThreshold) {
          const midX = (p1.x + p2.x) / 2;
          const midY = (p1.y + p2.y) / 2;
          return { wire, type: 'segment', index: i, point: { x: midX, y: midY } };
        }
      }
    }
  }

  return null;
}

export function dragWireVertex(
  pts: readonly Point2D[],
  index: number,
  targetPoint: Point2D,
): Point2D[] {
  const result = pts.map((p) => ({ ...p }));
  if (index <= 0 || index >= result.length - 1) return result;

  result[index] = { ...targetPoint };

  // Ajustar vecino anterior
  const prev = result[index - 1];
  if (Math.abs(prev.x - pts[index].x) < 1) {
    prev.x = targetPoint.x;
  } else if (Math.abs(prev.y - pts[index].y) < 1) {
    prev.y = targetPoint.y;
  }

  // Ajustar vecino posterior
  const next = result[index + 1];
  if (Math.abs(next.x - pts[index].x) < 1) {
    next.x = targetPoint.x;
  } else if (Math.abs(next.y - pts[index].y) < 1) {
    next.y = targetPoint.y;
  }

  return result;
}

export function dragWireSegment(
  pts: readonly Point2D[],
  segmentIndex: number,
  deltaX: number,
  deltaY: number,
): Point2D[] {
  const result = pts.map((p) => ({ ...p }));
  if (segmentIndex < 0 || segmentIndex >= result.length - 1) return result;

  const p1 = result[segmentIndex];
  const p2 = result[segmentIndex + 1];
  const isHoriz = Math.abs(p1.y - p2.y) < 1;

  if (isHoriz) {
    p1.y += deltaY;
    p2.y += deltaY;
  } else {
    p1.x += deltaX;
    p2.x += deltaX;
  }

  return result;
}
