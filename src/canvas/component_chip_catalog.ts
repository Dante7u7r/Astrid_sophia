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

export const MCU_PIC16F84A_PIN_LABELS = [
  "RA2", "RA3", "RA4/T0CKI", "MCLR", "VSS", "RB0/INT", "RB1", "RB2", "RB3",
  "RB4", "RB5", "RB6", "RB7", "VDD", "OSC2", "OSC1", "RA0", "RA1",
] as const;

/**
 * Arduino Uno R3 — 28 pines completos
 * Lado Izquierdo (14 pines): Cabecera de Alimentación + Entradas Analógicas A0-A5
 * Lado Derecho (14 pines): Cabecera Digital D0-D13
 */
export const ARDUINO_UNO_PIN_LABELS = [
  // Lado Izquierdo (Pines 0 a 13)
  "IOREF", "RESET", "3.3V", "5V", "GND", "GND", "VIN",
  "A0", "A1", "A2", "A3", "A4/SDA", "A5/SCL", "GND",
  // Lado Derecho (Pines 14 a 27)
  "D0/RX", "D1/TX", "D2", "D3~", "D4", "D5~", "D6~",
  "D7", "D8", "D9~", "D10~", "D11~", "D12", "D13/LED",
] as const;

/**
 * ESP32 DevKit V1 (NodeMCU-32S) — 30 pines completos
 * Lado Izquierdo (15 pines) / Lado Derecho (15 pines)
 */
export const ESP32_DEVKIT_PIN_LABELS = [
  // Lado Izquierdo (Pines 0 a 14)
  "3V3", "EN", "VP/IO36", "VN/IO39", "IO34", "IO35", "IO32", "IO33",
  "IO25", "IO26", "IO27", "IO14", "IO12", "GND", "IO13",
  // Lado Derecho (Pines 15 a 29)
  "VIN", "GND", "IO23/MOSI", "IO22/SCL", "TX0/IO1", "RX0/IO3", "IO21/SDA",
  "GND", "IO19/MISO", "IO18/SCK", "IO5", "IO17", "IO16", "IO4", "IO2/LED",
] as const;

/**
 * Raspberry Pi Pico (RP2040) — 40 pines DIP-40 completos
 * Lado Izquierdo (20 pines) / Lado Derecho (20 pines)
 */
export const RPI_PICO_PIN_LABELS = [
  // Lado Izquierdo (Pines 0 a 19)
  "GP0", "GP1", "GND", "GP2", "GP3", "GP4", "GP5", "GND", "GP6", "GP7",
  "GP8", "GP9", "GND", "GP10", "GP11", "GP12", "GP13", "GND", "GP14", "GP15",
  // Lado Derecho (Pines 20 a 39)
  "VBUS", "VSYS", "GND", "3V3_EN", "3V3_OUT", "ADC_REF", "GP28/ADC2", "GND", "GP27/ADC1", "GP26/ADC0",
  "RUN", "GP22", "GND", "GP21", "GP20", "GP19", "GP18", "GND", "GP17", "GP16",
] as const;

export const BOARD_PIN_LABELS = ARDUINO_UNO_PIN_LABELS;

export interface BoardRenderInfo {
  title: string;
  subtitle: string;
  pcbColor: string;
  pinCount: number;
}

export function getBoardRenderInfo(type: ComponentInstance["type"]): BoardRenderInfo {
  if (type === "arduino_uno") {
    return {
      title: "ARDUINO UNO",
      subtitle: "ATmega328P R3",
      pcbColor: "rgba(0, 100, 150, 0.90)",
      pinCount: 28,
    };
  }
  if (type === "esp32") {
    return {
      title: "ESP32 DevKit",
      subtitle: "ESP-WROOM-32",
      pcbColor: "rgba(30, 34, 43, 0.92)",
      pinCount: 30,
    };
  }
  return {
    title: "RPI PICO",
    subtitle: "RP2040 DUAL ARM",
    pcbColor: "rgba(0, 120, 60, 0.90)",
    pinCount: 40,
  };
}

