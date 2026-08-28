import { describe, expect, it } from "vitest";
import type { ComponentInstance, PinInstance, WireInstance } from "../canvas_orchestrator";
import {
  connectPins,
  connectPinToWire,
  dragJunctionNode,
  dragWireSegment,
  dragWireVertex,
  findConnectedWireIds,
  findHoveredWire,
  findWireJunctionPoints,
  findWireSegmentIntersection,
  mergeCollinearWiresAtJunction,
  splitWireAtPoint,
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

    const getPins = (c: ComponentInstance): PinInstance[] => [
      { componentId: c.id, pinIndex: 0, x: c.x, y: c.y, label: "1" },
    ];

    syncWireConnections(components, wires, getPins, (start, end) => [{ x: start.x, y: start.y }, { x: end.x, y: end.y }]);

    expect(wires[0].points).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  });

  it("resalta toda la red conectada (Net Highlighting) y detecta empalmes T-Junction", () => {
    const w1: WireInstance = { id: "W1", from: { componentId: "R1", pinIndex: 0 }, to: { componentId: "R2", pinIndex: 0 }, points: [{ x: 0, y: 0 }, { x: 50, y: 0 }] };
    const w2: WireInstance = { id: "W2", from: { componentId: "R2", pinIndex: 0 }, to: { componentId: "R3", pinIndex: 0 }, points: [{ x: 50, y: 0 }, { x: 100, y: 0 }] };
    const w3: WireInstance = { id: "W3", from: { componentId: "C1", pinIndex: 0 }, to: { componentId: "R2", pinIndex: 0 }, points: [{ x: 50, y: 50 }, { x: 50, y: 0 }] };

    const wires = [w1, w2, w3];
    const connected = findConnectedWireIds(wires, "W1");

    expect(connected.has("W1")).toBe(true);
    expect(connected.has("W2")).toBe(true);
    expect(connected.has("W3")).toBe(true);

    const junctions = findWireJunctionPoints(wires);
    expect(junctions).toHaveLength(1);
    expect(junctions[0]).toEqual({ x: 50, y: 0 });
  });

  it("detecta interseccion sobre segmento de cable para derivacion en T", () => {
    const wire: WireInstance = {
      id: "W1",
      from: { componentId: "R1", pinIndex: 0 },
      to: { componentId: "R2", pinIndex: 0 },
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    };

    const hit = findWireSegmentIntersection([wire], { x: 50, y: 2 }, 6);
    expect(hit).not.toBeNull();
    expect(hit?.wire.id).toBe("W1");
    expect(hit?.snapPoint).toEqual({ x: 50, y: 0 });
  });

  it("divide un cable en dos segmentos conectados al nodo de union intermedio", () => {
    const wire: WireInstance = {
      id: "wire_R1_p0_to_R2_p0",
      from: { componentId: "R1", pinIndex: 0 },
      to: { componentId: "R2", pinIndex: 0 },
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    };

    const [wireA, wireB] = splitWireAtPoint(wire, { x: 40, y: 0 });

    expect(wireA.from).toEqual({ componentId: "R1", pinIndex: 0 });
    expect(wireA.to.isJunction).toBe(true);
    expect(wireA.to.junctionPos).toEqual({ x: 40, y: 0 });

    expect(wireB.from.isJunction).toBe(true);
    expect(wireB.from.junctionPos).toEqual({ x: 40, y: 0 });
    expect(wireB.to).toEqual({ componentId: "R2", pinIndex: 0 });
  });

  it("conecta un pin a un cable existente creando una T-Junction de 3 ramas", () => {
    const wires: WireInstance[] = [{
      id: "W_MAIN",
      from: { componentId: "R1", pinIndex: 0 },
      to: { componentId: "R2", pinIndex: 0 },
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    }];

    const fromPin = { componentId: "C1", pinIndex: 0 };
    const ok = connectPinToWire(wires, fromPin, wires[0], { x: 50, y: 0 });

    expect(ok).toBe(true);
    expect(wires).toHaveLength(3); // wireA, wireB, wireC
    expect(wires.some(w => w.from.componentId === "C1" && w.to.isJunction)).toBe(true);

    const junctions = findWireJunctionPoints(wires);
    expect(junctions).toHaveLength(1);
    expect(junctions[0]).toEqual({ x: 50, y: 0 });
  });

  it("fusiona cables colineales al quedar solo dos en una union (auto-healing)", () => {
    const junctionPos = { x: 50, y: 0 };
    const junctionEp = { componentId: "junction_50_0", pinIndex: 0, isJunction: true, junctionPos };

    const w1: WireInstance = {
      id: "W1",
      from: { componentId: "R1", pinIndex: 0 },
      to: { ...junctionEp },
      points: [{ x: 0, y: 0 }, { x: 50, y: 0 }],
    };
    const w2: WireInstance = {
      id: "W2",
      from: { ...junctionEp },
      to: { componentId: "R2", pinIndex: 0 },
      points: [{ x: 50, y: 0 }, { x: 100, y: 0 }],
    };

    const wires = [w1, w2];
    const healed = mergeCollinearWiresAtJunction(wires, "junction:50_0");

    expect(healed).toBe(true);
    expect(wires).toHaveLength(1);
    expect(wires[0].from).toEqual({ componentId: "R1", pinIndex: 0 });
    expect(wires[0].to).toEqual({ componentId: "R2", pinIndex: 0 });
    expect(wires[0].points).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  });

  it("permite conectar cables iniciando desde una union hacia un pin fisico", () => {
    const junctionPos = { x: 50, y: 50 };
    const junctionEp = { componentId: "junction_50_50", pinIndex: 0, isJunction: true, junctionPos };
    const targetPin = { componentId: "R3", pinIndex: 0 };

    const wires: WireInstance[] = [];
    const connected = connectPins(wires, junctionEp, targetPin);

    expect(connected).toBe(true);
    expect(wires).toHaveLength(1);
    expect(wires[0].from.isJunction).toBe(true);
    expect(wires[0].to.componentId).toBe("R3");

    // Evitar duplicados
    expect(connectPins(wires, junctionEp, targetPin)).toBe(false);
  });

  it("permite conectar dos uniones distintas entre si", () => {
    const j1 = { componentId: "junction_0_0", pinIndex: 0, isJunction: true, junctionPos: { x: 0, y: 0 } };
    const j2 = { componentId: "junction_100_100", pinIndex: 0, isJunction: true, junctionPos: { x: 100, y: 100 } };

    const wires: WireInstance[] = [];
    expect(connectPins(wires, j1, j2)).toBe(true);
    expect(wires).toHaveLength(1);

    // No permitir autocableado de la misma union
    expect(connectPins(wires, j1, j1)).toBe(false);
  });

  it("arrastra un nodo de union actualizando coordinadamente todos los cables conectados", () => {
    const oldJunctionPos = { x: 50, y: 50 };
    const junctionEp = { componentId: "junction_50_50", pinIndex: 0, isJunction: true, junctionPos: { ...oldJunctionPos } };

    const w1: WireInstance = {
      id: "wire_R1_p0_to_j_50_50",
      from: { componentId: "R1", pinIndex: 0 },
      to: { ...junctionEp },
      points: [{ x: 0, y: 50 }, { x: 50, y: 50 }],
    };
    const w2: WireInstance = {
      id: "wire_j_50_50_to_R2_p0",
      from: { ...junctionEp },
      to: { componentId: "R2", pinIndex: 0 },
      points: [{ x: 50, y: 50 }, { x: 100, y: 50 }],
    };
    const w3: WireInstance = {
      id: "wire_C1_p0_to_j_50_50",
      from: { componentId: "C1", pinIndex: 0 },
      to: { ...junctionEp },
      points: [{ x: 50, y: 0 }, { x: 50, y: 50 }],
    };

    const wires = [w1, w2, w3];
    const newJunctionPos = { x: 60, y: 80 };

    dragJunctionNode(wires, oldJunctionPos, newJunctionPos);

    expect(w1.to.junctionPos).toEqual({ x: 60, y: 80 });
    expect(w1.points[1]).toEqual({ x: 60, y: 80 });

    expect(w2.from.junctionPos).toEqual({ x: 60, y: 80 });
    expect(w2.points[0]).toEqual({ x: 60, y: 80 });

    expect(w3.to.junctionPos).toEqual({ x: 60, y: 80 });
    expect(w3.points[1]).toEqual({ x: 60, y: 80 });
  });

  it("arrastra un segmento recto de 2 puntos sin desconectar los pines de anclaje (dog-leg)", () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const dragged = dragWireSegment(pts, 0, 0, 40);

    // Los extremos deben permanecer estrictamente intactos en sus pines
    expect(dragged[0]).toEqual({ x: 0, y: 0 });
    expect(dragged[dragged.length - 1]).toEqual({ x: 100, y: 0 });
    // Debe haber insertado esquinas a y = 40
    expect(dragged).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 40 },
      { x: 100, y: 40 },
      { x: 100, y: 0 },
    ]);
  });

  it("arrastra un segmento intermedio conservando intactos los terminales", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 60 },
      { x: 100, y: 60 },
    ];
    // Arrastrar el segmento vertical intermedio (index 1) horizontalmente
    const dragged = dragWireSegment(pts, 1, 20, 0);

    expect(dragged[0]).toEqual({ x: 0, y: 0 });
    expect(dragged[dragged.length - 1]).toEqual({ x: 100, y: 60 });
    expect(dragged[1].x).toBe(60);
    expect(dragged[2].x).toBe(60);
  });

  it("arrastra un vertice interior ajustando vecinos ortogonalmente sin soltar los pines", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
    ];
    const dragged = dragWireVertex(pts, 1, { x: 60, y: 10 });

    expect(dragged[0]).toEqual({ x: 0, y: 0 });
    expect(dragged[dragged.length - 1]).toEqual({ x: 50, y: 50 });
  });

  it("auto-enruta y sigue elasticamente a los componentes cuando se mueven (rubber-banding)", () => {
    const r1 = component("R1", 0);
    const r2 = component("R2", 100);
    const wires: WireInstance[] = [{
      id: "W1",
      from: { componentId: "R1", pinIndex: 0 },
      to: { componentId: "R2", pinIndex: 0 },
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    }];

    const getPins = (c: ComponentInstance): PinInstance[] => [
      { componentId: c.id, pinIndex: 0, x: c.x, y: c.y, label: "1" },
    ];

    // Mover R1 a otra posicion
    r1.x = -80;
    r1.y = 60;

    syncWireConnections(
      [r1, r2],
      wires,
      getPins,
      (start, end) => [
        { x: start.x, y: start.y },
        { x: (start.x + end.x) / 2, y: start.y },
        { x: (start.x + end.x) / 2, y: end.y },
        { x: end.x, y: end.y },
      ],
    );

    expect(wires[0].points[0]).toEqual({ x: -80, y: 60 });
    expect(wires[0].points[wires[0].points.length - 1]).toEqual({ x: 100, y: 0 });
  });
});
