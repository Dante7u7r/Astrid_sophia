import type { ComponentInstance } from "../canvas_orchestrator";

export const MCU_8051_PIN_LABELS = [
  "P1.0", "P1.1", "P1.2", "P1.3", "P1.4", "P1.5", "P1.6", "P1.7",
  "RST", "P3.0/RxD", "P3.1/TxD", "P3.2/Int0", "P3.3/Int1", "P3.4/T0", "P3.5/T1", "P3.6/WR", "P3.7/RD",
  "XTAL2", "XTAL1", "GND",
  "P2.0", "P2.1", "P2.2", "P2.3", "P2.4", "P2.5", "P2.6", "P2.7",
  "PSEN", "ALE", "EA", "P0.7", "P0.6", "P0.5", "P0.4", "P0.3", "P0.2", "P0.1", "P0.0", "VCC",
] as const;

export const MCU_AVR_PIN_LABELS = [
  "PC6/RST", "PD0/RXD", "PD1/TXD", "PD2/INT0", "PD3/INT1", "PD4/T0", "VCC",
  "GND", "PB6/XT1", "PB7/XT2", "PD5/T1", "PD6/AIN0", "PD7/AIN1", "PB0/CLKO",
  "PB1/OC1A", "PB2/OC1B", "PB3/MOSI", "PB4/MISO", "PB5/SCK", "AVCC", "AREF",
  "GND", "PC5/SCL", "PC4/SDA", "PC3/ADC3", "PC2/ADC2", "PC1/ADC1", "PC0/ADC0",
] as const;

export const BOARD_PIN_LABELS = [
  "IN (GP0)",
  "OUT (GP1)",
  "ADC (A0)",
  "DAC (D0)",
  "VCC",
  "GND",
] as const;

export interface BoardRenderInfo {
  title: string;
  pcbColor: string;
}

export function getBoardRenderInfo(type: ComponentInstance["type"]): BoardRenderInfo {
  if (type === "arduino_uno") {
    return { title: "ARDUINO", pcbColor: "rgba(0, 100, 150, 0.85)" };
  }
  if (type === "esp32") {
    return { title: "ESP32", pcbColor: "rgba(40, 45, 55, 0.85)" };
  }
  return { title: "RPI PICO", pcbColor: "rgba(0, 120, 60, 0.85)" };
}
