import { describe, expect, it } from "vitest";
import { WorkspaceStore } from "./workspace_store";

describe("WorkspaceStore", () => {
  it("crea pestanas con nombre incremental y activa la seleccion explicitamente", () => {
    const store = new WorkspaceStore();

    const first = store.createTab("tab-1");
    const second = store.createTab("tab-2");
    store.setActiveTabId(second.id);

    expect(first.name).toBe("Circuito 1");
    expect(second.name).toBe("Circuito 2");
    expect(store.getTabs()).toEqual([first, second]);
    expect(store.getActiveTab()).toBe(second);
  });

  it("remueve pestanas y calcula fallback sin tocar el runtime", () => {
    const store = new WorkspaceStore();
    const first = store.createTab("tab-1", "Primera");
    const second = store.createTab("tab-2", "Segunda");
    const third = store.createTab("tab-3", "Tercera");

    const removed = store.removeTab(second.id);

    expect(removed).toEqual({ removed: second, index: 1 });
    expect(store.getTabs()).toEqual([first, third]);
    expect(store.getFallbackTabIdAfterRemoval(1)).toBe(first.id);
  });

  it("marca la pestana activa como modificada solo una vez", () => {
    const store = new WorkspaceStore();
    const tab = store.createTab("tab-1", "Circuito");
    store.setActiveTabId(tab.id);

    expect(store.markActiveTabAsModified()).toBe(true);
    expect(tab.unsaved).toBe(true);
    expect(store.markActiveTabAsModified()).toBe(false);
  });
});
