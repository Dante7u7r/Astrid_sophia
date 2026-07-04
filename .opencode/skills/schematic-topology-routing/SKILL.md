# Skill: schematic-topology-routing

## Descripción
Lógica de grafos topológicos para circuitos eléctricos. Implementación de enrutamiento ortogonal (Manhattan Routing) sobre rejilla rígida, gestión interactiva de conexiones entre pines, y extracción reactiva de Netlists mediante Estructuras de Conjuntos Disjuntos (DSU - Disjoint Set Union).

---

## 1. Arquitectura del Grafo: Separación Canvas ↔ Grafo Lógico

### Principio Fundamental
El sistema mantiene **dos representaciones paralelas y desacopladas** del circuito:

```
┌─────────────────────────────┐      ┌──────────────────────────────┐
│    CAPA VISUAL (Canvas)     │      │   GRAFO LÓGICO (Eléctrico)   │
│                             │      │                              │
│  ComponentSprite {          │      │  Pin {                       │
│    id, x, y, rotation       │      │    id, componentId           │
│    svgPath, ports[]         │      │    netId (DSU root)          │
│  }                          │      │  }                           │
│                             │      │                              │
│  WireSegment {              │      │  Net {                       │
│    points: Point[]          │      │    id, pinIds[]              │
│    visualStyle              │      │    voltage: number           │
│  }                          │      │  }                           │
└────────────┬────────────────┘      └──────────┬───────────────────┘
             │                                   │
             └──────── syncTopology() ───────────┘
```

**Regla estricta**: nunca leer posición visual desde el grafo lógico. La capa visual notifica cambios; el grafo responde actualizando su topología sin acceder al DOM.

### Entidades del Grafo

```typescript
// Nodo lógico: un pin de un componente
interface ElectricalPin {
  id: string;             // "R1:A", "U1:VCC"
  componentId: string;    // "R1"
  pinIndex: number;       // 0 = positivo, 1 = negativo, etc.
  canvasPos: Point;       // Posición en grilla (múltiplo de GRID_SIZE)
}

// Arista lógica: un cable que une dos o más pines
interface ElectricalWire {
  id: string;
  segments: Segment[];    // Lista de segmentos ortogonales
  pinIds: string[];       // Pines que este cable toca
}

// Net: grupo de pines eléctricamente conectados (resultado del DSU)
interface Net {
  id: string;             // "N001", "GND" (forzado para masa)
  pinIds: string[];
  label?: string;
}
```

---

## 2. Algoritmo Manhattan: Enrutamiento Ortogonal en Rejilla de 20px

### Constantes del Sistema
```typescript
const GRID_SIZE = 20;      // px — toda coordenada DEBE ser múltiplo de este valor
const MAX_BENDS = 2;       // Máximo de codos por cable (preferencia estética)
```

### Pipeline de Enrutamiento

El enrutamiento de un cable entre `pinA: Point` y `pinB: Point` sigue este orden:

#### Paso 1: Snap a Rejilla
```
snapToGrid(p: Point): Point {
  return { x: round(p.x / GRID) * GRID, y: round(p.y / GRID) * GRID }
}
```
**Invariante**: todo punto de cable DEBE ser múltiplo de `GRID_SIZE`. Un cable en coordenada impar rompe la detección de intersecciones.

#### Paso 2: Intentar Ruta L-Shape (0 obstáculos)
Generar dos variantes de ruta L:
- **Horizontal-primero**: `A → (Bx, Ay) → B`
- **Vertical-primero**: `A → (Ax, By) → B`

Seleccionar la que minimice colisiones con bounding-boxes de componentes existentes.

#### Paso 3: Evasión de Obstáculos (BFS en Rejilla)
Si ambas rutas L colisionan, activar BFS sobre la grilla de ocupación:

```
OccupancyGrid: Map<string, boolean>
  key = `${x/GRID},${y/GRID}`
  value = true si celda bloqueada por componente

BFS desde snapToGrid(pinA) hasta snapToGrid(pinB):
  Vecinos: ±GRID en X o Y (nunca diagonal)
  Heurística: distancia Manhattan para A* opcional
  Costo de codo: +10 para penalizar cambios de dirección
```

#### Paso 4: Post-procesado — Reducción de Segmentos Colineales
```
collapseSegments(points: Point[]): Segment[] {
  // Fusionar puntos consecutivos con misma dirección
  // Resultado: mínimo número de segmentos para el mismo camino
}
```

### Detección de Colisión con Componentes
```typescript
function wireCollidesWithComponent(seg: Segment, comp: ComponentBBox): boolean {
  // Expandir bbox por GRID_SIZE/2 como margen de seguridad
  const expanded = expandBBox(comp.bbox, GRID_SIZE / 2);
  return segmentIntersectsRect(seg, expanded);
}
```

