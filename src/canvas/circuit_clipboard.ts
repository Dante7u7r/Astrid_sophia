// ==========================================================================
// CIRCUIT CLIPBOARD — Copiar, cortar y pegar componentes y conexiones en el lienzo
// ==========================================================================

import type {
  CanvasOrchestrator,
  ComponentInstance,
  Point2D,
  WireInstance,
} from "../canvas_orchestrator";
import { copyComponentConfiguration } from "./component_identity";
import { createWireId } from "./wire_identity";

export interface ClipboardComponentData {
  type: ComponentInstance["type"];
  value: ComponentInstance["value"];
  x: number;
  y: number;
  rotation: number;
  properties: Partial<ComponentInstance>;
}

export interface ClipboardWireData {
  fromComponentIndex: number;
  fromPinIndex: number;
  toComponentIndex: number;
  toPinIndex: number;
  relativePoints: Point2D[];
}

export interface SchematicClipboardPayload {
  version: 1;
  kind: "biaani_schematic_clipboard";
  anchor: Point2D;
  components: ClipboardComponentData[];
  wires: ClipboardWireData[];
}

export function getSelectedComponentsForClipboard(
  selectedComponent: ComponentInstance | null,
  selectedComponents: readonly ComponentInstance[],
): ComponentInstance[] {
  if (selectedComponents.length > 0) {
    return [...selectedComponents];
  }
  if (selectedComponent) {
    return [selectedComponent];
  }
  return [];
}

export function getInternalWiresForComponents(
  components: readonly ComponentInstance[],
  wires: readonly WireInstance[],
): WireInstance[] {
  const compIds = new Set(components.map((c) => c.id));
  return wires.filter(
    (w) => compIds.has(w.from.componentId) && compIds.has(w.to.componentId),
  );
}

export function createClipboardPayload(
  components: readonly ComponentInstance[],
  wires: readonly WireInstance[],
): SchematicClipboardPayload | null {
  if (components.length === 0) return null;

  const minX = Math.min(...components.map((c) => c.x));
  const minY = Math.min(...components.map((c) => c.y));
  const anchor: Point2D = { x: minX, y: minY };

  const compIdToIndex = new Map<string, number>();
  components.forEach((c, idx) => compIdToIndex.set(c.id, idx));

  const clipboardComponents: ClipboardComponentData[] = components.map((c) => {
    const props: Partial<ComponentInstance> = {};
    copyComponentConfiguration(c, props as ComponentInstance);
    return {
      type: c.type,
      value: c.value,
      x: c.x - anchor.x,
      y: c.y - anchor.y,
      rotation: c.rotation,
      properties: props,
    };
  });

  const internalWires = getInternalWiresForComponents(components, wires);
  const clipboardWires: ClipboardWireData[] = internalWires.map((w) => ({
    fromComponentIndex: compIdToIndex.get(w.from.componentId)!,
    fromPinIndex: w.from.pinIndex,
    toComponentIndex: compIdToIndex.get(w.to.componentId)!,
    toPinIndex: w.to.pinIndex,
    relativePoints: w.points.map((p) => ({
      x: p.x - anchor.x,
      y: p.y - anchor.y,
    })),
  }));

  return {
    version: 1,
    kind: "biaani_schematic_clipboard",
    anchor,
    components: clipboardComponents,
    wires: clipboardWires,
  };
}

