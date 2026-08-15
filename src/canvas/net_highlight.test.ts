import { describe, expect, it } from "vitest";
import { getActiveNetHighlight } from "./net_highlight";
import type { PinInstance, WireInstance } from "../canvas_orchestrator";

describe("Net Highlighting (getActiveNetHighlight)", () => {
  const w1: WireInstance = {
    id: "w1",
    from: { componentId: "R1", pinIndex: 1 },
    to: { componentId: "R2", pinIndex: 0 },
    points: [{ x: 100, y: 100 }, { x: 200, y: 100 }],
  };

  const w2: WireInstance = {
    id: "w2",
    from: { componentId: "R2", pinIndex: 0 },
    to: { componentId: "C1", pinIndex: 0 },
    points: [{ x: 200, y: 100 }, { x: 200, y: 200 }],
  };

  const w3: WireInstance = {
    id: "w3",
    from: { componentId: "V1", pinIndex: 0 },
    to: { componentId: "R1", pinIndex: 0 },
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
  };

  const allWires = [w1, w2, w3];

  it("returns empty sets when nothing is hovered or selected", () => {
    const result = getActiveNetHighlight({
      wires: allWires,
      hoveredWire: null,
      hoveredPin: null,
      selectedWire: null,
    });

    expect(result.netWireIds.size).toBe(0);
    expect(result.netPinKeys.size).toBe(0);
  });

  it("highlights the entire connected net when hovering over a wire", () => {
    const result = getActiveNetHighlight({
      wires: allWires,
      hoveredWire: w1,
      hoveredPin: null,
      selectedWire: null,
    });

    // w1 connects R1:1 to R2:0, which connects to w2 (R2:0 to C1:0)
    expect(result.netWireIds.has("w1")).toBe(true);
    expect(result.netWireIds.has("w2")).toBe(true);
    expect(result.netWireIds.has("w3")).toBe(false);
    expect(result.netPinKeys.has("R1:1")).toBe(true);
    expect(result.netPinKeys.has("R2:0")).toBe(true);
    expect(result.netPinKeys.has("C1:0")).toBe(true);
  });

  it("highlights the full net when hovering over a pin", () => {
    const hoveredPin: PinInstance = {
      componentId: "C1",
      pinIndex: 0,
      x: 200,
      y: 200,
    };

    const result = getActiveNetHighlight({
      wires: allWires,
      hoveredWire: null,
      hoveredPin,
      selectedWire: null,
    });

    expect(result.netWireIds.has("w1")).toBe(true);
    expect(result.netWireIds.has("w2")).toBe(true);
    expect(result.netPinKeys.has("C1:0")).toBe(true);
    expect(result.netPinKeys.has("R2:0")).toBe(true);
  });

  it("uses nodeMap when available for exact SPICE net resolution", () => {
    const nodeMap: Record<string, string> = {
      "R1:1": "NET_A",
      "R2:0": "NET_A",
      "C1:0": "NET_A",
      "V1:0": "NET_B",
      "R1:0": "NET_B",
    };

    const result = getActiveNetHighlight({
      wires: allWires,
      hoveredWire: w2,
      hoveredPin: null,
      selectedWire: null,
      nodeMap,
    });

    expect(result.activeNodeId).toBe("NET_A");
    expect(result.netWireIds.has("w1")).toBe(true);
    expect(result.netWireIds.has("w2")).toBe(true);
    expect(result.netWireIds.has("w3")).toBe(false);
    expect(result.netPinKeys).toEqual(new Set(["R1:1", "R2:0", "C1:0"]));
  });

  it("resalta redes virtuales separadas que comparten el mismo wire.label", () => {
    const wireA: WireInstance = {
      id: "wA",
      from: { componentId: "R1", pinIndex: 0 },
      to: { componentId: "R1", pinIndex: 0 },
      label: "CLK_BUS",
    };
    const wireB: WireInstance = {
      id: "wB",
      from: { componentId: "R2", pinIndex: 0 },
      to: { componentId: "R2", pinIndex: 0 },
      label: "CLK_BUS",
    };

    const result = getActiveNetHighlight({
      wires: [wireA, wireB],
      hoveredWire: wireA,
      hoveredPin: null,
      selectedWire: null,
    });

    expect(result.netWireIds.has("wA")).toBe(true);
    expect(result.netWireIds.has("wB")).toBe(true);
  });
});
