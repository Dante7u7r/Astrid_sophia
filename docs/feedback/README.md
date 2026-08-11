# Feedback inteligente — Fases 0, 1 y 2

Estado: contratos, columna vertebral local e instrumentación de ejecuciones
implementados. El dashboard y el feedback humano pertenecen a la Fase 3.

## Artefactos

- [ADR de arquitectura](adr-0001-feedback-architecture.md)
- [Privacidad y retencion](privacy-retention.md)
- [Modelo de amenazas](threat-model.md)
- [Presupuesto de rendimiento](performance-budget.md)
- [Wireframe del Centro de inteligencia](intelligence-center-wireframe.md)
- [Columna vertebral local — Fase 1](phase-1-local-backbone.md)
- [Instrumentación útil — Fase 2](phase-2-instrumentation.md)
- [Centro, asesor, aprendizaje en sombra y puente MCP — Fases 3 a 6](phases-3-6.md)
- [Roadmap completo](../intelligent-feedback-roadmap.md)
- [Catalogo fuente](../../feedback/contracts/catalog.v1.json)
- [JSON Schema generado](../../feedback/contracts/feedback-event.v1.schema.json)
- [Contrato TypeScript generado](../../src/feedback/contracts.generated.ts)
- [Contrato Rust generado](../../src-tauri/src/feedback/schema.generated.rs)

## Fuente unica

`feedback/contracts/catalog.v1.json` es el contrato editable. Los otros tres
artefactos son generados y no deben editarse a mano.

```bash
npm run feedback:contracts
npm run feedback:contracts:check
```

El primer comando regenera. El segundo compara byte por byte y falla si existe
deriva. CI debe ejecutar el modo `check` antes de compilar.

## Decisiones cerradas

- Sin persistencia hasta que el usuario seleccione un modo.
- Local-first; no hay transporte remoto en Fases 0–6.
- Una cola y un escritor Rust serán propietarios de SQLite.
- El frontend sólo emite eventos y consulta vistas.
- No se persisten netlists, firmware, rutas ni texto libre en nivel operativo.
- Aprendizaje inicialmente en modo sombra.
- Validación científica independiente de la recompensa de rendimiento.
- Codex sólo accede por exportación explícita o puente local de lectura.

## Salida de Fase 0

- [x] Arquitectura y fronteras.
- [x] Catálogo V1 con 18 eventos.
- [x] Tres clases de privacidad.
- [x] Tipos TypeScript y Rust desde una fuente común.
- [x] JSON Schema versionado.
- [x] Pruebas de unicidad, privacidad y round-trip Serde.
- [x] Retención, amenazas y presupuesto de rendimiento.
- [x] Wireframe accesible.
- [x] Integración del check de contratos en CI.

## Salida de Fase 1

- [x] `FeedbackBus` con lotes, reintento y backpressure.
- [x] Actor Rust como único propietario de SQLite.
- [x] Migración V1 transaccional y rechazo de versiones futuras.
- [x] Consentimiento desactivado por defecto y configurable en la aplicación.
- [x] Consulta, extracción para exportador, retención y borrado.
- [x] Límites de evento, lote, cola y almacenamiento.
- [x] Recuperación de transacciones interrumpidas comprobada.
- [x] Vaciado de la cola y checkpoint en cierre normal.
- [x] Gate comparativo de sobrecarga por análisis en escritorio real.

## Salida de Fase 2

- [x] Ciclo correlacionado para DC, AC, TRAN, SENS, PSS, STB, PVT y SPAR.
- [x] Observador IPC para DC sweep, transitorio directo, Monte Carlo, FFT, IMD,
  ruido, térmico y parser SPICE.
- [x] ERC, resumen de circuito, convergencia, exportadores y rendimiento.
- [x] Códigos estables; los mensajes sólo se conservan como huellas por sesión.
- [x] Prueba unitaria de privacidad y terminal único.
- [x] E2E nativo de correlación `runId`/`workspaceId`, ausencia de contenido y
  presupuesto de rendimiento.
