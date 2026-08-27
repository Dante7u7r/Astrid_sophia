# Protocolos de Argumentación y Desempate Científico

Este documento define las reglas de interacción, intercambio de objeciones y resolución de discrepancias en debates técnicos de Astryd Sophia.

---

## 1. Reglas de Argumentación Válida

Toda afirmación dentro de un debate técnico debe sustentarse en una de las siguientes categorías de evidencia, ordenadas por peso probatorio:

1. **Evidencia Nivel A (Prueba Ejecutada):**
   - Salida directa de `cargo test`, `npm test`, benchmarks con `criterion` o perfiles de memoria.
   - *Ejemplo:* "El benchmark en `benches/sparse_bench.rs` muestra que la versión CSC reduce el tiempo de solución de 4.2 ms a 0.8 ms en una matriz de 500 nodos."

2. **Evidencia Nivel B (Demostración Matemática / Algorítmica Formal):**
   - Demostración de convergencia, estabilidad de Lyapunov, orden de consistencia $O(h^2)$ o análisis de complejidad asintótica.
   - *Ejemplo:* "El método Trapezoidal no disipa modos de alta frecuencia espurios en inductores rígidos (ringing trapezoidal); se requiere Gear-2 o TR-BDF2 para introducir L-estabilidad."

3. **Evidencia Nivel C (Contratos de Código y Tipos del Repositorio):**
   - Tipos de TypeScript (`strict`), definiciones de Rust en `src-tauri/src/solver.rs` y reglas de `tauri.conf.json`.

4. **Evidencia Nivel D (Heurística o Documentación Externa):**
   - Convenciones de SPICE 3f5, LTspice o literatura estándar.

Cualquier argumento basado en "parece mejor", "es más elegante" o "generalmente se hace así" sin respaldo en A, B o C es considerado **inválido** y debe ser desestimado por el moderador.

---

## 2. Falacias y Sesgos Prohibidos en el Debate

| Falacia / Sesgo | Manifestación en el Agente | Regla de Corrección |
|---|---|---|
| **Sesgo de Anclaje** | Un subagente asume que la primera propuesta es la correcta y solo sugiere cambios cosméticos. | Forzar al segundo subagente a proponer una solución diametralmente opuesta (e.g. iterativa vs matricial directa). |
| **Falso Dilema** | "O tenemos 60 FPS o tenemos precisión SPICE exacta". | Explorar arquitecturas desacopladas (solver en hilo nativo a paso adaptativo + interpolación visual a 60 FPS). |
| **Apelación a la Novedad** | "Deberíamos reescribir esto con una nueva librería externa porque es más moderna". | Prohibido añadir dependencias pesadas sin justificar que el código nativo existente no puede resolverlo. |
| **Complacencia Epistémica** | Dar la razón para cerrar el turno rápido sin verificar los casos límite. | El moderador debe rechazar consensos que no hayan respondido a la lista de casos borde. |

---

## 3. Protocolo de Desempate en Caso de Bloqueo

Si tras dos rondas de debate dos subagentes o modelos no alcanzan consenso:

1. **Aislamiento del Diferendo:** El moderador formula la pregunta exacta que divide a los agentes (e.g. "¿Debe el netlist serializarse como JSON plano o como buffer binario?").
2. **Generación de Micro-Test:** Se escribe un test temporal o script de benchmark mínimo en el workspace que mida objetivamente la métrica en disputa (tiempo de serialización, consumo de memoria, tasa de fallos).
3. **Sentencia por Datos:** La opción que demuestre mejor rendimiento o mayor robustez en el test se adopta automáticamente.
