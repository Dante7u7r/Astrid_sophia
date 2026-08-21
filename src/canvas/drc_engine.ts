import type { BoundingBox, ComponentInstance, Point2D, WireInstance } from "../canvas_orchestrator";
import { globalComponentRegistry } from "../components/registry";
import type { RoutingLayer, Via } from "./multi_net_router";

export type DRCViolationType =
  | "WIRE_CLEARANCE"
  | "COMPONENT_CLEARANCE"
  | "VIA_CLEARANCE"
  | "VIA_TO_WIRE_CLEARANCE"
  | "UNRESOLVED_CROSSING"
  | "SHORT_CIRCUIT"
  | "DEGENERATE_SEGMENT";

export interface DRCViolation {
  id: string;
  type: DRCViolationType;
  severity: "error" | "warning";
  location: Point2D;
  message: string;
  involvedElements: string[];
  layer?: RoutingLayer;
}

export interface DRCRulesConfig {
  minWireSpacing: number; // Distancia mínima entre cables de diferente red (ej. 20px)
  minComponentSpacing: number; // Distancia mínima entre cables y componentes no asociados (ej. 10px)
  minViaSpacing: number; // Distancia mínima entre vías adyacentes (ej. 20px)
  minViaToWireSpacing: number; // Distancia mínima entre una vía y un cable de otra red (ej. 15px)
  checkUnresolvedCrossings: boolean; // Marcar cruces entre redes diferentes en la misma capa
  minWireLength: number; // Longitud mínima de segmento
}

export interface DRCReport {
  clean: boolean;
  violations: DRCViolation[];
  errorCount: number;
  warningCount: number;
  rulesUsed: DRCRulesConfig;
}

export const DEFAULT_DRC_RULES: DRCRulesConfig = {
  minWireSpacing: 20,
  minComponentSpacing: 10,
  minViaSpacing: 20,
  minViaToWireSpacing: 15,
  checkUnresolvedCrossings: true,
  minWireLength: 2,
};

/**
 * Distancia euclídea mínima de un punto a un segmento [A, B]
 */
export function pointToSegmentDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const l2 = (b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y);
  if (l2 === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * (b.x - a.x);
  const projY = a.y + t * (b.y - a.y);
  return Math.hypot(p.x - projX, p.y - projY);
}

/**
 * Distancia euclídea mínima entre dos segmentos [A1, A2] y [B1, B2]
 */
export function segmentToSegmentDistance(a1: Point2D, a2: Point2D, b1: Point2D, b2: Point2D): number {
  // Comprobar intersección directa
  if (segmentsIntersect(a1, a2, b1, b2)) {
    return 0;
  }

  const d1 = pointToSegmentDistance(a1, b1, b2);
  const d2 = pointToSegmentDistance(a2, b1, b2);
  const d3 = pointToSegmentDistance(b1, a1, a2);
  const d4 = pointToSegmentDistance(b2, a1, a2);

  return Math.min(d1, d2, d3, d4);
}

/**
 * Determina si dos segmentos 2D se intersectan
 */
