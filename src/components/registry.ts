// ==========================================================================
// COMPONENT REGISTRY — Catálogo central de componentes EDA
// ==========================================================================

import type {
  BoundingBox,
  ComponentInstance,
  PinInstance,
  Point2D,
} from "../canvas_orchestrator";
import {
  type ComponentLabelLayout,
  type ComponentVisualState,
} from "../canvas/component_render_model";
import type { ComponentRenderOptions } from "../canvas/component_renderer";
import type {
  ComponentCategory,
  ComponentDefinition,
  LiveComponentBehaviorResult,
} from "./types";
import { ALL_COMPONENT_DEFINITIONS } from "./descriptors/index";

export class ComponentRegistry {
  private readonly definitions = new Map<string, ComponentDefinition>();

  register(definition: ComponentDefinition): void {
    this.definitions.set(definition.type, definition);
  }

  registerAll(definitions: readonly ComponentDefinition[]): void {
    for (const def of definitions) {
      this.register(def);
    }
  }

  get(type: string): ComponentDefinition | undefined {
    return this.definitions.get(type);
  }

  getAll(): ComponentDefinition[] {
    return Array.from(this.definitions.values());
  }

  getByCategory(category: ComponentCategory): ComponentDefinition[] {
    return this.getAll().filter((def) => def.category === category);
  }

  has(type: string): boolean {
    return this.definitions.has(type);
  }

  // ========================================================================
  // RESOLUTORES GEOMÉTRICOS Y TERMINALES
  // ========================================================================

  getPins(comp: ComponentInstance): PinInstance[] {
    const def = this.get(comp.type);
    if (!def) {
      // Fallback estándar de 2 pines
      return this.fallbackTwoPins(comp);
    }

    const localPins = def.getPins(comp);
    if (localPins.length === 0) return [];

    const rad = (comp.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    return localPins.map((pin) => {
      const finalLx = comp.mirror ? -pin.x : pin.x;
      const worldX = comp.x + (finalLx * cos - pin.y * sin);
      const worldY = comp.y + (finalLx * sin + pin.y * cos);

      return {
        componentId: comp.id,
        pinIndex: pin.index,
        x: worldX,
        y: worldY,
        label: pin.label,
        name: pin.name,
      };
    });
  }

  getHalfExtents(comp: ComponentInstance): { halfW: number; halfH: number } {
    const def = this.get(comp.type);
    if (!def) return { halfW: 40, halfH: 40 };

    if (typeof def.halfExtents === "function") {
      return def.halfExtents(comp);
    }
    return def.halfExtents;
  }

  getBounds(comp: ComponentInstance): BoundingBox {
    const { halfW, halfH } = this.getHalfExtents(comp);
    const rad = (comp.rotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const worldHalfW = halfW * cos + halfH * sin;
    const worldHalfH = halfW * sin + halfH * cos;

    return {
      x: comp.x - worldHalfW,
      y: comp.y - worldHalfH,
      width: worldHalfW * 2,
      height: worldHalfH * 2,
    };
  }

  getPrefix(type: ComponentInstance["type"]): string {
    const def = this.get(type);
    return def?.prefix ?? "U";
  }

  hasStandardLeads(type: ComponentInstance["type"]): boolean {
    const def = this.get(type);
    return def?.hasStandardLeads !== false;
  }

  hasValueLabel(type: ComponentInstance["type"]): boolean {
    const def = this.get(type);
    return def?.hasValueLabel !== false;
  }

  getLabelLayout(comp: ComponentInstance): ComponentLabelLayout {
    const def = this.get(comp.type);
    if (def?.labelLayout) {
      return typeof def.labelLayout === "function"
        ? def.labelLayout(comp)
        : def.labelLayout;
    }
    return { idY: -16, valueY: 18 };
  }

  isFloatingPinOptional(type: ComponentInstance["type"], pinIndex: number): boolean {
    const def = this.get(type);
    if (!def) return false;
    if (def.isDocumentOnly) return true;
    if (def.optionalFloatingPins) {
      return def.optionalFloatingPins.includes(pinIndex);
    }
    return false;
  }

  // ========================================================================
  // RENDERIZADO Y EVALUACIÓN DINÁMICA
  // ========================================================================

  render(
    ctx: CanvasRenderingContext2D,
    comp: ComponentInstance,
    visualState: ComponentVisualState,
    options: ComponentRenderOptions = {},
  ): void {
    const def = this.get(comp.type);
    if (def) {
      def.render(ctx, comp, visualState, options);
    }
  }

  evaluateLiveBehavior(
    comp: ComponentInstance,
    pinVoltages: Record<number, number | undefined>,
  ): LiveComponentBehaviorResult | undefined {
    const def = this.get(comp.type);
    if (def?.evaluateLiveBehavior) {
      return def.evaluateLiveBehavior(pinVoltages, comp);
    }
    return undefined;
  }

  // ========================================================================
  // AUXILIARES
  // ========================================================================

  private fallbackTwoPins(comp: ComponentInstance): PinInstance[] {
    const rad = (comp.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const transform = (lx: number, ly: number): Point2D => {
      const finalLx = comp.mirror ? -lx : lx;
      return {
        x: comp.x + (finalLx * cos - ly * sin),
        y: comp.y + (finalLx * sin + ly * cos),
      };
    };

    const p0 = transform(-40, 0);
    const p1 = transform(40, 0);

    return [
      { componentId: comp.id, pinIndex: 0, x: p0.x, y: p0.y },
      { componentId: comp.id, pinIndex: 1, x: p1.x, y: p1.y },
    ];
  }
}

// Instancia singleton por defecto pre-cargada con el catálogo estándar
export function createDefaultComponentRegistry(): ComponentRegistry {
  const reg = new ComponentRegistry();
  reg.registerAll(ALL_COMPONENT_DEFINITIONS);
  return reg;
}

export const globalComponentRegistry = createDefaultComponentRegistry();
