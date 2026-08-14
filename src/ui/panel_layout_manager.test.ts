// @vitest-environment happy-dom

import { beforeEach, describe, expect, test, vi } from "vitest";
import { PanelLayoutManager } from "./panel_layout_manager";

describe("PanelLayoutManager accesible", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = `
      <div id="root">
        <main id="main-dashboard">
          <aside id="sidebar-left"><header id="left-panel-header"></header></aside>
          <section id="workspace-center"></section>
          <aside id="sidebar-right"><header id="right-panel-header"></header></aside>
        </main>
        <section id="bottom-dock"><header id="osc-header"></header></section>
        <button id="btn-toggle-left"></button>
        <button id="btn-toggle-right"></button>
      </div>
    `;
  });

  test("los separadores exponen valor y permiten redimensionar por teclado", () => {
    const onResize = vi.fn();
    new PanelLayoutManager(document.querySelector("#root") as HTMLElement, onResize);
    const left = document.querySelector("#resize-handle-left") as HTMLElement;

    expect(left.getAttribute("role")).toBe("separator");
    expect(left.getAttribute("aria-orientation")).toBe("vertical");
    expect(left.tabIndex).toBe(0);
    expect(left.getAttribute("aria-valuenow")).toBe("236");

    left.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(left.getAttribute("aria-valuenow")).toBe("246");
    expect(document.documentElement.style.getPropertyValue("--left-panel-width")).toBe("246px");
    expect(onResize).toHaveBeenCalled();

    left.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(left.getAttribute("aria-valuenow")).toBe("236");
  });
});
