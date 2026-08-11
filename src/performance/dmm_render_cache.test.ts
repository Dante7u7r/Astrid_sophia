import { describe, expect, it } from "vitest";
import { buildDmmRenderCacheKey } from "./dmm_render_cache";
import type { ComponentInstance, WireInstance } from "../canvas_orchestrator";

describe("buildDmmRenderCacheKey", () => {
  it("uses a stable sentinel when the schematic has no DMM", () => {
    const components: ComponentInstance[] = [
      { id: "R1", type: "resistor", value: "1k", x: 0, y: 0, rotation: 0 },
    ];

    expect(buildDmmRenderCacheKey(components, [], {}, {})).toBe("no-dmm");
  });

  it("changes when DMM wiring or node voltages change", () => {
    const components: ComponentInstance[] = [
      { id: "M1", type: "dmm", value: "voltage", x: 0, y: 0, rotation: 0 },
      { id: "R1", type: "resistor", value: "1k", x: 120, y: 0, rotation: 0 },
    ];
    const wires: WireInstance[] = [
      {
        id: "w1",
        from: { componentId: "M1", pinIndex: 0 },
        to: { componentId: "R1", pinIndex: 0 },
        points: [],
      },
    ];

    const baseKey = buildDmmRenderCacheKey(
      components,
      wires,
      { "M1:0": "1", "M1:1": "0" },
      { "0": 0, "1": 5 },
    );
    const changedVoltageKey = buildDmmRenderCacheKey(
      components,
      wires,
      { "M1:0": "1", "M1:1": "0" },
      { "0": 0, "1": 3.3 },
    );

    expect(changedVoltageKey).not.toBe(baseKey);
  });
});
