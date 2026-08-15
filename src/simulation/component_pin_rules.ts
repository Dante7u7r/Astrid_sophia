// ==========================================================================
// COMPONENT PIN RULES — Reglas de validación ERC de pines flotantes
// ==========================================================================

import type { ComponentInstance } from "../canvas_orchestrator";
import { globalComponentRegistry } from "../components/registry";

export function allowsFloatingPins(type: ComponentInstance["type"]): boolean {
  const def = globalComponentRegistry.get(type);
  if (!def) return false;
  return (
    def.category === "digitales-mcus" ||
    def.isDocumentOnly === true ||
    def.type === "net_label"
  );
}
