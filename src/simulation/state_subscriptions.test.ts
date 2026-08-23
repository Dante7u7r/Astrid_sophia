import { describe, expect, it, vi } from "vitest";
import { CircuitStateManager } from "./circuit_state_manager";
import { WorkspaceStore } from "../ui/workspace_store";

describe("State Subscriptions (CircuitStateManager & WorkspaceStore)", () => {
  describe("CircuitStateManager Reactivity", () => {
    it("emite voltages-updated al actualizar voltajes desde un frame o snapshot", () => {
      const state = new CircuitStateManager();
      const listener = vi.fn();
      const unsubscribe = state.subscribe("voltages-updated", listener);

      state.setVoltagesFromSnapshot({ "1": 3.3, "2": 0.0 });
      expect(listener).toHaveBeenCalledTimes(1);

      state.clearVoltages();
      expect(listener).toHaveBeenCalledTimes(2);

      unsubscribe();
      state.setVoltagesFromSnapshot({ "1": 5.0 });
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it("emite netlist-mapped y reset en transiciones de circuito", () => {
      const state = new CircuitStateManager();
      const netlistListener = vi.fn();
      const resetListener = vi.fn();

      state.subscribe("netlist-mapped", netlistListener);
      state.subscribe("reset", resetListener);

      state.setPinToNodeMap({ "R1:0": "1", "R1:1": "0" });
      expect(netlistListener).toHaveBeenCalledTimes(1);
      expect(resetListener).not.toHaveBeenCalled();

      state.resetAll();
      expect(resetListener).toHaveBeenCalledTimes(1);
    });
  });

  describe("WorkspaceStore Reactivity", () => {
    it("emite eventos de ciclo de vida de pestañas", () => {
      const store = new WorkspaceStore();
      const onCreated = vi.fn();
      const onActivated = vi.fn();
      const onModified = vi.fn();
      const onRemoved = vi.fn();

      store.subscribe("tab-created", onCreated);
      store.subscribe("tab-activated", onActivated);
      store.subscribe("tab-modified", onModified);
      store.subscribe("tab-removed", onRemoved);

      const tab1 = store.createTab("tab-1", "Circuito 1");
      expect(onCreated).toHaveBeenCalledWith(tab1);

      store.setActiveTabId("tab-1");
      expect(onActivated).toHaveBeenCalledWith({ activeTabId: "tab-1", previousTabId: null });

      store.markActiveTabAsModified();
      expect(onModified).toHaveBeenCalledWith(expect.objectContaining({ id: "tab-1", unsaved: true }));

      const removed = store.removeTab("tab-1");
      expect(onRemoved).toHaveBeenCalledWith(removed);
    });
  });
});
