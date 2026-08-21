// ==========================================================================
// ANNOTATION COMPONENT DESCRIPTORS — Etiquetas de Red y Notas de Ingeniería
// ==========================================================================

import {
  drawNetLabel,
  drawTextNote,
} from "../../canvas/component_annotation_renderer";
import type { ComponentDefinition } from "../types";

export const NetLabelDefinition: ComponentDefinition = {
  type: "net_label",
  name: "Puerto / Etiqueta de Red (Terminal)",
  description: "Conexión de red virtual. Los terminales de Alimentación (VCC/VDD/+5V) inyectan automáticamente una fuente de tensión virtual referenciada a GND (0V) en el motor SPICE.",
  category: "anotaciones",
  prefix: "NET",
  defaultProperties: { value: "NET", label: "NET", terminalType: "signal" },
  halfExtents: { halfW: 35, halfH: 20 },
  hasStandardLeads: false,
  hasValueLabel: false,
  getPins: () => [{ index: 0, x: 0, y: 0, label: "NET" }],
  render: (ctx, comp, state) => {
    const isSelected = state.lineWidth > 2.4;
    const isHovered = state.lineWidth > 2.0 && !isSelected;
    drawNetLabel(ctx, comp, isSelected, isHovered, state.color);
  },
};

export const TextNoteDefinition: ComponentDefinition = {
  type: "text_note",
  name: "Nota de Texto EDA",
  category: "anotaciones",
  prefix: "NOTE",
  defaultProperties: { value: "Nota de ingeniería...", noteTheme: "card" },
  halfExtents: { halfW: 80, halfH: 35 },
  hasStandardLeads: false,
  hasValueLabel: false,
  isDocumentOnly: true,
  getPins: () => [],
  render: (ctx, comp, state) => {
    const isSelected = state.lineWidth > 2.4;
    const isHovered = state.lineWidth > 2.0 && !isSelected;
    drawTextNote(ctx, comp, isSelected, isHovered);
  },
};
