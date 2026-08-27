// ==========================================================================
// MICROCONTROLLER COMPONENT DESCRIPTORS — 8051, AVR, Arduino, ESP32, Pico
// ==========================================================================

import {
  drawDevelopmentBoard,
  drawMcu8051,
  drawMcuAvr,
  drawMcuPic16,
} from "../../canvas/component_chip_renderer";
import {
  MCU_8051_PIN_LABELS,
  MCU_AVR_PIN_LABELS,
  MCU_PIC16F84A_PIN_LABELS,
  ARDUINO_UNO_PIN_LABELS,
  ESP32_DEVKIT_PIN_LABELS,
  RPI_PICO_PIN_LABELS,
} from "../../canvas/component_chip_catalog";
import {
  createEsp32Runtime,
  stepEsp32,
  getEsp32DevKitPinVoltages,
  DEVKIT_INDEX_TO_GPIO,
  Esp32RuntimeState,
} from "../../simulation/esp32_runtime";
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
    // Pines 0 a 19 en el lado izquierdo (P1 a P20)
    for (let i = 0; i < 20; i++) {
      pins.push({
        index: i,
        x: -60,
        y: -200 + i * 20,
        label: MCU_8051_PIN_LABELS[i],
        name: `Pin ${i + 1} (${MCU_8051_PIN_LABELS[i]})`,
      });
    }
    // Pines 20 a 39 en el lado derecho (P21 a P40)
    for (let i = 0; i < 20; i++) {
      pins.push({
        index: 20 + i,
        x: 60,
        y: 180 - i * 20,
        label: MCU_8051_PIN_LABELS[20 + i],
        name: `Pin ${40 - i} (${MCU_8051_PIN_LABELS[20 + i]})`,
      });
    }
    return pins;
  },
  render: (ctx, comp, state) => {
    drawMcu8051(ctx, comp, state.color);
  },
  evaluateLiveBehavior: (pinVoltages) => {
    const vVcc = pinVoltages[39] ?? 5.0;
    const iVcc = vVcc > 2.0 ? 0.015 : 0.0;
    return {
      branchCurrents: {
        39: iVcc, // Consumo de corriente nominal ~15mA
        19: -iVcc,
      },
    };
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
      pins.push({
        index: i,
        x: -60,
        y: -140 + i * 20,
        label: MCU_AVR_PIN_LABELS[i],
        name: `Pin ${i + 1} (${MCU_AVR_PIN_LABELS[i]})`,
      });
    }
    // Pines 14 a 27 en el lado derecho
    for (let i = 0; i < 14; i++) {
      pins.push({
        index: 14 + i,
        x: 60,
        y: 120 - i * 20,
        label: MCU_AVR_PIN_LABELS[14 + i],
        name: `Pin ${28 - i} (${MCU_AVR_PIN_LABELS[14 + i]})`,
      });
    }
    return pins;
  },
  render: (ctx, comp, state) => {
    drawMcuAvr(ctx, comp, state.color);
  },
  evaluateLiveBehavior: (pinVoltages) => {
    const vVcc = pinVoltages[6] ?? 5.0;
    const iVcc = vVcc > 2.0 ? 0.010 : 0.0;
    return {
      branchCurrents: {
        6: iVcc, // ~10mA activo
        7: -iVcc,
      },
    };
  },
};

export const ArduinoUnoDefinition: ComponentDefinition = {
  type: "arduino_uno",
  name: "Placa Arduino Uno R3 (28 Pines)",
  category: "digitales-mcus",
  prefix: "U",
  defaultProperties: { value: "Arduino Uno", mcuClockSpeed: 16000000 },
  halfExtents: { halfW: 75, halfH: 155 },
  hasStandardLeads: false,
  hasValueLabel: false,
  getPins: () => {
    const pins: LocalPinDefinition[] = [];
    // 14 Pines en el Lado Izquierdo (Alimentación + Analógicas A0-A5)
    for (let i = 0; i < 14; i++) {
      pins.push({
        index: i,
        x: -70,
        y: -130 + i * 20,
        label: ARDUINO_UNO_PIN_LABELS[i],
        name: `Header Izquierdo [${i}] (${ARDUINO_UNO_PIN_LABELS[i]})`,
      });
    }
    // 14 Pines en el Lado Derecho (Digitales D0-D13)
    for (let i = 0; i < 14; i++) {
      pins.push({
        index: 14 + i,
        x: 70,
        y: -130 + i * 20,
        label: ARDUINO_UNO_PIN_LABELS[14 + i],
        name: `Header Digital [${i}] (${ARDUINO_UNO_PIN_LABELS[14 + i]})`,
      });
    }
    return pins;
  },
  render: (ctx, comp, state) => {
    const isSelected = state.lineWidth > 2.4;
    drawDevelopmentBoard(ctx, comp, state.color, isSelected);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const branchCurrents: Record<number, number> = {};
    // Entrega de 5V en pin 3 y 3.3V en pin 2
    const v5v = pinVoltages[3] ?? 5.0;
    const v3v3 = pinVoltages[2] ?? 3.3;
    branchCurrents[3] = (5.0 - v5v) / 1.0;
    branchCurrents[2] = (3.3 - v3v3) / 1.0;
    // Pines de tierra 4, 5, 13
    branchCurrents[4] = -0.005;
    branchCurrents[5] = -0.005;

    // Reflejo de pin D13 (LED integrado) en glowLevel
    const d13State = comp.mcuPinStates?.[27] ?? 0;
    const glowLevel = d13State === 1 || d13State === "1" ? 1.0 : 0.0;

    return { branchCurrents, glowLevel };
  },
};

