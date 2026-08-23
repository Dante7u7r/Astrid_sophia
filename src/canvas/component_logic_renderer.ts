/**
 * Renderizador de compuertas lógicas estándar IEEE para Canvas 2D con visualización de niveles lógicos en vivo.
 * Mantiene la estética CAD técnica y limpia de Astryd Sophia con cero impacto en GPU.
 */

export interface LogicGateRenderOptions {
  levelA?: "1" | "0" | "X";
  levelB?: "1" | "0" | "X";
  levelY?: "1" | "0" | "X";
}

function getLogicColor(level?: "1" | "0" | "X"): string {
  if (level === "1") return "#10B981"; // Verde Esmeralda (Nivel Alto / 5V / 3.3V)
  if (level === "0") return "#64748B"; // Pizarra / Gris Oscuro (Nivel Bajo / 0V / GND)
  if (level === "X") return "#F59E0B"; // Ámbar (Indeterminado / Flotante)
  return "#475569";
}

function drawLogicTerminalNode(ctx: CanvasRenderingContext2D, x: number, y: number, level?: "1" | "0" | "X"): void {
  if (!level) return;
  ctx.save();
  ctx.fillStyle = getLogicColor(level);
  ctx.beginPath();
  ctx.arc(x, y, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawAndGate(ctx: CanvasRenderingContext2D, opts?: LogicGateRenderOptions): void {
  // 1. Leads de entrada y salida
  ctx.beginPath();
  ctx.moveTo(-40, -10);
  ctx.lineTo(-20, -10);
  ctx.moveTo(-40, 10);
  ctx.lineTo(-20, 10);
  ctx.moveTo(20, 0);
  ctx.lineTo(40, 0);
  ctx.stroke();

  // Terminales lógicas visuales
  drawLogicTerminalNode(ctx, -38, -10, opts?.levelA);
  drawLogicTerminalNode(ctx, -38, 10, opts?.levelB);
  drawLogicTerminalNode(ctx, 38, 0, opts?.levelY);

  // 2. Cuerpo AND (Base plana + semi-cúpula circular)
  ctx.beginPath();
  ctx.moveTo(-20, -20);
  ctx.lineTo(0, -20);
  ctx.arc(0, 0, 20, -Math.PI / 2, Math.PI / 2, false);
  ctx.lineTo(-20, 20);
  ctx.closePath();

  if (opts?.levelY === "1") {
    ctx.save();
    ctx.fillStyle = "rgba(16, 185, 129, 0.16)";
    ctx.fill();
    ctx.restore();
  } else {
    ctx.fill();
  }
  ctx.stroke();
}

export function drawOrGate(ctx: CanvasRenderingContext2D, opts?: LogicGateRenderOptions): void {
  // 1. Leads
  ctx.beginPath();
  ctx.moveTo(-40, -10);
  ctx.lineTo(-14, -10);
  ctx.moveTo(-40, 10);
  ctx.lineTo(-14, 10);
  ctx.moveTo(24, 0);
  ctx.lineTo(40, 0);
  ctx.stroke();

  drawLogicTerminalNode(ctx, -38, -10, opts?.levelA);
  drawLogicTerminalNode(ctx, -38, 10, opts?.levelB);
  drawLogicTerminalNode(ctx, 38, 0, opts?.levelY);

  // 2. Cuerpo OR (Curva cóncava de entrada + dos arcos convergentes de salida)
  ctx.beginPath();
  ctx.moveTo(-22, -22);
  ctx.quadraticCurveTo(6, -20, 24, 0);
  ctx.quadraticCurveTo(6, 20, -22, 22);
  ctx.quadraticCurveTo(-10, 0, -22, -22);
  ctx.closePath();

  if (opts?.levelY === "1") {
    ctx.save();
    ctx.fillStyle = "rgba(16, 185, 129, 0.16)";
    ctx.fill();
    ctx.restore();
  } else {
    ctx.fill();
  }
  ctx.stroke();
}

export function drawNotGate(ctx: CanvasRenderingContext2D, opts?: LogicGateRenderOptions): void {
  // 1. Leads
  ctx.beginPath();
  ctx.moveTo(-40, 0);
  ctx.lineTo(-16, 0);
  ctx.moveTo(20, 0);
  ctx.lineTo(40, 0);
  ctx.stroke();

  drawLogicTerminalNode(ctx, -38, 0, opts?.levelA);
  drawLogicTerminalNode(ctx, 38, 0, opts?.levelY);

  // 2. Triángulo inversor
  ctx.beginPath();
  ctx.moveTo(-16, -16);
  ctx.lineTo(12, 0);
  ctx.lineTo(-16, 16);
  ctx.closePath();

  if (opts?.levelY === "1") {
    ctx.save();
    ctx.fillStyle = "rgba(16, 185, 129, 0.16)";
    ctx.fill();
    ctx.restore();
  } else {
    ctx.fill();
  }
  ctx.stroke();

  // 3. Burbuja de inversión
  ctx.beginPath();
  ctx.arc(16, 0, 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fill();
}

export function drawNandGate(ctx: CanvasRenderingContext2D, opts?: LogicGateRenderOptions): void {
  // 1. Leads
  ctx.beginPath();
  ctx.moveTo(-40, -10);
  ctx.lineTo(-20, -10);
  ctx.moveTo(-40, 10);
  ctx.lineTo(-20, 10);
  ctx.moveTo(24, 0);
  ctx.lineTo(40, 0);
  ctx.stroke();

  drawLogicTerminalNode(ctx, -38, -10, opts?.levelA);
  drawLogicTerminalNode(ctx, -38, 10, opts?.levelB);
  drawLogicTerminalNode(ctx, 38, 0, opts?.levelY);

  // 2. Cuerpo AND
  ctx.beginPath();
  ctx.moveTo(-20, -20);
  ctx.lineTo(0, -20);
  ctx.arc(0, 0, 20, -Math.PI / 2, Math.PI / 2, false);
  ctx.lineTo(-20, 20);
  ctx.closePath();

  if (opts?.levelY === "1") {
    ctx.save();
    ctx.fillStyle = "rgba(16, 185, 129, 0.16)";
    ctx.fill();
    ctx.restore();
  } else {
    ctx.fill();
  }
  ctx.stroke();

  // 3. Burbuja de inversión
  ctx.beginPath();
  ctx.arc(20, 0, 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fill();
}

export function drawNorGate(ctx: CanvasRenderingContext2D, opts?: LogicGateRenderOptions): void {
  // 1. Leads
  ctx.beginPath();
  ctx.moveTo(-40, -10);
  ctx.lineTo(-14, -10);
  ctx.moveTo(-40, 10);
  ctx.lineTo(-14, 10);
  ctx.moveTo(28, 0);
  ctx.lineTo(40, 0);
  ctx.stroke();

  drawLogicTerminalNode(ctx, -38, -10, opts?.levelA);
  drawLogicTerminalNode(ctx, -38, 10, opts?.levelB);
  drawLogicTerminalNode(ctx, 38, 0, opts?.levelY);

  // 2. Cuerpo OR
  ctx.beginPath();
  ctx.moveTo(-22, -22);
  ctx.quadraticCurveTo(6, -20, 20, 0);
  ctx.quadraticCurveTo(6, 20, -22, 22);
  ctx.quadraticCurveTo(-10, 0, -22, -22);
  ctx.closePath();

  if (opts?.levelY === "1") {
    ctx.save();
    ctx.fillStyle = "rgba(16, 185, 129, 0.16)";
    ctx.fill();
    ctx.restore();
  } else {
    ctx.fill();
  }
  ctx.stroke();

  // 3. Burbuja de inversión
  ctx.beginPath();
  ctx.arc(24, 0, 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fill();
}

export function drawXorGate(ctx: CanvasRenderingContext2D, opts?: LogicGateRenderOptions): void {
  // 1. Leads
  ctx.beginPath();
  ctx.moveTo(-40, -10);
  ctx.lineTo(-20, -10);
  ctx.moveTo(-40, 10);
  ctx.lineTo(-20, 10);
  ctx.moveTo(24, 0);
  ctx.lineTo(40, 0);
  ctx.stroke();

  drawLogicTerminalNode(ctx, -38, -10, opts?.levelA);
  drawLogicTerminalNode(ctx, -38, 10, opts?.levelB);
  drawLogicTerminalNode(ctx, 38, 0, opts?.levelY);

  // 2. Línea adicional de entrada curva (XOR)
  ctx.beginPath();
  ctx.moveTo(-28, -22);
  ctx.quadraticCurveTo(-16, 0, -28, 22);
  ctx.stroke();

  // 3. Cuerpo principal OR
  ctx.beginPath();
  ctx.moveTo(-22, -22);
  ctx.quadraticCurveTo(6, -20, 24, 0);
  ctx.quadraticCurveTo(6, 20, -22, 22);
  ctx.quadraticCurveTo(-10, 0, -22, -22);
  ctx.closePath();

  if (opts?.levelY === "1") {
    ctx.save();
    ctx.fillStyle = "rgba(16, 185, 129, 0.16)";
    ctx.fill();
    ctx.restore();
  } else {
    ctx.fill();
  }
  ctx.stroke();
}
