// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { showFloatingInstrumentContextMenu } from "./floating_instrument_context_menu";
import type { FloatingInstrumentManager, FloatingWindowInfo } from "./floating_instrument_manager";

describe("floating_instrument_context_menu", () => {
  let mockManager: Partial<FloatingInstrumentManager>;
  let mockWindowInfo: FloatingWindowInfo;

  beforeEach(() => {
    mockManager = {
      popIn: vi.fn(),
      togglePin: vi.fn(),
    };

    const win = document.createElement("div");
    win.className = "floating-instrument-window";
    const maxBtn = document.createElement("button");
    maxBtn.className = "max-btn";
    win.appendChild(maxBtn);

    mockWindowInfo = {
      tabId: "oscilloscope",
      title: "Osciloscopio Digital",
      icon: "📊",
      windowEl: win,
      originalParent: document.body,
      originalNextSibling: null,
      contentBox: document.createElement("div"),
      isPinned: false,
    };
  });

  afterEach(() => {
    document.getElementById("floating-inst-context-menu")?.remove();
  });

  it("renders the custom context menu without default webview menu", () => {
    const mouseEvent = new MouseEvent("contextmenu", {
      clientX: 200,
      clientY: 150,
      bubbles: true,
      cancelable: true,
    });
    const preventSpy = vi.spyOn(mouseEvent, "preventDefault");
    const stopSpy = vi.spyOn(mouseEvent, "stopPropagation");

    showFloatingInstrumentContextMenu(
      mouseEvent,
      "oscilloscope",
      mockManager as FloatingInstrumentManager,
      mockWindowInfo,
    );

    expect(preventSpy).toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalled();

    const menu = document.getElementById("floating-inst-context-menu");
    expect(menu).toBeTruthy();
    expect(menu?.textContent).toContain("Fijar al Lienzo");
    expect(menu?.textContent).toContain("Auto-Set de Escala");
    expect(menu?.textContent).toContain("Reacoplar al Dock");
  });

  it("triggers popIn when clicking Reacoplar option", () => {
    const mouseEvent = new MouseEvent("contextmenu", {
      clientX: 100,
      clientY: 100,
      bubbles: true,
      cancelable: true,
    });

    showFloatingInstrumentContextMenu(
      mouseEvent,
      "oscilloscope",
      mockManager as FloatingInstrumentManager,
      mockWindowInfo,
    );

    const menu = document.getElementById("floating-inst-context-menu");
    const reacoplarBtn = Array.from(menu?.querySelectorAll("button") ?? []).find((b) =>
      b.textContent?.includes("Reacoplar"),
    );
    expect(reacoplarBtn).toBeTruthy();

    reacoplarBtn?.click();
    expect(mockManager.popIn).toHaveBeenCalledWith("oscilloscope");
    expect(document.getElementById("floating-inst-context-menu")).toBeNull();
  });
});
