import type { Point2D, WireInstance } from "../canvas_orchestrator";

/**
 * Simplifies an orthogonal wire path by:
 * 1. Eliminating consecutive duplicate points.
 * 2. Merging consecutive collinear horizontal or vertical segments.
 * 3. Removing redundant zero-length zigzag turns.
 */
export function simplifyOrthogonalWirePath(points: readonly Point2D[]): Point2D[] {
  if (!points || points.length < 2) {
    return points ? points.map((p) => ({ ...p })) : [];
  }

  // 1. Remove consecutive duplicates (distance < 0.5 world units)
  const deduped: Point2D[] = [{ ...points[0] }];
  for (let i = 1; i < points.length; i++) {
    const prev = deduped[deduped.length - 1];
    const curr = points[i];
    if (Math.abs(curr.x - prev.x) > 0.5 || Math.abs(curr.y - prev.y) > 0.5) {
      deduped.push({ ...curr });
    }
  }

  if (deduped.length < 3) {
    return deduped;
  }

  // 2. Iteratively merge collinear segments
  let simplified: Point2D[] = deduped;
  let changed = true;

  while (changed && simplified.length >= 3) {
    changed = false;
    const nextList: Point2D[] = [simplified[0]];

    for (let i = 1; i < simplified.length - 1; i++) {
      const pPrev = nextList[nextList.length - 1];
      const pCurr = simplified[i];
      const pNext = simplified[i + 1];

      const isCollinearX =
        Math.abs(pPrev.x - pCurr.x) < 0.5 && Math.abs(pCurr.x - pNext.x) < 0.5;
      const isCollinearY =
        Math.abs(pPrev.y - pCurr.y) < 0.5 && Math.abs(pCurr.y - pNext.y) < 0.5;

      if (isCollinearX || isCollinearY) {
        // Drop pCurr, merging into pPrev -> pNext
        changed = true;
      } else {
        nextList.push(pCurr);
      }
    }

    nextList.push(simplified[simplified.length - 1]);
    simplified = nextList;
  }

  return simplified;
}

/**
 * Cleans up all wire paths in the schematic in-place.
 */
export function cleanAllCircuitWires(wires: WireInstance[]): void {
  for (const wire of wires) {
    if (wire.points && wire.points.length >= 2) {
      wire.points = simplifyOrthogonalWirePath(wire.points);
    }
  }
}
