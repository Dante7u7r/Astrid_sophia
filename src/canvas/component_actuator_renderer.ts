import type { ComponentInstance } from "../canvas_orchestrator";

export function drawLamp(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
): void {
  const glow = comp.glowLevel ?? 0;
  if (glow > 0.05) {
    const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, 24);
    grad.addColorStop(0, `rgba(255, 180, 0, ${glow * 0.45})`);
    grad.addColorStop(0.5, `rgba(255, 180, 0, ${glow * 0.15})`);
    grad.addColorStop(1, "rgba(255, 180, 0, 0)");
    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Bulbo exterior de vidrio
  ctx.beginPath();
  ctx.arc(0, 0, 16, 0, Math.PI * 2);
  ctx.stroke();

  // Filamento interior en cruz
  ctx.beginPath();
  ctx.moveTo(-11, -11);
  ctx.lineTo(11, 11);
  ctx.moveTo(11, -11);
  ctx.lineTo(-11, 11);

  if (glow > 0.05) {
    ctx.save();
    // Halo base vectorizado sin shadowBlur
    ctx.strokeStyle = `rgba(245, 158, 11, ${0.4 + glow * 0.5})`;
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // Núcleo incandescente de tungsteno
    ctx.strokeStyle = `rgba(254, 240, 138, ${0.7 + glow * 0.3})`;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.stroke();
  }
}

export function drawRelay(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
): void {
  const closed = comp.relayClosed ?? false;
  // Terminales de bobina (COIL1, COIL2)
  ctx.beginPath();
  ctx.moveTo(-40, -20);
  ctx.lineTo(-20, -20);
  ctx.moveTo(-40, 20);
  ctx.lineTo(-20, 20);
  ctx.stroke();

  // Terminales de contacto (COM, NO)
  ctx.beginPath();
  ctx.moveTo(40, -20);
  ctx.lineTo(20, -20);
  ctx.moveTo(40, 20);
  ctx.lineTo(20, 20);
  ctx.stroke();

  // Símbolo de la bobina
  ctx.beginPath();
  ctx.rect(-20, -20, 10, 40);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-15, -20);
  ctx.lineTo(-15, 20);
  ctx.stroke();

  // Acoplamiento electromagnético punteado
  ctx.save();
  ctx.setLineDash([3, 2]);
  ctx.strokeStyle = closed ? "rgba(56, 189, 248, 0.6)" : "rgba(255, 255, 255, 0.25)";
  ctx.beginPath();
  ctx.moveTo(-10, 0);
  ctx.lineTo(10, 0);
  ctx.stroke();
  ctx.restore();

  // Nodos de contacto
  ctx.beginPath();
  ctx.arc(20, -20, 2.5, 0, Math.PI * 2);
  ctx.arc(20, 20, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Armadura móvil del relé
  ctx.beginPath();
  if (closed) {
    ctx.moveTo(20, -20);
    ctx.lineTo(20, 20);
    ctx.save();
    ctx.strokeStyle = "#38BDF8";
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.moveTo(20, -20);
    ctx.lineTo(10, 10);
    ctx.stroke();
  }
}

export function drawBuzzer(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  nowMs: number = Date.now(),
): void {
  const level = comp.buzzerLevel ?? 0;
  ctx.beginPath();
  ctx.moveTo(-12, -16);
  ctx.lineTo(-12, 16);
  ctx.lineTo(12, 18);
  ctx.lineTo(12, -18);
  ctx.closePath();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-20, 0);
  ctx.lineTo(-12, 0);
  ctx.stroke();

  if (level > 0.05) {
    ctx.save();
    ctx.strokeStyle = `rgba(56, 189, 248, ${level * 0.85})`;
    ctx.lineWidth = 1.6;
    const wavePhase = (nowMs / 150) % 3;
    for (let i = 0; i < 3; i++) {
      const r = 18 + i * 7 + wavePhase;
      ctx.beginPath();
      ctx.arc(4, 0, r, -Math.PI / 4, Math.PI / 4, false);
      ctx.stroke();
    }
    ctx.restore();
  }
}
