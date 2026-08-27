# 🚀 Biaani (Astrid Sophia) — Estado y Evolución del Proyecto

> Simulador de circuitos electrónicos de grado industrial con motor MNA en Rust y frontend reactivo en TypeScript/Canvas.
> **Stack:** Tauri v2 + Rust (backend MNA) + TypeScript/Canvas 2D (frontend)  
> **Última actualización:** Agosto 2026

---

## 📊 Resumen de Fases y Capacidades del Motor

| Fase | Módulo / Capacidad | Estado | Cobertura / Tests Clave |
|---|---|---|---|
| 1 | Estructura Tauri + IPC base | ✅ | `ping`, `get_performance_telemetry` |
| 2 | Solver DC lineal (MNA con LU) | ✅ | `test_voltage_divider`, `test_faer_linear_solver_resistive_divider` |
| 3 | Modelo de Diodo Shockley (Newton-Raphson) | ✅ | `test_diode_circuit`, `test_diode_clipper_transient` |
| 4 | Solver Transitorio (Backward Euler + paso adaptativo LTE) | ✅ | `test_rc_transient_circuit`, `test_lte_adaptive_timestep` |
| 5 | Fuentes senoidales, pulso, rampa, modulación | ✅ | `test_transient_isource_waveform` |
| 6 | Análisis AC (Bode) con Jacobiano complejo en frecuencia | ✅ | `test_ac_frequency_response`, `test_faer_linear_solver_complex_ac` |
| 7 | MOSFET NMOS/PMOS (Level 1 + subumbral) | ✅ | `test_nmos_transistor`, `test_pmos_transistor` |
| 8 | Op-Amp macro-modelo (saturación tanh, slew rate) | ✅ | `test_opamp_amplifier`, `test_opamp_slew_rate_limiting_transient` |
| 9 | BJT NPN/PNP (Ebers-Moll + Early + Miller) | ✅ | `test_bjt_amplifier`, `test_bjt_transient_delay` |
| 10 | Inversor CMOS transitorio completo | ✅ | `test_cmos_inverter_transient` |
| 11 | Capacidades dinámicas de juntura y difusión | ✅ | `test_mosfet_switching_with_commercial_cgs_cgd_miller` |
| 12 | DC Sweep (curva I-V) y Homotopía Arc-length | ✅ | `test_dc_sweep_diode_curve`, `test_dc_arclength_homotopy` |
| 13 | Parser SPICE jerárquico (.subckt, .model, .param, .lib) | ✅ | `test_commercial_opamp_macromodel_with_bsource_and_params` |
| 14 | Monte Carlo (tolerancias estadísticas Gaussian/Uniform) | ✅ | `test_monte_carlo_distribution` |
| 15 | FFT + THD espectral (Cooley-Tukey Radix-2 + Ventanas) | ✅ | `test_fft_sine_thd` |
| 16 | Convergencia robusta (Gmin stepping + PTA) | ✅ | `test_pta_robust_convergence` |
| 17 | Canvas vectorial interactivo (R-Tree spatial index, 60 FPS) | ✅ | `spatial_index.test.ts`, `multi_net_router.test.ts` |
| 18 | Telemetría del sistema en tiempo real (CPU, RAM) | ✅ | `telemetry::platform::tests` |
| 19 | Persistencia (.biaani / .astryd) y autosave | ✅ | `circuit_file.test.ts`, `circuit_snapshot_history.test.ts` |
| 20 | Ruido Espectral (.noise — Térmico, Shot, Flicker 1/f) | ✅ | `test_resistor_thermal_noise` |
| 21 | Evaluador .measure (DELAY, RISETIME, FALLTIME, RMS, etc.) | ✅ | `test_measure_propagation_delay` |
| 22 | Líneas de Transmisión RLCG (cascada Pi segmentada) | ✅ | `test_tline_expansion_segments`, `test_tline_lossy_expansion` |
| 23 | Simulación Electrotérmica Dinámica (autocalentamiento + disipadores) | ✅ | `test_transient_electrothermal`, `test_transient_thermal_igbt_switching_self_heating` |
| 24 | Análisis de Sensibilidad Paramétrica ($\partial V/\partial R$, peor caso) | ✅ | `test_dc_sensitivity_voltage_divider` |
| 25 | Integración Trapezoidal (TRAP) y BDF/Gear 2-6 | ✅ | `test_trap_integration_lc_resonance`, `test_gear2_integration_stability` |
| 26 | Análisis IMD/IP3 (intermodulación armónica) | ✅ | `test_imd_two_tone_clipper` |
| 27 | Optoelectrónica (LED Shockley + Optoacoplador galvánico CTR) | ✅ | `test_opto_isolation` |
| 28 | Electrónica de Potencia: IGBT (PT/NPT), SiC MOSFET, GaN HEMT | ✅ | `test_devices_igbt`, `test_sic_mosfet`, `test_gan_hemt` |
| 29 | Controladores de Potencia: SCR, TRIAC, DIAC | ✅ | `test_scr_phase_control` |
| 30 | Optimizador de Circuitos (Nelder-Mead / Gradiente) | ✅ | `test_optimizer_transient_settling_voltage_tuning` |
| 31 | Waveform Relaxation & Multi-rate Transient | ✅ | `test_wr_monolithic_dc_and_transient_exactness`, `test_wr_cascaded_cmos_inverter_chain` |
| 32 | Suite de Instrumentos Virtuales (Osciloscopio, Bode, Curve Tracer, Logic/FFT Analyzer, Eye Diagram) | ✅ | `oscilloscope_model.test.ts`, `curve_tracer_model.test.ts`, `logic_analyzer_model.test.ts` |
| 33 | Inspectores Simbólicos MNA y Subcircuitos | ✅ | `mna_symbolic_inspector.test.ts`, `subcircuit_inspector_modal.test.ts` |
| 34 | Co-simulación MCU Multiarquitectura (AVR, 8051, PIC, ESP32) | ✅ | `mcu-avr.test.ts`, `mcu-pic.test.ts`, `esp32_runtime.test.ts`, `mcu-spice-bridge.test.ts` |
| 35 | Parseo Universal de Notación Ingenieril y Unidades | ✅ | `spice_value_parser.test.ts` |
| 36 | Sistema de Onboarding y Guía Interactiva Paso a Paso | ✅ | `guide_engine.test.ts`, `guide_steps.test.ts` |
| 37 | Diagnóstico, Crash Reporting y Telemetría de Feedback | ✅ | `crash_reporter.test.ts`, `diagnostic_collector.test.ts` |

