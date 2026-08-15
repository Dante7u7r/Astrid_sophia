import { describe, expect, it } from "vitest";
import { getComponentPins } from "./component_pins";
import { getComponentBounds, getComponentLocalHalfExtents } from "./component_geometry";
import { drawComponentSymbol } from "./component_renderer";
import type { ComponentInstance } from "../canvas_orchestrator";

describe("Componentes extendidos y lógica digital", () => {
  it("calcula correctamente los 3 pines para compuertas lógicas AND, OR, NAND, NOR, XOR", () => {
    const gateTypes: ComponentInstance["type"][] = [
      "and_gate",
      "or_gate",
      "nand_gate",
      "nor_gate",
      "xor_gate",
    ];

    for (const type of gateTypes) {
      const comp: ComponentInstance = {
        id: "U1",
        type,
        value: 1,
        x: 100,
        y: 100,
        rotation: 0,
      };

      const pins = getComponentPins(comp);
      expect(pins).toHaveLength(3);
      expect(pins[0]).toMatchObject({ pinIndex: 0, x: 60, y: 90 });  // In A (-40, -10)
      expect(pins[1]).toMatchObject({ pinIndex: 1, x: 60, y: 110 }); // In B (-40, +10)
      expect(pins[2]).toMatchObject({ pinIndex: 2, x: 140, y: 100 }); // Out (+40, 0)
    }
  });

  it("calcula correctamente los 2 pines para el inversor NOT", () => {
    const comp: ComponentInstance = {
      id: "U_NOT",
      type: "not_gate",
      value: 1,
      x: 200,
      y: 200,
      rotation: 0,
    };

    const pins = getComponentPins(comp);
    expect(pins).toHaveLength(2);
    expect(pins[0]).toMatchObject({ pinIndex: 0, x: 160, y: 200 }); // In (-40, 0)
    expect(pins[1]).toMatchObject({ pinIndex: 1, x: 240, y: 200 }); // Out (+40, 0)
  });

  it("calcula correctamente los 4 pines de esquina para el Optoacoplador", () => {
    const comp: ComponentInstance = {
      id: "OK1",
      type: "opto",
      value: 1,
      x: 300,
      y: 300,
      rotation: 0,
    };

    const pins = getComponentPins(comp);
    expect(pins).toHaveLength(4);
    expect(pins[0]).toMatchObject({ pinIndex: 0, x: 260, y: 280 }); // Anode (-40, -20)
    expect(pins[1]).toMatchObject({ pinIndex: 1, x: 260, y: 320 }); // Cathode (-40, +20)
    expect(pins[2]).toMatchObject({ pinIndex: 2, x: 340, y: 280 }); // Collector (+40, -20)
    expect(pins[3]).toMatchObject({ pinIndex: 3, x: 340, y: 320 }); // Emitter (+40, +20)
  });

  it("calcula correctamente los 3 pines para JFET N y P", () => {
    const compN: ComponentInstance = {
      id: "J1",
      type: "njf",
      value: -2,
      x: 400,
      y: 400,
      rotation: 0,
    };

    const pins = getComponentPins(compN);
    expect(pins).toHaveLength(3);
    expect(pins[0]).toMatchObject({ pinIndex: 0, x: 360, y: 400 }); // Gate (-40, 0)
    expect(pins[1]).toMatchObject({ pinIndex: 1, x: 420, y: 360 }); // Drain (+20, -40)
    expect(pins[2]).toMatchObject({ pinIndex: 2, x: 420, y: 440 }); // Source (+20, +40)
  });

  it("asigna half-extents geométricos adecuados para selección y bounding box", () => {
    const gate: ComponentInstance = {
      id: "U1",
      type: "and_gate",
      value: 1,
      x: 0,
      y: 0,
      rotation: 0,
    };
    const extents = getComponentLocalHalfExtents(gate);
    expect(extents.halfW).toBe(45);
    expect(extents.halfH).toBe(30);

    const bounds = getComponentBounds(gate);
    expect(bounds.width).toBe(90);
    expect(bounds.height).toBe(60);
  });

  it("renderiza en Canvas 2D sin generar excepciones de contexto", () => {
    // Mock de CanvasRenderingContext2D
    const mockCtx = {
      save: () => {},
      restore: () => {},
      translate: () => {},
      rotate: () => {},
      scale: () => {},
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      arc: () => {},
      arcTo: () => {},
      quadraticCurveTo: () => {},
      rect: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      stroke: () => {},
      fill: () => {},
      fillText: () => {},
      measureText: () => ({ width: 20 }),
    } as unknown as CanvasRenderingContext2D;

    const componentsToTest: ComponentInstance["type"][] = [
      "and_gate",
      "or_gate",
      "not_gate",
      "nand_gate",
      "nor_gate",
      "xor_gate",
      "opto",
      "njf",
      "pjf",
      "net_label",
      "text_note",
    ];

    for (const type of componentsToTest) {
      const comp: ComponentInstance = {
        id: "TEST1",
        type,
        value: type === "text_note" ? "Nota de Test" : "NET_A",
        label: type === "text_note" ? "Nota de Test" : "NET_A",
        x: 0,
        y: 0,
        rotation: 0,
      };

      expect(() => {
        drawComponentSymbol(mockCtx, comp, false, false);
      }).not.toThrow();
    }
  });

  it("calcula correctamente pines y dimensiones para net_label y text_note", () => {
    const netLabelComp: ComponentInstance = {
      id: "NET1",
      type: "net_label",
      value: "CLK",
      label: "CLK",
      x: 100,
      y: 100,
      rotation: 0,
    };

    const netPins = getComponentPins(netLabelComp);
    expect(netPins).toHaveLength(1);
    expect(netPins[0]).toMatchObject({ pinIndex: 0, x: 100, y: 100 });

    const netBounds = getComponentBounds(netLabelComp);
    expect(netBounds.width).toBeGreaterThan(0);
    expect(netBounds.height).toBeGreaterThan(0);

    const textNoteComp: ComponentInstance = {
      id: "NOTE1",
      type: "text_note",
      value: "Titulo de Etapa\nSegunda linea",
      label: "Titulo de Etapa\nSegunda linea",
      x: 200,
      y: 200,
      rotation: 0,
    };

    const notePins = getComponentPins(textNoteComp);
    expect(notePins).toHaveLength(0); // Las notas no tienen pines

    const noteBounds = getComponentBounds(textNoteComp);
    expect(noteBounds.width).toBeGreaterThan(0);
    expect(noteBounds.height).toBeGreaterThan(0);
  });
});
