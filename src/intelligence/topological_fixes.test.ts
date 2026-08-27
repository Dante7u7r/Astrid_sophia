import { describe, expect, it, vi } from "vitest";
import { applyTopologicalFix, type TopologicalFixAction } from "./topological_fixes";
import type { CanvasOrchestrator } from "../canvas_orchestrator";

describe("TopologicalFixes — Auto-Corrección en Lienzo", () => {
  function createMockOrchestrator() {
    const components: any[] = [];
    const wires: any[] = [];

    const mock = {
      components,
      wires,
      addComponent: vi.fn((type, x, y, value) => {
        const comp = { id: `${type}_${components.length + 1}`, type, x, y, value, pins: ["1", "2"] };
        components.push(comp);
        return comp;
      }),
      addWire: vi.fn((points, from, to) => {
        const wire = { id: `w_${wires.length + 1}`, points, from, to };
        wires.push(wire);
        return wire;
      }),
      getComponentPins: vi.fn((comp) => [
        { x: comp.x - 20, y: comp.y },
        { x: comp.x + 20, y: comp.y },
      ]),
      syncWireConnections: vi.fn(),
      render: vi.fn(),
    } as unknown as CanvasOrchestrator;

    return { mock, components, wires };
  }

  it("inserta una referencia de tierra GND con auto-posicionamiento", () => {
    const { mock, components } = createMockOrchestrator();
    const action: TopologicalFixAction = { type: "add_ground" };

    const success = applyTopologicalFix(mock, action);
    expect(success).toBe(true);
    expect(mock.addComponent).toHaveBeenCalledWith("ground", expect.any(Number), expect.any(Number), 0);
    expect(components.some((c) => c.type === "ground")).toBe(true);
    expect(mock.render).toHaveBeenCalled();
  });

  it("inserta un diodo flyback en paralelo con un inductor conmutado", () => {
    const { mock, components, wires } = createMockOrchestrator();
    // Añadir inductor
    mock.addComponent("inductor", 200, 200, 10e-3);

    const indId = components[0].id;
    const action: TopologicalFixAction = {
      type: "add_flyback_diode",
      inductorId: indId,
      anodeNode: "1",
      cathodeNode: "2",
    };

    const success = applyTopologicalFix(mock, action);
    expect(success).toBe(true);
    expect(components.some((c) => c.type === "diode")).toBe(true);
    expect(wires.length).toBe(2);
    expect(mock.syncWireConnections).toHaveBeenCalled();
  });

  it("inserta un condensador de desacoplo de 100 nF", () => {
    const { mock, components } = createMockOrchestrator();
    const action: TopologicalFixAction = {
      type: "add_decoupling_cap",
      vccNode: "vcc",
      gndNode: "0",
      capacitanceFarads: 100e-9,
    };

    const success = applyTopologicalFix(mock, action);
    expect(success).toBe(true);
    const cap = components.find((c) => c.type === "capacitor");
    expect(cap).toBeDefined();
    expect(cap?.value).toBe(100e-9);
  });

  it("inserta una resistencia de pull-up de 10 kΩ", () => {
    const { mock, components } = createMockOrchestrator();
    const action: TopologicalFixAction = {
      type: "add_pullup_resistor",
      pinNode: "data_line",
      vccNode: "vcc",
      resistanceOhms: 10000,
    };

    const success = applyTopologicalFix(mock, action);
    expect(success).toBe(true);
    const res = components.find((c) => c.type === "resistor");
    expect(res).toBeDefined();
    expect(res?.value).toBe(10000);
  });
});
