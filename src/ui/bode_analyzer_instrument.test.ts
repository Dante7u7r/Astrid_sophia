/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BodeAnalyzerInstrument } from "./bode_analyzer_instrument";
import type { CanvasOrchestrator } from "../canvas_orchestrator";

describe("BodeAnalyzerInstrument — Tests de Integración UI", () => {
  let container: HTMLElement;
  let mockOrchestrator: CanvasOrchestrator;
  let instrument: BodeAnalyzerInstrument;

  beforeEach(() => {
    class MockResizeObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);

    container = document.createElement("div");
    document.body.appendChild(container);

    mockOrchestrator = {
      components: [],
      wires: [],
      selectedComponent: null,
      selectedComponents: [],
      render: vi.fn(),
    } as unknown as CanvasOrchestrator;

    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      fillText: vi.fn(),
      strokeRect: vi.fn(),
      setLineDash: vi.fn(),
      setTransform: vi.fn(),
      scale: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    instrument = new BodeAnalyzerInstrument(container, mockOrchestrator);
  });

  afterEach(() => {
    if (instrument) {
      instrument.destroy();
    }
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renderiza correctamente los controles de barrido y la cuadrícula", () => {
    expect(container.querySelector("#bode-canvas")).not.toBeNull();
    expect(container.querySelector("#bode-btn-mode-bode")).not.toBeNull();
    expect(container.querySelector("#bode-btn-mode-sens")).not.toBeNull();
    expect(container.querySelector("#bode-btn-mode-pz")).not.toBeNull();
    expect(container.querySelector("#bode-input-fstart")).not.toBeNull();
    expect(container.querySelector("#bode-input-fend")).not.toBeNull();
  });

  it("conmuta fluidamente entre modos Bode, Sensibilidad y Polos/Ceros", () => {
    const btnSens = container.querySelector("#bode-btn-mode-sens") as HTMLButtonElement;
    btnSens.click();
    expect(btnSens.classList.contains("active")).toBe(true);

    const btnPz = container.querySelector("#bode-btn-mode-pz") as HTMLButtonElement;
    btnPz.click();
    expect(btnPz.classList.contains("active")).toBe(true);
  });

  it("actualiza las métricas al recibir resultados de barrido AC", () => {
    instrument.setAcSweepResult({
      frequencies: [10, 100, 1000, 10000, 100000],
      nodeAmplitudes: { "1": [1.0, 0.99, 0.707, 0.1, 0.01] },
      nodePhases: { "1": [0, -10, -45, -80, -90] },
    }, "1");

    const fcEl = container.querySelector("#bode-metric-fc");
    expect(fcEl?.textContent).not.toBe("—");
    expect(fcEl?.textContent).toContain("Hz");
  });

  it("recibe y procesa resultados de sensibilidad y estabilidad", () => {
    instrument.setSensitivityResult({
      sensitivities: [
        {
          componentId: "R1",
          parameterName: "resistance",
          sensitivities: { "1": 0.5 },
          normalizedSensitivities: { "1": 0.25 },
        },
      ],
      worstCaseLimits: {},
    });

    instrument.setStabilityResult({
      isStable: true,
      poles: [{ re: -100, im: 50 }],
      zeros: [{ re: -10, im: 0 }],
    });

    expect(container.querySelector("#bode-canvas")).not.toBeNull();
  });
});
