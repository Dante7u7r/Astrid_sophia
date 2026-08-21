import type { PinInstance, Point2D } from "../canvas_orchestrator";

export type ProbeBadges = {
  ch1?: Point2D;
  ch2?: Point2D;
  ch3?: Point2D;
  ch4?: Point2D;
};

export interface SParameterMarker {
  index: number;
  x: number;
  y: number;
}

const probeBadgeStyles: Array<{
  key: keyof ProbeBadges;
  label: string;
  color: string;
  bgFill: string;
}> = [
  { key: "ch1", label: "CH1", color: "#66fcf1", bgFill: "rgba(10, 30, 35, 0.92)" },
  { key: "ch2", label: "CH2", color: "#a855f7", bgFill: "rgba(28, 12, 40, 0.92)" },
  { key: "ch3", label: "CH3", color: "#f97316", bgFill: "rgba(35, 18, 10, 0.92)" },
  { key: "ch4", label: "CH4", color: "#22c55e", bgFill: "rgba(10, 32, 18, 0.92)" },
];

export function drawTemporaryWire(
  ctx: CanvasRenderingContext2D,
  activePinForWire: PinInstance | null,
  tempWireEnd: Point2D | null,
  generatePath: (start: Point2D, end: Point2D) => Point2D[],
): void {
  if (!activePinForWire || !tempWireEnd) return;

  ctx.strokeStyle = "rgba(102, 252, 241, 0.6)";
  ctx.lineWidth = 2.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();

  const previewPath = generatePath(activePinForWire, tempWireEnd);
  ctx.moveTo(previewPath[0].x, previewPath[0].y);
  for (let i = 1; i < previewPath.length; i++) {
    ctx.lineTo(previewPath[i].x, previewPath[i].y);
  }

  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawProbeBadges(
  ctx: CanvasRenderingContext2D,
  probes: ProbeBadges,
): void {
  for (const badge of probeBadgeStyles) {
    const point = probes[badge.key];
    if (!point) continue;

    ctx.save();

    // 1. Aguja hacia el pin
    ctx.strokeStyle = badge.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x, point.y - 8);
    ctx.stroke();

    // Punto de contacto
    ctx.fillStyle = badge.color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 2. Insignia flotante redondeada
    const badgeW = 28;
    const badgeH = 15;
    const badgeX = point.x - badgeW / 2;
    const badgeY = point.y - 23;

    ctx.shadowColor = badge.color;
    ctx.shadowBlur = 6;
    ctx.fillStyle = badge.bgFill;
    ctx.strokeStyle = badge.color;
    ctx.lineWidth = 1.2;

    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 3);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 3. Texto del canal
    ctx.fillStyle = badge.color;
    ctx.font = "bold 8.5px 'JetBrains Mono', 'Inter', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(badge.label, point.x, badgeY + badgeH / 2 + 0.5);

    ctx.restore();
  }
}

export function drawSParameterMarkers(
  ctx: CanvasRenderingContext2D,
  markers: readonly SParameterMarker[] | undefined,
): void {
  if (!markers) return;

  for (const marker of markers) {
    const hue = 140 + marker.index * 30;
    ctx.fillStyle = `hsla(${hue}, 90%, 60%, 0.85)`;
    ctx.shadowColor = `hsla(${hue}, 90%, 60%, 0.6)`;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(marker.x, marker.y - 14, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#030508";
    ctx.font = "bold 10px 'Inter', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`P${marker.index}`, marker.x, marker.y - 11);
  }
}

export function drawSelectionBox(
  ctx: CanvasRenderingContext2D,
  selectionStart: Point2D | null,
  selectionEnd: Point2D | null,
): void {
  if (!selectionStart || !selectionEnd) return;

  const x = Math.min(selectionStart.x, selectionEnd.x);
  const y = Math.min(selectionStart.y, selectionEnd.y);
  const w = Math.abs(selectionStart.x - selectionEnd.x);
  const h = Math.abs(selectionStart.y - selectionEnd.y);

  if (w < 1 && h < 1) return;

  ctx.save();
  ctx.fillStyle = "rgba(56, 189, 248, 0.15)";
  ctx.strokeStyle = "rgba(56, 189, 248, 0.85)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);

  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, 3);
  } else {
    ctx.rect(x, y, w, h);
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function drawAlignmentGuides(
  ctx: CanvasRenderingContext2D,
  guides: readonly import("./alignment_guidelines").AlignmentGuide[],
): void {
  if (!guides || guides.length === 0) return;

  ctx.save();
  ctx.strokeStyle = "rgba(56, 189, 248, 0.85)";
  ctx.fillStyle = "#38bdf8";
  ctx.lineWidth = 1.0;
  ctx.setLineDash([4, 4]);

  for (const guide of guides) {
    ctx.beginPath();
    if (guide.axis === "x") {
      ctx.moveTo(guide.coord, guide.start);
      ctx.lineTo(guide.coord, guide.end);
    } else {
      ctx.moveTo(guide.start, guide.coord);
      ctx.lineTo(guide.end, guide.coord);
    }
    ctx.stroke();

    // Marcadores discretos en los puntos ancla alineados
    ctx.beginPath();
    ctx.arc(guide.sourcePoint.x, guide.sourcePoint.y, 2.5, 0, Math.PI * 2);
    ctx.arc(guide.targetPoint.x, guide.targetPoint.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

