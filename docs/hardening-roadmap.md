# Hardening y pulido de escritorio

Fecha de inicio: 2026-07-12.

Alcance activo: aplicacion Tauri de escritorio. Web y movil quedan congeladas
como frentes futuros salvo que una prueba de escritorio use el preview web como
harness tecnico.

## Fase 1 - Inventario de riesgos reales

Estado: completada.

Hallazgos principales:

- Instrumentos:
  - `InstrumentsDock`, `SignalGeneratorInstrument`, `LogicAnalyzerInstrument`,
    `CurveTracerInstrument` y `FftAnalyzerInstrument` usan `callbacks: any`.
  - Riesgo: medio. Es una frontera UI compartida y ya fue fuente de problemas
    visuales y de flujo.
- Exportadores:
  - `ExporterPanel` usa `metadata: any`, `tranResults.map((r: any) => ...)` y
    `catch (err: any)`.
  - Riesgo: medio-alto. Exportar con estados incompletos puede fallar tarde.
- IPC/simulacion:
  - `SimulationController.applyResults`, `simulation_dispatcher` y `safeInvoke`
    todavia admiten resultados genericos.
  - Riesgo: alto si se cambia de golpe. Debe endurecerse comando por comando.
- Main/bootstrap:
  - Quedan casts puntuales: `orchestrator as any` para `gridSize` y
    `import.meta as any` para `env`.
  - Riesgo: bajo, pero son faciles de limpiar.
- Tests:
  - Hay casts `as unknown as ...` y algunos `any` en mocks.
  - Riesgo: bajo. No se priorizan salvo que oculten un bug o bloqueen tipos.
- QA Tauri:
  - La automatizacion de ventana puede generar capturas, pero no OCR confiable.
  - Riesgo: medio. La solucion correcta es exponer estado QA verificable desde
    la app en modo dev/audit, no depender de OCR.

Decisiones:

- No se eliminan todos los `any` indiscriminadamente.
- Se prioriza produccion sobre tests.
- `unknown` usado para parseo defensivo de JSON se mantiene.
- El hardening IPC se hara sin tocar el solver Rust salvo inconsistencia real.

## Fase 2 - Tipado de instrumentos

Estado: completada.

Cambios:

- Se agrego `src/ui/instrument_callbacks.ts`.
- `InstrumentsDock` ahora recibe `Partial<InstrumentCallbacks>` y completa lo
  faltante con callbacks no-op tipados.
- `SignalGeneratorInstrument`, `LogicAnalyzerInstrument`,
  `CurveTracerInstrument` y `FftAnalyzerInstrument` dejaron de usar
  `callbacks: any`.
- Se agrego `src/ui/instruments_dock.test.ts`.

Verificacion:

- `npx tsc --noEmit`: OK.
- `npm test`: 144 pruebas OK.

Limitacion:

- Esta fase tipa la frontera de callbacks. No rediseña los instrumentos ni
  corrige el mojibake de textos antiguos.

## Fase 3 - Tipado de exportadores

Estado: completada.

Cambios:

- `ExporterPanel` dejo de usar `metadata: any`.
- Se agregaron tipos `Hdf5LiteMetadata` y `Hdf5LiteDatasetMetadata`.
- Los mapas de resultados transitorios HDF5 ahora usan `TimeStepResult`.
- El `catch` del PDF ahora trata errores como `unknown` y los formatea con un
  helper seguro.
- Se agrego `src/ui/exporter_panel.test.ts`.

Verificacion:

- `npx tsc --noEmit`: OK.
- `npm test`: 145 pruebas OK.

Limitacion:

- Esta fase no valida visualmente el PDF ni el contenido binario completo del
  HDF5 Lite; valida que el flujo tipado genere descarga y log correcto.

## Fase 4 - Frontera IPC tipada

Estado: completada.

Cambios:

- Se agrego `src/simulation/tauri_commands.ts`.
- Se definieron contratos TS para:
  - `run_dc_simulation`;
  - `run_ac_sweep`;
  - `run_sensitivity_analysis`;
  - `run_pss_simulation`;
  - `run_stability_analysis`.
- `simulation_dispatcher.ts` reemplazo `invoke<any>` por `invokeTyped`.
- `SimulationController.applyResults` dejo de recibir `any` y usa
  `SimulationDispatchResult` con type guards.
- `fallbackTimeoutId` dejo de ser `any`.

Verificacion:

- `npx tsc --noEmit`: OK.
- `npm test`: 145 pruebas OK.

Limitacion:

- Esta fase cubre los comandos principales de simulacion. Aun quedan comandos
  auxiliares con wrapper generico (`open/save/export`, PVT y SPAR) que ya tienen
  tipos locales en sus controladores, pero no estan en un mapa IPC global.

## Fase 5 - QA E2E sin depender de OCR

Estado: completada.

Cambios:

