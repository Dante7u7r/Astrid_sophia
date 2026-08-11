/**
 * wire-router.ts
 *
 * Ruteo ortogonal (manhattan) de wires entre dos puntos de grid.
 * Ver references/canvas-wiring.md — sección "Wire routing: ortogonal vs. libre"
 * para la justificación de por qué esto es el default esperado por usuarios
 * que vienen de LTspice/KiCad.
 *
 * Este módulo es puramente geométrico — no toca NetGraph. El flujo típico:
 *   1. Usuario arrastra desde un pin -> generas preview con routeOrthogonal()
 *      en cada frame de movimiento del mouse.
 *   2. Usuario suelta sobre un pin válido -> creas un Wire real con los
 *      points resultantes y lo pasas a NetGraph.addWire().
 */

import type { GridPoint } from "./net-graph";

export type RouteStyle = "auto" | "horizontal-first" | "vertical-first";

/**
 * Genera una polilínea ortogonal entre dos puntos usando exactamente un
 * "codo" (L-shape) — el caso más común y el más predecible visualmente.
 * Para routing más sofisticado que evite obstáculos, ver routeAvoiding().
 */
export function routeOrthogonal(
  from: GridPoint,
  to: GridPoint,
  style: RouteStyle = "auto"
): GridPoint[] {
  if (from.x === to.x || from.y === to.y) {
    // Ya están alineados — línea recta, sin codo.
    return [from, to];
  }

  const horizontalFirst =
    style === "horizontal-first" ||
    (style === "auto" && shouldGoHorizontalFirst(from, to));

  const corner: GridPoint = horizontalFirst
    ? { x: to.x, y: from.y }
    : { x: from.x, y: to.y };

  return [from, corner, to];
}

/**
 * Heurística para decidir la orientación del codo cuando el caller no
 * especifica una. LTspice/KiCad tienden a preferir el eje con mayor
 * delta primero, lo cual suele producir rutas que se "leen" mejor.
 * Esto es una heurística, no una regla dura — está bien que el usuario
 * pueda forzar la orientación (ver toggleRouteStyle en el componente UI).
 */
function shouldGoHorizontalFirst(from: GridPoint, to: GridPoint): boolean {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  return dx >= dy;
}

export interface Obstacle {
  // Bounding box en coordenadas de grid, inclusive.
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Variante que intenta evitar solapar bounding boxes de componentes.
 * Estrategia: prueba ambas orientaciones de codo simple; si ambas
 * intersectan algún obstáculo, cae a un routing de 2 codos (Z-shape)
 * desplazado. Esto cubre el 90% de los casos prácticos sin necesitar
 * A* completo sobre el grid — para circuitos extremadamente densos
 * donde esto no baste, esa es la siguiente escalera de sofisticación,
 * pero no la implementes preventivamente sin evidencia de que la
 * necesitas (YAGNI aplica aquí tanto como en cualquier otro código).
 */
export function routeAvoiding(
  from: GridPoint,
  to: GridPoint,
  obstacles: Obstacle[]
): GridPoint[] {
  const candidates: GridPoint[][] = [
    routeOrthogonal(from, to, "horizontal-first"),
    routeOrthogonal(from, to, "vertical-first"),
  ];

  for (const route of candidates) {
    if (!routeIntersectsAny(route, obstacles)) return route;
  }

  // Ninguna ruta simple funciona — desplazamos con un Z-shape de 2 codos.
  return routeWithOffset(from, to, obstacles);
}

function routeIntersectsAny(route: GridPoint[], obstacles: Obstacle[]): boolean {
  for (let i = 0; i < route.length - 1; i++) {
    const segStart = route[i];
    const segEnd = route[i + 1];
    for (const obs of obstacles) {
      if (segmentIntersectsBox(segStart, segEnd, obs)) return true;
    }
  }
  return false;
}

function segmentIntersectsBox(a: GridPoint, b: GridPoint, box: Obstacle): boolean {
  // Los segmentos del router siempre son axis-aligned, así que basta
  // chequear solapamiento de rangos en cada eje.
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return !(maxX < box.minX || minX > box.maxX || maxY < box.minY || minY > box.maxY);
}

function routeWithOffset(
  from: GridPoint,
  to: GridPoint,
  obstacles: Obstacle[]
): GridPoint[] {
  // Desplaza el punto medio progresivamente hasta encontrar un hueco libre.
  // No es óptimo, pero es predecible y suficientemente bueno para uso
  // interactivo — el usuario siempre puede re-rutear manualmente arrastrando
  // el wire si el resultado automático no le gusta.
  const maxOffset = 10;
  for (let offset = 1; offset <= maxOffset; offset++) {
    const midY = from.y + offset;
    const route: GridPoint[] = [
      from,
      { x: from.x, y: midY },
      { x: to.x, y: midY },
      to,
    ];
    if (!routeIntersectsAny(route, obstacles)) return route;
  }
  // Fallback: ruta simple aunque cruce un obstáculo — mejor mostrar algo
  // que fallar silenciosamente; el usuario verá el cruce y lo corregirá.
  return routeOrthogonal(from, to);
}
