// @vitest-environment happy-dom

import { beforeEach, describe, expect, test, vi } from "vitest";
import { initSimulationControls } from "./simulation_controls";

describe("SimulationControls", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <select id="analysis-mode-select"><option value="DC">DC</option></select>
      <button id="run-sim-btn"><span class="btn-icon"></span></button>
      <button id="stop-sim-btn"></button>
    `;
  });

  test("expone el estado de ejecucion usado para bloquear cambios de pestana", () => {
    const controls = initSimulationControls({
      onRunSimulation: vi.fn(async () => undefined),
      onStopSimulation: vi.fn(async () => undefined),
      setActiveAnalysisMode: vi.fn(),
      addLog: vi.fn(),
      updateCanvasRendering: vi.fn(),
    });

    expect(controls.isSimulationRunning()).toBe(false);
    controls.setSimulationRunning(true);
    expect(controls.isSimulationRunning()).toBe(true);
    controls.setSimulationRunning(false);
    expect(controls.isSimulationRunning()).toBe(false);
  });
});
