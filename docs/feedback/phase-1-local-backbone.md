# Fase 1 — Columna vertebral local

Estado: implementada en código. La medición comparativa pendiente se completó
en la Fase 2; véase [Instrumentación útil](phase-2-instrumentation.md).

## Componentes

- `FeedbackBus` TypeScript con cola acotada, lotes y backpressure.
- Validación Rust contra el JSON Schema V1 antes de entrar al actor.
- Un único hilo propietario de la conexión SQLite.
- WAL, transacciones atómicas, checkpoint en cierre y claves idempotentes.
- Consentimiento `disabled`, `local` y `share-on-export`.
- Consulta paginada, extracción para exportador, borrado por sesión, vencidos o
  total.
- Retención y cuota lógica de 250 MiB.

La aplicación crea la base de metadatos al arrancar, pero el modo inicial es
`disabled` y ninguna fila de eventos se acepta hasta una acción explícita del
usuario. El ajuste vive en la propia base y no contiene telemetría.

## Límites IPC

| Límite | Valor |
|---|---:|
| Evento serializado | 64 KiB |
| Eventos por lote | 100 |
| Lote serializado | 1 MiB |
| Cola frontend | 4096 eventos |
| Cola de solicitudes al actor | 64 |
| Consulta interactiva | 500 eventos |
| Página para exportador | 10 000 eventos |

El lote es todo-o-nada ante errores de esquema o tamaño. Los `eventId`
duplicados son aceptados como duplicados idempotentes y no crean filas nuevas.
El contenido de usuario exige además `userContentConfirmed`.

## Backpressure

El frontend combina muestras de rendimiento pendientes. Si la cola se llena,
descarta primero una muestra de rendimiento. No expulsa silenciosamente un
evento de ciclo de vida para aceptar otra muestra.

Si falla IPC, el lote vuelve al frente de la cola y se incrementa
`flushFailures`. La ventana Tauri intercepta el cierre normal, emite
`session.ended`, vacía los lotes, solicita un checkpoint y sólo después destruye
la ventana.

## SQLite y recuperación

Ruta:

```text
<app_data_dir>/feedback/feedback.sqlite3
```

Configuración:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

Se usa SQLite enlazado de forma estática por `rusqlite` para no depender de una
versión del sistema. La versión empaquetada actual es SQLite 3.53.2 y el
arranque rechaza cualquier runtime anterior a 3.51.3.

Una transacción interrumpida antes de `COMMIT` no se hace visible. Hay una
prueba que abre de nuevo la base después de abandonar una transacción y verifica
que sólo permanezcan los eventos confirmados.

## Migraciones y rollback

`PRAGMA user_version` gobierna el esquema:

- `0 -> 1`: crea ajustes, eventos e índices dentro de una transacción inmediata.
- `1`: apertura normal.
- `> 1`: la aplicación se niega a abrir la base; no intenta degradarla.

Política para migraciones futuras:

1. checkpoint WAL;
2. cerrar la conexión;
3. copiar los tres archivos de SQLite a `pre-migration-v<N>`;
4. abrir y migrar dentro de una transacción;
5. ejecutar integridad y pruebas de lectura;
6. si falla, cerrar, conservar el error y restaurar los archivos respaldados.

No se implementó una falsa migración inversa para V1: no existe una versión
anterior con datos. El rollback actual consiste en que la transacción DDL se
revierte completa si falla.

## Borrado

- `expired`: aplica 90 días a datos operativos/derivados y 180 días a contenido
  humano.
- `session`: exige un `sessionId` válido.
- `all`: hace checkpoint, cierra SQLite, elimina base/WAL/SHM y adjuntos, crea
  una base V1 vacía y vuelve a `disabled`.

El borrado total no escribe un evento en la base recién creada.

## Comandos Tauri

- `ingest_feedback_batch`
- `set_feedback_consent`
- `get_feedback_status`
- `query_feedback_events`
- `export_feedback_events`
- `delete_feedback_data`
- `flush_feedback_store`

`export_feedback_events` es todavía una frontera de lectura paginada. El paquete
ZIP redactado y su interfaz pertenecen a las Fases 3 y 6.
