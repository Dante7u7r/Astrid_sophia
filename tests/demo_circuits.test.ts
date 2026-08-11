import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { getComponentBounds } from "../src/canvas/component_geometry";
import { getComponentPins } from "../src/canvas/component_pins";
import { parseCircuitFile, type CircuitFileData } from "../src/persistence/circuit_file";
import { extractElectricalNetlist } from "../src/simulation/netlist_extractor";
import { runElectricalRuleCheck } from "../src/simulation/simulation_dispatcher";

const DEMO_FILES = [
  "01_filtro_rc.astryd",
  "02_puente_rectificador.astryd",
  "03_arduino_led.astryd",
  "04_amp_bjt_bode.astryd",
] as const;

function loadDemo(filename: (typeof DEMO_FILES)[number]): CircuitFileData {
  const content = readFileSync(resolve(process.cwd(), "public", "demos", filename), "utf8");
  const parsed = parseCircuitFile(content);
  if (!parsed.ok) throw new Error(`${filename}: ${parsed.error}`);
  return parsed.data;
}

function expectSameNode(nodes: Readonly<Record<string, string>>, ...pins: string[]): void {
  const expected = nodes[pins[0]];
  for (const pin of pins.slice(1)) expect(nodes[pin], pin).toBe(expected);
}

function expectDifferentNodes(nodes: Readonly<Record<string, string>>, pinA: string, pinB: string): void {
  expect(nodes[pinA], pinA).not.toBe(nodes[pinB]);
}

describe("circuitos de demostracion", () => {
  test("el menu referencia archivos existentes y con formato valido", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    for (const filename of DEMO_FILES) {
      expect(html).toContain(`value="${filename}"`);
      expect(() => loadDemo(filename)).not.toThrow();
    }
  });

  test.each(DEMO_FILES)("%s pasa integridad, preflight y ERC", (filename) => {
    const demo = loadDemo(filename);
    const extraction = extractElectricalNetlist(demo.components, demo.wires, getComponentPins);
    expect(extraction.error).toBeUndefined();

    const erc = runElectricalRuleCheck(
      extraction.netlist,
      demo.components,
      demo.wires,
      getComponentPins,
    );
    expect(erc.errors).toEqual([]);
    expect(erc.passed).toBe(true);
  });

  test.each(DEMO_FILES)("%s queda encuadrada y sin componentes superpuestos", (filename) => {
    const demo = loadDemo(filename);
    const margin = 20;
    const viewportWidth = 810;
    const viewportHeight = 580;
    const screenBounds = demo.components.map((component) => {
      const bounds = getComponentBounds(component);
      return {
        id: component.id,
        left: bounds.x * demo.viewport.zoom + demo.viewport.offsetX,
        top: bounds.y * demo.viewport.zoom + demo.viewport.offsetY,
        right: (bounds.x + bounds.width) * demo.viewport.zoom + demo.viewport.offsetX,
        bottom: (bounds.y + bounds.height) * demo.viewport.zoom + demo.viewport.offsetY,
        world: bounds,
      };
    });

    for (const bounds of screenBounds) {
      expect(bounds.left, `${bounds.id} sale por la izquierda`).toBeGreaterThanOrEqual(margin);
      expect(bounds.top, `${bounds.id} sale por arriba`).toBeGreaterThanOrEqual(margin);
      expect(bounds.right, `${bounds.id} sale por la derecha`).toBeLessThanOrEqual(viewportWidth - margin);
      expect(bounds.bottom, `${bounds.id} sale por abajo`).toBeLessThanOrEqual(viewportHeight - margin);
    }

    for (let i = 0; i < screenBounds.length; i++) {
      for (let j = i + 1; j < screenBounds.length; j++) {
        const a = screenBounds[i].world;
        const b = screenBounds[j].world;
        const overlaps = a.x < b.x + b.width
          && a.x + a.width > b.x
          && a.y < b.y + b.height
          && a.y + a.height > b.y;
        expect(overlaps, `${screenBounds[i].id} se superpone con ${screenBounds[j].id}`).toBe(false);
      }
    }
  });

  test("el filtro RC conserva alimentacion, salida y retorno separados", () => {
    const demo = loadDemo("01_filtro_rc.astryd");
    const { pinToNodeMap: nodes } = extractElectricalNetlist(demo.components, demo.wires, getComponentPins);
    expectSameNode(nodes, "V1:0", "R1:0");
    expectSameNode(nodes, "R1:1", "C1:0");
    expectSameNode(nodes, "V1:1", "C1:1", "GND1:0");
    expectDifferentNodes(nodes, "V1:0", "V1:1");
  });

  test("el puente conecta ambos diodos y la carga RC en paralelo", () => {
    const demo = loadDemo("02_puente_rectificador.astryd");
    const { pinToNodeMap: nodes } = extractElectricalNetlist(demo.components, demo.wires, getComponentPins);
    expectSameNode(nodes, "V1:0", "D1:0", "D3:1");
    expectSameNode(nodes, "V1:1", "D2:0", "D4:1");
    expectSameNode(nodes, "D1:1", "D2:1", "R1:0", "C1:0");
    expectSameNode(nodes, "D3:0", "D4:0", "R1:1", "C1:1", "GND1:0");
    expectDifferentNodes(nodes, "R1:0", "R1:1");
  });

  test("Arduino alimenta la salida LED sin exigir conectar GPIO no usados", () => {
    const demo = loadDemo("03_arduino_led.astryd");
    const { pinToNodeMap: nodes } = extractElectricalNetlist(demo.components, demo.wires, getComponentPins);
    expectSameNode(nodes, "U1:1", "R1:0");
    expectSameNode(nodes, "R1:1", "LED1:0");
    expectSameNode(nodes, "U1:5", "LED1:1", "GND1:0");
    expectDifferentNodes(nodes, "U1:1", "U1:5");
    expect(demo.components.find((component) => component.id === "U1")?.value).toBe(1);
  });

  test("el BJT tiene polarizacion, entrada acoplada y VCC sin cortocircuito", () => {
    const demo = loadDemo("04_amp_bjt_bode.astryd");
    const { pinToNodeMap: nodes } = extractElectricalNetlist(demo.components, demo.wires, getComponentPins);
    expectSameNode(nodes, "VCC:0", "RB1:0", "RC:0");
    expectSameNode(nodes, "Vin:0", "Cin:0");
    expectSameNode(nodes, "Cin:1", "RB1:1", "RB2:0", "Q1:0");
    expectSameNode(nodes, "Q1:1", "RC:1");
    expectSameNode(nodes, "Q1:2", "RE:0");
    expectSameNode(nodes, "VCC:1", "Vin:1", "RB2:1", "RE:1", "GND1:0");
    expectDifferentNodes(nodes, "VCC:0", "VCC:1");
  });
});
