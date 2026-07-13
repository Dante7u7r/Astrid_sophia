// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createSidePanelController } from "./side_panel_controller";
import type { PanelLayoutManager } from "./panel_layout_manager";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function setupDom(): void {
  document.body.innerHTML = `
    <main id="main-dashboard">
      <aside id="sidebar-left" class="collapsed"></aside>
      <aside id="sidebar-right" class="collapsed"></aside>
      <button id="btn-toggle-left"></button>
      <button id="btn-toggle-right"></button>
      <button id="btn-dock-toggle-left"></button>
      <button id="btn-dock-toggle-right"></button>
      <button id="btn-expand-left"></button>
      <button id="btn-expand-right"></button>
    </main>
  `;
}

function mediaQuery(matches: boolean): MediaQueryList {
  return {
    matches,
    media: "(max-width: 760px)",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

describe("SidePanelController", () => {
  it("sincroniza backdrop y aria-expanded en viewport compacto", () => {
    setupDom();
    const collapsed = { left: false, right: true };
    const panelLayoutManager = {
      isPanelCollapsed: (panel: "left" | "right") => collapsed[panel],
      setPanelCollapsed: vi.fn((panel: "left" | "right", value: boolean) => {
        collapsed[panel] = value;
        document.querySelector(`#sidebar-${panel}`)?.classList.toggle("collapsed", value);
      }),
      togglePanel: vi.fn(),
    } as unknown as PanelLayoutManager;

    const controller = createSidePanelController({
      getPanelLayoutManager: () => panelLayoutManager,
      isTypingInFormField: () => false,
      matchMedia: () => mediaQuery(true),
      requestAnimationFrame: (callback) => {
        callback(0);
        return 1;
      },
      setTimeout: (callback) => {
        callback();
        return 1;
      },
    });

    controller.init();
    controller.toggleSidePanel("left");

    expect(document.body.classList.contains("mobile-drawer-open")).toBe(true);
    expect(document.querySelector("#mobile-drawer-backdrop")?.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector("#btn-toggle-left")?.getAttribute("aria-expanded")).toBe("true");
  });

  it("usa togglePanel en escritorio", () => {
    setupDom();
    const panelLayoutManager = {
      isPanelCollapsed: () => true,
      setPanelCollapsed: vi.fn(),
      togglePanel: vi.fn(),
    } as unknown as PanelLayoutManager;

    const controller = createSidePanelController({
      getPanelLayoutManager: () => panelLayoutManager,
      isTypingInFormField: () => false,
      matchMedia: () => mediaQuery(false),
      requestAnimationFrame: (callback) => {
        callback(0);
        return 1;
      },
      setTimeout: (callback) => {
        callback();
        return 1;
      },
    });

    controller.init();
    controller.toggleSidePanel("right");

    expect(panelLayoutManager.togglePanel).toHaveBeenCalledWith("right");
  });
});
