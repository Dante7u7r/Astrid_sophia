import type { ComponentInstance, PinInstance, Point2D } from "../canvas_orchestrator";

export type AlignmentAxis = "x" | "y";
export type AlignmentKind = "center" | "pin";

export interface AlignmentGuide {
  axis: AlignmentAxis;
  coord: number;
  start: number;
  end: number;
  sourceCompId: string;
  targetCompId: string;
  kind: AlignmentKind;
  sourcePoint: Point2D;
  targetPoint: Point2D;
}

export interface AlignmentCalculationOptions {
  threshold?: number;
  resolvePins?: (comp: ComponentInstance) => PinInstance[];
}

export interface AlignmentResult {
  adjustedOffset: Point2D;
  guides: AlignmentGuide[];
}

/**
 * Computes magnetic snapping adjustments and visual alignment guidelines
 * when one or more components are being dragged across the schematic.
 */
export function computeSmartAlignment(
  draggingComponents: readonly ComponentInstance[],
  allComponents: readonly ComponentInstance[],
  tentativeCenter: Point2D,
  options: AlignmentCalculationOptions = {},
): AlignmentResult {
  const threshold = options.threshold ?? 8;
  const resolvePins = options.resolvePins;

  if (draggingComponents.length === 0) {
    return { adjustedOffset: { x: 0, y: 0 }, guides: [] };
  }

  const draggingIds = new Set(draggingComponents.map((c) => c.id));
  const staticComponents = allComponents.filter((c) => !draggingIds.has(c.id));

  if (staticComponents.length === 0) {
    return { adjustedOffset: { x: 0, y: 0 }, guides: [] };
  }

  const primary = draggingComponents[0];

  let bestDeltaX: number | null = null;
  let bestDeltaY: number | null = null;
  let bestGuideX: AlignmentGuide | null = null;
  let bestGuideY: AlignmentGuide | null = null;

  const primaryPins = resolvePins ? resolvePins(primary) : [];
  const primaryPinOffsets = primaryPins.map((p) => ({
    pinIndex: p.pinIndex,
    dx: p.x - primary.x,
    dy: p.y - primary.y,
  }));

  for (const staticComp of staticComponents) {
    // 1. Center X Alignment (Vertical Guide Line)
    const diffCenterX = staticComp.x - tentativeCenter.x;
    if (Math.abs(diffCenterX) <= threshold) {
      if (bestDeltaX === null || Math.abs(diffCenterX) < Math.abs(bestDeltaX)) {
        bestDeltaX = diffCenterX;
        const startY = Math.min(tentativeCenter.y, staticComp.y) - 24;
        const endY = Math.max(tentativeCenter.y, staticComp.y) + 24;
        bestGuideX = {
          axis: "x",
          coord: staticComp.x,
          start: startY,
          end: endY,
          sourceCompId: primary.id,
          targetCompId: staticComp.id,
          kind: "center",
          sourcePoint: { x: staticComp.x, y: tentativeCenter.y },
          targetPoint: { x: staticComp.x, y: staticComp.y },
        };
      }
    }

    // 2. Center Y Alignment (Horizontal Guide Line)
    const diffCenterY = staticComp.y - tentativeCenter.y;
    if (Math.abs(diffCenterY) <= threshold) {
      if (bestDeltaY === null || Math.abs(diffCenterY) < Math.abs(bestDeltaY)) {
        bestDeltaY = diffCenterY;
        const startX = Math.min(tentativeCenter.x, staticComp.x) - 24;
        const endX = Math.max(tentativeCenter.x, staticComp.x) + 24;
        bestGuideY = {
          axis: "y",
          coord: staticComp.y,
          start: startX,
          end: endX,
          sourceCompId: primary.id,
          targetCompId: staticComp.id,
          kind: "center",
          sourcePoint: { x: tentativeCenter.x, y: staticComp.y },
          targetPoint: { x: staticComp.x, y: staticComp.y },
        };
      }
    }

    // 3. Pin-to-Pin Alignment
    if (resolvePins) {
      const staticPins = resolvePins(staticComp);
      for (const pPin of primaryPinOffsets) {
        const tentativePinX = tentativeCenter.x + pPin.dx;
        const tentativePinY = tentativeCenter.y + pPin.dy;

        for (const sPin of staticPins) {
          // Pin X alignment
          const diffPinX = sPin.x - tentativePinX;
          if (Math.abs(diffPinX) <= threshold) {
            if (bestDeltaX === null || Math.abs(diffPinX) < Math.abs(bestDeltaX)) {
              bestDeltaX = diffPinX;
              const startY = Math.min(tentativePinY, sPin.y) - 20;
              const endY = Math.max(tentativePinY, sPin.y) + 20;
              bestGuideX = {
                axis: "x",
                coord: sPin.x,
                start: startY,
                end: endY,
                sourceCompId: primary.id,
                targetCompId: staticComp.id,
                kind: "pin",
                sourcePoint: { x: sPin.x, y: tentativePinY },
                targetPoint: { x: sPin.x, y: sPin.y },
              };
            }
          }

          // Pin Y alignment
          const diffPinY = sPin.y - tentativePinY;
          if (Math.abs(diffPinY) <= threshold) {
            if (bestDeltaY === null || Math.abs(diffPinY) < Math.abs(bestDeltaY)) {
              bestDeltaY = diffPinY;
              const startX = Math.min(tentativePinX, sPin.x) - 20;
              const endX = Math.max(tentativePinX, sPin.x) + 20;
              bestGuideY = {
                axis: "y",
                coord: sPin.y,
                start: startX,
                end: endX,
                sourceCompId: primary.id,
                targetCompId: staticComp.id,
                kind: "pin",
                sourcePoint: { x: tentativePinX, y: sPin.y },
                targetPoint: { x: sPin.x, y: sPin.y },
              };
            }
          }
        }
      }
    }
  }

  const guides: AlignmentGuide[] = [];
  if (bestGuideX) guides.push(bestGuideX);
  if (bestGuideY) guides.push(bestGuideY);

  return {
    adjustedOffset: {
      x: bestDeltaX ?? 0,
      y: bestDeltaY ?? 0,
    },
    guides,
  };
}
