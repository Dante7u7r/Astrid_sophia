// ==========================================================================
// COMPONENT DEFINITION TYPES — Contratos formales de componentes EDA
// ==========================================================================

import type {
  ComponentInstance,
} from "../canvas_orchestrator";
import type {
  ComponentLabelLayout,
  ComponentVisualState,
} from "../canvas/component_render_model";
import type { ComponentRenderOptions } from "../canvas/component_renderer";

export type ComponentCategory =
  | "pasivos"
  | "semiconductores"
  | "analogicos"
  | "actuadores"
  | "logica-digital"
  | "digitales-mcus"
  | "anotaciones"
  | "macromodelos";

export interface LocalPinDefinition {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly label?: string;
  readonly name?: string;
}

export interface LiveComponentBehaviorResult {
  readonly branchCurrents?: Record<number, number>; // Corriente por pin index
  readonly glowLevel?: number;
  readonly relayClosed?: boolean;
  readonly buzzerLevel?: number;
}

export interface ComponentSpiceDefinition {
  readonly primitiveType?: string;
  readonly pinCount?: number;
  readonly isMacro?: boolean;
  readonly isGround?: boolean;
}

export interface ComponentDefinition {
  readonly type: ComponentInstance["type"];
  readonly name: string;
  readonly description?: string;
  readonly category: ComponentCategory;
  readonly prefix: string;
  readonly defaultProperties?: Partial<ComponentInstance>;
  
  // Geometría y Terminales
  readonly halfExtents: { readonly halfW: number; readonly halfH: number } | ((comp: ComponentInstance) => { readonly halfW: number; readonly halfH: number });
  readonly hasStandardLeads?: boolean; // Default: true (excepto chips, tierra, notas, etc.)
  readonly hasValueLabel?: boolean; // Default: true (excepto notas, tierras, etc.)
  readonly labelLayout?: ComponentLabelLayout | ((comp: ComponentInstance) => ComponentLabelLayout);

  // Generador de pines locales (pre-rotación)
  getPins(comp: ComponentInstance): readonly LocalPinDefinition[];

  // Renderizado vectorial
  render(
    ctx: CanvasRenderingContext2D,
    comp: ComponentInstance,
    visualState: ComponentVisualState,
    options: ComponentRenderOptions,
  ): void;

  // Comportamiento dinámico en vivo (corrientes de rama, resplandor, audio)
  evaluateLiveBehavior?(
    pinVoltages: Record<number, number | undefined>,
    comp: ComponentInstance,
  ): LiveComponentBehaviorResult;

  // Reglas Eléctricas ERC
  readonly isGroundReference?: boolean;
  readonly optionalFloatingPins?: readonly number[];
  readonly isDocumentOnly?: boolean; // text_note, etc.
}