### Intersecciones Wire-a-Wire (Unión Automática)
Un punto de cable que cae exactamente sobre otro cable existente crea una **junction** y une eléctricamente las dos redes:

```
detectWireJunction(newWire: ElectricalWire, existingWires: ElectricalWire[]): Point[] {
  Para cada segmento del nuevo cable:
    Para cada segmento de cada cable existente:
      Si se cruzan en un punto de rejilla → junction
      Agregar al grafo → disparar DSU merge
}
```

---

## 3. Extracción de Netlist mediante DSU

### Estructura DSU

```typescript
class DSU {
  parent: Map<string, string>;
  rank:   Map<string, number>;

  find(id: string): string {
    // Path compression: aplana el árbol en cada llamada
    if (parent[id] !== id)
      parent[id] = this.find(parent[id]);
    return parent[id];
  }

  union(a: string, b: string): void {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    // Union by rank: árbol más profundo absorbe al superficial
    if (rank[ra] < rank[rb]) swap(ra, rb);
    parent[rb] = ra;
    if (rank[ra] === rank[rb]) rank[ra]++;
  }
}
```

**Complejidad**: `find` y `union` en O(α(n)) — prácticamente O(1).

### Pipeline de Extracción

```
1. Inicializar DSU con todos los pinIds como conjuntos singulares.

2. Para cada ElectricalWire:
     Para cada par (pinIds[i], pinIds[i+1]):
       dsu.union(pinIds[i], pinIds[i+1])

3. Para cada Wire-Junction detectada:
     Obtener pines tocados por ambos cables en el punto de unión
     dsu.union(pinA, pinB)

4. Agrupar pines por su DSU root → cada grupo = un Net

5. REGLA GND ESPECIAL:
     Si algún pin del grupo pertenece al componente "GND":
       Forzar el id del Net a "0" (convención SPICE)
       Promover ese root a root del grupo completo
```

### Formato de Salida (Netlist JSON para Tauri IPC)

```json
{
  "netlist": {
    "nets": [
      { "id": "0",    "label": "GND", "pinIds": ["GND1:1", "R1:B", "C1:NEG"] },
      { "id": "N001", "label": null,  "pinIds": ["V1:POS", "R1:A"]           },
      { "id": "N002", "label": null,  "pinIds": ["R1:B", "C1:POS", "U1:IN"]  }
    ],
    "components": [
      { "id": "R1", "type": "RESISTOR", "value": 1000, "pins": ["N001","0"] },
      { "id": "C1", "type": "CAP",      "value": 1e-6, "pins": ["N002","0"] },
      { "id": "V1", "type": "VSOURCE",  "value": 5.0,  "pins": ["N001","0"] }
    ]
  }
}
```

---

## 4. Verificación Eléctrica (ERC — Electrical Rules Check)

El ERC se ejecuta **antes** de despachar la netlist al solver. Abortar si:

### Regla 1: Pin Flotante
```
Un pin con solo 1 componente en su Net Y sin fuente en ese Net
→ Error: "Pin flotante detectado: ${pinId}"
Excepción: pines de tipo "NC" (No Connect) marcados explícitamente
```

### Regla 2: Cortocircuito de Fuentes
```
Si un Net contiene 2+ pines de tipo VSOURCE (V+):
→ Error: "Cortocircuito: fuentes ${src1} y ${src2} comparten nodo ${netId}"
```

### Regla 3: Ausencia de Nodo GND
```
Si ningún Net tiene id "0":
→ Error: "El circuito no tiene referencia GND. La simulación no puede converger."
```

### Regla 4: Islas Disconnectadas
```
Si el grafo resultante tiene > 1 componente conexo después del DSU:
→ Warning: "Subgrafo aislado detectado: componentes ${list} no conectados al circuito principal"
```

### Respuesta ERC al Frontend
```typescript
interface ERCResult {
  valid: boolean;
  errors:   ERCViolation[];   // Bloquean simulación
  warnings: ERCViolation[];   // Solo informan
}

interface ERCViolation {
  code:    "FLOATING_PIN" | "SHORT_CIRCUIT" | "NO_GND" | "ISLAND";
  message: string;
  pinIds?: string[];
  netId?:  string;
}
```

---

## Integración con Tauri IPC

```typescript
// Llamada desde el frontend al comando Rust
const result = await invoke<SimulationResult>("run_simulation", {
  netlist: topologyGraph.extractNetlist()  // JSON del DSU
});
```

El grafo se serializa con `JSON.stringify` y se deserializa en Rust como `serde_json::Value`. Los ids de Net deben ser strings; el solver Rust convierte "0" al nodo de referencia tierra SPICE.

---

## Archivos de Referencia

- `examples/graph_netlist_router.ts` — Implementación completa de la clase `TopologyGraph`
