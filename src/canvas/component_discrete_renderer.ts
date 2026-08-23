import type { ComponentInstance } from "../canvas_orchestrator";

interface LedColorTheme {
  lens: string;
  glowPrefix: string;
  beam: string;
  stroke: string;
  photonStroke: string;
}

const LED_THEMES: Record<string, LedColorTheme> = {
  red: {
    lens: "rgba(239, 68, 68, ",
    glowPrefix: "rgba(239, 68, 68, ",
    beam: "#EF4444",
    stroke: "#F87171",
    photonStroke: "rgba(252, 165, 165, ",
  },
  green: {
    lens: "rgba(34, 197, 94, ",
    glowPrefix: "rgba(34, 197, 94, ",
    beam: "#22C55E",
    stroke: "#4ADE80",
    photonStroke: "rgba(134, 239, 172, ",
  },
  blue: {
    lens: "rgba(59, 130, 246, ",
    glowPrefix: "rgba(59, 130, 246, ",
    beam: "#3B82F6",
    stroke: "#60A5FA",
    photonStroke: "rgba(147, 197, 253, ",
  },
  yellow: {
    lens: "rgba(234, 179, 8, ",
    glowPrefix: "rgba(234, 179, 8, ",
    beam: "#EAB308",
    stroke: "#FACC15",
    photonStroke: "rgba(254, 240, 138, ",
  },
  orange: {
    lens: "rgba(249, 115, 22, ",
    glowPrefix: "rgba(249, 115, 22, ",
    beam: "#F97316",
    stroke: "#FB923C",
    photonStroke: "rgba(253, 186, 116, ",
  },
  white: {
    lens: "rgba(248, 250, 252, ",
    glowPrefix: "rgba(241, 245, 249, ",
    beam: "#FFFFFF",
    stroke: "#F1F5F9",
    photonStroke: "rgba(255, 255, 255, ",
  },
  uv: {
    lens: "rgba(168, 85, 247, ",
    glowPrefix: "rgba(168, 85, 247, ",
    beam: "#A855F7",
    stroke: "#C084FC",
    photonStroke: "rgba(216, 180, 254, ",
  },
  ir: {
    lens: "rgba(148, 163, 184, ",
    glowPrefix: "rgba(147, 51, 234, ",
    beam: "rgba(168, 85, 247, 0.6)",
    stroke: "#94A3B8",
    photonStroke: "rgba(192, 132, 252, ",
  },
};

export function drawLed(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  color: string,
): void {
  const glow = Math.max(0, Math.min(1, comp.glowLevel ?? 0));
  const colorKey = comp.ledColor?.toLowerCase() || "red";
  const theme = LED_THEMES[colorKey] ?? LED_THEMES.red;

  // 1. Resplandor radial exterior cuando está encendido (Halo fotónico difuso)
  if (glow > 0.02) {
    const radius = 24 + glow * 16;
    const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, radius);
    grad.addColorStop(0, `${theme.glowPrefix}${(glow * 0.85).toFixed(3)})`);
    grad.addColorStop(0.35, `${theme.glowPrefix}${(glow * 0.45).toFixed(3)})`);
    grad.addColorStop(0.7, `${theme.glowPrefix}${(glow * 0.15).toFixed(3)})`);
    grad.addColorStop(1, `${theme.glowPrefix}0)`);

    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 2. Triángulo del diodo ánodo -> cátodo (Lente semiconductora)
  ctx.beginPath();
  ctx.moveTo(-12, -10);
  ctx.lineTo(-12, 10);
  ctx.lineTo(8, 0);
  ctx.closePath();

  if (glow > 0.02) {
    ctx.save();
    ctx.fillStyle = `${theme.lens}${(0.35 + glow * 0.65).toFixed(3)})`;
    ctx.fill();
    ctx.strokeStyle = theme.stroke;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.fillStyle = "rgba(15, 23, 42, 0.8)";
    ctx.fill();
    ctx.stroke();
  }

  // 3. Barra del cátodo
  ctx.beginPath();
  ctx.moveTo(8, -10);
  ctx.lineTo(8, 10);
  if (glow > 0.02) {
    ctx.save();
    ctx.strokeStyle = theme.stroke;
    ctx.lineWidth = 2.0;
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.stroke();
  }

  // 4. Flechas de emisión de fotones (Radiación óptica)
  ctx.save();
  const photonColor = glow > 0.02 ? `${theme.photonStroke}${(0.6 + glow * 0.4).toFixed(3)})` : color;
  ctx.strokeStyle = photonColor;
  ctx.lineWidth = glow > 0.02 ? 1.6 : 1.2;
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
    ctx.strokeStyle = "#2DD4BF";
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