---

## 🧪 Resumen de Calidad y Testing

- **Backend Rust:** **289 tests unitarios y de integración pasando al 100%** (0 fallos).
- **Frontend TypeScript (Vitest):** **1099 tests en 205 archivos de prueba pasando al 100%**.
- **Build de producción:** `tsc && vite build` completado en ~6s con bundle optimizado por chunks.
- **Electrical Rule Check (ERC):** Verificación activa previa a cada corrida de simulación.

---

## 🧬 Arquitectura del Sistema

```
Astrid_sophia/
├── src/
│   ├── app/                      # Controladores de escritorio, ciclo de vida, persistencia y crash reporter
│   ├── canvas/                   # Motor vectorial Canvas 2D, R-Tree spatial index, renderizado modular
│   ├── components/               # Descriptores de componentes, catálogo, modelos comerciales
│   ├── feedback/                 # Módulo de diagnóstico, telemetría y bridge MCP
│   ├── guide/                    # Sistema de guía interactiva paso a paso
│   ├── intelligence/             # Asesor de diseño, optimizador y síntesis de topologías
│   ├── lsp/                      # Language Server SPICE con resaltado y diagnóstico
│   ├── persistence/              # Persistencia de circuitos (.biaani, .astryd)
│   ├── simulation/               # Runtimes MCU (AVR, PIC, ESP32, 8051), co-simulación MNA y fallback solvers
│   ├── ui/                       # Instrumentos virtuales, docks, modales y selector de temas
│   └── styles.css / themes.css   # Sistema de diseño dark-mode y temas para instrumentos
└── src-tauri/
    └── src/
        ├── solver/               # Motor MNA: solvers DC/AC/TRAP/Gear, optimizador, electrotérmica
        ├── parser/               # Parser SPICE jerárquico
        ├── sparse_csc.rs         # Matrices dispersas CSC y LU
        ├── dual3.rs              # Diferenciación automática
        └── lib.rs                # Comandos IPC Tauri
```
