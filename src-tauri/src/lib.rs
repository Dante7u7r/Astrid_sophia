// Numerical simulation & MNA matrix engines require specific Clippy allowances:
// - `needless_range_loop`: Matrix algorithms (LU, CSC, Markowitz) index multiple coordinate arrays (r_count, c_count, col_max, rows) simultaneously.
// - `too_many_arguments`: Numerical solvers (Transient, Newton-Raphson, PSS) pass extensive circuit state contexts.
// - `float_cmp`: Zero/epsilon thresholding in sparse matrix storage and SPICE companion models.
// - `type_complexity`: Workspaces and higher-order automatic differentiation structures (AdValue/Dual3).
// - `approx_constant`: Explicit physical constants (KB, Q, VT) defined with full scientific precision.
#![allow(
    clippy::needless_range_loop,
    clippy::too_many_arguments,
    clippy::approx_constant,
    clippy::float_cmp,
    clippy::type_complexity
)]
pub mod ad_value;
mod advanced_ipc;
pub mod cloud_offload_service;
pub mod dual3;
pub mod feedback;
mod gpu_solver;
pub mod krylov;
pub mod mcu;
pub mod parser;
pub mod solver;
mod sparse_csc;
pub mod sparse_parallel;
mod symbolic;
pub mod telemetry;
mod topology;
pub mod wasm;

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "kind", content = "details")]
pub enum SimulationError {
    SingularMatrix {
        message: String,
        node: Option<String>,
    },
    MaxIterationsExceeded {
        message: String,
        component: Option<String>,
    },
    ConvergenceFailure {
        message: String,
        component: Option<String>,
    },
    InvalidCircuit {
        message: String,
        reason: String,
    },
    Unknown {
        message: String,
    },
}

impl std::fmt::Display for SimulationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SingularMatrix { message, .. } => write!(f, "{}", message),
            Self::MaxIterationsExceeded { message, .. } => write!(f, "{}", message),
            Self::ConvergenceFailure { message, .. } => write!(f, "{}", message),
            Self::InvalidCircuit { message, .. } => write!(f, "{}", message),
            Self::Unknown { message } => write!(f, "{}", message),
        }
    }
}

impl std::error::Error for SimulationError {}

