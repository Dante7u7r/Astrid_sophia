export class DisjointSetUnion {
  private parent: Record<string, string> = {};

  find(i: string): string {
    if (!this.parent[i]) {
      this.parent[i] = i;
      return i;
    }
    if (this.parent[i] === i) {
      return i;
    }
    const root = this.find(this.parent[i]);
    this.parent[i] = root;
    return root;
  }

  union(i: string, j: string): void {
    const rootI = this.find(i);
    const rootJ = this.find(j);
    if (rootI !== rootJ) {
      this.parent[rootI] = rootJ;
    }
  }
}

export function pinKey(componentId: string, pinIndex: number | string): string {
  return `${componentId}:${pinIndex}`;
}

export function assignRootNode(
  rootToNodeIdMap: Record<string, string>,
  root: string,
  nextNodeId: { value: number },
): string {
  if (!rootToNodeIdMap[root]) {
    rootToNodeIdMap[root] = nextNodeId.value.toString();
    nextNodeId.value++;
  }
  return rootToNodeIdMap[root];
}

export function mapPinKeysToNodes(
  dsu: DisjointSetUnion,
  rootToNodeIdMap: Record<string, string>,
  nextNodeId: { value: number },
  pinsKeys: readonly string[],
): string[] {
  return pinsKeys.map(pin => assignRootNode(rootToNodeIdMap, dsu.find(pin), nextNodeId));
}
