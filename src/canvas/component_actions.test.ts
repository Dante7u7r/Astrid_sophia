import { describe, expect, it } from "vitest";
import type { ComponentInstance, WireInstance } from "../canvas_orchestrator";
import {
  createComponent,
  duplicateSelection,
  mirrorSelection,
  removeSelection,
  renameComponentInCircuit,
  rotateSelection,
} from "./component_actions";

function component(id: string, type: ComponentInstance["type"] = "resistor"): ComponentInstance {
  return { id, type, value: 1, x: 0, y: 0, rotation: 0 };
}

describe("component_actions", () => {
  it("crea componentes especiales con valores iniciales validos", () => {
    expect(createComponent([], "dmm", 3, 8, "R", Math.round)).toMatchObject({
      id: "DMM1",
      value: "R",
      dmmValue: "OPEN",
      x: 3,
      y: 8,
    });
    expect(createComponent([], "switch", 0, 0, 1, Math.round)).toMatchObject({
      switchState: false,
      switchRon: 0.01,
      switchRoff: 1e9,
      switchVth: 0.5,
      switchVh: 0.05,
    });
    expect(createComponent([], "mcu_avr", 0, 0, 0, Math.round).mcuClockSpeed).toBe(16e6);
  });

  it("renombra componentes y actualiza IDs de cables", () => {
    const r1 = component("R1");
    const r2 = component("R2");
    const wires: WireInstance[] = [{
      id: "old",
      from: { componentId: "R1", pinIndex: 0 },
      to: { componentId: "R2", pinIndex: 1 },
      points: [],
    }];

    expect(renameComponentInCircuit([r1, r2], wires, r1, "Ra")).toBeNull();
    expect(r1.id).toBe("Ra");
    expect(wires[0].from.componentId).toBe("Ra");
    expect(wires[0].id).toBe("wire_Ra_p0_to_R2_p1");
  });

  it("rechaza IDs invalidos o duplicados al renombrar", () => {
    const r1 = component("R1");
    const r2 = component("R2");

    expect(renameComponentInCircuit([r1, r2], [], r1, "1R")).toContain("identificador");
    expect(renameComponentInCircuit([r1, r2], [], r1, "r2")).toContain("ya existe");
    expect(r1.id).toBe("R1");
  });

  it("rota y espeja la seleccion activa", () => {
    const r1 = component("R1");
    const r2 = component("R2");

    rotateSelection([r1, r2], null, -90);
    mirrorSelection([r1, r2], null);

    expect(r1.rotation).toBe(270);
    expect(r2.rotation).toBe(270);
    expect(r1.mirror).toBe(true);
    expect(r2.mirror).toBe(true);
  });

  it("duplica una seleccion multiple y mueve el foco a los clones", () => {
    const source = component("R1");
    source.selected = true;
    const created: ComponentInstance[] = [];
    const result = duplicateSelection([source], null, (type, x, y, value) => {
      const clone = { id: `R${created.length + 2}`, type, value, x, y, rotation: 0 };
      created.push(clone);
      return clone;
    });

    expect(source.selected).toBe(false);
    expect(result.selectedComponent).toBeNull();
    expect(result.selectedComponents).toHaveLength(1);
    expect(result.selectedComponents[0]).toMatchObject({ id: "R2", selected: true, x: 40, y: 40 });
  });

  it("borra cable seleccionado sin tocar componentes", () => {
    const r1 = component("R1");
    const wire: WireInstance = {
      id: "W1",
      from: { componentId: "R1", pinIndex: 0 },
      to: { componentId: "R2", pinIndex: 0 },
      points: [],
    };

    const result = removeSelection([r1], [wire], wire, [], null);

    expect(result.components).toEqual([r1]);
    expect(result.wires).toEqual([]);
    expect(result.selectedWire).toBeNull();
  });

  it("borra componentes seleccionados y sus cables", () => {
    const r1 = component("R1");
    const r2 = component("R2");
    const wire: WireInstance = {
      id: "W1",
      from: { componentId: "R1", pinIndex: 0 },
      to: { componentId: "R2", pinIndex: 0 },
      points: [],
    };

    const result = removeSelection([r1, r2], [wire], null, [r1], null);

    expect(result.components).toEqual([r2]);
    expect(result.wires).toEqual([]);
    expect(result.selectedComponent).toBeNull();
    expect(result.selectedComponents).toEqual([]);
  });
});
