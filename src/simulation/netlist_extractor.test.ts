// ==========================================================================
// PRUEBAS UNITARIAS — NETLIST EXTRACTOR
// ==========================================================================
// Verifica el colapsado de nodos mediante DSU (Disjoint Set Union) y la
// extracción de netlists eléctricas a partir de componentes y cables.
//
// Estas pruebas NO requieren DOM, Tauri IPC, ni canvas. Se ejecutan
// exclusivamente en el entorno Node.js provisto por Vitest.
// ==========================================================================

import { describe, test, expect } from "vitest";
import { DisjointSetUnion, extractElectricalNetlist } from "./netlist_extractor";
import type { ComponentInstance, PinInstance, WireInstance } from "../canvas_orchestrator";

// ==========================================================================
// DSU — DISJOINT SET UNION
// ==========================================================================

describe("DisjointSetUnion", () => {
  test("find devuelve el propio elemento cuando no ha sido unido", () => {
    const dsu = new DisjointSetUnion();
    expect(dsu.find("A")).toBe("A");
    expect(dsu.find("Z")).toBe("Z");
  });

  test("union fusiona dos conjuntos correctamente", () => {
    const dsu = new DisjointSetUnion();
    dsu.union("A", "B");
    expect(dsu.find("A")).toBe(dsu.find("B"));
  });

  test("union encadena tres nodos y todos comparten la misma raíz", () => {
    const dsu = new DisjointSetUnion();
    dsu.union("A", "B");
    dsu.union("B", "C");
    const root = dsu.find("C");
    expect(dsu.find("A")).toBe(root);
    expect(dsu.find("B")).toBe(root);
  });

  test("compresi\u00f3n de caminos: tras union+find, el padre apunta directamente a la ra\u00edz", () => {
    const dsu = new DisjointSetUnion();
    dsu.union("A", "B");
    dsu.union("B", "C");
    // find("C") comprime el camino de C
    const root = dsu.find("C");
    // find("A") debe devolver la misma raíz
    expect(dsu.find("A")).toBe(root);
    // Verificar compresión mediante el estado interno (los parents directos)
    expect((dsu as any).parent["A"]).toBe(root);
    expect((dsu as any).parent["B"]).toBe(root);
  });

  test("conjuntos independientes no se contaminan entre s\u00ed", () => {
    const dsu = new DisjointSetUnion();
    dsu.union("X", "Y");
    dsu.union("P", "Q");
    const rootXY = dsu.find("X");
    const rootPQ = dsu.find("P");
    expect(dsu.find("Y")).toBe(rootXY);
    expect(dsu.find("Q")).toBe(rootPQ);
    expect(rootXY).not.toBe(rootPQ);
  });
});

// ==========================================================================
// EXTRACCIÓN DE NETLIST — Integración DSU + componentes
// ==========================================================================

