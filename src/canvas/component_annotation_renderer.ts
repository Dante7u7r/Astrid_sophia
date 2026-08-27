import type { ComponentInstance } from "../canvas_orchestrator";

/**
 * ComponentAnnotationRenderer
 * Renderizado vectorial de alta definición para Etiquetas de Red (Net Label Ports EDA)
 * y Bloques de Documentación / Anotaciones de Ingeniería (Engineering Text Notes).
 */

export type TerminalType =
  | "signal"
  | "power"
  | "ground"
  | "input"
  | "output"
  | "bidirectional"
  | "generator"
  | "bus_tap"
  | "test_point"
  | "no_connect";

export type TerminalStyle =
  | "standard"
  | "arrow"
  | "circle"
  | "bar"
  | "triangle"
  | "earth"
  | "chassis"
  | "digital"
  | "analog";

export type NoteTheme =
  | "card"
  | "plain"
  | "warning"
  | "info"
  | "success"
  | "outline";

const POWER_RAIL_NAMES = new Set([
  "VCC", "VDD", "VEE", "VSS", "VBAT", "VBUS", "VREF", "VCC+", "VEE-", "VDD+", "VSS-",
  "V+", "V-", "+V", "-V", "+VS", "-VS", "VIN", "VOUT", "5V", "3V3", "3.3V", "12V", "24V",
]);

export function isPowerRailName(name: string): boolean {
  const upper = name.trim().toUpperCase();
  if (POWER_RAIL_NAMES.has(upper)) return true;
  return /^[+-]?\d+(\.\d+)?\s*V$/i.test(upper) || /^[+-]\d+(\.\d+)?$/i.test(upper);
}

export function getTerminalType(comp: ComponentInstance): TerminalType {
  if (comp.terminalType) return comp.terminalType;
  const name = String(comp.label || comp.value || comp.id || "").trim().toUpperCase();
  if (
    name === "NC" ||
    name === "NO_CONNECT" ||
    name === "N/C" ||
    name === "NO CONNECT" ||
    name === "SIN_CONEXION" ||
    name === "SIN CONEXION"
  ) {
    return "no_connect";
  }
  if (
    name === "TP" ||
    /^TP[\d_-]/i.test(name) ||
    name.startsWith("TEST") ||
    name === "TEST_POINT" ||
    name === "TESTPOINT"
  ) {
    return "test_point";
  }
  if (["GND", "0", "0V", "TIERRA", "GROUND", "AGND", "DGND", "EARTH", "CHASSIS", "MASA"].includes(name)) {
    return "ground";
  }
  if (comp.voltage !== undefined || isPowerRailName(name)) {
    return "power";
  }
  if (comp.waveType && comp.waveType !== "dc") {
    return "generator";
  }
  if (/\[\d+:\d+\]|\[\d+\.\.\d+\]/i.test(name)) {
    return "bus_tap";
  }
  return "signal";
}

export function getGroundStyle(comp: ComponentInstance): "standard" | "earth" | "chassis" | "digital" | "analog" {
  if (comp.terminalStyle === "earth" || comp.terminalStyle === "chassis" || comp.terminalStyle === "digital" || comp.terminalStyle === "analog") {
    return comp.terminalStyle;
  }
  const name = String(comp.label || comp.value || comp.id || "").trim().toUpperCase();
  if (name === "EARTH" || name === "PE" || name === "TIERRA_FISICA" || name === "PROTECTIVE_EARTH") return "earth";
  if (name === "CHASSIS" || name === "CHASIS" || name === "FRAME") return "chassis";
  if (name === "DGND" || name === "DIGITAL_GND" || name === "GNDD") return "digital";
  if (name === "AGND" || name === "ANALOG_GND" || name === "GNDA") return "analog";
  return "standard";
}

export function getPowerStyle(comp: ComponentInstance): "standard" | "arrow" | "circle" | "bar" | "triangle" {
  if (comp.terminalStyle === "arrow" || comp.terminalStyle === "circle" || comp.terminalStyle === "bar" || comp.terminalStyle === "triangle") {
    return comp.terminalStyle;
  }
  return "arrow";
}

