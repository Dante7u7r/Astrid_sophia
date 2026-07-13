import type { ComponentInstance, Point2D, WireInstance } from "../canvas_orchestrator";
import { getComponentBounds, hitTestComponentAt } from "./component_geometry";
import { snapToGrid } from "./viewport_camera";

export interface SelectionState {
  selectedComponent: ComponentInstance | null;
  selectedComponents: ComponentInstance[];
  selectedWire: WireInstance | null;
}

export interface ComponentSelectionResult extends SelectionState {
  hitComponent: ComponentInstance | null;
}

export type DragOffsets = Record<string, Point2D>;

export function findTopComponentAt(
  components: readonly ComponentInstance[],
  worldX: number,
  worldY: number,
): ComponentInstance | null {
  for (let i = components.length - 1; i >= 0; i--) {
    const comp = components[i];
    if (hitTestComponentAt(comp, worldX, worldY)) {
      return comp;
    }
  }
  return null;
}

export function selectComponentAt(
  components: readonly ComponentInstance[],
  state: SelectionState,
  hoveredWire: WireInstance | null,
  worldX: number,
  worldY: number,
  isShift = false,
): ComponentSelectionResult {
  const hitComponent = findTopComponentAt(components, worldX, worldY);

  if (!hitComponent) {
    if (isShift) return { ...state, hitComponent: null };
    return {
      hitComponent: null,
      selectedComponent: null,
      selectedComponents: [],
      selectedWire: hoveredWire,
    };
  }

  if (isShift) {
    const selectedComponents = [...state.selectedComponents];
    const idx = selectedComponents.findIndex((component) => component.id === hitComponent.id);
    if (idx >= 0) {
      selectedComponents.splice(idx, 1);
    } else {
      selectedComponents.push(hitComponent);
    }
    return {
      hitComponent,
      selectedWire: null,
      selectedComponents,
      selectedComponent: selectedComponents.length > 0
        ? selectedComponents[selectedComponents.length - 1]
        : null,
    };
  }

  const selectedComponents = state.selectedComponents.some((component) => component.id === hitComponent.id)
    ? state.selectedComponents
    : [hitComponent];

  return {
    hitComponent,
    selectedWire: null,
    selectedComponents,
    selectedComponent: hitComponent,
  };
}

export function completeBoxSelection(
  components: readonly ComponentInstance[],
  selectionStart: Point2D | null,
  selectionEnd: Point2D | null,
): SelectionState | null {
  if (!selectionStart || !selectionEnd) return null;

  const x = Math.min(selectionStart.x, selectionEnd.x);
  const y = Math.min(selectionStart.y, selectionEnd.y);
  const w = Math.abs(selectionStart.x - selectionEnd.x);
  const h = Math.abs(selectionStart.y - selectionEnd.y);

  if (w < 6 && h < 6) {
    return {
      selectedComponents: [],
      selectedComponent: null,
      selectedWire: null,
    };
  }

  const selectedComponents = components.filter((comp) => {
    const bounds = getComponentBounds(comp);
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    return cx >= x && cx <= x + w && cy >= y && cy <= y + h;
  });

  return {
    selectedWire: null,
    selectedComponents,
    selectedComponent: selectedComponents.length > 0
      ? selectedComponents[selectedComponents.length - 1]
      : null,
  };
}

export function createDragOffsets(
  selectedComponents: readonly ComponentInstance[],
  selectedComponent: ComponentInstance | null,
  worldPoint: Point2D,
): { dragStartOffsets: DragOffsets; dragStartOffset: Point2D } {
  const dragStartOffsets: DragOffsets = {};
  let dragStartOffset: Point2D = { x: 0, y: 0 };

  if (selectedComponents.length > 0) {
    for (const comp of selectedComponents) {
      dragStartOffsets[comp.id] = {
        x: worldPoint.x - comp.x,
        y: worldPoint.y - comp.y,
      };
    }
  } else if (selectedComponent) {
    dragStartOffset = {
      x: worldPoint.x - selectedComponent.x,
      y: worldPoint.y - selectedComponent.y,
    };
  }

  return { dragStartOffsets, dragStartOffset };
}

export function applyDrag(
  selectedComponents: readonly ComponentInstance[],
  selectedComponent: ComponentInstance | null,
  dragStartOffsets: Readonly<DragOffsets>,
  dragStartOffset: Point2D,
  worldPoint: Point2D,
  gridSize: number,
): void {
  if (selectedComponents.length > 0) {
    for (const comp of selectedComponents) {
      const offset = dragStartOffsets[comp.id];
      if (!offset) continue;
      comp.x = snapToGrid(worldPoint.x - offset.x, gridSize);
      comp.y = snapToGrid(worldPoint.y - offset.y, gridSize);
    }
    return;
  }

  if (selectedComponent) {
    selectedComponent.x = snapToGrid(worldPoint.x - dragStartOffset.x, gridSize);
    selectedComponent.y = snapToGrid(worldPoint.y - dragStartOffset.y, gridSize);
  }
}
