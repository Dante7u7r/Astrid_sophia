# Roadmap de estabilizacion: Tauri escritorio

## Alcance activo

La prioridad del proyecto es exclusivamente la aplicacion Tauri de escritorio.

- Plataforma objetivo inmediata: Windows 10/11 con WebView2.
- Ventana soportada: 900x600 o superior.
- Motor oficial: backend Rust mediante IPC de Tauri.
- Las pruebas funcionales deben ejecutarse sobre la ventana Tauri.
- El navegador puede usarse como herramienta auxiliar de inspeccion, pero sus
  resultados sinteticos no se consideran comportamiento oficial del producto.

## Alcance congelado

El navegador independiente y los layouts moviles quedan congelados hasta que
se complete la estabilizacion de escritorio.

- No se desarrollaran nuevas funciones para el modo web.
- No se corregiran mocks web salvo que bloqueen compilacion o pruebas comunes.
- No se optimizaran layouts por debajo de 900x600.
- No se ejecutaran auditorias moviles en cada fase.
- No se eliminara el codigo responsive existente; queda conservado como base
  para una fase futura.

Backlog futuro:

1. Revisar y definir si existira una edicion web real.
2. Sustituir resultados sinteticos por un servicio de simulacion verificable.
3. Recuperar y probar layouts tablet/movil.
4. Crear suites E2E separadas para web y dispositivos tactiles.

## Plan de escritorio

### Fase 1 - Integridad del esquema

Estado: completada el 2026-07-05.

- Generar identificadores globalmente unicos y estables.
- Evitar colisiones al borrar, duplicar, importar o cambiar identificadores.
- Validar IDs duplicados y cables colgantes antes de extraer la netlist.
- Agregar pruebas de regresion para familias que comparten prefijo.

Resultado:

- Generacion global por prefijo y sufijo maximo, sin reutilizar IDs eliminados.
- Familias compartidas (`M`, `Q`, `U`) coordinan la misma secuencia.
- Renombrado atomico de componentes y referencias de cables.
- Rechazo previo de IDs invalidos/duplicados, cables duplicados, componentes
  inexistentes y terminales inexistentes.
- Validacion automatizada y prueba manual en Tauri de escritorio.

### Fase 2 - Persistencia sin perdida

Estado: completada el 2026-07-05.

- Definir un esquema versionado para archivos `.astryd`.
- Guardar todas las propiedades electricas, visuales, MCU e instrumentos.
- Validar archivos antes de modificar el circuito activo.
- Incorporar migraciones y pruebas de ida y vuelta guardar/abrir.

Resultado:

- Esquema `.astryd` 3.0 con migracion validada desde archivos 2.0.
- Persistencia de propiedades electricas, visuales, firmware, cuatro sondas,
  puertos RF y configuracion del osciloscopio.
- Validacion completa antes de reemplazar el circuito activo.
- Escritura atomica en guardado directo y pruebas de ida y vuelta.

### Fase 3 - Analisis avanzados reales

Estado: implementada; queda pendiente repetir el cierre visual completo de PVT
despues del limite de pasos incorporado el 2026-07-05.

- Implementar y registrar IPC para PVT y parametros S, o retirarlos de la UI
  hasta que exista soporte real.
- Corregir el estado de ejecucion y cancelacion de ambos modos.
- Probar sus contratos TypeScript/Rust en la aplicacion Tauri.

Resultado tecnico:

- PVT ejecuta una matriz real en Rust con proceso, voltaje y temperatura.
- Parametros S ejecutan excitaciones multipuerto reales y exportan Touchstone.
- PVT usa paso fijo acotado, worker bloqueante separado y cancelacion.
- Touchstone de dos puertos usa el orden estandar `S11, S21, S12, S22`.

### Fase 4 - Ciclo de simulacion y pestanas

Estado: completada el 2026-07-05.

- Asociar cada ejecucion con una pestana y un identificador de corrida.
- Impedir que frames antiguos modifiquen otro circuito.
- Corregir concurrencia, cancelacion, errores IPC y limpieza de mutaciones.
- Conservar los cuatro canales, puertos RF y resultados por pestana.

Resultado:

- Cada transitorio recibe un `runId` monotono y el ID de su pestana propietaria.
- Rust descarta frames, finales, errores y cancelaciones de corridas obsoletas.
- Las mutaciones en caliente estan etiquetadas y solo las consume su corrida.
- Se bloquean crear, cambiar o cerrar la pestana activa mientras el solver corre.
- Cada pestana conserva cuatro sondas, voltajes, puertos RF, estado del
  osciloscopio y resultados transitorios, AC, PVT y parametros S.
- Validacion Tauri: un transitorio Rust conservo sus resultados al alternar
  pestanas; dos cambios durante una corrida fueron rechazados y, tras detenerla,
  el cambio se habilito correctamente.
- Verificacion: 80 pruebas frontend, 121 pruebas Rust, build TypeScript/Vite,
  `cargo fmt --check` y `cargo clippy -- -D warnings`.
### Fase 5 - Componentes e instrumentos

Estado: completada el 2026-07-06.

- Reparar el modo y valor inicial del multimetro.
- Auditar propiedades especiales de switches, sensores, transformadores,
  opamps, actuadores, subcircuitos y MCU.
- Verificar colocacion, edicion, duplicado, simulacion y restauracion.

Resultado:

- El multimetro conserva sus modos V/A/R, muestra `OPEN` cuando falta una
  conexion y usa modelos de entrada, shunt y corriente de prueba en la netlist.
- El DMM se actualiza tambien en DC; ya no depende de reproducir un transitorio.
- Switches y transformadores tienen editores dedicados y sus parametros llegan
  al solver. El transformador usa L1, L2 y acoplamiento `k`.
- Los actuadores usan modelos electricos explicitos; `Meg` ya no se interpreta
  erroneamente como el prefijo mili.
- La frecuencia configurada de cada MCU se respeta en el worker, fallback,
  depurador y reproduccion.
- El duplicado conserva propiedades especiales y copia el firmware sin
  compartir el mismo buffer mutable.
- La carga `.astryd` normaliza el DMM y valida parametros de switch y
  transformador antes de reemplazar el circuito.
- Validacion Tauri: arrastre de DMM, transformador e interruptor; cambio del DMM
  a ohmimetro; edicion de `k=0.75`; cambio visual de interruptor abierto/cerrado.
- Verificacion: 92 pruebas frontend, 121 pruebas Rust, build TypeScript/Vite,
  `cargo fmt --check` y `cargo clippy -- -D warnings`.

Limitacion conocida:

- El switch sigue siendo un modelo de dos terminales controlado por su propia
  tension e histeresis. No es aun el switch SPICE de cuatro terminales con
  entrada de control independiente.

### Fase 6 - UX y accesibilidad de escritorio

Estado: completada el 2026-07-06.

- Corregir desbordes en 900x600 y resoluciones de escritorio habituales.
- Completar nombres accesibles, foco, teclado y aislamiento de dialogos.
- Probar el centro de instrumentos sin interferir con el esquema.
- No incluir trabajo movil en esta fase.

Resultado:

- El menu de instrumentos usa semantica `menu/menuitem`, estados
  `aria-expanded`, apertura por teclado y cierre por Escape, Tab, click externo
  o seleccion de herramienta.
