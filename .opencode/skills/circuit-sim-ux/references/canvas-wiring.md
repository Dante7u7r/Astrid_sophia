# Canvas & Wiring

Interacción con el área de dibujo: cámara (pan/zoom), colocación de componentes, snap-to-grid, y el corazón del problema — ruteo de cables y detección de nets.

## El error de modelo mental más común

Quien construye esto viniendo de un canvas genérico (Figma, flowchart tool, React Flow vanilla) trata una conexión como **una línea entre dos puntos**. Eso es insuficiente para un simulador de circuitos.

En electrónica, una conexión define un **net**: un conjunto de pines que comparten el mismo nodo de voltaje. Tres cables que se tocan en un punto no son "tres líneas", son **un net con tres miembros**. Esto importa porque:

1. El motor de simulación (tu MNA solver) opera sobre nets, no sobre wires individuales — necesita saber "estos 5 pines son el mismo nodo", no "hay 4 segmentos de línea dibujados".
2. El feedback visual (siguiente doc) colorea **nets enteros** por voltaje, no segmentos de cable individuales.
3. Detectar "¿estos dos pines están conectados?" debe ser una consulta sobre la estructura de nets, no un raycast geométrico sobre líneas en cada frame.

**Regla de oro**: el modelo de datos de wiring nunca debe ser una lista de `{x1,y1,x2,y2}`. Debe ser un grafo donde los nodos son pines y nets, y las líneas dibujadas son la *representación visual* de ese grafo, no la fuente de verdad.

## Snap-to-grid: por qué no es estético

El grid en LTspice/KiCad no es una ayuda visual opcional — es la unidad atómica de conectividad. Dos pines están eléctricamente unidos **si y solo si** sus coordenadas de grid coinciden exactamente. Esto tiene una consecuencia de diseño que sorprende a quien viene de canvas libres: **no debe existir un modo "sin grid"** en el área de wiring, aunque sí puede existir zoom continuo. El grid define la resolución de conexión, el zoom solo cambia cuánto grid cabe en pantalla.

Astryd Sophia ya fija esto en 20px a zoom 100% (`GRID_STEP_PX` en `assets/components/net-graph.ts`, debe ser la misma constante que usa `screenToWorld`/`worldToScreen` en `canvas_orchestrator.ts` — mantenla en un solo lugar en vez de repetir "20" en ambos archivos). Sub-grid de la mitad (10px) para pines de medio paso, si tu catálogo de componentes los tiene, es razonable encima de esa base sin cambiar la constante principal.

Snap debe aplicarse en dos momentos distintos con tolerancias distintas:
- **Al colocar un componente**: snap fuerte, el componente entero se mueve en saltos de grid completo.
- **Al dibujar un wire cerca de un pin existente**: snap con radio de captura mayor al grid mismo (~8-12px adicionales), para que el usuario no tenga que apuntar con precisión de píxel — esto es lo que hace que "se sienta bien" vs. "se siente tieso".

## Pan & zoom: convenciones que el usuario ya espera

No reinventes esto — el usuario que llega de cualquier EDA tool ya tiene músculo entrenado:

- **Scroll wheel = zoom**, centrado en el cursor (no en el centro del viewport — esto es el error más común y el más molesto en la práctica).
- **Click central / Space+drag = pan**. Algunas herramientas (KiCad) usan click derecho para pan; soportar ambos no cuesta nada.
- **Ctrl/Cmd + scroll** a veces se reserva para zoom fino o para otra acción (rotación en algunas apps) — documenta tu elección, no la dejes implícita.
- Zoom debe tener límites razonables pero generosos: el usuario hace zoom-in extremo para conectar pines muy juntos en componentes densos (ICs), y zoom-out extremo para ver el circuito completo. No limites a "2x-200%", usa rangos como 10%-3000%.

## Rotación y flip de componentes

