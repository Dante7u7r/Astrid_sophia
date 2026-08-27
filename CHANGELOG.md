# 📝 Changelog — Astrid Sophia (Biaani)

Todas las mejoras y cambios importantes en este proyecto.

---

## [0.38.0] - Agosto 2026

### 🚀 Nuevos Instrumentos y Módulos de Análisis
- **Optimizador de Circuitos:** Búsqueda y ajuste paramétrico automatizado basado en Nelder-Mead y descenso de gradiente para optimizar tiempos de establecimiento, voltajes de salida y frecuencias de corte.
- **Trazador de Curvas $I$-$V$ (Curve Tracer):** Visualización interactiva y dinámica de características de semiconductores (diodos, transistores BJT y MOSFETs).
- **Analizador Lógico Digital:** Instrumento virtual multicanal para rastreo y sincronización de buses y compuertas lógicas.
- **Analizador Espectral FFT Avanzado:** Muestreo en frecuencia con ventanas Hanning/Hamming/Blackman y cálculo de THD, SNR y SFDR.
- **Diagrama de Ojo (Eye Diagram):** Medición de jitter, apertura y márgenes de ruido en señales de alta velocidad.
- **Inspectores Simbólicos:** Inspector simbólico de matrices MNA ($[G][v] = [I]$) e inspector jerárquico de subcircuitos SPICE.
- **Selector de Temas de Instrumentos:** Soporte para paletas *Classic*, *Modern Dark*, *Cyberpunk* y *High Contrast*.

### ⚡ Modelos Físicos y Electrónica de Potencia
- **Modelos IGBT:** Implementación física de IGBTs PT (Punch-Through) y NPT (Non-Punch-Through) con modulación de conductividad de base.
- **Semiconductores Wide-Bandgap (WBG):** Modelos de SiC MOSFETs y GaN HEMTs con dinámica de carga ultrarrápida y conducción bidireccional.
- **Simulación Electrotérmica Dinámica:** Acoplamiento transitorio de autocalentamiento con redes térmicas RC y disipadores acoplados.
- **Homotopía Arc-Length:** Convergencia robusta en curvas $I$-$V$ no monótonas y puntos de bifurcación DC.

### 💻 Co-Simulación de Microcontroladores Ampliada
- **Runtimes MCU:** Expansión del soporte embebido a AVR (ATmega328P), PIC (PIC16F84A/PIC16F877A), 8051 y scaffold funcional ESP32.
- **Puente Digital-Analógico:** Intercambio continuo de estados 0, 1, X, Z con transistores y lógica de protección.

### 🎯 UX, Diagnóstico y Usabilidad
- **Parseo Universal de Notación Ingenieril:** Soporte bidireccional de abreviaturas científicas rápidas (`10uf`, `100k`, `1M`, `100r`, `4.7u`) y tolerancias en español/inglés.
- **Sistema de Onboarding y Guía Interactiva:** Guía paso a paso (`src/guide/`) para nuevos usuarios.
- **Crash Reporter y Diagnósticos:** Recolección segura y estructurada de diagnósticos de ejecución y reportes de fallo.

### 🧪 Validación y Calidad
- **Tests Frontend (Vitest):** **1099 pruebas pasando al 100%** en 205 suites de test.
- **Tests Backend (Rust):** **289 pruebas unitarias y de integración** pasando en verde sin advertencias de Clippy.

---

## [0.37.0] - Phase 37 Milestone (Junio 2026)

### Línea base de validación científica
- Añadido un arnés versionado en `validation/` con casos, referencias y reportes separados.
- Casos iniciales: divisor DC, filtro RC en frecuencia de corte y escalón RC en `t=τ`.
- Las tolerancias, unidades y derivaciones quedan almacenadas junto a cada referencia.
- `npm run validate:scientific` falla si una observación excede su error permitido.
- La línea base se ejecuta en CI y declara que `ngspice` todavía no aporta una referencia externa.

### Matriz científica de Fase 2
- Ampliada la suite a 7 casos y 29 observaciones: divisor DC, barrido Shockley, RC, RL,
  resonancia RLC y escalones RC/RL.
- Añadidas corrientes de rama, barrido DC y residuos KCL para DC, AC complejo y transitorio.
- Corregida la doble estampación transitoria de capacitores e inductores: sus aproximaciones DC
  ya no se suman a los companion models.
- Corregido el signo del término histórico del capacitor en el companion model TRAP.
- Añadida una regresión que verifica el primer paso RL y el residuo KCL del RC.
- Documentada la deuda restante: la primera muestra etiquetada `t=0` ya incorpora un paso.

