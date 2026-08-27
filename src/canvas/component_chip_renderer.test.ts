import { describe, expect, it, vi } from "vitest";
import {
  drawArduinoUnoBoard,
  drawEsp32DevKitBoard,
  drawRpiPicoBoard,
  drawMcu8051,
  drawMcuAvr,
  drawDevelopmentBoard,
} from "./component_chip_renderer";
import {
  ArduinoUnoDefinition,
  Esp32Definition,
  RaspberryPiPicoDefinition,
  Mcu8051Definition,
  McuAvrDefinition,
} from "../components/descriptors/microcontrollers";
import type { ComponentInstance } from "../canvas_orchestrator";

function createMockCanvasContext(): CanvasRenderingContext2D {
  return {
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe("component_chip_renderer & microcontrollers descriptors", () => {
  it("genera los pines completos para Arduino Uno R3 (28 pines)", () => {
    const comp: ComponentInstance = { id: "U1", type: "arduino_uno", x: 0, y: 0, rotation: 0 };
    const pins = ArduinoUnoDefinition.getPins(comp);
    expect(pins).toHaveLength(28);
    expect(pins[0].label).toBe("IOREF");
    expect(pins[3].label).toBe("5V");
    expect(pins[14].label).toBe("D0/RX");
    expect(pins[27].label).toBe("D13/LED");
  });

  it("genera los pines completos para ESP32 DevKit (30 pines)", () => {
    const comp: ComponentInstance = { id: "U2", type: "esp32", x: 0, y: 0, rotation: 0 };
    const pins = Esp32Definition.getPins(comp);
    expect(pins).toHaveLength(30);
    expect(pins[0].label).toBe("3V3");
    expect(pins[14].label).toBe("IO13");
    expect(pins[15].label).toBe("VIN");
    expect(pins[29].label).toBe("IO2/LED");
  });

  it("genera los pines completos para Raspberry Pi Pico RP2040 (40 pines)", () => {
    const comp: ComponentInstance = { id: "U3", type: "raspberry_pi_pico", x: 0, y: 0, rotation: 0 };
    const pins = RaspberryPiPicoDefinition.getPins(comp);
    expect(pins).toHaveLength(40);
    expect(pins[0].label).toBe("GP0");
    expect(pins[19].label).toBe("GP15");
    expect(pins[20].label).toBe("VBUS");
    expect(pins[39].label).toBe("GP16");
  });

  it("genera los pines completos para 8051 (DIP-40) y ATmega328P (DIP-28)", () => {
    const comp8051: ComponentInstance = { id: "U4", type: "mcu_8051", x: 0, y: 0, rotation: 0 };
    const pins8051 = Mcu8051Definition.getPins(comp8051);
    expect(pins8051).toHaveLength(40);
    expect(pins8051[0].label).toBe("P1.0");
    expect(pins8051[39].label).toBe("VCC");

    const compAvr: ComponentInstance = { id: "U5", type: "mcu_avr", x: 0, y: 0, rotation: 0 };
    const pinsAvr = McuAvrDefinition.getPins(compAvr);
    expect(pinsAvr).toHaveLength(28);
    expect(pinsAvr[0].label).toBe("PC6/RST");
    expect(pinsAvr[6].label).toBe("VCC");
  });

  it("renderiza todas las placas y chips en Canvas 2D sin excepciones", () => {
    const ctx = createMockCanvasContext();
    const compArduino: ComponentInstance = { id: "U1", type: "arduino_uno", x: 0, y: 0, rotation: 0, mcuPinStates: { 27: 1 } };
    const compEsp32: ComponentInstance = { id: "U2", type: "esp32", x: 0, y: 0, rotation: 0, mcuPinStates: { 29: 1 } };
    const compPico: ComponentInstance = { id: "U3", type: "raspberry_pi_pico", x: 0, y: 0, rotation: 0, mcuPinStates: { 18: 1 } };
    const comp8051: ComponentInstance = { id: "U4", type: "mcu_8051", x: 0, y: 0, rotation: 0 };
    const compAvr: ComponentInstance = { id: "U5", type: "mcu_avr", x: 0, y: 0, rotation: 0 };

    expect(() => drawArduinoUnoBoard(ctx, compArduino, "#38BDF8", true)).not.toThrow();
    expect(() => drawEsp32DevKitBoard(ctx, compEsp32, "#38BDF8", false)).not.toThrow();
    expect(() => drawRpiPicoBoard(ctx, compPico, "#38BDF8", false)).not.toThrow();
    expect(() => drawMcu8051(ctx, comp8051, "#38BDF8")).not.toThrow();
    expect(() => drawMcuAvr(ctx, compAvr, "#38BDF8")).not.toThrow();
    expect(() => drawDevelopmentBoard(ctx, compArduino, "#38BDF8", false)).not.toThrow();
  });
});
