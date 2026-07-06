# 🚀 Astryd Sophia v3.0 Evolution — Estado del Proyecto

> Simulador de circuitos electrónicos de grado industrial (37 fases completadas).  
> **Stack:** Tauri + Rust (backend MNA) + TypeScript/Canvas (frontend)  

> **Prioridad actual:** estabilizacion exclusiva de Tauri escritorio en
> Windows. El navegador independiente y los layouts moviles quedan congelados.
> Consulta [`docs/desktop-roadmap.md`](docs/desktop-roadmap.md).
> **Última actualización:** 23 de junio de 2026

---

## 📊 Resumen de Fases Completadas

| Fase | Descripción | Estado | Tests |
|------|-------------|--------|-------|
| 1 | Estructura Tauri + IPC base | ✅ | — |
| 2 | Solver DC lineal (MNA con LU) | ✅ | `test_voltage_divider` |
| 3 | Modelo de Diodo Shockley (Newton-Raphson) | ✅ | `test_diode_circuit` |
| 4 | Solver Transitorio (Backward Euler + paso adaptativo LTE) | ✅ | `test_rc_transient_circuit` |
| 5 | Fuentes senoidales y de pulso | ✅ | — |
| 6 | Análisis AC (Bode) con Jacobiano en frecuencia | ✅ | `test_ac_frequency_response` |
| 7 | MOSFET NMOS (Level 1 + subthreshold) | ✅ | `test_nmos_transistor` |
| 8 | Op-Amp macro-modelo (tanh saturación) | ✅ | `test_opamp_amplifier` |
| 9 | MOSFET PMOS simétrico | ✅ | `test_pmos_transistor` |
| 10 | BJT NPN/PNP (Ebers-Moll + Early) | ✅ | `test_bjt_amplifier` |
| 11 | Inversor CMOS transitorio completo | ✅ | `test_cmos_inverter_transient` |
| 12 | Retardo de propagación BJT | ✅ | `test_bjt_transient_delay` |
| 13 | Capacidades dinámicas (diodo, MOSFET, BJT) | ✅ | — |
| 14 | DC Sweep (curva I-V) | ✅ | `test_dc_sweep_diode_curve` |
| 15 | Parser SPICE jerárquico (.subckt, .model, .ends) | ✅ | `test_spice_value_parser`, `test_spice_netlist_flattening` |
| 16 | Monte Carlo (tolerancias estadísticas) | ✅ | `test_monte_carlo_distribution` |
| 17 | FFT + THD espectral (Cooley-Tukey Radix-2) | ✅ | `test_fft_sine_thd` |
| 18 | Convergencia robusta (Gmin stepping + Source stepping) | ✅ | — |
| 19 | Canvas vectorial premium (zoom, pan, grid) | ✅ | — |
| 20 | Telemetría del sistema (CPU, RAM, proceso) | ✅ | — |
| 21 | Archivos .astryd (guardar/abrir esquemáticos) | ✅ | — |
| **22** | **Ruido Espectral (.noise)** — Térmico, shot, flicker 1/f | ✅ | `test_resistor_thermal_noise` |
| **23** | **Evaluador .measure** — DELAY, RISETIME, FALLTIME, PEAK, AVG, RMS, PP | ✅ | `test_measure_propagation_delay` |
| **24** | **Líneas de Transmisión RLCG** — Cascada Pi segmentada | ✅ | `test_tline_expansion_segments`, `test_tline_lossy_expansion` |
| **25** | **Deriva Térmica** — Varshni, Is(T), Vth(T), β(T), TC1/TC2 | ✅ | `test_thermal_is_pn_scaling`, `test_thermal_resistance_tc1`, `test_thermal_mosfet_vth_drift`, `test_thermal_mosfet_beta_degradation`, `test_diode_thermal_voltage_shift` |
| **26** | **Análisis de Sensibilidad Paramétrica** — ∂V/∂R, ∂V/∂C, Peor caso | ✅ | `test_dc_sensitivity_voltage_divider` |
| **27** | **Simulación de Envolvente (PSS)** — Shooting Method régimen permanente | ✅ | `test_pss_shooting_method_simple_rc` |
| **28** | **Modelos BSIM3v3 / BSIM4** — Fugas de compuerta, canal corto, DIBL | ✅ | `test_bsim4_nmos_gate_leakage`, `test_bsim4_pmos_short_channel_saturation` |
| **29** | **Análisis de Estabilidad (Polos y Ceros)** — Margen de fase y polos | ✅ | `test_stability_analysis_rc_pole`, `test_stability_zeros_extraction` |
| **30** | **Co-simulación Digital/Analógica Avanzada** — Retardos configurables y lógica ideal | ✅ | `test_logic_gate_configurable_delays`, `test_logic_gate_delay_parsing` |
| **31** | **Exportación Profesional** — Exportación a Touchstone, HDF5 y PDF | ✅ | `main.ts` |
| **32** | **GPU Acceleration (WebGPU)** — Schur complement en WebGPU | ✅ | `test_gpu_schur_solver` |
| **33** | **Integración Trapezoidal (TRAP)** — Regla TRAP 2.º orden y LTE de 3.ª derivada | ✅ | `test_trap_integration_lc_resonance` |
| **34** | **Newton-Raphson Amortiguado** — Backtracking Line Search y residuo KCL real | ✅ | `test_diode_circuit`, `test_bjt_amplifier` |
| **35** | **Pseudo-Transient Analysis (PTA)** — Bucle adaptativo DC ficticio amortiguado | ✅ | `test_pta_robust_convergence` |
| **36** | **Análisis de Distorsión por Intermodulación (IMD/IP3)** — Ratios IM2/IM3 y punto de intercepción IP3 | ✅ | `test_imd_two_tone_clipper` |
| **37** | **Dispositivos Optoelectrónicos** — LED (Shockley) y Optoacoplador (CTR, V_sat, acoplamiento óptico, aislamiento galvánico) | ✅ | `test_opto_isolation` |

