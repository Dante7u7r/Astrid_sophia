# Simulation Feedback

Cómo se comunica visualmente el resultado de la simulación: probes, color-coding de voltaje/corriente, animación de flujo de corriente, y estados de error/convergencia.

## El problema que resuelve este dominio

El usuario no confía en un número que no puede verificar de un vistazo. Si tu simulador solo muestra "V(out) = 3.7V" en una tabla, el usuario tiene que ir nodo por nodo comparando contra lo que esperaba. Si en cambio el circuito completo se colorea por voltaje en tiempo real, el usuario detecta "algo está mal" en milisegundos — antes de leer un solo número. Ese es el valor que aporta este dominio, y es la razón por la que LTspice, KiCad (con su simulador) y Multisim invierten tanto en esto.

## Arquitectura de datos: SimulationFrame, no un mock genérico

Todo lo de este documento asume el contrato de datos real de Astryd Sophia, no una estructura genérica inventada. El backend Rust emite eventos `sim-frame-update` con un payload `SimulationFrame`:

```rust
pub struct SimulationFrame {
    pub time: f64,
    pub node_voltages: HashMap<String, f64>,
    pub branch_currents: HashMap<String, f64>,
    pub frame_index: u64,
    pub is_final: bool,
}
```

Tras serializar a JSON, esto llega al lado TS como `Record<string, number>` para ambos mapas, no como un `Map` — JSON no tiene tipo Map nativo, y el código de referencia (`assets/components/transient-stream.ts`) refleja eso explícitamente.

Dos decisiones de convención de naming que **todo el resto de este documento da por sentadas**:

- **`node_voltages`** usa como key el **NetId** (ej. `"N$1"`, `"VCC"`) — el mismo string que produce `NetGraph.snapshot()` o `NetGraph.getVoltageKey(pinId)` en `net-graph.ts`. Esto significa que tu `mna_solver.rs` necesita nombrar sus nodos con esos mismos strings al ensamblar la matriz, o el lado TS hará lookups que devuelven `undefined` silenciosamente (ver anti-patrón abajo).
- **`branch_currents`** usa como key el **WireId** — porque la corriente es propiedad de la rama (el wire), no del nodo. Ver sección "Probes interactivos" más abajo para la justificación conceptual completa de esta distinción.

El listener del evento, gestión del ciclo de vida del stream (`idle`/`running`/`stopped`/`error`), y la limpieza obligatoria con `dispose()` viven en `assets/components/transient-stream.ts` — léelo antes de escribir tu propio listener de `sim-frame-update`, porque ya resuelve el caso de "el listener sigue vivo recibiendo frames de una simulación que el usuario cree detenida" que es fácil de introducir por accidente.

## Color-coding de voltaje: la convención de facto

LTspice usa una escala de color para voltajes en su modo de schematic durante simulación (no en el waveform viewer, sino superpuesto en el esquemático). La convención más extendida y la que el usuario espera:

- **Rojo/naranja** = voltaje alto positivo
- **Azul** = voltaje bajo / negativo
- **Verde o gris neutro** = cerca de 0V o GND
- **Escala continua**, no buckets discretos — un nodo a 4.9V debe verse visualmente distinto de uno a 5.0V si el usuario hace zoom en la escala, aunque a primera vista ambos "se vean rojos".

Implementación recomendada: mapeo HSL donde el **hue** rota de azul (240°) a rojo (0°) según el voltaje normalizado al rango de la simulación (no a un rango fijo arbitrario — si tu circuito opera en rango -15V a +15V, normaliza a eso, no a un rango fijo 0-5V que aplastaría toda la información útil a un solo color). Ver `assets/components/voltage-color-scale.ts` — la función `colorForNet(netId, frame, range)` resuelve directamente desde un `SimulationFrame` real, incluyendo el caso de net sin dato todavía (cae a color neutro en vez de lanzar).

