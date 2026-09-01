import type { BoundingBox, ComponentInstance, PinInstance, Point2D, WireEndpoint, WireInstance } from "../canvas_orchestrator";
import { createWireId, wireEndpointKey } from "./wire_identity";
import { simplifyOrthogonalWirePath } from "./wire_cleanup";

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
  const fromKey = wireEndpointKey(from);
  const toKey = wireEndpointKey(to);

  return wires.some((wire) => {
    const wFromKey = wireEndpointKey(wire.from);
    const wToKey = wireEndpointKey(wire.to);
    return (
      (wFromKey === fromKey && wToKey === toKey) ||
      (wFromKey === toKey && wToKey === fromKey)
    );
  });
}

export function connectPins(
  wires: WireInstance[],
  from: WireEndpoint,
  to: WireEndpoint,
): boolean {
  if (from.componentId === to.componentId && !from.isJunction && !to.isJunction) return false;
  const fromKey = wireEndpointKey(from);
  const toKey = wireEndpointKey(to);
  if (fromKey === toKey) return false;
  if (wireExists(wires, from, to)) return false;

  wires.push({
    id: createWireId(from, to),
    from: { ...from },
    to: { ...to },
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
    let startPt: Point2D | undefined;
    if (wire.from.isJunction && wire.from.junctionPos) {
      startPt = { ...wire.from.junctionPos };
    } else {
      const fromComp = components.find((component) => component.id === wire.from.componentId);
      if (fromComp) {
        startPt = getPins(fromComp).find((pin) => pin.pinIndex === wire.from.pinIndex);
      }
    }

    let endPt: Point2D | undefined;
    if (wire.to.isJunction && wire.to.junctionPos) {
      endPt = { ...wire.to.junctionPos };
    } else {
      const toComp = components.find((component) => component.id === wire.to.componentId);
      if (toComp) {
        endPt = getPins(toComp).find((pin) => pin.pinIndex === wire.to.pinIndex);
      }
    }

    if (!startPt || !endPt) continue;

    // Regenerar la ruta ortogonal inteligente para conectar siempre los terminales de forma elástica y limpia
    const path = generatePath(startPt, endPt, wire.from.componentId, wire.to.componentId);
    wire.points = simplifyOrthogonalWirePath(path);
  }
}

export interface WireSegmentIntersection {
  wire: WireInstance;
  segmentIndex: number;
  snapPoint: Point2D;
}

export function findWireSegmentIntersection(
  wires: readonly WireInstance[],
  point: Point2D,
  tolerance = 8,
): WireSegmentIntersection | null {
  for (const wire of wires) {
    if (!wire.points || wire.points.length < 2) continue;
    for (let i = 0; i < wire.points.length - 1; i++) {
      const p1 = wire.points[i];
      const p2 = wire.points[i + 1];

      const isHoriz = Math.abs(p1.y - p2.y) < 0.5;
      const isVert = Math.abs(p1.x - p2.x) < 0.5;

      if (isHoriz) {
        const minX = Math.min(p1.x, p2.x);
        const maxX = Math.max(p1.x, p2.x);
        if (point.x >= minX + 2 && point.x <= maxX - 2 && Math.abs(point.y - p1.y) <= tolerance) {
          return {
            wire,
            segmentIndex: i,
            snapPoint: { x: point.x, y: p1.y },
          };
        }
      } else if (isVert) {
        const minY = Math.min(p1.y, p2.y);
        const maxY = Math.max(p1.y, p2.y);
        if (point.y >= minY + 2 && point.y <= maxY - 2 && Math.abs(point.x - p1.x) <= tolerance) {
          return {
            wire,
            segmentIndex: i,
            snapPoint: { x: p1.x, y: point.y },
          };
        }
      }
    }
  }
  return null;
}

export function splitWireAtPoint(
  wire: WireInstance,
  splitPoint: Point2D,
): [WireInstance, WireInstance] {
  const junctionPos: Point2D = {
    x: Math.round(splitPoint.x),
    y: Math.round(splitPoint.y),
  };
  const junctionEp: WireEndpoint = {
    componentId: `junction_${junctionPos.x}_${junctionPos.y}`,
    pinIndex: 0,
    isJunction: true,
    junctionPos,
  };

  const pts = wire.points && wire.points.length >= 2 ? wire.points : [];
  let splitIndex = 0;
  let minDistance = Infinity;

  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const isHoriz = Math.abs(p1.y - p2.y) < 1;
    const dist = isHoriz ? Math.abs(junctionPos.y - p1.y) : Math.abs(junctionPos.x - p1.x);
    if (dist < minDistance) {
      minDistance = dist;
      splitIndex = i;
    }
  }

  const pointsA: Point2D[] = pts.slice(0, splitIndex + 1);
  pointsA.push({ ...junctionPos });

  const pointsB: Point2D[] = [{ ...junctionPos }];
  pointsB.push(...pts.slice(splitIndex + 1));

  const wireA: WireInstance = {
    id: createWireId(wire.from, junctionEp),
    from: { ...wire.from },
    to: { ...junctionEp },
    points: pointsA.length >= 2 ? pointsA : [],
    ...(wire.label ? { label: wire.label } : {}),
    ...(wire.color ? { color: wire.color } : {}),
    ...(wire.customPath ? { customPath: true } : {}),
  };

  const wireB: WireInstance = {
    id: createWireId(junctionEp, wire.to),
    from: { ...junctionEp },
    to: { ...wire.to },
    points: pointsB.length >= 2 ? pointsB : [],
    ...(wire.label ? { label: wire.label } : {}),
    ...(wire.color ? { color: wire.color } : {}),
    ...(wire.customPath ? { customPath: true } : {}),
  };

  return [wireA, wireB];
}

