import { describe, expect, it } from "vitest";
import {
  ARDUINO_UNO_PIN_LABELS,
  ESP32_DEVKIT_PIN_LABELS,
  RPI_PICO_PIN_LABELS,
  MCU_8051_PIN_LABELS,
  MCU_AVR_PIN_LABELS,
  getBoardRenderInfo,
} from "./component_chip_catalog";

describe("component_chip_catalog", () => {
  it("mantiene el conteo real de pines de encapsulados MCU y placas de desarrollo", () => {
    expect(MCU_8051_PIN_LABELS).toHaveLength(40);
    expect(MCU_AVR_PIN_LABELS).toHaveLength(28);
    expect(ARDUINO_UNO_PIN_LABELS).toHaveLength(28);
    expect(ESP32_DEVKIT_PIN_LABELS).toHaveLength(30);
    expect(RPI_PICO_PIN_LABELS).toHaveLength(40);
  });

  it("mantiene etiquetas eléctricas y de periféricos críticas", () => {
    expect(MCU_8051_PIN_LABELS[19]).toBe("GND");
    expect(MCU_8051_PIN_LABELS[39]).toBe("VCC");
    expect(MCU_AVR_PIN_LABELS[6]).toBe("VCC");
    expect(MCU_AVR_PIN_LABELS[7]).toBe("GND");

    expect(ARDUINO_UNO_PIN_LABELS).toContain("5V");
    expect(ARDUINO_UNO_PIN_LABELS).toContain("3.3V");
    expect(ARDUINO_UNO_PIN_LABELS).toContain("GND");
    expect(ARDUINO_UNO_PIN_LABELS).toContain("A0");
    expect(ARDUINO_UNO_PIN_LABELS).toContain("D13/LED");

    expect(ESP32_DEVKIT_PIN_LABELS).toContain("3V3");
    expect(ESP32_DEVKIT_PIN_LABELS).toContain("GND");
    expect(ESP32_DEVKIT_PIN_LABELS).toContain("IO2/LED");

    expect(RPI_PICO_PIN_LABELS).toContain("3V3_OUT");
    expect(RPI_PICO_PIN_LABELS).toContain("VBUS");
    expect(RPI_PICO_PIN_LABELS).toContain("GND");
  });

  it("resuelve información visual de placas de desarrollo", () => {
    expect(getBoardRenderInfo("arduino_uno").title).toBe("ARDUINO UNO");
    expect(getBoardRenderInfo("esp32").title).toBe("ESP32 DevKit");
    expect(getBoardRenderInfo("raspberry_pi_pico").title).toBe("RPI PICO");
  });
});

