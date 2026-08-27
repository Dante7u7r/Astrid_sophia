// ==========================================================================
// SPATIAL INDEX — Particionado Espacial 2D para Circuitos Masivos (VLSI)
// Viewport Culling O(1/log N) y Hit-Testing Acelerado mediante Spatial Hash Grid
// ==========================================================================

import type {
  BoundingBox,
  ComponentInstance,
  Point2D,
  WireInstance,
} from "../canvas_orchestrator";
import { getComponentBounds } from "./component_geometry";
import { boundsIntersect } from "./viewport_camera";

export interface SpatialEntry<T> {
  readonly item: T;
  readonly bounds: BoundingBox;
}

/**
 * Calcula la caja envolvente alineada a los ejes (AABB) de un cable.
 */
export function getWireBounds(wire: WireInstance, padding: number = 6): BoundingBox {
  const pts = wire.points;
  if (!pts || pts.length === 0) {
    return { x: 0, y: 0, width: padding * 2, height: padding * 2 };
  }

  let minX = pts[0].x;
  let maxX = pts[0].x;
  let minY = pts[0].y;
  let maxY = pts[0].y;

  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  return {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(padding * 2, maxX - minX + padding * 2),
    height: Math.max(padding * 2, maxY - minY + padding * 2),
  };
}

/**
 * Índice espacial 2D basado en cuadrícula hash regular.
 * Permite inserción O(1) y consultas de ventana en O(K) donde K es el número de elementos en la región.
 */
export class SpatialHashGrid<T> {
  private readonly cells = new Map<string, SpatialEntry<T>[]>();
  private readonly itemBounds = new Map<T, BoundingBox>();
  private readonly cellSize: number;

  constructor(cellSize: number = 160) {
    this.cellSize = Math.max(40, cellSize);
  }

  public clear(): void {
    this.cells.clear();
    this.itemBounds.clear();
  }

  public insert(item: T, bounds: BoundingBox): void {
    this.itemBounds.set(item, bounds);
    const entry: SpatialEntry<T> = { item, bounds };

    const minCellX = Math.floor(bounds.x / this.cellSize);
    const maxCellX = Math.floor((bounds.x + bounds.width) / this.cellSize);
    const minCellY = Math.floor(bounds.y / this.cellSize);
    const maxCellY = Math.floor((bounds.y + bounds.height) / this.cellSize);

    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        const key = `${cx}:${cy}`;
        let list = this.cells.get(key);
        if (!list) {
          list = [];
          this.cells.set(key, list);
        }
        list.push(entry);
      }
    }
  }

  /**
   * Consulta todos los elementos cuya caja envolvente intersecta la ventana `queryBounds`.
   */
  public query(queryBounds: BoundingBox): T[] {
    const minCellX = Math.floor(queryBounds.x / this.cellSize);
    const maxCellX = Math.floor((queryBounds.x + queryBounds.width) / this.cellSize);
    const minCellY = Math.floor(queryBounds.y / this.cellSize);
    const maxCellY = Math.floor((queryBounds.y + queryBounds.height) / this.cellSize);

    const visited = new Set<T>();
    const results: T[] = [];

    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        const list = this.cells.get(`${cx}:${cy}`);
        if (!list) continue;

        for (let i = 0; i < list.length; i++) {
          const entry = list[i];
          if (!visited.has(entry.item)) {
            visited.add(entry.item);
            if (boundsIntersect(entry.bounds, queryBounds)) {
              results.push(entry.item);
            }
          }
        }
      }
    }

    return results;
  }

  /**
   * Consulta candidatos dentro de un radio alrededor de un punto (para hit-testing).
   */
  public queryPoint(point: Point2D, radius: number = 10): T[] {
    const box: BoundingBox = {
      x: point.x - radius,
      y: point.y - radius,
      width: radius * 2,
      height: radius * 2,
    };
    return this.query(box);
  }
}

/**
 * Índice espacial unificado para el esquemático (componentes y cables).
 * Gestiona el ciclo de vida y la invalidación reactiva de la escena.
 */
export class SchematicSpatialIndex {
  private readonly componentGrid: SpatialHashGrid<ComponentInstance>;
  private readonly wireGrid: SpatialHashGrid<WireInstance>;

  private cachedComponentsRef: readonly ComponentInstance[] | null = null;
  private cachedWiresRef: readonly WireInstance[] | null = null;
  private revision: number = 0;
  private isBuilt: boolean = false;

  constructor(cellSize: number = 160) {
    this.componentGrid = new SpatialHashGrid<ComponentInstance>(cellSize);
    this.wireGrid = new SpatialHashGrid<WireInstance>(cellSize);
  }

  public invalidate(): void {
    this.revision++;
    this.isBuilt = false;
  }

  public getRevision(): number {
    return this.revision;
  }

  /**
   * Asegura que el índice esté sincronizado con la lista actual de componentes y cables.
   * Si las referencias no cambiaron y el índice es válido, no realiza ningún cómputo O(1).
   */
  public ensureUpdated(
    components: readonly ComponentInstance[],
    wires: readonly WireInstance[],
  ): void {
    if (this.isBuilt && this.cachedComponentsRef === components && this.cachedWiresRef === wires) {
      return;
    }

    this.rebuild(components, wires);
  }

  public rebuild(
    components: readonly ComponentInstance[],
    wires: readonly WireInstance[],
  ): void {
    this.componentGrid.clear();
    this.wireGrid.clear();

    for (let i = 0; i < components.length; i++) {
      const comp = components[i];
      const bounds = getComponentBounds(comp);
      this.componentGrid.insert(comp, bounds);
    }

    for (let i = 0; i < wires.length; i++) {
      const wire = wires[i];
      const bounds = getWireBounds(wire);
      this.wireGrid.insert(wire, bounds);
    }

    this.cachedComponentsRef = components;
    this.cachedWiresRef = wires;
    this.isBuilt = true;
  }

  public queryVisibleComponents(visibleBounds: BoundingBox): ComponentInstance[] {
    return this.componentGrid.query(visibleBounds);
  }

  public queryVisibleWires(visibleBounds: BoundingBox): WireInstance[] {
    return this.wireGrid.query(visibleBounds);
  }

  public queryComponentCandidates(point: Point2D, radius: number = 12): ComponentInstance[] {
    return this.componentGrid.queryPoint(point, radius);
  }

  public queryWireCandidates(point: Point2D, radius: number = 12): WireInstance[] {
    return this.wireGrid.queryPoint(point, radius);
  }
}