**Total: 90 tests unitarios pasando al 100%** (solver.rs: 81, parser.rs: 8, gpu_solver.rs: 1)

---

## 🧬 Arquitectura Actual

```
Astrid_sophia/
├── src/                          # Frontend TypeScript
│   ├── main.ts                   # Lógica principal, IPC, oscilógrafo, Bode (~3200L)
│   ├── canvas_orchestrator.ts    # Motor de renderizado vectorial Canvas 2D (~1500L)
│   ├── styles.css                # Sistema de diseño premium (HSL)
│   ├── components.css            # Componentes de UI
│   └── simulation/               # Subsistema MCU
│       ├── index.ts              # Agregador de módulos MCU
│       ├── mcu-types.ts          # Tipos base (McuConfig, McuExecutionState)
│       ├── mcu-runtime.ts        # Runtime cycle-accurate (step/run/halt)
│       ├── mcu-8051.ts           # ISA 8051 (instruction-set accurate)
│       ├── mcu-avr.ts            # Definiciones AVR
│       └── mcu-spice-bridge.ts  # Co-simulación digital/analógica
├── src-tauri/src/                # Backend Rust
│   ├── solver.rs                 # ★ Motor MNA completo (~13500L)
│   │   ├── solve_dc_circuit          # DC con Newton-Raphson
│   │   ├── solve_transient_circuit   # Transitorio adaptativo (BE + LTE)
│   │   ├── solve_ac_sweep            # Bode (amplitud + fase)
│   │   ├── solve_dc_sweep            # Curva I-V paramétrica
│   │   ├── solve_noise_sweep         # Ruido espectral (Fase 22)
│   │   ├── evaluate_measures         # .measure automático (Fase 23)
│   │   ├── expand_transmission_line  # RLCG segmentado (Fase 24)
│   │   ├── apply_thermal_drift       # Deriva térmica (Fase 25)
│   │   ├── solve_dc_circuit_thermal  # DC con temperatura global
│   │   ├── solve_monte_carlo_transient
│   │   ├── solve_pss                 # PSS shooting method
│   │   ├── run_stability_analysis     # Polos/ceros, margen de fase
│   │   ├── calculate_fft_and_thd     # FFT Cooley-Tukey + THD
│   │   └── calculate_imd_analysis     # IMD/IP3 intermodulación
│   ├── parser.rs                 # Parser SPICE (.subckt, .model, .lib, VaExpr) (~2000L)
│   ├── sparse_csc.rs             # Matrices dispersas CSC + LU simbólico/numérico
│   ├── sparse_parallel.rs       # Schur complement paralelo (rayon)
│   ├── gpu_solver.rs             # Solver en GPU (WebGPU/wgpu)
│   ├── krylov.rs                 # Iteración de Arnoldi (polos de estabilidad)
│   ├── symbolic.rs               # Factorización simbólica (Markowitz)
│   ├── dual3.rs                  # Autodiff numérico 3.er orden
│   ├── topology.rs               # Detección de nodos flotantes y loops de voltaje
│   ├── telemetry.rs              # Métricas del sistema (CPU, RAM)
│   ├── lib.rs                    # Comandos IPC Tauri (20 endpoints)
│   ├── main.rs                   # Entry point Tauri
│   └── bin/
│       └── debug_scr.rs           # Binario auxiliar para debug de SCR
└── index.html                    # SPA principal
```