- El modal de ajustes aisla la aplicacion con `inert`, enfoca el primer campo al
  abrir, atrapa Tab, cierra con Escape/backdrop y devuelve el foco al control de
  origen.
- Los divisores de panel son `separator` accesibles, tienen valores ARIA y se
  pueden ajustar con flechas, Shift+flechas y Home.
- En escritorio compacto, 900x600, el centro de instrumentos apila instrumentos
  y logs para no invadir el esquema.
- Controles principales de cabecera, lienzo, zoom, rejilla, propiedades y
  osciloscopio tienen nombres accesibles.
- Validacion Tauri: ajustes con foco real y retorno de foco; centro de
  instrumentos abierto desde teclado; logs e instrumentos visibles sin tapar el
  esquema en ventana de escritorio.
- Verificacion: 97 pruebas frontend, 121 pruebas Rust, audit visual 1280x720 y
  900x600, build TypeScript/Vite, `cargo fmt --check`,
  `cargo clippy -- -D warnings` y `cargo test`.

Limitacion conocida:

- La edicion completamente no visual del esquema no esta resuelta. El lienzo ya
  tiene nombre y foco accesible, pero colocar, cablear y editar circuitos sigue
  siendo un flujo principalmente visual/canvas.

### Fase 7 - Entrega y mantenibilidad

Estado: completada el 2026-07-11.

- Generar instalador Windows NSIS o MSI y verificar instalacion limpia.
- Corregir identificador y metadatos del paquete.
- Separar responsabilidades excesivas de `main.ts` y del estado global.
- Incorporar E2E Tauri para los flujos criticos anteriores.

Resultado:

- El paquete Tauri ahora apunta a Windows NSIS, no a `deb`/`rpm`.
- El identificador final es `com.astrydsophia.desktop`; la ventana release usa
  el titulo `Astryd Sophia` y conserva el minimo soportado de 900x600.
- Se eliminaron placeholders de entrega en npm y Cargo: descripcion real y
  autor de proyecto en lugar de `A Tauri App` / `you`.
- Se genero el instalador:
  `src-tauri/target/release/bundle/nsis/Astryd Sophia_0.1.0_x64-setup.exe`.
- Se ejecuto instalacion limpia con NSIS; la app quedo instalada en
  `C:\Users\maruc\AppData\Local\Astryd Sophia\astryd-sophia.exe` y con acceso
  en el menu Inicio.
- Se valido visualmente la app instalada: ventana `Astryd Sophia`, identificador
  `com.astrydsophia.desktop`, lienzo, paneles laterales, barra superior y estado
  de conexion renderizados correctamente.
- `main.ts` redujo una responsabilidad directa: el cableado del menu de
  instrumentacion paso a `src/ui/instrumentation_menu.ts`, con parser ERC
  probado.
- Se agrego una prueba de guardia de entrega que falla si vuelven los targets
  Linux o metadatos placeholder.
- Verificacion: 101 pruebas frontend, 121 pruebas Rust, audit visual 1280x720 y
  900x600, build TypeScript/Vite, `cargo fmt --check`,
  `cargo clippy -- -D warnings`, `cargo test` y `npm run empaquetar`.

Limitacion conocida:

- La separacion de responsabilidades de `main.ts` empezo, pero no esta
  terminada. El archivo sigue siendo demasiado grande y debe dividirse despues
  en inicializacion de app, persistencia, simulacion y bindings de UI.
- No se agrego una suite E2E Tauri completa tipo CI/headless. La validacion de
  fase fue build release + instalacion NSIS + apertura visual de la app
  instalada.

### Fase 8 - Performance y fluidez de escritorio

Estado: primera optimizacion completada el 2026-07-11.

- Medir FPS real en la UI en vez de mostrar un valor fijo.
- Reducir trabajo repetido en render de canvas, osciloscopio e instrumentos.
- Disminuir coste de composicion visual en WebView2/Tauri.
- Validar el flujo en ventana Tauri real con demo y solver Rust.

Resultado:

- El indicador inferior ya no promete `60 FPS` fijos. Muestra FPS estimado
  cuando hay renders y `Reposo` cuando la UI esta quieta.
- Se agrego `PerformanceMonitor` para contar frames de canvas, frames de
  osciloscopio y actualizaciones DMM evitadas.
- Las lecturas del multimetro ya no se recalculan en cada render visual si no
  cambiaron componentes, cables, nodos o voltajes.
- El osciloscopio dejo de recalcular Vpp, Vrms y frecuencia en cada frame; ahora
  actualiza esas mediciones con throttle de 250 ms durante simulacion.
- El playback del osciloscopio cambio busqueda lineal por busqueda binaria para
  ubicar el frame de tiempo mas cercano.
- La alimentacion del analizador FFT ya no reconstruye arrays completos en cada
  frame si no hay resultados nuevos.
- Los renders de canvas derivados del playback se limitaron a un maximo cercano
  a 30 FPS para evitar saturar el hilo UI.
- La ventana Tauri dejo de ser transparente, reduciendo coste de composicion en
  Windows/WebView2.
- El blur global de vidrio bajo de `20px saturate(180%)` a `8px saturate(140%)`.
- Validacion Tauri: se cargo `01_divisor_rc.astryd`, se ejecuto simulacion DC
  con solver Rust y se verifico centro de instrumentos/logs en la ventana real.
- Verificacion: 102 pruebas frontend, 121 pruebas Rust, audit visual 1280x720 y
  900x600, build TypeScript/Vite, `cargo fmt --check`,
  `cargo clippy -- -D warnings` y `cargo test`.

Limitacion conocida:

- Esto reduce trabajo redundante, pero no sustituye un perfilado profundo con
  circuitos grandes. Queda pendiente medir escenarios pesados con muchos
  componentes, cables, puntos transitorios e instrumentos abiertos.
- `main.ts` todavia concentra demasiada logica de playback, simulacion y UI.
  Para optimizacion sostenida hay que seguir separando responsabilidades.

### Fase 9 - Benchmarks y render de circuitos grandes

Estado: completada el 2026-07-11.

- Crear escenarios pesados reproducibles para medir render de canvas.
- Agregar una auditoria automatizada de performance con presupuestos de render.
- Reducir coste asintotico del render en circuitos con muchos componentes y
  cables.
- Validar que las optimizaciones no rompen arrastre, zoom, instrumentos ni
  simulacion basica en Tauri.

Resultado:

- Se agrego `npm run audit:performance`, que compila en modo audit, levanta
  preview y mide renders pesados con Playwright.
- El modo `?perf=1` queda disponible solo en desarrollo/audit y expone un
  harness interno para crear circuitos de estres y medir renders. Produccion no
  expone esa API.
- Se agregaron escenarios reproducibles:
  - `stress-252`: 252 componentes y 238 cables.
  - `stress-480`: 480 componentes y 460 cables.
- Resultado medido despues de la optimizacion:
  - `stress-252`: mediana 2.90 ms, promedio 3.43 ms, maximo 8.60 ms.
  - `stress-480`: mediana 3.50 ms, promedio 5.87 ms, maximo 29.40 ms.
- `CanvasOrchestrator.render()` ahora crea mapas por frame para acceso O(1) a
  componentes por ID.
