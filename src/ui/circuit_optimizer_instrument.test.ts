// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CircuitOptimizerInstrument } from "./circuit_optimizer_instrument";
import type { CanvasOrchestrator } from "../canvas_orchestrator";
import type { InstrumentCallbacks } from "./instrument_callbacks";
import type { ComponentInstance, WireInstance } from "../canvas_orchestrator";
import type { OptimizationResult } from "../simulation/circuit_optimizer_model";

describe("CircuitOptimizerInstrument UI Component", () => {
  let container: HTMLElement;
  let orchestrator: Partial<CanvasOrchestrator>;
  let callbacks: InstrumentCallbacks;
  let instrument: CircuitOptimizerInstrument | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);

    const mockComponents: ComponentInstance[] = [
      {
        id: "R1",
        type: "resistor",
        x: 100,
        y: 100,
        rotation: 0,
        value: 1000,
        pins: [
          { id: "p1", x: 80, y: 100, isConnected: true },
          { id: "p2", x: 120, y: 100, isConnected: true },
        ],
      } as unknown as ComponentInstance,
      {
        id: "C1",
        type: "capacitor",
        x: 140,
        y: 100,
        rotation: 0,
        value: 100e-9,
        pins: [
          { id: "p1", x: 130, y: 100, isConnected: true },
          { id: "p2", x: 150, y: 100, isConnected: true },
        ],
      } as unknown as ComponentInstance,
    ];

    const mockWires: WireInstance[] = [];

    orchestrator = {
      components: mockComponents,
      wires: mockWires,
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
    container.remove();
    vi.restoreAllMocks();
  });

  it("renderiza correctamente la estructura del optimizador", () => {
    instrument = new CircuitOptimizerInstrument(
      container,
      orchestrator as CanvasOrchestrator,
      callbacks,
    );

    const runBtn = container.querySelector("#opt-btn-run");
    const scanBtn = container.querySelector("#opt-btn-scan-circuit");
    const addTargetBtn = container.querySelector("#opt-btn-add-target");
    const applyBtn = container.querySelector("#opt-btn-apply");

    expect(runBtn).not.toBeNull();
    expect(scanBtn).not.toBeNull();
    expect(addTargetBtn).not.toBeNull();
    expect(applyBtn).not.toBeNull();
  });

  it("escanea y carga automáticamente los parámetros pasivos del circuito", () => {
    instrument = new CircuitOptimizerInstrument(
      container,
      orchestrator as CanvasOrchestrator,
      callbacks,
    );

    expect(instrument.params.length).toBe(2);
    expect(instrument.params[0].componentId).toBe("R1");
    expect(instrument.params[1].componentId).toBe("C1");

    const paramsList = container.querySelector("#opt-params-list");
    expect(paramsList?.textContent).toContain("R1.value");
    expect(paramsList?.textContent).toContain("C1.value");
  });

  it("permite agregar y remover objetivos de optimización", () => {
    instrument = new CircuitOptimizerInstrument(
      container,
      orchestrator as CanvasOrchestrator,
      callbacks,
    );

    expect(instrument.targets.length).toBe(1);

    instrument.addDefaultTarget();
    expect(instrument.targets.length).toBe(2);

    const removeBtn = container.querySelector("[data-remove-target='0']") as HTMLButtonElement;
    expect(removeBtn).not.toBeNull();
    removeBtn.click();

    expect(instrument.targets.length).toBe(1);
  });

  it("aplica los valores óptimos al esquema y notifica al orquestador", () => {
    instrument = new CircuitOptimizerInstrument(
      container,
      orchestrator as CanvasOrchestrator,
      callbacks,
    );

    const mockResult: OptimizationResult = {
      converged: true,
      iterations: 4,
      initialCost: 0.12,
      finalCost: 1.5e-7,
      optimalParameters: {
        "R1.value": 500,
        "C1.value": 15.9e-9,
      },
      history: [],
      achievedTargets: {},
    };

    instrument.lastResult = mockResult;
    instrument.applyOptimalParametersToCircuit();

    expect(callbacks.onCanvasModified).toHaveBeenCalled();
    expect(callbacks.requestRender).toHaveBeenCalledWith(true);
    expect(orchestrator.components![0].value).toBe(500);
    expect(orchestrator.components![1].value).toBe(15.9e-9);
    expect(callbacks.log).toHaveBeenCalledWith(
      expect.stringContaining("2 componentes actualizados"),
      "receive",
    );
  });

  it("actualiza la vista de métricas y la tabla de resultados tras la convergencia", () => {
    instrument = new CircuitOptimizerInstrument(
      container,
      orchestrator as CanvasOrchestrator,
      callbacks,
    );

    const mockResult: OptimizationResult = {
      converged: true,
      iterations: 5,
      initialCost: 0.5,
      finalCost: 1e-6,
      optimalParameters: {
        "R1.value": 470,
      },
      history: [],
      achievedTargets: {},
    };

    instrument.updateResultsView(mockResult);

    const finalCostEl = container.querySelector("#opt-val-final-cost");
    const iterEl = container.querySelector("#opt-val-iterations");
    const tableBody = container.querySelector("#opt-results-table-body");

    expect(finalCostEl?.textContent).toContain("1.000e-6");
    expect(iterEl?.textContent).toBe("5");
    expect(tableBody?.textContent).toContain("R1");
    expect(tableBody?.textContent).toContain("470");
  });
});
