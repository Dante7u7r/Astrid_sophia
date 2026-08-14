---
name: evidence-first-engineering
description: Obligatorio para analizar, diagnosticar, modificar, probar o documentar Astryd Sophia. Úsalo antes de afirmar capacidades o cambiar TypeScript, Rust, Tauri, simulación de circuitos, firmware/MCU, UX, rendimiento, persistencia o Git. Impone evidencia verificable, alcance mínimo, validación científica y resultados de prueba honestos.
---

# Ingeniería basada en evidencia

## Propósito y autoridad

Evita cambios especulativos y afirmaciones inventadas en Astryd Sophia. Esta skill es una puerta de calidad: aplica primero `AGENTS.md`, después el código y pruebas ejecutados del repositorio, y solo al final las referencias de otras skills.

Los ejemplos de `.opencode/skills/**/examples` son patrones, no implementación existente ni especificación del proyecto. Nunca copies uno sin comprobar las API, arquitectura y pruebas actuales.

## Flujo obligatorio

### 1. Clasifica la petición y conserva un registro de evidencia

Antes de actuar, clasifica la tarea: consulta, revisión, diagnóstico, cambio, afirmación científica, o entrega/release. Mantén un registro breve con:

- **Observado:** archivo, línea, salida de prueba, log o comportamiento reproducido.
- **Inferido:** conclusión que se sigue de la evidencia, marcada como inferencia.
- **Desconocido:** dato que el repositorio o las pruebas aún no demuestran.
- **Criterio de aceptación:** resultado observable que debe cumplir el cambio.

Expón ese registro al usuario cuando se diagnostique una causa, se hagan afirmaciones físicas o exista incertidumbre material. No conviertas una hipótesis del usuario ni una intuición propia en causa confirmada.

Si la petición pide solo análisis, revisión o explicación, no modifiques archivos. Si pide un cambio, encuentra antes la implementación real y el test más cercano con `rg`.

### 2. Establece la fuente de verdad

La precedencia es estricta:

1. Comportamiento reproducido y pruebas ejecutadas en el árbol actual.
2. Código fuente, contratos de tipos y configuración del árbol actual.
3. `AGENTS.md`, CI y documentación versionada actual.
4. Referencias de skills, documentación externa y recuerdos del modelo.

Cuando dos fuentes discrepen, dilo y sigue la de mayor precedencia. No inventes rutas, comandos, comandos Tauri, tipos, archivos, dependencias ni resultados de pruebas.

Consulta `references/verification-matrix.md` para escoger evidencia y pruebas proporcionales al riesgo.

### 3. Diseña un cambio pequeño y reversible

Define el invariante que no puede romperse y edita únicamente las capas necesarias. No reescribas módulos vecinos para “limpiar” código sin autorización explícita. Conserva cambios ajenos en un árbol sucio; jamás uses `reset --hard`, `checkout --`, borrados masivos, `git add .`, force-push ni sobrescribas trabajo no relacionado.

Para cambios concurrentes, asíncronos o de simulación, identifica explícitamente:

- Propietario del trabajo y de su cancelación.
- Identidad de ejecución (`runId`, token o equivalente) que impida que resultados antiguos alteren una ejecución nueva.
- Límite de duración, frecuencia de actualización y condición de parada.
- Estado físico que se conserva, reinicia o invalida al pausar, reanudar o modificar el circuito.

Una solución que solo oculta un síntoma, desactiva un error o añade `catch`/`any` sin preservar el contrato no es una corrección.

### 4. Reglas para ciencia, simulación y MCU

No llames a una capacidad “SPICE-level”, “en tiempo real”, “continua”, “exacta”, “validada” o “firmware emulado” sin delimitar qué código y prueba lo demuestran. Si el comportamiento es un modelo simplificado, fallback, mock o visualización, nómbralo así.

Todo cambio numérico debe declarar antes de editar:

- Ecuación, aproximación o invariante físico relevante.
- Unidades, signo, referencia de tierra y dominio temporal/frecuencial.
- Rango de validez, tolerancia y modo de fallo esperado.
- Oráculo de validación: resultado analítico, fixture controlado, regresión conocida o comparación externa autorizada.

Una traza puede ser una reproducción o una interpolación para dibujar, pero nunca se debe presentar como una muestra calculada si no lo es. Un transitorio con duración finita no es una simulación continua; repetir o interpolar datos no crea nuevos resultados físicos. La UI debe distinguir claramente estado vivo, resultados terminados y reproducción.

Para MCU/firmware, separa siempre: bytes cargados, decodificación de instrucciones, instrucciones realmente implementadas, periféricos modelados y acoplamiento eléctrico. Cargar un HEX o representar pines no prueba que el firmware se ejecute con fidelidad.

## Verificación y entrega

Ejecuta primero la prueba más cercana al cambio y después las verificaciones indicadas por la matriz. Para rutas críticas o cambios transversales, ejecuta `npm test` y `npm run build`; para Rust ejecuta desde `src-tauri/` los checks aplicables. No sustituyas una prueba por inspección visual ni una compilación por pruebas de comportamiento.

No escribas “probado”, “corregido”, “estable” o “listo para release” si el comando no se ejecutó y terminó correctamente. Si una verificación no se pudo ejecutar, informa el comando, el motivo y el riesgo residual. Un fallo de prueba se informa antes de proponer trabajo adicional; no se oculta cambiando el test para que pase.

El cierre de cada tarea de implementación o revisión debe indicar, de forma breve:

1. Qué cambió o qué se confirmó.
2. Evidencia y comandos realmente ejecutados, con resultado.
3. Límites, incertidumbres y verificaciones no realizadas.
4. Archivos afectados.

Solo crea commits o hace push cuando el usuario lo solicita de forma explícita.
