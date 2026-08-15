/**
 * Renderizador de compuertas lógicas estándar IEEE para Canvas 2D.
 * Mantiene la estética CAD técnica y limpia de Astryd Sophia.
 */

export function drawAndGate(ctx: CanvasRenderingContext2D): void {
  // 1. Leads de entrada y salida
  ctx.beginPath();
  ctx.moveTo(-40, -10);
  ctx.lineTo(-20, -10);
  ctx.moveTo(-40, 10);
  ctx.lineTo(-20, 10);
  ctx.moveTo(20, 0);
  ctx.lineTo(40, 0);
  ctx.stroke();

  // 2. Cuerpo AND (Base plana + semi-cúpula circular)
  ctx.beginPath();
  ctx.moveTo(-20, -20);
  ctx.lineTo(0, -20);
  ctx.arc(0, 0, 20, -Math.PI / 2, Math.PI / 2, false);
  ctx.lineTo(-20, 20);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
}

export function drawOrGate(ctx: CanvasRenderingContext2D): void {
  // 1. Leads
  ctx.beginPath();
  ctx.moveTo(-40, -10);
  ctx.lineTo(-14, -10);
  ctx.moveTo(-40, 10);
  ctx.lineTo(-14, 10);
  ctx.moveTo(24, 0);
  ctx.lineTo(40, 0);
  ctx.stroke();

  // 2. Cuerpo OR (Curva cóncava de entrada + dos arcos convergentes de salida)
  ctx.beginPath();
  ctx.moveTo(-22, -22);
  // Arco superior hasta la punta
  ctx.quadraticCurveTo(6, -20, 24, 0);
  // Arco inferior desde la punta
  ctx.quadraticCurveTo(6, 20, -22, 22);
  // Arco cóncavo de espalda
  ctx.quadraticCurveTo(-10, 0, -22, -22);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
}

export function drawNotGate(ctx: CanvasRenderingContext2D): void {
  // 1. Leads
  ctx.beginPath();
  ctx.moveTo(-40, 0);
  ctx.lineTo(-16, 0);
  ctx.moveTo(20, 0);
  ctx.lineTo(40, 0);
  ctx.stroke();

  // 2. Triángulo inversor
  ctx.beginPath();
  ctx.moveTo(-16, -16);
  ctx.lineTo(12, 0);
  ctx.lineTo(-16, 16);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();

  // 3. Burbuja de inversión
  ctx.beginPath();
  ctx.arc(16, 0, 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fill();
}

export function drawNandGate(ctx: CanvasRenderingContext2D): void {
  // 1. Leads
  ctx.beginPath();
  ctx.moveTo(-40, -10);
  ctx.lineTo(-20, -10);
  ctx.moveTo(-40, 10);
  ctx.lineTo(-20, 10);
  ctx.moveTo(24, 0);
  ctx.lineTo(40, 0);
  ctx.stroke();

  // 2. Cuerpo AND
  ctx.beginPath();
  ctx.moveTo(-20, -20);
  ctx.lineTo(0, -20);
  ctx.arc(0, 0, 20, -Math.PI / 2, Math.PI / 2, false);
  ctx.lineTo(-20, 20);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();

  // 3. Burbuja de inversión
  ctx.beginPath();
  ctx.arc(20, 0, 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fill();
}

export function drawNorGate(ctx: CanvasRenderingContext2D): void {
  // 1. Leads
  ctx.beginPath();
  ctx.moveTo(-40, -10);
  ctx.lineTo(-14, -10);
  ctx.moveTo(-40, 10);
  ctx.lineTo(-14, 10);
  ctx.moveTo(28, 0);
  ctx.lineTo(40, 0);
  ctx.stroke();

  // 2. Cuerpo OR
  ctx.beginPath();
  ctx.moveTo(-22, -22);
  ctx.quadraticCurveTo(6, -20, 20, 0);
  ctx.quadraticCurveTo(6, 20, -22, 22);
  ctx.quadraticCurveTo(-10, 0, -22, -22);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();

  // 3. Burbuja de inversión
  ctx.beginPath();
  ctx.arc(24, 0, 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fill();
}

export function drawXorGate(ctx: CanvasRenderingContext2D): void {
  // 1. Leads
  ctx.beginPath();
  ctx.moveTo(-40, -10);
  ctx.lineTo(-20, -10);
  ctx.moveTo(-40, 10);
  ctx.lineTo(-20, 10);
  ctx.moveTo(24, 0);
  ctx.lineTo(40, 0);
  ctx.stroke();

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
  ctx.stroke();
  ctx.fill();
}
