# Fase 2 — Instrumentación útil

Estado: implementada y verificada el 3 de agosto de 2026.

## Frontera de datos

La instrumentación no persiste netlists, identificadores de componentes o
nodos, valores de componentes, firmware, rutas, trazas ni mensajes de error.
Cada ejecución usa un UUID y cada pestaña se representa mediante una huella
FNV-1a de 32 bits con sal aleatoria por sesión. Las configuraciones, topologías
y mensajes también se reducen a huellas por sesión; no sirven como identidad
estable entre sesiones.

Los resúmenes de circuito contienen sólo conteos, histograma de tipos, presencia
de firmware y una huella topológica. Los errores ERC se convierten a códigos
estables. Los errores de UI idénticos se deduplican durante 10 segundos.

Cuando el consentimiento está desactivado, el facade retorna un handle inerte
antes de calcular histogramas o huellas. No se crea ningún evento ni se manda
IPC de feedback.

## Cobertura

| Superficie | Eventos |
|---|---|
| Preflight de simulación | `simulation.started`, `circuit.summary_created`, `erc.completed` |
| DC, AC, SENS, PSS y STB | convergencia y terminal completado/fallido |
| Transitorio interactivo | completado, fallo de stream, cancelación de usuario o reemplazo |
| PVT y parámetros S | ciclo de vida del trabajo real, no de la selección previa |
| DC sweep, TRAN directo, Monte Carlo, FFT, IMD, ruido y térmico | observador de comandos IPC |
| Parser SPICE | éxito/fallo, duración y cantidad de componentes |
| CSV, SVG, Touchstone, HDF5 Lite y PDF | tipo y cantidad exportada |
| Rendimiento | FPS, CPU, RAM y contadores cada 3 segundos |
| Errores relevantes | área, código estable y huella del mensaje |

Cada terminal se protege con un latch: una ejecución no puede terminar como
completada y fallida a la vez. Todos los eventos del flujo UI comparten `runId`
y el seudónimo `workspaceId`.

## Verificación

- TypeScript/Vitest: 304 pruebas, incluidas correlación, privacidad, terminal
  único y observación IPC.
- Rust: 162 pruebas; validación de esquema, round-trip, SQLite, parser adversarial
  y entradas públicas del solver incluidas.
- E2E Tauri: 4 archivos, 31 casos; el flujo real consulta SQLite y verifica los
  cinco eventos correlacionados de una simulación DC.
- La inspección E2E rechaza las claves de firmware/trazas y los identificadores
  del circuito de demostración en los eventos persistidos.
- `cargo clippy -- -D warnings`, generación de contratos y builds de producción,
  auditoría y WDIO pasan.

## Medición de sobrecarga

El E2E ejecuta 12 análisis DC consecutivos sobre el mismo circuito de 480
componentes dentro del WebView. Mide una serie desactivada antes y otra después
de la serie local para reducir el sesgo por calentamiento. La llamada al solver
Rust, la instrumentación y la serialización se miden con `performance.now()`,
por lo que WebDriver queda fuera. También mide directamente los bloques de
instrumentación antes y después del solver.

Resultado observado en AMD Ryzen 5 2600 (6 núcleos/12 hilos):

| Modo | p95 |
|---|---:|
| Desactivado (promedio p95 antes/después) | 960.15 ms |
| Local | 949.10 ms |
| Regresión total observada | -1.15% |
| Instrumentación directa p95 | 1.9 ms / 0.20% del solver |

La regresión total negativa se interpreta como ruido/caché, no como aceleración.
Una ejecución posterior midió 3.00255% de mediana y 22.35% de p95 crudos mientras
el bloque medido directamente seguía en 0.21%, demostrando que una sola serie no
separa el coste de feedback de la variación del solver. El E2E falla si el tramo
síncrono ajeno al solver supera +3% o si el bloque de instrumentación supera +2%.
La regresión total conserva el gate de +3% sólo en el benchmark periódico sobre
una máquina controlada y con intervalos de confianza; los valores crudos del E2E
se registran como diagnóstico.

## Lo que no hace esta fase

No hay aprendizaje automático, recomendaciones ni subida remota. Los eventos
son evidencia local estructurada. El dashboard, corrección humana y exportación
redactada son la Fase 3; el asesor determinista y el aprendizaje en sombra son
fases posteriores.