export function connectPinToWire(
  wires: WireInstance[],
  from: WireEndpoint,
  targetWire: WireInstance,
  splitPoint: Point2D,
): boolean {
  const [wireA, wireB] = splitWireAtPoint(targetWire, splitPoint);
  const junctionEp = wireA.to;

  if (wireExists([wireA, wireB], from, junctionEp)) {
    return false;
  }

  const wireC: WireInstance = {
    id: createWireId(from, junctionEp),
    from: { ...from },
    to: { ...junctionEp },
    points: [],
  };

  const targetIdx = wires.findIndex((w) => w.id === targetWire.id);
  if (targetIdx >= 0) {
    wires.splice(targetIdx, 1, wireA, wireB, wireC);
  } else {
    wires.push(wireA, wireB, wireC);
  }

  return true;
}

export function mergeCollinearWiresAtJunction(
  wires: WireInstance[],
  junctionKey: string,
): boolean {
  const connected = wires.filter(
    (w) =>
      (w.from.isJunction && wireEndpointKey(w.from) === junctionKey) ||
      (w.to.isJunction && wireEndpointKey(w.to) === junctionKey),
  );

  if (connected.length !== 2) return false;

  const [w1, w2] = connected;
  const otherEnd1 = (w1.from.isJunction && wireEndpointKey(w1.from) === junctionKey) ? w1.to : w1.from;
  const otherEnd2 = (w2.from.isJunction && wireEndpointKey(w2.from) === junctionKey) ? w2.to : w2.from;

  // Reconstruir los puntos de la trayectoria continua desde otherEnd1 hasta otherEnd2
  const p1 = (w1.to.isJunction && wireEndpointKey(w1.to) === junctionKey)
    ? (w1.points || [])
    : [...(w1.points || [])].reverse();
  const p2 = (w2.from.isJunction && wireEndpointKey(w2.from) === junctionKey)
    ? (w2.points || [])
    : [...(w2.points || [])].reverse();
  const combinedPoints = simplifyOrthogonalWirePath([...p1, ...p2]);

  const mergedWire: WireInstance = {
    id: createWireId(otherEnd1, otherEnd2),
    from: { ...otherEnd1 },
    to: { ...otherEnd2 },
    points: combinedPoints.length >= 2 ? combinedPoints : [],
    ...(w1.label || w2.label ? { label: w1.label || w2.label } : {}),
    ...(w1.color || w2.color ? { color: w1.color || w2.color } : {}),
    ...(w1.customPath || w2.customPath ? { customPath: true } : {}),
  };

  const idx1 = wires.findIndex((w) => w.id === w1.id);
  const idx2 = wires.findIndex((w) => w.id === w2.id);

  if (idx1 >= 0 && idx2 >= 0) {
    const higherIdx = Math.max(idx1, idx2);
    const lowerIdx = Math.min(idx1, idx2);
    wires.splice(higherIdx, 1);
    wires.splice(lowerIdx, 1, mergedWire);
    return true;
  }

  return false;
}

