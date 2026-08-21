/**
 * Motor de Sincronización Cycle-Accurate ↔ SPICE y Disparador de Interrupciones Event-Driven.
 *
 * Proporciona:
 * 1. McuClockSynchronizer: Sincronización libre de deriva temporal acumulando fracciones de ciclo (zero clock drift)
 *    para acoplar pasos transitorios analógicos arbitrarios (dt) con frecuencias de reloj MCU (f_mcu).
 * 2. AnalogThresholdEventDetector: Detección continua de cruces de umbral de tensión analógica (Rising / Falling / Level)
 *    con histéresis configurable para disparar interrupciones por hardware event-driven en la MCU (INT0, INT1, PCINT, ICP1).
 * 3. CoSimulationSyncEngine: Orquestación coordinada de co-simulación mixta analógica/digital con retroalimentación cerrada.
 */

import type { McuRuntime } from "./mcu-runtime";
import { runCycles, injectHardwareInterrupt } from "./mcu-runtime";
import type { AnalogEventTrigger, DigitalThresholdDirection } from "./mcu-types";
import { readDataSpace, IO_PORTB, IO_PORTC, IO_PORTD } from "./mcu-avr";
import { readDirect } from "./mcu-8051";

// ============================================================================
// 1. SINCRONIZADOR DE RELOJ CYCLE-ACCURATE (ZERO CLOCK DRIFT)
// ============================================================================

export interface ClockSyncState {
  accumulatedFractionalTime: number; // Segundos acumulados que aún no completan un ciclo entero
  totalCyclesExecuted: number;
  totalSimulatedTime: number;
}

export class McuClockSynchronizer {
  readonly clockSpeedHz: number;
  readonly clockPeriod: number; // T_clk = 1 / f_mcu

  private fractionalTime: number = 0;
  private totalCycles: number = 0;
  private totalTime: number = 0;

  constructor(clockSpeedHz: number = 16_000_000) {
    this.clockSpeedHz = Math.max(1, clockSpeedHz);
    this.clockPeriod = 1.0 / this.clockSpeedHz;
  }

  reset(): void {
    this.fractionalTime = 0;
    this.totalCycles = 0;
    this.totalTime = 0;
  }

  /**
   * Calcula el número entero exacto de ciclos MCU a ejecutar para un paso dt,
   * conservando las fracciones de segundo para el siguiente paso transitorio.
   */
  calculateCyclesForTimestep(dtSeconds: number): number {
    if (dtSeconds <= 0) return 0;

    const availableTime = this.fractionalTime + dtSeconds;
    const cycles = Math.floor(availableTime * this.clockSpeedHz);
    this.fractionalTime = availableTime - cycles * this.clockPeriod;

    this.totalCycles += cycles;
    this.totalTime += dtSeconds;

    return cycles;
  }

  getState(): ClockSyncState {
    return {
      accumulatedFractionalTime: this.fractionalTime,
      totalCyclesExecuted: this.totalCycles,
      totalSimulatedTime: this.totalTime,
    };
  }
}

// ============================================================================
// 2. DETECTOR DE EVENTOS ANALÓGICOS (EVENT-DRIVEN INTERRUPTS)
// ============================================================================

export interface MonitoredAnalogPin {
  componentId: string;
  pinIndex: number;
  nodeId: string;
  thresholdVoltage: number;
  direction: DigitalThresholdDirection;
  interruptVector: number;
  hysteresis: number;
  state: boolean; // false = Low, true = High
}

export class AnalogThresholdEventDetector {
  private monitoredPins: MonitoredAnalogPin[] = [];

  registerPin(config: {
    componentId: string;
    pinIndex: number;
    nodeId: string;
    thresholdVoltage?: number;
    direction?: DigitalThresholdDirection;
    interruptVector: number;
    hysteresis?: number;
  }): void {
    const vth = config.thresholdVoltage ?? 2.5;
    this.monitoredPins.push({
      componentId: config.componentId,
      pinIndex: config.pinIndex,
      nodeId: config.nodeId,
      thresholdVoltage: vth,
      direction: config.direction ?? "rising",
      interruptVector: config.interruptVector,
      hysteresis: config.hysteresis ?? 0.05,
      state: false,
    });
  }

  clearPins(): void {
    this.monitoredPins = [];
  }