impl From<String> for SimulationError {
    fn from(err: String) -> Self {
        if err.contains("singular") {
            let node = err
                .split("node ")
                .nth(1)
                .or_else(|| err.split("at ").nth(1))
                .map(|s| s.trim().to_string());
            SimulationError::SingularMatrix {
                message: "Matriz singular: circuito no resuelto. Puede haber un nodo flotante o falta de referencia a tierra.".to_string(),
                node,
            }
        } else if (err.contains("limit") || err.contains("max") || err.contains("iteration"))
            && !err.contains("debe")
            && !err.contains("excede")
        {
            let component = err
                .split("diode ")
                .nth(1)
                .or_else(|| err.split("on ").nth(1))
                .map(|s| s.trim().to_string());
            SimulationError::MaxIterationsExceeded {
                message: "Se ha excedido el límite máximo de iteraciones Newton-Raphson. Comprueba los componentes no lineales o las fuentes de excitación.".to_string(),
                component,
            }
        } else if err.contains("converg") {
            let component = err
                .split("diode ")
                .nth(1)
                .or_else(|| err.split("on ").nth(1))
                .map(|s| s.trim().to_string());
            SimulationError::ConvergenceFailure {
                message: "El solucionador Newton-Raphson no convergió al punto de operación."
                    .to_string(),
                component,
            }
        } else if err.contains("invalid")
            || err.contains("inválido")
            || err.contains("netlist")
            || err.contains("missing")
            || err.contains("Tierra")
            || err.contains("debe")
            || err.contains("excede")
        {
            SimulationError::InvalidCircuit {
                message: "Circuito o netlist inválida.".to_string(),
                reason: err.clone(),
            }
        } else {
            SimulationError::Unknown {
                message: format!("Error en el solver de Rust: {}", err),
            }
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ComponentMutation {
    pub component_id: String,
    pub field: String,
    pub value: f64,
    #[serde(default, skip_serializing)]
    pub run_id: u64,
}

pub struct SimulationControlState {
    pub is_running: Arc<AtomicBool>,
    pub is_paused: Arc<AtomicBool>,
    pub step_requested: Arc<AtomicU32>,
    pub active_run_id: Arc<AtomicU64>,
    pub hot_mutations: Arc<Mutex<Vec<ComponentMutation>>>,
    pub approved_circuit_paths: Arc<Mutex<HashSet<PathBuf>>>,
    pub speed_multiplier: Arc<Mutex<f64>>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SimulationFrame {
    pub run_id: u64,
    pub time: f64,
    pub node_voltages: HashMap<String, f64>,
    pub branch_currents: HashMap<String, f64>,
    pub frame_index: u64,
    pub is_final: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub batch_steps: Option<Vec<solver::TimeStepResult>>,
}

/// Control de cadencia cuadro a cuadro (60 FPS fluidos) para simulación interactiva.
/// En cada cuadro espera hasta cumplir los 16.66 ms de tiempo de pared (1/60 s),
/// permitiendo cambios instantáneos de velocidad multiplicadora sin saltos ni bloqueos.
fn pace_interactive_frame(
    last_frame_instant: std::time::Instant,
    is_running: &AtomicBool,
    active_run_id: &AtomicU64,
    run_id: u64,
    disable_pacing: bool,
    speed_multiplier: f64,
) -> bool {
    if disable_pacing || speed_multiplier >= 100.0 {
        return is_running.load(Ordering::SeqCst) && active_run_id.load(Ordering::SeqCst) == run_id;
    }

    let target_frame_duration = std::time::Duration::from_micros(16_666); // 60 FPS
    let elapsed = last_frame_instant.elapsed();
    if let Some(mut remaining) = target_frame_duration.checked_sub(elapsed) {
        let max_sleep = std::time::Duration::from_millis(2);
        while remaining > std::time::Duration::ZERO {
            if !is_running.load(Ordering::SeqCst) || active_run_id.load(Ordering::SeqCst) != run_id
            {
                return false;
            }
            std::thread::sleep(remaining.min(max_sleep));
            remaining = target_frame_duration.saturating_sub(last_frame_instant.elapsed());
        }
    }
    is_running.load(Ordering::SeqCst) && active_run_id.load(Ordering::SeqCst) == run_id
}

/// Algoritmo de decimación Min-Max con preservación estricta de picos para streaming interactivo.
/// Si un lote de simulación excede `max_target_points`, divide el intervalo temporal en bloques
/// y conserva para cada nodo el punto de entrada, el mínimo global, el máximo global y el punto de salida.
/// Esto comprime el tamaño del payload JSON en el canal IPC hasta en un 95% sin perder picos, ruidos ni transitorios reales.
pub fn decimate_transient_batch(
    steps: Vec<solver::TimeStepResult>,
    max_target_points: usize,
) -> Vec<solver::TimeStepResult> {
    let total = steps.len();
    if total <= max_target_points || max_target_points < 4 {
        return steps;
    }

    let num_buckets = (max_target_points / 4).max(1);
    let chunk_size = total / num_buckets;
    if chunk_size <= 1 {
        return steps;
    }

    let mut selected_indices = std::collections::BTreeSet::new();

    // Siempre incluir el primer y último paso
    selected_indices.insert(0);
    selected_indices.insert(total - 1);

    for b in 0..num_buckets {
        let start = b * chunk_size;
        let end = if b == num_buckets - 1 {
            total
        } else {
            (b + 1) * chunk_size
        };

        if start >= end {
            continue;
        }

        selected_indices.insert(start);
        selected_indices.insert(end - 1);

        let mut min_idx = start;
        let mut max_idx = start;
        let mut min_val = f64::INFINITY;
        let mut max_val = f64::NEG_INFINITY;

        for (idx, step) in steps[start..end].iter().enumerate() {
            let actual_idx = start + idx;
            for &v in step.node_voltages.values() {
                if v < min_val {
                    min_val = v;
                    min_idx = actual_idx;
                }
                if v > max_val {
                    max_val = v;
                    max_idx = actual_idx;
                }
            }
        }

        selected_indices.insert(min_idx);
        selected_indices.insert(max_idx);
    }

    let mut decimated = Vec::with_capacity(selected_indices.len());
    for idx in selected_indices {
        if idx < total {
            decimated.push(steps[idx].clone());
        }
    }

    decimated
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SimulationStreamError {
    pub run_id: u64,
    pub error: SimulationError,
}

fn numerical_settings(
    tolerance: Option<f64>,
    max_iterations: Option<usize>,
) -> solver::SolverNumericalSettings {
    let defaults = solver::SolverNumericalSettings::default();
    solver::SolverNumericalSettings {
        tolerance: tolerance.unwrap_or(defaults.tolerance),
        max_iterations: max_iterations.unwrap_or(defaults.max_iterations),
    }
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn ping() -> Result<String, String> {
    Ok("pong".to_string())
}

#[tauri::command]
async fn run_dc_simulation(
    netlist: solver::CircuitNetlist,
    tolerance: Option<f64>,
    max_iterations: Option<usize>,
) -> Result<solver::SimulationResult, SimulationError> {
    let netlist = parser::expand_netlist_subcircuits(&netlist).map_err(SimulationError::from)?;
    solver::solve_dc_circuit_with_numerical_settings(
        &netlist,
        numerical_settings(tolerance, max_iterations),
    )
    .map_err(SimulationError::from)
}

#[tauri::command]
async fn run_transient_simulation(
    netlist: solver::CircuitNetlist,
    settings: solver::TransientSettings,
    tolerance: Option<f64>,
    max_iterations: Option<usize>,
) -> Result<Vec<solver::TimeStepResult>, SimulationError> {
    let netlist = parser::expand_netlist_subcircuits(&netlist).map_err(SimulationError::from)?;
    solver::solve_transient_circuit_with_numerical_settings(
        &netlist,
        &settings,
        numerical_settings(tolerance, max_iterations),
    )
    .map_err(SimulationError::from)
}

#[tauri::command]
async fn run_transient_simulation_packed(
    netlist: solver::CircuitNetlist,
    settings: solver::TransientSettings,
    tolerance: Option<f64>,
    max_iterations: Option<usize>,
) -> Result<solver::PackedTransientResult, SimulationError> {
    let netlist = parser::expand_netlist_subcircuits(&netlist).map_err(SimulationError::from)?;
    let raw_steps = solver::solve_transient_circuit_with_numerical_settings(
        &netlist,
        &settings,
        numerical_settings(tolerance, max_iterations),
    )
    .map_err(SimulationError::from)?;
    Ok(solver::pack_transient_results(&raw_steps))
}

#[tauri::command]
async fn run_ac_sweep(
    netlist: solver::CircuitNetlist,
    settings: solver::AcSweepSettings,
) -> Result<solver::AcSweepResult, SimulationError> {
    let netlist = parser::expand_netlist_subcircuits(&netlist).map_err(SimulationError::from)?;
    solver::solve_ac_sweep(&netlist, &settings).map_err(SimulationError::from)
}

#[tauri::command]
async fn run_dc_sweep(
    netlist: solver::CircuitNetlist,
    settings: solver::DcSweepSettings,
) -> Result<solver::DcSweepResult, SimulationError> {
    let netlist = parser::expand_netlist_subcircuits(&netlist).map_err(SimulationError::from)?;
    solver::solve_dc_sweep(&netlist, &settings).map_err(SimulationError::from)
}

#[tauri::command]
async fn parse_spice_netlist(
    netlist_str: String,
) -> Result<solver::CircuitNetlist, SimulationError> {
    if netlist_str.len() > parser::MAX_SPICE_TEXT_BYTES {
        return Err(SimulationError::from(
            "El texto SPICE excede el limite de 10 MB.".to_string(),
        ));
    }
    if parser::contains_external_include_directive(&netlist_str) {
        return Err(SimulationError::from(
            "El parser IPC no puede leer archivos mediante .include/.lib; importa el contenido de la biblioteca de forma explicita."
                .to_string(),
        ));
    }
    parser::parse_spice_netlist_to_native(&netlist_str).map_err(SimulationError::from)
}

#[tauri::command]
async fn run_monte_carlo_transient(
    netlist: solver::CircuitNetlist,
    transient_settings: solver::TransientSettings,
    mc_settings: solver::MonteCarloSettings,
) -> Result<Vec<Vec<solver::TimeStepResult>>, SimulationError> {
    let netlist = parser::expand_netlist_subcircuits(&netlist).map_err(SimulationError::from)?;
    solver::solve_monte_carlo_transient(&netlist, &transient_settings, &mc_settings)
        .map_err(SimulationError::from)
}

#[tauri::command]
async fn run_fft_analysis(
    time_steps: Vec<solver::TimeStepResult>,
    node_name: String,
    fundamental_freq: f64,
) -> Result<solver::FftResult, SimulationError> {
    solver::calculate_fft_and_thd(&time_steps, &node_name, fundamental_freq)
        .map_err(SimulationError::from)
}

#[tauri::command]
async fn run_imd_analysis(
    time_steps: Vec<solver::TimeStepResult>,
    node_name: String,
    f1: f64,
    f2: f64,
) -> Result<solver::ImdResult, SimulationError> {
    solver::calculate_imd_analysis(&time_steps, &node_name, f1, f2).map_err(SimulationError::from)
}

#[tauri::command]
async fn run_noise_sweep(
    netlist: solver::CircuitNetlist,
    settings: solver::NoiseSweepSettings,
) -> Result<solver::NoiseSweepResult, SimulationError> {
    let netlist = parser::expand_netlist_subcircuits(&netlist).map_err(SimulationError::from)?;
    solver::solve_noise_sweep(&netlist, &settings).map_err(SimulationError::from)
}

#[tauri::command]
async fn evaluate_measures(
    time_steps: Vec<solver::TimeStepResult>,
    directives: Vec<solver::MeasureDirective>,
) -> Result<solver::MeasureResult, SimulationError> {
    Ok(solver::evaluate_measures(&time_steps, &directives))
}

#[tauri::command]
async fn expand_transmission_line(
    params: solver::TransmissionLineParams,
) -> Result<Vec<solver::ComponentData>, SimulationError> {
    solver::expand_transmission_line(&params).map_err(SimulationError::from)
}

#[tauri::command]
async fn run_sensitivity_analysis(
    netlist: solver::CircuitNetlist,
) -> Result<solver::SensitivityResult, SimulationError> {
    let netlist = parser::expand_netlist_subcircuits(&netlist).map_err(SimulationError::from)?;
    solver::solve_dc_sensitivity(&netlist).map_err(SimulationError::from)
}

#[tauri::command]
async fn solve_dc_thermal(
    netlist: solver::CircuitNetlist,
    temp_k: f64,
) -> Result<solver::SimulationResult, SimulationError> {
    let netlist = parser::expand_netlist_subcircuits(&netlist).map_err(SimulationError::from)?;
    solver::solve_dc_circuit_thermal(&netlist, temp_k).map_err(SimulationError::from)
}

#[tauri::command]
async fn run_pss_simulation(
    netlist: solver::CircuitNetlist,
    settings: solver::PssSettings,
) -> Result<Vec<solver::TimeStepResult>, SimulationError> {
    let netlist = parser::expand_netlist_subcircuits(&netlist).map_err(SimulationError::from)?;
    solver::solve_pss(&netlist, &settings).map_err(SimulationError::from)
}

#[tauri::command]
async fn run_stability_analysis(
    netlist: solver::CircuitNetlist,
) -> Result<solver::PoleZeroResult, SimulationError> {
    let netlist = parser::expand_netlist_subcircuits(&netlist).map_err(SimulationError::from)?;
    solver::run_stability_analysis(&netlist).map_err(SimulationError::from)
}

#[tauri::command]
async fn run_circuit_optimization(
    netlist: solver::CircuitNetlist,
    params: Vec<solver::OptimizableParam>,
    targets: Vec<solver::OptimizationTarget>,
    settings: Option<solver::OptimizationSettings>,
) -> Result<solver::OptimizationResult, SimulationError> {
    let netlist = parser::expand_netlist_subcircuits(&netlist).map_err(SimulationError::from)?;
    let settings = settings.unwrap_or_default();
    solver::solve_circuit_optimization(&netlist, &params, &targets, &settings)
        .map_err(SimulationError::from)
}

#[tauri::command]
fn inject_live_mutation(
    state: tauri::State<'_, SimulationControlState>,
    mutation: ComponentMutation,
) -> Result<(), SimulationError> {
    enqueue_live_mutation(&state, mutation)
}

fn enqueue_live_mutation(
    state: &SimulationControlState,
    mutation: ComponentMutation,
) -> Result<(), SimulationError> {
    if mutation.component_id.trim().is_empty() || mutation.component_id.len() > 128 {
        return Err(SimulationError::from(
            "La mutacion interactiva requiere un ID de componente valido.".to_string(),
        ));
    }
    let valid_fields = [
        "value",
        "amplitude",
        "frequency",
        "offset",
        "duty_cycle",
        "switch_state",
        "switch_ron",
        "switch_roff",
        "switch_vth",
        "switch_vh",
    ];
    if !valid_fields.contains(&mutation.field.as_str()) || !mutation.value.is_finite() {
        return Err(SimulationError::from(
            "La mutacion interactiva requiere un campo y valor valido.".to_string(),
        ));
    }
    if mutation.run_id == 0 || !state.is_running.load(Ordering::SeqCst) {
        return Err(SimulationError::from(
            "No hay una corrida transitoria activa para aplicar la mutación.".to_string(),
        ));
    }
    let mut queue = state
        .hot_mutations
        .lock()
        .map_err(|e| SimulationError::from(e.to_string()))?;
    // Conservar la identidad enviada por el productor: una petición tardía
    // nunca debe convertirse en una mutación de la corrida que la reemplazó.
    if mutation.run_id != state.active_run_id.load(Ordering::SeqCst)
        || !state.is_running.load(Ordering::SeqCst)
    {
        return Err(SimulationError::from(
            "La mutación pertenece a una corrida transitoria que ya no está activa.".to_string(),
        ));
    }
    if queue.len() >= 10_000 {
        return Err(SimulationError::from(
            "La cola de mutaciones interactivas excede el limite de 10 000 elementos.".to_string(),
        ));
    }
    queue.push(mutation);
    Ok(())
}

#[tauri::command]
async fn start_interactive_transient(
    window: tauri::Window,
    state: tauri::State<'_, SimulationControlState>,
    netlist: solver::CircuitNetlist,
    settings: solver::TransientSettings,
    run_id: u64,
    tolerance: Option<f64>,
    max_iterations: Option<usize>,
    disable_pacing: Option<bool>,
    speed_multiplier: Option<f64>,
) -> Result<(), SimulationError> {
    if run_id == 0 {
        return Err(SimulationError::from(
            "El identificador de corrida debe ser mayor que cero.".to_string(),
        ));
    }
    settings
        .validate_interactive()
        .map_err(SimulationError::from)?;
    let mut effective_settings = settings.clone();
    if effective_settings.t_max <= 0.0 || !effective_settings.t_max.is_finite() {
        effective_settings.t_max = 1e12; // Modo continuo indefinido
    }
    let numerical_settings = numerical_settings(tolerance, max_iterations);
    numerical_settings
        .validate()
        .map_err(SimulationError::from)?;
    let netlist = parser::expand_netlist_subcircuits(&netlist).map_err(SimulationError::from)?;
    let disable_pacing_flag = disable_pacing.unwrap_or(false)
        || std::env::var("BIAANI_DISABLE_PACING")
            .or_else(|_| std::env::var("ASTRYD_DISABLE_PACING"))
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);

    state.active_run_id.store(run_id, Ordering::SeqCst);
    state.is_running.store(true, Ordering::SeqCst);
    state.is_paused.store(false, Ordering::SeqCst);
    state.step_requested.store(0, Ordering::SeqCst);
    if let Ok(mut mutations) = state.hot_mutations.lock() {
        mutations.clear();
    }
    if let Some(speed) = speed_multiplier {
        if let Ok(mut mult) = state.speed_multiplier.lock() {
            *mult = speed.max(0.01);
        }
    }
    let is_running = state.is_running.clone();
    let is_paused = state.is_paused.clone();
    let step_requested = state.step_requested.clone();
    let active_run_id = state.active_run_id.clone();
    let hot_mutations = state.hot_mutations.clone();
    let speed_multiplier_arc = state.speed_multiplier.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let window_inner = window.clone();
        let window_panic = window.clone();
        let is_running_inner = is_running.clone();
        let is_paused_inner = is_paused.clone();
        let step_requested_inner = step_requested.clone();
        let active_run_id_inner = active_run_id.clone();
        let panic_run_id = active_run_id.clone();

        let catch_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            let mut frame_index = 0u64;
            let mut batch: Vec<solver::TimeStepResult> = Vec::with_capacity(512);
            let mut last_frame_sim_time = 0.0_f64;
            let mut last_pushed_time = 0.0_f64;
            let mut last_frame_wall_time = std::time::Instant::now();
            let final_is_running = is_running_inner.clone();
            let final_active_run_id = active_run_id_inner.clone();
            let final_speed_arc = speed_multiplier_arc.clone();

            // Intervalo mínimo de sub-muestreo para no saturar el IPC en transiciones ultra rápidas (LTE adaptativo)
            let min_batch_interval = (effective_settings.dt * 0.25).max(1e-7);

            let result = solver::solve_transient_circuit_inner(
                &netlist,
                &effective_settings,
                HashMap::new(),
                HashMap::new(),
                numerical_settings,
                Some(hot_mutations),
                Some(run_id),
                Some(|step: &solver::TimeStepResult| -> bool {
                    if !is_running_inner.load(Ordering::SeqCst)
                        || active_run_id_inner.load(Ordering::SeqCst) != run_id
                    {
                        return false;
                    }

                    // Manejo de pausa interactiva y avance paso a paso
                    while is_running_inner.load(Ordering::SeqCst)
                        && active_run_id_inner.load(Ordering::SeqCst) == run_id
                        && is_paused_inner.load(Ordering::SeqCst)
                        && step_requested_inner.load(Ordering::SeqCst) == 0
                    {
                        std::thread::sleep(std::time::Duration::from_millis(4));
                        last_frame_wall_time = std::time::Instant::now();
                    }

                    if !is_running_inner.load(Ordering::SeqCst)
                        || active_run_id_inner.load(Ordering::SeqCst) != run_id
                    {
                        return false;
                    }

                    let is_stepping = step_requested_inner.load(Ordering::SeqCst) > 0;
                    if is_stepping {
                        step_requested_inner.fetch_sub(1, Ordering::SeqCst);
                    }

                    if batch.is_empty() || step.time - last_pushed_time >= min_batch_interval {
                        batch.push(step.clone());
                        last_pushed_time = step.time;
                    }

                    let current_speed = speed_multiplier_arc
                        .lock()
                        .map(|s| *s)
                        .unwrap_or(1.0)
                        .max(0.01);
                    let sim_advance = step.time - last_frame_sim_time;
                    let target_sim_advance = (1.0_f64 / 60.0_f64) * current_speed;
                    let wall_elapsed = last_frame_wall_time.elapsed();
                    let target_wall_frame = std::time::Duration::from_micros(16_666); // 60 FPS (~16.6 ms)

                    let should_emit = if is_stepping {
                        true
                    } else if frame_index == 0 {
                        // Frame 0: emitir de inmediato (primeros 20 pasos o 2ms) para respuesta visual instantánea
                        batch.len() >= 20 || wall_elapsed >= std::time::Duration::from_millis(2)
                    } else {
                        // Frames posteriores: emitir cuando se cumpla el avance objetivo de simulación (velocidad deseada),
                        // O si ya transcurrieron 16.6 ms de tiempo real (garantizando 60 FPS bajo cualquier carga).
                        sim_advance >= target_sim_advance || wall_elapsed >= target_wall_frame
                    };

                    if should_emit {
                        if frame_index > 0
                            && !is_stepping
                            && !pace_interactive_frame(
                                last_frame_wall_time,
                                &is_running_inner,
                                &active_run_id_inner,
                                run_id,
                                disable_pacing_flag,
                                current_speed,
                            )
                        {
                            return false;
                        }
                        if batch.last().map(|s| s.time != step.time).unwrap_or(true) {
                            batch.push(step.clone());
                            last_pushed_time = step.time;
                        }
                        let raw_batch = std::mem::take(&mut batch);
                        let steps_to_send = decimate_transient_batch(raw_batch, 500);
                        let packet = SimulationFrame {
                            run_id,
                            time: step.time,
                            node_voltages: step.node_voltages.clone(),
                            branch_currents: step.branch_currents.clone(),
                            frame_index,
                            is_final: false,
                            batch_steps: Some(steps_to_send),
                        };
                        window_inner.emit("sim-frame-update", &packet).ok();
                        frame_index += 1;
                        last_frame_sim_time = step.time;
                        last_frame_wall_time = std::time::Instant::now();
                    }
                    true
                }),
            );

            if final_is_running.load(Ordering::SeqCst)
                && final_active_run_id.load(Ordering::SeqCst) == run_id
            {
                let final_speed = final_speed_arc.lock().map(|s| *s).unwrap_or(1.0);
                if let Ok((ref results, _, _)) = result {
                    if let Some(last) = results.last() {
                        if !pace_interactive_frame(
                            last_frame_wall_time,
                            &final_is_running,
                            &final_active_run_id,
                            run_id,
                            disable_pacing_flag,
                            final_speed,
                        ) {
                            return;
                        }
                        let steps_to_send = if !batch.is_empty() {
                            Some(decimate_transient_batch(std::mem::take(&mut batch), 500))
                        } else {
                            None
                        };
                        let packet = SimulationFrame {
                            run_id,
                            time: last.time,
                            node_voltages: last.node_voltages.clone(),
                            branch_currents: last.branch_currents.clone(),
                            frame_index,
                            is_final: true,
                            batch_steps: steps_to_send,
                        };
                        window_inner.emit("sim-frame-update", &packet).ok();
                    }
                }
                if let Err(ref e) = result {
                    window_inner
                        .emit(
                            "sim-frame-error",
                            &SimulationStreamError {
                                run_id,
                                error: SimulationError::from(e.clone()),
                            },
                        )
                        .ok();
                }
            }
        }));

        if catch_result.is_err() && panic_run_id.load(Ordering::SeqCst) == run_id {
            window_panic
                .emit(
                    "sim-frame-error",
                    &SimulationStreamError {
                        run_id,
                        error: SimulationError::Unknown {
                            message: "Pánico inesperado en el motor de simulación de Rust"
                                .to_string(),
                        },
                    },
                )
                .ok();
        }

        if active_run_id
            .compare_exchange(run_id, 0, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            is_running.store(false, Ordering::SeqCst);
        }
    });

