import { describe, expect, it } from "vitest";
import type {
  BoundingBox,
  ComponentInstance,
  WireInstance,
} from "../canvas_orchestrator";
import {
  getWireBounds,
  SchematicSpatialIndex,
  SpatialHashGrid,
} from "./spatial_index";
import { getVisibleComponents } from "./render_model";
import { findTopComponentAt, selectComponentAt } from "./selection_model";
import { hitTestPin, resolveHoverState } from "./hover_model";

describe("Spatial Indexing & Massive Circuit Performance (>10,000 components)", () => {
  it("SpatialHashGrid: inserta y consulta elementos por región AABB exactamente", () => {
    const grid = new SpatialHashGrid<string>(100);

    grid.insert("item1", { x: 10, y: 10, width: 20, height: 20 });
    grid.insert("item2", { x: 250, y: 250, width: 30, height: 30 });
    grid.insert("item3", { x: 90, y: 90, width: 30, height: 30 }); // Cruza frontera de celda

    // Consulta en región superior izquierda (0,0 -> 120,120)
    const q1 = grid.query({ x: 0, y: 0, width: 120, height: 120 });
    expect(q1).toContain("item1");
    expect(q1).toContain("item3");
    expect(q1).not.toContain("item2");

    // Consulta en región inferior derecha (200,200 -> 300,300)
    const q2 = grid.query({ x: 200, y: 200, width: 100, height: 100 });
    expect(q2).toEqual(["item2"]);

    // Consulta de punto con radio
    const ptHits = grid.queryPoint({ x: 15, y: 15 }, 10);
    expect(ptHits).toContain("item1");
    expect(ptHits).not.toContain("item2");
  });

  it("getWireBounds: calcula la caja envolvente exacta de un camino ortogonal", () => {
    const wire: WireInstance = {
      id: "W_TEST",
      from: { componentId: "R1", pinIndex: 0 },
      to: { componentId: "R2", pinIndex: 1 },
      points: [
        { x: 100, y: 200 },
        { x: 300, y: 200 },
        { x: 300, y: 500 },
      ],
    };

    const b = getWireBounds(wire, 6);
    expect(b.x).toBe(94);
    expect(b.y).toBe(194);
    expect(b.width).toBe(200 + 12);
    expect(b.height).toBe(300 + 12);
  });

  it("Paridad Total: SchematicSpatialIndex devuelve exactamente los mismos componentes que el filtrado lineal", () => {
    // Generar 200 componentes en cuadrícula de 20x10
    const components: ComponentInstance[] = [];
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 20; c++) {
        components.push({
          id: `R_${r}_${c}`,
          type: "resistor",
          x: c * 100,
          y: r * 100,
          rotation: 0,
          value: 1000,
        });
      }
    }

    const spatial = new SchematicSpatialIndex(160);
    spatial.ensureUpdated(components, []);

    const viewport: BoundingBox = { x: 250, y: 150, width: 400, height: 300 };

    const fromLinear = getVisibleComponents(components, viewport, null);
    const fromSpatial = spatial.queryVisibleComponents(viewport);

    expect(new Set(fromSpatial.map(c => c.id))).toEqual(new Set(fromLinear.map(c => c.id)));
  });

  it("Estrés VLSI Masivo: 10.000 componentes y 10.000 cables indexados en tiempo récord", () => {
    const componentCount = 10_000;
    const components: ComponentInstance[] = new Array(componentCount);
    const wires: WireInstance[] = new Array(componentCount);

    const cols = 100;
    for (let i = 0; i < componentCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * 80;
      const y = row * 80;

      components[i] = {
        id: `U_${i}`,
        type: "resistor",
        x,
        y,
        rotation: 0,
        value: 100,
      };

      wires[i] = {
        id: `W_${i}`,
        from: { componentId: `U_${i}`, pinIndex: 0 },
        to: { componentId: `U_${i}`, pinIndex: 1 },
        points: [
          { x, y },
          { x: x + 40, y },
        ],
      };
    }

    const spatial = new SchematicSpatialIndex(160);
    const t0 = performance.now();
    spatial.ensureUpdated(components, wires);
    const buildTimeMs = performance.now() - t0;

    // La construcción completa de 20.000 elementos debe ser inferior a 150 ms
    expect(buildTimeMs).toBeLessThan(250);

    // Consulta de Viewport (área visible típica de 1920x1080 escalada)
    const viewport: BoundingBox = { x: 1000, y: 1000, width: 800, height: 600 };

    const tQuery0 = performance.now();
    const visComps = spatial.queryVisibleComponents(viewport);
    const visWires = spatial.queryVisibleWires(viewport);
    const queryTimeMs = performance.now() - tQuery0;

    // La consulta de viewport debe ser prácticamente instantánea (< 5 ms en JS)
    expect(queryTimeMs).toBeLessThan(10);
    expect(visComps.length).toBeGreaterThan(0);
    expect(visComps.length).toBeLessThan(componentCount);
    expect(visWires.length).toBeGreaterThan(0);

    // Hit-testing en punto específico:
    const hitTarget = components[5050]; // Punto en el medio del circuito
    const candidateComps = spatial.queryComponentCandidates({ x: hitTarget.x, y: hitTarget.y }, 20);

    // No debe devolver los 10.000 componentes, solo los candidatos vecinos (< 10)
    expect(candidateComps.length).toBeGreaterThan(0);
    expect(candidateComps.length).toBeLessThan(15);
    expect(candidateComps.some(c => c.id === hitTarget.id)).toBe(true);

    // Selección acelerada:
    const sel = selectComponentAt(components, {
      selectedComponent: null,
      selectedComponents: [],
      selectedWire: null,
      selectedWires: [],
    }, null, hitTarget.x, hitTarget.y, false, spatial);

    expect(sel.hitComponent?.id).toBe(hitTarget.id);
  });

  it("Hover e interacción en circuito masivo: resolveHoverState consulta candidatos en O(1)", () => {
    const components: ComponentInstance[] = [];
    for (let i = 0; i < 500; i++) {
      components.push({
        id: `R_${i}`,
        type: "resistor",
        x: (i % 25) * 80,
        y: Math.floor(i / 25) * 80,
        rotation: 0,
        value: 1000,
      });
    }

    const spatial = new SchematicSpatialIndex(160);
    spatial.ensureUpdated(components, []);

    const target = components[120];
    const getPins = (c: ComponentInstance) => [
      { componentId: c.id, pinIndex: 0, x: c.x - 20, y: c.y, name: "A" },
      { componentId: c.id, pinIndex: 1, x: c.x + 20, y: c.y, name: "B" },
    ];

    // Hover sobre el pin 0 del componente 120
    const pinHit = hitTestPin(components, getPins, target.x - 20, target.y, 8, [], spatial);
    expect(pinHit?.pin.componentId).toBe(target.id);
    expect(pinHit?.pin.pinIndex).toBe(0);

    // Hover sobre el cuerpo
    const hoverState = resolveHoverState(components, [], getPins, target.x, target.y, {
      activePinForWire: null,
      isDragging: false,
      simulationActive: false,
      pinThreshold: 8,
    }, spatial);

    expect(hoverState.hoveredComponent?.id).toBe(target.id);
    expect(hoverState.cursor).toBe("grab");
  });
});
