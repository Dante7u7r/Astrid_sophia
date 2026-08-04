# Privacidad, consentimiento y retención

## Estado inicial

La persistencia de feedback está desactivada hasta que el usuario seleccione un
modo. No se interpreta el uso de la aplicación como consentimiento.

Modos:

| Modo | Persistencia | Exportación | Red |
|---|---|---|---|
| Desactivado | Ninguna | No | No |
| Local | Base privada local | Manual | No |
| Compartir al exportar | Base local | Revisión por paquete | No |
| Piloto opt-in | Futuro | Manual y lotes aprobados | Futuro |

Las Fases 0–6 sólo implementan los tres primeros.

## Clases

### `operational`

Duraciones, conteos, códigos de error, CPU, RAM, FPS y decisiones sobre
recomendaciones. No incluye topología ni contenido escrito.

### `circuit-derived`

Conteos del grafo, histogramas, huellas con sal local y resultados contra
referencias. No incluye IDs originales, valores completos ni netlist.

### `user-content`

Correcciones, notas y adjuntos enviados deliberadamente. Requiere una acción
explícita por cada envío.

## Datos prohibidos por defecto

- firmware, HEX o BIN;
- rutas de archivos y nombres de usuario;
- netlists o esquemas completos;
- comentarios y etiquetas originales;
- secretos, variables de entorno o credenciales;
- identificadores de hardware;
- dumps de memoria;
- trazas completas del osciloscopio.

El exportador vuelve a redactar aunque la persistencia ya haya sido redactada.

## Retención

| Dato | Retención inicial | Límite |
|---|---:|---:|
| Eventos operativos | 90 días | Dentro de 250 MB globales |
| Derivados de circuito | 90 días | Dentro de 250 MB globales |
| Feedback sin adjunto | 180 días | Dentro de 250 MB globales |
| Adjuntos opt-in | 30 días | 100 MB incluidos en el global |
| Auditoría de privacidad | 180 días | 25 000 entradas |

Al superar 250 MB se eliminan primero muestras de rendimiento antiguas,
después agregados reconstruibles. Nunca se elimina silenciosamente feedback
humano pendiente de exportar; se solicita decisión.

## Borrado

Acciones:

- eliminar una sesión;
- eliminar datos vencidos;
- eliminar adjuntos;
- eliminar todo.

`Eliminar todo` cierra el almacén, borra base y adjuntos y crea sólo una
confirmación efímera en memoria. No puede registrar en la misma base que acaba
de eliminarse.

## Identificadores

- IDs aleatorios sin MAC, SID, disco ni nombre de equipo.
- `sessionId` nuevo en cada arranque.
- La huella topológica usa una sal local rotatoria.
- Exportar reemplaza IDs por equivalentes específicos del paquete.
- No se puede unir paquetes distintos salvo que el usuario lo autorice.

## Revisión del paquete

Antes de guardar:

1. mostrar clases y cantidad de registros;
2. listar adjuntos;
3. ejecutar redacción;
4. mostrar el reporte de redacción;
5. exigir confirmación;
6. producir manifiesto y SHA-256.

## Derechos dentro de la aplicación

El Centro de inteligencia debe permitir ver, filtrar, exportar y borrar sin
usar herramientas externas. Revocar consentimiento detiene eventos nuevos de
inmediato; el usuario decide si conserva o elimina el historial.
