// ==========================================================================
// COMPONENT PIN RULES — Reglas de validación ERC de pines flotantes
// ==========================================================================

import type { ComponentInstance } from "../canvas_orchestrator";
import { globalComponentRegistry } from "../components/registry";

export function allowsFloatingPins(type: ComponentInstance["type"], pinIndex?: number): boolean {
  const def = globalComponentRegistry.get(type);
  if (!def) return false;
  if (
    def.category === "digitales-mcus" ||
    def.category === "logica-digital" ||
    def.isDocumentOnly === true ||
    def.type === "net_label" ||
    def.type === "text_note" ||
    def.type === "x"
  ) {
    return true;
  }
  if (pinIndex !== undefined && def.optionalFloatingPins?.includes(pinIndex)) {
    return true;
  }
  return false;
}