export const Esp32Definition: ComponentDefinition = {
  type: "esp32",
  name: "Módulo ESP32 DevKit V1 (30 Pines)",
  category: "digitales-mcus",
  prefix: "U",
  defaultProperties: { value: "ESP32", mcuClockSpeed: 240000000 },
  halfExtents: { halfW: 65, halfH: 165 },
  hasStandardLeads: false,
  hasValueLabel: false,
  getPins: () => {
    const pins: LocalPinDefinition[] = [];
    // 15 Pines en el Lado Izquierdo
    for (let i = 0; i < 15; i++) {
      pins.push({
        index: i,
        x: -60,
        y: -140 + i * 20,
        label: ESP32_DEVKIT_PIN_LABELS[i],
        name: `Pin Izquierdo [${i + 1}] (${ESP32_DEVKIT_PIN_LABELS[i]})`,
      });
    }
    // 15 Pines en el Lado Derecho
    for (let i = 0; i < 15; i++) {
      pins.push({
        index: 15 + i,
        x: 60,
        y: -140 + i * 20,
        label: ESP32_DEVKIT_PIN_LABELS[15 + i],
        name: `Pin Derecho [${30 - i}] (${ESP32_DEVKIT_PIN_LABELS[15 + i]})`,
      });
    }
    return pins;
  },
  render: (ctx, comp, state) => {
    const isSelected = state.lineWidth > 2.4;
    drawDevelopmentBoard(ctx, comp, state.color, isSelected);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const branchCurrents: Record<number, number> = {};

    // 1. Inicializar runtime del ESP32 si no existe
    let runtime = (comp as any)._esp32RuntimeInstance as Esp32RuntimeState | undefined;
    if (!runtime) {
      runtime = createEsp32Runtime(comp.esp32SourceCode);
      (comp as any)._esp32RuntimeInstance = runtime;
    }

    // 2. Extraer tensiones analógicas conectadas a pines GPIO
    const analogVoltages: Record<number, number> = {};
    for (let pinIdx = 0; pinIdx < 30; pinIdx++) {
      const gpio = DEVKIT_INDEX_TO_GPIO[pinIdx];
      if (gpio !== null && gpio !== undefined && pinVoltages[pinIdx] !== undefined) {
        analogVoltages[gpio] = pinVoltages[pinIdx] ?? 0.0;
      }
    }

    // 3. Ejecutar paso de tiempo del ESP32 (~1ms)
    stepEsp32(runtime, 0.001, analogVoltages);

    // 4. Mapear salidas del ESP32 a tensiones y corrientes Thévenin
    const outVoltages = getEsp32DevKitPinVoltages(runtime);
    const rout = 25.0; // Impedancia de salida estándar GPIO

    if (!comp.mcuPinStates) comp.mcuPinStates = {};

    for (let pinIdx = 0; pinIdx < 30; pinIdx++) {
      const gpio = DEVKIT_INDEX_TO_GPIO[pinIdx];
      if (gpio !== null && gpio !== undefined) {
        const vTarget = outVoltages[pinIdx] ?? 0.0;
        const vActual = pinVoltages[pinIdx] ?? vTarget;
        comp.mcuPinStates[pinIdx] = vTarget >= 1.65 ? 1 : 0;

        // Solo generar corriente de rama si el pin está configurado como salida
        if (runtime.pinModes[gpio] === "OUTPUT" || gpio === 25 || gpio === 26) {
          branchCurrents[pinIdx] = (vTarget - vActual) / rout;
        }
      }
    }

    // Pines de alimentación
    const v3v3 = pinVoltages[0] ?? 3.3;
    branchCurrents[0] = (3.3 - v3v3) / 1.0;
    branchCurrents[13] = -0.015; // GND
    branchCurrents[16] = -0.005;
    branchCurrents[22] = -0.005;

    // LED onboard en IO2 (pin 29)
    const io2Val = runtime.digitalOutputs[2] ?? 0;
    const glowLevel = io2Val === 1 ? 1.0 : 0.0;

    return { branchCurrents, glowLevel };
  },
};

