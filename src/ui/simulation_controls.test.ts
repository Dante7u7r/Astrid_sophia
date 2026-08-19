// @vitest-environment happy-dom

import { beforeEach, describe, expect, test, vi } from "vitest";
import { initSimulationControls, ANALYSIS_MODES_METADATA } from "./simulation_controls";

describe("SimulationControls", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <select id="analysis-mode-select">
        <option value="DC">DC</option>
        <option value="AC">AC</option>
        <option value="TRAN">TRAN</option>
        <option value="SENS">SENS</option>
      </select>
      <button id="run-sim-btn"><span class="btn-icon"></span><span class="header-action-label">Simular</span></button>
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

  test("actualiza etiquetas de boton segun el modo seleccionado y detiene simulacion activa al cambiar de modo", async () => {
    const onStopSimulation = vi.fn(async () => undefined);
    const setActiveAnalysisMode = vi.fn();
    const addLog = vi.fn();

    const controls = initSimulationControls({
      onRunSimulation: vi.fn(async () => undefined),
      onStopSimulation,
      setActiveAnalysisMode,
      addLog,
      updateCanvasRendering: vi.fn(),
    });

    const runBtnLabel = document.querySelector("#run-sim-btn .header-action-label")!;
    expect(runBtnLabel.textContent).toBe(ANALYSIS_MODES_METADATA.DC.buttonLabel);

    controls.setSimulationRunning(true);
    expect(controls.isSimulationRunning()).toBe(true);

    // Cambiar de modo en el select mientras corre
    const select = document.querySelector("#analysis-mode-select") as HTMLSelectElement;
    select.value = "TRAN";
    select.dispatchEvent(new Event("change"));
    await Promise.resolve();
    await Promise.resolve();

    // Debe detener la simulación previa inmediatamente
    expect(onStopSimulation).toHaveBeenCalledTimes(1);
    expect(setActiveAnalysisMode).toHaveBeenCalledWith("TRAN");
    expect(controls.isSimulationRunning()).toBe(false);
    expect(runBtnLabel.textContent).toBe(ANALYSIS_MODES_METADATA.TRAN.buttonLabel);
  });
});
