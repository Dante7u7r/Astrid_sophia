import type {
  ComponentInstance,
  PinInstance,
  Point2D,
  WireInstance,
} from "../canvas_orchestrator";
import { hitTestComponentAt } from "./component_geometry";
import {
  findHoveredWire,
  findWireJunctionPoints,
  findWireSegmentIntersection,
  hitTestWireHandles,
  type WireHandleHit,
  type WireSegmentIntersection,
} from "./wiring_model";

export interface HoverOptions {
  activePinForWire: PinInstance | null;
  isDragging: boolean;
  simulationActive: boolean;
  pinThreshold: number;
}

export interface HoverState {
  hoveredComponent: ComponentInstance | null;
  hoveredPin: PinInstance | null;
  hoveredWire: WireInstance | null;
  hoveredWireHandle: WireHandleHit | null;
  hoveredWireSnapPoint: WireSegmentIntersection | null;
  cursor: string;
}

export function hitTestPin(
  components: readonly ComponentInstance[],
  getPins: (component: ComponentInstance) => readonly PinInstance[],
  worldX: number,
  worldY: number,
  threshold: number,
  wires?: readonly WireInstance[],
  spatialIndex?: { queryComponentCandidates(point: Point2D, radius?: number): ComponentInstance[]; queryWireCandidates(point: Point2D, radius?: number): WireInstance[] } | null,
): { pin: PinInstance; comp: ComponentInstance } | null {
  const compsToTest = (spatialIndex && components.length > 30)
    ? spatialIndex.queryComponentCandidates({ x: worldX, y: worldY }, threshold + 30)
    : components;

  for (const comp of compsToTest) {
    const pins = getPins(comp);
    for (const pin of pins) {
      const dx = worldX - pin.x;
      const dy = worldY - pin.y;
      if (dx * dx + dy * dy <= threshold * threshold) {
        return { pin, comp };
      }
    }
  }

  const wiresToTest = (spatialIndex && wires && wires.length > 30)
    ? spatialIndex.queryWireCandidates({ x: worldX, y: worldY }, threshold + 30)
    : wires;

  if (wiresToTest && wiresToTest.length > 0) {
    const junctions = findWireJunctionPoints(wiresToTest);
    for (const jPt of junctions) {
      const dx = worldX - jPt.x;
      const dy = worldY - jPt.y;
      if (dx * dx + dy * dy <= threshold * threshold) {
        const jX = Math.round(jPt.x);
        const jY = Math.round(jPt.y);
        const pin: PinInstance = {
          componentId: `junction_${jX}_${jY}`,
          pinIndex: 0,
          x: jPt.x,
          y: jPt.y,
          isJunction: true,
          junctionPos: { x: jPt.x, y: jPt.y },
        };
        const comp: ComponentInstance = {
          id: `junction_${jX}_${jY}`,
          type: "ground",
          x: jPt.x,
          y: jPt.y,
          rotation: 0,
          value: 0,
        };
        return { pin, comp };
      }
    }
  }

  return null;
}

export function resolveHoverState(
  components: readonly ComponentInstance[],
  wires: readonly WireInstance[],
  getPins: (component: ComponentInstance) => readonly PinInstance[],
  worldX: number,
  worldY: number,
  options: HoverOptions,
  spatialIndex?: { queryComponentCandidates(point: Point2D, radius?: number): ComponentInstance[]; queryWireCandidates(point: Point2D, radius?: number): WireInstance[] } | null,
): HoverState {
  const pinHit = hitTestPin(
    components,
    getPins,
    worldX,
    worldY,
    options.pinThreshold,
    wires,
    spatialIndex,
  );
  if (pinHit) {
    return {
      hoveredComponent: null,
      hoveredPin: pinHit.pin,
      hoveredWire: null,
      hoveredWireHandle: null,
      hoveredWireSnapPoint: null,
      cursor: options.activePinForWire ? "crosshair" : "pointer",
    };
  }

  const compsToTest = (spatialIndex && components.length > 30)
    ? spatialIndex.queryComponentCandidates({ x: worldX, y: worldY }, 30)
    : components;

  const wiresToTest = (spatialIndex && wires.length > 30)
    ? spatialIndex.queryWireCandidates({ x: worldX, y: worldY }, 30)
    : wires;

  // Si se está tirando un cable, permitir empalme directo sobre cables existentes (T-Junction tap)
  if (options.activePinForWire) {
    const wireSegmentHit = findWireSegmentIntersection(wiresToTest, { x: worldX, y: worldY }, 12);
    if (wireSegmentHit) {
      return {
        hoveredComponent: null,
        hoveredPin: null,
        hoveredWire: wireSegmentHit.wire,
        hoveredWireHandle: null,
        hoveredWireSnapPoint: wireSegmentHit,
        cursor: "crosshair",
      };
    }
  }

  for (const comp of compsToTest) {
    if (!hitTestComponentAt(comp, worldX, worldY)) continue;

    let cursor = "grab";
    if (options.isDragging) {
      cursor = "grabbing";
    } else if (options.activePinForWire) {
      cursor = "crosshair";
    } else if (options.simulationActive && comp.type === "switch") {
      cursor = "pointer";
    }

    return {
      hoveredComponent: comp,
      hoveredPin: null,
      hoveredWire: null,
      hoveredWireHandle: null,
      hoveredWireSnapPoint: null,
      cursor,
    };
  }

  const wireHandleHit = hitTestWireHandles(wiresToTest, worldX, worldY);
  if (wireHandleHit) {
    let cursor = "move";
    if (wireHandleHit.type === "segment") {
      const p1 = wireHandleHit.wire.points[wireHandleHit.index];
      const p2 = wireHandleHit.wire.points[wireHandleHit.index + 1];
      const isHoriz = p1 && p2 && Math.abs(p1.y - p2.y) < 1;
      cursor = isHoriz ? "ns-resize" : "ew-resize";
    }
    return {
      hoveredComponent: null,
      hoveredPin: null,
      hoveredWire: wireHandleHit.wire,
      hoveredWireHandle: wireHandleHit,
      hoveredWireSnapPoint: null,
      cursor,
    };
  }

  const hoveredWire = findHoveredWire(wires, worldX, worldY);
  if (hoveredWire) {
    return {
      hoveredComponent: null,
      hoveredPin: null,
      hoveredWire,
      hoveredWireHandle: null,
      hoveredWireSnapPoint: null,
      cursor: "pointer",
    };
  }

  return {
    hoveredComponent: null,
    hoveredPin: null,
    hoveredWire: null,
    hoveredWireHandle: null,
    hoveredWireSnapPoint: null,
    cursor: "default",
  };
}
