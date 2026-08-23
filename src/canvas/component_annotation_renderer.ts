import type { ComponentInstance } from "../canvas_orchestrator";

/**
 * ComponentAnnotationRenderer
 * Renderizado vectorial de alta definición para Etiquetas de Red (Net Label Ports EDA)
 * y Bloques de Documentación / Anotaciones de Ingeniería (Engineering Text Notes).
 */

export type TerminalType = "signal" | "power" | "ground" | "input" | "output" | "generator";

export function isPowerRailName(name: string): boolean {
  const upper = name.trim().toUpperCase();
  if (["VCC", "VDD", "VEE", "VSS", "VBAT", "VBUS", "V+", "V-", "+V", "-V", "+VS", "-VS", "VCC+", "VEE-", "VDD+", "VSS-"].includes(upper)) return true;
  return /^[+-]?\d+(\.\d+)?\s*V$/i.test(upper) || /^[+-]\d+(\.\d+)?$/i.test(upper);
}

export function getTerminalType(comp: ComponentInstance): TerminalType {
  if (comp.terminalType) return comp.terminalType;
  const name = String(comp.label || comp.value || comp.id || "").trim().toUpperCase();
  if (["GND", "0", "0V", "TIERRA", "GROUND", "AGND", "DGND"].includes(name)) {
    return "ground";
  }
  if (comp.voltage !== undefined || isPowerRailName(name)) {
    return "power";
  }
  if (comp.waveType && comp.waveType !== "dc") {
    return "generator";
  }
  return "signal";
}

export function parsePowerRailVoltage(comp: ComponentInstance): number {
  if (typeof comp.voltage === "number" && !isNaN(comp.voltage)) {
    return comp.voltage;
  }
  const name = String(comp.label || comp.value || comp.id || "").trim().toUpperCase();
  if (name === "VCC") return 5.0;
  if (name === "VDD" || name === "VDD+") return 3.3;
  if (name === "VEE") return -5.0;
  if (name === "VSS" || name === "VSS-") return 0.0;
  if (name === "V+" || name === "+V" || name === "+VS" || name === "VCC+") return 15.0;
  if (name === "V-" || name === "-V" || name === "-VS" || name === "VEE-") return -15.0;
  if (name === "VBAT") return 3.7;
  if (name === "VBUS") return 5.0;
  const match = name.match(/^([+-]?\d+(?:\.\d+)?)/);
  if (match) {
    const parsed = parseFloat(match[1]);
    if (!isNaN(parsed)) return parsed;
  }
  return 5.0; // Tensión por defecto para rieles sin valor numérico
}

