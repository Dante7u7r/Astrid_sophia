# Selection, Undo/Redo & Shortcuts

Multi-selección, rubber-band select, historial de comandos (undo/redo), y atajos de teclado estilo EDA.

## Selección: lo que el usuario espera por instinto

- **Click simple** sobre un componente → selecciona solo ese, deselecciona el resto.
- **Click sobre área vacía** → deselecciona todo.
- **Shift+click** sobre un componente → añade a la selección actual (toggle: si ya estaba seleccionado, lo quita).
- **Click+drag sobre área vacía** → rubber-band select (rectángulo de selección). Convención EDA específica que difiere de muchos editores genéricos: **arrastrar de izquierda a derecha selecciona solo lo que está completamente dentro del rectángulo**; **arrastrar de derecha a izquierda selecciona todo lo que el rectángulo toca aunque sea parcialmente**. Esto es estándar en AutoCAD y heredado por la mayoría de herramientas EDA (KiCad lo respeta) — no es arbitrario, es una convención que usuarios de CAD/EDA usan activamente para controlar selección de wires parcialmente visibles vs. componentes completos. Si tu público no viene de ese mundo, está bien simplificar a un solo comportamiento, pero documenta la decisión porque un usuario EDA experimentado notará la ausencia.
- **Selección de wire vs. selección de componente vs. selección de pin individual** son conceptualmente distintas (ver doc de inspector sobre por qué corriente es propiedad de rama y voltaje de nodo) — el click debe tener suficiente precisión de hit-testing para distinguir "hice click en el wire" de "hice click en el componente al que está conectado", especialmente cuando están visualmente cerca a zoom bajo.

## Undo/Redo: arquitectura, no solo atajo de teclado

La implementación correcta es el **patrón Command**: cada acción del usuario (mover componente, rotar, borrar, editar valor, dibujar wire) se representa como un objeto con `execute()` y `undo()`, y se apila en una pila de historial. Esto es lo que separa una undo/redo robusta de una que falla en casos esquina:

- **Nunca implementes undo como "snapshot completo del estado antes/después"** para un circuito de tamaño no-trivial — es ineficiente en memoria y, más importante, pierde granularidad: si el usuario mueve un componente y luego edita su valor, quiere poder deshacer la edición de valor sin deshacer también el movimiento, si fueron acciones separadas. El patrón Command captura esto naturalmente porque cada acción es su propia entrada en el historial.
- **Agrupa acciones continuas en una sola entrada de historial**: arrastrar un componente genera muchos eventos de movimiento (uno por frame), pero debe producir **una sola** entrada de undo (la posición inicial vs. la posición final al soltar el mouse), no cientos de micro-entradas. Esto se logra iniciando el "command" al `mousedown`/drag-start y finalizándolo (con el delta acumulado) al `mouseup`/drag-end.
- **Operaciones batch sobre selección múltiple** (mover 5 componentes seleccionados a la vez) deben ser **una sola entrada de historial**, no 5 — el usuario percibe "moví estas 5 cosas" como una acción, y deshacerla debe revertir las 5 de un solo Ctrl+Z.
- **Límite de historial**: razonable mantener algo como 100-500 entradas con descarte de las más antiguas — un circuito grande con sesiones largas puede generar miles de acciones, y mantener referencias indefinidamente es un memory leak silencioso si cada Command referencia datos de componentes pesados.

Ver implementación completa del patrón Command + historial en `assets/components/command-history.ts`.

## Atajos de teclado: el set mínimo no-negociable

Estos son atajos que un usuario que migra de LTspice/KiCad/Multisim **asume que existen** sin tener que ir a buscarlos en un menú. No tenerlos no es "una opción de diseño legítima", es una ausencia que se nota inmediatamente:

| Acción | Atajo estándar | Nota |
|---|---|---|
| Deshacer | `Ctrl/Cmd+Z` | — |
| Rehacer | `Ctrl/Cmd+Shift+Z` o `Ctrl+Y` | Ambos coexisten en el ecosistema; soportar los dos no cuesta nada |
| Copiar / Pegar | `Ctrl/Cmd+C` / `Ctrl/Cmd+V` | Pegar debe colocar el componente en la posición del cursor o con offset visible, nunca exactamente encima del original (invisible para el usuario) |
| Borrar | `Delete` / `Backspace` | Ambos — distintos teclados/SOs favorecen uno u otro |
| Rotar | `R` | Ver convención de sentido en el doc de canvas-wiring |
| Seleccionar todo | `Ctrl/Cmd+A` | — |
| Zoom to fit / Zoom a selección | `F` (fit all) | Convención KiCad; muy usado para "perdí dónde está mi circuito" |
| Iniciar simulación | `F5` o similar | Varía por herramienta, pero debe ser un solo atajo de un toque, no un submenú |
| Wire/dibujar cable | `W` | Convención KiCad |
| Cancelar acción en curso (ej. wire a medio dibujar) | `Esc` | Crítico — sin esto el usuario queda "atascado" en modo wiring sin saber cómo salir |
| Pan temporal | `Space` (hold) + drag | Ya mencionado en canvas-wiring, repetido aquí por completitud del set de atajos |

No necesitas implementar los 40+ atajos de KiCad de golpe, pero este subconjunto (deshacer/rehacer, copiar/pegar, borrar, rotar, escape) es lo mínimo que, si falta, un usuario técnico reporta como "se siente incompleto" en los primeros 5 minutos de uso.

## Anti-patrones específicos de este dominio

- **Confirmación modal para cada borrado** ("¿Seguro que quieres borrar este componente?") — esto es lo opuesto de lo que un sistema de undo/redo robusto debe ofrecer. Si undo es confiable, el usuario no necesita protección de confirmación; el "seguro" reside en poder deshacer, no en preguntar antes. Reservar confirmaciones modales para acciones genuinamente destructivas e irreversibles (ej. cerrar el proyecto sin guardar), no para operaciones normales de edición.
- **Atajos de teclado que cambian según el contexto sin indicación visual** — si `Delete` borra un componente en un contexto pero en otro (ej. mientras se edita texto en el inspector) borra un carácter, asegúrate de que el foco esté claramente indicado visualmente, o el usuario borrará accidentalmente el componente equivocado mientras creía estar editando texto.
- **Rubber-band select que también arrastra el componente bajo el cursor inicial** si el usuario empieza el drag sobre un componente en vez de área vacía — esto debe iniciar un *move* del componente, no una selección rectangular; la distinción de qué gesto inicia cuál acción depende de si el `mousedown` inicial cae sobre un elemento o sobre canvas vacío, chequeo que debe hacerse en el momento del `mousedown`, no inferirse después.
- **Pila de undo que no se limpia al cargar un nuevo proyecto** — un bug sorprendentemente común: el usuario abre un archivo distinto y el historial de undo del proyecto anterior sigue disponible, permitiendo "deshacer" hacia un estado de un circuito completamente distinto. El historial debe resetearse explícitamente en cualquier operación de "cargar/abrir proyecto".