- Los pines de componentes se cachean por render, evitando recalcularlos varias
  veces para cables, pines y errores ERC.
- El render omite componentes fuera del viewport y evita dibujar cables cuya
  caja de trayectoria no intersecta el area visible.
- La seleccion multiple usa `Set` durante render, evitando busquedas lineales
  por componente visible.
- Validacion Tauri: se cargo `01_divisor_rc.astryd`, se ejecuto simulacion DC
  con solver Rust y se verificaron logs de voltajes correctos en la ventana real.
- Verificacion: 102 pruebas frontend, 121 pruebas Rust, audit visual 1280x720 y
  900x600, audit performance, build TypeScript/Vite, `cargo fmt --check`,
  `cargo clippy -- -D warnings` y `cargo test`.

Limitacion conocida:

- Esta fase mide render de canvas pesado, no todos los cuellos posibles. Queda
  pendiente perfilar transitorios largos con miles o millones de muestras,
  downsampling visual de resultados y memoria de historial por pestana.
- La prueba viva fue en Tauri dev. Para una certificacion de entrega se debe
  repetir con build release instalado despues del siguiente empaquetado.

### Fase 10 - Render incremental tipo juego

Estado: completada el 2026-07-11.

- Introducir LOD visual para que circuitos grandes no paguen siempre el coste de
  simbolos completos, etiquetas y pines.
- Cachear trabajo estable del canvas sin cambiar la arquitectura a WebGL.
- Ampliar la auditoria de performance a un escenario cercano a 1.000
  componentes.
- Mantener la fidelidad completa en componentes seleccionados o bajo el cursor.

Resultado:

- El render usa detalle compacto cuando el zoom es bajo o cuando hay muchos
  componentes visibles. En ese modo dibuja formas simplificadas de resistencias,
  fuentes, capacitores, inductores, tierra, MCU, placas y mediciones.
- Los componentes seleccionados o bajo hover siguen usando el simbolo completo,
  para que editar no se vuelva ambiguo.
- Los pines no activos se omiten en LOD compacto; los pines bajo hover o en
  operaciones de cableado siguen visibles.
- La cuadricula usa cache de `Path2D` por viewport/grid, evitando reconstruir
  todos los puntos cuando la vista no cambio.
- La auditoria `npm run audit:performance` ahora incluye:
  - `stress-252`: 252 componentes y 238 cables.
  - `stress-480`: 480 componentes y 460 cables.
  - `stress-960-lod`: 960 componentes y 930 cables a zoom bajo con LOD activo.
- Resultado medido despues de la fase:
  - `stress-252`: mediana 3.50 ms, promedio 4.16 ms, maximo 15.80 ms.
  - `stress-480`: mediana 4.50 ms, promedio 4.89 ms, maximo 8.20 ms.
  - `stress-960-lod`: mediana 5.30 ms, promedio 5.46 ms, maximo 14.70 ms.
- Verificacion automatizada: build TypeScript, 102 pruebas frontend, audit UI,
  audit performance, `cargo fmt --check`, `cargo clippy -- -D warnings` y
  `cargo test` con 121 pruebas Rust.

Limitacion conocida:

- Esto no convierte el editor en WebGL ni en un motor grafico completo. Sigue
  siendo Canvas 2D, con LOD y cache aplicados donde el riesgo es bajo.
- El render no esta separado todavia en multiples capas canvas persistentes
  (grid, cables, componentes, overlay). Esa seria la siguiente optimizacion si
  los perfiles reales muestran que el canvas sigue siendo el cuello.
- El LOD compacto oculta detalle fino a zoom bajo por diseno. Para edicion
  precisa se recupera el detalle al acercarse, seleccionar o pasar el cursor.

### Fase 11 - Modularizacion inicial de performance y playback

Estado: primera extraccion completada el 2026-07-11.

- Empezar a reducir responsabilidades de `main.ts` sin tocar todavia los flujos
  criticos de simulacion, persistencia o canvas input.
- Sacar helpers puros a modulos testeables.
- Mantener el harness de performance fuera del entrypoint principal.

Resultado:

- Se movio la llave de cache del DMM a `src/performance/dmm_render_cache.ts`.
- Se movio el harness `window.__ASTRYD_PERF__` a
  `src/performance/performance_harness.ts`.
- Se movio la busqueda binaria de playback y la regla de throttle visual a
  `src/app/playback_helpers.ts`.
- Se agregaron pruebas unitarias para cache DMM y playback.
- `main.ts` conserva la orquestacion, pero ya no contiene el generador de
  circuitos de estres ni los helpers puros de playback/cache.
- Verificacion: `npx tsc --noEmit`, 107 pruebas frontend y audit performance.
- Resultado de performance despues del refactor:
  - `stress-252`: mediana 2.40 ms, promedio 2.71 ms, maximo 8.20 ms.
  - `stress-480`: mediana 4.10 ms, promedio 4.38 ms, maximo 6.90 ms.
  - `stress-960-lod`: mediana 3.80 ms, promedio 3.99 ms, maximo 8.50 ms.

Limitacion conocida:

- Esta fase no completa la descomposicion de `main.ts`. Todavia quedan ahi
  persistencia, simulacion, inicializacion de UI, sidebars, instrumentos y
  bindings DOM.
- Aun no se separo `CanvasOrchestrator` en controlador de viewport, seleccion,
  cableado, hit-testing y renderer.
- El render por capas persistentes queda como fase posterior; conviene hacerlo
  despues de separar mejor canvas/render para no duplicar deuda.

### Fase 12 - Controlador de persistencia de escritorio

Estado: primera extraccion completada el 2026-07-11.

- Reducir mas responsabilidades de `main.ts` separando listeners de archivo,
  demos y guardado.
- Mantener en `main.ts` la aplicacion efectiva del archivo mientras siga
  dependiendo de simulacion, osciloscopio, probes y runtime.
- Agregar pruebas unitarias DOM para el flujo de persistencia sin depender de
  Tauri real.

Resultado:

- Se agrego `src/app/file_persistence_controller.ts`.
- El controlador conecta:
  - boton Nuevo;
  - selector de demos;
  - boton Abrir;
  - boton Guardar.
- `main.ts` ya no contiene el flujo completo de carga de demos ni apertura de
  archivos; solo inyecta callbacks de validacion, deserializacion, logs, Tauri y
  tabs.
- Se agrego `src/app/file_persistence_controller.test.ts` con cobertura de:
  - crear pestana nueva desde el boton;
  - cargar demo validada en pestana nueva;
  - abrir archivo en una pestana activa vacia.
- Verificacion: `npx tsc --noEmit`, 110 pruebas frontend y audit performance.
- Resultado de performance despues de esta extraccion:
  - `stress-252`: mediana 3.30 ms, promedio 3.82 ms, maximo 9.10 ms.
  - `stress-480`: mediana 4.40 ms, promedio 4.67 ms, maximo 8.30 ms.
  - `stress-960-lod`: mediana 3.70 ms, promedio 4.05 ms, maximo 7.70 ms.

Limitacion conocida:

