/**
 * net-graph.ts
 *
 * Estructura de datos para detección de nets eléctricos usando union-find.
 * Esta es la fuente de verdad de conectividad — el renderizado de wires es
 * una proyección visual de esta estructura, NUNCA al revés.
 *
 * INTEGRACIÓN CON ASTRYD SOPHIA:
 * Tu canvas_orchestrator.ts ya tiene `components: ComponentInstance[]` y
 * `wires: WireInstance[]` como estado — NetGraph NO reemplaza eso, vive al
 * lado y se reconstruye (o actualiza incrementalmente) a partir de esos
 * arrays. Por eso los tipos aquí se llaman `PinRef`/`NetWireRef` y no
 * `ComponentInstance`/`WireInstance` a secas: son vistas derivadas para el
 * union-find, no tu
 * modelo de estado real. El patrón de uso esperado:
 *
 *   function syncNetGraph(graph: NetGraph, components: ComponentInstance[], wires: WireInstance[]) {
 *     graph.rebuildFromScratch(
 *       components.flatMap(c => c.pins.map(p => toPinRef(c, p))),
 *       wires.map(toNetWireRef)
 *     );
 *   }
 *
 * Las funciones toPinRef/toNetWireRef son tuyas — dependen de cómo
 * `ComponentInstance` define sus pines (offset relativo + posición del
 * componente, probablemente), que no conozco. Ver rebuildFromScratch()
 * más abajo para el método pensado exactamente para este caso de uso
 * (llamarlo tras cada cambio de estado del orchestrator, en vez de
 * mantener NetGraph mutado incrementalmente en paralelo a tu estado real
 * — más simple y con menos superficie de bugs de desincronización).
 *
 * Grid: tu canvas_orchestrator usa paso de 20px y traduce con
 * screenToWorld/worldToScreen. Las coordenadas que entran aquí deben ser
 * coordenadas de mundo en unidades de grid (es decir, ya divididas por
 * GRID_STEP_PX si tu screenToWorld devuelve píxeles de mundo en vez de
 * índices de celda) — ver GRID_STEP_PX exportado abajo para que ambos
 * lados del código usen la misma constante en vez de un "20" mágico
 * repetido en dos archivos.
 *
 * Principio core (ver references/canvas-wiring.md):
 * Dos pines están en el mismo net si y solo si están en el mismo conjunto
 * del union-find. La igualdad de coordenadas de grid es lo que decide si
 * dos endpoints se "tocan" — nunca uses comparación de distancia aproximada
 * para esto, o tendrás el bug "se ve conectado pero no lo está".
 */

/** Paso de grid de Astryd Sophia, en píxeles a zoom 100%. Mantener como única fuente de verdad en vez de repetir "20" en canvas_orchestrator.ts y aquí. */
export const GRID_STEP_PX = 20;

export type PinId = string; // formato: `${componentId}:${pinName}`, ej "R1:1" — coincide con las keys de branch_currents si usas wire id, NO con node_voltages (eso usa NetId, ver snapshot())
export type WireId = string; // debe coincidir 1:1 con el id que usas como key en SimulationFrame.branch_currents — ver references/simulation-feedback.md
export type NetId = string; // formato: "N$1", "N$2"... o nombre manual ("VCC","GND") — coincide con las keys de SimulationFrame.node_voltages

export interface GridPoint {
  x: number; // coordenada en unidades de grid (entero), no píxeles. multiplicar por GRID_STEP_PX para obtener píxeles de mundo
  y: number;
}

/** Vista derivada de un pin de ComponentInstance, para consumo del union-find. No es tu tipo de estado real — ver nota de integración arriba. */
export interface PinRef {
  id: PinId;
  componentId: string;
  position: GridPoint;
}

/** Vista derivada de un WireInstance, para consumo del union-find. */
export interface NetWireRef {
  id: WireId;
  // Una wire ortogonal se representa como una polilínea de puntos en grid.
  // El router (wire-router.ts) genera estos puntos; aquí solo nos importan
  // los dos extremos para unión de nets — los puntos intermedios son
  // puramente visuales y no afectan conectividad salvo que coincidan con
  // un pin (caso de "T junction", ver addWire).
  points: GridPoint[];
}

interface NetGraphSnapshot {
  netOfPin: Map<PinId, NetId>;
  pinsInNet: Map<NetId, Set<PinId>>;
}

/**
 * Codifica un GridPoint a una clave string única para usar como key de Map.
 * Las coordenadas deben ser enteros de grid, no floats de píxel — si tu
 * pipeline de snapping no garantiza esto, el bug de "falso desconectado"
 * vuelve a aparecer aquí.
 */
function pointKey(p: GridPoint): string {
  return `${p.x},${p.y}`;
}

export class NetGraph {
  private parent = new Map<PinId, PinId>();
  private rank = new Map<PinId, number>();
  private pins = new Map<PinId, PinRef>();
  private wires = new Map<WireId, NetWireRef>();

