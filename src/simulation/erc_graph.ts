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

export function buildComponentAdjacency(netlist: CircuitNetlist, nodes = collectNetlistNodes(netlist)): Record<string, Set<string>> {
  const adjacencyList: Record<string, Set<string>> = {};
  for (const node of nodes) {
    adjacencyList[node] = new Set<string>();
  }
  for (const comp of netlist.components) {
    for (let i = 0; i < comp.pins.length; i++) {
      for (let j = i + 1; j < comp.pins.length; j++) {
        const nodeA = comp.pins[i];
        const nodeB = comp.pins[j];
        if (nodeA && nodeB && nodeA !== nodeB) {
          adjacencyList[nodeA].add(nodeB);
          adjacencyList[nodeB].add(nodeA);
        }
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
