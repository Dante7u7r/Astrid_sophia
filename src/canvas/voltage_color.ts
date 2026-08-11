export interface VoltageColorScaleConfig {
  mode: "fixed" | "auto";
  fixedMin: number;
  fixedMax: number;
}

export const DEFAULT_VOLTAGE_SCALE: VoltageColorScaleConfig = {
  mode: "fixed",
  fixedMin: -5,
  fixedMax: 5,
};

export function computeAutoRange(
  nodeVoltages: Record<string, number>
): { min: number; max: number } {
  const voltages = Object.values(nodeVoltages);
  if (voltages.length === 0) return { min: -5, max: 5 };
  const maxAbs = Math.max(...voltages.map((v) => Math.abs(v)), 0.001);
  return { min: -maxAbs, max: maxAbs };
}

export function voltageToColor(
  voltage: number,
  range: { min: number; max: number }
): string {
  const { min, max } = range;
  const clamped = Math.max(min, Math.min(max, voltage));
  const normalized = (clamped - min) / (max - min || 1);

  const hue = 240 - normalized * 240;
  const saturation = 75;
  const lightness = 45 + (1 - Math.abs(normalized - 0.5) * 2) * 5;

  return `hsl(${hue.toFixed(1)}, ${saturation}%, ${lightness}%)`;
}

export function colorForNet(
  netId: string,
  frame: Record<string, number> | null,
  range: { min: number; max: number }
): string {
  if (!frame) return "var(--component-neutral, #666)";
  const voltage = frame[netId];
  if (voltage === undefined) return "var(--component-neutral, #666)";
  return voltageToColor(voltage, range);
}

export function formatVoltageForDisplay(voltage: number, sigFigs = 4): string {
  if (voltage === 0) return "0 V";
  const magnitude = Math.floor(Math.log10(Math.abs(voltage)));
  const factor = Math.pow(10, sigFigs - 1 - magnitude);
  const rounded = Math.round(voltage * factor) / factor;
  return `${rounded} V`;
}
