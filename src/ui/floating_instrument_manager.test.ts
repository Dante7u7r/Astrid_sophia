// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { FloatingInstrumentManager } from "./floating_instrument_manager";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function setupDom(): void {
  document.body.innerHTML = `
    <div id="canvas-viewport"></div>
    <section id="bottom-dock">
      <div class="instruments-tabs-bar">
        <button class="inst-tab active" data-tab="oscilloscope"></button>
        <button class="inst-tab" data-tab="generator"></button>
        <button id="btn-popout-instrument">Flotar</button>
      </div>
      <div class="instruments-content-area">
        <div id="inst-oscilloscope" class="inst-content-box">Osc Content</div>
        <div id="inst-generator" class="inst-content-box">Gen Content</div>
      </div>
    </section>
  `;
}

describe("FloatingInstrumentManager", () => {
  it("desacopla (popOut) y reacopla (popIn) correctamente un instrumento", () => {
    setupDom();
    const manager = new FloatingInstrumentManager();

    expect(manager.isPoppedOut("oscilloscope")).toBe(false);

    const winEl = manager.popOut("oscilloscope");
    expect(winEl).not.toBeNull();
    expect(manager.isPoppedOut("oscilloscope")).toBe(true);
    expect(document.querySelector("#floating-win-oscilloscope")).not.toBeNull();

    // Reacoplar
    manager.popIn("oscilloscope");
    expect(manager.isPoppedOut("oscilloscope")).toBe(false);
    expect(document.querySelector("#floating-win-oscilloscope")).toBeNull();
    expect(document.querySelector("#inst-oscilloscope")).not.toBeNull();
  });

  it("permite fijar (📌) y desfijar (🔓) una ventana al lienzo de circuito", () => {
    setupDom();
    const manager = new FloatingInstrumentManager();
    const winEl = manager.popOut("oscilloscope")!;

    expect(winEl.classList.contains("pinned-to-canvas")).toBe(false);

    manager.togglePin("oscilloscope");
    expect(winEl.classList.contains("pinned-to-canvas")).toBe(true);

    manager.togglePin("oscilloscope");
    expect(winEl.classList.contains("pinned-to-canvas")).toBe(false);
  });

  it("configura atributos ARIA y responde a la tecla Escape para cerrar", () => {
    setupDom();
    const manager = new FloatingInstrumentManager();
    const winEl = manager.popOut("oscilloscope")!;

    expect(winEl.getAttribute("role")).toBe("dialog");
    expect(winEl.getAttribute("aria-label")).toBe("Osciloscopio Digital");
    expect(winEl.getAttribute("aria-modal")).toBe("false");

    const closeBtn = winEl.querySelector('button[aria-label="Cerrar ventana flotante"]');
    expect(closeBtn).not.toBeNull();

    // Presionar Escape en la ventana flotante
    winEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(manager.isPoppedOut("oscilloscope")).toBe(false);
    expect(document.querySelector("#floating-win-oscilloscope")).toBeNull();
  });
});
