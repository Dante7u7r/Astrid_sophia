//! MNA solver — API pública congelada para IPC Tauri.
//!
//! Módulos internos:
//! - `types` — netlist y estructuras de resultados
//! - `matrix` — matrices dispersas y scheduler mixto
//! - `engine` — DC, transitorio, AC, análisis avanzado
//!
//! Comandos expuestos vía [`crate::lib`] (sin cambiar firmas):
//! `solve_dc_circuit`, `solve_transient_circuit`, `solve_ac_sweep`, `solve_dc_sweep`,
//! `solve_noise_sweep`, `solve_pss`, `run_stability_analysis`, `solve_dc_sensitivity`,
//! `solve_monte_carlo_transient`, `calculate_fft_and_thd`, `calculate_imd_analysis`,
//! `evaluate_measures`, `expand_transmission_line`, `apply_thermal_drift`, `solve_dc_circuit_thermal`.

mod engine;
pub mod matrix;
pub mod types;

pub use engine::*;
pub use matrix::*;
pub use types::*;
