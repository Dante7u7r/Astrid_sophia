interface CircuitHistoryState {
  current: string;
  undo: string[];
  redo: string[];
}

export interface CircuitSnapshotHistoryDependencies {
  getActiveTabId(): string | null;
  serializeCircuit(): string | null;
  applyCircuit(snapshot: string): boolean;
  onHistoryApplied(direction: "undo" | "redo"): void;
}

export class CircuitSnapshotHistory {
  private readonly states = new Map<string, CircuitHistoryState>();
  private applyingHistory = false;

  constructor(
    private readonly dependencies: CircuitSnapshotHistoryDependencies,
    private readonly maxEntries = 200,
  ) {}

  syncActiveState(reset = false): void {
    if (this.applyingHistory) return;
    const tabId = this.dependencies.getActiveTabId();
    const snapshot = this.dependencies.serializeCircuit();
    if (!tabId || snapshot === null) return;

    if (reset || !this.states.has(tabId)) {
      this.states.set(tabId, { current: snapshot, undo: [], redo: [] });
    }
  }

  recordCurrentState(): void {
    if (this.applyingHistory) return;
    const tabId = this.dependencies.getActiveTabId();
    const snapshot = this.dependencies.serializeCircuit();
    if (!tabId || snapshot === null) return;

    const state = this.states.get(tabId);
    if (!state) {
      this.states.set(tabId, { current: snapshot, undo: [], redo: [] });
      return;
    }
    if (state.current === snapshot) return;

    state.undo.push(state.current);
    if (state.undo.length > this.maxEntries) state.undo.shift();
    state.current = snapshot;
    state.redo = [];
  }

  undo(): boolean {
    return this.applyDirection("undo");
  }

  redo(): boolean {
    return this.applyDirection("redo");
  }

  canUndo(): boolean {
    return (this.getActiveState()?.undo.length ?? 0) > 0;
  }

  canRedo(): boolean {
    return (this.getActiveState()?.redo.length ?? 0) > 0;
  }

  clearTab(tabId: string): void {
    this.states.delete(tabId);
  }

  private applyDirection(direction: "undo" | "redo"): boolean {
    const state = this.getActiveState();
    if (!state) return false;

    const source = direction === "undo" ? state.undo : state.redo;
    const target = direction === "undo" ? state.redo : state.undo;
    const snapshot = source.pop();
    if (snapshot === undefined) return false;

    const current = state.current;
    let applied = false;
    this.applyingHistory = true;
    try {
      applied = this.dependencies.applyCircuit(snapshot);
    } catch {
      applied = false;
    } finally {
      this.applyingHistory = false;
    }

    if (!applied) {
      source.push(snapshot);
      return false;
    }

    target.push(current);
    if (target.length > this.maxEntries) target.shift();
    state.current = snapshot;
    this.dependencies.onHistoryApplied(direction);
    return true;
  }

  private getActiveState(): CircuitHistoryState | null {
    const tabId = this.dependencies.getActiveTabId();
    return tabId ? this.states.get(tabId) ?? null : null;
  }
}