### Matriz temporal de Fase 3
- Corregido el eje transitorio: cada resultado se etiqueta con el tiempo final del paso que
  realmente produjo la solución.
- Separados `dt` aceptado y `dt` candidato siguiente en el controlador adaptativo.
- El último paso se recorta para finalizar exactamente en `tMax`; no se generan puntos fuera
  del intervalo solicitado.
- Las fuentes dinámicas se evalúan en la misma coordenada temporal que se publica.
- TRAP arranca con un paso BE y después utiliza historia trapezoidal coherente.
- Eliminado el estampado transitorio duplicado de compuertas lógicas que competía con el
  planificador de eventos y generaba niveles intermedios falsos durante los retardos.
- La matriz científica crece a 9 casos y 35 observaciones e incorpora RC multipunto con
  BE, TRAP y Gear2.

### Correlación externa de Fase 4
- Integrado ngspice en ejecución batch como referencia viva; los casos externos fallan si el
  ejecutable no está disponible.
- Añadido parser validado del formato raw ASCII, incluidos fasores complejos e interpolación
  de la malla temporal adaptativa.
- Incorporadas correlaciones externas para divisor DC, filtro RC AC, escalón RC con TRAP y
  barrido no lineal de diodo Shockley.
- La matriz crece a 13 casos y 46 observaciones; la versión de ngspice queda en cada reporte.
- Añadido bootstrap portátil de ngspice 46 para Windows con SHA-256 fijado, sin instalación
  global ni modificación de `PATH`; CI instala ngspice explícitamente.

### Rendimiento de pruebas
- `test_scr_phase_control` conserva las verificaciones de bloqueo, disparo y apagado
  del SCR, pero usa una malla temporal ajustada a los puntos observados.
- Tiempo del test objetivo reducido de ~109.9 s a ~12-14 s en perfil debug.
- Suite Rust completa: 113 tests en ~13.5 s, sin tests ignorados.

### Calidad Rust
- Eliminada la excepción `clippy::upper_case_acronyms` del binding WinAPI de telemetría.
- El tipo interno `FileTime` conserva el layout ABI mediante `#[repr(C)]` y pruebas
  de tamaño, alineación y composición de sus palabras de 32 bits.
- Las declaraciones WinAPI quedan privadas al módulo que las utiliza.

### Pulido UX responsive
- Header móvil reorganizado en dos filas con acciones compactas y controles sin recorte.
- Footer de telemetría reducido a una sola línea estable en pantallas pequeñas.
- Objetivos táctiles ampliados, foco de teclado visible y soporte para movimiento reducido.
- La sincronización rutinaria del netlist ya no muestra errores ERC hasta que el usuario
  solicita una simulación o un chequeo explícito.
- La auditoría Playwright detecta controles recortados, regiones fuera de su banda,
  objetivos táctiles insuficientes, foco invisible y toasts inesperados.

### Planificado para v1.0
- [ ] Scripts de build (`build.sh`, `build.bat`)
- [ ] Tests de integración end-to-end
- [ ] Validación mejorada de netlist
- [ ] Tooltips en UI
- [ ] Organización de componentes por categorías

---

## [0.37.0] - Phase 37 Milestone (Junio 2026)

### ⚡ Motor de Simulación
- **MNA Solver Analítico** con matriz híbrida densa/esparcida (CSC)
- **Newton-Raphson amortiguado** con backtracking line search
- **Integración transient:** Backward Euler + Trapezoidal (TRAP) 2nd-order
- **Timestep adaptativo** basado en LTE (Local Truncation Error)
- **Análisis AC** con barrido de frecuencia y Jacobiano complejo
- **DC Operating Point** con pseudo-transient analysis (PTA)
- **Sensibilidad paramétrica** ∂V/∂R, ∂V/∂C con límites worst-case
- **Periodic Steady-State (PSS)** mediante shooting method
- **Stability Analysis experimental** con extracción reducida de polos/ceros, sin márgenes de lazo

### 🔌 Modelos de Dispositivos (20+)
- Pasivos: R, L, C, transformador con acoplamiento magnético
- Semiconductores: Diodo (Shockley), LED, BJT NPN/PNP (Ebers-Moll + Early)
- MOSFETs: NMOS/PMOS (Level 1 + subthreshold), BSIM3v3/BSIM4
- Macro-modelos: Op-amp con saturación tanh
- Interruptores: Switch con Ron/Roff e histéresis
- Líneas de transmisión: Segmentos Pi RLCG en cascada
- Electromecánicos: Relay, buzzer piezoeléctrico, lámpara térmica
- Optoelectrónica: Optoacoplador (CTR)
- Líneas de transmisión

