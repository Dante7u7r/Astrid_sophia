import { test, expect } from "./fixtures/canvas-page";

test.describe("Circuit Simulation E2E Suite", () => {
  test("armar RC simple -> run TRAN -> verificar trace en osciloscopio", async ({
    page,
    placeComponent,
    wire,
  }) => {
    // 1. Armar circuito RC en el lienzo
    await placeComponent("vsource", -100, 0);
    await placeComponent("resistor", 0, 0);
    await placeComponent("capacitor", 100, 0);
    await placeComponent("ground", 200, 0);

    // 2. Conectar terminales
    await wire("V1", 0, "R1", 0);
    await wire("R1", 1, "C1", 0);
    await wire("C1", 1, "GND1", 0);
    await wire("V1", 1, "GND1", 0);

    const compCount = await page.evaluate(() => (window as any).orchestrator?.components?.length ?? 0);
    const wireCount = await page.evaluate(() => (window as any).orchestrator?.wires?.length ?? 0);
    expect(compCount).toBeGreaterThanOrEqual(4);
    expect(wireCount).toBeGreaterThanOrEqual(3);

    // 3. Ejecutar simulación transitoria (TRAN)
    const runBtn = page.locator("#run-sim-btn");
    const stopBtn = page.locator("#stop-sim-btn");

    if (await runBtn.isVisible()) {
      await runBtn.click();
      await page.waitForTimeout(600);
    }

    // 4. Verificar que el panel de osciloscopio recibe resultados
    const simResults = await page.evaluate(() => {
      const osc = (window as any).oscilloscopePanel;
      const results = osc?.transientResults ?? [];
      return {
        count: results.length,
        hasVoltages: results.some((r: any) => Object.keys(r.nodeVoltages || {}).length > 0),
        firstSample: results[0] ?? null,
        lastSample: results[results.length - 1] ?? null,
      };
    });

    expect(simResults.count).toBeGreaterThan(0);
    expect(simResults.hasVoltages).toBe(true);

    // 5. Detener simulación
    if (await stopBtn.isVisible() && await stopBtn.isEnabled()) {
      await stopBtn.click();
      await page.waitForTimeout(100);
    }

    const isRunning = await page.evaluate(() => {
      const w = window as any;
      return w.isSimulationRunning?.() ?? false;
    });
    expect(isRunning).toBe(false);
  });
});
