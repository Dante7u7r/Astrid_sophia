---
name: circuit-sim-ux
description: Diseño e implementación de UX de nivel profesional para simuladores de circuitos electrónicos (schematic capture + simulation), con LTspice, KiCad y Multisim como benchmark duro. Cubre cuatro dominios — interacción de canvas/esquemático (pan, zoom, snap-to-grid, wiring y net detection), feedback visual de simulación (probes, color-coding de voltaje/corriente, animación de flujo de corriente), inspector de propiedades de componentes, y selección con undo/redo y atajos de teclado estilo EDA. Usar SIEMPRE que el usuario trabaje en UI/UX de un simulador de circuitos, editor esquemático, EDA tool, o pida mejorar la "sensación" de interacción de una app de electrónica — incluso sin mencionar "UX" explícitamente, p. ej. "el wiring se siente raro", "snap to grid", "quiero que se vea como LTspice", "cómo muestro la corriente fluyendo". Incluye implementaciones de referencia completas en React + TypeScript (compatibles con Tauri/Electron) listas para adaptar, no solo heurísticas.
---

# Circuit Simulator UX

Skill para construir UX de simulador de circuitos a la altura de las herramientas EDA establecidas (LTspice, KiCad, Multisim) — no una aproximación genérica de "drag and drop nodes app", sino los patrones de interacción específicos que un ingeniero electrónico espera de software de captura esquemática y simulación.

## Por qué existe esta skill

Las apps de canvas genéricas (Figma-like, flowchart builders, node editors tipo React Flow sin modificar) **no** cumplen las expectativas de un usuario que viene de LTspice o KiCad. Las diferencias no son estéticas, son de modelo mental: en un editor de circuitos, una conexión no es una "flecha entre cajas", es un **net** con semántica eléctrica (un nodo de voltaje compartido); el grid no es decorativo, es la unidad de snap que define si dos pines están eléctricamente unidos o no; y el feedback visual durante simulación no es "una animación bonita", es la forma primaria en que el usuario verifica que el circuito hace lo que debería antes de confiar en los números.

Cada uno de los cuatro dominios de abajo tiene su propio reference doc con principios, anti-patrones, y código de referencia. Lee solo el que necesites — no cargues los cuatro si la tarea es sobre uno.

## Los cuatro dominios

| Dominio | Cuándo leer | Archivo |
|---|---|---|
| **Canvas & Wiring** — pan, zoom, snap-to-grid, ruteo de cables, detección de nets, rotación de componentes | El usuario trabaja en el área de dibujo del esquemático: cómo se mueve la cámara, cómo se colocan/rotan componentes, cómo se dibujan y detectan conexiones eléctricas | `references/canvas-wiring.md` |
| **Simulation Feedback** — probes, color-coding de voltaje/corriente, animación de flujo de corriente, indicadores de estado de simulación | El usuario quiere mostrar resultados de la simulación visualmente: voltajes en colores, corriente animada, probes interactivos, estados de error/convergencia | `references/simulation-feedback.md` |
| **Component Inspector** — panel de propiedades, edición de parámetros (R, C, L, fuentes), validación en tiempo real, units handling | El usuario trabaja en el panel lateral/inspector donde se editan valores de componentes (resistencia, capacitancia, etc.) | `references/component-inspector.md` |
| **Selection, Undo/Redo & Shortcuts** — multi-selección, rubber-band select, historial de comandos, atajos de teclado estilo EDA | El usuario trabaja en cómo se seleccionan elementos, cómo funciona deshacer/rehacer, o qué atajos de teclado debe tener la app | `references/selection-history-shortcuts.md` |

**Regla de carga**: lee solo los reference docs relevantes a la tarea actual. Si la tarea toca dos dominios (p. ej. "selecciono un componente y quiero ver sus probes resaltados"), lee ambos. Si es ambigua o de alcance amplio ("mejora el UX general"), lee los cuatro pero resume en vez de citar completos.

## Benchmark de referencia (aplica a los 4 dominios)

Esta skill usa tres herramientas EDA establecidas como vara de medir, cada una con una fortaleza distinta que vale la pena imitar selectivamente — no copiar en bloque:

- **LTspice**: economía visual brutal. Cero decoración, máxima densidad de información. El estándar para feedback de simulación (waveform viewer, color de voltaje) y para teclado-primero (casi todo tiene atajo).
- **KiCad (Eeschema)**: el estándar moderno para wiring semántico — net highlighting, ERC (electrical rules check) visual, manejo de jerarquía de hojas. Su modelo de "todo es un net con nombre" es el que esta skill recomienda como base de datos del circuito.
- **NI Multisim**: el estándar para feedback en tiempo real orientado a pedagogía — instrumentos virtuales interactivos, animación de corriente, multímetros/osciloscopios in-canvas. Útil quien construye para usuarios que aprenden electrónica, no solo para ingenieros expertos.

Donde estas tres herramientas difieren entre sí, cada reference doc explica el trade-off y da una recomendación — no asume que "más cerca de LTspice" es automáticamente mejor si el público de la app es distinto (p. ej. estudiantes vs. ingenieros de diseño analógico).

## Cómo usar el código de referencia

Los 9 archivos en `assets/components/` están escritos específicamente para Astryd Sophia — no son stubs genéricos. Antes de usar cualquiera, lee el reference doc de su dominio para entender el principio que implementa; copiar el código sin ese contexto produce adaptaciones que funcionan de casualidad o que reproducen exactamente los anti-patrones que el doc advierte.

**Mapa de archivos → dominio:**

| Archivo | Dominio | Notas de integración |
|---|---|---|
| `net-graph.ts` | Canvas & Wiring | Exporta `GRID_STEP_PX = 20` — usar como fuente única en vez de repetir `20` en `canvas_orchestrator.ts`. Tipos `PinRef`/`NetWireRef` son vistas derivadas de tus `ComponentInstance`/`WireInstance`, no reemplazan tu estado real. |
| `wire-router.ts` | Canvas & Wiring | Sin dependencias externas. Routing ortogonal puro. |
| `transient-stream.ts` | Simulation Feedback | **Depende de `@tauri-apps/api/event`** — no usable fuera de contexto Tauri. Gestiona el ciclo de vida del listener de `sim-frame-update`, incluyendo la limpieza (`dispose()`) que SIEMPRE debe llamarse al desmontar. Exporta también `currentForWire(wireId, frame)`. |
| `simulation-error.ts` | Simulation Feedback | Clasifica `Result<T,String>` de Rust a un tipo estructurado con mensaje en español y extracción best-effort del id de componente/net problemático. Actualizar los patrones si cambias los mensajes de error en `mna_solver.rs`/`engine.rs`. |
| `voltage-color-scale.ts` | Simulation Feedback | Importa `SimulationFrame` de `transient-stream.ts` y `NetId` de `net-graph.ts`. `colorForNet(netId, frame, range)` es la función principal — no uses `voltageToColor` directamente desde el render sin pasar por `getVoltageKey` primero, o el NetId y la key del frame van a diferir. |
| `current-flow-animation.tsx` | Simulation Feedback | Componente React puro de presentación. Recibe `currentAmps: number` ya extraído — el caller usa `currentForWire` de `transient-stream.ts`. No importa Tauri, reutilizable también para DC. |
| `spice-value-parser.ts` | Component Inspector | Sin dependencias externas. Incluye `runSpiceParserSelfTests()` — moverla a tu suite de tests real (vitest/jest) antes de modificar el parser. La lógica M-vs-Meg es el caso crítico. |
| `command-history.ts` | Selection & Undo/Redo | Sin dependencias externas. `ComponentStore` es un adaptador genérico — implementarlo como delgado wrapper sobre tu estado real de `canvas_orchestrator.ts`. |
| `INTEGRATION-EXAMPLE.tsx` | Todos | Ejemplo que conecta los 8 módulos anteriores con la arquitectura real de Astryd Sophia: streaming transitorio, `Result<T,String>`, naming de NetId/WireId. No copiar como componente de producción — leer como referencia de cómo los módulos se conectan entre sí. |

