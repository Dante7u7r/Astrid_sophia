// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { FailureAnimationRenderer } from "./failure_animation_renderer";
import type { ComponentInstance, WireInstance } from "../canvas_orchestrator";

describe("FailureAnimationRenderer", () => {
  it("renderiza chispas de cortocircuito sin lanzar excepciones", () => {
    const renderer = new FailureAnimationRenderer();
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    renderer.renderShortCircuitSparks(ctx, 100, 100, 1500, 1.0);

    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
  });

  it("detecta puntos de cortocircuito a partir de incidentes ERC", () => {
    const renderer = new FailureAnimationRenderer();
    const components: ComponentInstance[] = [
      { id: "V1", type: "vsource", value: "12V", x: 150, y: 200, rotation: 0 },
    ];
    const ercIssues = [
      { componentId: "V1", type: "error" as const, message: "Fuente en cortocircuito detectada" },
    ];

    const points = renderer.detectShortCircuitPoints([], components, {}, ercIssues);
    expect(points).toHaveLength(1);
    expect(points[0]).toEqual({ x: 150, y: 200 });
  });

  it("detecta sobrecorriente extrema en cables", () => {
    const renderer = new FailureAnimationRenderer();
    const wires: WireInstance[] = [
      {
        id: "W1",
        from: { componentId: "V1", pinIndex: 0 },
        to: { componentId: "GND1", pinIndex: 0 },
        points: [{ x: 50, y: 50 }, { x: 150, y: 50 }],
      },
    ];
    const branchCurrents = { "W1:I": 25.0 }; // 25 Amperios -> Corto destructivo

    const points = renderer.detectShortCircuitPoints(wires, [], branchCurrents, []);
    expect(points).toHaveLength(1);
    expect(points[0]).toEqual({ x: 100, y: 50 }); // Punto medio del cable
  });

  it("renderiza fallas sobre todos los puntos detectados", () => {
    const renderer = new FailureAnimationRenderer();
    const sparkSpy = vi.spyOn(renderer, "renderShortCircuitSparks").mockImplementation(() => {});

    const components: ComponentInstance[] = [
      { id: "V1", type: "vsource", value: "5V", x: 80, y: 80, rotation: 0 },
    ];
    const ercIssues = [
      { componentId: "V1", type: "error" as const, message: "Cortocircuito directo" },
    ];

    const ctx = {} as CanvasRenderingContext2D;
    renderer.renderFailures(ctx, [], components, {}, ercIssues, 1000);

    expect(sparkSpy).toHaveBeenCalledWith(ctx, 80, 80, 1000);
  });

  it("detecta extremos de cable flotantes (dead-ends) y los dibuja discretamente", () => {
    const renderer = new FailureAnimationRenderer();
    const components: ComponentInstance[] = [
      { id: "R1", type: "resistor", value: 1000, x: 50, y: 50, rotation: 0 },
    ];
    const wires: WireInstance[] = [
      {
        id: "W_OPEN",
        from: { componentId: "R1", pinIndex: 0 }, // Conectado a R1
        to: { componentId: "NON_EXISTENT", pinIndex: 0 }, // Extremo flotante
        points: [{ x: 50, y: 50 }, { x: 200, y: 50 }],
      },
    ];

    const deadEnds = renderer.detectDeadEndWirePoints(wires, components);
    expect(deadEnds).toHaveLength(1);
    expect(deadEnds[0]).toEqual({ x: 200, y: 50 });

    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    renderer.renderDeadEndMarkers(ctx, deadEnds, false);
    expect(ctx.arc).toHaveBeenCalledWith(200, 50, 2.5, 0, Math.PI * 2);
    expect(ctx.stroke).toHaveBeenCalled();
  });
});