- `serializeCircuit`, `validateCircuitFileForLoad` y `deserializeCircuit` siguen
  en `main.ts`. No es ideal, pero moverlos ahora requeriria arrastrar demasiado
  estado mutable de runtime. El siguiente paso sano es introducir un
  `CircuitDocumentController` con estado explicito.
- El controlador usa callbacks y DOM real; todavia no hay una abstraccion
  completa de comandos de escritorio.

### Fase 13 - Controlador de documento `.astryd`

Estado: primera extraccion completada el 2026-07-12.

- Sacar de `main.ts` la logica real de serializacion, validacion y aplicacion de
  archivos `.astryd`.
- Mantener wrappers minimos en `main.ts` para no tocar todavia `TabManager` ni
  el controlador de persistencia.
- Hacer explicitas las dependencias de documento: canvas, osciloscopio,
  ajustes, modo de simulacion, sondas, puertos S, estado electrico y renders.

Resultado:

- Se agrego `src/app/circuit_document_controller.ts`.
- `main.ts` ya no contiene el cuerpo de:
  - `serializeCircuit`;
  - `validateCircuitFileForLoad`;
  - `deserializeCircuit`.
- El tipo `ValidatedCircuitFile` vive ahora en el controlador de documento y es
  compartido por persistencia.
- Se agrego `src/app/circuit_document_controller.test.ts` con cobertura de:
  - serializacion del documento activo;
  - aplicacion de un archivo validado sobre canvas, osciloscopio, ajustes,
    sondas, puertos S y renders.
- Verificacion: `npx tsc --noEmit`, 112 pruebas frontend y audit performance.
- Resultado de performance despues de esta extraccion:
  - `stress-252`: mediana 3.20 ms, promedio 3.32 ms, maximo 7.30 ms.
  - `stress-480`: mediana 4.20 ms, promedio 4.42 ms, maximo 6.70 ms.
  - `stress-960-lod`: mediana 2.90 ms, promedio 3.00 ms, maximo 7.00 ms.

Limitacion conocida:

- Los wrappers en `main.ts` siguen existiendo por compatibilidad interna. El
  siguiente corte deberia hacer que `TabManager` y `FilePersistenceController`
  reciban directamente el `CircuitDocumentController` o una interfaz de
  documento.
- `CircuitStateManager.prepareForDemoLoad` aun acepta `any` para osciloscopio y
  orquestador. Esa deuda debe corregirse antes de separar mas estado runtime.

### Fase 14 - Interfaz de documento y eliminacion de wrappers

Estado: completada el 2026-07-12.

- Quitar wrappers de documento en `main.ts` para evitar funciones puente sin
  valor propio.
- Hacer que `TabManager` y `FilePersistenceController` dependan de una interfaz
  de documento explicita.
- Mantener compatibilidad de comportamiento en guardado, carga de demos y
  apertura de archivos.

Resultado:

- Se agrego la interfaz `CircuitDocumentPort` en
  `src/app/circuit_document_controller.ts`.
- `FilePersistenceController` recibe ahora `documentController` y llama a:
  - `validateCircuitFileForLoad`;
  - `deserializeCircuit`.
- `TabManager` recibe `documentController` y usa `serializeCircuit` al guardar.
- Se eliminaron de `main.ts` los wrappers:
  - `serializeCircuit`;
  - `validateCircuitFileForLoad`;
  - `deserializeCircuit`.
- Se actualizaron pruebas de `TabManager` y persistencia para usar el contrato
  de documento.
- Verificacion: `npx tsc --noEmit`, 112 pruebas frontend y audit performance.
- Resultado de performance despues del cambio:
  - `stress-252`: mediana 1.80 ms, promedio 1.89 ms, maximo 3.80 ms.
  - `stress-480`: mediana 2.60 ms, promedio 2.99 ms, maximo 6.90 ms.
  - `stress-960-lod`: mediana 2.20 ms, promedio 2.37 ms, maximo 4.30 ms.

Limitacion conocida:

- `main.ts` aun instancia y cablea muchos controladores. El siguiente corte
  deberia mover la composicion de dependencias a un bootstrap dedicado o empezar
  a extraer controladores de simulacion.
- `TabManager` todavia mezcla persistencia de estado de pestanas con UI DOM de
  tabs. Debe separarse en estado de workspace y vista de tabs en una fase
  posterior.

### Fase 15 - SimulationController

Estado: primera extraccion completada el 2026-07-12.

- Sacar de `main.ts` el flujo principal de simulacion: inicio, parada, ERC,
  preparacion de osciloscopio, ownership de pestana, dispatch al solver y
  aplicacion de resultados.
- Mantener como dependencias inyectadas los modos especiales PVT/SPAR y el
  solver transitorio local para evitar una migracion demasiado grande.
- Conservar el contrato de `simulation_controls` como capa de presentacion.

Resultado:

- Se agrego `src/app/simulation_controller.ts`.
- `main.ts` ya no contiene el cuerpo principal de `onRunSimulation`,
  `onStopSimulation` ni `setActiveAnalysisMode`.
- El controlador centraliza:
  - validacion de lienzo vacio;
  - ejecucion de ERC antes de simular;
  - render de halos ERC;
  - preparacion de osciloscopio;
  - dispatch a Rust/fallback;
  - aplicacion de resultados DC/AC/TRAN/SENS/PSS;
  - parada de simulacion y limpieza de runtime.
- Se agrego `src/app/simulation_controller.test.ts` con cobertura de:
  - rechazo de simulacion con lienzo vacio;
  - aborto por ERC fallido.
- Verificacion: `npx tsc --noEmit`, 114 pruebas frontend y audit performance.
- Resultado de performance despues del cambio:
  - `stress-252`: mediana 2.50 ms, promedio 2.63 ms, maximo 6.60 ms.
  - `stress-480`: mediana 3.70 ms, promedio 3.67 ms, maximo 6.10 ms.
  - `stress-960-lod`: mediana 3.10 ms, promedio 3.20 ms, maximo 6.20 ms.

Limitacion conocida:

- `runPvtAnalysis`, `runSparamExport` y `solveTransientCircuitLocal` siguen en
  `main.ts`. Deben moverse en fases posteriores, porque arrastran UI,
  osciloscopio, exportacion Touchstone y worker local.
- El controlador aun recibe muchas dependencias. Es mejor que el bloque inline
  anterior, pero todavia revela que falta una capa de composicion/bootstrap mas
  limpia.

### Fase 16 - RenderController

Estado: primera extraccion completada el 2026-07-12.

- Sacar de `main.ts` la coordinacion de render de canvas, osciloscopio, caches
  DMM, throttle de playback y alimentacion FFT.
- Mantener `CanvasOrchestrator` intacto; esta fase no implementa todavia render
  por capas.
- Hacer que `main.ts` conserve solo wrappers pequenos hacia el controlador de
  render mientras otros modulos siguen usando esos nombres.

Resultado:

- Se agrego `src/app/render_controller.ts`.
- `RenderController` centraliza:
  - `updateCanvasRendering`;
  - `updateOscilloscopeRendering`;
  - `resetPerformanceCaches`;
  - busqueda de frame de playback;
  - throttle de render durante playback;
  - cache DMM;
  - actualizacion de datos FFT;
  - marcadores de sondas y puertos S.
- Se agrego `src/app/render_controller.test.ts` con cobertura de:
  - render de canvas con marcador de sonda;
  - throttle de playback.
