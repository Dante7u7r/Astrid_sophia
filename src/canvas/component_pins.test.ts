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

  it("aplica rotacion y espejo horizontal y vertical a componentes", () => {
    const pinsH = getComponentPins(component({ id: "R1", type: "resistor", rotation: 90, mirror: true }));

    expect(pinsH[0].x).toBeCloseTo(100);
    expect(pinsH[0].y).toBeCloseTo(240);
    expect(pinsH[1].x).toBeCloseTo(100);
    expect(pinsH[1].y).toBeCloseTo(160);

    const pinsV = getComponentPins(component({ id: "R2", type: "resistor", rotation: 0, mirrorY: true }));
    expect(pinsV[0].x).toBeCloseTo(60);
    expect(pinsV[0].y).toBeCloseTo(200);
    expect(pinsV[1].x).toBeCloseTo(140);
    expect(pinsV[1].y).toBeCloseTo(200);
  });

  it("soporta numero dinamico de pines en subcircuitos X", () => {
    const pins = getComponentPins(component({ id: "X1", type: "x", pinCount: 6 }));

    expect(pins).toHaveLength(6);
    expect(pins.map((pin) => pin.pinIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(pins[0].x).toBe(60);
    expect(pins[3].x).toBe(140);
  });

  it("genera 4 pines para Puente Rectificador de Diodos (diode_bridge)", () => {
    const pins = getComponentPins(component({ id: "BR1", type: "diode_bridge", x: 100, y: 200 }));

    expect(pins).toHaveLength(4);
    // Pin 0 (AC1) en (-40, -20) -> (60, 180)
    expect(pins[0]).toMatchObject({ componentId: "BR1", pinIndex: 0, x: 60, y: 180, label: "~" });
    // Pin 1 (AC2) en (-40, 20) -> (60, 220)
    expect(pins[1]).toMatchObject({ componentId: "BR1", pinIndex: 1, x: 60, y: 220, label: "~" });
    // Pin 2 (DC+) en (40, -20) -> (140, 180)
    expect(pins[2]).toMatchObject({ componentId: "BR1", pinIndex: 2, x: 140, y: 180, label: "+" });
    // Pin 3 (DC-) en (40, 20) -> (140, 220)
    expect(pins[3]).toMatchObject({ componentId: "BR1", pinIndex: 3, x: 140, y: 220, label: "-" });
  });
});
