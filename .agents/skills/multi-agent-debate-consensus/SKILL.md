---
name: multi-agent-debate-consensus
description: Use when facing complex architectural decisions, ambiguous bug roots, numerical solver redesigns, or high-risk features requiring multi-perspective debate, consultation across specialized subagent roles/models (Pro/Flash/Inherit), and dialectical consensus.
---

# Skill: Multi-Agent Debate & Dialectical Consensus
**Revisión:** 1.0 — Protocolo de deliberación adversarial y convergencia de modelos

> **Alineación con `AGENTS.md`:** La verdad técnica y la evidencia empírica prevalecen sobre el consenso superficial. El propósito del debate entre modelos/subagentes no es promediar opiniones ni buscar un término medio mediocre, sino exponer contradicciones, contrastar hipótesis alternativas y converger en la solución óptima verificable.

---

## 1. Propósito y Cuándo Activar el Debate

En proyectos complejos con componentes híbridos (Tauri + Rust MNA + TypeScript Canvas + Emulación MCU), las soluciones individuales pueden adolecer de puntos ciegos o sesgos de anclaje. 

Esta skill se activa ante:
- **Decisiones arquitectónicas críticas:** Cambios en el motor de simulación, diseño de IPC, pipelines de renderizado o persistencia.
- **Bugs esquivos o intermitentes:** Problemas de convergencia Newton-Raphson, carreras en streams de telemetría o desincronización de hilos.
- **Dilemas de rendimiento vs exactitud:** Trade-offs entre paso de integración temporal, consumo de memoria y tasa de refresco a 60 FPS.
- **Validación de modelos físicos SPICE:** Nuevos modelos de componentes no lineales (MOSFET, BJT, Diodos, AmpOps macromodelados).

---

## 2. Roles del Comité de Deliberación

Para evitar el pensamiento grupal (*groupthink*), el debate se divide en roles complementarios y adversarios que pueden ejecutarse mediante `invoke_subagent` asignando modelos según su función:

```
                      ┌────────────────────────────────────────┐
                      │    AGENTE LÍDER / MODERADOR            │
                      │  (Orquesta, sintetiza y verifica)      │
                      └──────────────────┬─────────────────────┘
                                         │
                 ┌───────────────────────┼────────────────────────┐
                 ▼                       ▼                        ▼
      ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐
      │  ARQUITECTO        │  │  ABOGADO DEL       │  │  ESPECIALISTA EN   │
      │  DE SISTEMAS       │  │  DIABLO / AUDITOR  │  │  DOMINIO ESPECÍFICO│
      │  (Model: 'pro')    │  │  (Model: 'inherit')│  │  (Model: 'pro')    │
      │  - Viabilidad      │  │  - Edge cases      │  │  - MNA / Física    │
      │  - Robustez        │  │  - Placebo check   │  │  - Canvas / UX     │
      │  - Contratos IPC   │  │  - Fallos de escala│  │  - Rust Performance│
      └────────────────────┘  └────────────────────┘  └────────────────────┘
```

| Rol | Modelo Sugerido | Enfoque Principal |
|---|---|---|
| **Proponente / Arquitecto** | `pro` o `inherit` | Diseña la solución estructural, define tipos, interfaces y flujo de datos. |
| **Abogado del Diablo (Red Teamer)** | `pro` o `inherit` | Busca activamente vulnerabilidades, condiciones de carrera, casos límite, desbordamientos numéricos y violaciones de `AGENTS.md`. |
| **Especialista de Dominio (Física / MNA)** | `pro` | Evalúa matrices MNA, estabilidad de integración (Backward Euler vs Trapezoidal), convergencia NR y conservación física (KCL/KVL). |
| **Auditor de Rendimiento & Rust / TS** | `flash` o `inherit` | Audita asignaciones de memoria, complejidad algorítmica $O(n)$, contención de locks en Tokio/Rayon y presupuesto de cuadros (16 ms). |
| **Auditor de UX & Reglas de Proyecto** | `flash` | Verifica conformidad con UI en español, tokens CSS, accesibilidad y no-regresión de tests existentes. |

---

## 3. Protocolo de Debate en 4 Fases

