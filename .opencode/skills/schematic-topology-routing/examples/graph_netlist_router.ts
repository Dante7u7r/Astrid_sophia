/**
 * graph_netlist_router.ts
 * Referencia: Enrutamiento Manhattan + DSU para Astryd Sophia
 *
 * Responsabilidades:
 *   - Mantener el grafo lógico del circuito (pines, cables, nets)
 *   - Calcular rutas ortogonales entre pines (Manhattan Routing)
 *   - Extraer Netlist JSON mediante DSU para el bridge IPC de Tauri
 */

// ─────────────────────────────────────────────
// Tipos Base
// ─────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

export interface Segment {
  from: Point;
  to:   Point;
}

export interface ComponentBBox {
  id:  string;
  x:   number;   // esquina superior-izquierda (ya en rejilla)
  y:   number;
  w:   number;
  h:   number;
}

export interface ElectricalPin {
  id:          string;   // "R1:A", "V1:POS"
  componentId: string;
  pinIndex:    number;
  canvasPos:   Point;
  type:        "PASSIVE" | "OUTPUT" | "INPUT" | "POWER" | "NC";
}

export interface ElectricalWire {
  id:       string;
  segments: Segment[];
  pinIds:   string[];   // Pines que este cable toca (≥2)
}

export interface NetlistPin {
  id:    string;
  netId: string;
}

export interface NetlistComponent {
  id:    string;
  type:  string;
  value: number;
  pins:  string[];  // netIds en orden de los pines del componente
}

export interface NetlistNet {
  id:     string;
  label:  string | null;
  pinIds: string[];
}

export interface Netlist {
  nets:       NetlistNet[];
  components: NetlistComponent[];
}

export interface ERCViolation {
  code:    "FLOATING_PIN" | "SHORT_CIRCUIT" | "NO_GND" | "ISLAND";
  message: string;
  pinIds?: string[];
  netId?:  string;
}

export interface ERCResult {
  valid:    boolean;
  errors:   ERCViolation[];
  warnings: ERCViolation[];
}

// ─────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────

const GRID   = 20;
const MARGIN = GRID / 2;   // margen de seguridad alrededor de componentes

// ─────────────────────────────────────────────
// DSU (Disjoint Set Union) — Path Compression + Union by Rank
// ─────────────────────────────────────────────

class DSU {
  private parent = new Map<string, string>();
  private rank   = new Map<string, number>();

  add(id: string): void {
    if (!this.parent.has(id)) {
      this.parent.set(id, id);
      this.rank.set(id, 0);
    }
  }

  find(id: string): string {
    if (this.parent.get(id) !== id) {
      this.parent.set(id, this.find(this.parent.get(id)!));
    }
    return this.parent.get(id)!;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;

    const rankA = this.rank.get(ra)!;
    const rankB = this.rank.get(rb)!;

    if (rankA < rankB) {
      this.parent.set(ra, rb);
    } else if (rankA > rankB) {
      this.parent.set(rb, ra);
    } else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }

  /** Promueve `newRoot` como raíz del grupo que contiene `member` */
  forceRoot(member: string, newRoot: string): void {
    const currentRoot = this.find(member);
    if (currentRoot === newRoot) return;
    // Redirigir: el antiguo root apunta al nuevo
    this.parent.set(currentRoot, newRoot);
    this.parent.set(newRoot, newRoot);
    this.rank.set(newRoot, (this.rank.get(newRoot) ?? 0) + 1);
  }

  /** Devuelve todos los grupos como Map<root, miembros[]> */
  groups(ids: string[]): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const id of ids) {
      const root = this.find(id);
      if (!map.has(root)) map.set(root, []);
      map.get(root)!.push(id);
    }
    return map;
  }
}

// ─────────────────────────────────────────────
// Utilidades de Rejilla y Geometría
// ─────────────────────────────────────────────

function snap(p: Point): Point {
  return {
    x: Math.round(p.x / GRID) * GRID,
    y: Math.round(p.y / GRID) * GRID,
  };
}

function cellKey(x: number, y: number): string {
  return `${x / GRID},${y / GRID}`;
}

function ptKey(p: Point): string {
  return cellKey(p.x, p.y);
}

function bboxContainsPoint(bbox: ComponentBBox, p: Point, margin = 0): boolean {
  return (
    p.x >= bbox.x - margin &&
    p.x <= bbox.x + bbox.w + margin &&
    p.y >= bbox.y - margin &&
    p.y <= bbox.y + bbox.h + margin
  );
}