describe("extractElectricalNetlist", () => {
  test("cables conectados fusionan pines en el mismo nodo eléctrico", () => {
    const components: ComponentInstance[] = [
      {
        id: "R1", type: "resistor", value: 1000, x: 0, y: 0, rotation: 0,
        pins: ["n1", "n2"],
      } as unknown as ComponentInstance,
      {
        id: "R2", type: "resistor", value: 2000, x: 100, y: 0, rotation: 0,
        pins: ["n2", "n0"],
      } as unknown as ComponentInstance,
    ];

    const wires: WireInstance[] = [
      {
        id: "W1",
        from: { componentId: "R1", pinIndex: 1 },
        to: { componentId: "R2", pinIndex: 0 },
      },
    ];

    const getPins = (c: ComponentInstance): PinInstance[] => {
      const typed = c as ComponentInstance & { pins: string[] };
      return typed.pins.map((_, i) => ({
        componentId: c.id,
        pinIndex: i,
        x: 0,
        y: 0,
      }));
    };

    const { pinToNodeMap } = extractElectricalNetlist(components, wires, getPins);

    // R1:1 y R2:0 están cableados → mismo nodo
    expect(pinToNodeMap["R1:1"]).toBe(pinToNodeMap["R2:0"]);
    // R1:0 y R2:1 no están cableados → nodos distintos
    expect(pinToNodeMap["R1:0"]).not.toBe(pinToNodeMap["R2:1"]);
  });

  test("extrae potenciometro como dos resistencias en serie", () => {
    const components: ComponentInstance[] = [
      {
        id: "POT1", type: "potentiometer", value: 10000, wiperPosition: 0.3, x: 0, y: 0, rotation: 0,
      } as unknown as ComponentInstance,
      {
        id: "GND1", type: "ground", value: 0, x: 10, y: 10, rotation: 0,
      } as unknown as ComponentInstance
    ];

    const wires: WireInstance[] = [
      // Wire wiper to GND
      {
        id: "W1",
        from: { componentId: "POT1", pinIndex: 1 },
        to: { componentId: "GND1", pinIndex: 0 }
      }
    ];

    const getPins = (c: ComponentInstance): PinInstance[] => {
      if (c.type === "potentiometer") {
        return [
          { componentId: c.id, pinIndex: 0, x: 0, y: 0 },
          { componentId: c.id, pinIndex: 1, x: 0, y: 0 },
          { componentId: c.id, pinIndex: 2, x: 0, y: 0 },
        ];
      }
      return [
        { componentId: c.id, pinIndex: 0, x: 0, y: 0 }
      ];
    };

    const { netlist, pinToNodeMap } = extractElectricalNetlist(components, wires, getPins);

    expect(pinToNodeMap["GND1:0"]).toBe("0");
    expect(pinToNodeMap["POT1:1"]).toBe("0");

    const r1 = netlist.components.find(comp => comp.id === "POT1__R1");
    const r2 = netlist.components.find(comp => comp.id === "POT1__R2");

    expect(r1).toBeDefined();
    expect(r2).toBeDefined();

    expect(r1!.value).toBeCloseTo(3000);
    expect(r2!.value).toBeCloseTo(7000);

    expect(r1!.pins[0]).toBe(pinToNodeMap["POT1:0"]);
    expect(r1!.pins[1]).toBe("0");
    expect(r2!.pins[0]).toBe("0");
    expect(r2!.pins[1]).toBe(pinToNodeMap["POT1:2"]);
  });

  test("extrae LDR como una resistencia dependiente de los luxes", () => {
    const components: ComponentInstance[] = [
      {
        id: "LDR1", type: "ldr", lux: 100, x: 0, y: 0, rotation: 0,
      } as unknown as ComponentInstance
    ];

    const wires: WireInstance[] = [];

    const getPins = (c: ComponentInstance): PinInstance[] => {
      return [
        { componentId: c.id, pinIndex: 0, x: 0, y: 0 },
        { componentId: c.id, pinIndex: 1, x: 0, y: 0 }
      ];
    };

    const { netlist } = extractElectricalNetlist(components, wires, getPins);
    const rLdr = netlist.components.find(comp => comp.id === "LDR1");
    expect(rLdr).toBeDefined();
    expect(rLdr!.type).toBe("resistor");
    
    // R = 500 + 500000 / 100 = 5500 Ohms
    expect(rLdr!.value).toBeCloseTo(5500);
  });

  test("extrae termistor NTC aplicando la formula Beta", () => {
    const components: ComponentInstance[] = [
      {
        id: "TH1", type: "thermistor", temperatureCelsius: 25, x: 0, y: 0, rotation: 0,
      } as unknown as ComponentInstance
    ];

    const wires: WireInstance[] = [];

    const getPins = (c: ComponentInstance): PinInstance[] => {
      return [
        { componentId: c.id, pinIndex: 0, x: 0, y: 0 },
        { componentId: c.id, pinIndex: 1, x: 0, y: 0 }
      ];
    };

    const { netlist } = extractElectricalNetlist(components, wires, getPins);
    const rTh = netlist.components.find(comp => comp.id === "TH1");
    expect(rTh).toBeDefined();
    expect(rTh!.type).toBe("resistor");

    // At 25 C (298.15 K), R must be exactly r0 = 10000 Ohms
    expect(rTh!.value).toBeCloseTo(10000);
  });

  test("extrae los tres modos del multimetro con modelos electricos validos", () => {
    const getPins = (component: ComponentInstance): PinInstance[] => [
      { componentId: component.id, pinIndex: 0, x: 0, y: 0 },
      { componentId: component.id, pinIndex: 1, x: 40, y: 0 },
    ];

    const voltage = extractElectricalNetlist([{
      id: "DMM1", type: "dmm", value: "V", x: 0, y: 0, rotation: 0,
    }], [], getPins);
    const current = extractElectricalNetlist([{
      id: "DMM1", type: "dmm", value: "A", x: 0, y: 0, rotation: 0,
    }], [], getPins);
    const resistance = extractElectricalNetlist([{
      id: "DMM1", type: "dmm", value: "R", x: 0, y: 0, rotation: 0,
    }], [], getPins);

    expect(voltage.netlist.components[0]).toMatchObject({ type: "resistor", value: 10e6 });
    expect(current.netlist.components[0]).toMatchObject({ type: "resistor", value: 0.01 });
    expect(resistance.netlist.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "DMM1__test", type: "isource", value: 10e-6 }),
      expect.objectContaining({ id: "DMM1__guard", type: "resistor", value: 1e9 }),
    ]));
  });

  test("transfiere parametros completos de switch y transformador", () => {
    const components: ComponentInstance[] = [
      {
        id: "SW1",
        type: "switch",
        value: 0,
        switchState: true,
        switchRon: 0.02,
        switchRoff: 2e9,
        switchVth: 1.2,
        switchVh: 0.15,
        x: 0,
        y: 0,
        rotation: 0,
      },
      {
        id: "T1",
        type: "transformer",
        value: 0.002,
        primaryInductance: 0.002,
        secondaryInductance: 0.008,
        couplingCoefficient: 0.97,
        x: 100,
        y: 0,
        rotation: 0,
      },
    ];
    const getPins = (component: ComponentInstance): PinInstance[] => {
      const count = component.type === "transformer" ? 4 : 2;
      return Array.from({ length: count }, (_, pinIndex) => ({
        componentId: component.id,
        pinIndex,
        x: pinIndex * 40,
        y: 0,
      }));
    };

    const { netlist } = extractElectricalNetlist(components, [], getPins);
    const switchComponent = netlist.components.find(component => component.id === "SW1");

    expect(switchComponent).toMatchObject({
      switchState: true,
      switchRon: 0.02,
      switchRoff: 2e9,
      switchVth: 1.2,
      switchVh: 0.15,
    });
    expect(netlist.components.find(component => component.id === "T1__L1")?.value).toBe(0.002);
    expect(netlist.components.find(component => component.id === "T1__L2")?.value).toBe(0.008);
    expect(netlist.mutual_inductances?.[0]?.k_coeff).toBe(0.97);
  });

  test("conserva la frecuencia configurada del MCU en la netlist", () => {
    const mcu: ComponentInstance = {
      id: "U1",
      type: "mcu_8051",
      value: 8e6,
      mcuClockSpeed: 8e6,
      x: 0,
      y: 0,
      rotation: 0,
    };
    const { netlist } = extractElectricalNetlist([mcu], [], component => [{
      componentId: component.id,
      pinIndex: 0,
      x: 0,
      y: 0,
    }]);

    expect(netlist.components[0].mcuClockSpeed).toBe(8e6);
  });

  test("reutiliza la caché topológica al cambiar únicamente el valor numérico de un componente", () => {
    const components1: ComponentInstance[] = [
      { id: "GND", type: "ground", value: 0, x: 0, y: 0, rotation: 0 },
      { id: "R1", type: "resistor", value: 1000, x: 50, y: 0, rotation: 0 },
    ];
    const getPins = (c: ComponentInstance) => Array.from({ length: 2 }, (_, i) => ({ componentId: c.id, pinIndex: i, x: 0, y: 0 }));

    const res1 = extractElectricalNetlist(components1, [], getPins);
    expect(res1.netlist.components.find(c => c.id === "R1")?.value).toBe(1000);

    // Cambiar solo el valor de R1 de 1000 a 5000 sin cambiar topología
    const components2: ComponentInstance[] = [
      { id: "GND", type: "ground", value: 0, x: 0, y: 0, rotation: 0 },
      { id: "R1", type: "resistor", value: 5000, x: 50, y: 0, rotation: 0 },
    ];

    const res2 = extractElectricalNetlist(components2, [], getPins);
    expect(res2.netlist.components.find(c => c.id === "R1")?.value).toBe(5000);
    expect(res2.pinToNodeMap).toEqual(res1.pinToNodeMap);
  });

  test("invalida la caché topológica cuando se conecta un nuevo cable", () => {
    const components: ComponentInstance[] = [
      { id: "GND1", type: "ground", value: 0, x: 0, y: 0, rotation: 0 },
      { id: "R1", type: "resistor", value: 1000, x: 50, y: 0, rotation: 0 },
      { id: "V1", type: "vsource", value: 5, x: 100, y: 0, rotation: 0 },
    ];
    const getPins = (c: ComponentInstance) => Array.from({ length: 2 }, (_, i) => ({ componentId: c.id, pinIndex: i, x: 0, y: 0 }));

    // Sin cables
    const resWithoutWire = extractElectricalNetlist(components, [], getPins);
    expect(resWithoutWire.netlist.wires).toHaveLength(0);

    // Conectar cable entre GND y R1:0
    const wire: WireInstance = {
      id: "W1",
      from: { componentId: "GND1", pinIndex: 0 },
      to: { componentId: "R1", pinIndex: 0 },
    };

    const resWithWire = extractElectricalNetlist(components, [wire], getPins);
    expect(resWithWire.netlist.wires).toHaveLength(1);
    expect(resWithWire.pinToNodeMap["R1:0"]).toBe(resWithWire.pinToNodeMap["GND1:0"]);
    expect(resWithWire.pinToNodeMap["R1:0"]).toBe("0");
  });

  test("extrae correctamente nodos unificados a traves de empalmes en T (T-Junctions)", () => {
    const components: ComponentInstance[] = [
      { id: "GND1", type: "ground", value: 0, x: 0, y: -50, rotation: 0 },
      { id: "V1", type: "vsource", value: 12, x: 0, y: 0, rotation: 0 },
      { id: "R1", type: "resistor", value: 1000, x: 50, y: 0, rotation: 0 },
      { id: "R2", type: "resistor", value: 2000, x: 100, y: 0, rotation: 0 },
    ];
    const getPins = (c: ComponentInstance): PinInstance[] => {
      const count = c.type === "ground" ? 1 : 2;
      return Array.from({ length: count }, (_, i) => ({
        componentId: c.id,
        pinIndex: i,
        x: c.x + i * 20,
        y: c.y,
        label: `${i}`,
      }));
    };

    const junctionPos = { x: 50, y: 0 };
    const junctionEp = { componentId: "junction_50_0", pinIndex: 0, isJunction: true, junctionPos };

    // V1:0 conectado a la unión J1
    const wireA: WireInstance = {
      id: "wire_V1_p0_to_j_50_0",
      from: { componentId: "V1", pinIndex: 0 },
      to: { ...junctionEp },
      points: [{ x: 0, y: 0 }, { x: 50, y: 0 }],
    };
    // R1:0 conectado a la unión J1
    const wireB: WireInstance = {
      id: "wire_j_50_0_to_R1_p0",
      from: { ...junctionEp },
      to: { componentId: "R1", pinIndex: 0 },
      points: [{ x: 50, y: 0 }, { x: 50, y: 0 }],
    };
    // R2:0 derivado a la unión J1 (tercera rama)
    const wireC: WireInstance = {
      id: "wire_R2_p0_to_j_50_0",
      from: { componentId: "R2", pinIndex: 0 },
      to: { ...junctionEp },
      points: [{ x: 100, y: 0 }, { x: 50, y: 0 }],
    };

    // Conectar terminales de retorno a GND para satisfacer ERC
    const wireGnd1: WireInstance = {
      id: "wire_V1_p1_to_GND",
      from: { componentId: "V1", pinIndex: 1 },
      to: { componentId: "GND1", pinIndex: 0 },
    };
    const wireGnd2: WireInstance = {
      id: "wire_R1_p1_to_GND",
      from: { componentId: "R1", pinIndex: 1 },
      to: { componentId: "GND1", pinIndex: 0 },
    };
    const wireGnd3: WireInstance = {
      id: "wire_R2_p1_to_GND",
      from: { componentId: "R2", pinIndex: 1 },
      to: { componentId: "GND1", pinIndex: 0 },
    };

    const res = extractElectricalNetlist(
      components,
      [wireA, wireB, wireC, wireGnd1, wireGnd2, wireGnd3],
      getPins,
    );
    expect(res.error).toBeUndefined();
    expect(res.netlist.wires).toHaveLength(6);

    // Todos los terminales conectados a la T-Junction deben compartir el MISMO nodo eléctrico
    const nodeV1_0 = res.pinToNodeMap["V1:0"];
    const nodeR1_0 = res.pinToNodeMap["R1:0"];
    const nodeR2_0 = res.pinToNodeMap["R2:0"];

    expect(nodeV1_0).toBeDefined();
    expect(nodeV1_0).toBe(nodeR1_0);
    expect(nodeV1_0).toBe(nodeR2_0);
  });

  test("conecta virtualmente dos cables separados que comparten el mismo wire.label", () => {
    const components: ComponentInstance[] = [
      { id: "R1", type: "resistor", value: 1000, x: 0, y: 0, rotation: 0 },
      { id: "R2", type: "resistor", value: 2000, x: 200, y: 0, rotation: 0 },
      { id: "GND1", type: "ground", value: 0, x: 0, y: 100, rotation: 0 },
    ];

    const wire1: WireInstance = {
      id: "w1",
      from: { componentId: "R1", pinIndex: 0 },
      to: { componentId: "R1", pinIndex: 0 },
      label: "BUS_CLK",
    };

    const wire2: WireInstance = {
      id: "w2",
      from: { componentId: "R2", pinIndex: 0 },
      to: { componentId: "R2", pinIndex: 0 },
      label: "BUS_CLK",
    };

    const wireGnd1: WireInstance = {
      id: "wg1",
      from: { componentId: "R1", pinIndex: 1 },
      to: { componentId: "GND1", pinIndex: 0 },
    };
    const wireGnd2: WireInstance = {
      id: "wg2",
      from: { componentId: "R2", pinIndex: 1 },
      to: { componentId: "GND1", pinIndex: 0 },
    };

    const getPins = (c: ComponentInstance): PinInstance[] => {
      const count = c.type === "ground" ? 1 : 2;
      return Array.from({ length: count }, (_, i) => ({
        componentId: c.id,
        pinIndex: i,
        x: c.x + i * 20,
        y: c.y,
      }));
    };

    const res = extractElectricalNetlist(components, [wire1, wire2, wireGnd1, wireGnd2], getPins);
    expect(res.error).toBeUndefined();
    expect(res.pinToNodeMap["R1:0"]).toBeDefined();
    expect(res.pinToNodeMap["R1:0"]).toBe(res.pinToNodeMap["R2:0"]);
  });

  test("conecta puertos net_label al mismo nodo SPICE y omite text_note del netlist", () => {
    const components: ComponentInstance[] = [
      { id: "V1", type: "vsource", value: 5, x: 0, y: 0, rotation: 0 },
      { id: "NET1", type: "net_label", value: "VCC_BUS", label: "VCC_BUS", x: 20, y: 0, rotation: 0 },
      { id: "R1", type: "resistor", value: 1000, x: 100, y: 0, rotation: 0 },
      { id: "NET2", type: "net_label", value: "VCC_BUS", label: "VCC_BUS", x: 100, y: 0, rotation: 0 },
      { id: "NOTE1", type: "text_note", value: "Etapa de Entrada", label: "Etapa de Entrada", x: 50, y: 50, rotation: 0 },
      { id: "GND1", type: "ground", value: 0, x: 0, y: 50, rotation: 0 },
    ];

    const getPins = (c: ComponentInstance): PinInstance[] => {
      if (c.type === "text_note") return [];
      if (c.type === "net_label" || c.type === "ground") {
        return [{ componentId: c.id, pinIndex: 0, x: c.x, y: c.y }];
      }
      return [
        { componentId: c.id, pinIndex: 0, x: c.x, y: c.y },
        { componentId: c.id, pinIndex: 1, x: c.x, y: c.y + 20 },
      ];
    };

    const wireV1toNet1: WireInstance = {
      id: "w1",
      from: { componentId: "V1", pinIndex: 0 },
      to: { componentId: "NET1", pinIndex: 0 },
    };

    const wireR1toNet2: WireInstance = {
      id: "w2",
      from: { componentId: "R1", pinIndex: 0 },
      to: { componentId: "NET2", pinIndex: 0 },
    };

    const wireV1toGnd: WireInstance = {
      id: "wg1",
      from: { componentId: "V1", pinIndex: 1 },
      to: { componentId: "GND1", pinIndex: 0 },
    };

    const wireR1toGnd: WireInstance = {
      id: "wg2",
      from: { componentId: "R1", pinIndex: 1 },
      to: { componentId: "GND1", pinIndex: 0 },
    };

    const res = extractElectricalNetlist(
      components,
      [wireV1toNet1, wireR1toNet2, wireV1toGnd, wireR1toGnd],
      getPins,
    );
    expect(res.error).toBeUndefined();
    // V1 pin 0 y R1 pin 0 deben unirse a través de las dos net_labels "VCC_BUS"
    expect(res.pinToNodeMap["V1:0"]).toBeDefined();
    expect(res.pinToNodeMap["V1:0"]).toBe(res.pinToNodeMap["R1:0"]);

    // NOTE1 y NET1/NET2 no deben emitirse como componentes SPICE primitivos
    const emittedTypes = res.netlist.components.map(c => c.type);
    expect(emittedTypes).not.toContain("text_note");
    expect(emittedTypes).not.toContain("net_label");
  });

  test("extrae correctamente un opamp_ideal de 3 pines mapeando a entradas y salida", () => {
    const components: ComponentInstance[] = [
      { id: "U1", type: "opamp_ideal", value: 100000, x: 100, y: 100, rotation: 0 },
      { id: "GND1", type: "ground", value: 0, x: 50, y: 150, rotation: 0 },
      { id: "V1", type: "vsource", value: 2.5, x: 50, y: 100, rotation: 0 },
      { id: "R1", type: "resistor", value: 1000, x: 150, y: 100, rotation: 0 },
    ];

    const getPins = (c: ComponentInstance): PinInstance[] => {
      if (c.type === "opamp_ideal") {
        return [
          { componentId: c.id, pinIndex: 0, x: c.x - 40, y: c.y - 15 }, // In+
          { componentId: c.id, pinIndex: 1, x: c.x - 40, y: c.y + 15 }, // In-
          { componentId: c.id, pinIndex: 2, x: c.x + 40, y: c.y },      // OUT
        ];
      }
      if (c.type === "ground") {
        return [{ componentId: c.id, pinIndex: 0, x: c.x, y: c.y }];
      }
      return [
        { componentId: c.id, pinIndex: 0, x: c.x, y: c.y - 20 },
        { componentId: c.id, pinIndex: 1, x: c.x, y: c.y + 20 },
      ];
    };

    const wires: WireInstance[] = [
      { id: "w1", from: { componentId: "V1", pinIndex: 0 }, to: { componentId: "U1", pinIndex: 0 } },
      { id: "w2", from: { componentId: "V1", pinIndex: 1 }, to: { componentId: "GND1", pinIndex: 0 } },
      { id: "w3", from: { componentId: "U1", pinIndex: 1 }, to: { componentId: "GND1", pinIndex: 0 } },
      { id: "w4", from: { componentId: "U1", pinIndex: 2 }, to: { componentId: "R1", pinIndex: 0 } },
      { id: "w5", from: { componentId: "R1", pinIndex: 1 }, to: { componentId: "GND1", pinIndex: 0 } },
    ];

    const res = extractElectricalNetlist(components, wires, getPins);
    expect(res.error).toBeUndefined();
    const opamp = res.netlist.components.find(c => c.id === "U1");
    expect(opamp).toBeDefined();
    expect(opamp?.type).toBe("opamp");
    expect(opamp?.pins).toHaveLength(5);
    // Pin 0 (In+) conectado a V1:0 (nodo > 0)
    expect(opamp?.pins[0]).not.toBe("0");
    // Pin 1 (In-) conectado a GND (nodo 0)
    expect(opamp?.pins[1]).toBe("0");
    // Pin 2 (V+) y Pin 3 (V-) virtuales ("0")
    expect(opamp?.pins[2]).toBe("0");
    expect(opamp?.pins[3]).toBe("0");
    // Pin 4 (OUT) conectado a R1:0 (nodo > 0)
    expect(opamp?.pins[4]).not.toBe("0");
  });

  test("terminal de alimentacion +5V y terminal de tierra GND inyectan fuente virtual de potencia", () => {
    const components: ComponentInstance[] = [
      { id: "PWR1", type: "net_label", value: "+5V", label: "+5V", terminalType: "power", voltage: 5, x: 0, y: 0, rotation: 0 },
      { id: "R1", type: "resistor", value: 1000, x: 50, y: 50, rotation: 0 },
      { id: "GND1", type: "net_label", value: "GND", label: "GND", terminalType: "ground", x: 100, y: 100, rotation: 0 },
    ];

    const getPins = (c: ComponentInstance): PinInstance[] => {
      if (c.type === "net_label") {
        return [{ componentId: c.id, pinIndex: 0, x: c.x, y: c.y }];
      }
      return [
        { componentId: c.id, pinIndex: 0, x: c.x, y: c.y - 20 },
        { componentId: c.id, pinIndex: 1, x: c.x, y: c.y + 20 },
      ];
    };

    const wires: WireInstance[] = [
      { id: "w1", from: { componentId: "PWR1", pinIndex: 0 }, to: { componentId: "R1", pinIndex: 0 } },
      { id: "w2", from: { componentId: "R1", pinIndex: 1 }, to: { componentId: "GND1", pinIndex: 0 } },
    ];

    const res = extractElectricalNetlist(components, wires, getPins);
    expect(res.error).toBeUndefined();

    // Debe existir la fuente virtual de alimentación V_PWR__5V entre el nodo de R1:0 y nodo 0
    const pwrSource = res.netlist.components.find(c => c.type === "vsource" && c.id.startsWith("V_PWR_"));
    expect(pwrSource).toBeDefined();
    expect(pwrSource?.value).toBe(5);
    expect(pwrSource?.pins[1]).toBe("0");

    const r1 = res.netlist.components.find(c => c.id === "R1");
    expect(r1).toBeDefined();
    // Pin 0 conectado al rail de potencia
    expect(r1?.pins[0]).toBe(pwrSource?.pins[0]);
    // Pin 1 conectado a tierra (nodo 0)
    expect(r1?.pins[1]).toBe("0");
  });

  test("power_port explicito emite fuente de tension vsource visible y auditable en el netlist", () => {
    const components: ComponentInstance[] = [
      { id: "VPORT1", type: "power_port", value: 3.3, label: "+3.3V", x: 0, y: 0, rotation: 0 },
      { id: "R1", type: "resistor", value: 470, x: 50, y: 50, rotation: 0 },
      { id: "GND1", type: "ground", value: 0, x: 100, y: 100, rotation: 0 },
    ];

    const getPins = (c: ComponentInstance): PinInstance[] => {
      if (c.type === "ground") {
        return [{ componentId: c.id, pinIndex: 0, x: c.x, y: c.y }];
      }
      return [
        { componentId: c.id, pinIndex: 0, x: c.x, y: c.y - 20 },
        { componentId: c.id, pinIndex: 1, x: c.x, y: c.y + 20 },
      ];
    };

    const wires: WireInstance[] = [
      { id: "w1", from: { componentId: "VPORT1", pinIndex: 0 }, to: { componentId: "R1", pinIndex: 0 } },
      { id: "w2", from: { componentId: "R1", pinIndex: 1 }, to: { componentId: "GND1", pinIndex: 0 } },
      { id: "w3", from: { componentId: "VPORT1", pinIndex: 1 }, to: { componentId: "GND1", pinIndex: 0 } },
    ];

    const res = extractElectricalNetlist(components, wires, getPins);
    expect(res.error).toBeUndefined();

    // Debe existir la fuente explícita VPORT1 de tipo vsource con valor 3.3V
    const explicitPort = res.netlist.components.find(c => c.id === "VPORT1" && c.type === "vsource");
    expect(explicitPort).toBeDefined();
    expect(explicitPort?.value).toBe(3.3);
    expect(explicitPort?.pins[1]).toBe("0");

    const r1 = res.netlist.components.find(c => c.id === "R1");
    expect(r1).toBeDefined();
    expect(r1?.pins[0]).toBe(explicitPort?.pins[0]);
    expect(r1?.pins[1]).toBe("0");
  });

  test("terminal de generador CLK inyecta fuente de onda cuadrada", () => {
    const components: ComponentInstance[] = [
      {
        id: "CLK1",
        type: "net_label",
        value: "CLK",
        label: "CLK",
        terminalType: "generator",
        waveType: "square",
        frequency: 2500,
        amplitude: 3.3,
        x: 0,
        y: 0,
        rotation: 0,
      },
      { id: "R1", type: "resistor", value: 1000, x: 50, y: 50, rotation: 0 },
      { id: "GND1", type: "ground", value: 0, x: 100, y: 100, rotation: 0 },
    ];

    const getPins = (c: ComponentInstance): PinInstance[] => {
      if (c.type === "net_label" || c.type === "ground") {
        return [{ componentId: c.id, pinIndex: 0, x: c.x, y: c.y }];
      }
      return [
        { componentId: c.id, pinIndex: 0, x: c.x, y: c.y - 20 },
        { componentId: c.id, pinIndex: 1, x: c.x, y: c.y + 20 },
      ];
    };

    const wires: WireInstance[] = [
      { id: "w1", from: { componentId: "CLK1", pinIndex: 0 }, to: { componentId: "R1", pinIndex: 0 } },
      { id: "w2", from: { componentId: "R1", pinIndex: 1 }, to: { componentId: "GND1", pinIndex: 0 } },
    ];

    const res = extractElectricalNetlist(components, wires, getPins);
    expect(res.error).toBeUndefined();

    const sigSource = res.netlist.components.find(c => c.id === "V_SIG_CLK1");
    expect(sigSource).toBeDefined();
    expect(sigSource?.waveType).toBe("square");
    expect(sigSource?.frequency).toBe(2500);
    expect(sigSource?.amplitude).toBe(3.3);
  });

  test("etiquetas de senal conectan componentes separados al mismo nodo virtual DSU", () => {
    const components: ComponentInstance[] = [
      { id: "V1", type: "vsource", value: 5, x: 0, y: 0, rotation: 0 },
      { id: "NET1", type: "net_label", value: "BUS_DATA", label: "BUS_DATA", terminalType: "signal", x: 10, y: 0, rotation: 0 },
      { id: "NET2", type: "net_label", value: "BUS_DATA", label: "BUS_DATA", terminalType: "signal", x: 200, y: 0, rotation: 0 },
      { id: "R1", type: "resistor", value: 1000, x: 210, y: 0, rotation: 0 },
      { id: "GND1", type: "ground", value: 0, x: 50, y: 50, rotation: 0 },
    ];

    const getPins = (c: ComponentInstance): PinInstance[] => {
      if (c.type === "net_label" || c.type === "ground") {
        return [{ componentId: c.id, pinIndex: 0, x: c.x, y: c.y }];
      }
      return [
        { componentId: c.id, pinIndex: 0, x: c.x, y: c.y - 20 },
        { componentId: c.id, pinIndex: 1, x: c.x, y: c.y + 20 },
      ];
    };

    const wires: WireInstance[] = [
      { id: "w1", from: { componentId: "V1", pinIndex: 0 }, to: { componentId: "NET1", pinIndex: 0 } },
      { id: "w2", from: { componentId: "V1", pinIndex: 1 }, to: { componentId: "GND1", pinIndex: 0 } },
      { id: "w3", from: { componentId: "NET2", pinIndex: 0 }, to: { componentId: "R1", pinIndex: 0 } },
      { id: "w4", from: { componentId: "R1", pinIndex: 1 }, to: { componentId: "GND1", pinIndex: 0 } },
    ];

    const res = extractElectricalNetlist(components, wires, getPins);
    expect(res.error).toBeUndefined();

    const v1 = res.netlist.components.find(c => c.id === "V1");
    const r1 = res.netlist.components.find(c => c.id === "R1");
    expect(v1).toBeDefined();
    expect(r1).toBeDefined();
    // V1:0 y R1:0 deben compartir el mismo nodo no-cero gracias a BUS_DATA
    expect(v1?.pins[0]).toBe(r1?.pins[0]);
    expect(v1?.pins[0]).not.toBe("0");
  });

  test("expande net_label con rango de vector DATA[0:7] y conecta componentes correspondientes", () => {
    const components: ComponentInstance[] = [
      { id: "V_IN", type: "vsource", value: 3.3, x: 0, y: 0, rotation: 0 },
      { id: "BUS_OUT", type: "net_label", value: "DATA[0:7]", label: "DATA[0:7]", terminalType: "signal", x: 20, y: 0, rotation: 0 },
      { id: "BUS_IN", type: "net_label", value: "DATA[0:7]", label: "DATA[0:7]", terminalType: "signal", x: 100, y: 0, rotation: 0 },
      { id: "R_LOAD", type: "resistor", value: 470, x: 120, y: 0, rotation: 0 },
      { id: "GND1", type: "ground", value: 0, x: 50, y: 50, rotation: 0 },
    ];

    const getPins = (c: ComponentInstance): PinInstance[] => {
      if (c.type === "net_label" || c.type === "ground") {
        return [{ componentId: c.id, pinIndex: 0, x: c.x, y: c.y }];
      }
      return [
        { componentId: c.id, pinIndex: 0, x: c.x, y: c.y - 20 },
        { componentId: c.id, pinIndex: 1, x: c.x, y: c.y + 20 },
      ];
    };

    const wires: WireInstance[] = [
      { id: "w1", from: { componentId: "V_IN", pinIndex: 0 }, to: { componentId: "BUS_OUT", pinIndex: 0 } },
      { id: "w2", from: { componentId: "V_IN", pinIndex: 1 }, to: { componentId: "GND1", pinIndex: 0 } },
      { id: "w3", from: { componentId: "BUS_IN", pinIndex: 0 }, to: { componentId: "R_LOAD", pinIndex: 0 } },
      { id: "w4", from: { componentId: "R_LOAD", pinIndex: 1 }, to: { componentId: "GND1", pinIndex: 0 } },
    ];

    const res = extractElectricalNetlist(components, wires, getPins);
    expect(res.error).toBeUndefined();

    const vIn = res.netlist.components.find(c => c.id === "V_IN");
    const rLoad = res.netlist.components.find(c => c.id === "R_LOAD");

    expect(vIn).toBeDefined();
    expect(rLoad).toBeDefined();
    expect(vIn?.pins[0]).toBe(rLoad?.pins[0]);
    expect(vIn?.pins[0]).not.toBe("0");
  });

  test("une tap de bus individual DATA[3] con el bus correspondiente en DSU", () => {
    const components: ComponentInstance[] = [
      { id: "V_BIT3", type: "vsource", value: 5, x: 0, y: 0, rotation: 0 },
      { id: "TAP_OUT", type: "net_label", value: "DATA[3]", label: "DATA[3]", terminalType: "signal", x: 20, y: 0, rotation: 0 },
      { id: "TAP_IN", type: "net_label", value: "DATA_3", label: "DATA_3", terminalType: "signal", x: 100, y: 0, rotation: 0 },
      { id: "R_BIT3", type: "resistor", value: 1000, x: 120, y: 0, rotation: 0 },
      { id: "GND1", type: "ground", value: 0, x: 50, y: 50, rotation: 0 },
    ];

    const getPins = (c: ComponentInstance): PinInstance[] => {
      if (c.type === "net_label" || c.type === "ground") {
        return [{ componentId: c.id, pinIndex: 0, x: c.x, y: c.y }];
      }
      return [
        { componentId: c.id, pinIndex: 0, x: c.x, y: c.y - 20 },
        { componentId: c.id, pinIndex: 1, x: c.x, y: c.y + 20 },
      ];
    };

    const wires: WireInstance[] = [
      { id: "w1", from: { componentId: "V_BIT3", pinIndex: 0 }, to: { componentId: "TAP_OUT", pinIndex: 0 } },
      { id: "w2", from: { componentId: "V_BIT3", pinIndex: 1 }, to: { componentId: "GND1", pinIndex: 0 } },
      { id: "w3", from: { componentId: "TAP_IN", pinIndex: 0 }, to: { componentId: "R_BIT3", pinIndex: 0 } },
      { id: "w4", from: { componentId: "R_BIT3", pinIndex: 1 }, to: { componentId: "GND1", pinIndex: 0 } },
    ];

    const res = extractElectricalNetlist(components, wires, getPins);
    expect(res.error).toBeUndefined();

    const vBit3 = res.netlist.components.find(c => c.id === "V_BIT3");
    const rBit3 = res.netlist.components.find(c => c.id === "R_BIT3");

    expect(vBit3).toBeDefined();
    expect(rBit3).toBeDefined();
    // DATA[3] y DATA_3 deben mapearse canónicamente al mismo nodo SPICE
    expect(vBit3?.pins[0]).toBe(rBit3?.pins[0]);
    expect(vBit3?.pins[0]).not.toBe("0");
  });

  test("soporta múltiples circuitos independientes en el lienzo con símbolos GND distintos (GND1, GND2, GND3)", () => {
    const components: ComponentInstance[] = [
      // Circuito 1: V1, R1, GND1
      { id: "V1", type: "vsource", value: 10, x: 0, y: 0, rotation: 0 },
      { id: "R1", type: "resistor", value: 1000, x: 50, y: 0, rotation: 0 },
      { id: "GND1", type: "ground", value: 0, x: 25, y: 50, rotation: 0 },

      // Circuito 2: V2, R2, GND2
      { id: "V2", type: "vsource", value: 5, x: 200, y: 0, rotation: 0 },
      { id: "R2", type: "resistor", value: 2000, x: 250, y: 0, rotation: 0 },
      { id: "GND2", type: "ground", value: 0, x: 225, y: 50, rotation: 0 },

      // Circuito 3: V3, R3, GND3
      { id: "V3", type: "vsource", value: 12, x: 400, y: 0, rotation: 0 },
      { id: "R3", type: "resistor", value: 3000, x: 450, y: 0, rotation: 0 },
      { id: "GND3", type: "ground", value: 0, x: 425, y: 50, rotation: 0 },
    ];

    const getPins = (c: ComponentInstance): PinInstance[] => {
      if (c.type === "ground") {
        return [{ componentId: c.id, pinIndex: 0, x: c.x, y: c.y }];
      }
      return [
        { componentId: c.id, pinIndex: 0, x: c.x, y: c.y - 20 },
        { componentId: c.id, pinIndex: 1, x: c.x, y: c.y + 20 },
      ];
    };

    const wires: WireInstance[] = [
      // Cableado Circuito 1
      { id: "w1_1", from: { componentId: "V1", pinIndex: 0 }, to: { componentId: "R1", pinIndex: 0 } },
      { id: "w1_2", from: { componentId: "V1", pinIndex: 1 }, to: { componentId: "GND1", pinIndex: 0 } },
      { id: "w1_3", from: { componentId: "R1", pinIndex: 1 }, to: { componentId: "GND1", pinIndex: 0 } },

      // Cableado Circuito 2
      { id: "w2_1", from: { componentId: "V2", pinIndex: 0 }, to: { componentId: "R2", pinIndex: 0 } },
      { id: "w2_2", from: { componentId: "V2", pinIndex: 1 }, to: { componentId: "GND2", pinIndex: 0 } },
      { id: "w2_3", from: { componentId: "R2", pinIndex: 1 }, to: { componentId: "GND2", pinIndex: 0 } },

      // Cableado Circuito 3
      { id: "w3_1", from: { componentId: "V3", pinIndex: 0 }, to: { componentId: "R3", pinIndex: 0 } },
      { id: "w3_2", from: { componentId: "V3", pinIndex: 1 }, to: { componentId: "GND3", pinIndex: 0 } },
      { id: "w3_3", from: { componentId: "R3", pinIndex: 1 }, to: { componentId: "GND3", pinIndex: 0 } },
    ];

    const res = extractElectricalNetlist(components, wires, getPins);
    expect(res.error).toBeUndefined();

    // Los 3 símbolos de tierra deben mapearse al nodo global "0"
    expect(res.pinToNodeMap["GND1:0"]).toBe("0");
    expect(res.pinToNodeMap["GND2:0"]).toBe("0");
    expect(res.pinToNodeMap["GND3:0"]).toBe("0");

    const v1 = res.netlist.components.find(c => c.id === "V1");
    const v2 = res.netlist.components.find(c => c.id === "V2");
    const v3 = res.netlist.components.find(c => c.id === "V3");

    expect(v1?.pins[1]).toBe("0");
    expect(v2?.pins[1]).toBe("0");
    expect(v3?.pins[1]).toBe("0");
  });

  test("permite opamp con pines de alimentacion V+/V- flotantes sin falso positivo de nodo huerfano", () => {
    const components: ComponentInstance[] = [
      { id: "U1", type: "opamp", value: 100000, x: 100, y: 100, rotation: 0 },
      { id: "V1", type: "vsource", value: 5, x: 0, y: 100, rotation: 0 },
      { id: "R1", type: "resistor", value: 1000, x: 200, y: 100, rotation: 0 },
      { id: "GND", type: "ground", value: 0, x: 100, y: 200, rotation: 0 },
    ];

    const getPins = (c: ComponentInstance): PinInstance[] => {
      if (c.type === "ground") {
        return [{ componentId: c.id, pinIndex: 0, x: c.x, y: c.y, name: "Tierra (GND)" }];
      }
      if (c.type === "opamp") {
        return [
          { componentId: c.id, pinIndex: 0, x: c.x - 40, y: c.y - 15, name: "In+" },
          { componentId: c.id, pinIndex: 1, x: c.x - 40, y: c.y + 15, name: "In-" },
          { componentId: c.id, pinIndex: 2, x: c.x, y: c.y - 40, name: "V+" },
          { componentId: c.id, pinIndex: 3, x: c.x, y: c.y + 40, name: "V-" },
          { componentId: c.id, pinIndex: 4, x: c.x + 40, y: c.y, name: "Salida" },
        ];
      }
      return [
        { componentId: c.id, pinIndex: 0, x: c.x - 20, y: c.y, name: "Terminal 1" },
        { componentId: c.id, pinIndex: 1, x: c.x + 20, y: c.y, name: "Terminal 2" },
      ];
    };

    const wires: WireInstance[] = [
      { id: "w1", from: { componentId: "V1", pinIndex: 0 }, to: { componentId: "U1", pinIndex: 0 } },
      { id: "w2", from: { componentId: "V1", pinIndex: 1 }, to: { componentId: "GND", pinIndex: 0 } },
      { id: "w3", from: { componentId: "U1", pinIndex: 1 }, to: { componentId: "GND", pinIndex: 0 } },
      { id: "w4", from: { componentId: "U1", pinIndex: 4 }, to: { componentId: "R1", pinIndex: 0 } },
      { id: "w5", from: { componentId: "R1", pinIndex: 1 }, to: { componentId: "GND", pinIndex: 0 } },
    ];

    const res = extractElectricalNetlist(components, wires, getPins);
    expect(res.error).toBeUndefined();
  });

  test("proporciona mensaje de error detallado indicando componente y pin exacto en caso de nodo huerfano", () => {
    const components: ComponentInstance[] = [
      { id: "V1", type: "vsource", value: 5, x: 0, y: 100, rotation: 0 },
      { id: "R1", type: "resistor", value: 1000, x: 100, y: 100, rotation: 0 },
      { id: "GND", type: "ground", value: 0, x: 0, y: 200, rotation: 0 },
    ];

    const getPins = (c: ComponentInstance): PinInstance[] => {
      if (c.type === "ground") {
        return [{ componentId: c.id, pinIndex: 0, x: c.x, y: c.y, name: "Tierra (GND)" }];
      }
      return [
        { componentId: c.id, pinIndex: 0, x: c.x - 20, y: c.y, name: "Terminal 1" },
        { componentId: c.id, pinIndex: 1, x: c.x + 20, y: c.y, name: "Terminal 2" },
      ];
    };

    // R1:1 se deja flotante sin conectar
    const wires: WireInstance[] = [
      { id: "w1", from: { componentId: "V1", pinIndex: 0 }, to: { componentId: "R1", pinIndex: 0 } },
      { id: "w2", from: { componentId: "V1", pinIndex: 1 }, to: { componentId: "GND", pinIndex: 0 } },
    ];

    const res = extractElectricalNetlist(components, wires, getPins);
    expect(res.error).toBeDefined();
    expect(res.error).toContain("Nodo huérfano detectado");
    expect(res.error).toContain("R1 [Terminal 2]");
  });

  test("permite salida de opamp conectada a un puerto/etiqueta net_label sin error de nodo huerfano", () => {
    const components: ComponentInstance[] = [
      { id: "U3", type: "opamp", value: 100000, x: 200, y: 100, rotation: 0 },
      { id: "V1", type: "vsource", value: 5, x: 0, y: 100, rotation: 0 },
      { id: "GND", type: "ground", value: 0, x: 100, y: 200, rotation: 0 },
      { id: "NET1", type: "net_label", label: "NET1", value: "NET1", x: 300, y: 100, rotation: 0 },
    ];

    const getPins = (c: ComponentInstance): PinInstance[] => {
      if (c.type === "ground") {
        return [{ componentId: c.id, pinIndex: 0, x: c.x, y: c.y, name: "Tierra (GND)" }];
      }
      if (c.type === "net_label") {
        return [{ componentId: c.id, pinIndex: 0, x: c.x, y: c.y, name: "NET1" }];
      }
      if (c.type === "opamp") {
        return [
          { componentId: c.id, pinIndex: 0, x: c.x - 40, y: c.y - 15, name: "In+" },
          { componentId: c.id, pinIndex: 1, x: c.x - 40, y: c.y + 15, name: "In-" },
          { componentId: c.id, pinIndex: 2, x: c.x, y: c.y - 40, name: "V+" },
          { componentId: c.id, pinIndex: 3, x: c.x, y: c.y + 40, name: "V-" },
          { componentId: c.id, pinIndex: 4, x: c.x + 40, y: c.y, name: "Salida" },
        ];
      }
      return [
        { componentId: c.id, pinIndex: 0, x: c.x - 20, y: c.y, name: "Terminal 1" },
        { componentId: c.id, pinIndex: 1, x: c.x + 20, y: c.y, name: "Terminal 2" },
      ];
    };

    const wires: WireInstance[] = [
      { id: "w1", from: { componentId: "V1", pinIndex: 0 }, to: { componentId: "U3", pinIndex: 0 } },
      { id: "w2", from: { componentId: "V1", pinIndex: 1 }, to: { componentId: "GND", pinIndex: 0 } },
      { id: "w3", from: { componentId: "U3", pinIndex: 1 }, to: { componentId: "GND", pinIndex: 0 } },
      { id: "w4", from: { componentId: "U3", pinIndex: 4 }, to: { componentId: "NET1", pinIndex: 0 } },
    ];

    const res = extractElectricalNetlist(components, wires, getPins);
    expect(res.error).toBeUndefined();
    expect(res.pinToNodeMap["NET1:0"]).toBe(res.pinToNodeMap["U3:4"]);
  });

  test("extrae correctamente netlist con cables empalmados usando endpoints j_ sin lanzar error de componente inexistente", () => {
    const components: ComponentInstance[] = [
      { id: "V1", type: "vsource", value: 5, x: 0, y: 0, rotation: 0 },
      { id: "R1", type: "resistor", value: 1000, x: 100, y: 0, rotation: 0 },
      { id: "R2", type: "resistor", value: 2000, x: 100, y: 100, rotation: 0 },
      { id: "GND", type: "ground", value: 0, x: 0, y: 100, rotation: 0 },
    ];

    const getPins = (c: ComponentInstance): PinInstance[] => {
      if (c.type === "ground") {
        return [{ componentId: c.id, pinIndex: 0, x: c.x, y: c.y, name: "GND" }];
      }
      return [
        { componentId: c.id, pinIndex: 0, x: c.x - 20, y: c.y, name: "Terminal 1" },
        { componentId: c.id, pinIndex: 1, x: c.x + 20, y: c.y, name: "Terminal 2" },
      ];
    };

    const wires: WireInstance[] = [
      {
        id: "wire_V1_p0_to_j_580_397",
        from: { componentId: "V1", pinIndex: 0 },
        to: { componentId: "j_580_397", pinIndex: 0 },
      },
      {
        id: "wire_j_580_397_to_R1_p0",
        from: { componentId: "j_580_397", pinIndex: 0 },
        to: { componentId: "R1", pinIndex: 0 },
      },
      {
        id: "wire_j_580_397_to_R2_p0",
        from: { componentId: "j_580_397", pinIndex: 0 },
        to: { componentId: "R2", pinIndex: 0 },
      },
      { id: "w_v_gnd", from: { componentId: "V1", pinIndex: 1 }, to: { componentId: "GND", pinIndex: 0 } },
      { id: "w_r1_gnd", from: { componentId: "R1", pinIndex: 1 }, to: { componentId: "GND", pinIndex: 0 } },
      { id: "w_r2_gnd", from: { componentId: "R2", pinIndex: 1 }, to: { componentId: "GND", pinIndex: 0 } },
    ];

    const res = extractElectricalNetlist(components, wires, getPins);
    expect(res.error).toBeUndefined();
    expect(res.pinToNodeMap["V1:0"]).toBe(res.pinToNodeMap["R1:0"]);
    expect(res.pinToNodeMap["V1:0"]).toBe(res.pinToNodeMap["R2:0"]);
  });
});