export function autoHealJunctions(wires: WireInstance[]): void {
  const junctionKeys = new Set<string>();
  for (const wire of wires) {
    if (wire.from.isJunction && wire.from.junctionPos) {
      junctionKeys.add(wireEndpointKey(wire.from));
    }
    if (wire.to.isJunction && wire.to.junctionPos) {
      junctionKeys.add(wireEndpointKey(wire.to));
    }
  }

  for (const key of junctionKeys) {
    mergeCollinearWiresAtJunction(wires, key);
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
    const fromKey = wireEndpointKey(targetWire.from);
    const targetNode = nodeMap[fromKey];
    if (targetNode) {
      for (const wire of wires) {
        const k1 = wireEndpointKey(wire.from);
        const k2 = wireEndpointKey(wire.to);
        if (nodeMap[k1] === targetNode || nodeMap[k2] === targetNode) {
          result.add(wire.id);
        }
      }
      return result;
    }
  }

  let added = true;
  while (added) {
    added = false;
    for (const wire of wires) {
      if (result.has(wire.id)) continue;
      const isConnected = Array.from(result).some((rId) => {
        const rWire = wires.find((w) => w.id === rId);
        if (!rWire) return false;
        const wFromKey = wireEndpointKey(wire.from);
        const wToKey = wireEndpointKey(wire.to);
        const rFromKey = wireEndpointKey(rWire.from);
        const rToKey = wireEndpointKey(rWire.to);
        return (
          wFromKey === rFromKey ||
          wFromKey === rToKey ||
          wToKey === rFromKey ||
          wToKey === rToKey
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
  const pointCounts = new Map<string, { pt: Point2D; count: number; isExplicitJunction: boolean }>();

  for (const wire of wires) {
    if (!wire.points || wire.points.length === 0) continue;
    const endpoints = [
      { pt: wire.points[0], isJunction: wire.from.isJunction },
      { pt: wire.points[wire.points.length - 1], isJunction: wire.to.isJunction },
    ];
    for (const ep of endpoints) {
      const key = `${Math.round(ep.pt.x)},${Math.round(ep.pt.y)}`;
      const entry = pointCounts.get(key);
      if (entry) {
        entry.count++;
        if (ep.isJunction) entry.isExplicitJunction = true;
      } else {
        pointCounts.set(key, { pt: { x: ep.pt.x, y: ep.pt.y }, count: 1, isExplicitJunction: !!ep.isJunction });
      }
    }
  }

  const junctions: Point2D[] = [];
  for (const entry of pointCounts.values()) {
    if (entry.count >= 3 || entry.isExplicitJunction) {
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

export type WireHandleType = 'vertex' | 'segment' | 'junction';

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
  // 0. Probar uniones en T
  const junctions = findWireJunctionPoints(wires);
  for (const jPt of junctions) {
    if (Math.hypot(jPt.x - worldX, jPt.y - worldY) <= vertexThreshold) {
      const matchingWire = wires.find(
        (w) =>
          (w.points && w.points.length > 0 && Math.hypot(w.points[0].x - jPt.x, w.points[0].y - jPt.y) < 2) ||
          (w.points && w.points.length > 0 && Math.hypot(w.points[w.points.length - 1].x - jPt.x, w.points[w.points.length - 1].y - jPt.y) < 2),
      );
      if (matchingWire) {
        return { wire: matchingWire, type: 'junction', index: 0, point: { ...jPt } };
      }
    }
  }

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

export function dragJunctionNode(
  wires: WireInstance[],
  oldJunctionPos: Point2D,
  newJunctionPos: Point2D,
): void {
  const targetX = Math.round(newJunctionPos.x);
  const targetY = Math.round(newJunctionPos.y);
  const newJunctionId = `junction_${targetX}_${targetY}`;

  for (const wire of wires) {
    if (wire.from.isJunction && wire.from.junctionPos) {
      if (Math.hypot(wire.from.junctionPos.x - oldJunctionPos.x, wire.from.junctionPos.y - oldJunctionPos.y) < 2) {
        wire.from.junctionPos = { x: targetX, y: targetY };
        wire.from.componentId = newJunctionId;
        wire.id = createWireId(wire.from, wire.to);
        if (wire.points && wire.points.length > 0) {
          wire.points[0] = { x: targetX, y: targetY };
        }
      }
    }

    if (wire.to.isJunction && wire.to.junctionPos) {
      if (Math.hypot(wire.to.junctionPos.x - oldJunctionPos.x, wire.to.junctionPos.y - oldJunctionPos.y) < 2) {
        wire.to.junctionPos = { x: targetX, y: targetY };
        wire.to.componentId = newJunctionId;
        wire.id = createWireId(wire.from, wire.to);
        if (wire.points && wire.points.length > 0) {
          wire.points[wire.points.length - 1] = { x: targetX, y: targetY };
        }
      }
    }
  }
}

export function dragWireVertex(
  pts: readonly Point2D[],
  index: number,
  targetPoint: Point2D,
): Point2D[] {
  if (!pts || pts.length < 3 || index <= 0 || index >= pts.length - 1) {
    return pts ? pts.map((p) => ({ ...p })) : [];
  }

  const result = pts.map((p) => ({ ...p }));
  result[index] = { ...targetPoint };

  // Ajustar vecino anterior
  const prev = result[index - 1];
  if (index - 1 > 0) {
    if (Math.abs(prev.x - pts[index].x) < 1) {
      prev.x = targetPoint.x;
    } else if (Math.abs(prev.y - pts[index].y) < 1) {
      prev.y = targetPoint.y;
    }
  } else {
    // Si index - 1 es el pin de origen, ajustar la coordenada perpendicular de index para conservar el anclaje
    if (Math.abs(prev.x - pts[index].x) < 1) {
      result[index].x = prev.x;
    } else if (Math.abs(prev.y - pts[index].y) < 1) {
      result[index].y = prev.y;
    }
  }

  // Ajustar vecino posterior
  const next = result[index + 1];
  if (index + 1 < result.length - 1) {
    if (Math.abs(next.x - pts[index].x) < 1) {
      next.x = targetPoint.x;
    } else if (Math.abs(next.y - pts[index].y) < 1) {
      next.y = targetPoint.y;
    }
  } else {
    // Si index + 1 es el pin de destino, ajustar la coordenada perpendicular de index para conservar el anclaje
    if (Math.abs(next.x - pts[index].x) < 1) {
      result[index].x = next.x;
    } else if (Math.abs(next.y - pts[index].y) < 1) {
      result[index].y = next.y;
    }
  }

  return simplifyOrthogonalWirePath(result);
}

export function dragWireSegment(
  pts: readonly Point2D[],
  segmentIndex: number,
  deltaX: number,
  deltaY: number,
): Point2D[] {
  if (!pts || pts.length < 2 || segmentIndex < 0 || segmentIndex >= pts.length - 1) {
    return pts ? pts.map((p) => ({ ...p })) : [];
  }

  const p1 = pts[segmentIndex];
  const p2 = pts[segmentIndex + 1];
  const isHoriz = Math.abs(p1.y - p2.y) < 1;

  // Caso 1: Cable de 2 puntos (un solo segmento recto entre dos pines)
  if (pts.length === 2) {
    const start = { ...pts[0] };
    const end = { ...pts[1] };
    if (isHoriz) {
      if (Math.abs(deltaY) < 1) return [start, end];
      const newY = start.y + deltaY;
      return [
        start,
        { x: start.x, y: newY },
        { x: end.x, y: newY },
        end,
      ];
    } else {
      if (Math.abs(deltaX) < 1) return [start, end];
      const newX = start.x + deltaX;
      return [
        start,
        { x: newX, y: start.y },
        { x: newX, y: end.y },
        end,
      ];
    }
  }

  // Caso 2: Primer segmento (índice 0) de un cable multi-segmento conectado a pin
  if (segmentIndex === 0) {
    const start = { ...pts[0] };
    const nextPts = pts.map((p) => ({ ...p }));
    if (isHoriz) {
      if (Math.abs(deltaY) < 1) return nextPts;
      const newY = start.y + deltaY;
      nextPts[1].y = newY;
      return simplifyOrthogonalWirePath([
        start,
        { x: start.x, y: newY },
        ...nextPts.slice(1),
      ]);
    } else {
      if (Math.abs(deltaX) < 1) return nextPts;
      const newX = start.x + deltaX;
      nextPts[1].x = newX;
      return simplifyOrthogonalWirePath([
        start,
        { x: newX, y: start.y },
        ...nextPts.slice(1),
      ]);
    }
  }

  // Caso 3: Último segmento (índice pts.length - 2) de un cable multi-segmento conectado a pin
  if (segmentIndex === pts.length - 2) {
    const end = { ...pts[pts.length - 1] };
    const prevPts = pts.map((p) => ({ ...p }));
    if (isHoriz) {
      if (Math.abs(deltaY) < 1) return prevPts;
      const newY = end.y + deltaY;
      prevPts[segmentIndex].y = newY;
      return simplifyOrthogonalWirePath([
        ...prevPts.slice(0, segmentIndex + 1),
        { x: end.x, y: newY },
        end,
      ]);
    } else {
      if (Math.abs(deltaX) < 1) return prevPts;
      const newX = end.x + deltaX;
      prevPts[segmentIndex].x = newX;
      return simplifyOrthogonalWirePath([
        ...prevPts.slice(0, segmentIndex + 1),
        { x: newX, y: end.y },
        end,
      ]);
    }
  }

  // Caso 4: Segmento interior intermedio (entre dos esquinas internas)
  const result = pts.map((p) => ({ ...p }));
  if (isHoriz) {
    result[segmentIndex].y += deltaY;
    result[segmentIndex + 1].y += deltaY;
  } else {
    result[segmentIndex].x += deltaX;
    result[segmentIndex + 1].x += deltaX;
  }
  return simplifyOrthogonalWirePath(result);
}

export interface JunctionInfo {
  readonly pt: Point2D;
  readonly nodeId?: string;
  readonly netLabel?: string;
  readonly voltage?: number;
  readonly branchCount: number;
  readonly connectedPinKeys: readonly string[];
}

/**
 * Resuelve la información eléctrica, nodo SPICE, etiqueta de red y ramales conectados
 * para un punto de unión en T o empalme.
 */
export function findJunctionInfoAt(
  jPt: Point2D,
  wires: readonly WireInstance[],
  nodeMap?: Record<string, string>,
  voltageMap?: Record<string, number>,
  tolerance = 8,
): JunctionInfo | null {
  const matchingWires: WireInstance[] = [];
  const connectedPinKeys = new Set<string>();
  let resolvedNodeId: string | undefined;
  let resolvedNetLabel: string | undefined;
  let resolvedVoltage: number | undefined;

  for (const w of wires) {
    if (!w.points || w.points.length < 2) continue;
    const pStart = w.points[0];
    const pEnd = w.points[w.points.length - 1];

    const distStart = Math.hypot(pStart.x - jPt.x, pStart.y - jPt.y);
    const distEnd = Math.hypot(pEnd.x - jPt.x, pEnd.y - jPt.y);

    if (distStart <= tolerance || distEnd <= tolerance) {
      matchingWires.push(w);
      if (w.label) resolvedNetLabel = w.label;

      const fromKey = `${w.from.componentId}:${w.from.pinIndex}`;
      const toKey = `${w.to.componentId}:${w.to.pinIndex}`;

      if (!w.from.isJunction) {
        connectedPinKeys.add(fromKey);
        if (nodeMap?.[fromKey]) resolvedNodeId = nodeMap[fromKey];
        if (voltageMap?.[fromKey] !== undefined) resolvedVoltage = voltageMap[fromKey];
      }
      if (!w.to.isJunction) {
        connectedPinKeys.add(toKey);
        if (nodeMap?.[toKey]) resolvedNodeId = nodeMap[toKey];
        if (voltageMap?.[toKey] !== undefined) resolvedVoltage = voltageMap[toKey];
      }
    }
  }

  if (matchingWires.length === 0) return null;

  return {
    pt: jPt,
    nodeId: resolvedNodeId,
    netLabel: resolvedNetLabel,
    voltage: resolvedVoltage,
    branchCount: matchingWires.length,
    connectedPinKeys: Array.from(connectedPinKeys),
  };
}

/**
 * Resuelve la etiqueta de red compartida para un cable dentro de su misma red eléctrica.
 */
export function resolveNetLabelForWire(
  wire: WireInstance,
  wires: readonly WireInstance[],
  nodeMap?: Record<string, string>,
): string | undefined {
  if (wire.label) return wire.label;
  const fromKey = `${wire.from.componentId}:${wire.from.pinIndex}`;
  const toKey = `${wire.to.componentId}:${wire.to.pinIndex}`;
  const wireNodeId = nodeMap ? (nodeMap[fromKey] ?? nodeMap[toKey]) : undefined;

  if (wireNodeId && nodeMap) {
    for (const w of wires) {
      if (w.label) {
        const k1 = `${w.from.componentId}:${w.from.pinIndex}`;
        const k2 = `${w.to.componentId}:${w.to.pinIndex}`;
        if (nodeMap[k1] === wireNodeId || nodeMap[k2] === wireNodeId) {
          return w.label;
        }
      }
    }
  }
  return undefined;
}
