import type { ComponentInstance, WireInstance } from "../canvas_orchestrator";

export function buildDmmRenderCacheKey(
  components: readonly ComponentInstance[],
  wires: readonly Pick<WireInstance, "from" | "to">[],
  pinToNodeMap: Readonly<Record<string, string>>,
  voltageMap: Readonly<Record<string, number>>,
): string {
  const dmmComponents = components.filter(component => component.type === "dmm");
  if (dmmComponents.length === 0) return "no-dmm";

  const dmmState = dmmComponents
    .map(component => `${component.id}:${component.value}:${pinToNodeMap[`${component.id}:0`] ?? ""}:${pinToNodeMap[`${component.id}:1`] ?? ""}`)
    .join("|");
  const connectedPins = wires
    .flatMap(wire => [
      `${wire.from.componentId}:${wire.from.pinIndex}`,
      `${wire.to.componentId}:${wire.to.pinIndex}`,
    ])
    .sort()
    .join(",");
  const voltages = Object.keys(voltageMap)
    .sort()
    .map(node => `${node}:${voltageMap[node]}`)
    .join(",");

  return `${dmmState}::${connectedPins}::${voltages}`;
}