  /**
   * Evalúa el estado de las tensiones nodales analógicas y retorna los eventos
   * de cruce de umbral detectados en este paso temporal mediante comparador con histéresis (Schmitt Trigger).
   */
  detectCrossingEvents(
    nodeVoltages: Record<string, number>,
  ): AnalogEventTrigger[] {
    const triggers: AnalogEventTrigger[] = [];

    for (const pin of this.monitoredPins) {
      const currentVoltage = nodeVoltages[pin.nodeId] ?? 0.0;
      const vth = pin.thresholdVoltage;
      const hyst = pin.hysteresis;

      let triggered = false;

      if (!pin.state && currentVoltage >= (vth + hyst)) {
        pin.state = true;
        if (pin.direction === "rising" || pin.direction === "either") {
          triggered = true;
        }
      } else if (pin.state && currentVoltage <= (vth - hyst)) {
        pin.state = false;
        if (pin.direction === "falling" || pin.direction === "either") {
          triggered = true;
        }
      }

      if (triggered) {
        triggers.push({
          componentId: pin.componentId,
          nodeIdx: parseInt(pin.nodeId, 10) || 0,
          thresholdVoltage: vth,
          direction: pin.direction,
          interruptVector: pin.interruptVector,
        });
      }
    }

    return triggers;
  }
}

// ============================================================================
// 3. MOTOR DE CO-SIMULACIÓN Y ACOPLAMIENTO BIDIRECCIONAL
// ============================================================================

export interface CoSimMcuInstance {
  componentId: string;
  runtime: McuRuntime;
  type: string;
  synchronizer: McuClockSynchronizer;
  pins: string[];
}

export class CoSimulationSyncEngine {
  private mcuInstances: Map<string, CoSimMcuInstance> = new Map();
  readonly detector: AnalogThresholdEventDetector = new AnalogThresholdEventDetector();

  addMcu(componentId: string, runtime: McuRuntime, type: string, pins: string[]): void {
    const synchronizer = new McuClockSynchronizer(runtime.definition.clockSpeed);
    this.mcuInstances.set(componentId, {
      componentId,
      runtime,
      type,
      synchronizer,
      pins,
    });
  }

  getMcu(componentId: string): CoSimMcuInstance | undefined {
    return this.mcuInstances.get(componentId);
  }

  resetAll(): void {
    for (const inst of this.mcuInstances.values()) {
      inst.synchronizer.reset();
    }
  }

  /**
   * Ejecuta un paso de co-simulación:
   * 1. Detecta cruces analógicos e inyecta interrupciones por hardware event-driven.
   * 2. Calcula ciclos exactos para dt en cada MCU y avanza la ejecución.
   * 3. Extrae las tensiones actualizadas de los pines de salida para retroalimentar el solver SPICE.
   */
  stepCoSimulation(
    dt: number,
    nodeVoltages: Record<string, number>,
  ): {
    triggers: AnalogEventTrigger[];
    gpioOutputs: Array<{ componentId: string; pinIndex: number; voltage: number }>;
  } {
    // 1. Detectar cruces de umbral e inyectar interrupciones
    const triggers = this.detector.detectCrossingEvents(nodeVoltages);
    for (const trigger of triggers) {
      const inst = this.mcuInstances.get(trigger.componentId);
      if (inst) {
        injectHardwareInterrupt(inst.runtime, trigger.interruptVector);
      }
    }

    // 2. Ejecutar ciclos en cada MCU
    for (const inst of this.mcuInstances.values()) {
      const cycles = inst.synchronizer.calculateCyclesForTimestep(dt);
      if (cycles > 0) {
        runCycles(inst.runtime, cycles);
      }
    }

    // 3. Extraer salidas digitales convertidas a tensión analógica (0V / 5V)
    const gpioOutputs: Array<{ componentId: string; pinIndex: number; voltage: number }> = [];

    for (const inst of this.mcuInstances.values()) {
      const isAvr = inst.runtime.definition.architecture === "avr";

      if (isAvr) {
        const portb = readDataSpace(inst.runtime, 0x20 + IO_PORTB);
        const portc = readDataSpace(inst.runtime, 0x20 + IO_PORTC);
        const portd = readDataSpace(inst.runtime, 0x20 + IO_PORTD);

        for (let i = 0; i < inst.pins.length; i++) {
          let pinBit = 0;
          if (i >= 8 && i < 16) {
            pinBit = (portb >> (i - 8)) & 1;
          } else if (i >= 16 && i < 24) {
            pinBit = (portd >> (i - 16)) & 1;
          } else if (i >= 24 && i < 30) {
            pinBit = (portc >> (i - 24)) & 1;
          }
          gpioOutputs.push({
            componentId: inst.componentId,
            pinIndex: i,
            voltage: pinBit ? 5.0 : 0.0,
          });
        }
      } else {
        // 8051 Ports P0, P1, P2, P3
        const p1 = readDirect(inst.runtime, 0x90);
        for (let i = 0; i < Math.min(8, inst.pins.length); i++) {
          const pinBit = (p1 >> i) & 1;
          gpioOutputs.push({
            componentId: inst.componentId,
            pinIndex: i,
            voltage: pinBit ? 5.0 : 0.0,
          });
        }
      }
    }

    return { triggers, gpioOutputs };
  }
}
