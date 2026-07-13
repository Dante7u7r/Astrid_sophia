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
  generatePath: (start: Point2D, end: Point2D) => Point2D[],
): void {
  for (const wire of wires) {
    const fromComp = components.find((component) => component.id === wire.from.componentId);
    const toComp = components.find((component) => component.id === wire.to.componentId);
    if (!fromComp || !toComp) continue;

    const startPt = getPins(fromComp).find((pin) => pin.pinIndex === wire.from.pinIndex);
    const endPt = getPins(toComp).find((pin) => pin.pinIndex === wire.to.pinIndex);
    if (!startPt || !endPt) continue;

    wire.points = generatePath(startPt, endPt);
  }
}
