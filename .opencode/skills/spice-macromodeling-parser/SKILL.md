# Skill: spice-macromodeling-parser

## Descripción
Análisis léxico y sintáctico (Parsing) de archivos de modelos estándar SPICE (`.model` y `.subckt`). Expansión estructural de macro-modelos comerciales y aplanamiento de subcircuitos jerárquicos en estampas primitivas MNA dentro del motor de simulación en Rust.

---

## 1. Tokenización SPICE

### Formato de Archivo `.lib` / `.mod`

Los archivos SPICE de fabricantes siguen estas reglas léxicas estrictas:

```
* Comentario (línea inicia con *)
$ Comentario inline (todo lo que sigue a $)
+ Continuación de línea (+ al inicio = concatenar con la anterior)
.subckt <nombre> <nodo1> <nodo2> ... [PARAMS: clave=valor ...]
  <elementos internos>
.ends <nombre>
.model <nombre> <tipo>(<params>)
```

### Máquina de Estados del Tokenizer

```
Estado inicial: IDLE
  Lee línea → strip whitespace → lowercase (SPICE es case-insensitive)
  Si empieza con '*' → SKIP_LINE
  Si empieza con '$' → SKIP_LINE
  Si empieza con '+' → CONTINUATION: concatenar al buffer anterior
  Si empieza con '.subckt' → entrar a INSIDE_SUBCKT
  Si empieza con '.model'  → parsear MODEL_STATEMENT
  Otro → parsear como ELEMENT_LINE

Estado INSIDE_SUBCKT:
  Acumular líneas de elementos hasta encontrar '.ends'
  Manejar subcircuitos anidados incrementando profundidad
```

### Gramática de Elementos SPICE

| Prefijo | Tipo         | Sintaxis                                    |
|---------|--------------|---------------------------------------------|
| `R`     | Resistencia  | `R<id> <n+> <n-> <valor>`                   |
| `C`     | Capacitor    | `C<id> <n+> <n-> <valor>`                   |
| `L`     | Inductor     | `L<id> <n+> <n-> <valor>`                   |
| `V`     | Fuente V     | `V<id> <n+> <n-> DC <valor>`                |
| `I`     | Fuente I     | `I<id> <n+> <n-> DC <valor>`                |
| `E`     | VCVS         | `E<id> <no+> <no-> <ni+> <ni-> <ganancia>`  |
| `F`     | CCCS         | `F<id> <no+> <no-> <Vsensor> <ganancia>`    |
| `G`     | VCCS         | `G<id> <no+> <no-> <ni+> <ni-> <gm>`        |
| `H`     | CCVS         | `H<id> <no+> <no-> <Vsensor> <transR>`      |
| `X`     | Instancia    | `X<id> <nodo...> <subckt_name> [PARAMS:…]`  |

### Parsing de Valores con Sufijos SPICE

```rust
fn parse_spice_value(s: &str) -> f64 {
  // Sufijos estándar SPICE:
  // T=1e12  G=1e9  Meg=1e6  K=1e3
  // m=1e-3  u=1e-6  n=1e-9  p=1e-12  f=1e-15
  //
  // Nota: 'M' y 'm' son AMBOS 1e-3 en SPICE clásico.
  // 'Meg' (case-insensitive) es 1e6.
}
```

**Trampa común**: SPICE usa `M` para mili (10⁻³), no para mega. `MEG` o `Meg` es 10⁶.

---

## 2. Expansión Jerárquica de Subcircuitos

### Problema
Un archivo `.lib` puede contener:
```spice
.subckt OpAmp_Simple IN+ IN- OUT VCC VEE
  Rin IN+ IN- 1Meg
  E1  OUT 0  IN+ IN- 100K
  R_out OUT _out_int 75
  V_os _out_int 0 DC 2m
.ends OpAmp_Simple
```

El solver MNA necesita ver solo componentes primitivos (R, C, L, V, I, E, G, F, H), sin jerarquía.

### Algoritmo de Aplanamiento

