/** Bridge para co-simulación MCU + SPICE.
 * Conecta pines GPIO del MCU a nodos del circuito analógico.
 * Incluye el despachador de interrupciones analógicas (MCU Interrupt Engine).
 */
import type { McuRuntime } from "./mcu-runtime";
import { injectHardwareInterrupt } from "./mcu-runtime";
import type { AnalogEventTrigger } from "./mcu-types";
export type DigitalState = 0 | 1 | "X" | "Z";


export type GpioPin = {
  port: number;
  bit: number;
  direction: "input" | "output" | "bidirectional";
  state: DigitalState;
  connectedNodeId: string | null;
};

export type McuSpiceBridgeConfig = {
  mcu: McuRuntime;
  gpioPins: GpioPin[];
  spiceNodeVoltages: Map<string, number>;
  voltageThresholdHigh: number;
  voltageThresholdLow: number;
  updateIntervalCycles: number;
};

export type BridgeEvent = {
  type: "gpio-read" | "gpio-write" | "interrupt" | "timer";
  time: number;
  details: Record<string, unknown>;
};

export type McuSpiceBridge = {
  config: McuSpiceBridgeConfig;
  events: BridgeEvent[];
  cycleCount: number;
  lastUpdateCycle: number;
};

export function createMcuSpiceBridge(
  mcu: McuRuntime,
  gpioCount: number = 8
): McuSpiceBridge {
  const gpioPins: GpioPin[] = [];

  for (let port = 0; port < 1; port++) {
    for (let bit = 0; bit < 8; bit++) {
      if (gpioPins.length >= gpioCount) break;
      gpioPins.push({
        port,
        bit,
        direction: "bidirectional",
        state: "X",
        connectedNodeId: null
      });
    }
  }

  return {
    config: {
      mcu,
      gpioPins,
      spiceNodeVoltages: new Map(),
      voltageThresholdHigh: 2.5,
      voltageThresholdLow: 0.8,
      updateIntervalCycles: 1
    },
    events: [],
    cycleCount: 0,
    lastUpdateCycle: 0
  };
}

export function connectGpioToNode(
  bridge: McuSpiceBridge,
  pinIndex: number,
  nodeId: string
): boolean {
  if (pinIndex < 0 || pinIndex >= bridge.config.gpioPins.length) {
    return false;
  }
  bridge.config.gpioPins[pinIndex].connectedNodeId = nodeId;
  return true;
}

export function disconnectGpio(
  bridge: McuSpiceBridge,
  pinIndex: number
): boolean {
  if (pinIndex < 0 || pinIndex >= bridge.config.gpioPins.length) {
    return false;
  }
  bridge.config.gpioPins[pinIndex].connectedNodeId = null;
  return true;
}

export function setGpioDirection(
  bridge: McuSpiceBridge,
  pinIndex: number,
  direction: "input" | "output" | "bidirectional"
): boolean {
  if (pinIndex < 0 || pinIndex >= bridge.config.gpioPins.length) {
    return false;
  }
  bridge.config.gpioPins[pinIndex].direction = direction;
  return true;
}

export function readVoltageAtNode(
  bridge: McuSpiceBridge,
  nodeId: string
): number {
  return bridge.config.spiceNodeVoltages.get(nodeId) ?? 0;
}

export function voltageToDigitalState(
  bridge: McuSpiceBridge,
  voltage: number
): DigitalState {
  if (voltage >= bridge.config.voltageThresholdHigh) {
    return 1;
  }
  if (voltage <= bridge.config.voltageThresholdLow) {
    return 0;
  }
  return "X";
}

export function updateGpioInputs(bridge: McuSpiceBridge): void {
  for (const pin of bridge.config.gpioPins) {
    if (pin.direction === "output") continue;
    if (!pin.connectedNodeId) continue;

    const voltage = readVoltageAtNode(bridge, pin.connectedNodeId);
    const newState = voltageToDigitalState(bridge, voltage);

    if (newState !== pin.state) {
      pin.state = newState;
      bridge.events.push({
        type: "gpio-read",
        time: bridge.cycleCount,
        details: {
          port: pin.port,
          bit: pin.bit,
          nodeId: pin.connectedNodeId,
          voltage,
          state: newState
        }
      });
    }
  }
}

export function digitalStateToVoltage(state: DigitalState): number {
  switch (state) {
    case 1:
      return 5.0;
    case 0:
      return 0.0;
    case "Z":
      return 0.0;
    default:
      return 0.0;
  }
}

