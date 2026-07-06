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

- Corregir desbordes en 900x600 y resoluciones de escritorio habituales.
- Completar nombres accesibles, foco, teclado y aislamiento de dialogos.
- Probar el centro de instrumentos sin interferir con el esquema.
- No incluir trabajo movil en esta fase.

### Fase 7 - Entrega y mantenibilidad

- Generar instalador Windows NSIS o MSI y verificar instalacion limpia.
- Corregir identificador y metadatos del paquete.
- Separar responsabilidades excesivas de `main.ts` y del estado global.
- Incorporar E2E Tauri para los flujos criticos anteriores.

## Criterio de cierre

Una fase se considera terminada solo cuando:

1. Sus pruebas automatizadas pasan.
2. El flujo se valida en la ventana Tauri de escritorio.
3. No introduce perdida de archivos ni corrupcion de netlists.
4. Se actualiza este documento con el resultado real.