export const RaspberryPiPicoDefinition: ComponentDefinition = {
  type: "raspberry_pi_pico",
  name: "Raspberry Pi Pico RP2040 (40 Pines)",
  category: "digitales-mcus",
  prefix: "U",
  defaultProperties: { value: "RP2040", mcuClockSpeed: 133000000 },
  halfExtents: { halfW: 65, halfH: 215 },
  hasStandardLeads: false,
  hasValueLabel: false,
  getPins: () => {
    const pins: LocalPinDefinition[] = [];
    // 20 Pines en el Lado Izquierdo (Pines 1 a 20)
    for (let i = 0; i < 20; i++) {
      pins.push({
        index: i,
        x: -60,
        y: -190 + i * 20,
        label: RPI_PICO_PIN_LABELS[i],
        name: `Pin Izquierdo [${i + 1}] (${RPI_PICO_PIN_LABELS[i]})`,
      });
    }
    // 20 Pines en el Lado Derecho (Pines 21 a 40)
    for (let i = 0; i < 20; i++) {
      pins.push({
        index: 20 + i,
        x: 60,
        y: -190 + i * 20,
        label: RPI_PICO_PIN_LABELS[20 + i],
        name: `Pin Derecho [${40 - i}] (${RPI_PICO_PIN_LABELS[20 + i]})`,
      });
    }
    return pins;
  },
  render: (ctx, comp, state) => {
    const isSelected = state.lineWidth > 2.4;
    drawDevelopmentBoard(ctx, comp, state.color, isSelected);
  },
  evaluateLiveBehavior: (pinVoltages, comp) => {
    const branchCurrents: Record<number, number> = {};
    const v3v3 = pinVoltages[24] ?? 3.3; // Pin 3V3_OUT
    branchCurrents[24] = (3.3 - v3v3) / 1.0;
    branchCurrents[2] = -0.005; // GND

    // LED onboard en GP25 (pin 18)
    const gp25State = comp.mcuPinStates?.[18] ?? 0;
    const glowLevel = gp25State === 1 || gp25State === "1" ? 1.0 : 0.0;

    return { branchCurrents, glowLevel };
  },
};

export const Pic16f84aDefinition: ComponentDefinition = {
  type: "mcu_pic16",
  name: "Microcontrolador PIC16F84A (DIP-18)",
  category: "digitales-mcus",
  prefix: "U",
  defaultProperties: { value: "PIC16F84A", mcuClockSpeed: 4000000 },
  halfExtents: { halfW: 65, halfH: 115 },
  hasStandardLeads: false,
  hasValueLabel: false,
  getPins: () => {
    const pins: LocalPinDefinition[] = [];
    // 9 Pines en el Lado Izquierdo (Pines 1 a 9)
    for (let i = 0; i < 9; i++) {
      pins.push({
        index: i,
        x: -60,
        y: -90 + i * 20,
        label: MCU_PIC16F84A_PIN_LABELS[i],
        name: `Pin ${i + 1} (${MCU_PIC16F84A_PIN_LABELS[i]})`,
      });
    }
    // 9 Pines en el Lado Derecho (Pines 18 a 10)
    for (let i = 0; i < 9; i++) {
      pins.push({
        index: 9 + i,
        x: 60,
        y: 70 - i * 20,
        label: MCU_PIC16F84A_PIN_LABELS[9 + i],
        name: `Pin ${18 - i} (${MCU_PIC16F84A_PIN_LABELS[9 + i]})`,
      });
    }
    return pins;
  },
  render: (ctx, comp, state) => {
    drawMcuPic16(ctx, comp, state.color);
  },
  evaluateLiveBehavior: (pinVoltages) => {
    const vVdd = pinVoltages[13] ?? 5.0; // Pin 14 VDD
    const iVdd = vVdd > 2.0 ? 0.004 : 0.0; // Consumo nominal ~4mA
    return {
      branchCurrents: {
        13: iVdd,
        4: -iVdd, // Pin 5 VSS
      },
    };
  },
};


