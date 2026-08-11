export type PanelKey = "left" | "right" | "dock";

export interface PanelLayout {
  version?: number;
  leftWidth: number;
  rightWidth: number;
  dockHeight: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  dockCollapsed: boolean;
}

export const LAYOUT_VERSION = 4;

export const DEFAULT_LAYOUT: PanelLayout = {
  leftWidth: 200,
  rightWidth: 220,
  dockHeight: 210,
  leftCollapsed: false,
  rightCollapsed: false,
  dockCollapsed: true,
};

export const PANEL_LIMITS = {
  leftMin: 160,
  leftMax: 400,
  rightMin: 180,
  rightMax: 450,
  dockMin: 120,
  dockMaxVh: 50,
};

export function getDefaultLayoutForViewport(viewportWidth: number): PanelLayout {
  const compactViewport = viewportWidth <= 760;
  return {
    ...DEFAULT_LAYOUT,
    version: LAYOUT_VERSION,
    ...(compactViewport
      ? {
          leftWidth: 220,
          rightWidth: 260,
          leftCollapsed: true,
          rightCollapsed: true,
          dockCollapsed: true,
        }
      : {}),
  };
}

export function getDockMaxPx(viewportHeight: number): number {
  return Math.max(PANEL_LIMITS.dockMin, Math.floor(viewportHeight * (PANEL_LIMITS.dockMaxVh / 100)));
}

export function clampPanelDimension(
  panel: PanelKey,
  value: number,
  viewportHeight: number,
): number {
  if (panel === "left") {
    return Math.max(PANEL_LIMITS.leftMin, Math.min(PANEL_LIMITS.leftMax, value));
  }
  if (panel === "right") {
    return Math.max(PANEL_LIMITS.rightMin, Math.min(PANEL_LIMITS.rightMax, value));
  }
  return Math.max(PANEL_LIMITS.dockMin, Math.min(getDockMaxPx(viewportHeight), value));
}

export function resizePanelByDrag(
  panel: PanelKey,
  dragStartSize: number,
  dragStartPos: number,
  currentClientPos: number,
  viewportHeight: number,
): number {
  const delta = panel === "left"
    ? currentClientPos - dragStartPos
    : dragStartPos - currentClientPos;
  return clampPanelDimension(panel, dragStartSize + delta, viewportHeight);
}

export function getKeyboardResizeDirection(panel: PanelKey, key: string): number {
  if (panel === "dock") {
    return key === "ArrowUp" ? 1 : key === "ArrowDown" ? -1 : 0;
  }
  return key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
}

export function resizePanelByKeyboard(
  panel: PanelKey,
  currentSize: number,
  direction: number,
  step: number,
  viewportHeight: number,
): number {
  const signedStep = panel === "right" ? -direction * step : direction * step;
  return clampPanelDimension(panel, currentSize + signedStep, viewportHeight);
}

export function sanitizeStoredLayout(
  parsed: Partial<PanelLayout>,
  viewportHeight: number,
): PanelLayout | null {
  if (parsed.version !== LAYOUT_VERSION) return null;

  const layout = { ...DEFAULT_LAYOUT, ...parsed };
  layout.leftWidth = clampPanelDimension("left", layout.leftWidth, viewportHeight);
  layout.rightWidth = clampPanelDimension("right", layout.rightWidth, viewportHeight);
  layout.dockHeight = clampPanelDimension("dock", layout.dockHeight, viewportHeight || DEFAULT_LAYOUT.dockHeight);
  return layout;
}