  // Índice posición -> pines en esa posición (para detectar uniones por coincidencia de grid)
  private pinsAtPoint = new Map<string, Set<PinId>>();

  // Nombres de net asignados manualmente por el usuario (ej. "VCC", "GND")
  // tienen prioridad sobre el auto-naming N$n.
  private manualNetNames = new Map<NetId, string>();

  // --- Union-Find core ---

  private find(pinId: PinId): PinId {
    const parent = this.parent.get(pinId);
    if (parent === undefined) {
      throw new Error(`Pin ${pinId} no registrado en NetGraph`);
    }
    if (parent !== pinId) {
      const root = this.find(parent);
      this.parent.set(pinId, root); // path compression
      return root;
    }
    return pinId;
  }

  private union(a: PinId, b: PinId): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;

    const rankA = this.rank.get(rootA) ?? 0;
    const rankB = this.rank.get(rootB) ?? 0;

    // Union by rank para mantener el árbol plano
    if (rankA < rankB) {
      this.parent.set(rootA, rootB);
    } else if (rankA > rankB) {
      this.parent.set(rootB, rootA);
    } else {
      this.parent.set(rootB, rootA);
      this.rank.set(rootA, rankA + 1);
    }
  }

  // --- API pública ---

  addPin(pin: PinRef): void {
    this.pins.set(pin.id, pin);
    this.parent.set(pin.id, pin.id);
    this.rank.set(pin.id, 0);

    const key = pointKey(pin.position);
    if (!this.pinsAtPoint.has(key)) {
      this.pinsAtPoint.set(key, new Set());
    }
    this.pinsAtPoint.get(key)!.add(pin.id);

    // Si ya hay otros pines exactamente en este punto de grid, únelos.
    // Esto cubre el caso de un componente colocado tal que su pin cae
    // sobre un pin existente sin wire explícito de por medio (raro pero válido).
    for (const otherId of this.pinsAtPoint.get(key)!) {
      if (otherId !== pin.id) {
        this.union(pin.id, otherId);
      }
    }
  }

  removePin(pinId: PinId): void {
    const pin = this.pins.get(pinId);
    if (!pin) return;
    const key = pointKey(pin.position);
    this.pinsAtPoint.get(key)?.delete(pinId);
    this.pins.delete(pinId);
    this.parent.delete(pinId);
    this.rank.delete(pinId);
    // Nota: union-find no soporta "split" eficiente. Tras un remove que
    // pueda desconectar un net, hay que llamar rebuild() para
    // reconstruir desde cero. Ver comentario en rebuild().
  }

  /**
   * Registra un wire y une todos los pines que coincidan exactamente con
   * sus puntos de endpoint. También maneja "T junctions": si un punto
   * intermedio del wire (no solo los extremos) coincide con la posición
   * de un pin existente, también se une — esto es común cuando un wire
   * pasa "por encima" de un pin de otro componente en el mismo grid line.
   */
  addWire(wire: NetWireRef): void {
    this.wires.set(wire.id, wire);

    for (const point of wire.points) {
      const key = pointKey(point);
      const pinsHere = this.pinsAtPoint.get(key);
      if (!pinsHere || pinsHere.size === 0) continue;

      const pinIds = Array.from(pinsHere);
      for (let i = 1; i < pinIds.length; i++) {
        this.union(pinIds[0], pinIds[i]);
      }
    }

    // Unir también los pines en ambos extremos entre sí si el wire conecta
    // dos puntos que cada uno tiene pines distintos (caso normal: wire de
    // pin A a pin B).
    const first = wire.points[0];
    const last = wire.points[wire.points.length - 1];
    const pinsAtFirst = this.pinsAtPoint.get(pointKey(first));
    const pinsAtLast = this.pinsAtPoint.get(pointKey(last));
    if (pinsAtFirst && pinsAtLast) {
      const a = Array.from(pinsAtFirst)[0];
      const b = Array.from(pinsAtLast)[0];
      if (a && b) this.union(a, b);
    }
  }

  removeWire(wireId: WireId): void {
    this.wires.delete(wireId);
    // Igual que removePin: remover un wire puede desconectar un net.
    // Union-find no deshace uniones eficientemente — reconstruir es la
    // estrategia correcta y sigue siendo O(n α(n)), barato incluso para
    // circuitos de miles de nodos.
    this.rebuild();
  }

  /**
   * Reconstruye el union-find completo desde pins + wires actuales.
   * Llamar tras cualquier operación que pueda haber roto una unión
   * (remove de pin o wire). Operación O(n α(n)) — segura de llamar
   * en cada edición destructiva, no hace falta optimizar esto salvo
   * que perfiles y veas que es un cuello de botella real.
   */
  rebuild(): void {
    const allPins = Array.from(this.pins.values());
    const allWires = Array.from(this.wires.values());

    this.parent.clear();
    this.rank.clear();
    this.pinsAtPoint.clear();

    for (const pin of allPins) {
      this.parent.set(pin.id, pin.id);
      this.rank.set(pin.id, 0);
      const key = pointKey(pin.position);
      if (!this.pinsAtPoint.has(key)) this.pinsAtPoint.set(key, new Set());
      this.pinsAtPoint.get(key)!.add(pin.id);
    }
    for (const key of this.pinsAtPoint.keys()) {
      const pinIds = Array.from(this.pinsAtPoint.get(key)!);
      for (let i = 1; i < pinIds.length; i++) {
        this.union(pinIds[0], pinIds[i]);
      }
    }
    for (const wire of allWires) {
      this.addWire(wire);
    }
  }

  /**
   * Limpia el grafo completo y lo reconstruye desde cero a partir de los
   * pines y wires dados — pensado para llamarse tras CADA cambio de estado
   * relevante en canvas_orchestrator.ts (componente añadido/movido/borrado,
   * wire añadido/borrado), en vez de mantener NetGraph mutado
   * incrementalmente en paralelo a `components`/`wires`. Ver nota de
   * integración al inicio del archivo para el patrón syncNetGraph().
   *
   * Coste O(n α(n)) — el mismo orden que rebuild(), así que llamarlo en
   * cada cambio de estado es seguro incluso para circuitos grandes; no
   * necesitas lógica de "qué cambió exactamente" para decidir si vale la
   * pena reconstruir.
   */
  rebuildFromScratch(pins: PinRef[], wires: NetWireRef[]): void {
    this.parent.clear();
    this.rank.clear();
    this.pins.clear();
    this.wires.clear();
    this.pinsAtPoint.clear();
    // Nota: manualNetNames NO se limpia aquí — los nombres manuales de net
    // (VCC, GND) deben sobrevivir a un rebuild de topología siempre que el
    // root correspondiente siga existiendo tras la reconstrucción. Si
    // necesitas resetear también los nombres manuales (ej. al cargar un
    // proyecto distinto), llama a un NetGraph nuevo en vez de reusar este.

    for (const pin of pins) this.addPin(pin);
    for (const wire of wires) this.addWire(wire);
  }

  /**
   * Key a usar para leer el voltaje de este pin desde
   * `SimulationFrame.node_voltages` (HashMap<String,f64> en Rust). El
   * voltaje es propiedad del NET, no del pin individual — por eso esto
   * resuelve primero a NetId vía el union-find antes de construir la key.
   * Lanza si el pin no está registrado; comprueba con `this.pins.has(pinId)`
   * antes si necesitas un camino que no lance.
   */
  getVoltageKey(pinId: PinId): NetId {
    return this.snapshot().netOfPin.get(pinId) ?? this.find(pinId);
  }


  areConnected(pinA: PinId, pinB: PinId): boolean {
    if (!this.parent.has(pinA) || !this.parent.has(pinB)) return false;
    return this.find(pinA) === this.find(pinB);
  }

  /** Todos los pines que comparten net con el pin dado (incluyéndolo). */
  getNetMembers(pinId: PinId): Set<PinId> {
    const root = this.find(pinId);
    const members = new Set<PinId>();
    for (const otherId of this.pins.keys()) {
      if (this.find(otherId) === root) members.add(otherId);
    }
    return members;
  }

  /** Snapshot completo: mapeo pin->net y net->miembros, para renderizado/highlight. */
  snapshot(): NetGraphSnapshot {
    const netOfPin = new Map<PinId, NetId>();
    const pinsInNet = new Map<NetId, Set<PinId>>();
    const rootToNetId = new Map<PinId, NetId>();
    let counter = 1;

    for (const pinId of this.pins.keys()) {
      const root = this.find(pinId);
      let netId = rootToNetId.get(root);
      if (!netId) {
        netId = this.manualNetNames.get(root) ?? `N$${counter++}`;
        rootToNetId.set(root, netId);
      }
      netOfPin.set(pinId, netId);
      if (!pinsInNet.has(netId)) pinsInNet.set(netId, new Set());
      pinsInNet.get(netId)!.add(pinId);
    }

    return { netOfPin, pinsInNet };
  }

  /**
   * Asigna un nombre manual a un net (ej. el usuario etiqueta "VCC" o "GND").
   * El nombre persiste mientras el root del union-find no cambie; si el
   * usuario borra el wire que mantenía unido ese net, el nombre se pierde
   * para el nuevo root tras rebuild() — esto es comportamiento esperado
   * en KiCad también (net labels viven en el wire/punto etiquetado, no
   * "flotan" independientes de la topología).
   */
  setNetName(pinId: PinId, name: string): void {
    const root = this.find(pinId);
    this.manualNetNames.set(root, name);
  }
}
