import { describe, expect, it } from "vitest";
import type { ComponentInstance, PinInstance, WireInstance } from "../canvas_orchestrator";
import {
  hitTestPin,
  resolveHoverState,
} from "./hover_model";

function component(id: string, x: number, type: ComponentInstance["type"] = "resistor"): ComponentInstance {
  return { id, type, value: 1, x, y: 0, rotation: 0 };
}

const getPins = (comp: ComponentInstance): PinInstance[] => [
  { componentId: comp.id, pinIndex: 0, x: comp.x - 20, y: comp.y },
  { componentId: comp.id, pinIndex: 1, x: comp.x + 20, y: comp.y },
];

describe("hover_model", () => {
  it("detecta pines con radio configurable", () => {
    const r1 = component("R1", 0);

    expect(hitTestPin([r1], getPins, -20, 3, 6)?.pin.pinIndex).toBe(0);
    expect(hitTestPin([r1], getPins, -20, 7, 6)).toBeNull();
  });

  it("da prioridad a pin sobre componente y usa cursor de cableado", () => {
    const r1 = component("R1", 0);
    const activePin = getPins(r1)[1];

    const hover = resolveHoverState([r1], [], getPins, -20, 0, {
      activePinForWire: activePin,
      isDragging: false,
      simulationActive: false,
      pinThreshold: 8,
    });

    expect(hover.hoveredPin?.pinIndex).toBe(0);
    expect(hover.hoveredComponent).toBeNull();
    expect(hover.cursor).toBe("crosshair");
  });

  it("usa cursor pointer para switch activo durante simulacion", () => {
    const switchComponent = component("S1", 0, "switch");

    const hover = resolveHoverState([switchComponent], [], getPins, 0, 0, {
      activePinForWire: null,
      isDragging: false,
      simulationActive: true,
      pinThreshold: 4,
    });

    expect(hover.hoveredComponent).toBe(switchComponent);
    expect(hover.cursor).toBe("pointer");
  });

  it("detecta cable si no hay pin ni componente", () => {
    const wire: WireInstance = {
      id: "W1",
      from: { componentId: "R1", pinIndex: 0 },
      to: { componentId: "R2", pinIndex: 0 },
      points: [{ x: 0, y: 60 }, { x: 100, y: 60 }],
    };

    const hover = resolveHoverState([], [wire], getPins, 50, 63, {
      activePinForWire: null,
      isDragging: false,
      simulationActive: false,
      pinThreshold: 4,
    });

    expect(hover.hoveredWire).toBe(wire);
    expect(hover.cursor).toBe("pointer");
  });
});