```
flattenSubcircuit(instance: XInstance, definition: SubcktDef, parentContext: Context) → Vec<Component>

1. Crear un namespace único para nodos internos:
     prefix = `${instance.id}_${instance.subcktName}`
     ej: "X1_OpAmp_Simple"

2. Construir mapeo de puertos → nodos del padre:
     portMap: Map<string, string>
     Para i in 0..definition.ports.len():
       portMap[definition.ports[i]] = instance.externalNodes[i]

3. Para cada elemento interno de la definición:
     Crear copia con nodos remapeados:
       Si nodo está en portMap → usar nodo del padre
       Si nodo es "0" → mantener como "0" (tierra global)
       Sino → renombrar con prefix: "${prefix}_${nodo}"

4. Resolver PARAMS heredados:
     Para cada parámetro del elemento:
       Si el valor es una expresión → evaluarla con el ParamContext
       (ver Sección 3)

5. Si el elemento es otra instancia X (subckt anidado):
     Recursión: flattenSubcircuit(sub_instance, sub_definition, newContext)

6. Agregar todos los componentes aplanados al Vec<Component> del solver
```

### Manejo de Nodo Tierra (Nodo 0)

```rust
// El nodo "0" es tierra global SPICE — NUNCA renombrar con prefix
fn remap_node(node: &str, port_map: &HashMap<String, String>, prefix: &str) -> String {
    if node == "0" {
        return "0".to_string();  // Tierra global: inmutable
    }
    if let Some(external) = port_map.get(node) {
        return external.clone(); // Puerto mapeado al padre
    }
    format!("{}_{}", prefix, node) // Nodo interno: namespaced
}
```

---

## 3. Mapeo de Parámetros (PARAMS:)

### Definición y Uso
```spice
.subckt Filtro IN OUT PARAMS: R=1K C=100n

R1 IN mid {R}        * valor entre llaves = referencia a parámetro
C1 mid OUT {C}
.ends Filtro

* Instanciación con override:
X_filtro1 VIN VOUT Filtro PARAMS: R=4.7K C=22n
```

### ParamContext en Rust

```rust
struct ParamContext {
    values: HashMap<String, f64>,
}

impl ParamContext {
    /// Evaluar una expresión SPICE con parámetros y operaciones básicas
    /// Soporta: {R*2}, {C/3}, {R+100}, referencias simples {R}
    fn evaluate(&self, expr: &str) -> Result<f64, ParseError> {
        let stripped = expr.trim_matches(|c| c == '{' || c == '}');
        // 1. Si es número literal → parse directo
        // 2. Si es nombre de parámetro → lookup en self.values
        // 3. Expresión aritmética → evaluador recursivo simple
        //    (solo +, -, *, /, constantes y parámetros)
    }
}
```

### Resolución de Herencia

```
Prioridad (mayor a menor):
  1. PARAMS en la línea de instanciación (X...) → sobreescribe todo
  2. PARAMS en el .subckt (valores por defecto)
  3. Variables del contexto padre

Implementación:
  ParamContext::merge(parent, subckt_defaults, instance_overrides)
  → aplicar capas en orden: base → defaults → overrides
```

---

## Formato de Salida: `ComponentData` para el Solver MNA

```rust
/// Componente aplanado listo para estampado en la matriz MNA
#[derive(Debug, Clone, Serialize)]
pub enum ComponentData {
    Resistor   { id: String, n_pos: String, n_neg: String, value: f64 },
    Capacitor  { id: String, n_pos: String, n_neg: String, value: f64 },
    Inductor   { id: String, n_pos: String, n_neg: String, value: f64 },
    VSource    { id: String, n_pos: String, n_neg: String, dc: f64 },
    ISource    { id: String, n_pos: String, n_neg: String, dc: f64 },
    VCVS       { id: String, n_out_pos: String, n_out_neg: String,
                             n_in_pos:  String, n_in_neg:  String, gain: f64 },
    VCCS       { id: String, n_out_pos: String, n_out_neg: String,
                             n_in_pos:  String, n_in_neg:  String, gm: f64 },
}
```

El solver MNA itera sobre `Vec<ComponentData>` y estampa cada elemento en la matriz conductancia G y el vector de excitación b según la ecuación `G·x = b`.

---

## Archivos de Referencia

- `examples/subcircuit_expander.rs` — Módulo Rust completo: tokenizer, expansión jerárquica, resolución de PARAMS, salida `Vec<ComponentData>`
