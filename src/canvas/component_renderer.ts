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
import { getSchematicThemeColors } from "./schematic_theme";

export interface ComponentRenderOptions {
  readonly detail?: "full" | "compact";
  readonly voltageMap?: Record<string, number>;
  readonly branchCurrents?: Record<string, number>;
  readonly showReactiveFields?: boolean;
  readonly symbolStandard?: "IEEE" | "IEC";
  readonly isClassroom?: boolean;
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
  const scaleX = comp.mirror ? -1 : 1;
  const scaleY = comp.mirrorY ? -1 : 1;
  if (scaleX !== 1 || scaleY !== 1) {
    ctx.scale(scaleX, scaleY);
  }

  const theme = getSchematicThemeColors(options.isClassroom);
  const isClassroomTheme = theme.isClassroom;

  const visualState = getComponentVisualState(isSelected, isHovered, isClassroomTheme);
  const { color } = visualState;

  ctx.strokeStyle = color;
  ctx.lineWidth = visualState.lineWidth;
  ctx.fillStyle = theme.component.fill;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

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
  if (scaleX !== 1 || scaleY !== 1) {
    ctx.scale(scaleX, scaleY);
  }
  ctx.rotate(-(comp.rotation * Math.PI) / 180); // Des-rotar el texto para mantenerlo horizontal

  const labelLayout = getComponentLabelLayout(comp);

  ctx.fillStyle = isSelected
    ? theme.component.labelSelected
    : theme.component.labelDefault;
  ctx.font = "bold 11px 'Inter', sans-serif";
  ctx.textAlign = labelLayout.align ?? "center";
  ctx.textBaseline = "middle";
  ctx.fillText(comp.id, labelLayout.idX ?? 0, labelLayout.idY);

  if (shouldDrawValueLabel(comp.type)) {
    ctx.fillStyle = isSelected
      ? (isClassroomTheme ? "#0369A1" : "#7DD3FC")
      : (isClassroomTheme ? "#475569" : "#94A3B8");
    ctx.font = "9px 'JetBrains Mono', monospace";
    ctx.fillText(formatComponentValue(comp), labelLayout.valueX ?? 0, labelLayout.valueY);
  }
  ctx.restore();
}
