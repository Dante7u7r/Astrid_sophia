import type { PinInstance, WireInstance } from "../canvas_orchestrator";
import { findConnectedWireIds } from "./wiring_model";
import { wireEndpointKey } from "./wire_identity";

export interface NetHighlightResult {
  activeNodeId?: string;
  netWireIds: Set<string>;
  netPinKeys: Set<string>;
}

/**
 * Resolves the full equipotential electrical net (all wires and pins)
 * connected to the currently hovered/selected wire or pin.
 */
export function getActiveNetHighlight(options: {
  wires: readonly WireInstance[];
  hoveredWire: WireInstance | null;
  hoveredPin: PinInstance | null;
  selectedWire: WireInstance | null;
  nodeMap?: Record<string, string>;
}): NetHighlightResult {
  const { wires, hoveredWire, hoveredPin, selectedWire, nodeMap } = options;
  const netWireIds = new Set<string>();
  const netPinKeys = new Set<string>();

  let activeWire = hoveredWire || selectedWire;

  // 1. If hovered over a pin or junction, find any wire attached to this pin
  let activePinKey: string | null = null;
  if (hoveredPin) {
    activePinKey =
      hoveredPin.isJunction && hoveredPin.junctionPos
        ? `junction_${Math.round(hoveredPin.junctionPos.x)}_${Math.round(hoveredPin.junctionPos.y)}:0`
        : `${hoveredPin.componentId}:${hoveredPin.pinIndex}`;

    if (!activeWire) {
      activeWire =
        wires.find((w) => {
          const fromKey = wireEndpointKey(w.from);
          const toKey = wireEndpointKey(w.to);
          return fromKey === activePinKey || toKey === activePinKey;
        }) || null;
    }
  }

  if (!activeWire && !activePinKey) {
    return { netWireIds, netPinKeys };
  }

  let activeNodeId: string | undefined;

  if (activePinKey && nodeMap && nodeMap[activePinKey]) {
    activeNodeId = nodeMap[activePinKey];
  } else if (activeWire && nodeMap) {
    const fromKey = wireEndpointKey(activeWire.from);
    const toKey = wireEndpointKey(activeWire.to);
    activeNodeId = nodeMap[fromKey] || nodeMap[toKey];
  }

  // 2. If nodeMap is available and has an active node ID, match all pins and wires with that node ID
  if (activeNodeId && nodeMap) {
    for (const [pinKey, nodeId] of Object.entries(nodeMap)) {
      if (nodeId === activeNodeId) {
        netPinKeys.add(pinKey);
      }
    }

    for (const wire of wires) {
      const fromKey = wireEndpointKey(wire.from);
      const toKey = wireEndpointKey(wire.to);
      if (nodeMap[fromKey] === activeNodeId || nodeMap[toKey] === activeNodeId) {
        netWireIds.add(wire.id);
      }
    }

    return { activeNodeId, netWireIds, netPinKeys };
  }

  // 3. Fallback to graph traversal when nodeMap is not yet generated
  if (activeWire) {
    const connectedWires = findConnectedWireIds(wires, activeWire.id);
    for (const wId of connectedWires) {
      netWireIds.add(wId);
      const wire = wires.find((w) => w.id === wId);
      if (wire) {
        netPinKeys.add(wireEndpointKey(wire.from));
        netPinKeys.add(wireEndpointKey(wire.to));
      }
    }
  } else if (activePinKey) {
    netPinKeys.add(activePinKey);
  }

  return { activeNodeId, netWireIds, netPinKeys };
}
