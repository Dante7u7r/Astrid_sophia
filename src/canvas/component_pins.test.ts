import { describe, expect, it } from "vitest";
import type { ComponentInstance } from "../canvas_orchestrator";
import { getComponentPins } from "./component_pins";

function component(partial: Partial<ComponentInstance> & Pick<ComponentInstance, "id" | "type">): ComponentInstance {
  return {
    value: 1,
    x: 100,
    y: 200,
    rotation: 0,
    ...partial,
  };
}

describe("getComponentPins", () => {
  it("genera 40 pines para MCU 8051", () => {
    const pins = getComponentPins(component({ id: "U1", type: "mcu_8051" }));

    expect(pins).toHaveLength(40);
    expect(pins[0]).toMatchObject({ componentId: "U1", pinIndex: 0, x: 40, y: 0 });
    expect(pins[39]).toMatchObject({ componentId: "U1", pinIndex: 39, x: 160, y: 0 });
  });

  it("aplica rotacion y espejo a componentes de dos pines", () => {
    const pins = getComponentPins(component({ id: "R1", type: "resistor", rotation: 90, mirror: true }));

    expect(pins[0].x).toBeCloseTo(100);
    expect(pins[0].y).toBeCloseTo(240);
    expect(pins[1].x).toBeCloseTo(100);
    expect(pins[1].y).toBeCloseTo(160);
  });

  it("soporta numero dinamico de pines en subcircuitos X", () => {
    const pins = getComponentPins(component({ id: "X1", type: "x", pinCount: 6 }));

    expect(pins).toHaveLength(6);
    expect(pins.map((pin) => pin.pinIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(pins[0].x).toBe(40);
    expect(pins[1].x).toBe(160);
  });
});
