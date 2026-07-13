import { describe, expect, it } from "vitest";
import type { ComponentInstance } from "../canvas_orchestrator";
import {
  createComponentLookup,
  createSelectedComponentIds,
  createGridRenderPlan,
  ensureCanvasBuffer,
  getCanvasBufferSize,
  getVisibleComponents,
  resolveRenderDetail,
} from "./render_model";

function component(id: string, x: number, y: number = 0): ComponentInstance {
  return { id, type: "resistor", value: 1, x, y, rotation: 0 };
}

describe("render_model", () => {
  it("redondea el buffer fisico para DPR fraccional", () => {
    expect(getCanvasBufferSize(101, 50, 1.25)).toEqual({
      bufferWidth: 126,
      bufferHeight: 63,
    });
  });

  it("sincroniza dimensiones fisicas y CSS del canvas", () => {
    const canvas = {
      clientWidth: 200,
      clientHeight: 100,
      width: 0,
      height: 0,
      style: {},
    } as unknown as HTMLCanvasElement;

    expect(ensureCanvasBuffer(canvas, 2)).toEqual({
      bufferWidth: 400,
      bufferHeight: 200,
    });
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(200);
    expect(canvas.style.width).toBe("200px");
    expect(canvas.style.height).toBe("100px");
  });

  it("calcula lookup, seleccion y componentes visibles", () => {
    const r1 = component("R1", 0);
    const r2 = component("R2", 1_000);
    const lookup = createComponentLookup([r1, r2]);
    const selected = createSelectedComponentIds([r2]);
    const visible = getVisibleComponents([r1, r2], {
      x: -100,
      y: -100,
      width: 200,
      height: 200,
    });

    expect(lookup.get("R1")).toBe(r1);
    expect(selected.has("R2")).toBe(true);
    expect(visible).toEqual([r1]);
  });

  it("resuelve detalle compacto por zoom o densidad", () => {
    expect(resolveRenderDetail(0.5, 1)).toBe("compact");
    expect(resolveRenderDetail(0.8, 361)).toBe("compact");
    expect(resolveRenderDetail(1, 500)).toBe("full");
  });

  it("crea plan de grilla estable y reduce densidad si hay demasiados puntos", () => {
    const plan = createGridRenderPlan({
      topLeft: { x: -11, y: -1 },
      bottomRight: { x: 49, y: 41 },
      gridSize: 20,
      zoom: 1,
    });

    expect(plan).toMatchObject({
      startX: -20,
      endX: 60,
      startY: -20,
      endY: 60,
      gridStep: 20,
    });
    expect(plan?.cacheKey).toContain("-20:60:-20:60:20");

    const densePlan = createGridRenderPlan({
      topLeft: { x: 0, y: 0 },
      bottomRight: { x: 10_000, y: 10_000 },
      gridSize: 20,
      zoom: 0.5,
      maxGridDots: 100,
    });
    expect(densePlan?.gridStep).toBeGreaterThan(20);
  });
});
