// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createInstrumentCenterController } from "./instrument_center_controller";
import type { PanelLayoutManager } from "./panel_layout_manager";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function setupDom(): void {
  document.body.innerHTML = `
    <button id="instruments-menu-btn">Instrumentos</button>
    <div id="instruments-dropdown">
      <button id="menu-toggle-dock">Dock</button>
    </div>
    <div id="instrument-center-backdrop" hidden></div>
    <section id="bottom-dock" class="collapsed" aria-hidden="true">
      <button id="instrument-center-close" type="button">Cerrar</button>
      <button id="instrument-child">Child</button>
    </section>
  `;
}

describe("InstrumentCenterController", () => {
  it("sincroniza backdrop y foco al abrir/cerrar", async () => {
    setupDom();
    const dock = document.querySelector<HTMLElement>("#bottom-dock")!;
    const backdrop = document.querySelector<HTMLElement>("#instrument-center-backdrop")!;
    const menuButton = document.querySelector<HTMLButtonElement>("#instruments-menu-btn")!;
    const closeButton = document.querySelector<HTMLButtonElement>("#instrument-center-close")!;
    const panelLayoutManager = {
      setPanelCollapsed: vi.fn((_panel: "left" | "right" | "dock", collapsed: boolean) => {
        dock.classList.toggle("collapsed", collapsed);
        window.dispatchEvent(new CustomEvent("panel-layout-change"));
      }),
    } as unknown as PanelLayoutManager;

    createInstrumentCenterController({
      getPanelLayoutManager: () => panelLayoutManager,
      isTypingInFormField: () => false,
      onResizeRequested: vi.fn(),
    }).init();

    menuButton.focus();
    panelLayoutManager.setPanelCollapsed("dock", false);
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(dock.getAttribute("aria-hidden")).toBe("false");
    expect(backdrop.hasAttribute("hidden")).toBe(false);
    expect(document.activeElement).toBe(closeButton);

    closeButton.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(panelLayoutManager.setPanelCollapsed).toHaveBeenLastCalledWith("dock", true);
    expect(backdrop.hasAttribute("hidden")).toBe(true);
    expect(document.activeElement).toBe(menuButton);
  });
});
