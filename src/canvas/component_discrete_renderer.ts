import type { ComponentInstance } from "../canvas_orchestrator";

export function drawLed(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  color: string,
): void {
  ctx.moveTo(-12, -10);
  ctx.lineTo(-12, 10);
  ctx.lineTo(8, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(8, -10);
  ctx.lineTo(8, 10);
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(14, -6);
  ctx.lineTo(20, -10);
  ctx.moveTo(20, -10);
  ctx.lineTo(16, -10);
  ctx.moveTo(20, -10);
  ctx.lineTo(20, -6);
  ctx.moveTo(14, 6);
  ctx.lineTo(20, 10);
  ctx.moveTo(20, 10);
  ctx.lineTo(16, 10);
  ctx.moveTo(20, 10);
  ctx.lineTo(20, 6);
  ctx.stroke();

  const glow = comp.glowLevel ?? 0;
  if (glow > 0.05) {
    const grad = ctx.createRadialGradient(8, 0, 4, 8, 0, 28);
    grad.addColorStop(0, `rgba(255, 100, 0, ${glow * 0.5})`);
    grad.addColorStop(0.5, `rgba(255, 180, 0, ${glow * 0.2})`);
    grad.addColorStop(1, "rgba(255, 180, 0, 0)");
    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(8, 0, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
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
