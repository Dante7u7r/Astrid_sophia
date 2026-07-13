import { describe, expect, it } from "vitest";
import type { ComponentInstance, WireInstance } from "../canvas_orchestrator";
import {
  applyDrag,
  completeBoxSelection,
  createDragOffsets,
  selectComponentAt,
} from "./selection_model";

function component(partial: Partial<ComponentInstance> & Pick<ComponentInstance, "id" | "type">): ComponentInstance {
  return {
    value: 1,
    x: 0,
    y: 0,
    rotation: 0,
    ...partial,
  };
}

describe("selection_model", () => {
  it("selecciona el componente superior y soporta seleccion aditiva", () => {
    const r1 = component({ id: "R1", type: "resistor", x: 0, y: 0 });
    const r2 = component({ id: "R2", type: "resistor", x: 120, y: 0 });
    const baseState = { selectedComponent: null, selectedComponents: [], selectedWire: null };

    const first = selectComponentAt([r1, r2], baseState, null, 120, 0);
    expect(first.hitComponent).toBe(r2);
    expect(first.selectedComponent).toBe(r2);
    expect(first.selectedComponents).toEqual([r2]);

    const second = selectComponentAt([r1, r2], first, null, 0, 0, true);
    expect(second.selectedComponents).toEqual([r2, r1]);
    expect(second.selectedComponent).toBe(r1);
  });

  it("selecciona cable hover al hacer click en vacio sin shift", () => {
    const wire: WireInstance = {
      id: "W1",
      from: { componentId: "R1", pinIndex: 0 },
      to: { componentId: "R2", pinIndex: 0 },
      points: [],
    };

    const result = selectComponentAt([], {
      selectedComponent: component({ id: "R1", type: "resistor" }),
      selectedComponents: [],
      selectedWire: null,
    }, wire, 100, 100);

    expect(result.selectedComponent).toBeNull();
    expect(result.selectedComponents).toEqual([]);
    expect(result.selectedWire).toBe(wire);
  });

  it("completa box selection y descarta cajas demasiado pequenas", () => {
    const r1 = component({ id: "R1", type: "resistor", x: 0, y: 0 });
    const r2 = component({ id: "R2", type: "resistor", x: 200, y: 0 });

    expect(completeBoxSelection([r1, r2], { x: -50, y: -50 }, { x: 50, y: 50 })).toMatchObject({
      selectedComponent: r1,
      selectedComponents: [r1],
      selectedWire: null,
    });
    expect(completeBoxSelection([r1], { x: 0, y: 0 }, { x: 2, y: 2 })).toEqual({
      selectedComponent: null,
      selectedComponents: [],
      selectedWire: null,
    });
  });

  it("crea offsets y aplica drag con snap a rejilla", () => {
    const r1 = component({ id: "R1", type: "resistor", x: 20, y: 20 });
    const r2 = component({ id: "R2", type: "resistor", x: 60, y: 20 });
    const offsets = createDragOffsets([r1, r2], null, { x: 25, y: 25 });

    applyDrag([r1, r2], null, offsets.dragStartOffsets, offsets.dragStartOffset, { x: 54, y: 46 }, 20);

    expect(r1).toMatchObject({ x: 40, y: 40 });
    expect(r2).toMatchObject({ x: 80, y: 40 });
  });
});
