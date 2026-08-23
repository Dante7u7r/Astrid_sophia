// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { LogicAnalyzerInstrument } from "./logic_analyzer_instrument";
import { CanvasOrchestrator } from "../canvas_orchestrator";
import type { InstrumentCallbacks } from "./instrument_callbacks";

describe("LogicAnalyzerInstrument UI Component", () => {
  let container: HTMLElement;
  let orchestrator: CanvasOrchestrator;
  let callbacks: InstrumentCallbacks;
  let instrument: LogicAnalyzerInstrument | null = null;

  beforeEach(() => {
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
      getComponentPins: vi.fn(() => []),
    } as unknown as CanvasOrchestrator;

    callbacks = {
      onCanvasModified: vi.fn(),
      onNetlistSync: vi.fn(),
      requestRender: vi.fn(),
      getPinNode: vi.fn((key: string) => (key.startsWith("comp1") ? "1" : "0")),
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

  it("renderiza correctamente la estructura rack, los 8 selectores de canal y el canvas", () => {
    instrument = new LogicAnalyzerInstrument(container, orchestrator, callbacks);
    const canvas = container.querySelector("#logic-canvas");
    expect(canvas).not.toBeNull();

    const channelSelects = container.querySelectorAll(".logic-channel-select");
    expect(channelSelects.length).toBe(8);

    const decoderSelect = container.querySelector("#logic-decoder-select") as HTMLSelectElement;
    expect(decoderSelect).not.toBeNull();
    expect(decoderSelect.value).toBe("parallel");
  });

  it("permite registrar muestras de nodos y calcular rango temporal", () => {
    instrument = new LogicAnalyzerInstrument(container, orchestrator, callbacks);

    instrument.recordTimeStep(0.0, { "1": 0.0, "2": 5.0 });
    instrument.recordTimeStep(10e-6, { "1": 5.0, "2": 0.0 });

    const statusEl = container.querySelector("#logic-status-samples");
    expect(statusEl?.textContent).toContain("Muestras:");
  });

  it("alterna el estado del decodificador de protocolo y los Cursores", () => {
    instrument = new LogicAnalyzerInstrument(container, orchestrator, callbacks);

    const decoderSelect = container.querySelector("#logic-decoder-select") as HTMLSelectElement;
    expect(decoderSelect.value).toBe("parallel");

    decoderSelect.value = "i2c";
    decoderSelect.dispatchEvent(new Event("change"));
    expect(decoderSelect.value).toBe("i2c");

    const cursorsBtn = container.querySelector("#logic-btn-cursors") as HTMLButtonElement;
    expect(cursorsBtn.textContent).toContain("Cursores: OFF");

    cursorsBtn.click();
    expect(cursorsBtn.textContent).toContain("Cursores: ON");
  });

  it("limpia el historial de captura al pulsar el botón Limpiar", () => {
    instrument = new LogicAnalyzerInstrument(container, orchestrator, callbacks);
    instrument.recordTimeStep(1e-6, { "1": 3.3 });

    const clearBtn = container.querySelector("#logic-btn-clear") as HTMLButtonElement;
    clearBtn.click();

    const statusEl = container.querySelector("#logic-status-samples");
    expect(statusEl?.textContent).toBe("Muestras: 0");
  });
});
