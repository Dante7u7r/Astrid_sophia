// ==========================================================================
// COMPONENT IDENTITY — Normalización, prefijos y generador de IDs únicos
// ==========================================================================

import type { ComponentInstance } from "../canvas_orchestrator";
import { DMM_INITIAL_DISPLAY } from "../simulation/dmm";
import { globalComponentRegistry } from "../components/registry";

export const COMPONENT_ID_PREFIXES: Record<ComponentInstance["type"], string> = new Proxy(
  {} as Record<ComponentInstance["type"], string>,
  {
    get: (_target, prop: string) => globalComponentRegistry.getPrefix(prop as ComponentInstance["type"]),
  },
);

export function normalizeComponentId(id: string): string {
  return id.trim().toUpperCase();
}

export function isValidComponentId(id: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(id.trim());
}

export function findDuplicateComponentIds(
  components: readonly Pick<ComponentInstance, "id">[],
): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const component of components) {
    const normalized = normalizeComponentId(component.id);
    if (seen.has(normalized)) {
      duplicates.add(normalized);
    } else {
      seen.add(normalized);
    }
  }

  return [...duplicates].sort();
}

export function copyComponentConfiguration(
  source: ComponentInstance,
  target: ComponentInstance,
): void {
  Object.assign(target, {
    value: source.value,
    rotation: source.rotation,
    mirror: source.mirror,
    mirrorY: source.mirrorY,
    wiperPosition: source.wiperPosition,
    lux: source.lux,
    temperatureCelsius: source.temperatureCelsius,
    waveType: source.waveType,
    amplitude: source.amplitude,
    frequency: source.frequency,
    offset: source.offset,
    offsetVoltage: source.offsetVoltage,
    openLoopGain: source.openLoopGain,
    dutyCycle: source.dutyCycle,
    mcuClockSpeed: source.mcuClockSpeed,
    primaryInductance: source.primaryInductance,
    secondaryInductance: source.secondaryInductance,
    couplingCoefficient: source.couplingCoefficient,
    switchRon: source.switchRon,
    switchRoff: source.switchRoff,
    switchVth: source.switchVth,
    switchVh: source.switchVh,
    switchState: source.switchState,
    spiceMacro: source.spiceMacro,
    pinCount: source.pinCount,
    firmwareHex: source.firmwareHex,
    label: source.label,
    fontSize: source.fontSize,
    textColor: source.textColor,
    noteTheme: source.noteTheme,
  });
  target.firmware = source.firmware ? source.firmware.slice() : undefined;
  target.dmmValue = source.type === "dmm" ? DMM_INITIAL_DISPLAY : undefined;
}

export function generateUniqueComponentId(
  components: readonly Pick<ComponentInstance, "id">[],
  type: ComponentInstance["type"],
): string {
  const prefix = globalComponentRegistry.getPrefix(type);
  const normalizedIds = new Set(components.map((component) => normalizeComponentId(component.id)));
  const suffixPattern = new RegExp(`^${prefix}(\\d+)$`, "i");
  let highestSuffix = 0;

  for (const component of components) {
    const match = component.id.trim().match(suffixPattern);
    if (match) highestSuffix = Math.max(highestSuffix, Number.parseInt(match[1], 10));
  }

  let suffix = highestSuffix + 1;
  let candidate = `${prefix}${suffix}`;
  while (normalizedIds.has(normalizeComponentId(candidate))) {
    suffix += 1;
    candidate = `${prefix}${suffix}`;
  }
  return candidate;
}
