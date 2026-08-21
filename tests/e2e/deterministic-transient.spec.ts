import { test, expect } from './fixtures/canvas-page';

test.describe('Deterministic Transient Simulation (disablePacing)', () => {
  test('transient determinista con disablePacing produce resultados exactos y repetibles', async ({
    page,
    placeComponent,
    wire,
  }) => {
    // 1. Posicionar componentes del divisor RC
    await placeComponent('vsource', -100, 0);
    await placeComponent('resistor', 0, 0);
    await placeComponent('capacitor', 100, 0);
    await placeComponent('ground', 200, 0);

    // 2. Conectar terminales
    await wire('V1', 0, 'R1', 0);
    await wire('R1', 1, 'C1', 0);
    await wire('C1', 1, 'GND1', 0);
    await wire('V1', 1, 'GND1', 0);

    // 3. Activar disablePacing en la configuración de la sesión
    await page.evaluate(() => {
      const w = window as any;
      if (w.qaBridge?.setDisablePacing) {
        w.qaBridge.setDisablePacing(true);
      }
    });

    const runBtn = page.locator('#run-sim-btn');

    // 4. Ejecución 1
    await runBtn.click();
    await page.waitForTimeout(800);

    const trace1 = await page.evaluate(() => {
      const osc = (window as any).oscilloscopePanel;
      return (osc?.transientResults || []).map((s: any) => s.nodeVoltages?.['2'] ?? s.nodeVoltages?.['1'] ?? 0);
    });

    // 5. Ejecución 2
    await runBtn.click();
    await page.waitForTimeout(800);

    const trace2 = await page.evaluate(() => {
      const osc = (window as any).oscilloscopePanel;
      return (osc?.transientResults || []).map((s: any) => s.nodeVoltages?.['2'] ?? s.nodeVoltages?.['1'] ?? 0);
    });

    expect(trace1.length).toBeGreaterThan(0);
    expect(trace2.length).toBeGreaterThan(0);

    // Verificar que los valores calculados son exactamente idénticos punto a punto
    const sampleCount = Math.min(trace1.length, trace2.length);
    expect(sampleCount).toBeGreaterThan(10);
    for (let i = 0; i < sampleCount; i++) {
      expect(trace1[i]).toBeCloseTo(trace2[i], 10);
    }
  });
});
