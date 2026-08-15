// ==========================================================================
// MICROCONTROLLER COMPONENT DESCRIPTORS — 8051, AVR, Arduino, ESP32, Pico
// ==========================================================================

import {
  drawDevelopmentBoard,
  drawMcu8051,
  drawMcuAvr,
} from "../../canvas/component_chip_renderer";
import type { ComponentDefinition, LocalPinDefinition } from "../types";

export const Mcu8051Definition: ComponentDefinition = {
  type: "mcu_8051",
  name: "Microcontrolador 8051 (DIP-40)",
  category: "digitales-mcus",
  prefix: "U",
  defaultProperties: { value: "8051", mcuClockSpeed: 12000000 },
  halfExtents: { halfW: 65, halfH: 225 },
  hasStandardLeads: false,
  hasValueLabel: false,
  getPins: () => {
    const pins: LocalPinDefinition[] = [];
    // Pines 0 a 19 en el lado izquierdo
    for (let i = 0; i < 20; i++) {
      pins.push({ index: i, x: -60, y: -200 + i * 20, label: `P${i + 1}` });
    }
    // Pines 20 a 39 en el lado derecho (numeración DIP estándar)
    for (let i = 0; i < 20; i++) {
      pins.push({ index: 20 + i, x: 60, y: 180 - i * 20, label: `P${40 - i}` });
    }
    return pins;
  },
  render: (ctx, comp, state) => {
    drawMcu8051(ctx, comp, state.color);
  },
};

export const McuAvrDefinition: ComponentDefinition = {
  type: "mcu_avr",
  name: "Microcontrolador ATmega328P (DIP-28)",
  category: "digitales-mcus",
  prefix: "U",
  defaultProperties: { value: "ATmega328P", mcuClockSpeed: 16000000 },
  halfExtents: { halfW: 65, halfH: 165 },
  hasStandardLeads: false,
  hasValueLabel: false,
  getPins: () => {
    const pins: LocalPinDefinition[] = [];
    // Pines 0 a 13 en el lado izquierdo
    for (let i = 0; i < 14; i++) {
      pins.push({ index: i, x: -60, y: -140 + i * 20, label: `P${i + 1}` });
    }
    // Pines 14 a 27 en el lado derecho
    for (let i = 0; i < 14; i++) {
      pins.push({ index: 14 + i, x: 60, y: 120 - i * 20, label: `P${28 - i}` });
    }
    return pins;
  },
  render: (ctx, comp, state) => {
    drawMcuAvr(ctx, comp, state.color);
  },
};

const DEV_BOARD_PINS: readonly LocalPinDefinition[] = [
  { index: 0, x: -40, y: -40, label: "5V" },
  { index: 1, x: 40, y: -40, label: "GND" },
  { index: 2, x: -40, y: 0, label: "D2" },
  { index: 3, x: 40, y: 0, label: "D3" },
  { index: 4, x: -40, y: 40, label: "A0" },
  { index: 5, x: 40, y: 40, label: "TX" },
];

export const ArduinoUnoDefinition: ComponentDefinition = {
  type: "arduino_uno",
  name: "Placa Arduino Uno",
  category: "digitales-mcus",
  prefix: "U",
  defaultProperties: { value: "Arduino Uno", mcuClockSpeed: 16000000 },
  halfExtents: { halfW: 45, halfH: 65 },
  hasStandardLeads: false,
  hasValueLabel: false,
  getPins: () => DEV_BOARD_PINS,
  render: (ctx, comp, state) => {
    const isSelected = state.lineWidth > 2.4;
    drawDevelopmentBoard(ctx, comp, state.color, isSelected);
  },
};

export const Esp32Definition: ComponentDefinition = {
  type: "esp32",
  name: "Módulo ESP32 DevKit",
  category: "digitales-mcus",
  prefix: "U",
  defaultProperties: { value: "ESP32", mcuClockSpeed: 240000000 },
  halfExtents: { halfW: 45, halfH: 65 },
  hasStandardLeads: false,
  hasValueLabel: false,
  getPins: () => DEV_BOARD_PINS,
  render: (ctx, comp, state) => {
    const isSelected = state.lineWidth > 2.4;
    drawDevelopmentBoard(ctx, comp, state.color, isSelected);
  },
};

export const RaspberryPiPicoDefinition: ComponentDefinition = {
  type: "raspberry_pi_pico",
  name: "Raspberry Pi Pico (RP2040)",
  category: "digitales-mcus",
  prefix: "U",
  defaultProperties: { value: "RP2040", mcuClockSpeed: 133000000 },
  halfExtents: { halfW: 45, halfH: 65 },
  hasStandardLeads: false,
  hasValueLabel: false,
  getPins: () => DEV_BOARD_PINS,
  render: (ctx, comp, state) => {
    const isSelected = state.lineWidth > 2.4;
    drawDevelopmentBoard(ctx, comp, state.color, isSelected);
  },
};
