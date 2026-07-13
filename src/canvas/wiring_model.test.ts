import { describe, expect, it } from "vitest";
import type { ComponentInstance, PinInstance, WireInstance } from "../canvas_orchestrator";
import {
  connectPins,
  findHoveredWire,
  syncWireConnections,
  wireExists,
  wirePathIntersects,
} from "./wiring_model";

function component(id: string, x: number): ComponentInstance {
  return { id, type: "resistor", value: 1, x, y: 0, rotation: 0 };
}

describe("wiring_model", () => {
  it("detecta interseccion por bounding box de ruta", () => {
    expect(wirePathIntersects(
      [{ x: -100, y: 0 }, { x: 100, y: 0 }],
      { x: -10, y: -10, width: 20, height: 20 },
    )).toBe(true);
  });

  it("detecta hover sobre segmentos ortogonales", () => {
    const wire: WireInstance = {
      id: "W1",
      from: { componentId: "R1", pinIndex: 0 },
      to: { componentId: "R2", pinIndex: 0 },
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }],
    };

    expect(findHoveredWire([wire], 50, 4)).toBe(wire);
    expect(findHoveredWire([wire], 96, 40)).toBe(wire);
    expect(findHoveredWire([wire], 50, 20)).toBeNull();
  });

  it("crea cables sin duplicados ni autoconnexiones", () => {
    const wires: WireInstance[] = [];
    const from = { componentId: "R1", pinIndex: 0 };
    const to = { componentId: "R2", pinIndex: 1 };

    expect(connectPins(wires, from, to)).toBe(true);
    expect(wireExists(wires, from, to)).toBe(true);
    expect(connectPins(wires, to, from)).toBe(false);
    expect(connectPins(wires, from, { componentId: "R1", pinIndex: 1 })).toBe(false);
    expect(wires).toHaveLength(1);
  });

  it("sincroniza puntos de cable desde pines resueltos", () => {
    const components = [component("R1", 0), component("R2", 100)];
    const wires: WireInstance[] = [{
      id: "W1",
      from: { componentId: "R1", pinIndex: 0 },
      to: { componentId: "R2", pinIndex: 0 },
      points: [],
    }];
    const getPins = (comp: ComponentInstance): PinInstance[] => [
      { componentId: comp.id, pinIndex: 0, x: comp.x, y: comp.y },
    ];

    syncWireConnections(components, wires, getPins, (start, end) => [start, end]);

    expect(wires[0].points).toEqual([{ componentId: "R1", pinIndex: 0, x: 0, y: 0 }, { componentId: "R2", pinIndex: 0, x: 100, y: 0 }]);
  });
});
