/**
 * PoleZeroRenderer — Renderizado Gráfico Canvas 2D en el Plano Complejo de Laplace (Plano S)
 *
 * Muestra el eje Real (\sigma) e Imaginario (j\omega), el sombreado de estabilidad del
 * semiplano izquierdo (LHP) e inestabilidad del semiplano derecho (RHP), y los polos (X) y ceros (O).
 */

import type { StabilityAnalysisResult } from "../simulation/tauri_commands";

export function drawPoleZeroPlot(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  result: StabilityAnalysisResult | null,
): void {
  // Fondo
  ctx.fillStyle = "#070a14";
  ctx.fillRect(0, 0, width, height);

  const pad = 40;
  const plotWidth = width - pad * 2;
  const plotHeight = height - pad * 2;

  if (plotWidth <= 20 || plotHeight <= 20) return;

  const originX = pad + plotWidth / 2;
  const originY = pad + plotHeight / 2;

  // Determinar la escala máxima en el plano complejo
  const poles = result?.poles ?? [];
  const zeros = result?.zeros ?? [];
  let maxCoord = 100; // rad/s por defecto
  for (const p of poles) {
    if (Math.abs(p.re) > maxCoord) maxCoord = Math.abs(p.re) * 1.3;
    if (Math.abs(p.im) > maxCoord) maxCoord = Math.abs(p.im) * 1.3;
  }
  for (const z of zeros) {
    if (Math.abs(z.re) > maxCoord) maxCoord = Math.abs(z.re) * 1.3;
    if (Math.abs(z.im) > maxCoord) maxCoord = Math.abs(z.im) * 1.3;
  }
  maxCoord = Math.max(10, maxCoord);

  const scale = (Math.min(plotWidth, plotHeight) / 2) / maxCoord;

  // 1. Sombreado de estabilidad:
  // Semiplano Izquierdo LHP (\sigma < 0): Estable (azul muy sutil)
  ctx.fillStyle = "rgba(56, 189, 248, 0.04)";
  ctx.fillRect(pad, pad, plotWidth / 2, plotHeight);

  // Semiplano Derecho RHP (\sigma > 0): Inestable (rojo sutil)
  ctx.fillStyle = "rgba(239, 68, 68, 0.06)";
  ctx.fillRect(originX, pad, plotWidth / 2, plotHeight);

  // 2. Retícula concéntrica de frecuencia natural \omega_n
  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  ctx.lineWidth = 1;
  for (let r = 1; r <= 3; r++) {
    const radius = (maxCoord * (r / 3)) * scale;
    ctx.beginPath();
    ctx.arc(originX, originY, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 3. Ejes de coordenadas (\sigma y j\omega)
  ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  // Eje Real (\sigma)
  ctx.moveTo(pad, originY);
  ctx.lineTo(pad + plotWidth, originY);
  // Eje Imaginario (j\omega)
  ctx.moveTo(originX, pad);
  ctx.lineTo(originX, pad + plotHeight);
  ctx.stroke();

  // Etiquetas de Ejes
  ctx.font = "bold 9px 'JetBrains Mono', Consolas, monospace";
  ctx.fillStyle = "#38bdf8";
  ctx.textAlign = "right";
  ctx.fillText("Eje Real σ (rad/s)", pad + plotWidth - 6, originY - 6);

  ctx.textAlign = "left";
  ctx.fillText("+jω (rad/s)", originX + 6, pad + 12);
  ctx.fillText("-jω (rad/s)", originX + 6, pad + plotHeight - 6);

  // 4. Zona de Estabilidad Info
  ctx.font = "8px 'JetBrains Mono', Consolas, monospace";
  ctx.fillStyle = "rgba(56, 189, 248, 0.6)";
  ctx.textAlign = "left";
  ctx.fillText("✓ Semiplano Estable (LHP)", pad + 8, pad + 14);

  ctx.fillStyle = "rgba(248, 113, 113, 0.6)";
  ctx.textAlign = "right";
  ctx.fillText("⚠ Semiplano Inestable (RHP)", pad + plotWidth - 8, pad + 14);

  // 5. Dibujar Polos (Cruces X)
  poles.forEach((p, idx) => {
    const x = originX + p.re * scale;
    const y = originY - p.im * scale;
    const isLhp = p.re <= 0;
    const color = isLhp ? "#38bdf8" : "#f87171";

    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = isLhp ? "rgba(56, 189, 248, 0.5)" : "rgba(239, 68, 68, 0.7)";
    ctx.shadowBlur = 6;

    const arm = 6;
    ctx.beginPath();
    ctx.moveTo(x - arm, y - arm);
    ctx.lineTo(x + arm, y + arm);
    ctx.moveTo(x + arm, y - arm);
    ctx.lineTo(x - arm, y + arm);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Etiqueta del polo
    ctx.fillStyle = color;
    ctx.font = "bold 8px 'JetBrains Mono', Consolas, monospace";
    ctx.textAlign = "left";
    ctx.fillText(`p${idx + 1} (${p.re.toFixed(1)}${p.im >= 0 ? "+" : ""}${p.im.toFixed(1)}j)`, x + 8, y + 3);
  });

  // 6. Dibujar Ceros (Círculos O)
  zeros.forEach((z, idx) => {
    const x = originX + z.re * scale;
    const y = originY - z.im * scale;

    ctx.strokeStyle = "#eab308";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#eab308";
    ctx.font = "bold 8px 'JetBrains Mono', Consolas, monospace";
    ctx.textAlign = "left";
    ctx.fillText(`z${idx + 1}`, x + 8, y + 3);
  });
}
