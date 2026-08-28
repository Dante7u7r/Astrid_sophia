import type { Point2D, WireEndpoint } from "../canvas_orchestrator";

export function isJunctionEndpoint(ep: WireEndpoint): boolean {
  if (ep.isJunction) return true;
  if (typeof ep.componentId === "string") {
    const id = ep.componentId.toLowerCase();
    if (id.startsWith("junction_") || id.startsWith("j_")) return true;
  }
  return false;
}

export function extractJunctionPosFromId(id: string): Point2D | undefined {
  const match = id.match(/^(?:junction|j)_(-?\d+(?:\.\d+)?)[_ :](-?\d+(?:\.\d+)?)$/i);
  if (match) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return { x, y };
    }
  }
  return undefined;
}

export function wireEndpointKey(ep: WireEndpoint): string {
  if (ep.isJunction && ep.junctionPos) {
    return `junction:${Math.round(ep.junctionPos.x)}_${Math.round(ep.junctionPos.y)}`;
  }
  if (isJunctionEndpoint(ep)) {
    if (ep.junctionPos) {
      return `junction:${Math.round(ep.junctionPos.x)}_${Math.round(ep.junctionPos.y)}`;
    }
    const coords = extractJunctionPosFromId(ep.componentId);
    if (coords) {
      return `junction:${Math.round(coords.x)}_${Math.round(coords.y)}`;
    }
    return `junction:${ep.componentId}`;
  }
  return `${ep.componentId}:${ep.pinIndex}`;
}

export function createWireId(from: WireEndpoint, to: WireEndpoint): string {
  const getEpKey = (ep: WireEndpoint): string => {
    if (ep.isJunction && ep.junctionPos) {
      return `j_${Math.round(ep.junctionPos.x)}_${Math.round(ep.junctionPos.y)}`;
    }
    if (isJunctionEndpoint(ep)) {
      if (ep.junctionPos) {
        return `j_${Math.round(ep.junctionPos.x)}_${Math.round(ep.junctionPos.y)}`;
      }
      const coords = extractJunctionPosFromId(ep.componentId);
      if (coords) {
        return `j_${Math.round(coords.x)}_${Math.round(coords.y)}`;
      }
      return `j_${ep.componentId}`;
    }
    return `${ep.componentId}_p${ep.pinIndex}`;
  };

  const fromKey = getEpKey(from);
  const toKey = getEpKey(to);
  return `wire_${fromKey}_to_${toKey}`;
}