- Verificacion: `npx tsc --noEmit`, 116 pruebas frontend y audit performance.
- Resultado de performance despues del refactor:
  - `stress-252`: mediana 3.80 ms, promedio 3.88 ms, maximo 9.10 ms.
  - `stress-480`: mediana 4.70 ms, promedio 4.98 ms, maximo 12.10 ms.
  - `stress-960-lod`: mediana 3.90 ms, promedio 3.91 ms, maximo 7.10 ms.

Limitacion conocida:

- Esta fase mejora estructura, no velocidad. Los tiempos subieron un poco frente
  a la medicion anterior, aunque siguen dentro del presupuesto.
- Todavia no hay capas persistentes de render. `CanvasOrchestrator` sigue
  dibujando en un unico canvas.
- `main.ts` conserva wrappers de render por compatibilidad interna. Pueden
  desaparecer cuando los consumidores reciban `RenderController` directamente.

### Fase 17 - Workspace state para pestanas

Estado: primera extraccion completada el 2026-07-12.

- Separar de `TabManager` la parte de modelo/snapshot de workspace.
- Mantener en `TabManager` la UI DOM de pestañas por ahora, pero reducir la
  logica manual de captura/restauracion.
- Evitar duplicar clonacion de componentes/cables al cambiar de pestana y al
  guardar.

Resultado:

- Se agrego `src/ui/workspace_state.ts`.
- El nuevo modulo centraliza:
  - creacion de pestanas con defaults;
  - captura del runtime actual dentro de una pestana;
  - restauracion de una pestana hacia canvas, osciloscopio, probes, puertos S y
    voltajes;
  - limpieza de seleccion del canvas al cambiar de pestana.
- `TabManager` ahora usa `createWorkspaceTab`, `captureRuntimeIntoTab` y
  `restoreTabIntoRuntime`.
- El guardado directo y `Guardar como` reutilizan el mismo helper de captura,
  en vez de clonar manualmente solo parte del estado.
- Se agrego `src/ui/workspace_state.test.ts` con cobertura de:
  - defaults de pestana;
  - captura de runtime;
  - restauracion de runtime y limpieza de seleccion.
- Verificacion: `npx tsc --noEmit`, 119 pruebas frontend y audit performance.
- Resultado de performance despues del refactor:
  - `stress-252`: mediana 3.20 ms, promedio 3.51 ms, maximo 9.40 ms.
  - `stress-480`: mediana 4.30 ms, promedio 4.66 ms, maximo 7.80 ms.
  - `stress-960-lod`: mediana 3.80 ms, promedio 3.73 ms, maximo 6.20 ms.

Limitacion conocida:

- `TabManager` todavia renderiza DOM y gestiona eventos de pestañas. La fase
  pendiente real es separar `WorkspaceStore`/estado de `TabsView`/DOM.
- Este cambio no implementa persistencia avanzada ni historial por pestana; solo
  ordena el modelo de estado actual.

### Fase 18 - WorkspaceStore y TabsView

Estado: primera extraccion completada el 2026-07-12.

- Separar el modelo puro de pestanas de la clase que coordina UI, persistencia y
  runtime.
- Sacar el render DOM de la barra de pestanas a una vista pequena y testeable.
- Mantener compatibilidad con consumidores existentes que aun leen
  `tabManager.tabs` y `tabManager.activeTabId`.

Resultado:

- Se agrego `src/ui/workspace_store.ts`.
- `WorkspaceStore` centraliza:
  - lista de pestanas;
  - pestana activa;
  - creacion con nombre incremental;
  - busqueda/remocion;
  - fallback al cerrar una pestana;
  - marca de cambios pendientes.
- Se agrego `src/ui/tabs_view.ts`.
- `TabsView` centraliza:
  - render de `.tab-item`;
  - estado activo;
  - indicador de cambios sin guardar;
  - eventos de seleccion y cierre.
- `TabManager` queda como coordinador de alto nivel y conserva accesores
  compatibles para no romper `main.ts` ni persistencia.
- Se agregaron `src/ui/workspace_store.test.ts` y `src/ui/tabs_view.test.ts`.
- Verificacion: `npx tsc --noEmit`, 124 pruebas frontend, audit performance y
  audit UI.
- Resultado de performance despues del refactor:
  - `stress-252`: mediana 4.80 ms, promedio 5.06 ms, maximo 9.60 ms.
  - `stress-480`: mediana 5.80 ms, promedio 6.18 ms, maximo 9.60 ms.
  - `stress-960-lod`: mediana 5.50 ms, promedio 5.64 ms, maximo 8.90 ms.

Limitacion conocida:

- Esta fase mejora estructura y pruebas, no velocidad. Los tiempos subieron
  frente a la Fase 17, aunque siguen dentro del presupuesto actual.
- `TabManager` aun mezcla guardado, confirmaciones, runtime y llamadas a Tauri.
  El siguiente corte sano es extraer una capa de comandos/acciones de pestanas.
- Se mantuvieron accesores publicos `tabs` y `activeTabId` por compatibilidad.
  Deben desaparecer cuando `main.ts` y persistencia consuman solo metodos.

### Fase 19 - Acciones de archivo de pestanas

Estado: primera extraccion completada el 2026-07-12.

- Sacar de `TabManager` el cuerpo de guardado directo y `Guardar como`.
- Mantener el contrato publico `saveCircuitDirect` y `saveCircuitAs` para no
  romper atajos, botones ni persistencia.
- Reutilizar el snapshot de runtime antes de serializar, igual que antes.

Resultado:

- Se agrego `src/ui/tab_file_actions.ts`.
- `TabFileActions` centraliza:
  - captura del runtime activo hacia la pestana;
  - guardado directo por `save_circuit_to_path`;
  - fallback a `Guardar como` cuando no hay ruta;
  - guardado por dialogo Tauri `save_circuit_file`;
  - actualizacion de nombre, ruta, estado `unsaved` y barra de pestanas;
  - logs de exito, error y cancelacion.
- `TabManager` conserva metodos publicos pequenos y delega la logica de archivo.
- Se agrego `src/ui/tab_file_actions.test.ts`.
- Verificacion: `npx tsc --noEmit`, 127 pruebas frontend, audit performance y
  audit UI.
- Resultado de performance despues del refactor:
  - `stress-252`: mediana 3.50 ms, promedio 3.93 ms, maximo 10.10 ms.
  - `stress-480`: mediana 4.90 ms, promedio 4.93 ms, maximo 7.80 ms.
  - `stress-960-lod`: mediana 5.00 ms, promedio 4.99 ms, maximo 10.40 ms.

Limitacion conocida:

- Esta fase no separa todavia cierre de pestanas ni confirmaciones.
- `FilePersistenceController` sigue tocando `tabManager.tabs`,
  `tabManager.activeTabId` y `renderTabsBar` directamente. Ese es el siguiente
  acoplamiento que debe desaparecer.
- El guardado real con dialogo Tauri no se automatizo en esta fase para evitar
  crear archivos temporales desde la ventana; queda cubierto por tests de IPC
  mockeado y por build/audits.

### Fase 20 - Persistencia desacoplada de internals de pestanas

Estado: primera extraccion completada el 2026-07-12.

