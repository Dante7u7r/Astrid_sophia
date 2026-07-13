// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasOrchestrator } from "../canvas_orchestrator";
import { InstrumentsDock } from "./instruments_dock";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function createDockElement(): HTMLElement {
  document.body.innerHTML = `
    <section id="dock">
      <div class="instruments-tabs-bar">
        <button class="inst-tab active" data-tab="oscilloscope"></button>
        <button class="inst-tab" data-tab="generator"></button>
        <button class="inst-tab" data-tab="logic"></button>
        <button class="inst-tab" data-tab="fft"></button>
        <button class="inst-tab" data-tab="tracer"></button>
      </div>
      <div id="inst-oscilloscope" class="inst-content-box"></div>
      <div id="inst-generator" class="inst-content-box"></div>
      <div id="inst-logic" class="inst-content-box"></div>
      <div id="inst-fft" class="inst-content-box"></div>
      <div id="inst-tracer" class="inst-content-box"></div>
    </section>
  `;
  return document.querySelector<HTMLElement>("#dock")!;
}

describe("InstrumentsDock", () => {
  it("inicializa instrumentos con callbacks parciales tipados", () => {
    const container = createDockElement();
    const orchestrator = {
      components: [],
      selectedComponent: null,
      getComponentPins: vi.fn(() => []),
    } as unknown as CanvasOrchestrator;

    const dock = new InstrumentsDock(container, orchestrator, {
      requestRender: vi.fn(),
    });

    expect(dock.generator).not.toBeNull();
    expect(dock.logicAnalyzer).not.toBeNull();
    expect(dock.fftAnalyzer).not.toBeNull();
    expect(dock.curveTracer).not.toBeNull();
    dock.switchTab("logic");
    expect(dock.getActiveTab()).toBe("logic");
  });
});
