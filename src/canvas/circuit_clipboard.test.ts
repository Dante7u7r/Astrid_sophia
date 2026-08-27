import { describe, expect, it, vi } from "vitest";
import type { ComponentInstance, WireInstance } from "../canvas_orchestrator";
import {
  createClipboardPayload,
  getInternalWiresForComponents,
  getSelectedComponentsForClipboard,
  pasteClipboardPayload,
  CircuitClipboard,
} from "./circuit_clipboard";

describe("circuit_clipboard", () => {
  it("obtiene los componentes seleccionados adecuadamente", () => {
    const comp1: ComponentInstance = { id: "R1", type: "resistor", x: 100, y: 100, value: 1000, rotation: 0 };
    const comp2: ComponentInstance = { id: "C1", type: "capacitor", x: 200, y: 100, value: 1e-6, rotation: 0 };

    expect(getSelectedComponentsForClipboard(comp1, [])).toEqual([comp1]);
    expect(getSelectedComponentsForClipboard(null, [comp1, comp2])).toEqual([comp1, comp2]);
    expect(getSelectedComponentsForClipboard(null, [])).toEqual([]);
  });

  it("filtra cables internos exclusivamente entre componentes seleccionados", () => {
    const r1: ComponentInstance = { id: "R1", type: "resistor", x: 100, y: 100, value: 1000, rotation: 0 };
    const c1: ComponentInstance = { id: "C1", type: "capacitor", x: 200, y: 100, value: 1e-6, rotation: 0 };
    const l1: ComponentInstance = { id: "L1", type: "inductor", x: 300, y: 100, value: 1e-3, rotation: 0 };

    const wireInternal: WireInstance = {
      id: "w1",
      points: [{ x: 140, y: 100 }, { x: 180, y: 100 }],
      from: { componentId: "R1", pinIndex: 1 },
      to: { componentId: "C1", pinIndex: 0 },
    };
    const wireExternal: WireInstance = {
      id: "w2",
      points: [{ x: 220, y: 100 }, { x: 280, y: 100 }],
      from: { componentId: "C1", pinIndex: 1 },
      to: { componentId: "L1", pinIndex: 0 },
    };

    const internal = getInternalWiresForComponents([r1, c1], [wireInternal, wireExternal]);
    expect(internal).toEqual([wireInternal]);
  });

  it("crea un payload con anclaje relativo y propiedades completas", () => {
    const r1: ComponentInstance = {
      id: "R1",
      type: "resistor",
      x: 100,
      y: 120,
      value: 4700,
      rotation: 90,
      label: "R_PULLUP",
    };
    const c1: ComponentInstance = {
      id: "C1",
      type: "capacitor",
      x: 180,
      y: 120,
      value: 10e-6,
      rotation: 0,
    };
    const wire: WireInstance = {
      id: "w1",
      points: [{ x: 100, y: 160 }, { x: 180, y: 120 }],
      from: { componentId: "R1", pinIndex: 1 },
      to: { componentId: "C1", pinIndex: 0 },
    };

    const payload = createClipboardPayload([r1, c1], [wire]);
    expect(payload).not.toBeNull();
    expect(payload!.anchor).toEqual({ x: 100, y: 120 });
    expect(payload!.components).toHaveLength(2);
    expect(payload!.components[0].x).toBe(0);
    expect(payload!.components[0].y).toBe(0);
    expect(payload!.components[0].properties.label).toBe("R_PULLUP");
    expect(payload!.components[1].x).toBe(80);
    expect(payload!.components[1].y).toBe(0);
    expect(payload!.wires).toHaveLength(1);
    expect(payload!.wires[0].fromComponentIndex).toBe(0);
    expect(payload!.wires[0].toComponentIndex).toBe(1);
  });

  it("pega el payload en una posición destino dada recalculando cables y nuevos IDs", () => {
    const r1: ComponentInstance = { id: "R1", type: "resistor", x: 100, y: 100, value: 1000, rotation: 0 };
    const c1: ComponentInstance = { id: "C1", type: "capacitor", x: 200, y: 100, value: 1e-6, rotation: 0 };
    const wire: WireInstance = {
      id: "w1",
      points: [{ x: 140, y: 100 }, { x: 180, y: 100 }],
      from: { componentId: "R1", pinIndex: 1 },
      to: { componentId: "C1", pinIndex: 0 },
    };

    const payload = createClipboardPayload([r1, c1], [wire]);
    let idCounter = 2;
    const addComponent = vi.fn((type, x, y, value) => {
      const comp: ComponentInstance = {
        id: `${type === "resistor" ? "R" : "C"}${idCounter++}`,
        type,
        x,
        y,
        value,
        rotation: 0,
      };
      return comp;
    });

    const result = pasteClipboardPayload(
      payload,
      addComponent,
      (c) => Math.round(c / 20) * 20,
      { x: 300, y: 400 },
    );

    expect(result).not.toBeNull();
    expect(result!.createdComponents).toHaveLength(2);
    expect(result!.createdComponents[0].x).toBe(300);
    expect(result!.createdComponents[0].y).toBe(400);
    expect(result!.createdComponents[1].x).toBe(400);
    expect(result!.createdComponents[1].y).toBe(400);

    expect(result!.createdWires).toHaveLength(1);
    const newWire = result!.createdWires[0];
    expect(newWire.from.componentId).toBe(result!.createdComponents[0].id);
    expect(newWire.to.componentId).toBe(result!.createdComponents[1].id);
    expect(newWire.points[0]).toEqual({ x: 340, y: 400 });
    expect(newWire.points[1]).toEqual({ x: 380, y: 400 });
  });

  it("CircuitClipboard maneja el ciclo de vida de copiar, cortar y pegar en el orquestador", () => {
    const clipboard = new CircuitClipboard();
    const compR1: ComponentInstance = { id: "R1", type: "resistor", x: 100, y: 100, value: 1000, rotation: 0 };
    const compC1: ComponentInstance = { id: "C1", type: "capacitor", x: 160, y: 100, value: 1e-6, rotation: 0 };
    const wire: WireInstance = {
      id: "w_test",
      points: [{ x: 140, y: 100 }, { x: 160, y: 100 }],
      from: { componentId: "R1", pinIndex: 1 },
      to: { componentId: "C1", pinIndex: 0 },
    };

    let nextId = 2;
    const mockOrchestrator: any = {
      components: [compR1, compC1],
      wires: [wire],
      selectedComponent: null,
      selectedComponents: [compR1, compC1],
      selectedWire: null,
      selectedWires: [],
      snapToGrid: (n: number) => Math.round(n / 20) * 20,
      addComponent: (type: ComponentInstance["type"], x: number, y: number, value: ComponentInstance["value"]) => {
        const c: ComponentInstance = {
          id: `${type === "resistor" ? "R" : "C"}${nextId++}`,
          type,
          x,
          y,
          value,
          rotation: 0,
        };
        mockOrchestrator.components.push(c);
        return c;
      },
      removeSelected: vi.fn(() => {
        mockOrchestrator.components = [];
        mockOrchestrator.wires = [];
        mockOrchestrator.selectedComponents = [];
      }),
      syncWireConnections: vi.fn(),
    };

    expect(clipboard.hasData()).toBe(false);

    // 1. Copiar
    const copied = clipboard.copy(mockOrchestrator);
    expect(copied).toBe(2);
    expect(clipboard.hasData()).toBe(true);

    // 2. Pegar
    const pasted = clipboard.paste(mockOrchestrator, { x: 400, y: 200 });
    expect(pasted).not.toBeNull();
    expect(pasted!.components).toHaveLength(2);
    expect(mockOrchestrator.components).toHaveLength(4);
    expect(mockOrchestrator.wires).toHaveLength(2);
    expect(mockOrchestrator.syncWireConnections).toHaveBeenCalled();
    expect(mockOrchestrator.selectedComponents).toHaveLength(2);

    // 3. Cortar
    mockOrchestrator.selectedComponents = [pasted!.components[0]];
    const cutCount = clipboard.cut(mockOrchestrator);
    expect(cutCount).toBe(1);
    expect(mockOrchestrator.removeSelected).toHaveBeenCalled();
  });
});
