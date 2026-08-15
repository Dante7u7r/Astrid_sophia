// ==========================================================================
// SUBCIRCUIT COMPONENT DESCRIPTORS — Macromodelos SPICE (.SUBCKT)
// ==========================================================================

import type { ComponentInstance } from "../../canvas_orchestrator";
import type { ComponentDefinition, LocalPinDefinition } from "../types";

export const SubcircuitDefinition: ComponentDefinition = {
  type: "x",
  name: "Macromodelo SPICE (.SUBCKT)",
  category: "macromodelos",
  prefix: "X",
  defaultProperties: { value: "SUBCKT_MACRO", pinCount: 4 },
  halfExtents: (comp: ComponentInstance) => {
    const pinCount = comp.pinCount ?? 4;
    const pinsLeft = Math.ceil(pinCount / 2);
    const totalHeight = Math.max(pinsLeft * 40, 60);
    return { halfW: 65, halfH: totalHeight / 2 + 5 };
  },
  hasStandardLeads: false,
  hasValueLabel: false,
  getPins: (comp: ComponentInstance) => {
    const pinCount = comp.pinCount ?? 4;
    const pinsLeft = Math.ceil(pinCount / 2);
    const totalHeight = Math.max(pinsLeft * 40, 60);
    const halfH = totalHeight / 2;

    const list: LocalPinDefinition[] = [];
    for (let i = 0; i < pinCount; i++) {
      const pos = Math.floor(i / 2);
      const yOffset = -halfH + 20 + pos * 40;
      const x = i % 2 === 0 ? -60 : 60;
      const label = comp.pinLabels?.[i] ?? `P${i + 1}`;
      list.push({ index: i, x, y: yOffset, label });
    }
    return list;
  },
  render: (ctx, comp, state) => {
    const pinCount = comp.pinCount ?? 4;
    const pinsLeft = Math.ceil(pinCount / 2);
    const totalHeight = Math.max(pinsLeft * 40, 60);
    const halfH = totalHeight / 2;

    ctx.fillStyle = "rgba(10, 15, 30, 0.85)";
    ctx.fillRect(-50, -halfH, 100, totalHeight);
    ctx.strokeStyle = state.color;
    ctx.lineWidth = state.lineWidth;
    ctx.strokeRect(-50, -halfH, 100, totalHeight);

    // Muesca superior DIP
    ctx.beginPath();
    ctx.arc(0, -halfH, 8, 0, Math.PI, false);
    ctx.stroke();

    // Nombre del modelo
    const modelName = String(comp.modelName || comp.value || "SUBCKT");
    ctx.fillStyle = state.color;
    ctx.font = "bold 11px 'Inter', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(modelName, 0, 0);

    // Terminales y etiquetas de pines
    for (let i = 0; i < pinCount; i++) {
      const pos = Math.floor(i / 2);
      const y = -halfH + 20 + pos * 40;
      const isLeft = i % 2 === 0;
      const xBody = isLeft ? -50 : 50;
      const xTip = isLeft ? -60 : 60;

      ctx.beginPath();
      ctx.moveTo(xBody, y);
      ctx.lineTo(xTip, y);
      ctx.stroke();

      const label = comp.pinLabels?.[i] ?? `P${i + 1}`;
      ctx.font = "7px 'JetBrains Mono', monospace";
      ctx.fillStyle = "#94A3B8";
      if (isLeft) {
        ctx.textAlign = "left";
        ctx.fillText(label, -44, y + 2.5);
      } else {
        ctx.textAlign = "right";
        ctx.fillText(label, 44, y + 2.5);
      }
    }
  },
};
