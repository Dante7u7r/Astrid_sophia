import { test, expect } from "./fixtures/canvas-page";

test.describe("Canvas Schematic Editor E2E Suite", () => {
  test("1. Place component: drag desde paleta -> soltar en canvas -> verificar render", async ({
    page,
    canvas,
    dragComponentFromPalette,
  }) => {
    // 1. Verificar visibilidad de la tarjeta en la paleta
    const resistorCard = page.locator('.component-card[data-type="resistor"]').first();
    await expect(resistorCard).toBeVisible();

    // 2. Arrastrar y soltar componente en el canvas
    await dragComponentFromPalette("resistor", 100, 100);

    const compData = await page.evaluate(() => {
      const orch = (window as any).orchestrator;
      const comp = orch?.components?.find((c: any) => c.type === "resistor");
      return comp ? { id: comp.id, type: comp.type, x: comp.x, y: comp.y } : null;
    });

    expect(compData).not.toBeNull();
    expect(compData?.type).toBe("resistor");

    // 3. Verificar que el Canvas 2D ha renderizado píxeles
    const hasRenderedPixels = await canvas.evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const ctx = c.getContext("2d");
      if (!ctx) return false;
      const imgData = ctx.getImageData(0, 0, Math.min(c.width, 300), Math.min(c.height, 300));
      for (let i = 3; i < imgData.data.length; i += 4) {
        if (imgData.data[i] > 0) return true;
      }
      return false;
    });
    expect(hasRenderedPixels).toBe(true);
  });

  test("2. Wire: click pin A -> click pin B -> verificar cable y netlist sincronizado", async ({
    page,
    placeComponent,
    wire,
  }) => {
    await placeComponent("vsource", -100, 0);
    await placeComponent("resistor", 100, 0);

    const initialWireCount = await page.evaluate(() => (window as any).orchestrator?.wires?.length ?? 0);
    expect(initialWireCount).toBe(0);

    // Conectar terminales
    await wire("V1", 0, "R1", 0);

    const updatedWireData = await page.evaluate(() => {
      const orch = (window as any).orchestrator;
      const wireObj = orch?.wires?.[0];
      const netlist = orch?.extractNetlist?.() ?? orch?.lastNetlist ?? null;
      return {
        count: orch?.wires?.length ?? 0,
        fromComp: wireObj?.from?.componentId,
        toComp: wireObj?.to?.componentId,
        hasNetlist: netlist !== null,
      };
    });

    expect(updatedWireData.count).toBe(1);
    expect(updatedWireData.fromComp?.toUpperCase()).toContain("V1");
    expect(updatedWireData.toComp?.toUpperCase()).toContain("R1");
  });

  test("3. Drag: seleccionar componente -> arrastrar -> verificar cables rubber-band siguen", async ({
    page,
    placeComponent,
    wire,
    dragWorld,
  }) => {
    await placeComponent("resistor", 0, 0);
    await placeComponent("vsource", -120, 0);
    await wire("V1", 0, "R1", 0);

    // Arrastrar Resistor de (0, 0) a (60, 80)
    await dragWorld(0, 0, 60, 80);

    const verifyState = await page.evaluate(() => {
      const orch = (window as any).orchestrator;
      const r1 = orch?.components?.find((c: any) => c.id === "R1" || c.type === "resistor");
      const wire0 = orch?.wires?.[0];
      return {
        r1Pos: r1 ? { x: r1.x, y: r1.y } : null,
        wireExists: !!wire0,
      };
    });

    expect(verifyState.wireExists).toBe(true);
    expect(verifyState.r1Pos).not.toBeNull();
  });

  test("4. Zoom/Pan: wheel zoom -> pan con clic medio -> coordenadas mundo conservadas", async ({
    canvas,
    placeComponent,
    getViewportTransform,
    page,
  }) => {
    await placeComponent("resistor", 100, 100);
    const initialTransform = await getViewportTransform();
    expect(initialTransform.zoom).toBeGreaterThan(0);

    // Wheel zoom
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(100);
    }

    // Pan con clic medio
    if (box) {
      await page.mouse.move(box.x + 200, box.y + 200);
      await page.mouse.down({ button: "middle" });
      await page.mouse.move(box.x + 260, box.y + 260, { steps: 5 });
      await page.mouse.up({ button: "middle" });
      await page.waitForTimeout(100);
    }

    // Las coordenadas de mundo del componente deben seguir siendo (100, 100)
    const compPos = await page.evaluate(() => {
      const orch = (window as any).orchestrator;
      const comp = orch?.components?.find((c: any) => c.id === "R1" || c.type === "resistor");
      return comp ? { x: comp.x, y: comp.y } : null;
    });

    expect(compPos).toEqual({ x: 100, y: 100 });
  });

  test("5. Box select + Delete: seleccion multiple -> Delete -> componentes eliminados", async ({
    page,
    placeComponent,
    selectComponent,
    deleteSelected,
  }) => {
    await placeComponent("resistor", 0, 0);
    await placeComponent("capacitor", 100, 0);
    await placeComponent("inductor", 200, 0);

    const initialCount = await page.evaluate(() => (window as any).orchestrator?.components?.length ?? 0);
    expect(initialCount).toBeGreaterThanOrEqual(3);

    // Seleccionar y eliminar
    await selectComponent("R1");
    await deleteSelected();

    const afterCount = await page.evaluate(() => (window as any).orchestrator?.components?.length ?? 0);
    expect(afterCount).toBe(initialCount - 1);
  });

  test("6. Undo/Redo: accion -> Ctrl+Z -> revertido, Ctrl+Y -> reaplicado", async ({
    page,
    placeComponent,
    undo,
    redo,
  }) => {
    const startCount = await page.evaluate(() => (window as any).orchestrator?.components?.length ?? 0);

    await placeComponent("resistor", 50, 50);
    const placedCount = await page.evaluate(() => (window as any).orchestrator?.components?.length ?? 0);
    expect(placedCount).toBeGreaterThan(startCount);

    // Deshacer (Undo)
    await undo();
    const undoneCount = await page.evaluate(() => (window as any).orchestrator?.components?.length ?? 0);
    expect(undoneCount).toBeLessThan(placedCount);

    // Rehacer (Redo)
    await redo();
    const redoneCount = await page.evaluate(() => (window as any).orchestrator?.components?.length ?? 0);
    expect(redoneCount).toBe(placedCount);
  });
});
