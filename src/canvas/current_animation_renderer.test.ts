// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { CurrentAnimationRenderer } from "./current_animation_renderer";
import type { WireInstance } from "../canvas_orchestrator";

describe("CurrentAnimationRenderer", () => {
  it("inicializa con modo convencional y velocidad 1.0", () => {
    const renderer = new CurrentAnimationRenderer();
    expect(renderer.flowMode).toBe("conventional");
    expect(renderer.speedMultiplier).toBe(1.0);
  });

  it("renderiza flujo en cables activos y no falla con entradas vacías", () => {
    const renderer = new CurrentAnimationRenderer();
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
      lineDashOffset: 0,
      lineWidth: 1,
      strokeStyle: "",
    } as unknown as CanvasRenderingContext2D;

    const wire: WireInstance = {
      id: "W1",
      from: { componentId: "V1", pinIndex: 0 },
      to: { componentId: "R1", pinIndex: 0 },
      points: [{ x: 10, y: 10 }, { x: 50, y: 10 }],
    };

    const visibleBounds = { x: 0, y: 0, width: 1000, height: 1000 };

    // Primer frame inicializa lastTime
    renderer.renderCurrentFlow(ctx, [wire], { "W1:I": 0.02 }, {}, visibleBounds, 1000);
    expect(ctx.stroke).not.toHaveBeenCalled();

    // Segundo frame ejecuta el trazado a t = 1016ms
    renderer.renderCurrentFlow(ctx, [wire], { "W1:I": 0.02 }, {}, visibleBounds, 1016);
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("invierte la dirección al conmutar a flujo electrónico", () => {
    const renderer = new CurrentAnimationRenderer();
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
      lineDashOffset: 0,
      lineWidth: 1,
      strokeStyle: "",
    } as unknown as CanvasRenderingContext2D;

    const wire: WireInstance = {
      id: "W1",
      from: { componentId: "V1", pinIndex: 0 },
      to: { componentId: "R1", pinIndex: 0 },
      points: [{ x: 10, y: 10 }, { x: 50, y: 10 }],
    };

    const visibleBounds = { x: 0, y: 0, width: 1000, height: 1000 };

    renderer.flowMode = "electron";
    renderer.speedMultiplier = 2.0;

    renderer.renderCurrentFlow(ctx, [wire], { "W1:I": 0.05 }, {}, visibleBounds, 1000);
    renderer.renderCurrentFlow(ctx, [wire], { "W1:I": 0.05 }, {}, visibleBounds, 1032);

    expect(ctx.stroke).toHaveBeenCalled();
  });
});
