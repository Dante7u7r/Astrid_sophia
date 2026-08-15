// ==========================================================================
// COMPONENT PINS — Delegador de terminales hacia el registro de componentes
// ==========================================================================

import type { ComponentInstance, PinInstance } from "../canvas_orchestrator";
import { globalComponentRegistry } from "../components/registry";

export function getComponentPins(comp: ComponentInstance): PinInstance[] {
  return globalComponentRegistry.getPins(comp);
}
