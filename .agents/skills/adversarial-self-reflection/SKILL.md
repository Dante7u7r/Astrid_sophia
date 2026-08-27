---
name: adversarial-self-reflection
description: Use when self-evaluating, reviewing, diagnosing, or refining code, circuit simulation models, mathematical formulations, or bug fixes before finalizing changes. Enforces an internal adversarial critique and refinement loop to eliminate errors, placebos, and unverified assumptions.
---

# Skill: Adversarial Self-Reflection & Refinement
**Revisión:** 1.0 — Protocolo de auto-auditoría crítica y refinamiento continuo

> **Alineación con `AGENTS.md`:** Esta skill materializa los principios de verdad sin complacencia, cero respuestas placebo, distinción entre conocimiento e hipótesis, y rechazo a la cobardía epistémica. Antes de presentar una solución o dar por concluido un cambio, el agente debe actuar como su propio adversario más riguroso.

---

## 1. Propósito y Filosofía

Ningún código, fórmula física, análisis o diagnóstico debe ser emitido sin pasar por un filtro crítico implacable. Los modelos de lenguaje tienden naturalmente a la complacencia, al sesgo de confirmación y a soluciones cosméticas (placebos) que aparentan resolver un problema sin atacar la causa raíz.

Esta skill establece un **Bucle de Autorreflexión Adversaria (ASR Loop)** estructurado en 4 fases para:
1. Detectar fallos lógicos, matemáticos y de concurrencia antes de que toquen el repositorio.
2. Identificar y erradicar "parches placebo" (e.g. añadir `any`, suprimir warnings, ocultar excepciones con `catch` vacíos).
3. Contrastar cada afirmación contra invariantes físicos y contratos de tipos estrictos.
4. Validar empíricamente con pruebas reales ejecutadas (`npm test`, `cargo test`, `cargo clippy`).

---

## 2. El Bucle de Autorreflexión en 4 Fases

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Formulación de Candidato (Tesis con Invariantes)         │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Ataque Adversario Interno (El Abogado del Diablo)        │
│    - Casos extremos y valores límite                         │
│    - Detección de parches placebo y regresiones              │
│    - Violaciones de tipos, memoria y concurrencia            │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Puntuación y Rúbrica de Severidad                        │
│    ¿Existen defectos Bloqueantes o Mayores?                  │
└──────────────┬──────────────────────────────┬───────────────┘
               │ Sí                           │ No (Superado)
               ▼                              ▼
