import type { ComponentInstance } from "../canvas_orchestrator";

/**
 * ComponentAnnotationRenderer
 * Renderizado vectorial de alta definición para Etiquetas de Red (Net Label Ports EDA)
 * y Bloques de Documentación / Anotaciones de Ingeniería (Engineering Text Notes).
 */

export function drawNetLabel(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  isSelected: boolean,
  isHovered: boolean,
  color: string,
): void {
  const netName = String(comp.label || comp.value || comp.id || "NET").trim().toUpperCase();
  
  ctx.save();
  ctx.font = "bold 10px 'JetBrains Mono', 'Fira Code', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const metrics = ctx.measureText(netName);
  const textWidth = Math.max(28, metrics.width);
  const totalLength = textWidth + 18;
  const halfH = 10;
  const arrowW = 8;

  // 1. Trazar Banderola / Pentágono direccional EDA (Pin en 0,0 apuntando hacia +X)
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(arrowW, -halfH);
  ctx.lineTo(totalLength, -halfH);
  ctx.lineTo(totalLength, halfH);
  ctx.lineTo(arrowW, halfH);
  ctx.closePath();

  // 2. Relleno traslúcido
  ctx.fillStyle = isSelected
    ? "rgba(14, 116, 144, 0.45)"
    : isHovered
      ? "rgba(15, 23, 42, 0.95)"
      : "rgba(10, 16, 28, 0.90)";
  ctx.fill();

  // 3. Contorno y Borde de Acento
  ctx.strokeStyle = isSelected ? "#38BDF8" : isHovered ? "#78C8F0" : color || "#38BDF8";
  ctx.lineWidth = isSelected ? 2.0 : 1.4;
  ctx.stroke();

  // 4. Pequeño punto de conexión en el pin de anclaje (0,0)
  ctx.beginPath();
  ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = isSelected ? "#38BDF8" : "#F2C94C";
  ctx.fill();

  // 5. Nombre de la Red
  const textCenterX = arrowW + (totalLength - arrowW) / 2;
  ctx.fillStyle = isSelected ? "#F0F9FF" : "#E2E8F0";
  ctx.fillText(netName, textCenterX, 0.5);

  ctx.restore();
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radii: number | number[] = 4,
): void {
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, radii);
  } else {
    ctx.rect(x, y, w, h);
  }
}

export function drawTextNote(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  isSelected: boolean,
  isHovered: boolean,
): void {
  const content = String(comp.label || comp.value || "Nota").trim();
  const lines = content.split("\n");
  const fontSize = Math.max(10, Math.min(comp.fontSize || 12, 28));
  const lineHeight = fontSize * 1.35;
  const theme = comp.noteTheme || "card";

  ctx.save();
  ctx.font = `${fontSize >= 16 ? "bold " : ""}${fontSize}px 'Inter', sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  // Calcular dimensiones según el texto
  let maxLineWidth = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width;
    if (w > maxLineWidth) maxLineWidth = w;
  }

  const paddingX = 12;
  const paddingY = 10;
  const boxWidth = Math.max(80, maxLineWidth + paddingX * 2);
  const boxHeight = Math.max(36, lines.length * lineHeight + paddingY * 2);

  const startX = -boxWidth / 2;
  const startY = -boxHeight / 2;

  // 1. Renderizar Fondo según el tema
  if (theme !== "plain") {
    ctx.beginPath();
    drawRoundedRect(ctx, startX, startY, boxWidth, boxHeight, 6);

    if (theme === "card") {
      ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
      ctx.fill();
      ctx.strokeStyle = isSelected ? "#38BDF8" : isHovered ? "#64748B" : "rgba(51, 65, 85, 0.6)";
      ctx.lineWidth = isSelected ? 2.0 : 1.0;
      ctx.stroke();

      // Franja superior de acento
      ctx.fillStyle = isSelected ? "#38BDF8" : "#3B82F6";
      ctx.beginPath();
      drawRoundedRect(ctx, startX, startY, boxWidth, 3, [6, 6, 0, 0]);
      ctx.fill();
    } else if (theme === "warning") {
      ctx.fillStyle = "rgba(45, 26, 14, 0.90)";
      ctx.fill();
      ctx.strokeStyle = isSelected ? "#F59E0B" : "rgba(245, 158, 11, 0.6)";
      ctx.lineWidth = isSelected ? 2.0 : 1.2;
      ctx.stroke();
    } else if (theme === "outline") {
      ctx.fillStyle = "rgba(10, 15, 26, 0.40)";
      ctx.fill();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = isSelected ? "#38BDF8" : "rgba(148, 163, 184, 0.5)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  } else if (isSelected || isHovered) {
    // Caja tenue de selección para texto plano
    ctx.strokeStyle = isSelected ? "rgba(56, 189, 248, 0.5)" : "rgba(148, 163, 184, 0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(startX - 2, startY - 2, boxWidth + 4, boxHeight + 4);
  }

  // 2. Renderizar Líneas de Texto
  ctx.fillStyle = comp.textColor || (theme === "warning" ? "#FDE68A" : isSelected ? "#FFFFFF" : "#E2E8F0");
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(
      lines[i],
      startX + paddingX,
      startY + paddingY + i * lineHeight,
    );
  }

  ctx.restore();
}
