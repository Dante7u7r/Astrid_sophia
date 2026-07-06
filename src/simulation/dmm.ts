import type {
  ComponentInstance,
  WireInstance,
} from "../canvas_orchestrator";

export type DmmMode = "V" | "A" | "R";

export const DMM_DEFAULT_MODE: DmmMode = "V";
export const DMM_INITIAL_DISPLAY = "OPEN";
export const DMM_VOLTAGE_INPUT_RESISTANCE = 10e6;
export const DMM_CURRENT_SHUNT_RESISTANCE = 0.01;
export const DMM_RESISTANCE_TEST_CURRENT = 10e-6;
export const DMM_RESISTANCE_GUARD = 1e9;

export function normalizeDmmMode(value: unknown): DmmMode {
  return value === "A" || value === "R" ? value : DMM_DEFAULT_MODE;
}

export function formatDmmReading(mode: DmmMode, voltageDifference: number): string {
  if (!Number.isFinite(voltageDifference)) return DMM_INITIAL_DISPLAY;

  if (mode === "V") {
    return `${voltageDifference.toFixed(3)} V`;
  }
  if (mode === "A") {
    const current = voltageDifference / DMM_CURRENT_SHUNT_RESISTANCE;
    if (Math.abs(current) < 1e-3) return `${(current * 1e6).toFixed(1)} uA`;
    if (Math.abs(current) < 1) return `${(current * 1e3).toFixed(2)} mA`;
    return `${current.toFixed(3)} A`;
  }

  const resistance = Math.abs(voltageDifference) / DMM_RESISTANCE_TEST_CURRENT;
  if (resistance >= 1e6) return `${(resistance / 1e6).toFixed(3)} MOhm`;
  if (resistance >= 1e3) return `${(resistance / 1e3).toFixed(3)} kOhm`;
  return `${resistance.toFixed(2)} Ohm`;
}

export function updateDmmReadings(
  components: readonly ComponentInstance[],
  wires: readonly WireInstance[],
  pinToNodeMap: Readonly<Record<string, string>>,
  nodeVoltages: Readonly<Record<string, number>>,
): void {
  const connectedPins = new Set<string>();
  for (const wire of wires) {
    connectedPins.add(`${wire.from.componentId}:${wire.from.pinIndex}`);
    connectedPins.add(`${wire.to.componentId}:${wire.to.pinIndex}`);
  }

  for (const component of components) {
    if (component.type !== "dmm") continue;

    const pin0Key = `${component.id}:0`;
    const pin1Key = `${component.id}:1`;
    const pin0Node = pinToNodeMap[pin0Key];
    const pin1Node = pinToNodeMap[pin1Key];
    const voltage0 = pin0Node === undefined ? undefined : nodeVoltages[pin0Node];
    const voltage1 = pin1Node === undefined ? undefined : nodeVoltages[pin1Node];

    if (
      !connectedPins.has(pin0Key)
      || !connectedPins.has(pin1Key)
      || voltage0 === undefined
      || voltage1 === undefined
    ) {
      component.dmmValue = DMM_INITIAL_DISPLAY;
      continue;
    }

    component.dmmValue = formatDmmReading(
      normalizeDmmMode(component.value),
      voltage0 - voltage1,
    );
  }
}