export function writeGpioOutputs(
  bridge: McuSpiceBridge,
  voltageMap: Map<string, number>
): void {
  for (const pin of bridge.config.gpioPins) {
    if (pin.direction === "input") continue;
    if (!pin.connectedNodeId) continue;

    const voltage = digitalStateToVoltage(pin.state);
    voltageMap.set(pin.connectedNodeId, voltage);
  }
}

export function syncMcSpice(
  bridge: McuSpiceBridge,
  spiceNodeVoltages: Map<string, number>
): void {
  bridge.config.spiceNodeVoltages = new Map(spiceNodeVoltages);
  bridge.cycleCount++;

  if (bridge.cycleCount - bridge.lastUpdateCycle >= bridge.config.updateIntervalCycles) {
    updateGpioInputs(bridge);
    bridge.lastUpdateCycle = bridge.cycleCount;
  }
}

export function getGpioState(
  bridge: McuSpiceBridge,
  pinIndex: number
): GpioPin | null {
  if (pinIndex < 0 || pinIndex >= bridge.config.gpioPins.length) {
    return null;
  }
  return { ...bridge.config.gpioPins[pinIndex] };
}

export function getAllGpioStates(bridge: McuSpiceBridge): GpioPin[] {
  return bridge.config.gpioPins.map(p => ({ ...p }));
}

export function getBridgeEvents(
  bridge: McuSpiceBridge,
  sinceCycle?: number
): BridgeEvent[] {
  if (sinceCycle === undefined) {
    return [...bridge.events];
  }
  return bridge.events.filter(e => e.time >= sinceCycle);
}

export function clearBridgeEvents(bridge: McuSpiceBridge): void {
  bridge.events = [];
}

export function getGpioBitmap(bridge: McuSpiceBridge): number {
  let bitmap = 0;
  for (let i = 0; i < bridge.config.gpioPins.length; i++) {
    const pin = bridge.config.gpioPins[i];
    if (pin.state === 1) {
      bitmap |= (1 << i);
    }
  }
  return bitmap;
}

export function setGpioFromBitmap(
  bridge: McuSpiceBridge,
  bitmap: number
): void {
  for (let i = 0; i < bridge.config.gpioPins.length; i++) {
    const pin = bridge.config.gpioPins[i];
    if (pin.direction === "output") {
      pin.state = (bitmap & (1 << i)) !== 0 ? 1 : 0;
    }
  }
}

export function simulateTimestep(
  bridge: McuSpiceBridge,
  mcuCycles: number,
  spiceVoltages: Map<string, number>
): Map<string, number> {
  for (let i = 0; i < mcuCycles; i++) {
    syncMcSpice(bridge, spiceVoltages);
  }

  const outputVoltages = new Map<string, number>();
  writeGpioOutputs(bridge, outputVoltages);
  return outputVoltages;
}

export const DEFAULT_GPIO_CONFIG = {
  voltageThresholdHigh: 2.5,
  voltageThresholdLow: 0.8,
  voltageHigh: 5.0,
  voltageLow: 0.0,
  updateIntervalCycles: 1
};

export const VOLTAGE_THRESHOLDS = [
  { label: "5V TTL", high: 2.0, low: 0.8 },
  { label: "3.3V CMOS", high: 2.0, low: 0.8 },
  { label: "3.3V LVTTL", high: 2.0, low: 0.4 },
  { label: "Custom", high: 2.5, low: 0.8 }
];

// ==========================================================================
// DESPACHADOR DE INTERRUPCIONES ANALÓGICAS (MCU INTERRUPT ENGINE)
// ==========================================================================

/**
 * Busca el runtime de la MCU destino en el registro global y le inyecta
 * una interrupción de hardware con el vector especificado.
 * Diseñada para ser invocada desde el listener de Tauri 'sim-frame-update'
 * en el orquestador principal (main.ts).
 *
 * @param trigger          Evento analógico recibido desde el solver Rust.
 * @param mcuRuntimes      Mapa de runtimes activos indexados por componentId.
 * @returns true si el despacho fue exitoso, false si no se encontró la MCU.
 */
export function dispatchAnalogTrigger(
  trigger: AnalogEventTrigger,
  mcuRuntimes: Record<string, { runtime: McuRuntime; type: string; pins: string[] }>,
): boolean {
  const entry = mcuRuntimes[trigger.componentId];
  if (!entry) {
    return false;
  }
  // Delegar la inyección de la interrupción al runtime destino.
  // injectHardwareInterrupt está definida en mcu-runtime.ts y maneja
  // el enmascaramiento de interrupciones (bit GIE / EA) internamente.
  injectHardwareInterrupt(entry.runtime, trigger.interruptVector);
  return true;
}