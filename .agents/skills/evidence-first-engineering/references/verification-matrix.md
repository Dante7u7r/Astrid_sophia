# Matriz de verificación de Astryd Sophia

Esta matriz decide el mínimo de evidencia. Se complementa con el test más cercano al archivo modificado; no lo reemplaza.

| Tipo de trabajo | Inspección antes de modificar | Verificación mínima | Evidencia de cierre |
| --- | --- | --- | --- |
| Análisis o diagnóstico | Reproducción, `rg` de la ruta real, test o log relacionado | Ninguna escritura; ejecutar prueba si la hipótesis se puede aislar | Hecho, inferencia e incógnita diferenciados |
| UI/TypeScript localizado | Controlador, modelo y `*.test.ts` vecino | Test enfocado + `npm run build` | El test cubre la interacción o estado modificado |
| Runner, reproducción o controles de simulación | `simulation_runner`, controladores de aplicación, callbacks y tests vecinos | Tests enfocados + `npm test` + `npm run build` | Inicio, finalización, cancelación y resultado obsoleto están cubiertos |
| IPC/Tauri | Invocador TS, contrato de tipos, comando Rust y errores | Tests TS pertinentes + `cargo test`/`cargo clippy -- -D warnings` si cambia Rust | Contrato de serialización y errores verificables |
| Solver, modelos o integración numérica | Ecuación/estampa, tests del motor y fixture analítico | Test de regresión o analítico + `cargo test` + `cargo clippy -- -D warnings` | Unidades, tolerancia y rango de validez declarados |
| MCU o firmware | Cargador, decodificador, runtime, puentes de pines y tests | Tests de instrucciones/periféricos afectados + integración con la señal | Diferenciar carga, ejecución y fidelidad de periféricos |
| Persistencia/formato | Lector, escritor, validadores y fixtures compatibles | Round-trip + caso de versión previa/corrupta | No se pierden campos ni se aceptan datos inválidos en silencio |
| Cambio visual crítico | Modelo de UI, controlador, accesibilidad y auditorías existentes | Tests de UI + `npm run build`; `npm run audit:ui` cuando afecta el diseño global | Comportamiento y accesibilidad demostrados, no solo aspecto |
| Release | Versiones, contratos de feedback, cobertura, build y CI | `npm run release:check`; checks Rust que CI ejecuta | Comandos ejecutados, versiones coherentes y riesgos pendientes |

## Reglas de evidencia

- Cita archivos y pruebas exactos; no cites un directorio como si fuera evidencia.
- Si una medición es inestable, registra configuración, semilla, circuito de entrada y umbral antes de concluir que hay una regresión.
- Para resultados analógicos, usa tolerancias explícitas (`abs`, `rel` o ambas) y no igualdad exacta de punto flotante salvo que el contrato lo garantice.
- Para rendimiento, reporta hardware, tamaño de entrada, número de iteraciones y percentiles. Una única ejecución no demuestra rendimiento sostenido.
- La validación contra hardware o ngspice es evidencia externa: conserva versión, netlist/fixture y criterio de comparación. No la reemplaces con una animación de la UI.
