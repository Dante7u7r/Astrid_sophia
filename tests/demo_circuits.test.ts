import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { getComponentPins } from "../src/canvas/component_pins";
import { parseCircuitFile, type CircuitFileData } from "../src/persistence/circuit_file";
import { extractElectricalNetlist } from "../src/simulation/netlist_extractor";
import { runElectricalRuleCheck } from "../src/simulation/simulation_dispatcher";

const DEMO_FILES = [
  "01_amplificador_no_inversor.biaani",
  "02_rectificador_filtro_c.biaani",
  "03_puente_wheatstone_desbalanceado.biaani",
  "04_detector_cruce_por_cero_basico.biaani",
  "05_detector_cruce_por_cero_aislado.biaani",
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

  test("el amplificador no inversor conecta senal a In+, realimentacion a In- y rieles", () => {
    const demo = loadDemo("01_amplificador_no_inversor.biaani");
    const { pinToNodeMap: nodes } = extractElectricalNetlist(demo.components, demo.wires, getComponentPins);
    expectSameNode(nodes, "U2:0", "V1:1"); // In+ a señal V1
    expectSameNode(nodes, "U2:1", "R1:0", "R2:0"); // In- a nodo divisor R1-R2
    expectSameNode(nodes, "U2:4", "R2:1", "NET1:0"); // Salida a R2 y test point
    expectSameNode(nodes, "R1:1", "GND1:0"); // R1 a tierra
  });

  test("el rectificador con filtro C conecta diodos, fuentes y filtros", () => {
    const demo = loadDemo("02_rectificador_filtro_c.biaani");
    const { pinToNodeMap: nodes } = extractElectricalNetlist(demo.components, demo.wires, getComponentPins);
    expectSameNode(nodes, "V1:0", "D1:0");
    expectSameNode(nodes, "D1:1", "C1:0", "R1:0");
    expectSameNode(nodes, "V1:1", "C1:1", "R1:1", "GND1:0");
  });

  test("el puente de Wheatstone conecta las 4 resistencias en puente con DMM", () => {
    const demo = loadDemo("03_puente_wheatstone_desbalanceado.biaani");
    const { pinToNodeMap: nodes } = extractElectricalNetlist(demo.components, demo.wires, getComponentPins);
    expectSameNode(nodes, "NET1:0", "R1:0", "R2:0");
    expectSameNode(nodes, "R1:1", "R3:0", "DMM1:0");
    expectSameNode(nodes, "R2:1", "R4:0", "DMM1:1");
    expectSameNode(nodes, "R3:1", "R4:1", "GND1:0");
  });

  test("el detector de cruce por cero basico conecta senal a In+, tierra a In- y DMMs", () => {
    const demo = loadDemo("04_detector_cruce_por_cero_basico.biaani");
    const { pinToNodeMap: nodes } = extractElectricalNetlist(demo.components, demo.wires, getComponentPins);
    expectSameNode(nodes, "V1:0", "NET_VIN:0", "DMM1:0", "U1:0"); // Vin, DMM1+ y OpAmp In+
    expectSameNode(nodes, "V1:1", "GND1:0", "DMM1:1", "GND2:0", "U1:1", "GND3:0", "RL1:1"); // GND
    expectSameNode(nodes, "U1:4", "DMM2:0"); // Out de OpAmp a Amperímetro DMM2+
    expectSameNode(nodes, "DMM2:1", "RL1:0", "NET_VOUT:0"); // Amperímetro DMM2- a RL1 y Test point
  });

  test("el detector de cruce por cero aislado conecta puente rectificador, optoacoplador y salida pull-up", () => {
    const demo = loadDemo("05_detector_cruce_por_cero_aislado.biaani");
    const { pinToNodeMap: nodes } = extractElectricalNetlist(demo.components, demo.wires, getComponentPins);
    expectSameNode(nodes, "V1:0", "NET_AC:0", "DMM1:0", "D1:0", "D2:1"); // AC Fase
    expectSameNode(nodes, "V1:1", "GND_AC:0", "DMM1:1", "D3:0", "D4:1"); // AC Neutro/GND
    expectSameNode(nodes, "D1:1", "D3:1", "NET_RECT:0", "R1:0"); // Rectificado Positivo
    expectSameNode(nodes, "D2:0", "D4:0", "OK1:1"); // Rectificado Retorno a Cátodo Opto
    expectSameNode(nodes, "R1:1", "DMM2:0"); // Resistencia R1 a Amperímetro DMM2+
    expectSameNode(nodes, "DMM2:1", "OK1:0"); // Amperímetro DMM2- a Ánodo Opto
    expectSameNode(nodes, "R2:1", "OK1:2", "NET_PULSE:0"); // Salida colector con pull-up
    expectSameNode(nodes, "OK1:3", "GND_SEC:0"); // Emisor opto a GND secundario
  });
});