### 🎛️ Co-Simulación Mixed-Signal
- **MCU 8051:** runtime temporal experimental a frecuencia nominal de 12 MHz
- **MCU AVR:** runtime temporal experimental a frecuencia nominal de 16 MHz
- **Hooks experimentales de eventos** por cruces de umbral analógico
- **Puente GPIO aproximado:** Estados digitales 0,1,X,Z como fuentes Thevenin/Norton
- **UI de depuración experimental:** firmware .hex y controles step/run/reset sin ISA completa

### 📊 Análisis Avanzado
- **PVT:** Process-Voltage-Temperature corner sweep (Commercial, Industrial, Automotive)
- **SPAR:** Extracción de S-Parameters con exportación Touchstone .sNp (MA/RI)
- **Monte Carlo:** Simulación estadística con tolerancias de componentes
- **FFT / IMD:** Análisis espectral (Cooley-Tukey radix-2) e intermodulación (IM2, IM3, IP3)
- **Noise:** Densidad espectral de ruido térmico, shot, flicker (1/f)
- **.measure:** Evaluador para DELAY, RISETIME, FALLTIME, PEAK, AVG, RMS, PP

### 🎨 Interfaz de Usuario
- **Canvas vectorial reactivo** con renderizado a 60 FPS
- **Enrutamiento ortogonal inteligente** (wires a 90°)
- **Osciloscopio dual-channel** con modos AC Bode / transient
- **Panel de telemetría** CPU/memoria vía Tauri IPC
- **Síntesis de audio PWM** Web Audio API para buzzers
- **Diseño dark-mode premium** con sistema de diseño consistente

### 🏗️ Arquitectura
- **Frontend TypeScript** (~5.6 strict) sin dependencias circulares
- **Backend Rust** (edition 2021) con 90+ tests unitarios
- **Tauri v2** para empaquetado desktop nativo
- **Módulos funcionales puros** en `src/simulation/`
- **Estado centralizado** en `circuit_state_manager.ts`

### ✅ Electrical Rule Check (ERC)
Validación automática antes de cada simulación:
- Referencia a tierra faltante (node "0")
- Fuentes de voltaje cortocircuitadas
- Fuentes de voltaje en paralelo (conflicto)
- Pines flotantes / componentes huérfanos

### 🧪 Calidad y Testing
- **12 tests frontend:** DSU, eliminación gaussiana, solver DC
- **90+ tests Rust:** Matrix operations, MNA convergence, device models
- **CI Pipeline:** Frontend build + Rust clippy + CodeQL scanning
- **Performance:** Test suite < 1s (actual: 410ms)

### 📦 Build y Despliegue
- **Vite** ^6.0 para bundling optimizado (43kB gzip production)
- **Comandos disponibles:**
  - `npm run dev` - Servidor desarrollo (puerto 1420)
  - `npm test` - Suite de tests unitarios
  - `npm run build` - Build producción TypeScript + Vite
  - `npm run empaquetar` - Build Tauri desktop bundle
- **Verificación Rust:** `cargo check`, `cargo clippy -- -D warnings`, `cargo test`

### 📈 Métricas de Performance
| Métrica | Target | Actual |
|---------|--------|--------|
| Canvas framerate | 60 FPS | ✅ 60 FPS |
| Interactive latency | < 16 ms | ✅ < 10 ms |
| MCU 8051 co-sim | 12 cycles/µs | ✅ 12 cycles/µs |
| MCU AVR co-sim | 16 cycles/µs | ✅ 16 cycles/µs |
| Test suite runtime | < 1 s | ✅ 410 ms |
| Production bundle | < 200 kB | ✅ 43 kB |

---

## [0.36.0] - Phase 36 (Mayo 2026)

*Nota: Historial detallado disponible en el sistema de versionado del repositorio.*

---

## Convenciones

- **Added:** Para nuevas funcionalidades.
- **Changed:** Para cambios en funcionalidades existentes.
- **Deprecated:** Para funcionalidades que serán removidas.
- **Removed:** Para funcionalidades eliminadas.
- **Fixed:** Para correcciones de bugs.
- **Security:** Para mejoras de seguridad.

---

*Formato basado en [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)*
