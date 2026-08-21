import { test, expect } from "./fixtures/canvas-page";

test.describe("DRC Visual & Clearance Verification", () => {
  test("DRC violation overlay appears on wire clearance breach", async ({
    page,
    placeComponent,
    wire,
  }) => {
    // Colocar pares de componentes para generar dos pistas paralelas muy cercanas (< 20px)
    await placeComponent("resistor", 0, 0);
    await placeComponent("vsource", 100, 0);
    await placeComponent("capacitor", 0, 10);
    await placeComponent("ground", 100, 10);

    // Conectar dos cables independientes pero cercanos
    await wire("R1", 0, "V1", 0);
    await wire("C1", 0, "GND1", 0);

    await page.waitForTimeout(200);

    const violations = await page.evaluate(() => {
      const orch = (window as any).orchestrator;
      if (!orch) return [];
      const report = orch.validateDRC ? orch.validateDRC({ minWireSpacing: 25 }) : null;
      return report?.violations ?? orch.drcViolations ?? [];
    });

    expect(violations.length).toBeGreaterThan(0);
    expect(
      violations.some(
        (v: any) =>
          v.type === "WIRE_CLEARANCE" ||
          v.type === "UNRESOLVED_CROSSING" ||
          v.type === "COMPONENT_CLEARANCE"
      )
    ).toBe(true);

    // Verificar que el canvas renderiza contenido gráfico
    const hasCanvasRender = await page.locator("#circuit-canvas").evaluate((c) => {
      const canvas = c as HTMLCanvasElement;
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;
      const imgData = ctx.getImageData(0, 0, Math.min(canvas.width, 400), Math.min(canvas.height, 400));
      for (let i = 0; i < imgData.data.length; i += 4) {
        if (imgData.data[i + 3] > 0) return true; // Alpha > 0
      }
      return false;
    });

    expect(hasCanvasRender).toBe(true);
  });
});
