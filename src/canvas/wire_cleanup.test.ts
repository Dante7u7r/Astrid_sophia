import { describe, expect, it } from "vitest";
import { cleanAllCircuitWires, simplifyOrthogonalWirePath } from "./wire_cleanup";
import type { WireInstance } from "../canvas_orchestrator";

describe("Orthogonal Wire Cleanup (simplifyOrthogonalWirePath)", () => {
  it("preserves single segments and empty paths", () => {
    expect(simplifyOrthogonalWirePath([])).toEqual([]);
    expect(simplifyOrthogonalWirePath([{ x: 10, y: 10 }])).toEqual([{ x: 10, y: 10 }]);
    expect(simplifyOrthogonalWirePath([{ x: 0, y: 0 }, { x: 100, y: 0 }])).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
  });

  it("removes consecutive duplicate points", () => {
    const raw = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
    ];
    const cleaned = simplifyOrthogonalWirePath(raw);
    expect(cleaned).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
    ]);
  });

  it("merges collinear horizontal segments", () => {
    const raw = [
      { x: 0, y: 100 },
      { x: 20, y: 100 },
      { x: 60, y: 100 },
      { x: 100, y: 100 },
    ];
    const cleaned = simplifyOrthogonalWirePath(raw);
    expect(cleaned).toEqual([
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ]);
  });

  it("merges collinear vertical segments", () => {
    const raw = [
      { x: 200, y: 0 },
      { x: 200, y: 50 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
    ];
    const cleaned = simplifyOrthogonalWirePath(raw);
    expect(cleaned).toEqual([
      { x: 200, y: 0 },
      { x: 200, y: 200 },
    ]);
  });

  it("preserves intentional 90-degree corners", () => {
    const raw = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 200, y: 80 },
    ];
    const cleaned = simplifyOrthogonalWirePath(raw);
    expect(cleaned).toEqual(raw);
  });

  it("cleans in-place across an array of WireInstances with cleanAllCircuitWires", () => {
    const wires: WireInstance[] = [
      {
        id: "w1",
        from: { componentId: "R1", pinIndex: 0 },
        to: { componentId: "R2", pinIndex: 0 },
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 20, y: 0 },
        ],
      },
    ];

    cleanAllCircuitWires(wires);
    expect(wires[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ]);
  });
});
