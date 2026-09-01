// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutoHideController } from "./auto_hide_controller";
import type { PanelLayoutManager } from "./panel_layout_manager";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window, "addEventListener");
  vi.spyOn(document, "addEventListener");
  document.body.innerHTML = `
    <section id="bottom-dock">
      <button id="instrument-center-pin" type="button">Fijar</button>
    </section>`;
});

afterEach(() => {
  for (const [type, listener, options] of vi.mocked(window.addEventListener).mock.calls) {
    window.removeEventListener(type, listener, options);
  }
  for (const [type, listener, options] of vi.mocked(document.addEventListener).mock.calls) {
    document.removeEventListener(type, listener, options);
  }
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function setupController() {
  const setPanelCollapsed = vi.fn();
  const controller = createAutoHideController({
    getPanelLayoutManager: () => ({ setPanelCollapsed }) as unknown as PanelLayoutManager,
    isTypingInFormField: () => false,
    storage: { getItem: () => null, setItem: vi.fn() } as unknown as Storage,
  });
  controller.init();
  return { controller, setPanelCollapsed };
}

describe("auto-ocultado durante navegación de instrumentos", () => {
  it("aplaza el cierre del centro al abrir un instrumento flotante sin fijar", () => {
    const { setPanelCollapsed } = setupController();
    window.dispatchEvent(new CustomEvent("open-floating-instrument", { detail: { tabId: "fft" } }));
    vi.advanceTimersByTime(399);
    expect(setPanelCollapsed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(setPanelCollapsed).toHaveBeenCalledWith("dock", true);
  });

  it("fijar el centro cancela el cierre pendiente y permite navegar sin auto-ocultado", () => {
    const { controller, setPanelCollapsed } = setupController();
    window.dispatchEvent(new CustomEvent("open-floating-instrument", { detail: { tabId: "fft" } }));
    vi.advanceTimersByTime(200);
    document.querySelector<HTMLButtonElement>("#instrument-center-pin")!.click();
    expect(controller.getSettings().dock).toBe(false);
    window.dispatchEvent(new CustomEvent("open-floating-instrument", { detail: { tabId: "tracer" } }));
    vi.advanceTimersByTime(1000);
    expect(setPanelCollapsed).not.toHaveBeenCalled();
  });
});
