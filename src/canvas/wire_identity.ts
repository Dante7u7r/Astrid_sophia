import type { WireEndpoint } from "../canvas_orchestrator";

export function wireEndpointKey(ep: WireEndpoint): string {
  return `${ep.componentId}:${ep.pinIndex}`;
}

export function createWireId(from: WireEndpoint, to: WireEndpoint): string {
  return `wire_${from.componentId}_p${from.pinIndex}_to_${to.componentId}_p${to.pinIndex}`;
}