export function parsePowerRailVoltage(comp: ComponentInstance): number {
  if (typeof comp.voltage === "number" && !isNaN(comp.voltage)) {
    return comp.voltage;
  }
  const name = String(comp.label || comp.value || comp.id || "").trim().toUpperCase();
  if (name === "VCC" || name === "VBUS") return 5.0;
  if (name === "VDD" || name === "VDD+" || name === "3V3" || name === "3.3V") return 3.3;
  if (name === "VEE") return -5.0;
  if (name === "VSS" || name === "VSS-") return 0.0;
  if (name === "V+" || name === "+V" || name === "+VS" || name === "VCC+") return 15.0;
  if (name === "V-" || name === "-V" || name === "-VS" || name === "VEE-") return -15.0;
  if (name === "VBAT") return 3.7;
  if (name === "VREF") return 2.5;
  const match = name.match(/^([+-]?\d+(?:\.\d+)?)/);
  if (match) {
    const parsed = parseFloat(match[1]);
    if (!isNaN(parsed)) return parsed;
  }
  return 5.0;
}

/**
 * Dibuja texto des-rotado para garantizar legibilidad vertical siempre de izquierda a derecha (Upright EDA Typography).
 */
function drawUprightText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  comp: ComponentInstance,
  options: {
    color: string;
    font?: string;
    align?: CanvasTextAlign;
    baseline?: CanvasTextBaseline;
  },
): void {
  ctx.save();
  ctx.translate(x, y);

  const rot = ((comp.rotation % 360) + 360) % 360;
  const scaleX = comp.mirror ? -1 : 1;
  const scaleY = comp.mirrorY ? -1 : 1;
  if (scaleX !== 1 || scaleY !== 1) {
    ctx.scale(scaleX, scaleY);
  }

  // Si está invertido (180° o 270°), des-rotamos para que el texto se lea siempre de forma natural
  if (rot === 180) {
    ctx.rotate(Math.PI);
  } else if (rot === 270) {
    ctx.rotate(Math.PI);
  }

  ctx.font = options.font || "bold 10px 'JetBrains Mono', 'Fira Code', monospace";
  ctx.textAlign = options.align || "center";
  ctx.textBaseline = options.baseline || "middle";
  ctx.fillStyle = options.color;
  ctx.fillText(text, 0, 0);
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

/**
 * Renderiza cualquier Etiqueta de Red o Puerto EDA con estilo profesional
 */
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
    // TERMINAL DE ALIMENTACIÓN / TENSIÓN DC (Power Port EDA)
    // =========================================================================
    const voltageVal = parsePowerRailVoltage(comp);
    const displayLabel = comp.label || (comp.voltage !== undefined ? `${comp.voltage >= 0 ? "+" : ""}${comp.voltage}V` : netName);
    const isNegative = voltageVal < 0;
    const powerStyle = getPowerStyle(comp);
    const strokeCol = isSelected ? "#38BDF8" : isHovered ? "#FBBF24" : isNegative ? "#38BDF8" : "#F59E0B";
    const dir = isNegative ? 1 : -1;

    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = isSelected ? 2.2 : 1.8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // 1. Tallo vertical desde el pin de anclaje (0,0)
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, dir * 12);
    ctx.stroke();

    // 2. Renderizado según estilo de alimentación
    if (powerStyle === "circle") {
      // Estilo Círculo de Tensión (Proteus V-Port)
      const cy = dir * 20;
      ctx.beginPath();
      ctx.arc(0, cy, 9, 0, Math.PI * 2);
      ctx.fillStyle = isSelected
        ? "rgba(56, 189, 248, 0.35)"
        : isNegative
          ? "rgba(56, 189, 248, 0.18)"
          : "rgba(245, 158, 11, 0.22)";
      ctx.fill();
      ctx.stroke();

      drawUprightText(ctx, displayLabel, 0, cy, comp, {
        color: isSelected ? "#F0F9FF" : "#FDE68A",
        font: "bold 8px 'JetBrains Mono', monospace",
      });
    } else if (powerStyle === "bar") {
      // Estilo Barra T IEEE
      const barY = dir * 14;
      ctx.beginPath();
      ctx.moveTo(-10, barY);
      ctx.lineTo(10, barY);
      ctx.stroke();

      drawUprightText(ctx, displayLabel, 0, dir * 22, comp, {
        color: isSelected ? "#F0F9FF" : "#FDE68A",
        font: "bold 9px 'JetBrains Mono', monospace",
      });
    } else if (powerStyle === "triangle") {
      // Estilo Triángulo IEEE
      ctx.beginPath();
      ctx.moveTo(-7, dir * 12);
      ctx.lineTo(0, dir * 22);
      ctx.lineTo(7, dir * 12);
      ctx.closePath();
      ctx.fillStyle = isSelected
        ? "rgba(56, 189, 248, 0.35)"
        : isNegative
          ? "rgba(56, 189, 248, 0.20)"
          : "rgba(245, 158, 11, 0.25)";
      ctx.fill();
      ctx.stroke();

      drawUprightText(ctx, displayLabel, 0, dir * 28, comp, {
        color: isSelected ? "#F0F9FF" : "#FDE68A",
        font: "bold 9px 'JetBrains Mono', monospace",
      });
    } else {
      // Estilo Flecha Clásica con Barra
      ctx.beginPath();
      ctx.moveTo(-9, dir * 12);
      ctx.lineTo(9, dir * 12);
      ctx.moveTo(0, dir * 12);
      ctx.lineTo(0, dir * 18);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-6, dir * 12);
      ctx.lineTo(0, dir * 21);
      ctx.lineTo(6, dir * 12);
      ctx.closePath();
      ctx.fillStyle = isSelected
        ? "rgba(56, 189, 248, 0.35)"
        : isNegative
          ? "rgba(56, 189, 248, 0.20)"
          : "rgba(245, 158, 11, 0.25)";
      ctx.fill();
      ctx.stroke();

      drawUprightText(ctx, displayLabel, 0, dir * 27, comp, {
        color: isSelected ? "#F0F9FF" : "#FDE68A",
        font: "bold 10px 'JetBrains Mono', monospace",
      });
    }

    // 3. Punto de anclaje (0,0)
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = strokeCol;
    ctx.fill();

    if (isSelected || isHovered) {
      drawUprightText(ctx, "⚡ V-SRC VIRTUAL", 0, dir * 38, comp, {
        color: isSelected ? "#38BDF8" : "rgba(245, 158, 11, 0.95)",
        font: "600 7px 'Inter', sans-serif",
      });
    }

  } else if (terminalType === "ground") {
    // =========================================================================
    // TERMINAL DE TIERRA / GND (Standard, Earth PE, Chassis, AGND, DGND)
    // =========================================================================
    const gStyle = getGroundStyle(comp);
    const strokeCol = isSelected ? "#38BDF8" : isHovered ? "#34D399" : color || "#10B981";

    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = isSelected ? 2.2 : 1.8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // 1. Tallo vertical desde el pin (0,0) hacia abajo
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 10);
    ctx.stroke();

    // 2. Renderizado según la variante de tierra
    if (gStyle === "earth") {
      // Tierra de Protección / Earth PE (3 barras + semicírculo/círculo)
      ctx.beginPath();
      ctx.moveTo(-11, 10);
      ctx.lineTo(11, 10);
      ctx.moveTo(-7, 14);
      ctx.lineTo(7, 14);
      ctx.moveTo(-3, 18);
      ctx.lineTo(3, 18);
      ctx.stroke();

      // Círculo exterior PE
      ctx.beginPath();
      ctx.arc(0, 13, 13, 0, Math.PI * 2);
      ctx.stroke();

      drawUprightText(ctx, netName || "PE", 0, 31, comp, {
        color: isSelected ? "#F0F9FF" : "#A7F3D0",
        font: "bold 8px 'JetBrains Mono', monospace",
      });
    } else if (gStyle === "chassis") {
      // Masa de Chasis / Frame (Línea horizontal + 3 diagonales a 45°)
      ctx.beginPath();
      ctx.moveTo(-10, 10);
      ctx.lineTo(10, 10);
      // Rayas inclinadas
      ctx.moveTo(-7, 10);
      ctx.lineTo(-12, 17);
      ctx.moveTo(0, 10);
      ctx.lineTo(-5, 17);
      ctx.moveTo(7, 10);
      ctx.lineTo(2, 17);
      ctx.stroke();

      drawUprightText(ctx, netName || "CHASSIS", 0, 23, comp, {
        color: isSelected ? "#F0F9FF" : "#A7F3D0",
        font: "bold 8px 'JetBrains Mono', monospace",
      });
    } else if (gStyle === "digital") {
      // Tierra Digital (DGND): Triángulo abierto
      ctx.beginPath();
      ctx.moveTo(-9, 10);
      ctx.lineTo(9, 10);
      ctx.lineTo(0, 20);
      ctx.closePath();
      ctx.fillStyle = isSelected ? "rgba(56, 189, 248, 0.25)" : "rgba(16, 185, 129, 0.12)";
      ctx.fill();
      ctx.stroke();

      drawUprightText(ctx, netName || "DGND", 0, 27, comp, {
        color: isSelected ? "#F0F9FF" : "#A7F3D0",
        font: "bold 8px 'JetBrains Mono', monospace",
      });
    } else if (gStyle === "analog") {
      // Tierra Analógica (AGND): Triángulo relleno
      ctx.beginPath();
      ctx.moveTo(-9, 10);
      ctx.lineTo(9, 10);
      ctx.lineTo(0, 20);
      ctx.closePath();
      ctx.fillStyle = isSelected ? "#38BDF8" : "#10B981";
      ctx.fill();
      ctx.stroke();

      drawUprightText(ctx, netName || "AGND", 0, 27, comp, {
        color: isSelected ? "#F0F9FF" : "#A7F3D0",
        font: "bold 8px 'JetBrains Mono', monospace",
      });
    } else {
      // Tierra Estándar (3 barras horizontales decrecientes)
      ctx.beginPath();
      ctx.moveTo(-11, 10);
      ctx.lineTo(11, 10);
      ctx.moveTo(-7, 14);
      ctx.lineTo(7, 14);
      ctx.moveTo(-3, 18);
      ctx.lineTo(3, 18);
      ctx.stroke();

      drawUprightText(ctx, netName || "GND", 0, 24, comp, {
        color: isSelected ? "#F0F9FF" : "#A7F3D0",
        font: "bold 9px 'JetBrains Mono', monospace",
      });
    }

    // 3. Punto de anclaje (0,0)
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = strokeCol;
    ctx.fill();

  } else if (terminalType === "bidirectional") {
    // =========================================================================
    // PUERTO BIDIRECCIONAL (In/Out Port EDA: Forma de Diamante / Doble Flecha)
    // =========================================================================
    ctx.font = "bold 10px 'JetBrains Mono', 'Fira Code', monospace";
    const metrics = ctx.measureText(netName);
    const textWidth = Math.max(28, metrics.width);
    const arrowW = 8;
    const totalLength = textWidth + arrowW * 2 + 10;
    const halfH = 11;
    const strokeCol = isSelected ? "#38BDF8" : isHovered ? "#D8B4FE" : "#A855F7";

    // Hexágono / Diamante bidireccional apuntando a ambos lados: Pin en (0,0)
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(arrowW, -halfH);
    ctx.lineTo(totalLength - arrowW, -halfH);
    ctx.lineTo(totalLength, 0);
    ctx.lineTo(totalLength - arrowW, halfH);
    ctx.lineTo(arrowW, halfH);
    ctx.closePath();

    ctx.fillStyle = isSelected
      ? "rgba(56, 189, 248, 0.35)"
      : isHovered
        ? "rgba(88, 28, 135, 0.90)"
        : "rgba(59, 7, 100, 0.88)";
    ctx.fill();
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = isSelected ? 2.0 : 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = strokeCol;
    ctx.fill();

    const textCenterX = totalLength / 2;
    drawUprightText(ctx, `< ${netName} >`, textCenterX, 0, comp, {
      color: isSelected ? "#F0F9FF" : "#F3E8FF",
      font: "bold 9px 'JetBrains Mono', monospace",
    });

  } else if (terminalType === "bus_tap") {
    // =========================================================================
    // PUERTO DE BUS VECTORIAL (Bus Port [N:0])
    // =========================================================================
    ctx.font = "bold 10px 'JetBrains Mono', 'Fira Code', monospace";
    const metrics = ctx.measureText(netName);
    const textWidth = Math.max(32, metrics.width);
    const totalLength = textWidth + 22;
    const halfH = 12;
    const arrowW = 9;
    const strokeCol = isSelected ? "#38BDF8" : isHovered ? "#FDE047" : "#F59E0B";

    // Doble contorno reforzado para bus
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
        ? "rgba(120, 53, 15, 0.92)"
        : "rgba(69, 26, 3, 0.90)";
    ctx.fill();
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = isSelected ? 2.4 : 1.8;
    ctx.stroke();

    // Línea interior de refuerzo para denotar vector/bus
    ctx.beginPath();
    ctx.moveTo(arrowW + 2, -halfH + 2);
    ctx.lineTo(totalLength - 2, -halfH + 2);
    ctx.strokeStyle = "rgba(251, 191, 36, 0.45)";
    ctx.lineWidth = 1.0;
    ctx.stroke();

    // Punto de anclaje de bus
    ctx.beginPath();
    ctx.arc(0, 0, 3.0, 0, Math.PI * 2);
    ctx.fillStyle = strokeCol;
    ctx.fill();

    const textCenterX = arrowW + (totalLength - arrowW) / 2;
    drawUprightText(ctx, netName, textCenterX, 0, comp, {
      color: isSelected ? "#F0F9FF" : "#FEF3C7",
      font: "bold 9px 'JetBrains Mono', monospace",
    });

  } else if (terminalType === "test_point") {
    // =========================================================================
    // PUNTO DE PRUEBA (Test Point TP)
    // =========================================================================
    const strokeCol = isSelected ? "#38BDF8" : isHovered ? "#FDE047" : "#FBBF24";
    const padRadius = 7.0;

    // 1. Pad circular exterior
    ctx.beginPath();
    ctx.arc(0, 0, padRadius, 0, Math.PI * 2);
    ctx.fillStyle = isSelected
      ? "rgba(56, 189, 248, 0.40)"
      : isHovered
        ? "rgba(251, 191, 36, 0.35)"
        : "rgba(245, 158, 11, 0.20)";
    ctx.fill();
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = isSelected ? 2.2 : 1.6;
    ctx.stroke();

    // 2. Retícula central / Crosshair para sonda
    ctx.beginPath();
    ctx.moveTo(-padRadius - 2, 0);
    ctx.lineTo(padRadius + 2, 0);
    ctx.moveTo(0, -padRadius - 2);
    ctx.lineTo(0, padRadius + 2);
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // 3. Punto central
    ctx.beginPath();
    ctx.arc(0, 0, 2.0, 0, Math.PI * 2);
    ctx.fillStyle = strokeCol;
    ctx.fill();

    // 4. Etiqueta TP
    const displayTxt = netName && netName !== "NET" ? netName : "TP";
    drawUprightText(ctx, displayTxt, 0, -padRadius - 8, comp, {
      color: isSelected ? "#F0F9FF" : "#FDE68A",
      font: "bold 9px 'JetBrains Mono', monospace",
    });

    if (isSelected || isHovered) {
      drawUprightText(ctx, "⦿ TEST POINT", 0, padRadius + 8, comp, {
        color: isSelected ? "#38BDF8" : "rgba(251, 191, 36, 0.90)",
        font: "600 7px 'Inter', sans-serif",
      });
    }

  } else if (terminalType === "output") {
    // =========================================================================
    // PUERTO DE SALIDA (Flecha apuntando hacia afuera / derecha)
    // =========================================================================
    ctx.font = "bold 10px 'JetBrains Mono', 'Fira Code', monospace";
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

    const textCenterX = (totalLength - arrowW) / 2;
    drawUprightText(ctx, netName, textCenterX, 0, comp, {
      color: isSelected ? "#F0F9FF" : "#E2E8F0",
      font: "bold 10px 'JetBrains Mono', monospace",
    });

  } else if (terminalType === "generator") {
    // =========================================================================
    // GENERADOR DE SEÑAL / RELOJ (Banderola con glifo de onda)
    // =========================================================================
    const wave = comp.waveType || "square";
    const freq = comp.frequency ?? 1000;
    const freqStr = freq >= 1e6 ? `${+(freq / 1e6).toPrecision(3)}M` : freq >= 1e3 ? `${+(freq / 1e3).toPrecision(3)}k` : `${freq}Hz`;
    const labelText = `${netName} (${freqStr})`;

    ctx.font = "bold 9px 'JetBrains Mono', 'Fira Code', monospace";
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

    const textCenterX = arrowW + 12 + (totalLength - arrowW - 12) / 2;
    drawUprightText(ctx, labelText, textCenterX, 0, comp, {
      color: isSelected ? "#F0F9FF" : "#FEF08A",
      font: "bold 9px 'JetBrains Mono', monospace",
    });

  } else if (terminalType === "no_connect") {
    // =========================================================================
    // DIRECTIVA SIN CONEXIÓN / NO CONNECT (NC / ✕)
    // =========================================================================
    const strokeCol = isSelected ? "#38BDF8" : isHovered ? "#F87171" : "#EF4444";
    const size = 6.0;

    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = isSelected ? 2.4 : 2.0;
    ctx.lineCap = "round";

    // 1. Cruz 'X' centrada sobre el pin de anclaje (0, 0)
    ctx.beginPath();
    ctx.moveTo(-size, -size);
    ctx.lineTo(size, size);
    ctx.moveTo(-size, size);
    ctx.lineTo(size, -size);
    ctx.stroke();

    // 2. Punto central de anclaje
    ctx.beginPath();
    ctx.arc(0, 0, 2.0, 0, Math.PI * 2);
    ctx.fillStyle = strokeCol;
    ctx.fill();

    // 3. Etiqueta "NC"
    const displayTxt = comp.label && comp.label !== "NET" && comp.label !== "NC" ? comp.label : "NC";
    drawUprightText(ctx, displayTxt, size + 8, 0, comp, {
      color: isSelected ? "#F0F9FF" : "#FCA5A5",
      font: "bold 8px 'JetBrains Mono', monospace",
      align: "center",
    });

    if (isSelected || isHovered) {
      drawUprightText(ctx, "✕ NO CONNECT", size + 16, 10, comp, {
        color: isSelected ? "#38BDF8" : "rgba(239, 68, 68, 0.90)",
        font: "600 7px 'Inter', sans-serif",
      });
    }

  } else if (terminalType === "input") {
    // =========================================================================
    // PUERTO DE ENTRADA (Banderola apuntando hacia el pin / circuito en Índigo)
    // =========================================================================
    ctx.font = "bold 10px 'JetBrains Mono', 'Fira Code', monospace";
    const metrics = ctx.measureText(netName);
    const textWidth = Math.max(28, metrics.width);
    const totalLength = textWidth + 18;
    const halfH = 10;
    const arrowW = 8;
    const strokeCol = isSelected ? "#38BDF8" : isHovered ? "#A5B4FC" : "#818CF8";

    // Banderola apuntando hacia el pin de anclaje (0,0)
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
        ? "rgba(49, 46, 129, 0.95)"
        : "rgba(30, 27, 75, 0.90)";
    ctx.fill();
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = isSelected ? 2.0 : 1.4;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = strokeCol;
    ctx.fill();

    const textCenterX = arrowW + (totalLength - arrowW) / 2;
    drawUprightText(ctx, netName, textCenterX, 0, comp, {
      color: isSelected ? "#F0F9FF" : "#E0E7FF",
      font: "bold 10px 'JetBrains Mono', monospace",
    });

  } else {
    // =========================================================================
    // ETIQUETA DE RED / SEÑAL (Banderola Direccional EDA en Azul Celeste)
    // =========================================================================
    ctx.font = "bold 10px 'JetBrains Mono', 'Fira Code', monospace";
    const metrics = ctx.measureText(netName);
    const textWidth = Math.max(28, metrics.width);
    const totalLength = textWidth + 18;
    const halfH = 10;
    const arrowW = 8;
    const strokeCol = isSelected ? "#38BDF8" : isHovered ? "#78C8F0" : color || "#38BDF8";

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
    drawUprightText(ctx, netName, textCenterX, 0, comp, {
      color: isSelected ? "#F0F9FF" : "#E2E8F0",
      font: "bold 10px 'JetBrains Mono', monospace",
    });
  }

  ctx.restore();
}

