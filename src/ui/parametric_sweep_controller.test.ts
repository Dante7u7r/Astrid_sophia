// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ParametricSweepController } from "./parametric_sweep_controller";
import type { ComponentInstance } from "../canvas_orchestrator";
import type { SimulationRunner } from "../simulation/simulation_runner";
import type { OscilloscopePanel } from "./oscilloscope_panel";

describe("ParametricSweepController", () => {
  let mockComponents: ComponentInstance[];
  let mockSelectedComponent: ComponentInstance | null;
  let mockSimulationRunner: Partial<SimulationRunner>;
  let mockOscilloscope: Partial<OscilloscopePanel>;
  let addLog: ReturnType<typeof vi.fn>;
  let updateCanvasRendering: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="parametric-sweep-panel">
        <select id="param-sweep-comp-select"></select>
        <select id="param-sweep-param-select"></select>
        <input id="param-sweep-slider" type="range" min="0" max="1000" value="500" />
        <span id="param-sweep-val-badge">1kΩ</span>
        <input id="param-sweep-min" type="number" value="100" />
        <input id="param-sweep-max" type="number" value="10000" />
        <input id="param-sweep-steps" type="number" value="5" />
        <input id="param-sweep-log" type="checkbox" checked />
        <button id="param-sweep-run-btn">Barrer Familia de Curvas</button>
        <button id="param-sweep-clear-btn">Limpiar Curvas</button>
      </div>
    `;

    mockComponents = [
      { id: "R1", type: "resistor", value: 1000, x: 0, y: 0, rotation: 0 },
      { id: "C1", type: "capacitor", value: 1e-6, x: 10, y: 10, rotation: 0 },
      { id: "M1", type: "nmos_bsim3", value: 0, x: 20, y: 20, rotation: 0, w: 10e-6, l: 180e-9 },
    ];
    mockSelectedComponent = mockComponents[0];

    mockSimulationRunner = {
      isSimulationActive: vi.fn().mockReturnValue(true),
      mutateComponent: vi.fn().mockResolvedValue(undefined),
    };

    mockOscilloscope = {
      transientResults: [
        { time: 0, nodeVoltages: { "1": 0 }, branchCurrents: {} },
        { time: 0.001, nodeVoltages: { "1": 3.3 }, branchCurrents: {} },
      ],
      pvtTraces: [],
      pvtMode: false,
      activeAnalysisMode: "TRAN",
      timeDivValue: 0.02,
      draw: vi.fn(),
    };

    addLog = vi.fn();
    updateCanvasRendering = vi.fn();
  });

  it("puebla componentes y selecciona parámetros automáticamente", () => {
    const controller = new ParametricSweepController({
      getComponents: () => mockComponents,
      getSelectedComponent: () => mockSelectedComponent,
      getSimulationRunner: () => mockSimulationRunner as SimulationRunner,
      getOscilloscopePanel: () => mockOscilloscope as OscilloscopePanel,
      updateCanvasRendering,
      addLog,
    });

    controller.init();

    const compSelect = document.querySelector<HTMLSelectElement>("#param-sweep-comp-select");
    expect(compSelect?.options.length).toBeGreaterThan(1);
    expect(compSelect?.value).toBe("R1");

    const valBadge = document.querySelector("#param-sweep-val-badge");
    expect(valBadge?.textContent).toContain("1kΩ");
  });

  it("emite mutación en caliente incremental (hot-patching) al mover el slider", () => {
    const controller = new ParametricSweepController({
      getComponents: () => mockComponents,
      getSelectedComponent: () => mockSelectedComponent,
      getSimulationRunner: () => mockSimulationRunner as SimulationRunner,
      getOscilloscopePanel: () => mockOscilloscope as OscilloscopePanel,
      updateCanvasRendering,
      addLog,
    });

    controller.init();

    const slider = document.querySelector<HTMLInputElement>("#param-sweep-slider");
    if (slider) {
      slider.value = "800";
      slider.dispatchEvent(new Event("input"));
    }

    expect(mockSimulationRunner.mutateComponent).toHaveBeenCalledWith(
      "R1",
      "value",
      expect.any(Number),
    );
    expect(updateCanvasRendering).toHaveBeenCalled();
  });

  it("ejecuta barrido de familia de curvas y las proyecta en el osciloscopio", async () => {
    const controller = new ParametricSweepController({
      getComponents: () => mockComponents,
      getSelectedComponent: () => mockSelectedComponent,
      getSimulationRunner: () => mockSimulationRunner as SimulationRunner,
      getOscilloscopePanel: () => mockOscilloscope as OscilloscopePanel,
      updateCanvasRendering,
      addLog,
      invokeTauri: vi.fn().mockResolvedValue({
        transient: [
          { time: 0, nodeVoltages: { "1": 0 }, branchCurrents: {} },
          { time: 0.001, nodeVoltages: { "1": 5.0 }, branchCurrents: {} },
        ],
      }),
    });

    controller.init();
    await controller.runFamilyOfCurvesSweep();

    expect(mockOscilloscope.pvtTraces?.length).toBe(5);
    expect(mockOscilloscope.pvtMode).toBe(true);
    expect(mockOscilloscope.activeAnalysisMode).toBe("PVT");
    expect(mockOscilloscope.draw).toHaveBeenCalled();
    expect(addLog).toHaveBeenCalledWith(
      expect.stringContaining("Familia de curvas paramétricas generada exitosamente"),
      "receive",
    );

    controller.clearFamilyOfCurves();
    expect(mockOscilloscope.pvtTraces).toEqual([]);
    expect(mockOscilloscope.pvtMode).toBe(false);
  });
});
