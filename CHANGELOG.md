# 📝 Changelog — Astrid Sophia

Todas las mejoras y cambios importantes en este proyecto.

---

## [Unreleased] - En Desarrollo

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
- **Stability Analysis** con extracción de polos/ceros, phase/gain margin

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
- **MCU 8051:** Cycle-accurate a 12 MHz (12 ciclos/µs)
- **MCU AVR:** ATmega328P a 16 MHz (16 ciclos/µs)
- **Inyección de interrupciones** por cruces de umbral analógico
- **Puente GPIO SPICE:** Estados digitales 0,1,X,Z como fuentes Thevenin/Norton
- **Depuración en tiempo real:** Visualización de registros, firmware .hex, step/run/reset

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
