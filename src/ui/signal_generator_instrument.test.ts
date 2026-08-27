// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { SignalGeneratorInstrument } from "./signal_generator_instrument";
import { CanvasOrchestrator } from "../canvas_orchestrator";
import type { InstrumentCallbacks } from "./instrument_callbacks";

describe("SignalGeneratorInstrument UI Component", () => {
  let container: HTMLElement;
  let orchestrator: CanvasOrchestrator;
  let callbacks: InstrumentCallbacks;
  let instrument: SignalGeneratorInstrument | null = null;

  beforeEach(() => {
    // Mock requestAnimationFrame / cancelAnimationFrame for headless DOM
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      return setTimeout(() => cb(performance.now()), 16) as unknown as number;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));

    // Mock ResizeObserver
    class MockResizeObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);

    container = document.createElement("div");
    document.body.appendChild(container);

    const components: any[] = [];
    orchestrator = {
      components,
      selectedComponent: null,
      addComponent: vi.fn((type: string, x: number, y: number) => {
        const comp = { id: `vsource_${components.length + 1}`, type, x, y, waveType: "sine", frequency: 1000, amplitude: 5, offset: 0 };
        components.push(comp);
        return comp;
      }),
    } as unknown as CanvasOrchestrator;

    callbacks = {
      onCanvasModified: vi.fn(),
      onNetlistSync: vi.fn(),
      requestRender: vi.fn(),
      openOscilloscope: vi.fn(),
      openLogicAnalyzer: vi.fn(),
      isSimulating: vi.fn(() => false),
      syncComponentState: vi.fn(),
      triggerHotPatch: vi.fn(),
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

  it("inicializa el instrumento y renderiza la estructura de controles y canvas", () => {
    instrument = new SignalGeneratorInstrument(container, orchestrator, callbacks);
    const canvas = container.querySelector("#gen-preview-canvas");
    expect(canvas).not.toBeNull();

    const outputBtn = container.querySelector("#gen-output-toggle");
    expect(outputBtn?.textContent).toContain("SALIDA: ACTIVA");

    const waveBtns = container.querySelectorAll(".gen-wave-btn");
    expect(waveBtns.length).toBeGreaterThanOrEqual(7);
  });

  it("cambia de forma de onda al pulsar los botones de onda y actualiza la fuente", () => {
    const source = orchestrator.addComponent("vsource", 100, 100);
    instrument = new SignalGeneratorInstrument(container, orchestrator, callbacks);

    const squareBtn = container.querySelector('[data-wave="square"]') as HTMLButtonElement;
    expect(squareBtn).not.toBeNull();

    squareBtn.click();

    expect(squareBtn.classList.contains("active")).toBe(true);
    expect(source.waveType).toBe("square");
    expect(callbacks.onCanvasModified).toHaveBeenCalled();
  });

  it("aplica un preset de laboratorio con un clic y sincroniza todos los parámetros", () => {
    const source = orchestrator.addComponent("vsource", 100, 100);
    instrument = new SignalGeneratorInstrument(container, orchestrator, callbacks);

    const clockBtn = container.querySelector('[data-preset-id="cmos_clock_10mhz"]') as HTMLButtonElement;
    expect(clockBtn).not.toBeNull();

    clockBtn.click();

    expect(source.waveType).toBe("square");
    expect(source.frequency).toBe(10_000_000);
    expect(source.amplitude).toBe(1.65);
    expect(source.offset).toBe(1.65);
    expect(callbacks.onNetlistSync).toHaveBeenCalled();
  });

  it("alterna el estado de salida ON/OFF", () => {
    instrument = new SignalGeneratorInstrument(container, orchestrator, callbacks);
    const outputBtn = container.querySelector("#gen-output-toggle") as HTMLButtonElement;

    expect(outputBtn.classList.contains("active")).toBe(true);

    outputBtn.click();
    expect(outputBtn.classList.contains("active")).toBe(false);
    expect(outputBtn.textContent).toContain("SALIDA: EN ESPERA");

    outputBtn.click();
    expect(outputBtn.classList.contains("active")).toBe(true);
    expect(outputBtn.textContent).toContain("SALIDA: ACTIVA");
  });

  it("alterna entre impedancia de 50 ohms y High-Z con el botón de salida", () => {
    instrument = new SignalGeneratorInstrument(container, orchestrator, callbacks);
    const zBtn = container.querySelector("#gen-z-toggle") as HTMLButtonElement;
    expect(zBtn).not.toBeNull();

    zBtn.click();
    expect(zBtn.textContent).toContain("High-Z");

    zBtn.click();
    expect(zBtn.textContent).toContain("50 Ω");
  });

  it("notifica onSourceMutated cuando se cambia la forma de onda o parámetros", () => {
    const onSourceMutated = vi.fn();
    callbacks.onSourceMutated = onSourceMutated;
    const source = orchestrator.addComponent("vsource", 100, 100);
    instrument = new SignalGeneratorInstrument(container, orchestrator, callbacks);

    const triangleBtn = container.querySelector('[data-wave="triangle"]') as HTMLButtonElement;
    expect(triangleBtn).not.toBeNull();
    triangleBtn.click();

    expect(onSourceMutated).toHaveBeenCalledWith(source);
    expect(source.waveType).toBe("triangle");
  });

  it("actualiza controles y parámetros al recibir syncFromExternalSource", () => {
    const source = orchestrator.addComponent("vsource", 100, 100);
    instrument = new SignalGeneratorInstrument(container, orchestrator, callbacks);

    source.frequency = 440;
    source.amplitude = 2.5;
    source.waveType = "sine";

    instrument.syncFromExternalSource(source);

    const ampInput = container.querySelector("#gen-num-amp") as HTMLInputElement;
    expect(ampInput.value).toBe("2.50");

    const freqBadge = container.querySelector("#gen-val-freq");
    expect(freqBadge?.textContent).toBe("440 Hz");
  });
});