- Se agrego `src/testing/qa_state.ts`.
- En modo dev/audit la app expone `window.__ASTRYD_QA__`.
- Tambien se sincronizan atributos `data-qa-*` en `document.documentElement`:
  - demo cargada;
  - modo de simulacion;
  - solver usado;
  - voltajes DC observados;
  - pestaña activa de instrumentos;
  - estado running.
- `main.ts` reporta logs, modo activo y estado de simulacion.
- `InstrumentsDock` reporta la pestaña activa.
- Se agrego `src/testing/qa_state.test.ts`.

Verificacion:

- `npx tsc --noEmit`: OK.
- `npm test`: 146 pruebas OK.

Limitacion:

- Esto no automatiza por si solo todos los clicks de Tauri. Crea la base
  verificable para que una prueba E2E lea estado estructurado en vez de depender
  de OCR o inspeccion visual manual.

## Fase 6 - Release e instalador

Estado: completada.

Cambios/verificacion:

- Se ejecuto `npm run empaquetar` despues de los cambios de hardening.
- Build production frontend: OK.
- Build Rust release: OK.
- Bundle NSIS generado:
  `src-tauri/target/release/bundle/nsis/Astryd Sophia_0.1.0_x64-setup.exe`.
- Smoke test del ejecutable release:
  `src-tauri/target/release/astryd-sophia.exe` abrio proceso y ventana
  `Astryd Sophia`, luego se cerro sin dejar procesos vivos.

Decision:

- No se hizo instalacion silenciosa global del NSIS porque puede modificar
  Program Files/registro del usuario. Para esta fase se valido generacion del
  instalador y arranque del binario release.

## Fase 7 - Limpieza global de tipos y casts

Estado: completada.

Cambios:

- Se elimino el cast `orchestrator as any` en `main.ts` haciendo mutable
  `CanvasOrchestrator.gridSize`.
- Se elimino el cast `import.meta as any`; Vite ya tipa `import.meta.env`.
- Se elimino el cast de `contextmenu` en `canvas_input_controller`.
- `AudioOrchestrator` tipa `webkitAudioContext` con una interfaz local.
- `co_simulation_worker` usa `AnalogEventTrigger | null` y `catch unknown`.
- `classifySimulationError` ahora recibe `unknown` y valida records.
- `OscilloscopePanel` normaliza trigger channel/edge sin `as any`.
- Adaptadores UI (`PropertyEditor`, `TabFileActions`, `TabManager`) usan
  `Record<string, unknown>` en args IPC.
- `TabManager` tipa `McuDebugPanel | null` y `SimulationControls | null`.
- `TelemetryPanel` usa `PerformanceTelemetryPayload` en `safeInvoke`.

Verificacion:

- `rg` ya no encuentra `any` productivo en `src` salvo la palabra en un
  comentario.
- `npx tsc --noEmit`: OK.
- `npm test`: 146 pruebas OK.
- `git diff --check`: OK, solo avisos CRLF existentes.

Limitacion:

- No se normalizo CRLF/LF para evitar churn masivo en archivos tocados por
  Windows/Git.

## Fase 8 - Cierre de producto hardening

Estado: completada.

Validacion final:

- `npm run build`: OK.
- `npm test`: 146 pruebas OK.
- `npm run audit:performance`: OK.
  - `stress-252`: mediana 3.20 ms, promedio 3.35 ms, maximo 8.40 ms.
  - `stress-480`: mediana 4.60 ms, promedio 4.73 ms, maximo 7.30 ms.
  - `stress-960-lod`: mediana 3.40 ms, promedio 3.47 ms, maximo 5.60 ms.
- `npm run audit:ui`: OK.
- `cargo check`: OK.
- `cargo clippy -- -D warnings`: OK.
- `cargo test`: 121 pruebas OK.
- `npm run empaquetar`: OK.
- Smoke test release:
  - `src-tauri/target/release/astryd-sophia.exe` abre ventana `Astryd Sophia`.
- Instalador final:
  - `src-tauri/target/release/bundle/nsis/Astryd Sophia_0.1.0_x64-setup.exe`.

Correccion durante cierre:

- La auditoria UI detecto que el centro de instrumentos abria sin foco en el
  boton cerrar. Se corrigio el flujo de foco desde `main.ts`,
  `PanelLayoutManager` y `AccessibleMenu`.

Estado honesto:

- Hardening de tipos de produccion completado: `rg` ya no encuentra `any` real
  en `src` fuera de tests, salvo la palabra en un comentario.
- La automatizacion Tauri aun no ejecuta todos los flujos por estado interno,
  pero la app ya expone `window.__ASTRYD_QA__`/`data-qa-*` para construir esa
  suite sin OCR.
- No se hizo instalacion/desinstalacion silenciosa del NSIS para no modificar el
  sistema del usuario sin una necesidad clara.
