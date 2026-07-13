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
}> = [
  { key: "ch1", label: "1", color: "hsl(174, 97%, 69%)" },
  { key: "ch2", label: "2", color: "hsl(270, 89%, 65%)" },
  { key: "ch3", label: "3", color: "hsl(25, 95%, 53%)" },
  { key: "ch4", label: "4", color: "hsl(142, 70%, 45%)" },
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

    ctx.fillStyle = badge.color;
    ctx.shadowColor = badge.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(point.x, point.y - 14, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "#030508";
    ctx.font = "bold 9px var(--font-sans)";
    ctx.textAlign = "center";
    ctx.fillText(badge.label, point.x, point.y - 11);
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
    ctx.font = "bold 10px var(--font-sans)";
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

  ctx.save();
  ctx.fillStyle = "rgba(102, 252, 241, 0.05)";
  ctx.strokeStyle = "rgba(102, 252, 241, 0.4)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);

  const x = Math.min(selectionStart.x, selectionEnd.x);
  const y = Math.min(selectionStart.y, selectionEnd.y);
  const w = Math.abs(selectionStart.x - selectionEnd.x);
  const h = Math.abs(selectionStart.y - selectionEnd.y);

  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 4);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