- Eliminar accesos directos de `FilePersistenceController` a:
  - `tabManager.tabs`;
  - `tabManager.activeTabId`;
  - `tabManager.renderTabsBar`.
- Mantener el comportamiento de Nuevo, cargar demo, abrir archivo y guardar.
- Hacer que `TabManager` sea el dueno de decidir como se consulta/actualiza una
  pestana cargada.

Resultado:

- `TabManager` ahora expone:
  - `getActiveTab()`;
  - `isTabEmpty(tab)`;
  - `applyLoadedFileToTab(tabId, metadata)`.
- `FilePersistenceController` usa esos metodos y ya no modifica la barra de
  pestanas ni busca directamente en el arreglo interno.
- Se actualizaron pruebas de persistencia para depender del contrato publico.
- Verificacion: `npx tsc --noEmit`, 127 pruebas frontend, audit performance y
  audit UI.
- Resultado de performance despues del refactor:
  - `stress-252`: mediana 3.10 ms, promedio 3.44 ms, maximo 7.60 ms.
  - `stress-480`: mediana 4.40 ms, promedio 4.74 ms, maximo 11.40 ms.
  - `stress-960-lod`: mediana 3.90 ms, promedio 3.88 ms, maximo 6.40 ms.

Limitacion conocida:

- `TabManager` todavia conserva getters publicos `tabs` y `activeTabId` porque
  `main.ts` aun los usa en callbacks de simulacion y atajos.
- Esta fase no cambia el flujo visual del dialogo de abrir/guardar; solo reduce
  acoplamiento interno.
- El siguiente corte real debe migrar los accesos restantes de `main.ts` hacia
  metodos explicitos o un puerto de workspace.

### Fase 21 - Main sin acceso directo a internals de pestanas

Estado: primera extraccion completada el 2026-07-12.

- Eliminar de `main.ts` los accesos directos a:
  - `tabManager.tabs`;
  - `tabManager.activeTabId`.
- Mantener el flujo de simulacion interactiva y atajos de teclado.
- Agregar metodos de intencion en `TabManager` para que `main.ts` no conozca la
  estructura interna del workspace.

Resultado:

- `TabManager` ahora expone:
  - `getTabById(tabId)`;
  - `isActiveTab(tabId)`;
  - `appendTransientFrameToTab(tabId, frame)`;
  - `bindTransientResultsToTab(tabId, transientResults)`;
  - `closeActiveTab()`.
- `main.ts` registra frames transitorios mediante `appendTransientFrameToTab`.
- Los callbacks de simulacion verifican pertenencia con `isActiveTab`.
- `SimulationController` recibe `getActiveTabId()` y `getTabs()` en vez de
  propiedades directas.
- El atajo Ctrl+W llama `closeActiveTab()`.
- Se agregaron pruebas de `TabManager` para registrar frames y cerrar la
  pestana activa por metodo de intencion.
- Verificacion: `npx tsc --noEmit`, 129 pruebas frontend, audit performance y
  audit UI.
- Resultado de performance despues del refactor:
  - `stress-252`: mediana 2.40 ms, promedio 2.89 ms, maximo 9.10 ms.
  - `stress-480`: mediana 4.00 ms, promedio 4.29 ms, maximo 9.70 ms.
  - `stress-960-lod`: mediana 3.50 ms, promedio 3.42 ms, maximo 5.30 ms.

Limitacion conocida:

- `TabManager` conserva getters publicos `tabs` y `activeTabId` por
  compatibilidad con pruebas/stubs y para no hacer un cambio de contrato mayor
  en esta fase. Ya no hay accesos directos desde `main.ts` ni desde
  `FilePersistenceController`.
- `SimulationController` todavia recibe listas de pestanas; el siguiente paso
  sano es reemplazar `getTabs()` por un puerto especifico de workspace.

### Fase 22 - SimulationController con puerto especifico de workspace

Estado: primera extraccion completada el 2026-07-12.

- Quitar de `SimulationController` la dependencia generica `getTabs()`.
- Reemplazarla por una operacion especifica: enlazar resultados transitorios a
  la pestana duena de la simulacion.
- Mantener intacto el flujo de ERC, dispatch y modos especiales.

Resultado:

- `SimulationControllerDependencies` reemplazo:
  - `getTabs(): Tab[]`
  por:
  - `bindTransientResultsToTab(tabId, transientResults)`.
- `main.ts` conecta ese puerto con `tabManager.bindTransientResultsToTab`.
- `SimulationController` ya no importa ni conoce el tipo `Tab`.
- Se agrego cobertura en `simulation_controller.test.ts` para comprobar que,
  al arrancar una simulacion valida, los resultados del osciloscopio se enlazan
  con la pestana activa.
- Verificacion: `npx tsc --noEmit`, 130 pruebas frontend, audit performance y
  audit UI.
- Resultado de performance despues del refactor:
  - `stress-252`: mediana 3.80 ms, promedio 3.94 ms, maximo 7.90 ms.
  - `stress-480`: mediana 4.70 ms, promedio 4.91 ms, maximo 8.00 ms.
  - `stress-960-lod`: mediana 4.00 ms, promedio 4.16 ms, maximo 6.70 ms.

Limitacion conocida:

- Esta fase mejora contrato interno, no velocidad. La medicion subio frente a
  Fase 21, aunque sigue dentro del presupuesto.
- `TabManager` todavia conserva `getTabs()` para su propia vista/store y por
  compatibilidad general, pero ya no es dependencia de `SimulationController`.
- Falta un puerto formal `WorkspacePort` compartido para evitar pasar muchos
  metodos sueltos en fases futuras.

### Fase 23 - Callbacks interactivos fuera de main

Estado: primera extraccion completada el 2026-07-12.

- Sacar de `main.ts` los callbacks del `SimulationRunner`:
  - frame recibido;
  - error de simulacion;
  - simulacion completa;
  - cambio de estado activo/inactivo.
- Mantener en `SimulationController` el flujo de ERC, dispatch y aplicacion de
  resultados ya extraido en fases anteriores.
- No mover el ERC manual del menu de instrumentacion, porque es un comando de
  diagnostico UI y no el flujo principal de simulacion.

Resultado:

- Se agrego `src/app/interactive_simulation_callbacks.ts`.
- El modulo centraliza:
  - escritura de frames transitorios en la pestana duena;
  - sincronizacion de voltajes vivos;
  - actualizacion de osciloscopio/canvas;
  - precomputo de actuadores al frame final;
  - manejo de errores del stream interactivo;
  - sincronizacion del estado de simulacion activa.
- `main.ts` ahora crea el runner con
  `createSimulationRunner(createInteractiveSimulationCallbacks(...))`.
- Se agrego `src/app/interactive_simulation_callbacks.test.ts`.
- Verificacion: `npx tsc --noEmit`, 132 pruebas frontend, audit performance y
  audit UI.
- Resultado de performance despues del refactor:
  - `stress-252`: mediana 4.30 ms, promedio 4.35 ms, maximo 9.80 ms.
  - `stress-480`: mediana 5.40 ms, promedio 5.69 ms, maximo 9.00 ms.
  - `stress-960-lod`: mediana 4.20 ms, promedio 4.12 ms, maximo 7.90 ms.

