import { test as base, type Locator } from "@playwright/test";

export interface CanvasHelpers {
  canvas: Locator;
  clickWorld(x: number, y: number): Promise<void>;
  dragWorld(fromX: number, fromY: number, toX: number, toY: number): Promise<void>;
  zoom(factor: number, centerX?: number, centerY?: number): Promise<void>;
  pan(dx: number, dy: number): Promise<void>;
  placeComponent(type: string, x: number, y: number): Promise<void>;
  dragComponentFromPalette(type: string, targetWorldX: number, targetWorldY: number): Promise<void>;
  wire(fromComp: string, fromPin: number, toComp: string, toPin: number): Promise<void>;
  selectComponent(id: string): Promise<void>;
  deleteSelected(): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  getViewportTransform(): Promise<{ zoom: number; offsetX: number; offsetY: number }>;
}

export const test = base.extend<CanvasHelpers>({
  page: async ({ page }, use) => {
    await page.goto("/?audit=1&auditStage=tabs", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#circuit-canvas", { state: "visible", timeout: 10000 });
    await page.waitForFunction(() => typeof (window as any).orchestrator !== "undefined" && (window as any).orchestrator !== null, {
      timeout: 10000,
    });
    const pinLeft = page.locator("#btn-pin-left");
    if (await pinLeft.isVisible() && await pinLeft.getAttribute("aria-pressed") !== "true") {
      await pinLeft.click();
    }
    await use(page);
  },

  canvas: async ({ page }, use) => {
    const canvas = page.locator("#circuit-canvas");
    await use(canvas);
  },

  getViewportTransform: async ({ page }, use) => {
    await use(async () => {
      return await page.evaluate(() => {
        const orch = (window as any).orchestrator;
        if (!orch) throw new Error("CanvasOrchestrator not ready on window");
        return {
          zoom: orch.zoom,
          offsetX: orch.offsetX,
          offsetY: orch.offsetY,
        };
      });
    });
  },

  clickWorld: async ({ canvas, page }, use) => {
    await use(async (worldX: number, worldY: number) => {
      const transform = await page.evaluate(() => {
        const orch = (window as any).orchestrator;
        return orch ? { zoom: orch.zoom, offsetX: orch.offsetX, offsetY: orch.offsetY } : null;
      });
      if (!transform) throw new Error("CanvasOrchestrator not ready");
      const screenX = transform.offsetX + worldX * transform.zoom;
      const screenY = transform.offsetY + worldY * transform.zoom;
      await canvas.click({ position: { x: screenX, y: screenY } });
    });
  },

  dragWorld: async ({ canvas, page }, use) => {
    await use(async (fromX: number, fromY: number, toX: number, toY: number) => {
      const transform = await page.evaluate(() => {
        const orch = (window as any).orchestrator;
        return orch ? { zoom: orch.zoom, offsetX: orch.offsetX, offsetY: orch.offsetY } : null;
      });
      if (!transform) throw new Error("CanvasOrchestrator not ready");
      const fromScreenX = transform.offsetX + fromX * transform.zoom;
      const fromScreenY = transform.offsetY + fromY * transform.zoom;
      const toScreenX = transform.offsetX + toX * transform.zoom;
      const toScreenY = transform.offsetY + toY * transform.zoom;

      await canvas.hover({ position: { x: fromScreenX, y: fromScreenY } });
      await page.mouse.down();
      await page.mouse.move(toScreenX, toScreenY, { steps: 5 });
      await page.mouse.up();
    });
  },

  zoom: async ({ page }, use) => {
    await use(async (factor: number, centerX = 0, centerY = 0) => {
      await page.evaluate(
        ({ f, cx, cy }) => {
          const orch = (window as any).orchestrator;
          if (orch) {
            orch.zoomAt(f, cx, cy);
            orch.requestRender?.(true);
          }
        },
        { f: factor, cx: centerX, cy: centerY }
      );
    });
  },

  pan: async ({ page }, use) => {
    await use(async (dx: number, dy: number) => {
      await page.evaluate(
        ({ deltaX, deltaY }) => {
          const orch = (window as any).orchestrator;
          if (orch) {
            orch.offsetX += deltaX;
            orch.offsetY += deltaY;
            orch.requestRender?.(true);
          }
        },
        { deltaX: dx, deltaY: dy }
      );
    });
  },

  placeComponent: async ({ page, canvas }, use) => {
    await use(async (type: string, x: number, y: number) => {
      const search = page.locator("#component-search");
      if (!(await search.isVisible())) {
        const expand = page.locator("#btn-expand-left");
        if (await expand.isVisible()) await expand.click();
        else await page.locator("#btn-dock-toggle-left").click();
        await search.waitFor({ state: "visible" });
      }
      await search.fill(type);
      const card = page.locator(`.component-card[data-type="${type}"]`).first();
      await card.waitFor({ state: "visible" });
      const initialCount = await page.evaluate(() => (window as any).orchestrator?.components?.length ?? 0);
      await card.click();
      const canvasBox = await canvas.boundingBox();
      if (!canvasBox) throw new Error("Canvas bounding box not found");
      await canvas.click({
        position: {
          x: canvasBox.width * 0.65,
          y: canvasBox.height * 0.55,
        },
      });
      await search.fill("");
      await page.waitForFunction(
        ({ count }) => ((window as any).orchestrator?.components?.length ?? 0) > count,
        { count: initialCount },
      );
      await page.evaluate(
        ({ compType, targetX, targetY }) => {
          const orch = (window as any).orchestrator;
          const component = [...(orch?.components ?? [])].reverse().find((item: any) => item.type === compType);
          if (!component) throw new Error(`No se encontró el componente recién colocado: ${compType}`);
          component.x = targetX;
          component.y = targetY;
          orch.updateWireConnections();
          orch.requestRender?.(true);
        },
        { compType: type, targetX: x, targetY: y },
      );
    });
  },

  dragComponentFromPalette: async ({ page, canvas }, use) => {
    await use(async (type: string, targetWorldX: number, targetWorldY: number) => {
      const search = page.locator("#component-search");
      if (!(await search.isVisible())) {
        const expand = page.locator("#btn-expand-left");
        if (await expand.isVisible()) await expand.click();
        else await page.locator("#btn-dock-toggle-left").click();
        await search.waitFor({ state: "visible" });
      }
      await search.fill(type);
      const card = page.locator(`.component-card[data-type="${type}"]`).first();
      await card.waitFor({ state: "visible" });
      const cardBox = await card.boundingBox();
      if (!cardBox) throw new Error(`Card for component ${type} not found`);

      const transform = await page.evaluate(() => {
        const orch = (window as any).orchestrator;
        return orch ? { zoom: orch.zoom, offsetX: orch.offsetX, offsetY: orch.offsetY } : null;
      });
      if (!transform) throw new Error("CanvasOrchestrator not ready");

      const canvasBox = await canvas.boundingBox();
      if (!canvasBox) throw new Error("Canvas bounding box not found");

      const screenX = canvasBox.x + transform.offsetX + targetWorldX * transform.zoom;
      const screenY = canvasBox.y + transform.offsetY + targetWorldY * transform.zoom;

      await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(screenX, screenY, { steps: 8 });
      await page.mouse.up();
      await search.fill("");
      await page.waitForTimeout(100);
    });
  },

  wire: async ({ page }, use) => {
    await use(async (fromComp: string, fromPin: number, toComp: string, toPin: number) => {
      await page.evaluate(
        ({ srcId, srcPinIdx, tgtId, tgtPinIdx }) => {
          const orch = (window as any).orchestrator;
          if (!orch) return;
          const c1 = orch.components.find((c: any) => c.id?.toLowerCase() === srcId.toLowerCase() || c.type === srcId.toLowerCase());
          const c2 = orch.components.find((c: any) => c.id?.toLowerCase() === tgtId.toLowerCase() || c.type === tgtId.toLowerCase());
          if (!c1 || !c2) return;
          const pins1 = orch.getComponentPins(c1);
          const pins2 = orch.getComponentPins(c2);
          const p1 = pins1[srcPinIdx] || pins1[0];
          const p2 = pins2[tgtPinIdx] || pins2[0];
          if (p1 && p2) {
            orch.connectPins(p1, p2);
            orch.render?.();
          }
        },
        { srcId: fromComp, srcPinIdx: fromPin, tgtId: toComp, tgtPinIdx: toPin }
      );
    });
  },

  selectComponent: async ({ page }, use) => {
    await use(async (id: string) => {
      await page.evaluate((compId) => {
        const orch = (window as any).orchestrator;
        if (!orch) return;
        const comp = orch.components.find((c: any) => c.id === compId);
        if (comp) {
          orch.selectedComponent = comp;
          orch.selectedComponents = [comp];
          orch.requestRender?.(true);
        }
      }, id);
    });
  },

  deleteSelected: async ({ page }, use) => {
    await use(async () => {
      const deleteButton = page.locator("#btn-delete-selected");
      if (await deleteButton.isVisible() && await deleteButton.isEnabled()) {
        await deleteButton.click();
      } else {
        await page.locator("#circuit-canvas").focus();
        await page.keyboard.press("Delete");
      }
      await page.waitForTimeout(100);
    });
  },

  undo: async ({ page }, use) => {
    await use(async () => {
      const undoBtn = page.locator("#btn-undo-action");
      if (await undoBtn.isVisible()) {
        await undoBtn.click();
      } else {
        await page.keyboard.press("Control+z");
      }
      await page.waitForTimeout(100);
    });
  },

  redo: async ({ page }, use) => {
    await use(async () => {
      const redoBtn = page.locator("#btn-redo-action");
      if (await redoBtn.isVisible()) {
        await redoBtn.click();
      } else {
        await page.keyboard.press("Control+y");
      }
      await page.waitForTimeout(100);
    });
  },
});

export { expect } from "@playwright/test";
