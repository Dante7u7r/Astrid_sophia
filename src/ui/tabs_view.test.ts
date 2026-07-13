// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { createWorkspaceTab } from "./workspace_state";
import { TabsView } from "./tabs_view";

describe("TabsView", () => {
  it("renderiza pestanas, estado activo y punto de cambios", () => {
    document.body.innerHTML = '<div id="tabs-container"></div>';
    const first = createWorkspaceTab("tab-1", "Primera");
    const second = createWorkspaceTab("tab-2", "Segunda");
    second.unsaved = true;

    new TabsView().render([first, second], second.id, {
      onSelect: vi.fn(),
      onClose: vi.fn(),
    });

    const tabs = [...document.querySelectorAll(".tab-item")];
    expect(tabs).toHaveLength(2);
    expect(tabs[1].classList.contains("active")).toBe(true);
    expect(tabs[1].querySelector(".tab-unsaved")).not.toBeNull();
  });

  it("emite seleccion y cierre sin disparar seleccion al cerrar", () => {
    document.body.innerHTML = '<div id="tabs-container"></div>';
    const tab = createWorkspaceTab("tab-1", "Primera");
    const onSelect = vi.fn();
    const onClose = vi.fn();

    new TabsView().render([tab], tab.id, { onSelect, onClose });

    document.querySelector<HTMLElement>(".tab-item")?.click();
    document.querySelector<HTMLElement>(".tab-close")?.click();

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith(tab.id);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
