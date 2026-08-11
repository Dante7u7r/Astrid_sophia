# Modelo de amenazas del sistema de feedback

## Activos

- esquemas y netlists;
- firmware;
- resultados científicos;
- historial de errores;
- configuración del solver;
- notas del usuario;
- base SQLite y adjuntos;
- paquetes de soporte;
- recomendaciones y modelos.

## Fronteras

1. DOM/frontend → IPC Tauri.
2. IPC → validador Rust.
3. validador → cola/escritor SQLite.
4. base → exportador.
5. base → futuro puente Codex.
6. paquete exportado → destino elegido por el usuario.

## Amenazas y controles

| Amenaza | Ejemplo | Control obligatorio |
|---|---|---|
| Suplantación | evento con `sessionId` ajeno | sesión asignada y vinculada en Rust |
| Manipulación | cambiar `privacyClass` | correspondencia tipo/clase validada en Rust |
| Repetición | reenviar un lote | `eventId` único e inserción idempotente |
| Inyección | payload enorme o claves inesperadas | JSON Schema, `deny_unknown_fields`, cuotas |
| Fuga | ruta o firmware en error | códigos y fingerprints; listas de campos permitidos |
| Elevación | puente Codex escribe base | MCP de sólo lectura, API sin comandos de escritura |
| Denegación | millones de eventos | cola acotada, lotes limitados y rate limiting |
| Disco lleno | WAL o adjuntos sin límite | cuota, checkpoint, retención y alarma |
| Corrupción | cierre durante transacción | transacciones, recuperación y backup controlado |
| Modelo malicioso | reglas descargadas ejecutan código | formato declarativo y firma del proyecto |
| Envenenamiento | etiquetas falsas entrenan ajustes | procedencia, pesos, revisión y validación externa |
| Inferencia | huella revela circuito | sal local rotatoria y exportación re-hasheada |
| Repudio | paquete compartido sin saber contenido | manifiesto, reporte de redacción y confirmación |

## IPC

- Lote máximo: 100 eventos y 1 MiB.
- Evento máximo: 64 KiB.
- Rechazar NaN, infinito, enteros negativos y strings fuera de límite.
- No aceptar rutas ni bytes arbitrarios en eventos V1.
- El backend sobrescribe timestamps de recepción y no confía en orden del DOM.
- La capability de Tauri expone sólo los comandos concretos de feedback.

## SQLite

- Una cola de escritura.
- Sentencias preparadas.
- Migraciones dentro de transacción.
- `foreign_keys=ON`.
- `busy_timeout` acotado.
- Comprobación runtime de versión si se usa WAL.
- Integridad al arranque; una base dañada se aísla y no bloquea esquemas.
- Directorio privado de la aplicación, no una ruta elegida por el frontend.

## Exportación

- Nunca seguir symlinks de adjuntos.
- Construir desde IDs internos aprobados, no desde rutas recibidas.
- Nombres de archivo generados.
- Tamaño total limitado.
- ZIP sin rutas absolutas ni `..`.
- Hash por archivo y manifiesto.
- Cifrado opcional para contenido de usuario; la contraseña no se almacena.

## Aprendizaje

- Dataset con procedencia, versión y hash.
- Separación temporal train/evaluation.
- Reglas y modelos no ejecutan código.
- Sólo perfiles de solver permitidos.
- Kill switch local.
- Shadow mode por defecto.
- Rollback a modelo anterior.
- Matriz científica como gate independiente.

## Casos de abuso que deben tener prueba

1. evento con clase de privacidad incorrecta;
2. evento desconocido o versión futura;
3. lote duplicado;
4. payload de más de 64 KiB;
5. strings con rutas, tokens y contenido HEX;
6. ZIP traversal;
7. base truncada;
8. revocación durante un lote;
9. consulta MCP fuera de catálogo;
10. modelo que propone un perfil no permitido.
