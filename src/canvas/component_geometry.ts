// ==========================================================================
// COMPONENT GEOMETRY — Límites y Hit-Testing vía Registro de Componentes
// ==========================================================================

import type { BoundingBox, ComponentInstance } from "../canvas_orchestrator";
import { globalComponentRegistry } from "../components/registry";

/** Half-extents (local space, pre-rotation) aligned with render() geometry. */
export function getComponentLocalHalfExtents(comp: ComponentInstance): { halfW: number; halfH: number } {
  return globalComponentRegistry.getHalfExtents(comp);
}

export function getComponentBounds(comp: ComponentInstance): BoundingBox {
  return globalComponentRegistry.getBounds(comp);
}

export function hitTestComponentAt(
  comp: ComponentInstance,
  worldX: number,
  worldY: number,
): boolean {
  const { halfW, halfH } = globalComponentRegistry.getHalfExtents(comp);
  const rad = (-comp.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = worldX - comp.x;
  const dy = worldY - comp.y;
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  return localX >= -halfW && localX <= halfW && localY >= -halfH && localY <= halfH;
}
