# ADR-0001 — Arquitectura de retroalimentación local-first

- Estado: aceptado
- Fecha: 2026-07-30
- Alcance: Fases 0–6

## Contexto

Astryd Sophia tiene telemetría efímera de CPU, RAM y FPS, pero no conserva
historial ni puede correlacionar un fallo con circuito, configuración, versión
y resultado posterior. Se necesita retroalimentación útil para el usuario, el
solver, el proyecto y Codex sin convertir la telemetría en una vía de fuga de
esquemas o firmware.

## Decisión

Adoptar una arquitectura local-first con cuatro fronteras:

1. `FeedbackBus` TypeScript recibe eventos tipados y forma lotes.
2. Un comando IPC Rust valida cada lote.
3. Un único actor Rust persiste y consulta SQLite.
4. Asesor, aprendizaje, exportador y puente Codex consumen vistas del almacén;
   no escriben directamente.

El catálogo JSON es la fuente única para JSON Schema, TypeScript y Rust. Cada
evento incluye versión, ID, sesión, aplicación, clase de privacidad, tipo y
payload discriminado.

## Propiedad de datos

- El usuario es propietario de los datos.
- La aplicación decide formato y retención, pero expone inspección, exportación
  y borrado.
- No hay endpoint remoto ni identificador de dispositivo en las primeras
  fases.
- Los adjuntos son objetos separados, opt-in y con menor retención.

## Consistencia

- `runId` correlaciona simulación, solver y UI.
- `sessionId` no identifica una persona ni deriva del hardware.
- `eventId` permite idempotencia.
- `schemaVersion` gobierna migraciones.
- `privacyClass` debe coincidir con el tipo de evento; Rust lo verifica.
- Tiempos de persistencia y orden final son asignados por el backend.

## Aprendizaje

El motor determinista precede al aprendizaje. El modelo sólo selecciona entre
perfiles aprobados y opera primero en modo sombra. Un fallo de validación
científica invalida la recompensa sin importar la mejora de rendimiento.

## Consecuencias

Positivas:

- contratos auditables;
- funcionamiento sin red;
- pruebas deterministas;
- eliminación centralizada;
- integración natural con Tauri;
- diagnósticos explicables.

Costes:

- migraciones de esquema;
- almacenamiento local;
- instrumentación explícita;
- más pruebas de privacidad;
- el aprendizaje necesita semanas de datos y no ofrece valor inmediato.

## Alternativas rechazadas

### LLM dentro de la aplicación

No ofrece una fuente de verdad física, incrementa tamaño y superficie de
ataque, y no resuelve el contrato ni la calidad de datos.

### Enviar todo a un servicio web

Contradice el carácter local del producto, expone propiedad intelectual y hace
depender diagnósticos básicos de conectividad e infraestructura externa.

### Archivos JSONL sin base

Son apropiados para exportación, pero no para migraciones, retención, consultas
concurrentes ni borrado selectivo.

### Instrumentar cada paso transitorio

El volumen alteraría el rendimiento que intenta medir. Se guardan agregados y
se adjuntan trazas sólo bajo solicitud.

## Condiciones para revisar este ADR

- necesidad demostrada de sincronización multi-equipo;
- piloto con múltiples usuarios y consentimiento legal aprobado;
- SQLite incapaz de cumplir el presupuesto medido;
- cambio de la frontera de seguridad Tauri;
- requisito verificable de inferencia remota.
