import type { CircuitNetlist } from "./netlist_extractor";

export function collectNetlistNodes(netlist: CircuitNetlist): Set<string> {
  const allNodes = new Set<string>();
  for (const comp of netlist.components) {
    for (const node of comp.pins) {
      allNodes.add(node);
    }
  }
  return allNodes;
}

function dcConnectivityPairs(type: string, pinCount: number): readonly (readonly [number, number | "0"])[] {
  switch (type) {
    case "resistor":
    case "inductor":
    case "diode":
    case "led":
    case "vsource":
    case "bvoltage":
    case "switch":
    case "ccvs":
    case "vcvs":
      return [[0, 1]];
    case "nmos":
    case "pmos":
    case "bsim3nmos":
    case "bsim3pmos":
    case "bsim4nmos":
    case "bsim4pmos":
    case "verilog_a":
      return [[1, 2]];
    case "npn":
    case "pnp":
    case "njf":
    case "pjf":
      return [[0, 1], [0, 2], [1, 2]];
    case "opto":
      return [[0, 1], [2, 3]];
    case "opamp":
      return [[0, 1], [4, "0"]];
    case "not_gate":
      return [[1, "0"]];
    case "and_gate":
    case "or_gate":
    case "nand_gate":
    case "nor_gate":
    case "xor_gate":
      return [[2, "0"]];
    case "arduino_uno":
    case "esp32":
    case "raspberry_pi_pico":
      return Array.from(
        { length: Math.max(0, pinCount - 1) },
        (_, pin) => [pin, pinCount - 1] as const,
      );
    default:
      return [];
  }
}

export function buildComponentAdjacency(netlist: CircuitNetlist, nodes = collectNetlistNodes(netlist)): Record<string, Set<string>> {
  const adjacencyList: Record<string, Set<string>> = {};
  for (const node of nodes) {
    adjacencyList[node] = new Set<string>();
  }
  adjacencyList["0"] ??= new Set<string>();
  for (const comp of netlist.components) {
    for (const [pinA, pinB] of dcConnectivityPairs(comp.type, comp.pins.length)) {
      const nodeA = comp.pins[pinA];
      const nodeB = pinB === "0" ? "0" : comp.pins[pinB];
      if (nodeA && nodeB && nodeA !== nodeB) {
        adjacencyList[nodeA]?.add(nodeB);
        adjacencyList[nodeB]?.add(nodeA);
      }
    }
  }
  return adjacencyList;
}

export function findReachableNodesFrom(
  startNode: string,
  adjacencyList: Record<string, Set<string>>,
): Set<string> {
  const visited = new Set<string>();
  if (!adjacencyList[startNode]) return visited;

  const queue: string[] = [startNode];
  visited.add(startNode);
  while (queue.length > 0) {
    const curr = queue.shift()!;
    const neighbors = adjacencyList[curr];
    if (!neighbors) continue;
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return visited;
}

export function collectActiveWireNodes(netlist: CircuitNetlist): Set<string> {
  const activeNodes = new Set<string>();
  activeNodes.add("0");
  for (const wire of netlist.wires ?? []) {
    for (const node of wire.nodes) {
      activeNodes.add(node);
    }
  }
  return activeNodes;
}

export function findIsolatedActiveNodes(netlist: CircuitNetlist): string[] {
  const allNodes = collectNetlistNodes(netlist);
  const adjacencyList = buildComponentAdjacency(netlist, allNodes);
  const visited = allNodes.has("0")
    ? findReachableNodesFrom("0", adjacencyList)
    : new Set<string>();
  const activeNodes = collectActiveWireNodes(netlist);

  const isolatedNodes: string[] = [];
  for (const node of allNodes) {
    if (!visited.has(node) && activeNodes.has(node)) {
      isolatedNodes.push(node);
    }
  }
  return isolatedNodes;
}

export function hasIdealVoltageSourceCycle(netlist: CircuitNetlist): boolean {
  const allNodes = collectNetlistNodes(netlist);
  const vsourceAdjacency: Record<string, string[]> = {};
  for (const node of allNodes) {
    vsourceAdjacency[node] = [];
  }
  for (const comp of netlist.components) {
    if (comp.type !== "vsource") continue;
    const nodeA = comp.pins[0];
    const nodeB = comp.pins[1];
    if (nodeA && nodeB && nodeA !== nodeB) {
      vsourceAdjacency[nodeA].push(nodeB);
      vsourceAdjacency[nodeB].push(nodeA);
    }
  }

  const cycleVisited = new Set<string>();
  const dfsDetectCycle = (node: string, parent: string | null): boolean => {
    cycleVisited.add(node);
    const neighbors = vsourceAdjacency[node] || [];
    for (const neighbor of neighbors) {
      if (!cycleVisited.has(neighbor)) {
        if (dfsDetectCycle(neighbor, node)) return true;
      } else if (neighbor !== parent) {
        return true;
      }
    }
    return false;
  };

  for (const node of allNodes) {
    if (!cycleVisited.has(node) && dfsDetectCycle(node, null)) {
      return true;
    }
  }
  return false;
}
