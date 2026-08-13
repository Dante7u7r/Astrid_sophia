import type { ComponentInstance, PinInstance, WireInstance } from "../canvas_orchestrator";
import { hitTestComponentAt } from "./component_geometry";
import { findHoveredWire, hitTestWireHandles, type WireHandleHit } from "./wiring_model";

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
  cursor: string;
}

export function hitTestPin(
  components: readonly ComponentInstance[],
  getPins: (component: ComponentInstance) => readonly PinInstance[],
  worldX: number,
  worldY: number,
  threshold: number,
): { pin: PinInstance; comp: ComponentInstance } | null {
  for (const comp of components) {
    const pins = getPins(comp);
    for (const pin of pins) {
      const dx = worldX - pin.x;
      const dy = worldY - pin.y;
      if (dx * dx + dy * dy <= threshold * threshold) {
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
): HoverState {
  const pinHit = hitTestPin(
    components,
    getPins,
    worldX,
    worldY,
    options.pinThreshold,
  );
  if (pinHit) {
    return {
      hoveredComponent: null,
      hoveredPin: pinHit.pin,
      hoveredWire: null,
      hoveredWireHandle: null,
      cursor: options.activePinForWire ? "crosshair" : "pointer",
    };
  }

  for (const comp of components) {
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
      cursor,
    };
  }

  const wireHandleHit = hitTestWireHandles(wires, worldX, worldY);
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
      cursor: "pointer",
    };
  }

  return {
    hoveredComponent: null,
    hoveredPin: null,
    hoveredWire: null,
    hoveredWireHandle: null,
    cursor: "default",
  };
}
