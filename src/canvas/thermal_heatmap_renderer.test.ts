// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ThermalHeatmapRenderer } from "./thermal_heatmap_renderer";
import type { ComponentInstance } from "../canvas_orchestrator";

describe("ThermalHeatmapRenderer", () => {
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      createRadialGradient: () => ({ addColorStop: vi.fn() }),
      fillRect: vi.fn(),
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  it("inicializa cachés fuera de pantalla sin errores", () => {
    const renderer = new ThermalHeatmapRenderer();
    expect(renderer).toBeDefined();
  });

  it("calcula potencias nominales correctas por tipo de componente", () => {
    const renderer = new ThermalHeatmapRenderer();
    expect(renderer.getRatedPower("resistor")).toBe(0.25);
    expect(renderer.getRatedPower("npn")).toBe(0.80);
    expect(renderer.getRatedPower("lamp")).toBe(5.00);
  });

  it("renderiza con inercia térmica física (calentamiento y enfriamiento progresivo)", () => {
    const renderer = new ThermalHeatmapRenderer();
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      drawImage: vi.fn(),
      globalCompositeOperation: "",
      globalAlpha: 1.0,
    } as unknown as CanvasRenderingContext2D;

    const comp: ComponentInstance = {
      id: "R1",
      type: "resistor",
      value: 100,
      x: 100,
      y: 100,
      rotation: 0,
      mirror: false,
    };

    const visibleBounds = { x: 0, y: 0, width: 1000, height: 1000 };

    // Frame 1: 5V sobre 100 ohms -> P = 0.25 W a t = 1000ms
    renderer.renderThermalHeatmap(
      ctx,
      [comp],
      { "R1:0": 5, "R1:1": 0 },
      { "R1:I": 0.05 },
      visibleBounds,
      1.0,
      1000,
    );

    expect(ctx.drawImage).toHaveBeenCalled();
    const firstCallCount = (ctx.drawImage as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

    // Frame 2: Se corta la corriente a t = 1050ms (50ms después) -> conserva calor residual
    renderer.renderThermalHeatmap(
      ctx,
      [comp],
      { "R1:0": 0, "R1:1": 0 },
      { "R1:I": 0 },
      visibleBounds,
      1.0,
      1050,
    );

    // Debe seguir dibujando gracias a la inercia térmica
    const secondCallCount = (ctx.drawImage as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    expect(secondCallCount).toBeGreaterThan(firstCallCount);
  });

  it("detecta sobrecarga térmica y dibuja corona de advertencia", () => {
    const renderer = new ThermalHeatmapRenderer();
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      drawImage: vi.fn(),
      globalCompositeOperation: "",
      globalAlpha: 1.0,
    } as unknown as CanvasRenderingContext2D;

    const comp: ComponentInstance = {
      id: "R_OVERLOAD",
      type: "resistor",
      value: 10,
      x: 100,
      y: 100,
      rotation: 0,
      mirror: false,
    };

    const visibleBounds = { x: 0, y: 0, width: 1000, height: 1000 };

    // 10V sobre 10 ohms -> P = 10 W (40x la potencia nominal de 0.25W)
    renderer.renderThermalHeatmap(
      ctx,
      [comp],
      { "R_OVERLOAD:0": 10, "R_OVERLOAD:1": 0 },
      { "R_OVERLOAD:I": 1.0 },
      visibleBounds,
      1.0,
      1000,
    );

    // Debe dibujar la textura normal y la textura de sobrecarga (2 drawImage calls por componente sobrecargado)
    expect((ctx.drawImage as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(2);
  });
});