export function segmentsIntersect(a1: Point2D, a2: Point2D, b1: Point2D, b2: Point2D): boolean {
  function ccw(p1: Point2D, p2: Point2D, p3: Point2D): boolean {
    return (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
  }

  return (
    ccw(a1, b1, b2) !== ccw(a2, b1, b2) &&
    ccw(a1, a2, b1) !== ccw(a1, a2, b2)
  );
}

/**
 * Distancia mínima de un segmento a un BoundingBox
 */
export function segmentToBoxDistance(p1: Point2D, p2: Point2D, box: BoundingBox): number {
  const minX = box.x;
  const maxX = box.x + box.width;
  const minY = box.y;
  const maxY = box.y + box.height;

  // Si algún extremo o el segmento está dentro del box
  const c1: Point2D = { x: minX, y: minY };
  const c2: Point2D = { x: maxX, y: minY };
  const c3: Point2D = { x: maxX, y: maxY };
  const c4: Point2D = { x: minX, y: maxY };

  const edges: [Point2D, Point2D][] = [
    [c1, c2],
    [c2, c3],
    [c3, c4],
    [c4, c1],
  ];

  // Comprobar si el segmento corta alguna arista del rectángulo
  for (const [e1, e2] of edges) {
    if (segmentsIntersect(p1, p2, e1, e2)) {
      return 0;
    }
  }

  // Comprobar si un extremo está dentro
  if (
    (p1.x >= minX && p1.x <= maxX && p1.y >= minY && p1.y <= maxY) ||
    (p2.x >= minX && p2.x <= maxX && p2.y >= minY && p2.y <= maxY)
  ) {
    return 0;
  }

  let minDist = Number.POSITIVE_INFINITY;
  for (const [e1, e2] of edges) {
    minDist = Math.min(minDist, segmentToSegmentDistance(p1, p2, e1, e2));
  }

  return minDist;
}

/**
 * Ejecuta la verificación de reglas de diseño (DRC) completa en un circuito.
 */
export function runCircuitDRC(
  components: readonly ComponentInstance[],
  wires: readonly WireInstance[],
  customRules: Partial<DRCRulesConfig> = {},
): DRCReport {
  const rules: DRCRulesConfig = { ...DEFAULT_DRC_RULES, ...customRules };
  const violations: DRCViolation[] = [];

  let violationIndex = 0;
  const nextId = (prefix: string) => `drc_${prefix}_${++violationIndex}`;

  // 1. Verificación de segmentos degenerados
  for (const wire of wires) {
    const pts = wire.points ?? [];
    for (let i = 0; i < pts.length - 1; i++) {
      const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      if (len > 0 && len < rules.minWireLength) {
        violations.push({
          id: nextId("degen"),
          type: "DEGENERATE_SEGMENT",
          severity: "warning",
          location: { ...pts[i] },
          message: `Segmento de cable '${wire.id}' con longitud degenerada (${len.toFixed(1)}px < ${rules.minWireLength}px).`,
          involvedElements: [wire.id],
          layer: wire.layer ?? "top",
        });
      }
    }
  }

  // 2. Verificación de espaciado y cruces entre cables
  for (let i = 0; i < wires.length; i++) {
    const w1 = wires[i];
    const pts1 = w1.points ?? [];
    const layer1: RoutingLayer = w1.layer ?? "top";

    for (let j = i + 1; j < wires.length; j++) {
      const w2 = wires[j];
      const pts2 = w2.points ?? [];
      const layer2: RoutingLayer = w2.layer ?? "top";

      // Ignorar si pertenecen a la misma red eléctrica
      const sameNet =
        (w1.label && w2.label && w1.label === w2.label) ||
        w1.from.componentId === w2.from.componentId ||
        w1.from.componentId === w2.to.componentId ||
        w1.to.componentId === w2.from.componentId ||
        w1.to.componentId === w2.to.componentId;

      if (sameNet) continue;

      // Si están en la misma capa, verificar espaciado y cruces
      if (layer1 === layer2) {
        for (let s1 = 0; s1 < pts1.length - 1; s1++) {
          const a1 = pts1[s1];
          const a2 = pts1[s1 + 1];

          for (let s2 = 0; s2 < pts2.length - 1; s2++) {
            const b1 = pts2[s2];
            const b2 = pts2[s2 + 1];

            // Cruce directo
            if (segmentsIntersect(a1, a2, b1, b2)) {
              if (rules.checkUnresolvedCrossings) {
                violations.push({
                  id: nextId("crossing"),
                  type: "UNRESOLVED_CROSSING",
                  severity: "error",
                  location: {
                    x: Math.round((a1.x + a2.x + b1.x + b2.x) / 4),
                    y: Math.round((a1.y + a2.y + b1.y + b2.y) / 4),
                  },
                  message: `Cruce sin aislamiento entre cables '${w1.id}' y '${w2.id}' en capa ${layer1}.`,
                  involvedElements: [w1.id, w2.id],
                  layer: layer1,
                });
              }
              continue;
            }

            // Distancia mínima de clearance
            const dist = segmentToSegmentDistance(a1, a2, b1, b2);
            if (dist < rules.minWireSpacing) {
              violations.push({
                id: nextId("wire_clearance"),
                type: "WIRE_CLEARANCE",
                severity: "error",
                location: {
                  x: Math.round((a1.x + b1.x) / 2),
                  y: Math.round((a1.y + b1.y) / 2),
                },
                message: `Violación de espaciado (${dist.toFixed(1)}px < ${rules.minWireSpacing}px) entre '${w1.id}' y '${w2.id}' en capa ${layer1}.`,
                involvedElements: [w1.id, w2.id],
                layer: layer1,
              });
            }
          }
        }
      }
    }
  }

  // 3. Verificación de clearance cable a componente
  for (const wire of wires) {
    const pts = wire.points ?? [];
    const connectedComps = new Set([wire.from.componentId, wire.to.componentId]);

    for (const comp of components) {
      if (connectedComps.has(comp.id)) continue;

      const bbox = globalComponentRegistry.getBounds(comp);

      for (let s = 0; s < pts.length - 1; s++) {
        const p1 = pts[s];
        const p2 = pts[s + 1];

        const dist = segmentToBoxDistance(p1, p2, bbox);
        if (dist < rules.minComponentSpacing) {
          violations.push({
            id: nextId("comp_clearance"),
            type: "COMPONENT_CLEARANCE",
            severity: "error",
            location: {
              x: Math.round((p1.x + p2.x) / 2),
              y: Math.round((p1.y + p2.y) / 2),
            },
            message: `Cable '${wire.id}' invade el margen del componente '${comp.id}' (${dist.toFixed(1)}px < ${rules.minComponentSpacing}px).`,
            involvedElements: [wire.id, comp.id],
            layer: wire.layer ?? "top",
          });
        }
      }
    }
  }

  // 4. Verificación de Vías (Via-to-Via y Via-to-Wire)
  const allVias: { via: Via; wireId: string; netId?: string }[] = [];
  for (const wire of wires) {
    if (wire.vias) {
      for (const via of wire.vias) {
        allVias.push({ via, wireId: wire.id, netId: wire.label });
      }
    }
  }

  // 4.1. Via-to-Via clearance
  for (let i = 0; i < allVias.length; i++) {
    const v1 = allVias[i];
    for (let j = i + 1; j < allVias.length; j++) {
      const v2 = allVias[j];
      const sameNet = (v1.netId && v2.netId && v1.netId === v2.netId) || v1.wireId === v2.wireId;
      if (sameNet) continue;

      const dist = Math.hypot(v1.via.x - v2.via.x, v1.via.y - v2.via.y);
      if (dist < rules.minViaSpacing) {
        violations.push({
          id: nextId("via_clearance"),
          type: "VIA_CLEARANCE",
          severity: "error",
          location: { x: v1.via.x, y: v1.via.y },
          message: `Violación de espaciado entre vías (${dist.toFixed(1)}px < ${rules.minViaSpacing}px) de '${v1.wireId}' y '${v2.wireId}'.`,
          involvedElements: [v1.wireId, v2.wireId],
        });
      }
    }
  }

  // 4.2. Via-to-Wire clearance
  for (const { via, wireId, netId } of allVias) {
    for (const wire of wires) {
      if (wire.id === wireId) continue;
      if (netId && wire.label && netId === wire.label) continue;

      const pts = wire.points ?? [];
      const viaPt: Point2D = { x: via.x, y: via.y };

      for (let s = 0; s < pts.length - 1; s++) {
        const p1 = pts[s];
        const p2 = pts[s + 1];
        const dist = pointToSegmentDistance(viaPt, p1, p2);

        if (dist < rules.minViaToWireSpacing) {
          violations.push({
            id: nextId("via_wire_clearance"),
            type: "VIA_TO_WIRE_CLEARANCE",
            severity: "error",
            location: viaPt,
            message: `Vía de '${wireId}' demasiado próxima al cable '${wire.id}' (${dist.toFixed(1)}px < ${rules.minViaToWireSpacing}px).`,
            involvedElements: [wireId, wire.id],
          });
        }
      }
    }
  }

  const errorCount = violations.filter((v) => v.severity === "error").length;
  const warningCount = violations.filter((v) => v.severity === "warning").length;

  return {
    clean: errorCount === 0,
    violations,
    errorCount,
    warningCount,
    rulesUsed: rules,
  };
}