Estándar de facto: **R** rota 90° (algunas apps incrementan en sentido horario, otras antihorario — KiCad usa antihorario con R), **X**/**Y** o **flip horizontal/vertical** para espejar. La rotación debe pivotear sobre el centro del bounding box del componente, no sobre su origen de inserción, o el usuario pierde la posición tras rotar.

## Net detection: el algoritmo

Cuando el usuario dibuja un wire o mueve un componente, necesitas recalcular qué pines pertenecen a qué net. El enfoque correcto es **union-find (disjoint set)** sobre el grafo de pines+wires — es O(α(n)) amortizado por operación, trivial de implementar, y es exactamente lo que KiCad usa internamente para "ratsnest" y net naming.

Ver implementación completa en `assets/components/net-graph.ts` — incluye:
- Estructura `NetGraph` con union-find, usando los tipos `PinRef`/`NetWireRef` (vistas derivadas de tu `ComponentInstance`/`WireInstance` reales — `NetGraph` no reemplaza tu estado del canvas orchestrator, vive al lado)
- Detección de unión automática cuando dos wires comparten endpoint o cuando un wire endpoint cae sobre un pin
- `rebuildFromScratch(pins, wires)`: reconstruye el grafo completo desde cero a partir del estado actual de `components`/`wires`. Esto es deliberado, no una limitación — mantener union-find sincronizado incrementalmente contra mutaciones externas de estado (mover componente, borrar wire) es una fuente de bugs de desincronización mucho peor que el costo de reconstruir, que es O(n α(n)) y por tanto barato incluso para circuitos grandes. Llámalo en un `useEffect` que dependa de `[components, wires]` (ver `INTEGRATION-EXAMPLE.tsx`), no intentes parchear el grafo a mano en cada handler de edición.
- Naming de nets (automático tipo `N$1`, `N$2`, o heredando el nombre si el usuario etiquetó un net como `VCC` o `GND`) vía `snapshot()` o `getVoltageKey(pinId)` — este último es el puente directo hacia las keys de `SimulationFrame.node_voltages`, ver `references/simulation-feedback.md`.

## Wire routing: ortogonal vs. libre

- **LTspice/KiCad**: wires son estrictamente ortogonales (solo horizontal/vertical), con manhattan routing automático al conectar dos puntos no alineados. Esto es el estándar esperado por usuarios profesionales — un cable diagonal se ve "mal hecho" para este público.
- **Multisim**: permite más libertad pero por defecto también ortogonaliza.

**Recomendación**: implementa wire routing ortogonal por defecto (ver `assets/components/wire-router.ts` para el algoritmo de manhattan routing con detección de mejor ruta evitando solapar componentes). Si tu producto apunta a un público más casual/educativo donde la estética importa más que la convención EDA, considera routing libre como opción — pero no como default, porque rompe la expectativa del usuario que sabe lo que está haciendo.

## Feedback visual durante wiring activo (antes de soltar el click)

Esto es lo que más se nota cuando está mal hecho:

- **Mientras se arrastra un wire**: preview en tiempo real de la ruta ortogonal que resultará, no solo una línea recta de "donde estoy a donde voy".
- **Cuando el cursor está sobre un pin válido para conectar**: el pin debe resaltarse (cambio de color + posible halo/glow) *antes* de que el usuario suelte el click — esto es confirmación anticipada, reduce errores de conexión.
- **Cuando el wire resultaría en una conexión inválida** (p. ej. cortocircuito obvio, o conectar dos outputs entre sí si tu modelo lo prohíbe): feedback visual distinto (rojo, ícono de prohibido) antes de soltar, no un error modal después.
- **Highlight de net completo al hover**: pasar el mouse sobre cualquier wire o pin debe resaltar *todo el net* (todos los wires y pines conectados), no solo el segmento bajo el cursor. Esto es lo que en KiCad se llama "net highlighting" y es indispensable para debug visual de circuitos con muchas conexiones.

## Anti-patrones específicos de este dominio

- **Auto-routing agresivo que reubica wires existentes sin que el usuario lo pida.** Molesta más de lo que ayuda; el usuario quiere control sobre el layout.
- **Snap solo visual sin snap de datos** — el wire "se ve" pegado al pin en pantalla pero el net graph no registra la conexión porque hay un offset de 1px en las coordenadas. Esto produce el bug más frustrante posible: "dibujé el cable pero la simulación dice que no está conectado". Tu snap debe garantizar igualdad exacta de coordenadas en el modelo de datos, nunca aproximación visual.
- **Zoom que no preserva el punto bajo el cursor** — ya mencionado arriba, pero vale repetirlo porque es el bug de pulir-canvas más común.
- **Components que se pueden solapar sin ninguna señal visual** — no necesitas prohibir solapamiento (a veces es intencional, p. ej. un test point sobre un componente), pero un overlap accidental debería ser visualmente obvio (outline distinto, leve highlight) para que el usuario lo note.
