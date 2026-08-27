# Rúbrica Heurística de Auto-Auditoría para Astryd Sophia

Esta guía contiene la lista exhaustiva de verificación para someter a prueba cualquier solución antes de presentarla o integrarla.

---

## 1. Dominio: Solvers Numéricos y Física MNA (Rust)

| Vector de Ataque | Pregunta Crítica | Criterio de Aceptación |
|---|---|---|
| **Matrices Singulares** | ¿Qué pasa si dos fuentes de tensión ideales están en paralelo o un inductor está en serie con una fuente de corriente ideal? | El solver debe detectar la singularidad antes o durante la factorización LU/KLU y retornar `Err(SimError::SingularMatrix)` sin hacer `panic!`. |
| **Paso Temporal y LTE** | ¿El control de paso adaptativo (LTE) puede caer en paso cero o oscilaciones trapezoidales (ringing)? | Implementar paso mínimo acotado (`min_step`), Gear-2 / Euler hacia atrás para damping cuando se detecte ringing. |
| **Limites de Diodos/Transistores (`pnjlim`)** | ¿El método Newton-Raphson diverge con tensiones directas altas ($V_D > 0.8\text{ V}$)? | Uso estricto de funciones de amortiguamiento `pnjlim` y `fetlim` para evitar desbordamiento exponencial $e^{V/V_T}$. |
| **Conservación de Energía / KCL** | ¿La suma de corrientes en cada nodo interno es $\sum I = 0$ dentro de la tolerancia de convergencia? | La tolerancia absoluta y relativa (`reltol=1e-3`, `abstol=1e-12`, `vntol=1e-6`) deben satisfacerse estrictamente. |
| **Paralelismo y Rayon** | ¿El cálculo paralelo introduce contención de locks o sobrecarga mayor que el cálculo secuencial? | Solo paralelizar sobre barridos de parámetros independientes (Monte Carlo, AC Sweep, sensibilidad); no sobre pasos temporales individuales fuertemente acoplados. |

---

## 2. Dominio: Visualización Canvas 2D & UX (TypeScript)

| Vector de Ataque | Pregunta Crítica | Criterio de Aceptación |
|---|---|---|
| **Coordenadas y Viewport** | ¿El zoom hacia el cursor (`zoom-to-pointer`) deriva la posición del mundo correctamente con DPR $\neq 1$? | Las transformaciones de matriz afín `(worldX * zoom + panX) * dpr` deben invertirse exactamente en el evento de puntero. |
| **Hit-Testing y Tolerancias** | ¿Es fácil seleccionar cables y componentes en pantallas táctiles o con ratón a alta resolución? | Radio de captura mínimo de 8–10 px en espacio de pantalla transformado a espacio de mundo. |
| **Serialización Numérica en Selects** | ¿Los valores de tiempo base horizontal en `<select>` coinciden con `val.toString()` exacto? | Nunca comparar cadenas en crudo cuando hay flotantes pequeños (`1e-8`); usar búsqueda por delta numérico tolerante (`Math.abs(a - b) < 1e-15`). |
| **Animación a 60 FPS** | ¿La renderización de partículas de flujo de corriente degrada el hilo principal del DOM? | Agrupar llamadas a `ctx.stroke()`, evitar allocaciones de objetos dentro del bucle de `render()`, y pausar rAF si el canvas está oculto (`isCanvasVisible`). |

---

## 3. Dominio: Interfaz y Comunicación Tauri IPC

| Vector de Ataque | Pregunta Crítica | Criterio de Aceptación |
|---|---|---|
| **Serialización Rust-TS** | ¿Las estructuras Rust con `#[serde(rename_all = "camelCase")]` coinciden 1:1 con las interfaces TS? | Validar esquemas y tipos; no confiar en campos opcionales que puedan llegar como `undefined` no manejado. |
| **Cancelación Reactiva** | Si el usuario presiona "Detener Simulación" en medio de un transitorio pesado, ¿el backend responde en $< 50\text{ ms}$? | Comprobar `cancel_token.is_cancelled()` en cada iteración del bucle temporal principal. |
| **Drenaje de Eventos** | ¿Se acumulan miles de eventos en la cola de Tauri si el frontend tarda en procesar? | El emisor Rust debe limitar la tasa a 60 FPS (16 ms) y drenar intermediarios (`rx.try_recv()`). |
