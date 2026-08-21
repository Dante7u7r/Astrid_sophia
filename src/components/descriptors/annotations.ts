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

export const PowerPortDefinition: ComponentDefinition = {
  type: "power_port",
  name: "Terminal de Alimentación (Power Port)",
  description: "Terminal de alimentación explícito. Emite una fuente de tensión (vsource) visible y auditable en el netlist SPICE.",
  category: "anotaciones",
  prefix: "VPORT",
  defaultProperties: {
    value: 5,
    label: "+5V",
    voltage: 5,
  },
  halfExtents: { halfW: 24, halfH: 24 },
  hasStandardLeads: false,
  hasValueLabel: true,
  optionalFloatingPins: [1],
  getPins: () => [
    { index: 0, x: 0, y: -20, label: "+", name: "POS" },
    { index: 1, x: 0, y: 20, label: "−", name: "NEG" },
  ],
  render: (ctx, comp, state) => {
    const voltage = typeof comp.value === "number" ? comp.value : (typeof comp.voltage === "number" ? comp.voltage : 5);
    ctx.strokeStyle = state.color;
    ctx.lineWidth = state.lineWidth;

    // Círculo central
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.stroke();

    // Texto de tensión
    ctx.fillStyle = state.color;
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${voltage}V`, 0, 1);

    // Terminal superior (+) y flecha
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(0, -20);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-4, -16);
    ctx.lineTo(0, -20);
    ctx.lineTo(4, -16);
    ctx.stroke();

    // Terminal inferior (-) hacia tierra / referencia
    ctx.beginPath();
    ctx.moveTo(0, 12);
    ctx.lineTo(0, 20);
    ctx.stroke();
  },
};

