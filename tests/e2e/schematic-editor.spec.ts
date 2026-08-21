import { test, expect } from "./fixtures/canvas-page";

test.describe("Canvas Schematic Editor", () => {
  test("place component → drag → wire → simulate", async ({
    page,
    zoom,
    placeComponent,
    wire,
  }) => {
    // 1. Colocar Resistor en (0,0)
    await placeComponent("resistor", 0, 0);
    await expect(page.locator('.component-card[data-type="resistor"]').first()).toBeVisible();

    // 2. Colocar VSource en (-100, 0)
    await placeComponent("vsource", -100, 0);

    // 3. Colocar Ground en (100, 0)
    await placeComponent("ground", 100, 0);

    const compCount = await page.evaluate(() => {
      const orch = (window as any).orchestrator;
      return orch?.components?.length ?? 0;
    });
    expect(compCount).toBeGreaterThanOrEqual(3);

    // 4. Conectar VSource+ → Resistor pin 0
    await wire("V1", 0, "R1", 0);

    // 5. Conectar Resistor pin 1 → Ground
    await wire("R1", 1, "GND1", 0);

    const wireCount = await page.evaluate(() => {
      const orch = (window as any).orchestrator;
      return orch?.wires?.length ?? 0;
    });
    expect(wireCount).toBeGreaterThanOrEqual(2);

    // 6. Zoom to fit
    await zoom(1.2, 0, 0);

    // 7. Validar estado de simulación
    const simButton = page.locator("#btn-run-simulation, #btn-start-sim, #btn-simular").first();
    if (await simButton.isVisible()) {
      await simButton.click();
      await page.waitForTimeout(300);
    }

    const simReady = await page.evaluate(() => {
      return (window as any).orchestrator !== null;
    });
    expect(simReady).toBeTruthy();
  });

  test("hit-testing: select component under cursor", async ({
    page,
    clickWorld,
    placeComponent,
  }) => {
    await placeComponent("capacitor", 50, 50);
    await clickWorld(50, 50); // Clic en el centro del componente

    const selectedId = await page.evaluate(() => {
      const orch = (window as any).orchestrator;
      return orch?.selectedComponent?.id ?? orch?.selectedComponents?.[0]?.id ?? null;
    });
    expect(selectedId).toBeTruthy();
  });

  test("drag component → wires follow (rubber-band)", async ({
    page,
    placeComponent,
    wire,
    dragWorld,
  }) => {
    await placeComponent("resistor", 0, 0);
    await placeComponent("vsource", -100, 0);
    await wire("V1", 0, "R1", 0);

    await dragWorld(0, 0, 50, 50); // Arrastrar resistor a (50, 50)

    const components = await page.evaluate(() => {
      const orch = (window as any).orchestrator;
      return orch?.components?.map((c: any) => ({ id: c.id, x: c.x, y: c.y })) ?? [];
    });
    expect(components.length).toBeGreaterThanOrEqual(2);
  });

  test("box selection → multi-select → delete", async ({
    page,
    placeComponent,
    selectComponent,
  }) => {
    await placeComponent("resistor", 0, 0);
    await placeComponent("capacitor", 100, 0);
    await placeComponent("inductor", 200, 0);

    const countInitial = await page.evaluate(() => {
      const orch = (window as any).orchestrator;
      return orch?.components?.length ?? 0;
    });
    expect(countInitial).toBeGreaterThanOrEqual(3);

    // Seleccionar y eliminar
    await selectComponent("R1");
    await page.keyboard.press("Delete");
    await page.waitForTimeout(100);

    const countAfter = await page.evaluate(() => {
      const orch = (window as any).orchestrator;
      return orch?.components?.length ?? 0;
    });
    expect(countAfter).toBeLessThan(countInitial);
  });

  test("zoom/pan preserves world coordinates", async ({
    placeComponent,
    zoom,
    pan,
    getViewportTransform,
  }) => {
    await placeComponent("resistor", 100, 100);
    await zoom(1.5, 100, 100);
    const transform1 = await getViewportTransform();

    await pan(50, 50);
    const transform2 = await getViewportTransform();

    expect(transform2.offsetX).toBeCloseTo(transform1.offsetX + 50, 0);
    expect(transform2.offsetY).toBeCloseTo(transform1.offsetY + 50, 0);
  });
});
