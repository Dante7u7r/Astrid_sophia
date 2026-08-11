import { describe, test, expect } from "vitest";
import {
  hitTestComponentAt,
  getComponentLocalHalfExtents,
  getComponentBounds,
  type ComponentInstance,
} from "../canvas_orchestrator";

function makeComp(partial: Partial<ComponentInstance> & Pick<ComponentInstance, "id" | "type">): ComponentInstance {
  return {
    value: 0,
    x: 0,
    y: 0,
    rotation: 0,
    ...partial,
  };
}

describe("getComponentLocalHalfExtents", () => {
  test("MCU 8051 tiene caja mucho mayor que un resistor", () => {
    const mcu = makeComp({ id: "U1", type: "mcu_8051" });
    const r = makeComp({ id: "R1", type: "resistor" });
    const mcuExt = getComponentLocalHalfExtents(mcu);
    const rExt = getComponentLocalHalfExtents(r);
    expect(mcuExt.halfH).toBeGreaterThan(rExt.halfH * 3);
    expect(mcuExt.halfW).toBeGreaterThan(rExt.halfW);
  });
});

describe("hitTestComponentAt", () => {
  test("MCU 8051 es seleccionable en el centro del cuerpo", () => {
    const mcu = makeComp({ id: "U1", type: "mcu_8051", x: 100, y: 200 });
    expect(hitTestComponentAt(mcu, 100, 200)).toBe(true);
    expect(hitTestComponentAt(mcu, 100, -20)).toBe(true);
  });

  test("resistor no responde fuera de su caja local", () => {
    const r = makeComp({ id: "R1", type: "resistor", x: 0, y: 0 });
    expect(hitTestComponentAt(r, 0, 0)).toBe(true);
    expect(hitTestComponentAt(r, 100, 100)).toBe(false);
  });

  test("rotación 90° transforma coords locales correctamente", () => {
    const r = makeComp({ id: "R1", type: "resistor", x: 0, y: 0, rotation: 90 });
    const ext = getComponentLocalHalfExtents(r);
    const bounds = getComponentBounds(r);
    expect(bounds.width).toBeCloseTo(ext.halfH * 2, 0);
    expect(bounds.height).toBeCloseTo(ext.halfW * 2, 0);
  });
});

describe("pin hit threshold (via CanvasOrchestrator)", () => {
  test("umbral escala con zoom", async () => {
    const { CanvasOrchestrator } = await import("../canvas_orchestrator");
    const canvas = {
      getContext: () => ({}),
      style: {},
    } as unknown as HTMLCanvasElement;
    const orch = new CanvasOrchestrator(canvas);
    orch.zoom = 1;
    expect(orch.getPinHitThreshold()).toBe(12);
    orch.zoom = 3;
    expect(orch.getPinHitThreshold()).toBe(6);
    orch.zoom = 0.3;
    expect(orch.getPinHitThreshold()).toBeGreaterThan(12);
  });
});