export function drawNetLabel(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  isSelected: boolean,
  isHovered: boolean,
  color: string,
): void {
  const terminalType = getTerminalType(comp);
  const netName = String(comp.label || comp.value || comp.id || "NET").trim().toUpperCase();

  ctx.save();

  if (terminalType === "power") {
    // =========================================================================
    // TERMINAL DE ALIMENTACIÓN / TENSIÓN DC (Estilo Proteus Power Port)
    // =========================================================================
    const voltageVal = parsePowerRailVoltage(comp);
    const displayLabel = comp.label || (comp.voltage !== undefined ? `${comp.voltage >= 0 ? "+" : ""}${comp.voltage}V` : netName);
    const isNegative = voltageVal < 0;
    const strokeCol = isSelected ? "#38BDF8" : isHovered ? "#FBBF24" : isNegative ? "#38BDF8" : "#F59E0B";

    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = isSelected ? 2.2 : 1.8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // 1. Línea vertical desde el pin (0,0) hacia arriba (o hacia abajo si es tensión negativa)
    const dir = isNegative ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, dir * 14);
    ctx.stroke();

    // 2. Barra o flecha superior de alimentación
    ctx.beginPath();
    ctx.moveTo(-10, dir * 14);
    ctx.lineTo(10, dir * 14);
    ctx.moveTo(0, dir * 14);
    ctx.lineTo(0, dir * 20);
    ctx.stroke();

    // Flecha / Triángulo superior
    ctx.beginPath();
    ctx.moveTo(-6, dir * 14);
    ctx.lineTo(0, dir * 22);
    ctx.lineTo(6, dir * 14);
    ctx.closePath();
    ctx.fillStyle = isSelected
      ? "rgba(56, 189, 248, 0.35)"
      : isNegative
        ? "rgba(56, 189, 248, 0.20)"
        : "rgba(245, 158, 11, 0.25)";
    ctx.fill();
    ctx.stroke();

    // 3. Punto de conexión en (0,0)
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = isSelected ? "#38BDF8" : "#F59E0B";
    ctx.fill();

    // 4. Etiqueta de Tensión
    ctx.font = "bold 10px 'JetBrains Mono', 'Fira Code', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = isNegative ? "top" : "bottom";
    ctx.fillStyle = isSelected ? "#F0F9FF" : "#FDE68A";
    ctx.fillText(displayLabel, 0, dir * 24);

    if (isSelected || isHovered) {
      ctx.font = "600 7px 'Inter', sans-serif";
      ctx.fillStyle = isSelected ? "#38BDF8" : "rgba(245, 158, 11, 0.90)";
      ctx.fillText("⚡ V-SRC VIRTUAL", 0, dir * (24 + 9));
    }

  } else if (terminalType === "ground") {
    // =========================================================================
    // TERMINAL DE TIERRA / GND (Estilo Proteus Ground Port)
    // =========================================================================
    const strokeCol = isSelected ? "#38BDF8" : isHovered ? "#34D399" : color || "#10B981";

    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = isSelected ? 2.2 : 1.8;
    ctx.lineCap = "round";

    // 1. Línea vertical desde el pin (0,0) hacia abajo
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 10);
    ctx.stroke();

    // 2. 3 barras horizontales decrecientes
    ctx.beginPath();
    ctx.moveTo(-11, 10);
    ctx.lineTo(11, 10);
    ctx.moveTo(-7, 14);
    ctx.lineTo(7, 14);
    ctx.moveTo(-3, 18);
    ctx.lineTo(3, 18);
    ctx.stroke();

    // 3. Punto de conexión en (0,0)
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = isSelected ? "#38BDF8" : "#10B981";
    ctx.fill();

    // 4. Etiqueta GND debajo
    ctx.font = "bold 9px 'JetBrains Mono', 'Fira Code', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = isSelected ? "#F0F9FF" : "#A7F3D0";
    ctx.fillText(netName || "GND", 0, 21);

  } else if (terminalType === "output") {
    // =========================================================================
    // PUERTO DE SALIDA (Flecha apuntando hacia afuera / derecha)
    // =========================================================================
    ctx.font = "bold 10px 'JetBrains Mono', 'Fira Code', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const metrics = ctx.measureText(netName);
    const textWidth = Math.max(26, metrics.width);
    const totalLength = textWidth + 18;
    const halfH = 10;
    const arrowW = 8;
    const strokeCol = isSelected ? "#38BDF8" : isHovered ? "#6EE7B7" : "#34D399";

    ctx.beginPath();
    ctx.moveTo(0, -halfH);
    ctx.lineTo(totalLength - arrowW, -halfH);
    ctx.lineTo(totalLength, 0);
    ctx.lineTo(totalLength - arrowW, halfH);
    ctx.lineTo(0, halfH);
    ctx.closePath();

    ctx.fillStyle = isSelected
      ? "rgba(56, 189, 248, 0.35)"
      : isHovered
        ? "rgba(6, 78, 59, 0.85)"
        : "rgba(6, 44, 34, 0.90)";
    ctx.fill();
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = isSelected ? 2.0 : 1.4;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = strokeCol;
    ctx.fill();

    ctx.fillStyle = isSelected ? "#F0F9FF" : "#E2E8F0";
    ctx.fillText(netName, (totalLength - arrowW) / 2, 0.5);

  } else if (terminalType === "generator") {
    // =========================================================================
    // GENERADOR DE SEÑAL / RELOJ (Banderola con glifo de onda)
    // =========================================================================
    const wave = comp.waveType || "square";
    const freq = comp.frequency ?? 1000;
    const freqStr = freq >= 1e6 ? `${+(freq / 1e6).toPrecision(3)}M` : freq >= 1e3 ? `${+(freq / 1e3).toPrecision(3)}k` : `${freq}Hz`;
    const labelText = `${netName} (${freqStr})`;

    ctx.font = "bold 9px 'JetBrains Mono', 'Fira Code', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const metrics = ctx.measureText(labelText);
    const textWidth = Math.max(34, metrics.width);
    const totalLength = textWidth + 24;
    const halfH = 11;
    const arrowW = 8;
    const strokeCol = isSelected ? "#38BDF8" : isHovered ? "#FDE047" : "#FBBF24";

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(arrowW, -halfH);
    ctx.lineTo(totalLength, -halfH);
    ctx.lineTo(totalLength, halfH);
    ctx.lineTo(arrowW, halfH);
    ctx.closePath();

    ctx.fillStyle = isSelected
      ? "rgba(56, 189, 248, 0.35)"
      : isHovered
        ? "rgba(113, 63, 18, 0.85)"
        : "rgba(69, 39, 10, 0.90)";
    ctx.fill();
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = isSelected ? 2.0 : 1.4;
    ctx.stroke();

    // Glifo de onda miniatura
    ctx.beginPath();
    const gx = arrowW + 6;
    if (wave === "sine") {
      ctx.moveTo(gx - 4, 0);
      ctx.quadraticCurveTo(gx - 2, -5, gx, 0);
      ctx.quadraticCurveTo(gx + 2, 5, gx + 4, 0);
    } else if (wave === "square") {
      ctx.moveTo(gx - 4, 3);
      ctx.lineTo(gx - 4, -3);
      ctx.lineTo(gx, -3);
      ctx.lineTo(gx, 3);
      ctx.lineTo(gx + 4, 3);
      ctx.lineTo(gx + 4, -3);
    } else {
      ctx.moveTo(gx - 4, 3);
      ctx.lineTo(gx, -3);
      ctx.lineTo(gx + 4, 3);
    }
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = strokeCol;
    ctx.fill();

    ctx.fillStyle = isSelected ? "#F0F9FF" : "#FEF08A";
    ctx.fillText(labelText, arrowW + 12 + (totalLength - arrowW - 12) / 2, 0.5);

  } else {
    // =========================================================================
    // ETIQUETA DE RED / SEÑAL / INPUT (Banderola Direccional EDA)
    // =========================================================================
    ctx.font = "bold 10px 'JetBrains Mono', 'Fira Code', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const metrics = ctx.measureText(netName);
    const textWidth = Math.max(28, metrics.width);
    const totalLength = textWidth + 18;
    const halfH = 10;
    const arrowW = 8;
    const isInput = terminalType === "input";
    const strokeCol = isSelected ? "#38BDF8" : isHovered ? "#78C8F0" : isInput ? "#818CF8" : color || "#38BDF8";

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
        : isInput
          ? "rgba(49, 46, 129, 0.85)"
          : "rgba(10, 16, 28, 0.90)";
    ctx.fill();

    // 3. Contorno y Borde de Acento
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = isSelected ? 2.0 : 1.4;
    ctx.stroke();

    // 4. Punto de conexión en el pin de anclaje (0,0)
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = strokeCol;
    ctx.fill();

    // 5. Nombre de la Red
    const textCenterX = arrowW + (totalLength - arrowW) / 2;
    ctx.fillStyle = isSelected ? "#F0F9FF" : "#E2E8F0";
    ctx.fillText(netName, textCenterX, 0.5);
  }

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
