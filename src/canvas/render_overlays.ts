import type { ComponentInstance, PinInstance, Point2D } from "../canvas_orchestrator";
import { getSchematicThemeColors } from "./schematic_theme";

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

export function drawTemporaryWire(
  ctx: CanvasRenderingContext2D,
  activePinForWire: PinInstance | null,
  tempWireEnd: Point2D | null,
  generatePath: (start: Point2D, end: Point2D) => Point2D[],
  isClassroom?: boolean,
): void {
  if (!activePinForWire || !tempWireEnd) return;

  const theme = getSchematicThemeColors(isClassroom);

  ctx.save();
  ctx.strokeStyle = theme.overlays.tempWireStroke;
  ctx.lineWidth = 2.0;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();

  const previewPath = generatePath(activePinForWire, tempWireEnd);
  ctx.moveTo(previewPath[0].x, previewPath[0].y);
  for (let i = 1; i < previewPath.length; i++) {
    ctx.lineTo(previewPath[i].x, previewPath[i].y);
  }

  ctx.stroke();
  ctx.setLineDash([]);

  // Indicador de punto de enganche temporal en el extremo
  ctx.fillStyle = theme.overlays.tempWireNode;
  ctx.strokeStyle = theme.isClassroom ? "#FFFFFF" : "#0F172A";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(tempWireEnd.x, tempWireEnd.y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

export function drawProbeBadges(
  ctx: CanvasRenderingContext2D,
  probes: ProbeBadges,
  isClassroom?: boolean,
  probeVoltages?: { ch1?: number; ch2?: number; ch3?: number; ch4?: number },
): void {
  const theme = getSchematicThemeColors(isClassroom);
  const badgeStyles = [
    { key: "ch1" as const, label: "CH1", ...theme.probes.ch1 },
    { key: "ch2" as const, label: "CH2", ...theme.probes.ch2 },
    { key: "ch3" as const, label: "CH3", ...theme.probes.ch3 },
    { key: "ch4" as const, label: "CH4", ...theme.probes.ch4 },
  ];

  for (const badge of badgeStyles) {
    const point = probes[badge.key];
    if (!point) continue;

    ctx.save();

    // 1. Aguja hacia el pin
    ctx.strokeStyle = badge.stroke;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x, point.y - 8);
    ctx.stroke();

    // Punto de contacto
    ctx.fillStyle = badge.stroke;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 2. Texto y medición en vivo
    const volt = probeVoltages?.[badge.key];
    let displayText = badge.label;
    if (volt !== undefined && Number.isFinite(volt)) {
      const absV = Math.abs(volt);
      const sign = volt < 0 ? "-" : "";
      const vStr = absV >= 1e3
        ? `${sign}${(absV / 1e3).toFixed(1)}kV`
        : (absV < 0.1 && absV > 1e-4 ? `${sign}${(absV * 1e3).toFixed(0)}mV` : `${sign}${absV.toFixed(2)}V`);
      displayText = `${badge.label} • ${vStr}`;
    }

    ctx.font = "bold 8.5px 'JetBrains Mono', 'Inter', monospace";
    const textWidth = ctx.measureText(displayText).width;
    const badgeW = Math.max(28, textWidth + 8);
    const badgeH = 15;
    const badgeX = point.x - badgeW / 2;
    const badgeY = point.y - 23;

    // 3. Insignia flotante redondeada con elevación
    ctx.fillStyle = badge.bgFill;
    ctx.strokeStyle = badge.stroke;
    ctx.lineWidth = 1.2;

    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 3);
    } else {
      ctx.rect(badgeX, badgeY, badgeW, badgeH);
    }
    ctx.fill();
    ctx.stroke();

    // 4. Texto del canal
    ctx.fillStyle = badge.text;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(displayText, point.x, badgeY + badgeH / 2 + 0.5);

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
    ctx.strokeStyle = `hsla(${hue}, 90%, 60%, 1.0)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(marker.x, marker.y - 14, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
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
  isClassroom?: boolean,
): void {
  if (!selectionStart || !selectionEnd) return;

  const x = Math.min(selectionStart.x, selectionEnd.x);
  const y = Math.min(selectionStart.y, selectionEnd.y);
  const w = Math.abs(selectionStart.x - selectionEnd.x);
  const h = Math.abs(selectionStart.y - selectionEnd.y);

  if (w < 1 && h < 1) return;

  const theme = getSchematicThemeColors(isClassroom);

  ctx.save();
  ctx.fillStyle = theme.overlays.selectionBoxFill;
  ctx.strokeStyle = theme.overlays.selectionBoxStroke;
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
  isClassroom?: boolean,
): void {
  if (!guides || guides.length === 0) return;

  const theme = getSchematicThemeColors(isClassroom);

  ctx.save();
  ctx.strokeStyle = theme.overlays.alignmentGuideStroke;
  ctx.fillStyle = theme.overlays.alignmentGuideNode;
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

export interface ErcIssueOverlayItem {
  componentId: string;
  type: "error" | "warning";
  message: string;
  pinIndex?: number;
  location?: Point2D;
}

export function drawErcAndDrcOverlays(
  ctx: CanvasRenderingContext2D,
  issues: readonly ErcIssueOverlayItem[],
  components: readonly ComponentInstance[],
  getPins: (comp: ComponentInstance) => readonly PinInstance[],
  now: number,
  hoveredPin?: PinInstance | null,
  hoveredComp?: ComponentInstance | null,
  isClassroom?: boolean,
): void {
  if (!issues || issues.length === 0) return;

  const theme = getSchematicThemeColors(isClassroom);
  const compMap = new Map<string, ComponentInstance>(components.map((c) => [c.id, c]));
  const pulseScale = 1 + Math.sin(now / 160) * 0.15;
  const pulseRadius = 10 + Math.sin(now / 160) * 3;

  for (const issue of issues) {
    const isError = issue.type === "error";
    const strokeColor = isError ? theme.erc.errorStroke : theme.erc.warningStroke;
    const fillColor = isError ? theme.erc.errorFill : theme.erc.warningFill;

    let anchorX = 0;
    let anchorY = 0;
    let isPinIssue = false;

    if (issue.location) {
      anchorX = issue.location.x;
      anchorY = issue.location.y;
    } else if (issue.componentId) {
      const comp = compMap.get(issue.componentId);
      if (!comp) continue;

      if (issue.pinIndex !== undefined) {
        const pins = getPins(comp);
        const pin = pins.find((p) => p.pinIndex === issue.pinIndex);
        if (!pin) continue;
        anchorX = pin.x;
        anchorY = pin.y;
        isPinIssue = true;
      } else {
        anchorX = comp.x;
        anchorY = comp.y;
      }
    }

    ctx.save();

    // 1. Halo circular pulsante
    ctx.strokeStyle = strokeColor;
    ctx.fillStyle = fillColor;
    ctx.lineWidth = isPinIssue ? 1.8 : 2.2;

    const r = isPinIssue ? pulseRadius : 24 * pulseScale;

    ctx.beginPath();
    ctx.arc(anchorX, anchorY, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 2. Icono central de advertencia o error
    if (isPinIssue) {
      ctx.fillStyle = strokeColor;
      ctx.beginPath();
      ctx.arc(anchorX, anchorY, 3.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Badge circular para componentes con icono
      const badgeX = anchorX + 16;
      const badgeY = anchorY - 16;
      ctx.fillStyle = isError ? "#EF4444" : "#F59E0B";
      ctx.strokeStyle = "#0F172A";
      ctx.lineWidth = 1.5;

      ctx.beginPath();
      ctx.arc(badgeX, badgeY, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 10px 'Inter', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(isError ? "!" : "▲", badgeX, badgeY + (isError ? 0.5 : -0.5));
    }

    // 3. Tooltip badge interactivo en hover
    const isHovered =
      (isPinIssue && hoveredPin && hoveredPin.x === anchorX && hoveredPin.y === anchorY) ||
      (!isPinIssue && hoveredComp && hoveredComp.id === issue.componentId);

    if (isHovered && issue.message) {
      const tipText = issue.message;
      ctx.font = "10px 'Inter', sans-serif";
      const textWidth = ctx.measureText(tipText).width;
      const boxW = textWidth + 16;
      const boxH = 22;
      const boxX = anchorX - boxW / 2;
      const boxY = anchorY - (isPinIssue ? 32 : 44);

      ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.2;

      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(boxX, boxY, boxW, boxH, 4);
      } else {
        ctx.rect(boxX, boxY, boxW, boxH);
      }
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = strokeColor;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(tipText, anchorX, boxY + boxH / 2);
    }

    ctx.restore();
  }
}