┌──────────────────────────────┐ ┌────────────────────────────┐
│ 4. Refactorización & Parche  │ │ 5. Verificación Empírica   │
│    (Re-auditar iterativamente│ │    (Tests, logs, build)    │
└──────────────┬───────────────┘ └────────────┬───────────────┘
               │                              │
               └─────────◄────────────────────┘ (Si fallan tests)
```

---

### Fase 1: Formulación con Invariantes Explícitos

Al redactar cualquier cambio de código, diseño o diagnóstico, declara explícitamente:
- **Objetivo exacto:** Qué problema resuelve y qué comportamiento altera.
- **Invariantes protegidos:** Qué propiedades del sistema NO deben romperse bajo ninguna circunstancia (e.g. conservación de carga, no-mutabilidad de netlist en simulación, UI en español, estrictez de tipos TypeScript).
- **Supuestos:** Qué precondiciones se asumen sobre las entradas, el estado del DOM o el solver de Rust.

---

### Fase 2: Ataque Adversario Interno ("El Abogado del Diablo")

Ponte en el papel de un revisor hostil que busca demostrar por qué la solución propuesta está **mal**, es **incompleta** o **peligrosa**. Ejecuta esta batería de interrogatorios:

#### A. Casos Límite y Datos Malformados (Boundary & Chaos Testing)
- ¿Qué ocurre si la entrada es `0`, `null`, `undefined`, `NaN`, `Infinity`, `""` o un array vacío `[]`?
- ¿Qué ocurre con valores extremadamente pequeños ($< 10^{-12}$) o gigantescos ($> 10^9$)? ¿Se rompe la serialización numérica JS (`1e-8` vs `0.00000001`)?
- ¿Qué sucede si una matriz MNA es singular, tiene ceros en la diagonal o no tiene referencia a GND (`nodo 0`)?
- ¿Qué pasa si el usuario interactúa mientras la simulación corre (hot mutation, zoom frenético, eliminación de nodo activo)?

#### B. Detección de Parches Placebo (Placebo Code Smell Check)
- ¿Estoy solucionando la causa raíz o solo ocultando el síntoma con un `try/catch`, un `if (x != null)` o un casting `as any`?
- ¿He modificado una prueba existente para que pase artificialmente en lugar de corregir la lógica?
- ¿He introducido dependencias o wrappers innecesarios que solo añaden capas de indirección sin valor real?
- ¿He puesto valores "mágicos" o constantes cableadas para que un caso específico funcione a costa de la generalidad?

#### C. Concurrencia, Ciclo de Vida y Fugas de Recursos
- En Rust: ¿Bloquea esta función el hilo de Tokio de Tauri? (¿Se usó `spawn_blocking` para CPU-bound?).
- En TypeScript: ¿Se limpian los listeners (`unlisten()`), `requestAnimationFrame`, `setInterval` o `ResizeObserver` al desmontar paneles?
- ¿Hay riesgo de condición de carrera si llegan eventos fuera de orden o si el usuario cancela y reinicia inmediatamente (`CancellationToken`, `runId`)?

#### D. Cumplimiento de Reglas del Proyecto y Estilo
- ¿Todos los textos visibles para el usuario están en **español**?
- ¿TypeScript compila con `strict: true`, `noUnusedLocals` y `noUnusedParameters`?
- ¿Rust pasa `cargo clippy -- -D warnings` sin warnings suprimidos injustificadamente?
- ¿Se respetan los tokens CSS y el sistema de diseño en modo oscuro?

---

### Fase 3: Rúbrica de Severidad y Clasificación

Evalúa cada hallazgo del ataque adversario según esta escala:

| Nivel | Definición | Acción Obligatoria |
|---|---|---|
| **P0 - Bloqueante** | Pánico en Rust, bucle infinito, pérdida de datos, cálculo físico erróneo, fallo de compilación o CI. | **Detenerse.** Prohibido aplicar el cambio. Rediseñar desde la raíz. |
| **P1 - Mayor** | Memory leak, listener huérfano, degradación severa de FPS, excepción no controlada en caso límite, UI rota. | Corregir en la iteración actual antes de presentar al usuario. |
| **P2 - Menor** | Inconsistencia de formato de unidades (e.g. `1.00kkHz`), texto en inglés, redundancia de cálculo no crítica. | Corregir inmediatamente. |
| **P3 - Deuda Técnica / Sugerencia** | Oportunidad de simplificación o microoptimización sin riesgo. | Registrar como observación si no impacta el objetivo actual. |

---

### Fase 4: Refactorización y Verificación Empírica

1. Si hay defectos **P0** o **P1**, aplica las correcciones necesarias y repite la Fase 2 sobre el nuevo código.
2. Una vez libre de defectos teóricos, ejecuta las pruebas reales correspondientes:
   ```bash
   # Para cambios en frontend:
   npm test
   npm run build
   
   # Para cambios en backend Rust:
   cd src-tauri && cargo check && cargo clippy -- -D warnings && cargo test
   ```
3. Si una prueba falla, **no asumas la causa**: examina el stack trace, aísla el comportamiento y vuelve a pasar por el bucle ASR.

---

## 3. Checklist de Auto-Auditoría Rápida

Antes de responder al usuario o marcar una tarea como completada, responde mentalmente con **SÍ/NO** a estas 6 preguntas:

```
[ ] 1. ¿Tengo evidencia ejecutable (tests/logs) de que la solución funciona y no es una ilusión?
[ ] 2. ¿He revisado los casos extremos (0, NaN, negativos, matrices singulares, strings vacíos)?
[ ] 3. ¿La solución preserva todos los contratos de tipos sin recurrir a 'any' o supresiones silenciosas?
[ ] 4. ¿Los recursos creados (timers, canales, listeners de Tauri, buffers) tienen ciclo de vida y limpieza clara?
[ ] 5. ¿Los textos de la interfaz y mensajes de error están 100% en español y con unidades coherentes?
[ ] 6. Si el usuario me preguntara "¿dónde puede fallar esto?", ¿tengo identificados los límites exactos de validez?
```

---

## 4. Plantilla de Informe de Auto-Reflexión (Para tareas complejas)

Al documentar refactorizaciones profundas o diagnósticos difíciles, puedes estructurar tu análisis interno así:

```markdown
### 🛡️ Registro de Auto-Reflexión Adversaria (ASR)
- **Tesis Propuesta:** [Descripción concisa del cambio o algoritmo]
- **Vulnerabilidades Identificadas en Auto-Ataque:**
  1. *Riesgo:* [e.g. Desincronización de time-step si el solver salta pasos grandes]
     *Mitigación aplicada:* [e.g. Interpolación LTE con clamping estricto]
  2. *Riesgo:* [e.g. Desbordamiento de memoria por frames no drenados en el canal MPSC]
     *Mitigación aplicada:* [e.g. Canal acotado a 256 con descarte selectivo de frames intermedios]
- **Invariantes Verificados:** [e.g. KCL en todos los nodos, sum(I) = 0]
- **Evidencia Empírica Obtenida:** [e.g. 177 tests de vitest pasando, 0 advertencias en clippy]
- **Límites Conocidos:** [e.g. No soporta fuentes de frecuencia variable en análisis DC de punto de operación]
```