Limitacion conocida:

- Esta fase mejora arquitectura, no velocidad. La medicion empeoro frente a
  Fase 22, aunque sigue dentro del presupuesto.
- `main.ts` todavia conserva `solveTransientCircuitLocal`, `runPvtAnalysis` y
  `runSparamExport`; esos flujos son los siguientes candidatos reales dentro
  del bloque SimulationController.
- El ERC manual del menu de instrumentacion sigue en `main.ts` a proposito:
  moverlo al controlador de simulacion mezclaria diagnostico UI con ejecucion.

### Fase 24 - Solver transitorio local fuera de main

Estado: primera extraccion completada el 2026-07-12.

- Sacar de `main.ts` la logica de worker local para fallback transitorio.
- Mantener en `main.ts` solo el adaptador que toma `orchestrator.components`.
- Hacer testeable la recoleccion de firmware y el contrato con el worker.

Resultado:

- Se agrego `src/app/local_transient_solver.ts`.
- El modulo centraliza:
  - recoleccion de firmware por componente;
  - creacion del worker `co_simulation_worker`;
  - envio de `{ type: "run_fallback", netlist, dt, tMax, firmware }`;
  - resolucion de resultados o error;
  - terminacion del worker.
- `main.ts` reemplazo el cuerpo de `solveTransientCircuitLocal` por una llamada
  a `solveTransientCircuitWithWorker`.
- Se agrego `src/app/local_transient_solver.test.ts`.
- Verificacion: `npx tsc --noEmit`, 135 pruebas frontend, audit performance y
  audit UI.
- Resultado de performance despues del refactor:
  - `stress-252`: mediana 2.90 ms, promedio 3.04 ms, maximo 8.90 ms.
  - `stress-480`: mediana 3.50 ms, promedio 4.06 ms, maximo 9.00 ms.
  - `stress-960-lod`: mediana 2.90 ms, promedio 3.20 ms, maximo 5.30 ms.

Limitacion conocida:

- `main.ts` todavia conserva el adaptador porque `orchestrator` sigue siendo
  estado global del bootstrap.
- `runPvtAnalysis` y `runSparamExport` siguen en `main.ts`; son los siguientes
  flujos de simulacion/exportacion que deben salir.

### Fase 25 - Exportacion SPAR fuera de main

Estado: primera extraccion completada el 2026-07-12.

- Sacar de `main.ts` el flujo de parametros S y exportacion Touchstone.
- Mantener un wrapper pequeno `runSparamExport(netlist)` para compatibilidad con
  `SimulationController`.
- Centralizar puertos, IPC, actualizacion de osciloscopio, Touchstone y logs.

Resultado:

- Se agrego `src/app/sparameter_export_controller.ts`.
- El controlador centraliza:
  - modo de seleccion cuando no hay puertos RF;
  - construccion de `PortDefinition[]`;
  - llamada IPC `extract_sparameter`;
  - validacion de convergencia;
  - actualizacion del osciloscopio en modo `SPAR`;
  - formateo Touchstone;
  - llamada IPC `export_touchstone_file`;
  - estado IPC y logs.
- `main.ts` instancia `SParameterExportController` y delega
  `runSparamExport`.
- Se agrego `src/app/sparameter_export_controller.test.ts`.
- Verificacion: `npx tsc --noEmit`, 138 pruebas frontend, audit performance y
  audit UI.
- Resultado de performance despues del refactor:
  - `stress-252`: mediana 3.10 ms, promedio 3.19 ms, maximo 6.80 ms.
  - `stress-480`: mediana 4.10 ms, promedio 4.16 ms, maximo 7.80 ms.
  - `stress-960-lod`: mediana 4.10 ms, promedio 3.98 ms, maximo 5.50 ms.

Limitacion conocida:

- Esta fase no prueba el dialogo real de exportacion Touchstone en Tauri para
  evitar crear archivos en disco durante la automatizacion. El IPC queda cubierto
  con pruebas mockeadas.
- `runPvtAnalysis` y `executePvtAnalysisMatrix` siguen en `main.ts`.

### Fase 26 - Analisis PVT fuera de main

Estado: primera extraccion completada el 2026-07-12.

- Sacar de `main.ts` el flujo PVT que mezclaba UI, IPC, estado de simulacion y
  actualizacion del osciloscopio.
- Mantener un wrapper pequeno `runPvtAnalysis(netlist)` para compatibilidad con
  `SimulationController`.
- Hacer testeable la creacion de perfiles, la llamada `run_pvt_matrix_analysis`
  y la aplicacion de trazas PVT.

Resultado:

- Se agrego `src/app/pvt_analysis_controller.ts`.
- El controlador centraliza:
  - creacion y limpieza de botones de perfil PVT;
  - bloqueo temporal de controles durante la ejecucion;
  - seleccion de nodos monitorizados desde sondas del osciloscopio;
  - llamada IPC `run_pvt_matrix_analysis`;
  - construccion de `PvtTrace[]`;
  - activacion del modo `PVT` en el osciloscopio;
  - estado IPC y logs del resultado por esquina.
- `main.ts` instancia `PvtAnalysisController` y delega `runPvtAnalysis`.
- Se agrego `src/app/pvt_analysis_controller.test.ts`.
- Verificacion: `npx tsc --noEmit`, 141 pruebas frontend, audit performance y
  audit UI.
- Resultado de performance despues del refactor:
  - `stress-252`: mediana 3.10 ms, promedio 3.35 ms, maximo 7.80 ms.
  - `stress-480`: mediana 3.50 ms, promedio 3.79 ms, maximo 6.70 ms.
  - `stress-960-lod`: mediana 4.30 ms, promedio 4.30 ms, maximo 7.60 ms.

Limitacion conocida:

- Esta fase prueba el flujo PVT con IPC mockeado. Falta una prueba Tauri real
  del perfil PVT porque requiere escoger un circuito compatible y esperar la
  matriz completa.
- El texto nuevo del controlador usa ASCII para evitar ampliar el problema de
  mojibake existente en archivos antiguos.

### Fase 27 - Playback de osciloscopio dentro de RenderController

Estado: primera extraccion completada el 2026-07-12.

- Sacar de `main.ts` el procesamiento de cada frame reproducido por el
  osciloscopio.
- Mantener en `main.ts` solo el callback `oscilloscopePanel.onFrameUpdate`.
- Concentrar en `RenderController` la decision de frame, playback, instrumentos
  y render de canvas.

Resultado:

- `RenderController` ahora expone `handlePlaybackFrame(sweepTime)`.
- El controlador centraliza:
  - seleccion del resultado transitorio mas cercano;
  - actualizacion del mapa de voltajes vivo;
  - sincronizacion de estados de pines MCU durante playback;
  - avance/reset del runtime MCU seleccionado;
  - alimentacion del analizador logico;
  - actualizacion diferida del FFT;
  - aplicacion de historial de actuadores y audio de buzzer;
  - throttling del render de canvas durante playback.
- `main.ts` reemplazo el bloque largo de `onFrameUpdate` por una llamada a
  `renderController?.handlePlaybackFrame(sweepTime)`.
- Se amplio `src/app/render_controller.test.ts` con cobertura de playback.
- Verificacion: `npx tsc --noEmit`, 142 pruebas frontend, audit performance y
  audit UI.
