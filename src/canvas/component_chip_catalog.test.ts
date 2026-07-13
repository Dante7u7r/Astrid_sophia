import { describe, expect, it } from "vitest";
import {
  BOARD_PIN_LABELS,
  MCU_8051_PIN_LABELS,
  MCU_AVR_PIN_LABELS,
  getBoardRenderInfo,
} from "./component_chip_catalog";

describe("component_chip_catalog", () => {
  it("mantiene el conteo de pines de encapsulados MCU", () => {
    expect(MCU_8051_PIN_LABELS).toHaveLength(40);
    expect(MCU_AVR_PIN_LABELS).toHaveLength(28);
    expect(BOARD_PIN_LABELS).toHaveLength(6);
  });

  it("mantiene etiquetas electricas criticas", () => {
    expect(MCU_8051_PIN_LABELS[19]).toBe("GND");
    expect(MCU_8051_PIN_LABELS[39]).toBe("VCC");
    expect(MCU_AVR_PIN_LABELS[6]).toBe("VCC");
    expect(MCU_AVR_PIN_LABELS[7]).toBe("GND");
    expect(BOARD_PIN_LABELS).toContain("GND");
  });

  it("resuelve informacion visual de placas", () => {
    expect(getBoardRenderInfo("arduino_uno").title).toBe("ARDUINO");
    expect(getBoardRenderInfo("esp32").title).toBe("ESP32");
    expect(getBoardRenderInfo("raspberry_pi_pico").title).toBe("RPI PICO");
  });
});