**Decisión de diseño que debes tomar explícitamente**: ¿la escala de color se recalcula dinámicamente por rango actual del circuito, o es fija (ej. siempre -5V a +5V)? Dinámica da más resolución visual pero hace que el mismo nodo cambie de color entre dos simulaciones distintas, lo cual puede confundir a un usuario que compara visualmente dos runs. LTspice usa rango fijo configurable por el usuario; es la opción más predecible y la recomendamos como default, con opción de "auto-range" para quien lo prefiera.

## Animación de flujo de corriente

Este es el área donde Multisim es la referencia más fuerte — sus instrumentos virtuales y la animación de corriente fluyendo por los wires son extremadamente legibles, particularmente para audiencias educativas.

Patrón estándar: partículas (dots) que se mueven a lo largo del path del wire, con:
- **Velocidad de partícula proporcional a la magnitud de corriente** (no constante) — esto comunica intuitivamente "mucha corriente aquí" vs "casi nada" sin que el usuario tenga que leer un número.
- **Dirección de movimiento = dirección real de flujo** (convención de corriente convencional, positivo a negativo) — si tu motor de simulación da corriente con signo, el signo determina la dirección de la animación, no asumas siempre positivo.
- **Densidad/tamaño de partícula opcionalmente proporcional también a magnitud**, pero cuidado: combinar velocidad Y densidad Y tamaño todos proporcionales a la misma variable es ruido visual. Elige uno como variable primaria (recomendado: velocidad) y dejas los otros constantes o como ayuda secundaria sutil.
- Corriente ~0 (por debajo de un umbral, no exactamente cero por ruido numérico) = sin partículas o partículas estáticas, no partículas moviéndose a velocidad imperceptible (eso se lee como "lag" o bug, no como "poca corriente").

Ver implementación completa en `assets/components/current-flow-animation.tsx` — usa requestAnimationFrame con interpolación a lo largo del path del wire (reutiliza los `points` del wire ortogonal del dominio anterior), no CSS animations (necesitas control de velocidad por wire individual basado en datos de simulación, que cambia run a run). El componente recibe `currentAmps` ya extraído — el caller lo obtiene con `currentForWire(wireId, latestFrame)` de `transient-stream.ts`, que indexa `branch_currents` por WireId y devuelve 0 (no `undefined`) si el wire aún no tiene dato, ya que el componente ya trata 0A como "no animar".

## Probes interactivos

Tres niveles de interacción que el usuario espera, en orden de profesionalismo creciente:

1. **Hover sobre un net** → tooltip con voltaje instantáneo (o en el punto de tiempo actual si es transient analysis con scrubbing).
2. **Click para "fijar" un probe** → el voltaje de ese net queda anclado visualmente (badge persistente con el valor) y típicamente también se añade como traza al waveform viewer si tu app tiene uno.
3. **Probe de corriente** (distinto del de voltaje) → se coloca sobre un wire, no sobre un nodo, porque corriente es una propiedad de la rama (branch), no del nodo. Esta distinción conceptual (voltaje = propiedad de nodo, corriente = propiedad de rama) debe reflejarse en la UI: un click en un pin/net ofrece probe de voltaje, un click en un segmento de wire ofrece probe de corriente — no mezcles ambos en el mismo gesto o confundes el modelo eléctrico subyacente.

## Estados de simulación: no solo "corriendo / parado"

El usuario necesita saber en qué fase está la simulación, especialmente porque el solver puede fallar de formas específicas que merecen feedback específico, no un error genérico:

- **Idle** — sin simular, esquemático en modo edición normal.
- **Running** — indicador claro (no solo un spinner genérico; considera mostrar progreso si es transient analysis con muchos timesteps).
- **Converged / Done** — resultado disponible, esquemático coloreado.
- **Convergence failure** — esto es distinto de un error de sintaxis o de un crash. El solver de Newton-Raphson (típico en MNA no-lineal) puede no converger por razones específicas del circuito (ej. nodo flotante, lazo de fuentes de voltaje en conflicto). El feedback debe, en la medida de lo posible, **señalar el nodo o componente problemático visualmente** (highlight en el esquemático), no solo mostrar un mensaje de texto genérico tipo "simulation failed". LTspice hace esto razonablemente bien señalando el último punto de operación calculado; es el estándar a igualar.

  En Astryd Sophia, los comandos Tauri retornan `Result<T, String>` — el string de error es texto libre que Rust genera (probablemente vía `format!()` en `mna_solver.rs`/`engine.rs`). `assets/components/simulation-error.ts` clasifica ese string por patrón (singular matrix, max iterations, convergencia genérica, circuito inválido) hacia un tipo estructurado con mensaje en español apto para usuario, y best-effort extrae un id de componente/net si Rust lo interpoló en el mensaje. Esto es un clasificador por substring, no robusto a cambios de texto en Rust — si reescribes los mensajes de error en el backend, actualiza los patrones en el mismo cambio. La alternativa más robusta a largo plazo es que el backend serialice un enum de error (con `thiserror`+`serde`) en vez de `String` plano; vale la pena si el clasificador por texto empieza a fallar seguido.
- **DC operating point vs. transient vs. AC sweep** — cada modo de análisis tiene su propio tipo de feedback visual esperado (DC = colores estáticos, transient = colores que cambian con scrubbing de tiempo + animación de corriente, AC = típicamente solo waveform/bode plot, el coloreado de esquemático tiene menos sentido aquí porque no hay "un" voltaje sino una respuesta en frecuencia).

## Anti-patrones específicos de este dominio

- **Desajuste de naming entre `NetGraph` (TS) y el nombrado de nodos del MNA solver (Rust)** — si `NetGraph.snapshot()` produce `"N$3"` para un net pero `mna_solver.rs` nombra ese mismo nodo internamente con un índice numérico de matriz (`"2"`, o ninguno en absoluto si solo trabaja con índices sin string), el lookup `frame.node_voltages["N$3"]` da `undefined` para *todo* el circuito, no para un caso esquina. Esto no falla ruidosamente — `colorForNet` cae a color neutro y el usuario ve un esquemático sin colorear sin ningún error visible, indistinguible de "la simulación no ha corrido todavía". Si ves esto pasar, lo primero a verificar es que el backend reciba o derive los mismos NetId que produce el frontend, no que el frontend esté mal — el contrato de naming debe fijarse en un solo lugar (ver nota en `transient-stream.ts`) y ambos lados deben respetarlo.
- **Recalcular el color de cada nodo en cada frame sin memoization** cuando el dato de simulación no ha cambiado — esto es un desperdicio de rendimiento fácil de evitar; el color solo debe recomputarse cuando cambia el resultado de simulación o el timestep actual (en transient), no en cada render de React por cambios no relacionados (ej. el usuario solo movió el mouse).
- **Animación de corriente que no se detiene cuando la simulación termina o se detiene** — partículas zombie moviéndose sobre un circuito que ya no está siendo simulado comunican información falsa.
- **Mezclar la escala de color de voltaje con el color de selección/hover del componente** — si seleccionar un componente lo pone azul y -5V también es azul, el usuario no puede distinguir "está seleccionado" de "está a bajo voltaje". Usa canales visuales distintos: color de fondo/fill para voltaje, outline/stroke distintivo para selección (ver también el doc de selection).
- **Mostrar 6 decimales de precisión en el tooltip de probe** cuando el solver tiene tolerancia de convergencia mucho menor — esto comunica falsa precisión. Trunca a una cantidad de dígitos significativos consistente con la tolerancia real de tu solver (típicamente 3-4 cifras significativas es lo honesto para un MNA solver con tolerancia estándar de 1e-6 a 1e-9 relativa, dependiendo de cómo definas y reportes el error).
