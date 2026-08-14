import type { WireEndpoint } from "../canvas_orchestrator";

export function wireEndpointKey(ep: WireEndpoint): string {
  if (ep.isJunction && ep.junctionPos) {
    return `junction:${Math.round(ep.junctionPos.x)}_${Math.round(ep.junctionPos.y)}`;
  }
  return `${ep.componentId}:${ep.pinIndex}`;
}

export function createWireId(from: WireEndpoint, to: WireEndpoint): string {
  const fromKey = from.isJunction && from.junctionPos
    ? `j_${Math.round(from.junctionPos.x)}_${Math.round(from.junctionPos.y)}`
    : `${from.componentId}_p${from.pinIndex}`;
  const toKey = to.isJunction && to.junctionPos
    ? `j_${Math.round(to.junctionPos.x)}_${Math.round(to.junctionPos.y)}`
    : `${to.componentId}_p${to.pinIndex}`;
  return `wire_${fromKey}_to_${toKey}`;
}
