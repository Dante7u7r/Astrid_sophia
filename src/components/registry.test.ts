import { describe, expect, it } from "vitest";
import type { ComponentInstance } from "../canvas_orchestrator";
import {
  ComponentRegistry,
  globalComponentRegistry,
} from "./registry";
import { ALL_COMPONENT_DEFINITIONS } from "./descriptors/index";
import type { ComponentDefinition } from "./types";

describe("ComponentRegistry & ComponentDescriptor System", () => {
  it("contiene registrados todos los 83 componentes del catálogo estándar", () => {
    const all = globalComponentRegistry.getAll();
    expect(all.length).toBe(83);
    expect(ALL_COMPONENT_DEFINITIONS.length).toBe(83);

    const expectedTypes: ComponentInstance["type"][] = [
      "resistor",
      "capacitor",
      "inductor",
      "potentiometer",
      "ldr",
      "thermistor",
      "fuse",
      "ground",
      "transformer",
      "dmm",
      "wattmeter",
      "logic_probe",
      "pulse_generator",
      "frequency_counter",
      "stb_probe",
      "diode",
      "zener_diode",
      "schottky_diode",
      "led",
      "nmos",
      "pmos",
      "igbt",
      "npn",
      "pnp",
      "njf",
      "pjf",
      "opto",
      "bsim3nmos",
      "bsim3pmos",
      "bsim4nmos",
      "bsim4pmos",
      "scr",
      "triac",
      "diac",
      "tl431",
      "opamp",
      "opamp_ideal",
      "vsource",
      "isource",
      "vcvs",
      "vccs",
      "ccvs",
      "cccs",
      "lamp",
      "relay",
      "buzzer",
      "switch",
      "switch_spdt",
      "switch_dpdt",
      "pushbutton",
      "dc_motor",
      "servo_motor",
      "stepper_motor",
      "speaker",
      "solenoid",
      "ssr",
      "seven_segment",
      "lcd_16x2",
      "and_gate",
      "or_gate",
      "not_gate",
      "nand_gate",
      "nor_gate",
      "xor_gate",
      "flipflop_d",
      "flipflop_jk",
      "bcd_to_7seg",
      "shift_register_595",
      "ic_4017",
      "ic_7490",
      "ic_74193",
      "ic_74138",
      "ic_74151",
      "mcu_8051",
      "mcu_avr",
      "mcu_pic16",
      "arduino_uno",
      "esp32",
      "raspberry_pi_pico",
      "net_label",
      "power_port",
      "text_note",
      "x",
    ];

    for (const type of expectedTypes) {
      expect(globalComponentRegistry.has(type)).toBe(true);
      const def = globalComponentRegistry.get(type);
      expect(def).toBeDefined();
      expect(def?.type).toBe(type);
      expect(def?.name).toBeTruthy();
      expect(def?.category).toBeTruthy();
      expect(def?.prefix).toBeTruthy();
    }
  });

  it("calcula los terminales y aplica la rotación y espejo adecuadamente", () => {
    const comp: ComponentInstance = {
      id: "R1",
      type: "resistor",
      value: 1000,
      x: 100,
      y: 200,
      rotation: 90,
    };

    const pins = globalComponentRegistry.getPins(comp);
    expect(pins).toHaveLength(2);
    // Pin 0 en espacio local (-40, 0) rotado 90 deg -> (0, -40) -> mundo (100, 160)
    expect(pins[0].x).toBeCloseTo(100);
    expect(pins[0].y).toBeCloseTo(160);
    // Pin 1 en espacio local (40, 0) rotado 90 deg -> (0, 40) -> mundo (100, 240)
    expect(pins[1].x).toBeCloseTo(100);
    expect(pins[1].y).toBeCloseTo(240);
  });

  it("evalúa la física y corrientes en vivo para resistencias, diodos y LEDs", () => {
    // 1. Resistencia (Ley de Ohm)
    const rComp: ComponentInstance = {
      id: "R1",
      type: "resistor",
      value: 1000,
      x: 0,
      y: 0,
      rotation: 0,
    };
    const rBehavior = globalComponentRegistry.evaluateLiveBehavior(rComp, { 0: 5, 1: 0 });
    expect(rBehavior?.branchCurrents?.[0]).toBeCloseTo(0.005);
    expect(rBehavior?.branchCurrents?.[1]).toBeCloseTo(-0.005);

    // 2. LED (Polarización directa y brillo)
    const ledComp: ComponentInstance = {
      id: "LED1",
      type: "led",
      value: 0,
      x: 0,
      y: 0,
      rotation: 0,
    };
    // Polarización directa 2.1V (ánodo 2.1V, cátodo 0V)
    const ledForward = globalComponentRegistry.evaluateLiveBehavior(ledComp, { 0: 2.1, 1: 0 });
    expect(ledForward?.glowLevel).toBeGreaterThan(0.5);
    expect(ledForward?.branchCurrents?.[0]).toBeGreaterThan(0);
    expect(ledComp.glowLevel).toBeGreaterThan(0.5);

    // Polarización inversa (-2.1V)
    const ledReverse = globalComponentRegistry.evaluateLiveBehavior(ledComp, { 0: 0, 1: 2.1 });
    expect(ledReverse?.glowLevel).toBe(0);
    expect(ledReverse?.branchCurrents?.[0]).toBe(0);
  });

  it("evalúa actuadores: interruptores y relés", () => {
    const swComp: ComponentInstance = {
      id: "SW1",
      type: "switch",
      value: 0,
      switchState: true,
      x: 0,
      y: 0,
      rotation: 0,
    };
    const swClosed = globalComponentRegistry.evaluateLiveBehavior(swComp, { 0: 5, 1: 0 });
    expect(swClosed?.branchCurrents?.[0]).toBeCloseTo(100);

    swComp.switchState = false;
    const swOpen = globalComponentRegistry.evaluateLiveBehavior(swComp, { 0: 5, 1: 0 });
    expect(swOpen?.branchCurrents?.[0]).toBe(0);
  });

  it("permite registrar componentes personalizados dinámicamente", () => {
    const customRegistry = new ComponentRegistry();
    const customDef: ComponentDefinition = {
      type: "resistor",
      name: "Super Resistor",
      category: "pasivos",
      prefix: "SR",
      halfExtents: { halfW: 50, halfH: 20 },
      getPins: () => [{ index: 0, x: -50, y: 0 }, { index: 1, x: 50, y: 0 }],
      render: () => {},
    };

    customRegistry.register(customDef);
    expect(customRegistry.has("resistor")).toBe(true);
    expect(customRegistry.getPrefix("resistor")).toBe("SR");
  });

  it("resuelve etiquetas y nombres de terminales positivo/negativo en capacitores polarizados y diodos", () => {
    // 1. Capacitor electrolítico polarizado
    const elecCap: ComponentInstance = {
      id: "C_ELEC",
      type: "capacitor",
      value: 10e-6,
      dielectricType: "electrolytic",
      x: 0,
      y: 0,
      rotation: 0,
    };
    const capPins = globalComponentRegistry.getPins(elecCap);
    expect(capPins[0].label).toBe("+");
    expect(capPins[0].name).toContain("Positivo");
    expect(capPins[1].label).toBe("-");
    expect(capPins[1].name).toContain("Negativo");

    // 2. Diodo rectificador
    const diode: ComponentInstance = {
      id: "D1",
      type: "diode",
      value: 0,
      x: 0,
      y: 0,
      rotation: 0,
    };
    const diodePins = globalComponentRegistry.getPins(diode);
    expect(diodePins[0].label).toBe("A");
    expect(diodePins[0].name).toContain("Ánodo");
    expect(diodePins[1].label).toBe("K");
    expect(diodePins[1].name).toContain("Cátodo");
  });
});
