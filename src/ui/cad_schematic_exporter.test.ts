import { describe, expect, it } from "vitest";
import {
  buildCadSchematicSvg,
  type CadExportOptions,
} from "./cad_schematic_exporter";
import type { ComponentInstance, WireInstance } from "../canvas_orchestrator";

describe("cad_schematic_exporter", () => {
  it("genera un plano SVG vectorial limpio con capas y bloque de título ISO 7200", () => {
    const components: ComponentInstance[] = [
      {
        id: "V1",
        type: "vsource",
        value: 5,
        x: 100,
        y: 100,
        rotation: 0,
      },
      {
        id: "R1",
        type: "resistor",
        value: 1000,
        x: 200,
        y: 100,
        rotation: 0,
      },
      {
        id: "C1",
        type: "capacitor",
        value: "100n",
        x: 300,
        y: 100,
        rotation: 0,
      },
      {
        id: "GND1",
        type: "ground",
        value: 0,
        x: 100,
        y: 200,
        rotation: 0,
      },
      {
        id: "X1",
        type: "x",
        value: "LM741",
        modelName: "LM741",
        pinCount: 5,
        x: 400,
        y: 100,
        rotation: 0,
      },
    ];

    const wires: WireInstance[] = [
      {
        id: "W1",
        from: { componentId: "V1", pinIndex: 0 },
        to: { componentId: "R1", pinIndex: 0 },
        points: [
          { x: 100, y: 100 },
          { x: 200, y: 100 },
        ],
      },
      {
        id: "W2",
        from: { componentId: "R1", pinIndex: 1 },
        to: { componentId: "C1", pinIndex: 0 },
        points: [
          { x: 200, y: 100 },
          { x: 300, y: 100 },
        ],
      },
    ];

    const options: CadExportOptions = {
      theme: "print_clean",
      includeGrid: true,
      includeTitleBlock: true,
      includeNetLabels: true,
      titleBlockInfo: {
        title: "Filtro Pasa-Bajos Activo",
        author: "Dra. Sophia",
        organization: "Laboratorio CAD",
        revision: "2.1",
        date: "2026-08-15",
        sheet: "1 / 1",
      },
    };

    const { filename, content } = buildCadSchematicSvg(components, wires, options);

    expect(filename).toContain("filtro_pasa_bajos_activo_cad_print_clean.svg");
    expect(content).toContain("<svg");
    expect(content).toContain('id="layer-drawing-frame"');
    expect(content).toContain('id="layer-wires"');
    expect(content).toContain('id="layer-components"');
    expect(content).toContain('id="layer-title-block"');
    expect(content).toContain("Filtro Pasa-Bajos Activo");
    expect(content).toContain("Dra. Sophia");
    expect(content).toContain("REV 2.1");
    expect(content).toContain("LM741");
  });

  it("genera temas oscuros (cad_dark) y blueprint con paletas calibradas", () => {
    const components: ComponentInstance[] = [
      { id: "R1", type: "resistor", value: 470, x: 50, y: 50, rotation: 0 },
    ];
    const wires: WireInstance[] = [];

    const darkOptions: CadExportOptions = {
      theme: "cad_dark",
      includeGrid: false,
      includeTitleBlock: false,
      includeNetLabels: false,
      titleBlockInfo: {
        title: "Circuito Oscuro",
        author: "Dev",
        organization: "Astryd",
        revision: "1.0",
        date: "2026-08-15",
        sheet: "1 / 1",
      },
    };

    const darkRes = buildCadSchematicSvg(components, wires, darkOptions);
    expect(darkRes.content).toContain("#0D1117");

    const bpOptions: CadExportOptions = {
      ...darkOptions,
      theme: "blueprint",
    };
    const bpRes = buildCadSchematicSvg(components, wires, bpOptions);
    expect(bpRes.content).toContain("#0A2540");
  });
});
