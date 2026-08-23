// ==========================================================================
// COMPONENT RENDERER — Orquestador de renderizado vectorial de componentes
// ==========================================================================

import { type ComponentInstance } from "../canvas_orchestrator";
import { globalComponentRegistry } from "../components/registry";
import { drawCompactComponent } from "./component_compact_renderer";
import {
  formatComponentValue,
  getComponentLabelLayout,
  getComponentVisualState,
  shouldDrawStandardLeads,
  shouldDrawValueLabel,
} from "./component_render_model";

export interface ComponentRenderOptions {
  readonly detail?: "full" | "compact";
  readonly voltageMap?: Record<string, number>;
  readonly branchCurrents?: Record<string, number>;
  readonly showReactiveFields?: boolean;
}

export function drawComponentSymbol(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  isSelected: boolean,
  isHovered: boolean,
  options: ComponentRenderOptions = {},
): void {
  ctx.save();
  ctx.translate(comp.x, comp.y);
  ctx.rotate((comp.rotation * Math.PI) / 180);
  if (comp.mirror) {
    ctx.scale(-1, 1);
  }

  const visualState = getComponentVisualState(isSelected, isHovered);
  const { color } = visualState;

  ctx.strokeStyle = color;
  ctx.lineWidth = visualState.lineWidth;
  ctx.fillStyle = "rgba(8, 12, 22, 0.75)";

  if (options.detail === "compact" && !isSelected && !isHovered) {
    drawCompactComponent(ctx, comp, color);
    ctx.restore();
    return;
  }

  // 1. Dibujar terminales estándar (leads)
  if (shouldDrawStandardLeads(comp.type)) {
    ctx.beginPath();
    ctx.moveTo(-40, 0);
    ctx.lineTo(-20, 0);
    ctx.moveTo(20, 0);
    ctx.lineTo(40, 0);
    ctx.stroke();
  } else if (comp.type === "ground") {
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.lineTo(0, 0);
    ctx.stroke();
  }

  // 2. Renderizado del cuerpo del símbolo a través del Registro Declarativo
  ctx.beginPath();
  globalComponentRegistry.render(ctx, comp, visualState, options);

  // Las etiquetas de red y notas de texto gestionan su propia tipografía interna
  if (comp.type === "net_label" || comp.type === "text_note") {
    ctx.restore();
    return;
  }

  // 3. Dibujar ID y valor numérico formateado
  if (comp.mirror) {
    ctx.scale(-1, 1);
  }
  ctx.rotate(-(comp.rotation * Math.PI) / 180); // Des-rotar el texto para mantenerlo horizontal

  const { idY, valueY } = getComponentLabelLayout(comp);

  ctx.fillStyle = isSelected ? "hsl(270, 89%, 80%)" : "hsl(210, 17%, 85%)";
  ctx.font = "bold 11px 'Inter', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(comp.id, 0, idY);

  if (shouldDrawValueLabel(comp.type)) {
    ctx.fillStyle = "#94A3B8";
    ctx.font = "9px 'JetBrains Mono', monospace";
    ctx.fillText(formatComponentValue(comp), 0, valueY);
  }
  ctx.restore();
}
