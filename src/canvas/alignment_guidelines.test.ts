import { describe, expect, it } from "vitest";
import { computeSmartAlignment } from "./alignment_guidelines";
import type { ComponentInstance, PinInstance } from "../canvas_orchestrator";

function makeComponent(id: string, x: number, y: number, type: ComponentInstance["type"] = "resistor"): ComponentInstance {
  return {
    id,
    type,
    value: 1000,
    x,
    y,
    rotation: 0,
  };
}

function dummyPins(comp: ComponentInstance): PinInstance[] {
  return [
    { componentId: comp.id, pinIndex: 0, x: comp.x - 40, y: comp.y },
    { componentId: comp.id, pinIndex: 1, x: comp.x + 40, y: comp.y },
  ];
}

describe("Smart Alignment Guidelines (computeSmartAlignment)", () => {
  it("returns no adjustments or guides when no static components exist", () => {
    const dragging = [makeComponent("R1", 100, 100)];
    const result = computeSmartAlignment(dragging, dragging, { x: 104, y: 104 });

    expect(result.adjustedOffset).toEqual({ x: 0, y: 0 });
    expect(result.guides).toHaveLength(0);
  });

  it("snaps center X and produces a vertical guide line when within threshold", () => {
    const c1 = makeComponent("R1", 200, 100);
    const c2 = makeComponent("R2", 200, 300); // Static component at x=200
    const dragging = [c1];
    const all = [c1, c2];

    // Tentative drag position of R1 is x=204, y=120 (delta X = -4, within threshold 8)
    const result = computeSmartAlignment(dragging, all, { x: 204, y: 120 }, { threshold: 8 });

    expect(result.adjustedOffset.x).toBe(-4);
    expect(result.guides).toHaveLength(1);
    expect(result.guides[0].axis).toBe("x");
    expect(result.guides[0].coord).toBe(200);
    expect(result.guides[0].kind).toBe("center");
    expect(result.guides[0].targetCompId).toBe("R2");
  });

  it("snaps center Y and produces a horizontal guide line when within threshold", () => {
    const c1 = makeComponent("R1", 100, 200);
    const c2 = makeComponent("R2", 400, 200); // Static component at y=200
    const dragging = [c1];
    const all = [c1, c2];

    // Tentative drag position of R1 is x=150, y=197 (delta Y = +3, within threshold 8)
    const result = computeSmartAlignment(dragging, all, { x: 150, y: 197 }, { threshold: 8 });

    expect(result.adjustedOffset.y).toBe(3);
    expect(result.guides).toHaveLength(1);
    expect(result.guides[0].axis).toBe("y");
    expect(result.guides[0].coord).toBe(200);
    expect(result.guides[0].kind).toBe("center");
    expect(result.guides[0].targetCompId).toBe("R2");
  });

  it("snaps both X and Y simultaneously when close to both axes", () => {
    const c1 = makeComponent("R1", 100, 100);
    const c2 = makeComponent("R2", 200, 100);
    const c3 = makeComponent("R3", 100, 300);
    const dragging = [c1];
    const all = [c1, c2, c3];

    // Tentative position is (103, 102) -> close to X=100 (from R3) and Y=100 (from R2)
    const result = computeSmartAlignment(dragging, all, { x: 103, y: 102 }, { threshold: 6 });

    expect(result.adjustedOffset.x).toBe(-3);
    expect(result.adjustedOffset.y).toBe(-2);
    expect(result.guides).toHaveLength(2);
  });

  it("snaps pin-to-pin when pin coordinates align", () => {
    const c1 = makeComponent("R1", 100, 100); // Pins at (60, 100) and (140, 100)
    const c2 = makeComponent("R2", 300, 200); // Pins at (260, 200) and (340, 200)
    const dragging = [c1];
    const all = [c1, c2];

    // Drag R1 so pin 1 (x + 40) is near R2 pin 0 (x=260) -> R1 x tentative = 218 -> pin 1 = 258 -> delta = +2
    const result = computeSmartAlignment(
      dragging,
      all,
      { x: 218, y: 350 },
      { threshold: 6, resolvePins: dummyPins },
    );

    expect(result.adjustedOffset.x).toBe(2);
    expect(result.guides.some((g) => g.kind === "pin" && g.axis === "x")).toBe(true);
  });

  it("does not snap when distance exceeds threshold", () => {
    const c1 = makeComponent("R1", 100, 100);
    const c2 = makeComponent("R2", 200, 200);
    const dragging = [c1];
    const all = [c1, c2];

    const result = computeSmartAlignment(dragging, all, { x: 130, y: 140 }, { threshold: 8 });

    expect(result.adjustedOffset).toEqual({ x: 0, y: 0 });
    expect(result.guides).toHaveLength(0);
  });
});