```
┌─────────────────────────────────────────────────────────────┐
│ FASE 1: Formulación de la Tesis                             │
│ El moderador define el problema, restricciones y propuesta. │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ FASE 2: Interrogatorio Cruzado y Antítesis (Paralelo)       │
│ Subagentes analizan la propuesta independientemente.        │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ FASE 3: Refutación y Desempate Empírico                      │
│ Contraste de objeciones mediante pruebas y código real.     │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ FASE 4: Síntesis de Consenso Pareto-Óptimo                  │
│ Plan de implementación unificado con evidencias claras.     │
└─────────────────────────────────────────────────────────────┘
```

---

### Fase 1: Formulación de la Tesis
El agente principal redacta un documento conciso que establece:
1. **Problema:** Descripción exacta del fallo o requerimiento.
2. **Propuesta A (Tesis):** Algoritmo, estructura de datos o refactorización sugerida.
3. **Propuesta B (Alternativa):** Enfoque alternativo considerado.
4. **Criterios de Éxito:** Métricas de rendimiento, pruebas que deben pasar y límites invariantes.

---

### Fase 2: Interrogatorio Cruzado (Invocación de Subagentes)

Se lanzan subagentes especializados usando `invoke_subagent`.

Ejemplo de invocación de debate concurrente:
```json
{
  "Subagents": [
    {
      "TypeName": "self",
      "Role": "Adversarial Code Reviewer",
      "Model": "pro",
      "Prompt": "Actúa como Abogado del Diablo implacable. Analiza la siguiente propuesta técnica para el motor MNA de Astryd Sophia. Tu misión es encontrar al menos 3 formas en que esta propuesta puede fallar (condiciones de carrera, matrices singulares, memory leaks o casos borde). Sé directo y no suavices críticas.\n\nPropuesta: [DETALLES]"
    },
    {
      "TypeName": "self",
      "Role": "Physics & Solver Specialist",
      "Model": "pro",
      "Prompt": "Evalúa el impacto matemático y físico de la propuesta. Comprueba la estabilidad de integración numérica, el comportamiento con diodos/transistores no lineales y la conservación de leyes de Kirchhoff. Formula objeciones o mejoras numéricas.\n\nPropuesta: [DETALLES]"
    }
  ]
}
```

---

### Fase 3: Refutación y Desempate Empírico

Al recibir las respuestas de los subagentes:
1. **Identificar discrepancias reales:** ¿Discrepan sobre la corrección física, el rendimiento o la mantenibilidad?
2. **Prohibición de votación ciega:** Las disputas NO se resuelven por mayoría de votos de LLMs. Se resuelven mediante:
   - **Precedencia de verdad de `AGENTS.md`:** Código real ejecutado > tipos > documentación > teoría.
   - **Prueba empírica de laboratorio:** Ejecutar un microbenchmark en Rust o una prueba en Vitest que desempate la discusión con números reales.
3. Si un subagente plantea una objeción válida irrefutable, la tesis se descarta o modifica inmediatamente.

---

### Fase 4: Síntesis y Matriz de Decisión

El moderador consolida los resultados en una matriz de decisión:

| Dimensión | Opción 1 | Opción 2 | Opción de Consenso Síntesis |
|---|---|---|---|
| **Corrección Matemática** | Alta | Media | **Alta** (Adoptando damping de Opción 1) |
| **Sobrecarga de Memoria** | $O(N^2)$ | $O(N)$ (CSC) | **$O(N)$ (Formato Sparse CSC)** |
| **Tiempo de Respuesta IPC** | 5 ms | 0.5 ms | **0.5 ms** (Streaming binario) |
| **Riesgo de Regresión** | Bajo | Alto | **Bajo** (Manteniendo fallback) |

---

## 4. Prevención de Antipatrones de Debate

1. **Evitar la Complacencia Mutua (Echo Chamber):**
   - No instruyas a los subagentes a "estar de acuerdo". Instruye explícitamente a buscar puntos ciegos y errores.
2. **Evitar el Debate Infinito (Analysis Paralysis):**
   - Máximo 2 rondas de intercambio de mensajes. Si tras 2 rondas persiste la duda, se recurre a un test empírico inmediato.
3. **No Debatir Trivialidades:**
   - No activar comités de debate para renombrar variables, formatear CSS o corregir errores de sintaxis evidentes. Usar debate solo para decisiones con impacto arquitectónico o de corrección científica.
