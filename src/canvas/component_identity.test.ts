import { describe, expect, test } from "vitest";
import {
  CanvasOrchestrator,
  findDuplicateComponentIds,
  generateUniqueComponentId,
  type ComponentInstance,
} from "../canvas_orchestrator";
import { extractElectricalNetlist } from "../simulation/netlist_extractor";

function createOrchestrator(): CanvasOrchestrator {
  const canvas = {
    getContext: () => ({}),
    style: {},
  } as unknown as HTMLCanvasElement;
  return new CanvasOrchestrator(canvas);
}

function makeComponent(id: string, type: ComponentInstance["type"] = "resistor"): ComponentInstance {
  return { id, type, value: 1, x: 0, y: 0, rotation: 0 };
}

describe("identidad global de componentes", () => {
  test("familias con prefijo compartido reciben IDs distintos", () => {
    const orchestrator = createOrchestrator();

    expect(orchestrator.addComponent("nmos", 0, 0, 1).id).toBe("M1");
    expect(orchestrator.addComponent("pmos", 0, 0, 1).id).toBe("M2");
    expect(orchestrator.addComponent("npn", 0, 0, 1).id).toBe("Q1");
    expect(orchestrator.addComponent("pnp", 0, 0, 1).id).toBe("Q2");
    expect(orchestrator.addComponent("opamp", 0, 0, 1).id).toBe("U1");
    expect(orchestrator.addComponent("mcu_8051", 0, 0, 1).id).toBe("U2");
  });

  test("componentes especiales no caen en el prefijo R", () => {
    const orchestrator = createOrchestrator();

    expect(orchestrator.addComponent("resistor", 0, 0, 1).id).toBe("R1");
    expect(orchestrator.addComponent("potentiometer", 0, 0, 1).id).toBe("RV1");
    expect(orchestrator.addComponent("ldr", 0, 0, 1).id).toBe("LDR1");
    expect(orchestrator.addComponent("thermistor", 0, 0, 1).id).toBe("RT1");
    expect(orchestrator.addComponent("dmm", 0, 0, 1).id).toBe("DMM1");
  });

  test("multimetro, switch y transformador nacen con contratos validos", () => {
    const orchestrator = createOrchestrator();
    const dmm = orchestrator.addComponent("dmm", 0, 0, "V");
    const switchComponent = orchestrator.addComponent("switch", 0, 0, 0);
    const transformer = orchestrator.addComponent("transformer", 0, 0, 1e-3);

    expect(dmm).toMatchObject({ value: "V", dmmValue: "OPEN" });
    expect(switchComponent).toMatchObject({
      switchState: false,
      switchRon: 0.01,
      switchRoff: 1e9,
      switchVth: 0.5,
      switchVh: 0.05,
    });
    expect(transformer).toMatchObject({
      primaryInductance: 1e-3,
      secondaryInductance: 1e-3,
      couplingCoefficient: 0.9,
    });
  });

  test("duplicar conserva propiedades especiales y clona el firmware", () => {
    const orchestrator = createOrchestrator();
    const source = orchestrator.addComponent("mcu_8051", 0, 0, 0);
    source.firmwareHex = ":020000040000FA";
    source.firmware = Uint8Array.from([1, 2, 3]);
    source.mcuClockSpeed = 12e6;
    orchestrator.selectedComponent = source;

    orchestrator.duplicateSelected();
    const duplicate = orchestrator.selectedComponent!;

    expect(duplicate.id).not.toBe(source.id);
    expect(duplicate.firmwareHex).toBe(source.firmwareHex);
    expect(Array.from(duplicate.firmware ?? [])).toEqual([1, 2, 3]);
    expect(duplicate.firmware).not.toBe(source.firmware);
    expect(duplicate.mcuClockSpeed).toBe(12e6);
  });

  test("borrar un componente no reutiliza ni duplica el sufijo maximo", () => {
    const orchestrator = createOrchestrator();
    const first = orchestrator.addComponent("resistor", 0, 0, 1);
    orchestrator.addComponent("resistor", 0, 0, 1);
    orchestrator.removeComponent(first.id);

    expect(orchestrator.addComponent("resistor", 0, 0, 1).id).toBe("R3");
  });

  test("generador considera IDs sin importar mayusculas", () => {
    expect(generateUniqueComponentId([makeComponent("m1", "nmos")], "pmos")).toBe("M2");
    expect(findDuplicateComponentIds([makeComponent("R1"), makeComponent("r1")])).toEqual(["R1"]);
  });

  test("renombrar actualiza extremos e identificador del cable", () => {
    const orchestrator = createOrchestrator();
    const resistor = orchestrator.addComponent("resistor", 0, 0, 1000);
    const ground = orchestrator.addComponent("ground", 100, 0, 0);
    orchestrator.connectPins(
      { componentId: resistor.id, pinIndex: 0, x: 0, y: 0 },
      { componentId: ground.id, pinIndex: 0, x: 100, y: 0 },
    );

    expect(orchestrator.renameComponent(resistor, "R_LOAD")).toBeNull();
    expect(resistor.id).toBe("R_LOAD");
    expect(orchestrator.wires[0].from.componentId).toBe("R_LOAD");
    expect(orchestrator.wires[0].id).toContain("R_LOAD");
  });

  test("renombrar rechaza duplicados e IDs invalidos", () => {
    const orchestrator = createOrchestrator();
    const first = orchestrator.addComponent("resistor", 0, 0, 1000);
    orchestrator.addComponent("resistor", 100, 0, 1000);

    expect(orchestrator.renameComponent(first, "r2")).toContain("ya existe");
    expect(orchestrator.renameComponent(first, "1 resistor")).toContain("debe comenzar");
    expect(first.id).toBe("R1");
  });
});

describe("pre-flight de identidad de netlist", () => {
  const noPins = () => [];
  const twoPins = (component: ComponentInstance) => [
    { componentId: component.id, pinIndex: 0, x: 0, y: 0 },
    { componentId: component.id, pinIndex: 1, x: 40, y: 0 },
  ];

  test("rechaza componentes duplicados antes de construir nodos", () => {
    const result = extractElectricalNetlist(
      [makeComponent("R1"), makeComponent("r1")],
      [],
      noPins,
    );

    expect(result.error).toContain("duplicados");
    expect(result.netlist.components).toEqual([]);
  });

  test("rechaza cables que apuntan a componentes inexistentes", () => {
    const result = extractElectricalNetlist(
      [makeComponent("R1")],
      [{
        id: "wire_roto",
        from: { componentId: "R1", pinIndex: 0 },
        to: { componentId: "R404", pinIndex: 0 },
        points: [],
      }],
      noPins,
    );

    expect(result.error).toContain("componentes inexistentes");
  });

  test("rechaza IDs de cable duplicados", () => {
    const components = [makeComponent("R1"), makeComponent("R2")];
    const wire = {
      id: "W1",
      from: { componentId: "R1", pinIndex: 0 },
      to: { componentId: "R2", pinIndex: 0 },
      points: [],
    };
    const result = extractElectricalNetlist(components, [wire, { ...wire, id: "w1" }], twoPins);

    expect(result.error).toContain("cable duplicados");
  });

  test("rechaza cables conectados a pines inexistentes", () => {
    const result = extractElectricalNetlist(
      [makeComponent("R1"), makeComponent("R2")],
      [{
        id: "W1",
        from: { componentId: "R1", pinIndex: 99 },
        to: { componentId: "R2", pinIndex: 0 },
        points: [],
      }],
      twoPins,
    );

    expect(result.error).toContain("terminales inexistentes");
  });
});
