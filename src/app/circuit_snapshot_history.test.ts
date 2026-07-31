import { describe, expect, it, vi } from "vitest";
import { CircuitSnapshotHistory } from "./circuit_snapshot_history";

function createHarness() {
  let tabId = "tab-a";
  let snapshot = "A";
  const applied: string[] = [];
  const onHistoryApplied = vi.fn();
  const history = new CircuitSnapshotHistory({
    getActiveTabId: () => tabId,
    serializeCircuit: () => snapshot,
    applyCircuit: (next) => {
      applied.push(next);
      snapshot = next;
      return true;
    },
    onHistoryApplied,
  });

  return {
    history,
    applied,
    onHistoryApplied,
    setTabId: (next: string) => { tabId = next; },
    setSnapshot: (next: string) => { snapshot = next; },
    getSnapshot: () => snapshot,
  };
}

describe("CircuitSnapshotHistory", () => {
  it("deshace y rehace estados ya aplicados", () => {
    const harness = createHarness();
    harness.history.syncActiveState();
    harness.setSnapshot("B");
    harness.history.recordCurrentState();

    expect(harness.history.undo()).toBe(true);
    expect(harness.getSnapshot()).toBe("A");
    expect(harness.history.redo()).toBe(true);
    expect(harness.getSnapshot()).toBe("B");
    expect(harness.applied).toEqual(["A", "B"]);
    expect(harness.onHistoryApplied).toHaveBeenCalledTimes(2);
  });

  it("mantiene historiales independientes por pestaña", () => {
    const harness = createHarness();
    harness.history.syncActiveState();
    harness.setSnapshot("A2");
    harness.history.recordCurrentState();

    harness.setTabId("tab-b");
    harness.setSnapshot("B1");
    harness.history.syncActiveState();
    harness.setSnapshot("B2");
    harness.history.recordCurrentState();
    expect(harness.history.undo()).toBe(true);
    expect(harness.getSnapshot()).toBe("B1");

    harness.setTabId("tab-a");
    harness.setSnapshot("A2");
    expect(harness.history.undo()).toBe(true);
    expect(harness.getSnapshot()).toBe("A");
  });

  it("reinicia el historial al cargar un documento externo", () => {
    const harness = createHarness();
    harness.history.syncActiveState();
    harness.setSnapshot("B");
    harness.history.recordCurrentState();
    harness.setSnapshot("archivo");
    harness.history.syncActiveState(true);

    expect(harness.history.canUndo()).toBe(false);
    expect(harness.history.canRedo()).toBe(false);
  });

  it("limita el historial y conserva las entradas mas recientes", () => {
    const harness = createHarness();
    const history = new CircuitSnapshotHistory({
      getActiveTabId: () => "tab-a",
      serializeCircuit: () => harness.getSnapshot(),
      applyCircuit: (next) => {
        harness.setSnapshot(next);
        return true;
      },
      onHistoryApplied: vi.fn(),
    }, 3);
    history.syncActiveState();

    for (const value of ["B", "C", "D", "E"]) {
      harness.setSnapshot(value);
      history.recordCurrentState();
    }

    expect(history.undo()).toBe(true);
    expect(harness.getSnapshot()).toBe("D");
    expect(history.undo()).toBe(true);
    expect(harness.getSnapshot()).toBe("C");
    expect(history.undo()).toBe(true);
    expect(harness.getSnapshot()).toBe("B");
    expect(history.undo()).toBe(false);
  });

  it("restaura la pila y desbloquea el historial si aplicar un snapshot falla", () => {
    let snapshot = "A";
    let shouldThrow = true;
    const applyCircuit = vi.fn((next: string) => {
      if (shouldThrow) throw new Error("snapshot corrupto");
      snapshot = next;
      return true;
    });
    const history = new CircuitSnapshotHistory({
      getActiveTabId: () => "tab-a",
      serializeCircuit: () => snapshot,
      applyCircuit,
      onHistoryApplied: vi.fn(),
    });
    history.syncActiveState();
    snapshot = "B";
    history.recordCurrentState();

    expect(history.undo()).toBe(false);
    expect(history.canUndo()).toBe(true);
    shouldThrow = false;
    expect(history.undo()).toBe(true);
    expect(snapshot).toBe("A");
  });
});
