// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CurveTracerInstrument } from "./curve_tracer_instrument";
import type { CanvasOrchestrator } from "../canvas_orchestrator";
import type { InstrumentCallbacks } from "./instrument_callbacks";

describe("CurveTracerInstrument UI Component", () => {
  let container: HTMLElement;
  let orchestrator: Partial<CanvasOrchestrator>;
  let callbacks: InstrumentCallbacks;
  let instrument: CurveTracerInstrument | null = null;

  beforeEach(() => {
    class MockResizeObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);

    container = document.createElement("div");
    document.body.appendChild(container);

    orchestrator = {
      selectedComponent: null,
      components: [],
    };

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

  it("renderiza correctamente la estructura rack, el selector de presets y el canvas", () => {
    instrument = new CurveTracerInstrument(
      container,
      orchestrator as CanvasOrchestrator,
      callbacks,
    );

    const canvas = container.querySelector("#tracer-canvas");
    expect(canvas).not.toBeNull();

    const presetSelect = container.querySelector("#tracer-select-preset") as HTMLSelectElement;
    expect(presetSelect).not.toBeNull();
    expect(presetSelect.value).toBe("1N4148");
  });

  it("ejecuta el trazado I-V y extrae parámetros métricos al cambiar de dispositivo", () => {
    instrument = new CurveTracerInstrument(
      container,
      orchestrator as CanvasOrchestrator,
      callbacks,
    );

    const presetSelect = container.querySelector("#tracer-select-preset") as HTMLSelectElement;
    presetSelect.value = "2N2222A";
    presetSelect.dispatchEvent(new Event("change"));

    const val1 = container.querySelector("#tracer-metric-val-1");
    expect(val1?.textContent).toBe("200"); // hFE del 2N2222A
  });

  it("alterna el punto de operación Q al pulsar el botón correspondiente", () => {
    instrument = new CurveTracerInstrument(
      container,
      orchestrator as CanvasOrchestrator,
      callbacks,
    );

    const qBtn = container.querySelector("#tracer-btn-qpoint") as HTMLButtonElement;
    expect(qBtn.textContent).toContain("Punto Q: OFF");

    qBtn.click();
    expect(qBtn.textContent).toContain("Punto Q: ON");
  });

  it("sincroniza automáticamente la selección de componentes del lienzo", () => {
    instrument = new CurveTracerInstrument(
      container,
      orchestrator as CanvasOrchestrator,
      callbacks,
    );

    orchestrator.selectedComponent = {
      id: "q1",
      type: "npn",
      x: 100,
      y: 100,
      rotation: 0,
      props: {},
    } as any;

    // Disparar sincronización
    (instrument as any).syncSelectedSchematicComponent();

    const linkEl = container.querySelector("#tracer-schematic-link");
    expect(linkEl?.textContent).toBe("Q1 (NPN)");

    const presetSelect = container.querySelector("#tracer-select-preset") as HTMLSelectElement;
    expect(presetSelect.value).toBe("2N2222A");
  });
});