/** Construye el conjunto de celdas bloqueadas por todos los componentes */
function buildOccupancySet(components: ComponentBBox[]): Set<string> {
  const blocked = new Set<string>();
  for (const comp of components) {
    // Iterar en pasos de GRID dentro del bbox expandido
    const x0 = Math.floor((comp.x - MARGIN) / GRID) * GRID;
    const x1 = Math.ceil((comp.x + comp.w + MARGIN) / GRID) * GRID;
    const y0 = Math.floor((comp.y - MARGIN) / GRID) * GRID;
    const y1 = Math.ceil((comp.y + comp.h + MARGIN) / GRID) * GRID;
    for (let cx = x0; cx <= x1; cx += GRID) {
      for (let cy = y0; cy <= y1; cy += GRID) {
        blocked.add(cellKey(cx, cy));
      }
    }
  }
  return blocked;
}

/** Verifica si un segmento ortogonal colisiona con algún componente */
function segmentCollidesWithAny(seg: Segment, components: ComponentBBox[]): boolean {
  // Avanzar celda a celda sobre el segmento
  const dx = seg.to.x !== seg.from.x ? GRID : 0;
  const dy = seg.to.y !== seg.from.y ? GRID : 0;
  const steps = Math.max(
    Math.abs(seg.to.x - seg.from.x),
    Math.abs(seg.to.y - seg.from.y),
  ) / GRID;

  for (let i = 0; i <= steps; i++) {
    const p = { x: seg.from.x + dx * i, y: seg.from.y + dy * i };
    for (const comp of components) {
      if (bboxContainsPoint(comp, p, MARGIN)) return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────
// Manhattan Router
// ─────────────────────────────────────────────

/**
 * Genera una ruta ortogonal entre `from` y `to`.
 * Intenta L-shape primero; si hay colisión usa BFS en rejilla.
 */
function routeManhattan(
  from:       Point,
  to:         Point,
  components: ComponentBBox[],
): Point[] {
  const a = snap(from);
  const b = snap(to);

  if (a.x === b.x && a.y === b.y) return [a];

  // ── Variante 1: H-primero  a → (b.x, a.y) → b
  const corner1: Point = { x: b.x, y: a.y };
  const seg1a: Segment = { from: a,       to: corner1 };
  const seg1b: Segment = { from: corner1, to: b       };

  if (
    !segmentCollidesWithAny(seg1a, components) &&
    !segmentCollidesWithAny(seg1b, components)
  ) {
    return collapseCollinear([a, corner1, b]);
  }

  // ── Variante 2: V-primero  a → (a.x, b.y) → b
  const corner2: Point = { x: a.x, y: b.y };
  const seg2a: Segment = { from: a,       to: corner2 };
  const seg2b: Segment = { from: corner2, to: b       };

  if (
    !segmentCollidesWithAny(seg2a, components) &&
    !segmentCollidesWithAny(seg2b, components)
  ) {
    return collapseCollinear([a, corner2, b]);
  }

  // ── BFS en rejilla con penalización de codos ──
  return bfsRoute(a, b, components) ?? [a, corner1, b]; // fallback L-shape
}

/** Elimina puntos intermedios colineales para reducir segmentos */
function collapseCollinear(pts: Point[]): Point[] {
  if (pts.length <= 2) return pts;
  const result: Point[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const next = pts[i + 1];
    const sameX = prev.x === curr.x && curr.x === next.x;
    const sameY = prev.y === curr.y && curr.y === next.y;
    if (!sameX && !sameY) result.push(curr);
  }
  result.push(pts[pts.length - 1]);
  return result;
}

/** BFS con penalización de codos para rutas complejas */
function bfsRoute(
  start:      Point,
  end:        Point,
  components: ComponentBBox[],
): Point[] | null {
  type State = { pos: Point; dir: "H" | "V" | null; bends: number; path: Point[] };

  const blocked = buildOccupancySet(components);
  const DIRS: Point[] = [
    { x: GRID, y: 0 }, { x: -GRID, y: 0 },
    { x: 0, y: GRID }, { x: 0, y: -GRID },
  ];

  // Prioridad: distancia Manhattan + penalización por codo
  const queue: Array<{ cost: number; state: State }> = [];
  const visited = new Map<string, number>(); // key → best cost

  const heuristic = (p: Point): number =>
    Math.abs(p.x - end.x) + Math.abs(p.y - end.y);

  const push = (cost: number, state: State): void => {
    queue.push({ cost, state });
    queue.sort((a, b) => a.cost - b.cost); // simple priority queue
  };

  push(heuristic(start), { pos: start, dir: null, bends: 0, path: [start] });

  const LIMIT = 2000; // protección contra loops infinitos
  let iterations = 0;

  while (queue.length > 0 && iterations++ < LIMIT) {
    const { cost, state } = queue.shift()!;
    const key = `${ptKey(state.pos)}_${state.dir}_${state.bends}`;

    if (visited.has(key) && visited.get(key)! <= cost) continue;
    visited.set(key, cost);

    if (state.pos.x === end.x && state.pos.y === end.y) {
      return collapseCollinear(state.path);
    }

    for (const d of DIRS) {
      const next: Point = { x: state.pos.x + d.x, y: state.pos.y + d.y };
      if (blocked.has(ptKey(next)) && !(next.x === end.x && next.y === end.y)) continue;

      const newDir: "H" | "V" = d.x !== 0 ? "H" : "V";
      const isBend = state.dir !== null && state.dir !== newDir;
      const newBends = state.bends + (isBend ? 1 : 0);

      const g = cost - heuristic(state.pos) + GRID + (isBend ? 10 * GRID : 0);
      const f = g + heuristic(next);

      push(f, {
        pos:   next,
        dir:   newDir,
        bends: newBends,
        path:  [...state.path, next],
      });
    }
  }
  return null; // Sin ruta encontrada
}

/** Convierte lista de puntos a segmentos */
function pointsToSegments(pts: Point[]): Segment[] {
  const segs: Segment[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    segs.push({ from: pts[i], to: pts[i + 1] });
  }
  return segs;
}

// ─────────────────────────────────────────────
// TopologyGraph — Clase Principal
// ─────────────────────────────────────────────

export class TopologyGraph {
  private pins       = new Map<string, ElectricalPin>();
  private wires      = new Map<string, ElectricalWire>();
  private components = new Map<string, ComponentBBox>();
  private compTypes  = new Map<string, { type: string; value: number }>();
  private wireCounter = 0;

  // ── Gestión de Componentes ──

  addComponent(
    id:      string,
    bbox:    ComponentBBox,
    type:    string,
    value:   number,
    pinDefs: Array<{ index: number; label: string; pos: Point; type: ElectricalPin["type"] }>,
  ): void {
    this.components.set(id, bbox);
    this.compTypes.set(id, { type, value });
    for (const def of pinDefs) {
      const pinId = `${id}:${def.label}`;
      this.pins.set(pinId, {
        id:          pinId,
        componentId: id,
        pinIndex:    def.index,
        canvasPos:   snap(def.pos),
        type:        def.type,
      });
    }
  }

  removeComponent(id: string): void {
    this.components.delete(id);
    this.compTypes.delete(id);
    // Eliminar pines y cables asociados
    for (const [pinId, pin] of this.pins) {
      if (pin.componentId === id) {
        this.pins.delete(pinId);
        this.removeWiresForPin(pinId);
      }
    }
  }

  // ── Gestión de Cables ──

  /**
   * Añade un cable entre dos coordenadas canvas, calcula la ruta ortogonal
   * automáticamente y registra los pines tocados.
   */
  addWire(fromPos: Point, toPos: Point): ElectricalWire {
    const route    = routeManhattan(fromPos, toPos, [...this.components.values()]);
    const segments = pointsToSegments(route);
    const id       = `W${++this.wireCounter}`;

    // Detectar pines tocados por los extremos del cable
    const pinIds = this.findPinsAtPoints([route[0], route[route.length - 1]]);

    // Detectar junctions con cables existentes
    const junctionPins = this.detectJunctionPins(segments);
    for (const jp of junctionPins) {
      if (!pinIds.includes(jp)) pinIds.push(jp);
    }

    const wire: ElectricalWire = { id, segments, pinIds };
    this.wires.set(id, wire);
    return wire;
  }

  removeWire(id: string): void {
    this.wires.delete(id);
  }

  private removeWiresForPin(pinId: string): void {
    for (const [wid, wire] of this.wires) {
      if (wire.pinIds.includes(pinId)) this.wires.delete(wid);
    }
  }

  /** Encuentra pines cuya canvasPos coincide exactamente con alguno de los puntos */
  private findPinsAtPoints(pts: Point[]): string[] {
    const result: string[] = [];
    for (const pin of this.pins.values()) {
      for (const p of pts) {
        if (pin.canvasPos.x === p.x && pin.canvasPos.y === p.y) {
          if (!result.includes(pin.id)) result.push(pin.id);
        }
      }
    }
    return result;
  }

  /**
   * Detecta junctions: puntos donde el nuevo cable cruza cables existentes.
   * Retorna los pinIds de los cables tocados en esa intersección.
   */
  private detectJunctionPins(newSegs: Segment[]): string[] {
    const junctionPins: string[] = [];
    for (const existing of this.wires.values()) {
      for (const ns of newSegs) {
        for (const es of existing.segments) {
          const junction = segmentIntersection(ns, es);
          if (junction) {
            // Un wire existente es tocado → heredar sus pines
            for (const pid of existing.pinIds) {
              if (!junctionPins.includes(pid)) junctionPins.push(pid);
            }
          }
        }
      }
    }
    return junctionPins;
  }

  // ── Extracción de Netlist (DSU) ──

  extractNetlist(): Netlist {
    const dsu = new DSU();

    // Inicializar todos los pines como conjuntos singulares
    for (const pinId of this.pins.keys()) dsu.add(pinId);

    // Unir pines conectados por cada cable
    for (const wire of this.wires.values()) {
      for (let i = 0; i < wire.pinIds.length - 1; i++) {
        dsu.union(wire.pinIds[i], wire.pinIds[i + 1]);
      }
    }

    // ── Regla GND especial ──
    // El componente "GND" tiene un único pin: "GND:1"
    // Su grupo debe ser forzado a root "0"
    const gndPin = "GND:1";
    if (this.pins.has(gndPin)) {
      dsu.add("0"); // Nodo virtual raíz SPICE
      dsu.forceRoot(gndPin, "0");
    }

    // Agrupar pines por root DSU
    const allPinIds = [...this.pins.keys()];
    const groups    = dsu.groups(allPinIds);

    // Construir nets
    const netIdMap = new Map<string, string>(); // root → netId
    const nets: NetlistNet[] = [];
    let netCounter = 1;

    for (const [root, memberPins] of groups) {
      const netId = root === "0" ? "0" : `N${String(netCounter++).padStart(3, "0")}`;
      netIdMap.set(root, netId);
      nets.push({
        id:     netId,
        label:  netId === "0" ? "GND" : null,
        pinIds: memberPins,
      });
    }

    // Construir componentes con sus netIds
    const components: NetlistComponent[] = [];
    for (const [compId, meta] of this.compTypes) {
      // Recolectar pines del componente ordenados por pinIndex
      const compPins = [...this.pins.values()]
        .filter((p) => p.componentId === compId)
        .sort((a, b) => a.pinIndex - b.pinIndex);

      const pinNets = compPins.map((p) => {
        const root = dsu.find(p.id);
        return netIdMap.get(root) ?? "FLOATING";
      });

      components.push({
        id:    compId,
        type:  meta.type,
        value: meta.value,
        pins:  pinNets,
      });
    }

    return { nets, components };
  }

  // ── Verificación Eléctrica (ERC) ──

  runERC(): ERCResult {
    const errors:   ERCViolation[] = [];
    const warnings: ERCViolation[] = [];

    const netlist = this.extractNetlist();

    // Mapa netId → net
    const netMap = new Map(netlist.nets.map((n) => [n.id, n]));

    // Regla 1: Ausencia de nodo GND
    if (!netMap.has("0")) {
      errors.push({
        code:    "NO_GND",
        message: "El circuito no tiene referencia GND. La simulación no puede converger.",
      });
    }

    // Regla 2: Pines flotantes (pines en un net de un solo miembro sin fuente)
    const sourcePinTypes = new Set<string>(["OUTPUT", "POWER"]);
    for (const net of netlist.nets) {
      if (net.id === "0") continue;
      const hasSource = net.pinIds.some((pid) => {
        const pin = this.pins.get(pid);
        return pin && sourcePinTypes.has(pin.type);
      });
      if (net.pinIds.length === 1 && !hasSource) {
        const pin = this.pins.get(net.pinIds[0]);
        if (pin?.type !== "NC") {
          errors.push({
            code:    "FLOATING_PIN",
            message: `Pin flotante detectado: ${net.pinIds[0]}`,
            pinIds:  net.pinIds,
            netId:   net.id,
          });
        }
      }
    }

    // Regla 3: Cortocircuito entre fuentes (2+ VSOURCE en el mismo net)
    for (const net of netlist.nets) {
      const vsourcePins = net.pinIds.filter((pid) => {
        const comp = this.compTypes.get(this.pins.get(pid)?.componentId ?? "");
        return comp?.type === "VSOURCE";
      });
      if (vsourcePins.length >= 2) {
        errors.push({
          code:    "SHORT_CIRCUIT",
          message: `Cortocircuito: fuentes ${vsourcePins.join(", ")} comparten nodo ${net.id}`,
          pinIds:  vsourcePins,
          netId:   net.id,
        });
      }
    }

    // Regla 4: Islas disconnectadas (componentes sin ningún pin en el net principal)
    const connectedCompIds = new Set<string>();
    for (const net of netlist.nets) {
      for (const pid of net.pinIds) {
        const pin = this.pins.get(pid);
        if (pin) connectedCompIds.add(pin.componentId);
      }
    }
    const isolated = [...this.compTypes.keys()].filter((id) => !connectedCompIds.has(id));
    if (isolated.length > 0) {
      warnings.push({
        code:    "ISLAND",
        message: `Subgrafo aislado detectado: componentes ${isolated.join(", ")} no conectados.`,
      });
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /** Serialización completa para el IPC de Tauri */
  serializeForTauri(): string {
    const erc     = this.runERC();
    const netlist = this.extractNetlist();
    return JSON.stringify({ netlist, erc }, null, 2);
  }
}

// ─────────────────────────────────────────────
// Intersección de Segmentos Ortogonales
// ─────────────────────────────────────────────

/**
 * Retorna el punto de intersección de dos segmentos ortogonales
 * (uno horizontal, uno vertical), o null si no se cruzan.
 */
function segmentIntersection(a: Segment, b: Segment): Point | null {
  // Determinar orientación
  const aHoriz = a.from.y === a.to.y;
  const bHoriz = b.from.y === b.to.y;

  if (aHoriz === bHoriz) return null; // Paralelos → sin intersección puntual

  const h = aHoriz ? a : b;
  const v = aHoriz ? b : a;

  const hMinX = Math.min(h.from.x, h.to.x);
  const hMaxX = Math.max(h.from.x, h.to.x);
  const vMinY = Math.min(v.from.y, v.to.y);
  const vMaxY = Math.max(v.from.y, v.to.y);

  const vX = v.from.x;
  const hY = h.from.y;

  if (vX >= hMinX && vX <= hMaxX && hY >= vMinY && hY <= vMaxY) {
    return { x: vX, y: hY };
  }
  return null;
}

// ─────────────────────────────────────────────
// Demo: Circuito RC simple
// ─────────────────────────────────────────────

function demo(): void {
  const graph = new TopologyGraph();

  // ── Componentes ──

  // Fuente de tensión V1 (5V)
  graph.addComponent("V1", { id: "V1", x: 40, y: 100, w: 40, h: 80 }, "VSOURCE", 5.0, [
    { index: 0, label: "POS", pos: { x: 60, y: 100 }, type: "OUTPUT" },
    { index: 1, label: "NEG", pos: { x: 60, y: 180 }, type: "PASSIVE" },
  ]);

  // Resistencia R1 (1kΩ)
  graph.addComponent("R1", { id: "R1", x: 140, y: 100, w: 60, h: 20 }, "RESISTOR", 1000, [
    { index: 0, label: "A", pos: { x: 140, y: 110 }, type: "PASSIVE" },
    { index: 1, label: "B", pos: { x: 200, y: 110 }, type: "PASSIVE" },
  ]);

  // Capacitor C1 (1µF)
  graph.addComponent("C1", { id: "C1", x: 220, y: 100, w: 20, h: 80 }, "CAP", 1e-6, [
    { index: 0, label: "POS", pos: { x: 230, y: 100 }, type: "PASSIVE" },
    { index: 1, label: "NEG", pos: { x: 230, y: 180 }, type: "PASSIVE" },
  ]);

  // Tierra GND
  graph.addComponent("GND", { id: "GND", x: 120, y: 200, w: 20, h: 20 }, "GND", 0, [
    { index: 0, label: "1", pos: { x: 130, y: 200 }, type: "POWER" },
  ]);

  // ── Cables ──

  // V1:POS → R1:A  (ruta horizontal)
  graph.addWire({ x: 60, y: 100 }, { x: 140, y: 110 });

  // R1:B → C1:POS  (ruta horizontal)
  graph.addWire({ x: 200, y: 110 }, { x: 230, y: 100 });

  // V1:NEG → GND  y  C1:NEG → GND  (por bus de tierra)
  graph.addWire({ x: 60,  y: 180 }, { x: 130, y: 200 });
  graph.addWire({ x: 230, y: 180 }, { x: 130, y: 200 });

  // ── Salida ──
  console.log(graph.serializeForTauri());
}

demo();