---

## 🔌 Comandos IPC Registrados (Tauri)

| # | Comando | Fase | Descripción |
|---|---------|------|-------------|
| 1 | `ping` | 1 | Health check |
| 2 | `run_dc_simulation` | 2 | Punto de operación DC |
| 3 | `run_transient_simulation` | 4 | Transitorio adaptativo |
| 4 | `run_ac_sweep` | 6 | Diagrama de Bode |
| 5 | `run_dc_sweep` | 14 | Curva I-V paramétrica |
| 6 | `parse_spice_netlist` | 15 | Parser SPICE jerárquico |
| 7 | `run_monte_carlo_transient` | 16 | Monte Carlo estadístico |
| 8 | `run_fft_analysis` | 17 | FFT + THD |
| 9 | `run_imd_analysis` | 36 | Intermodulación IMD/IP3 |
| 10 | `run_noise_sweep` | 22 | Ruido espectral |
| 11 | `evaluate_measures` | 23 | Mediciones automáticas |
| 12 | `expand_transmission_line` | 24 | Expansión de línea RLCG |
| 13 | `solve_dc_thermal` | 25 | DC con temperatura |
| 14 | `run_sensitivity_analysis` | 26 | Sensibilidad paramétrica |
| 15 | `run_pss_simulation` | 27 | PSS shooting method |
| 16 | `run_stability_analysis` | 29 | Polos, ceros, margen de fase |
| 17 | `get_performance_telemetry` | 20 | Métricas del sistema |
| 18 | `save_circuit_file` | 21 | Guardar esquemático (diálogo) |
| 19 | `save_circuit_to_path` | 21 | Guardar esquemático (ruta directa) |
| 20 | `open_circuit_file` | 21 | Abrir esquemático (diálogo) |

---

## 📦 Migración de Características Legacy (Electron -> Tauri)

| Fase | Descripción | Estado |
|------|-------------|--------|
| A.1 | Modularización de la UI (settings, telemetry, oscilloscope panels) | ✅ |
| A.2 | Actuadores Interactivos (lámpara, relé, zumbador + sintetizador de audio) | ✅ |
| A.3 | Integración de Emuladores de MCU (8051/AVR cycle-accurate en UI) | ✅ |
| A.4 | Navegador de Librerías y Gestor de Pestañas (buscador + workspace tabs) | ✅ |

---

## 🔮 Próximas Fases Sugeridas

Todas las fases del roadmap principal han sido completadas con éxito.

---

## 🧪 Cómo Ejecutar

```bash
# Backend (Rust tests)
cd src-tauri
cargo test

# Linter (Clippy)
cargo clippy --all-targets

# Frontend (TypeScript build)
npm run build

# Desarrollo completo (Tauri dev)
npm run tauri dev
```

---

## 📐 Constantes Físicas del Motor

| Constante | Valor | Descripción |
|-----------|-------|-------------|
| `PHYS_KB` | 1.380649×10⁻²³ J/K | Boltzmann |
| `PHYS_Q` | 1.602176634×10⁻¹⁹ C | Carga del electrón |
| `PHYS_T` | 300 K | Temperatura de referencia |
| `DIODE_IS` | 1×10⁻¹² A | Corriente de saturación |
| `DIODE_VT` | 25.852 mV | Voltaje térmico a 300K |
| `EG_SI_300` | 1.12 eV | Banda prohibida Si (Varshni) |
| `OPTO_RTH_JA` | 200 °C/W | Resistencia térmica opto DIP-4 |
| `OPTO_CTH` | 100 µJ/°C | Capacidad térmica opto DIP-4 |
| `OPTO_DEFAULT_CTR` | 0.5 | Current Transfer Ratio por defecto |
| `OPTO_DEFAULT_VSAT` | 0.2 V | Saturación suave del fototransistor |

---

> **Nota:** Este archivo se actualiza con cada bloque de fases completado.  
> Último commit: `chore: clippy auto-fix (33 sugerencias) + limpieza de artefactos obsoletos`
