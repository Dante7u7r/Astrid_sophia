# Presupuesto de rendimiento

La instrumentación no es válida si altera de forma material el circuito o el
tiempo que pretende medir.

## Presupuestos

| Métrica | Objetivo | Fallo de release |
|---|---:|---:|
| Sobrecarga p95 de simulación | ≤ 2% | > 3% |
| Emisión frontend p95 | ≤ 0.10 ms | > 0.25 ms |
| CPU en reposo | ≤ 0.5% adicional | > 1% |
| Memoria estable | ≤ 16 MiB adicionales | > 32 MiB |
| Cola normal | < 25% de 4096 eventos | ≥ 75% sostenido |
| Escritura por lote p95 | ≤ 20 ms | > 50 ms |
| Consulta dashboard p95 | ≤ 100 ms | > 250 ms |
| Arranque añadido | ≤ 50 ms | > 150 ms |
| Base local | ≤ 250 MB | crecimiento sin cuota |
| Evento serializado | ≤ 64 KiB | cualquier aceptación mayor |
| Lote IPC | ≤ 100 eventos / 1 MiB | cualquier aceptación mayor |

## Política de muestreo

- Eventos de ciclo de vida: siempre, si hay consentimiento.
- Resumen de convergencia: uno por ejecución.
- Rendimiento: máximo una muestra cada 3 segundos.
- Pasos transitorios: agregados por ejecución, nunca un evento por paso.
- Errores repetidos: contar por fingerprint dentro de una ventana.
- Interacciones UI: sólo las necesarias para evaluar una recomendación o flujo.

## Backpressure

Cola fija de 4096 eventos:

1. preservar inicio, fin, fallo, feedback humano, exportación y borrado;
2. combinar muestras de rendimiento;
3. combinar contadores repetidos;
4. descartar primero rendimiento antiguo;
5. emitir un único contador `eventsDropped` en el siguiente resumen.

No bloquear el hilo UI esperando disco.

## Escritura

- lote cada 250 ms o al llegar a 100 eventos;
- transacción única;
- escritor Rust dedicado;
- checkpoint en inactividad si se usa WAL;
- consultas de dashboard sobre agregados e índices;
- adjuntos fuera de la tabla principal.

## Benchmarks

Comparar feedback desactivado, local vacío y local con 90 días simulados:

- circuitos de 252, 480 y 960 componentes;
- transitorio de un millón de muestras;
- 12 análisis consecutivos;
- 10 000 eventos sintéticos;
- cierre forzado durante commit;
- dashboard con 250 MB.

Cada benchmark conserva mediana, p95, p99, versión y hardware. CI cubre límites
funcionales; el gate de rendimiento se ejecuta en una máquina controlada para
evitar falsos fallos por ruido de runners compartidos.

La Fase 2 incorpora además un gate E2E nativo de 12 ejecuciones DC sobre 480
componentes. El 3 de agosto de 2026 midió 960.15 ms p95 desactivado (promedio
de series antes/después), 949.10 ms p95 local y 1.9 ms p95 de instrumentación
directa en un Ryzen 5 2600. La regresión total observada fue -1.15% (ruido/caché,
no aceleración) y el bloque directo, 0.20% del solver. Las diferencias crudas de
tiempo total permanecen en el log como diagnóstico, pero el E2E sólo bloquea por
el tramo síncrono ajeno al solver y por la instrumentación medida directamente.
La regresión total conserva su gate de 3% únicamente en una máquina controlada
con múltiples corridas e intervalos de confianza.
