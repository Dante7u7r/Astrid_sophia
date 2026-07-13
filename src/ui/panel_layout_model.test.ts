import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYOUT,
  LAYOUT_VERSION,
  clampPanelDimension,
  getDefaultLayoutForViewport,
  getKeyboardResizeDirection,
  resizePanelByDrag,
  resizePanelByKeyboard,
  sanitizeStoredLayout,
} from "./panel_layout_model";

describe("panel_layout_model", () => {
  it("crea defaults distintos para escritorio y viewport compacto", () => {
    expect(getDefaultLayoutForViewport(1200)).toEqual({
      ...DEFAULT_LAYOUT,
      version: LAYOUT_VERSION,
    });

    expect(getDefaultLayoutForViewport(720)).toEqual({
      ...DEFAULT_LAYOUT,
      version: LAYOUT_VERSION,
      leftWidth: 220,
      rightWidth: 260,
      leftCollapsed: true,
      rightCollapsed: true,
      dockCollapsed: true,
    });
  });

  it("acota dimensiones de paneles", () => {
    expect(clampPanelDimension("left", 100, 900)).toBe(160);
    expect(clampPanelDimension("left", 999, 900)).toBe(400);
    expect(clampPanelDimension("right", 100, 900)).toBe(180);
    expect(clampPanelDimension("right", 999, 900)).toBe(450);
    expect(clampPanelDimension("dock", 999, 800)).toBe(400);
  });

  it("redimensiona por drag con la direccion visual correcta", () => {
    expect(resizePanelByDrag("left", 200, 100, 130, 900)).toBe(230);
    expect(resizePanelByDrag("right", 220, 300, 260, 900)).toBe(260);
    expect(resizePanelByDrag("dock", 210, 500, 460, 900)).toBe(250);
  });

  it("redimensiona por teclado respetando panel derecho invertido", () => {
    expect(getKeyboardResizeDirection("left", "ArrowRight")).toBe(1);
    expect(getKeyboardResizeDirection("dock", "ArrowDown")).toBe(-1);
    expect(getKeyboardResizeDirection("dock", "ArrowLeft")).toBe(0);

    expect(resizePanelByKeyboard("left", 200, 1, 10, 900)).toBe(210);
    expect(resizePanelByKeyboard("right", 220, 1, 10, 900)).toBe(210);
    expect(resizePanelByKeyboard("dock", 210, -1, 10, 900)).toBe(200);
  });

  it("sanea layouts persistidos y descarta versiones incompatibles", () => {
    expect(sanitizeStoredLayout({ version: LAYOUT_VERSION - 1 }, 900)).toBeNull();

    expect(sanitizeStoredLayout({
      version: LAYOUT_VERSION,
      leftWidth: 999,
      rightWidth: 1,
      dockHeight: 999,
      leftCollapsed: true,
      rightCollapsed: false,
      dockCollapsed: false,
    }, 800)).toMatchObject({
      leftWidth: 400,
      rightWidth: 180,
      dockHeight: 400,
      leftCollapsed: true,
      rightCollapsed: false,
      dockCollapsed: false,
    });
  });
});