/**
 * Renderiza Bloque de Notas de Ingeniería / Documentación EDA
 */
export function drawTextNote(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  isSelected: boolean,
  isHovered: boolean,
): void {
  const content = String(comp.label || comp.value || "Nota").trim();
  const lines = content.split("\n");
  const fontSize = Math.max(10, Math.min(comp.fontSize || 12, 32));
  const lineHeight = fontSize * 1.38;
  const theme = (comp.noteTheme as NoteTheme) || "card";

  ctx.save();
  ctx.font = `${fontSize >= 16 ? "bold " : ""}${fontSize}px 'Inter', -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  // Calcular dimensiones según el texto
  let maxLineWidth = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width;
    if (w > maxLineWidth) maxLineWidth = w;
  }

  const paddingX = 14;
  const paddingY = 12;
  const boxWidth = Math.max(80, maxLineWidth + paddingX * 2);
  const boxHeight = Math.max(36, lines.length * lineHeight + paddingY * 2);

  const startX = -boxWidth / 2;
  const startY = -boxHeight / 2;

  // 1. Renderizar Fondo según el tema
  if (theme !== "plain") {
    ctx.beginPath();
    drawRoundedRect(ctx, startX, startY, boxWidth, boxHeight, 6);

    if (theme === "card") {
      ctx.fillStyle = "rgba(15, 23, 42, 0.90)";
      ctx.fill();
      ctx.strokeStyle = isSelected ? "#38BDF8" : isHovered ? "#64748B" : "rgba(51, 65, 85, 0.65)";
      ctx.lineWidth = isSelected ? 2.0 : 1.0;
      ctx.stroke();

      // Franja superior de acento
      ctx.fillStyle = isSelected ? "#38BDF8" : "#3B82F6";
      ctx.beginPath();
      drawRoundedRect(ctx, startX, startY, boxWidth, 3.5, [6, 6, 0, 0]);
      ctx.fill();
    } else if (theme === "warning") {
      ctx.fillStyle = "rgba(45, 26, 14, 0.92)";
      ctx.fill();
      ctx.strokeStyle = isSelected ? "#F59E0B" : "rgba(245, 158, 11, 0.65)";
      ctx.lineWidth = isSelected ? 2.0 : 1.2;
      ctx.stroke();

      ctx.fillStyle = "#F59E0B";
      ctx.beginPath();
      drawRoundedRect(ctx, startX, startY, boxWidth, 3.5, [6, 6, 0, 0]);
      ctx.fill();
    } else if (theme === "info") {
      ctx.fillStyle = "rgba(12, 35, 64, 0.92)";
      ctx.fill();
      ctx.strokeStyle = isSelected ? "#38BDF8" : "rgba(56, 189, 248, 0.65)";
      ctx.lineWidth = isSelected ? 2.0 : 1.2;
      ctx.stroke();

      ctx.fillStyle = "#38BDF8";
      ctx.beginPath();
      drawRoundedRect(ctx, startX, startY, boxWidth, 3.5, [6, 6, 0, 0]);
      ctx.fill();
    } else if (theme === "success") {
      ctx.fillStyle = "rgba(6, 44, 34, 0.92)";
      ctx.fill();
      ctx.strokeStyle = isSelected ? "#34D399" : "rgba(16, 185, 129, 0.65)";
      ctx.lineWidth = isSelected ? 2.0 : 1.2;
      ctx.stroke();

      ctx.fillStyle = "#10B981";
      ctx.beginPath();
      drawRoundedRect(ctx, startX, startY, boxWidth, 3.5, [6, 6, 0, 0]);
      ctx.fill();
    } else if (theme === "outline") {
      ctx.fillStyle = "rgba(10, 15, 26, 0.45)";
      ctx.fill();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = isSelected ? "#38BDF8" : "rgba(148, 163, 184, 0.55)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  } else if (isSelected || isHovered) {
    ctx.strokeStyle = isSelected ? "rgba(56, 189, 248, 0.5)" : "rgba(148, 163, 184, 0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(startX - 2, startY - 2, boxWidth + 4, boxHeight + 4);
  }

  // 2. Renderizar Líneas de Texto
  const textColor =
    comp.textColor ||
    (theme === "warning" ? "#FDE68A" : theme === "info" ? "#BAE6FD" : theme === "success" ? "#A7F3D0" : isSelected ? "#FFFFFF" : "#E2E8F0");
  ctx.fillStyle = textColor;

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(
      lines[i],
      startX + paddingX,
      startY + paddingY + i * lineHeight,
    );
  }

  ctx.restore();
}

/**
 * Calcula dinámicamente las dimensiones medias (halfExtents) para net_label según texto y tipo.
 */
export function getNetLabelDynamicExtents(comp: ComponentInstance): { halfW: number; halfH: number } {
  const tType = getTerminalType(comp);
  const text = String(comp.label || comp.value || comp.id || "NET").trim();

  if (tType === "power") {
    return { halfW: 24, halfH: 26 };
  }
  if (tType === "ground") {
    return { halfW: 20, halfH: 24 };
  }
  if (tType === "test_point") {
    return { halfW: 22, halfH: 20 };
  }
  if (tType === "no_connect") {
    return { halfW: 18, halfH: 14 };
  }

  // Para señal, entrada, salida, bidireccional, bus, generador:
  // Estimar el ancho según longitud del texto (promedio 7.5px por carácter mono + paddings)
  const approxTextWidth = Math.max(28, text.length * 7.5);
  const totalLength = approxTextWidth + 24;
  return {
    halfW: Math.max(30, Math.ceil(totalLength / 2) + 4),
    halfH: 14,
  };
}

/**
 * Calcula dinámicamente las dimensiones medias (halfExtents) para text_note según contenido.
 */
export function getTextNoteDynamicExtents(comp: ComponentInstance): { halfW: number; halfH: number } {
  const content = String(comp.label || comp.value || "Nota").trim();
  const lines = content.split("\n");
  const fontSize = Math.max(10, Math.min(comp.fontSize || 12, 32));
  const lineHeight = fontSize * 1.38;

  let maxLen = 0;
  for (const line of lines) {
    if (line.length > maxLen) maxLen = line.length;
  }

  const approxWidth = Math.max(80, maxLen * fontSize * 0.6 + 28);
  const approxHeight = Math.max(36, lines.length * lineHeight + 24);

  return {
    halfW: Math.ceil(approxWidth / 2),
    halfH: Math.ceil(approxHeight / 2),
  };
}