    Ok(())
}

#[tauri::command]
fn set_interactive_simulation_speed(
    state: tauri::State<'_, SimulationControlState>,
    speed: f64,
) -> Result<(), String> {
    if speed <= 0.0 || !speed.is_finite() {
        return Err("La velocidad debe ser un número positivo finito.".to_string());
    }
    if let Ok(mut mult) = state.speed_multiplier.lock() {
        *mult = speed;
    }
    Ok(())
}

#[tauri::command]
fn stop_interactive_transient(
    state: tauri::State<'_, SimulationControlState>,
    run_id: Option<u64>,
) -> Result<(), String> {
    let active_run_id = state.active_run_id.load(Ordering::SeqCst);
    if run_id.is_some_and(|expected| expected != active_run_id) {
        return Ok(());
    }
    state.active_run_id.store(0, Ordering::SeqCst);
    state.is_running.store(false, Ordering::SeqCst);
    state.is_paused.store(false, Ordering::SeqCst);
    state.step_requested.store(0, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
fn pause_interactive_transient(
    state: tauri::State<'_, SimulationControlState>,
    run_id: Option<u64>,
) -> Result<(), String> {
    let active_run_id = state.active_run_id.load(Ordering::SeqCst);
    if run_id.is_some_and(|expected| expected != active_run_id) {
        return Ok(());
    }
    state.is_paused.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
fn resume_interactive_transient(
    state: tauri::State<'_, SimulationControlState>,
    run_id: Option<u64>,
) -> Result<(), String> {
    let active_run_id = state.active_run_id.load(Ordering::SeqCst);
    if run_id.is_some_and(|expected| expected != active_run_id) {
        return Ok(());
    }
    state.is_paused.store(false, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
fn step_interactive_transient(
    state: tauri::State<'_, SimulationControlState>,
    run_id: Option<u64>,
    steps: Option<u32>,
) -> Result<(), String> {
    let active_run_id = state.active_run_id.load(Ordering::SeqCst);
    if run_id.is_some_and(|expected| expected != active_run_id) {
        return Ok(());
    }
    let count = steps.unwrap_or(1).max(1);
    state.step_requested.fetch_add(count, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
fn get_performance_telemetry() -> Result<telemetry::TelemetryData, String> {
    Ok(telemetry::get_system_telemetry())
}

#[tauri::command]
async fn save_circuit_file(
    state: tauri::State<'_, SimulationControlState>,
    content: String,
) -> Result<String, String> {
    validate_circuit_file_content(&content)?;
    let file_path = rfd::AsyncFileDialog::new()
        .add_filter("Esquemático Biaani", &["biaani", "astryd", "json"])
        .set_title("Guardar Esquemático")
        .save_file()
        .await;

    if let Some(file_handle) = file_path {
        let path = file_handle.path();
        validate_circuit_file_path(path)?;
        write_file_atomically(path, &content)?;
        state
            .approved_circuit_paths
            .lock()
            .map_err(|error| error.to_string())?
            .insert(path.to_path_buf());
        Ok(path.to_string_lossy().to_string())
    } else {
        Err("Operación cancelada por el usuario".to_string())
    }
}

#[tauri::command]
async fn save_circuit_to_path(
    state: tauri::State<'_, SimulationControlState>,
    path: String,
    content: String,
) -> Result<(), String> {
    validate_circuit_file_content(&content)?;
    let path = PathBuf::from(path);
    validate_circuit_file_path(&path)?;
    let is_approved = state
        .approved_circuit_paths
        .lock()
        .map_err(|error| error.to_string())?
        .contains(&path);
    if !is_approved && !is_wdio_temporary_path(&path) {
        return Err(
            "La ruta no fue autorizada mediante el dialogo Abrir/Guardar de esta sesion."
                .to_string(),
        );
    }
    write_file_atomically(&path, &content)
}

#[tauri::command]
async fn update_live_inspection_state(
    state_json: String,
    svg_schematic: Option<String>,
) -> Result<(), String> {
    validate_circuit_file_content(&state_json)?;
    let live_dir = PathBuf::from(".biaani_live");
    if !live_dir.exists() {
        std::fs::create_dir_all(&live_dir).map_err(|error| error.to_string())?;
    }

    let state_file = live_dir.join("state.json");
    write_file_atomically(&state_file, &state_json)?;

    if let Some(svg) = svg_schematic {
        if !svg.is_empty() {
            let svg_file = live_dir.join("schematic.svg");
            write_file_atomically(&svg_file, &svg)?;
        }
    }

    Ok(())
}

#[tauri::command]
async fn get_live_inspection_state() -> Result<String, String> {
    let state_file = PathBuf::from(".biaani_live/state.json");
    if state_file.exists() {
        std::fs::read_to_string(&state_file).map_err(|error| error.to_string())
    } else {
        Ok("{}".to_string())
    }
}

#[cfg(feature = "wdio")]
fn is_wdio_temporary_path(path: &Path) -> bool {
    let Some(parent) = path.parent() else {
        return false;
    };
    parent
        .canonicalize()
        .ok()
        .zip(std::env::temp_dir().canonicalize().ok())
        .is_some_and(|(candidate, temp)| candidate == temp)
}

#[cfg(not(feature = "wdio"))]
fn is_wdio_temporary_path(_path: &Path) -> bool {
    false
}

const MAX_CIRCUIT_FILE_BYTES: usize = 50 * 1024 * 1024;

fn validate_circuit_file_content(content: &str) -> Result<(), String> {
    if content.is_empty() || content.len() > MAX_CIRCUIT_FILE_BYTES {
        return Err("El esquematico esta vacio o excede el limite de 50 MB.".to_string());
    }
    Ok(())
}

fn validate_circuit_file_path(path: &Path) -> Result<(), String> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase);
    if !matches!(extension.as_deref(), Some("biaani" | "astryd" | "json")) {
        return Err("La ruta debe usar extension .biaani, .astryd o .json.".to_string());
    }
    Ok(())
}

fn unique_sibling_path(path: &Path, suffix: &str) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "La ruta de guardado no tiene directorio padre.".to_string())?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "El nombre del archivo no es valido.".to_string())?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    Ok(parent.join(format!(
        ".{file_name}.{}.{}.{}",
        std::process::id(),
        nonce,
        suffix
    )))
}

pub(crate) fn write_file_atomically(path: &Path, content: &str) -> Result<(), String> {
    use std::fs::{self, OpenOptions};
    use std::io::Write;

    let temp_path = unique_sibling_path(path, "tmp")?;
    let backup_path = unique_sibling_path(path, "bak")?;
    let mut temp_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp_path)
        .map_err(|error| format!("No se pudo crear el archivo temporal: {error}"))?;

    if let Err(error) = temp_file
        .write_all(content.as_bytes())
        .and_then(|_| temp_file.sync_all())
    {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("No se pudo escribir el archivo temporal: {error}"));
    }
    drop(temp_file);

    let had_original = path.exists();
    if had_original {
        if let Err(error) = fs::rename(path, &backup_path) {
            let _ = fs::remove_file(&temp_path);
            return Err(format!("No se pudo preparar el reemplazo seguro: {error}"));
        }
    }

    if let Err(error) = fs::rename(&temp_path, path) {
        if had_original {
            if let Err(restore_error) = fs::rename(&backup_path, path) {
                return Err(format!(
                    "Fallo el guardado ({error}) y no se pudo restaurar el original ({restore_error}). Respaldo: {}",
                    backup_path.display()
                ));
            }
        }
        let _ = fs::remove_file(&temp_path);
        return Err(format!("No se pudo reemplazar el archivo: {error}"));
    }

    if had_original {
        fs::remove_file(&backup_path).map_err(|error| {
            format!("El archivo se guardo, pero no se pudo eliminar el respaldo: {error}")
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod persistence_tests {
    use super::write_file_atomically;
    use std::fs;

    #[test]
    fn atomic_save_creates_and_replaces_without_residue() {
        let root = std::env::temp_dir().join(format!(
            "biaani-persistence-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("create test directory");
        let file_path = root.join("circuit.biaani");

        write_file_atomically(&file_path, "version one").expect("first save");
        write_file_atomically(&file_path, "version two").expect("replacement save");

        assert_eq!(
            fs::read_to_string(&file_path).expect("read saved file"),
            "version two"
        );
        assert_eq!(fs::read_dir(&root).expect("read test directory").count(), 1);

        fs::remove_dir_all(&root).expect("cleanup test directory");
    }
}

#[cfg(test)]
mod interactive_transient_tests {
    use super::SimulationFrame;
    use std::collections::HashMap;

    fn active_mutation_state() -> super::SimulationControlState {
        use super::*;
        SimulationControlState {
            is_running: Arc::new(AtomicBool::new(true)),
            is_paused: Arc::new(AtomicBool::new(false)),
            step_requested: Arc::new(AtomicU32::new(0)),
            active_run_id: Arc::new(AtomicU64::new(11)),
            hot_mutations: Arc::new(Mutex::new(Vec::new())),
            approved_circuit_paths: Arc::new(Mutex::new(HashSet::new())),
            speed_multiplier: Arc::new(Mutex::new(1.0)),
        }
    }

    #[test]
    fn rejects_live_mutations_from_a_different_or_missing_run() {
        let state = active_mutation_state();
        for run_id in [0, 10, 12] {
            let result = super::enqueue_live_mutation(
                &state,
                super::ComponentMutation {
                    component_id: "R1".to_string(),
                    field: "value".to_string(),
                    value: 2000.0,
                    run_id,
                },
            );
            assert!(
                result.is_err(),
                "run {run_id} must not be relabelled as run 11"
            );
            assert!(state.hot_mutations.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn queues_live_mutations_without_changing_their_run_identity() {
        let state = active_mutation_state();
        super::enqueue_live_mutation(
            &state,
            super::ComponentMutation {
                component_id: "R1".to_string(),
                field: "value".to_string(),
                value: 2000.0,
                run_id: 11,
            },
        )
        .expect("active run mutation");
        let queue = state.hot_mutations.lock().unwrap();
        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0].run_id, 11);
        assert_eq!(queue[0].value, 2000.0);
    }

    #[test]
    fn rejects_live_mutations_after_stop() {
        let state = active_mutation_state();
        state.is_running.store(false, super::Ordering::SeqCst);
        assert!(super::enqueue_live_mutation(
            &state,
            super::ComponentMutation {
                component_id: "R1".to_string(),
                field: "value".to_string(),
                value: 2000.0,
                run_id: 11,
            }
        )
        .is_err());
        assert!(state.hot_mutations.lock().unwrap().is_empty());
    }

    #[test]
    fn validates_transient_stream_frame_batching() {
        let frame = SimulationFrame {
            run_id: 1,
            time: 0.05,
            node_voltages: HashMap::new(),
            branch_currents: HashMap::new(),
            frame_index: 0,
            is_final: false,
            batch_steps: Some(vec![]),
        };
        assert_eq!(frame.time, 0.05);
        assert!(!frame.is_final);
        assert!(frame.batch_steps.is_some());
    }
}

#[tauri::command]
async fn open_circuit_file(
    state: tauri::State<'_, SimulationControlState>,
) -> Result<(String, String), String> {
    use std::fs::read_to_string;

    let file_path = rfd::AsyncFileDialog::new()
        .add_filter("Esquemático Biaani", &["biaani", "astryd", "json"])
        .set_title("Abrir Esquemático")
        .pick_file()
        .await;

    if let Some(file_handle) = file_path {
        let path = file_handle.path();
        validate_circuit_file_path(path)?;
        let metadata = std::fs::metadata(path).map_err(|error| error.to_string())?;
        if metadata.len() > MAX_CIRCUIT_FILE_BYTES as u64 {
            return Err("El esquematico excede el limite de 50 MB.".to_string());
        }
        let content = read_to_string(path).map_err(|e| e.to_string())?;
        validate_circuit_file_content(&content)?;
        state
            .approved_circuit_paths
            .lock()
            .map_err(|error| error.to_string())?
            .insert(path.to_path_buf());
        Ok((path.to_string_lossy().to_string(), content))
    } else {
        Err("Operación cancelada por el usuario".to_string())
    }
}

#[tauri::command]
fn mcu_step(
    mcu_type: String,
    firmware_hex: Option<String>,
    cycles: u32,
    inputs: mcu::GpioInputs,
) -> Result<mcu::McuState, String> {
    let mut core: Box<dyn mcu::McuCore> = match mcu_type.to_lowercase().as_str() {
        "8051" | "mcu_8051" => Box::new(mcu::mcu8051::Mcu8051::new()),
        _ => Box::new(mcu::atmega328p::Atmega328p::new()),
    };
    if let Some(hex) = firmware_hex {
        core.load_firmware(hex.as_bytes())
            .map_err(|e| e.to_string())?;
    }
    core.run_cycles(cycles, &inputs);
    Ok(core.get_state())
}

#[tauri::command]
fn mcu_get_state(mcu_type: String, firmware_hex: Option<String>) -> Result<mcu::McuState, String> {
    let mut core: Box<dyn mcu::McuCore> = match mcu_type.to_lowercase().as_str() {
        "8051" | "mcu_8051" => Box::new(mcu::mcu8051::Mcu8051::new()),
        _ => Box::new(mcu::atmega328p::Atmega328p::new()),
    };
    if let Some(hex) = firmware_hex {
        core.load_firmware(hex.as_bytes())
            .map_err(|e| e.to_string())?;
    }
    Ok(core.get_state())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    {
        // Deshabilitar DMABuf en Linux de forma predeterminada para evitar cuelgues
        // en controladores Mesa/Gallium sin perder la aceleración gráfica de WebKit.
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());

    #[cfg(feature = "wdio")]
    let builder = builder.plugin(tauri_plugin_wdio::init());

    builder
        .setup(|app| {
            let feedback_root = app
                .path()
                .app_data_dir()
                .map_err(std::io::Error::other)?
                .join("feedback");
            let feedback_state =
                feedback::FeedbackState::start(feedback_root).map_err(std::io::Error::other)?;
            app.manage(feedback_state);
            Ok(())
        })
        .manage(SimulationControlState {
            is_running: Arc::new(AtomicBool::new(false)),
            is_paused: Arc::new(AtomicBool::new(false)),
            step_requested: Arc::new(AtomicU32::new(0)),
            active_run_id: Arc::new(AtomicU64::new(0)),
            hot_mutations: Arc::new(Mutex::new(Vec::new())),
            approved_circuit_paths: Arc::new(Mutex::new(HashSet::new())),
            speed_multiplier: Arc::new(Mutex::new(1.0)),
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            run_dc_simulation,
            run_transient_simulation,
            run_transient_simulation_packed,
            run_ac_sweep,
            run_dc_sweep,
            parse_spice_netlist,
            run_monte_carlo_transient,
            run_fft_analysis,
            run_imd_analysis,
            run_noise_sweep,
            evaluate_measures,
            expand_transmission_line,
            solve_dc_thermal,
            run_sensitivity_analysis,
            run_circuit_optimization,
            run_pss_simulation,
            run_stability_analysis,
            get_performance_telemetry,
            save_circuit_file,
            save_circuit_to_path,
            open_circuit_file,
            update_live_inspection_state,
            get_live_inspection_state,
            start_interactive_transient,
            stop_interactive_transient,
            pause_interactive_transient,
            resume_interactive_transient,
            step_interactive_transient,
            set_interactive_simulation_speed,
            inject_live_mutation,
            advanced_ipc::run_pvt_matrix_analysis,
            advanced_ipc::extract_sparameter,
            advanced_ipc::export_touchstone_file,
            feedback::store::ingest_feedback_batch,
            feedback::store::set_feedback_consent,
            feedback::store::get_feedback_status,
            feedback::store::query_feedback_events,
            feedback::store::export_feedback_events,
            feedback::store::delete_feedback_data,
            feedback::store::flush_feedback_store,
            mcu_step,
            mcu_get_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