- Resultado de performance despues del refactor:
  - `stress-252`: mediana 2.50 ms, promedio 2.91 ms, maximo 9.30 ms.
  - `stress-480`: mediana 4.50 ms, promedio 4.47 ms, maximo 7.20 ms.
  - `stress-960-lod`: mediana 4.50 ms, promedio 4.66 ms, maximo 8.00 ms.

Limitacion conocida:

- Esta fase no acelera de forma garantizada. Mejora la separacion de
  responsabilidades y mantiene el rendimiento dentro del presupuesto, pero el
  resultado fue mixto frente a Fase 26.
- `RenderController` aun mezcla render, playback e instrumentos. La siguiente
  separacion razonable seria un `PlaybackController` o submodulos internos si
  el archivo crece mas.

### Fase 28 - Hardening de tipos en estado de demo

Estado: primera correccion completada el 2026-07-12.

- Eliminar el `any` concreto de `CircuitStateManager.prepareForDemoLoad`.
- Definir contratos minimos para el estado del osciloscopio y del orquestador
  usado al cargar demos.
- Cubrir con prueba el reset de voltajes, pines, osciloscopio y canvas state.

Resultado:

- `prepareForDemoLoad` ahora recibe:
  - `DemoLoadOscilloscopeState | null`;
  - `DemoLoadOrchestratorState | null`.
- Se agrego `src/simulation/circuit_state_manager.test.ts`.
- Verificacion: `npx tsc --noEmit`, 143 pruebas frontend y `git diff --check`.

Limitacion conocida:

- No se eliminaron todos los `any` del proyecto. Quedan usos reales en
  instrumentos, exportacion, tests y adaptadores Tauri. Esta fase ataco el caso
  explicito y de bajo riesgo del plan.

### Fase 29 - QA final de escritorio y empaquetado

Estado: validacion local completada el 2026-07-12.

- Verificar que la aplicacion de escritorio compile, pase pruebas backend y
  frontend, arranque en Tauri y empaquete en release.
- Probar una simulacion real desde la ventana Tauri.

Resultado:

- Frontend:
  - `npm run build`: OK.
  - `npm test`: 143 pruebas OK.
  - `npm run audit:performance`: OK.
  - `npm run audit:ui`: OK.
- Backend Rust:
  - `cargo check`: OK.
  - `cargo test`: 121 pruebas OK.
  - `cargo clippy -- -D warnings`: OK.
- Escritorio Tauri:
  - `npm run tauri -- dev`: arranco correctamente.
  - Prueba viva: se cargo `01_divisor_rc.astryd`, se ejecuto analisis CC y la
    ventana mostro resultados del solver Rust con nodos 0, 1 y 2.
- Release:
  - `npm run empaquetar`: OK.
  - Ejecutable release:
    `src-tauri/target/release/astryd-sophia.exe`.
  - Instalador NSIS:
    `src-tauri/target/release/bundle/nsis/Astryd Sophia_0.1.0_x64-setup.exe`.

Limitacion conocida:

- La comprobacion visual Tauri fue manual-asistida por captura de ventana. La
  API de automatizacion no devolvio OCR utilizable del texto, aunque la captura
  mostro claramente la demo cargada y los resultados del solver.
- No se probo instalacion/desinstalacion del NSIS, solo generacion del bundle.

### Cierre de prioridad alta - 2026-07-22

Estado: completado y validado en escritorio Windows.

- El nucleo transitorio se redujo de 2.103 a 587 lineas de coordinacion. El
  stamping de junctions, MOS/BSIM, BJT, JFET, opamp, logica, MCU y fuentes
  comportamentales vive ahora en modulos separados bajo
  `src-tauri/src/solver/engine/transient/stamps/`.
- El control LTE e historial trapezoidal paso a
  `transient_step_control.rs`, con pruebas unitarias propias. La suite Rust
  completa quedo en 128 pruebas exitosas.
- Se agrego E2E reproducible sobre una ventana Tauri real mediante
  WebdriverIO, `tauri-driver` y EdgeDriver externo. La feature `wdio` es
  explicita; el
  backend y puente frontend de pruebas no se registran en produccion.
- La suite nativa verifica: cargar `01_divisor_rc.astryd`, ejecutar CC con el
  solver Rust, guardar por IPC y comparar el archivo escrito, abrir los cinco
  instrumentos y logs, colocar un resistor, cablearlo y restaurar el snapshot.
- La automatizacion ya no depende de OCR ni de eventos DOM fabricados. La carga
  de demo, el arrastre desde la paleta y el cableado usan acciones WebDriver
  reales y la suite exige eventos con `isTrusted=true`. El proveedor embebido se
  retiro porque convertia las acciones W3C en `MouseEvent` no confiables, omitia
  `PointerEvent` y perdia el estado de botones durante el movimiento.
- El binario E2E se genera en `target/debug`, separado del ejecutable release. El
  servicio instala `tauri-driver` y descarga el EdgeDriver compatible cuando
  faltan, por lo que `npm run test:e2e:desktop` es el comando reproducible unico.
- El hook final del runner limpia `tauri-driver.exe` y `msedgedriver.exe` en
  Windows para evitar procesos o puertos huerfanos cuando la libreria falla al
  cerrar una sesion.
- El osciloscopio limita el dibujo T-Y a una envolvente min/max de hasta dos
  puntos por pixel, cachea trazas y metricas, y limita cada historial
  interactivo a 60.000 frames con recorte por bloques. Los resultados por lote
  destinados a analisis y exportacion no se recortan silenciosamente.
- Auditoria de 1.000.000 muestras: 21,80 ms en primera reduccion, 0,00 ms
  medidos desde cache, 2.560 puntos de salida y pico preservado.
- Auditoria canvas: `stress-252` mediana 2,00 ms; `stress-480` 2,60 ms;
  `stress-960-lod` 1,90 ms. Todos los maximos quedaron bajo presupuesto.
- Verificacion final: 264 pruebas frontend, 128 Rust, build TypeScript/Vite,
  auditoria UI, guard de produccion, auditoria de rendimiento,
  `cargo fmt --check`, `cargo clippy -- -D warnings` con y sin `wdio`, E2E
  Tauri nativo y `npm audit` sin vulnerabilidades reportadas.
- Release NSIS generado en
  `src-tauri/target/release/bundle/nsis/Astryd Sophia_0.1.0_x64-setup.exe`
  (SHA-256 `FF5C7E175DA2A82AB8399DDDC37C003F23CFC29E195F7303F219BFF782F9253F`).
- El release de produccion se reconstruyo sin la feature `wdio` y se comprobo
  en ejecucion que no abre el puerto `4445` usado por EdgeDriver.
- Se actualizo la instalacion local y se hizo smoke del ejecutable instalado:
  demo cargada, centro de instrumentos visible y resultados Rust `0=0 V`,
  `1=5 V`, `2=5 V`.

## Criterio de cierre

Una fase se considera terminada solo cuando:

1. Sus pruebas automatizadas pasan.
2. El flujo se valida en la ventana Tauri de escritorio.
3. No introduce perdida de archivos ni corrupcion de netlists.
4. Se actualiza este documento con el resultado real.
