import type { ComponentInstance } from "../canvas_orchestrator";

export function drawLed(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  color: string,
): void {
  const glow = comp.glowLevel ?? 0;

  // 1. Resplandor radial exterior cuando está encendido
  if (glow > 0.03) {
    const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, 32);
    grad.addColorStop(0, `rgba(255, 60, 40, ${glow * 0.75})`);
    grad.addColorStop(0.4, `rgba(255, 140, 20, ${glow * 0.4})`);
    grad.addColorStop(0.7, `rgba(255, 180, 0, ${glow * 0.15})`);
    grad.addColorStop(1, "rgba(255, 180, 0, 0)");
    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 2. Triángulo del diodo ánodo -> cátodo
  ctx.beginPath();
  ctx.moveTo(-12, -10);
  ctx.lineTo(-12, 10);
  ctx.lineTo(8, 0);
  ctx.closePath();

  if (glow > 0.05) {
    ctx.save();
    ctx.fillStyle = `rgba(255, 68, 68, ${0.4 + glow * 0.6})`;
    ctx.fill();
    ctx.strokeStyle = "#FF6B6B";
    ctx.lineWidth = 1.8;
    ctx.shadowColor = "rgba(255, 50, 50, 0.9)";
    ctx.shadowBlur = 8 * glow;
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.fill();
    ctx.stroke();
  }

  // 3. Barra del cátodo
  ctx.beginPath();
  ctx.moveTo(8, -10);
  ctx.lineTo(8, 10);
  if (glow > 0.05) {
    ctx.save();
    ctx.strokeStyle = "#FF8888";
    ctx.lineWidth = 2.0;
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.stroke();
  }

  // 4. Flechas de emisión de fotones
  ctx.save();
  ctx.strokeStyle = glow > 0.05 ? `rgba(255, 200, 50, ${0.7 + glow * 0.3})` : color;
  ctx.lineWidth = glow > 0.05 ? 1.6 : 1.2;
  if (glow > 0.05) {
    ctx.shadowColor = "rgba(255, 200, 50, 0.8)";
    ctx.shadowBlur = 4 * glow;
  }
  ctx.beginPath();
  ctx.moveTo(12, -6);
  ctx.lineTo(20, -12);
  ctx.moveTo(20, -12);
  ctx.lineTo(15, -12);
  ctx.moveTo(20, -12);
  ctx.lineTo(20, -7);

  ctx.moveTo(12, 6);
  ctx.lineTo(20, 12);
  ctx.moveTo(20, 12);
  ctx.lineTo(15, 12);
  ctx.moveTo(20, 12);
  ctx.lineTo(20, 7);
  ctx.stroke();
  ctx.restore();
}

export function drawSwitch(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
): void {
  const isClosed = comp.switchState ?? false;
  ctx.beginPath();
  ctx.moveTo(-40, 0);
  ctx.lineTo(-15, 0);
  ctx.moveTo(-15, -5);
  ctx.lineTo(-15, 5);
  ctx.stroke();

  if (isClosed) {
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(40, 0);
    ctx.moveTo(15, -5);
    ctx.lineTo(15, 5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-15, 0);
    ctx.lineTo(15, 0);
    ctx.strokeStyle = "hsl(174, 97%, 69%)";
    ctx.shadowColor = "hsl(174, 97%, 69%)";
    ctx.shadowBlur = 6;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(15, -8);
    ctx.lineTo(40, -8);
    ctx.moveTo(15, -8);
    ctx.lineTo(20, 0);
    ctx.lineTo(15, 8);
    ctx.moveTo(40, 0);
    ctx.lineTo(40, 8);
    ctx.stroke();
  }
}

export function drawTransformer(
  ctx: CanvasRenderingContext2D,
  color: string,
): void {
  ctx.moveTo(-40, -20);
  for (let i = 0; i < 3; i++) {
    const startX = -40 + i * 10;
    ctx.arc(startX + 5, -20, 5, Math.PI, 0, false);
  }
  ctx.lineTo(-10, -20);

  ctx.moveTo(10, 20);
  for (let i = 0; i < 3; i++) {
    const startX = 10 + i * 10;
    ctx.arc(startX + 5, 20, 5, Math.PI, 0, false);
  }
  ctx.lineTo(40, 20);

  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.beginPath();
  ctx.moveTo(-10, -20);
  ctx.lineTo(-10, 20);
  ctx.moveTo(10, -20);
  ctx.lineTo(10, 20);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(-30, -20, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(20, 20, 3, 0, Math.PI * 2);
  ctx.fill();
}