export function pasteClipboardPayload(
  payload: SchematicClipboardPayload | null,
  addComponent: (
    type: ComponentInstance["type"],
    x: number,
    y: number,
    value: ComponentInstance["value"],
  ) => ComponentInstance,
  snapCoordinate: (coord: number) => number,
  targetPoint?: Point2D,
  pasteIteration = 1,
): { createdComponents: ComponentInstance[]; createdWires: WireInstance[] } | null {
  if (!payload || payload.components.length === 0) return null;

  let insertionAnchor: Point2D;
  if (targetPoint) {
    insertionAnchor = {
      x: snapCoordinate(targetPoint.x),
      y: snapCoordinate(targetPoint.y),
    };
  } else {
    const offset = 40 * pasteIteration;
    insertionAnchor = {
      x: snapCoordinate(payload.anchor.x + offset),
      y: snapCoordinate(payload.anchor.y + offset),
    };
  }

  const createdComponents: ComponentInstance[] = [];
  for (const compData of payload.components) {
    const targetX = snapCoordinate(insertionAnchor.x + compData.x);
    const targetY = snapCoordinate(insertionAnchor.y + compData.y);
    const newComp = addComponent(
      compData.type,
      targetX,
      targetY,
      compData.value,
    );
    copyComponentConfiguration(compData.properties as ComponentInstance, newComp);
    newComp.rotation = compData.rotation;
    newComp.x = targetX;
    newComp.y = targetY;
    createdComponents.push(newComp);
  }

  const createdWires: WireInstance[] = [];
  for (const wireData of payload.wires) {
    const fromComp = createdComponents[wireData.fromComponentIndex];
    const toComp = createdComponents[wireData.toComponentIndex];
    if (fromComp && toComp) {
      const points: Point2D[] = wireData.relativePoints.map((p) => ({
        x: snapCoordinate(insertionAnchor.x + p.x),
        y: snapCoordinate(insertionAnchor.y + p.y),
      }));
      const from = { componentId: fromComp.id, pinIndex: wireData.fromPinIndex };
      const to = { componentId: toComp.id, pinIndex: wireData.toPinIndex };
      const newWire: WireInstance = {
        id: createWireId(from, to),
        points,
        from,
        to,
      };
      createdWires.push(newWire);
    }
  }

  return { createdComponents, createdWires };
}

export class CircuitClipboard {
  private payload: SchematicClipboardPayload | null = null;
  private pasteIteration = 0;

  public copy(orchestrator: CanvasOrchestrator): number {
    const targets = getSelectedComponentsForClipboard(
      orchestrator.selectedComponent,
      orchestrator.selectedComponents,
    );
    if (targets.length === 0) {
      return 0;
    }

    this.payload = createClipboardPayload(targets, orchestrator.wires);
    this.pasteIteration = 0;

    if (this.payload && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        navigator.clipboard.writeText(JSON.stringify(this.payload)).catch(() => {
          /* Ignorar fallos de acceso en entornos restringidos */
        });
      } catch {
        /* Ignorar fallos de clipboard */
      }
    }

    return targets.length;
  }

  public cut(orchestrator: CanvasOrchestrator): number {
    const copiedCount = this.copy(orchestrator);
    if (copiedCount > 0) {
      orchestrator.removeSelected();
    }
    return copiedCount;
  }

  public paste(
    orchestrator: CanvasOrchestrator,
    targetPoint?: Point2D,
  ): { components: ComponentInstance[]; wires: WireInstance[] } | null {
    if (!this.payload) return null;

    this.pasteIteration += 1;
    const result = pasteClipboardPayload(
      this.payload,
      (type, x, y, value) => orchestrator.addComponent(type, x, y, value),
      (coord) => orchestrator.snapToGrid(coord),
      targetPoint,
      this.pasteIteration,
    );

    if (!result) return null;

    const { createdComponents, createdWires } = result;
    for (const wire of createdWires) {
      orchestrator.wires.push(wire);
    }

    // Deseleccionar anteriores
    if (orchestrator.selectedComponent) {
      orchestrator.selectedComponent.selected = false;
    }
    for (const c of orchestrator.selectedComponents) {
      c.selected = false;
    }

    // Seleccionar elementos nuevos pegados
    if (createdComponents.length === 1) {
      createdComponents[0].selected = true;
      orchestrator.selectedComponent = createdComponents[0];
      orchestrator.selectedComponents = [];
    } else if (createdComponents.length > 1) {
      for (const c of createdComponents) {
        c.selected = true;
      }
      orchestrator.selectedComponents = [...createdComponents];
      orchestrator.selectedComponent = null;
    }

    orchestrator.selectedWire = null;
    orchestrator.selectedWires = [];
    orchestrator.syncWireConnections();

    return { components: createdComponents, wires: createdWires };
  }

  public hasData(): boolean {
    return Boolean(this.payload && this.payload.components.length > 0);
  }

  public clear(): void {
    this.payload = null;
    this.pasteIteration = 0;
  }

  public getPayload(): SchematicClipboardPayload | null {
    return this.payload;
  }

  public setPayload(payload: SchematicClipboardPayload | null): void {
    this.payload = payload;
    this.pasteIteration = 0;
  }
}

export const globalCircuitClipboard = new CircuitClipboard();
