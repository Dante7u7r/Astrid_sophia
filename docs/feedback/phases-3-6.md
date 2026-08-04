# Retroalimentación inteligente — Fases 3 a 6

## Estado verificable

| Fase | Estado | Límite pendiente |
|---|---|---|
| 3. Centro y feedback humano | Implementada | Requiere acumular uso real para comparar versiones con valor estadístico. |
| 4. Asesor determinista | Implementada en local | Las reglas están incluidas y versionadas con la aplicación; no existe descarga remota de paquetes. |
| 5. Aprendizaje en sombra | Pipeline y campaña local implementados; promoción bloqueada | La campaña automatizada pasó 500 ejecuciones del solver, pero no sustituye aceptación humana ni un piloto prospectivo de campo. El hash local es integridad, no firma de procedencia. |
| 6. Puente para Codex | Implementada sobre paquetes exportados | El usuario debe exportar y seleccionar explícitamente el paquete en cada sesión. |

No debe describirse la Fase 5 como validada en campo hasta completar el periodo
de uso real y la evaluación prospectiva. La campaña automatizada y la matriz
científica prueban el solver y los gates, no la utilidad del modelo para usuarios.

## Fase 3

El panel **Centro de inteligencia** permite:

- consultar conteos, espacio local, tasa de éxito y p95;
- filtrar el historial y revisar el JSON exacto de cada evento;
- comparar versiones presentes en el conjunto local;
- marcar un resultado como correcto, incierto o incorrecto;
- adjuntar valor esperado, unidad y comentario sólo con confirmación explícita;
- eliminar datos vencidos o borrar todo mediante confirmación escrita;
- exportar un paquete redactado V2.

El paquete reasigna identificadores y huellas, conserva únicamente relaciones
internas y contiene un resumen Markdown. Su esquema está en
`feedback/contracts/support-bundle.v2.schema.json`. El hash SHA-256 cubre
`events` y `summaryMarkdown`. No es una firma de autoría.

## Fase 4

El asesor contiene 21 reglas deterministas versionadas. Cada recomendación
incluye evidencia, explicación, confianza y clase de seguridad. Sólo los
ajustes marcados como reversibles pueden aplicarse; se comprueban límites
numéricos y el usuario puede deshacerlos. Las recomendaciones científicas y
los errores ERC son informativos, nunca se aplican automáticamente.

El resultado humano se registra como aceptado o rechazado. Cualquier regla se
puede desactivar localmente mediante su interruptor, sin descargar ni ejecutar
código externo.

## Fase 5

El extractor usa categorías operativas estables: análisis, tamaño del circuito,
cantidad de dispositivos no lineales, regla, aceptación y mejora declarada. No
usa netlist, firmware, rutas ni huellas como características.

El entrenamiento:

1. se bloquea por debajo de 500 ejecuciones convergidas;
2. exige al menos 10 sesiones y reserva sesiones completas posteriores como holdout;
3. estima aceptación por regla con suavizado beta e intervalo Wilson del 95 %;
4. compara Brier contra una probabilidad fija de 0.5 y calcula el intervalo del 95 % de la mejora;
5. registra dataset y modelo, conserva hasta cinco artefactos y permite rollback;
6. guarda un hash de integridad y declara explícitamente el artefacto como no firmado;
7. fija siempre `promoted: false`.

La campaña `phase5-local-solver-diversity-v1` ejecuta 500 combinaciones únicas
en 20 lotes cronológicos, cinco familias paramétricas y los modos DC, AC y
TRAN. Todas quedaron dentro de tolerancia. El reporte está en
`validation/reports/phase5-campaign.md`; puede regenerarse con:

```bash
npm run validate:phase5-campaign
npm run validate:scientific
```

La promoción requiere simultáneamente mejora Brier positiva en el límite
inferior del intervalo del 95 %, matriz científica sin regresión, firma de
procedencia verificada y piloto prospectivo real. La campaña local sólo cubre
el gate científico; no fabrica las otras evidencias.

No existe actuación automática del modelo. **Desactivar modelo de sombra**
elimina el artefacto local sin desactivar el asesor determinista.

## Fase 6 — uso del puente MCP

Requisito: Node.js 24, el mismo runtime fijado por el proyecto.

```bash
npm run feedback:mcp -- --bundle C:\ruta\astryd-feedback-xxxxxxxxxxxx.json
```

También puede pasarse la ruta mediante `ASTRYD_SUPPORT_BUNDLE`. La orden se
configura como servidor MCP de transporte stdio en el cliente compatible. El
servidor implementa la revisión `2025-11-25`, declara recursos y herramientas,
y no escribe en disco ni abre red.

Recursos:

- `astryd://support/summary`
- `astryd://support/manifest`
- `astryd://support/events`

Herramientas de sólo lectura:

- `list_failures`
- `compare_versions`
- `get_event`

Las consultas se registran como JSON en `stderr` durante la sesión, sin copiar
el contenido consultado. El servidor verifica formato, límite de 32 MiB y hash
antes de aceptar solicitudes. Al cerrar `stdin` el proceso descarta el paquete
y sale; por tanto el acceso queda revocado inmediatamente.

Referencias de protocolo:

- [Especificación MCP 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
- [Ciclo de vida](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)
- [Transporte stdio](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [Recursos](https://modelcontextprotocol.io/specification/2025-11-25/server/resources)
- [Herramientas](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)

## Pruebas relevantes

```bash
npm test -- --reporter=dot
npm run feedback:contracts:check
npm run build
```

`mcp_bridge.test.ts` abre el servidor como proceso real y comprueba que no
publica métodos de escritura, que rechaza `delete_all`, no altera el paquete y
sale al desconectarse. `advisor.test.ts` cubre el banco positivo/negativo y los
límites. `shadow_learning.test.ts` prueba bloqueo, reproducibilidad y corte
temporal. `intelligence_center.test.ts` valida redacción, reproducibilidad y el
JSON Schema del paquete.
