import { describe, expect, it } from "vitest";
import type { ComponentInstance, WireInstance } from "../canvas_orchestrator";
import {
  pointToSegmentDistance,
  runCircuitDRC,
  segmentToBoxDistance,
  segmentToSegmentDistance,
  segmentsIntersect,
} from "./drc_engine";

describe("drc_engine", () => {
  it("calcula distancias geométricas exactas punto-segmento y segmento-segmento", () => {
    const s1a = { x: 0, y: 0 };
    const s1b = { x: 100, y: 0 };

    // Punto sobre la perpendicular
    expect(pointToSegmentDistance({ x: 50, y: 30 }, s1a, s1b)).toBeCloseTo(30, 4);

    // Punto más allá de los extremos
    expect(pointToSegmentDistance({ x: 140, y: 30 }, s1a, s1b)).toBeCloseTo(50, 4);

    // Dos segmentos paralelos separados por 25px
    const s2a = { x: 0, y: 25 };
    const s2b = { x: 100, y: 25 };
    expect(segmentToSegmentDistance(s1a, s1b, s2a, s2b)).toBeCloseTo(25, 4);

    // Dos segmentos perpendiculares que se cruzan
    const s3a = { x: 50, y: -20 };
    const s3b = { x: 50, y: 20 };
    expect(segmentsIntersect(s1a, s1b, s3a, s3b)).toBe(true);
    expect(segmentToSegmentDistance(s1a, s1b, s3a, s3b)).toBe(0);
  });

  it("calcula la distancia de un segmento a un BoundingBox", () => {
    const box = { x: 40, y: 40, width: 40, height: 40 };

    // Segmento horizontal pasando a 10px por arriba
    const p1 = { x: 0, y: 30 };
    const p2 = { x: 100, y: 30 };
    expect(segmentToBoxDistance(p1, p2, box)).toBeCloseTo(10, 4);

    // Segmento que penetra el box
    const p3 = { x: 0, y: 50 };
    const p4 = { x: 100, y: 50 };
    expect(segmentToBoxDistance(p3, p4, box)).toBe(0);
  });

  it("aprueba un circuito limpio sin violaciones DRC", () => {
    const components: ComponentInstance[] = [
      {
        id: "R1",
        type: "resistor",
        x: 40,
        y: 40,
        rotation: 0,
        value: 1000,
      },
      {
        id: "R2",
        type: "resistor",
        x: 140,
        y: 40,
        rotation: 0,
        value: 2000,
      },
    ];

    const wires: WireInstance[] = [
      {
        id: "wire1",
        label: "NET1",
        from: { componentId: "R1", pinIndex: 1 },
        to: { componentId: "R2", pinIndex: 0 },
        points: [
          { x: 60, y: 40 },
          { x: 120, y: 40 },
        ],
        layer: "top",
      },
      {
        id: "wire2",
        label: "NET2",
        from: { componentId: "R2", pinIndex: 1 },
        to: { componentId: "GND", pinIndex: 0 },
        points: [
          { x: 160, y: 40 },
          { x: 200, y: 40 },
        ],
        layer: "top",
      },
    ];

    const report = runCircuitDRC(components, wires, {
      minWireSpacing: 15,
      minComponentSpacing: 10,
    });

    expect(report.clean).toBe(true);
    expect(report.errorCount).toBe(0);
    expect(report.violations.length).toBe(0);
  });

  it("detecta violación de espaciado (WIRE_CLEARANCE) entre cables de diferente red", () => {
    const components: ComponentInstance[] = [];
    const wires: WireInstance[] = [
      {
        id: "wireA",
        label: "NET_A",
        from: { componentId: "U1", pinIndex: 0 },
        to: { componentId: "U2", pinIndex: 0 },
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        layer: "top",
      },
      {
        id: "wireB",
        label: "NET_B",
        from: { componentId: "U3", pinIndex: 0 },
        to: { componentId: "U4", pinIndex: 0 },
        points: [
          { x: 0, y: 8 }, // Solo 8px de separación (regla min: 20px)
          { x: 100, y: 8 },
        ],
        layer: "top",
      },
    ];

    const report = runCircuitDRC(components, wires, { minWireSpacing: 20 });

    expect(report.clean).toBe(false);
    expect(report.errorCount).toBeGreaterThan(0);
    expect(report.violations.some((v) => v.type === "WIRE_CLEARANCE")).toBe(true);
  });

  it("detecta cruces no aislados (UNRESOLVED_CROSSING) en la misma capa", () => {
    const components: ComponentInstance[] = [];
    const wires: WireInstance[] = [
      {
        id: "w_horiz",
        label: "NET_H",
        from: { componentId: "U1", pinIndex: 0 },
        to: { componentId: "U2", pinIndex: 0 },
        points: [
          { x: 0, y: 50 },
          { x: 100, y: 50 },
        ],
        layer: "top",
      },
      {
        id: "w_vert",
        label: "NET_V",
        from: { componentId: "U3", pinIndex: 0 },
        to: { componentId: "U4", pinIndex: 0 },
        points: [
          { x: 50, y: 0 },
          { x: 50, y: 100 },
        ],
        layer: "top",
      },
    ];

    const report = runCircuitDRC(components, wires, { checkUnresolvedCrossings: true });

    expect(report.clean).toBe(false);
    expect(report.violations.some((v) => v.type === "UNRESOLVED_CROSSING")).toBe(true);
  });

  it("detecta invasión de margen de componente (COMPONENT_CLEARANCE)", () => {
    const components: ComponentInstance[] = [
      {
        id: "IC1",
        type: "logic_ic_dip",
        x: 50,
        y: 50,
        rotation: 0,
      },
    ];

    // Cable no conectado que pasa rozando el cuerpo de IC1 a 2px
    const wires: WireInstance[] = [
      {
        id: "wire_stray",
        label: "NET_STRAY",
        from: { componentId: "OTHER1", pinIndex: 0 },
        to: { componentId: "OTHER2", pinIndex: 0 },
        points: [
          { x: 0, y: 48 },
          { x: 120, y: 48 },
        ],
        layer: "top",
      },
    ];

    const report = runCircuitDRC(components, wires, { minComponentSpacing: 10 });

    expect(report.clean).toBe(false);
    expect(report.violations.some((v) => v.type === "COMPONENT_CLEARANCE")).toBe(true);
  });

  it("detecta violaciones de espaciado de vías (VIA_CLEARANCE)", () => {
    const components: ComponentInstance[] = [];
    const wires: WireInstance[] = [
      {
        id: "wire_via1",
        label: "NET_1",
        from: { componentId: "U1", pinIndex: 0 },
        to: { componentId: "U2", pinIndex: 0 },
        points: [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
        ],
        vias: [{ x: 40, y: 0, fromLayer: "top", toLayer: "bottom" }],
      },
      {
        id: "wire_via2",
        label: "NET_2",
        from: { componentId: "U3", pinIndex: 0 },
        to: { componentId: "U4", pinIndex: 0 },
        points: [
          { x: 0, y: 10 },
          { x: 40, y: 10 },
        ],
        vias: [{ x: 40, y: 10, fromLayer: "top", toLayer: "bottom" }], // Separadas solo 10px (regla: 20px)
      },
    ];

    const report = runCircuitDRC(components, wires, { minViaSpacing: 20 });

    expect(report.clean).toBe(false);
    expect(report.violations.some((v) => v.type === "VIA_CLEARANCE")).toBe(true);
  });
});
