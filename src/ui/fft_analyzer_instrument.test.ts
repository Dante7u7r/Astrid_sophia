// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { FftAnalyzerInstrument } from "./fft_analyzer_instrument";
import type { InstrumentCallbacks } from "./instrument_callbacks";

describe("FftAnalyzerInstrument UI Component", () => {
  let container: HTMLElement;
  let callbacks: InstrumentCallbacks;
  let instrument: FftAnalyzerInstrument | null = null;

  beforeEach(() => {
    class MockResizeObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);

    container = document.createElement("div");
    document.body.appendChild(container);

    callbacks = {
      onCanvasModified: vi.fn(),
      onNetlistSync: vi.fn(),
      requestRender: vi.fn(),
      getPinNode: vi.fn(),
      log: vi.fn(),
    };
  });

  afterEach(() => {
    if (instrument) {
      instrument.destroy();
      instrument = null;
    }
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renderiza correctamente la estructura rack, los botones de canal y el canvas", () => {
    instrument = new FftAnalyzerInstrument(container, callbacks);
    const canvas = container.querySelector("#fft-canvas");
    expect(canvas).not.toBeNull();

    const btnCh1 = container.querySelector("#fft-btn-ch1");
    const btnCh2 = container.querySelector("#fft-btn-ch2");
    const btnDiff = container.querySelector("#fft-btn-diff");
    expect(btnCh1).not.toBeNull();
    expect(btnCh2).not.toBeNull();
    expect(btnDiff).not.toBeNull();
  });

  it("actualiza el espectro y las métricas al recibir datos en el tiempo", () => {
    instrument = new FftAnalyzerInstrument(container, callbacks);

    const ch1Data: { time: number; val: number }[] = [];
    for (let i = 0; i < 256; i++) {
      const t = i / 10000;
      ch1Data.push({ time: t, val: 5.0 * Math.sin(2 * Math.PI * 1000 * t) });
    }

    instrument.setTimeData(ch1Data, []);

    const f0El = container.querySelector("#fft-val-f0");
    expect(f0El?.textContent).toMatch(/Hz|kHz/);
  });

  it("alterna los canales activos y el modo diferencial al pulsar sus botones", () => {
    instrument = new FftAnalyzerInstrument(container, callbacks);

    const btnCh1 = container.querySelector("#fft-btn-ch1") as HTMLElement;
    const btnCh2 = container.querySelector("#fft-btn-ch2") as HTMLElement;
    const btnDiff = container.querySelector("#fft-btn-diff") as HTMLElement;

    expect(btnCh1.classList.contains("active")).toBe(true);

    btnCh2.click();
    expect(btnCh2.classList.contains("active")).toBe(true);
    expect(btnCh1.classList.contains("active")).toBe(false);

    btnDiff.click();
    expect(btnDiff.classList.contains("active")).toBe(true);
  });

  it("alterna los cursores de frecuencia al pulsar el botón de cursores", () => {
    instrument = new FftAnalyzerInstrument(container, callbacks);

    const cursorsBtn = container.querySelector("#fft-btn-cursors") as HTMLButtonElement;
    expect(cursorsBtn.textContent).toContain("Cursores: OFF");

    cursorsBtn.click();
    expect(cursorsBtn.textContent).toContain("Cursores: ON");
  });
});
