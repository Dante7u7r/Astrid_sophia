import { describe, expect, test } from "vitest";
import type { ComponentInstance } from "../canvas_orchestrator";
import {
  CURRENT_CIRCUIT_FILE_VERSION,
  cloneCircuitComponents,
  parseCircuitFile,
  serializeCircuitFile,
  type CircuitFileSnapshot,
} from "./circuit_file";

function completeSnapshot(): CircuitFileSnapshot {
  const component: ComponentInstance = {
    id: "X1",
    type: "x",
    value: 12,
    x: 120,
    y: -40,
    rotation: 90,
    mirror: true,
    waveType: "pulse",
    amplitude: 3.3,
    frequency: 8000,
    offset: 0.2,
    offsetVoltage: 0.001,
    openLoopGain: 200000,
    dutyCycle: 0.4,
    wiperPosition: 0.65,
    lux: 450,
    temperatureCelsius: 72,
    relayClosed: true,
    firmwareHex: ":020000040000FA",
    firmware: Uint8Array.from([0, 1, 127, 255]),
    mcuClockSpeed: 16_000_000,
    primaryInductance: 0.001,
    secondaryInductance: 0.004,
    couplingCoefficient: 0.97,
    switchRon: 0.02,
    switchRoff: 1e9,
    switchVth: 2.4,
    switchVh: 0.2,
    switchState: true,
    spiceMacro: ".subckt demo a b\nR1 a b 1k\n.ends",
    pinCount: 8,
    selected: true,
    dmmValue: "3.300 V",
    glowLevel: 0.8,
  };

  return {
    components: [component],
    wires: [],
    viewport: { zoom: 1.75, offsetX: 320, offsetY: 180 },
    simSettings: { dt: 1e-6, tolerance: 1e-8, maxIterations: 250 },
    activeAnalysisMode: "TRAN",
    probes: {
      ch1ProbeNode: "1",
      ch2ProbeNode: "2",
      ch3ProbeNode: "7",
      ch4ProbeNode: null,
    },
    sparPorts: [{ nodeId: "7", z0: 75 }],
    oscilloscope: {
      channelsEnabled: [true, true, false, true],
      voltsPerDiv: [0.2, 0.5, 1, 5],
      offsets: [4, -5, 0, 10],
      timeDivValue: 0.005,
      isXyMode: true,
      isCursorsEnabled: true,
      triggerChannel: "ch4",
      triggerEdge: "falling",
      triggerLevel: 1.25,
      cursorT1: 0.1,
      cursorT2: 0.9,
      cursorV1: 2.2,
      cursorV2: -2.2,
    },
  };
}

describe("archivo .astryd 3.0", () => {
  test("conserva propiedades configurables en ida y vuelta", () => {
    const serialized = serializeCircuitFile(completeSnapshot());
    const parsed = parseCircuitFile(serialized);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.data.version).toBe(CURRENT_CIRCUIT_FILE_VERSION);
    expect(parsed.data.components[0]).toMatchObject({
      id: "X1",
      mirror: true,
      wiperPosition: 0.65,
      lux: 450,
      temperatureCelsius: 72,
      relayClosed: true,
      mcuClockSpeed: 16_000_000,
      couplingCoefficient: 0.97,
      switchState: true,
      pinCount: 8,
    });
    expect(Array.from(parsed.data.components[0].firmware ?? [])).toEqual([0, 1, 127, 255]);
    expect(parsed.data.probes.ch3ProbeNode).toBe("7");
    expect(parsed.data.probes.ch4ProbeNode).toBeNull();
    expect(parsed.data.sparPorts).toEqual([{ nodeId: "7", z0: 75 }]);
    expect(parsed.data.oscilloscope.triggerChannel).toBe("ch4");
    expect(parsed.data.oscilloscope.channelsEnabled).toEqual([true, true, false, true]);
  });

  test("no persiste estado efimero de render o runtime", () => {
    const raw = JSON.parse(serializeCircuitFile(completeSnapshot()));
    const component = raw.components[0];

    expect(component.selected).toBeUndefined();
    expect(component.dmmValue).toBeUndefined();
    expect(component.glowLevel).toBeUndefined();
    expect(component.mcuRuntime).toBeUndefined();
  });

  test("clonado entre pestanas conserva Uint8Array de firmware", () => {
    const source = completeSnapshot().components;
    const cloned = cloneCircuitComponents(source);

    expect(cloned).not.toBe(source);
    expect(cloned[0].firmware).toBeInstanceOf(Uint8Array);
    expect(Array.from(cloned[0].firmware ?? [])).toEqual([0, 1, 127, 255]);
    expect(cloned[0].selected).toBeUndefined();
  });

  test("migra archivos 2.0 y conserva propiedades legacy disponibles", () => {
    const legacy = JSON.stringify({
      version: "2.0",
      components: [{
        id: "U1",
        type: "arduino_uno",
        value: 0,
        x: 0,
        y: 0,
        rotation: 0,
        mcuClockSpeed: 16_000_000,
      }],
      wires: [],
      probes: { ch1ProbeNode: "5", ch2ProbeNode: null },
      activeAnalysisMode: "TRAN",
    });

    const parsed = parseCircuitFile(legacy);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.migratedFrom).toBe("2.0");
    expect(parsed.data.version).toBe("3.0");
    expect(parsed.data.components[0].mcuClockSpeed).toBe(16_000_000);
    expect(parsed.data.probes).toEqual({
      ch1ProbeNode: "5",
      ch2ProbeNode: null,
      ch3ProbeNode: "3",
      ch4ProbeNode: "4",
    });
  });

  test("rechaza duplicados y referencias rotas", () => {
    const duplicate = parseCircuitFile(JSON.stringify({
      version: "3.0",
      components: [
        { id: "R1", type: "resistor", value: 1, x: 0, y: 0, rotation: 0 },
        { id: "r1", type: "resistor", value: 2, x: 40, y: 0, rotation: 0 },
      ],
      wires: [],
    }));
    expect(duplicate.ok).toBe(false);

    const dangling = parseCircuitFile(JSON.stringify({
      version: "3.0",
      components: [{ id: "R1", type: "resistor", value: 1, x: 0, y: 0, rotation: 0 }],
      wires: [{
        id: "W1",
        from: { componentId: "R1", pinIndex: 0 },
        to: { componentId: "R404", pinIndex: 0 },
        points: [],
      }],
    }));
    expect(dangling.ok).toBe(false);
  });

  test("rechaza JSON malformado y versiones futuras", () => {
    expect(parseCircuitFile("{").ok).toBe(false);
    expect(parseCircuitFile(JSON.stringify({
      version: "99.0",
      components: [],
      wires: [],
    })).ok).toBe(false);
    expect(parseCircuitFile(JSON.stringify({
      version: "3.0",
      components: [],
      wires: [],
      simSettings: { dt: 0 },
    })).ok).toBe(false);
    expect(parseCircuitFile(JSON.stringify({
      version: "3.0",
      components: [],
      wires: [],
      oscilloscope: { channelsEnabled: [true] },
    })).ok).toBe(false);
  });
});
