import type { ComponentInstance, Point2D, WireInstance } from "../canvas_orchestrator";
import { getComponentBounds, hitTestComponentAt } from "./component_geometry";
import { snapToGrid } from "./viewport_camera";
import { wirePathIntersects } from "./wiring_model";

export interface SelectionState {
  selectedComponent: ComponentInstance | null;
  selectedComponents: ComponentInstance[];
  selectedWire: WireInstance | null;
  selectedWires: WireInstance[];
}

export interface ComponentSelectionResult extends SelectionState {
  hitComponent: ComponentInstance | null;
}

export type DragOffsets = Record<string, Point2D>;

export function findTopComponentAt(
  components: readonly ComponentInstance[],
  worldX: number,
  worldY: number,
  spatialIndex?: { queryComponentCandidates(point: Point2D, radius?: number): ComponentInstance[] } | null,
): ComponentInstance | null {
  const list = (spatialIndex && components.length > 30)
    ? spatialIndex.queryComponentCandidates({ x: worldX, y: worldY }, 30)
    : components;

  for (let i = list.length - 1; i >= 0; i--) {
    const comp = list[i];
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
  spatialIndex?: { queryComponentCandidates(point: Point2D, radius?: number): ComponentInstance[] } | null,
): ComponentSelectionResult {
  const hitComponent = findTopComponentAt(components, worldX, worldY, spatialIndex);

  if (!hitComponent) {
    if (isShift) return { ...state, hitComponent: null };
    const selectedWires = hoveredWire ? [hoveredWire] : [];
    return {
      hitComponent: null,
      selectedComponent: null,
      selectedComponents: [],
      selectedWire: hoveredWire,
      selectedWires,
    };
  }

  if (isShift) {
    const alreadySelected = state.selectedComponents.some((comp) => comp.id === hitComponent.id);
    const nextSelectedComponents = alreadySelected
      ? state.selectedComponents.filter((comp) => comp.id !== hitComponent.id)
      : [...state.selectedComponents, hitComponent];

    return {
      hitComponent,
      selectedComponents: nextSelectedComponents,
      selectedComponent: nextSelectedComponents.length > 0
        ? nextSelectedComponents[nextSelectedComponents.length - 1]
        : null,
      selectedWire: state.selectedWire,
      selectedWires: state.selectedWires,
    };
  }

  return {
    hitComponent,
    selectedComponent: hitComponent,
    selectedComponents: [hitComponent],
    selectedWire: null,
    selectedWires: [],
  };
}

export function completeBoxSelection(
  components: readonly ComponentInstance[],
  arg2: readonly WireInstance[] | Point2D | null,
  arg3: Point2D | null,
  arg4?: Point2D | null,
): SelectionState | null {
  let wires: readonly WireInstance[] = [];
  let selectionStart: Point2D | null = null;
  let selectionEnd: Point2D | null = null;

  if (Array.isArray(arg2)) {
    wires = arg2;
    selectionStart = arg3;
    selectionEnd = arg4 ?? null;
  } else {
    wires = [];
    selectionStart = arg2 as Point2D | null;
    selectionEnd = arg3;
  }

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
      selectedWires: [],
    };
  }

  const boxBounds = { x, y, width: w, height: h };

  const selectedComponents = components.filter((comp) => {
    const bounds = getComponentBounds(comp);
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    return cx >= x && cx <= x + w && cy >= y && cy <= y + h;
  });

  const selectedWires = wires.filter((wire) => {
    return wire.points && wire.points.length >= 2 && wirePathIntersects(wire.points, boxBounds);
  });

  return {
    selectedComponents,
    selectedComponent: selectedComponents.length > 0
      ? selectedComponents[selectedComponents.length - 1]
      : null,
    selectedWires,
    selectedWire: selectedWires.length > 0
      ? selectedWires[selectedWires.length - 1]
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
  alignmentAdjustment: Point2D = { x: 0, y: 0 },
): void {
  if (selectedComponents.length > 0) {
    for (const comp of selectedComponents) {
      const offset = dragStartOffsets[comp.id];
      if (!offset) continue;
      comp.x = snapToGrid(worldPoint.x - offset.x, gridSize) + alignmentAdjustment.x;
      comp.y = snapToGrid(worldPoint.y - offset.y, gridSize) + alignmentAdjustment.y;
    }
    return;
  }

  if (selectedComponent) {
    selectedComponent.x = snapToGrid(worldPoint.x - dragStartOffset.x, gridSize) + alignmentAdjustment.x;
    selectedComponent.y = snapToGrid(worldPoint.y - dragStartOffset.y, gridSize) + alignmentAdjustment.y;
  }
}
