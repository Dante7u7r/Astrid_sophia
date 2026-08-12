#![allow(
    clippy::needless_range_loop,
    clippy::too_many_arguments,
    clippy::for_kv_map,
    clippy::unnecessary_lazy_evaluations,
    clippy::doc_lazy_continuation,
    clippy::approx_constant,
    clippy::float_cmp,
    clippy::type_complexity,
    clippy::needless_borrow,
    clippy::single_match,
    clippy::collapsible_match
)]
pub mod ad_value;
mod advanced_ipc;
pub mod dual3;
pub mod feedback;
mod gpu_solver;
mod krylov;
pub mod parser;
pub mod solver;
mod sparse_csc;
pub mod sparse_parallel;
mod symbolic;
mod telemetry;
mod topology;

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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
    pub active_run_id: Arc<AtomicU64>,
    pub hot_mutations: Arc<Mutex<Vec<ComponentMutation>>>,
    pub approved_circuit_paths: Arc<Mutex<HashSet<PathBuf>>>,
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
}

const INTERACTIVE_TRANSIENT_FRAME_BUDGET: f64 = 240.0;
const INTERACTIVE_TRANSIENT_MAX_FRAME_PERIOD: f64 = 1.0 / 30.0;

/// El muestreo del stream debe seguir el tiempo físico, no la velocidad de la
/// CPU. De otro modo, un circuito pequeño termina antes del primer intervalo
/// de pared y la interfaz recibe únicamente la muestra final.
fn interactive_transient_sample_period(t_max: f64, dt: f64) -> f64 {
    if dt >= INTERACTIVE_TRANSIENT_MAX_FRAME_PERIOD {
        return dt;
    }
    (t_max / INTERACTIVE_TRANSIENT_FRAME_BUDGET)
        .clamp(dt, INTERACTIVE_TRANSIENT_MAX_FRAME_PERIOD)
}

/// Espera hasta que el reloj de pared alcance el instante físico calculado.
/// La espera se divide en tramos cortos para que «Detener» siga respondiendo.
fn pace_interactive_transient(
    started_at: std::time::Instant,
    simulation_time: f64,
    is_running: &AtomicBool,
    active_run_id: &AtomicU64,
    run_id: u64,
) -> bool {
    let target_elapsed = std::time::Duration::from_secs_f64(simulation_time.max(0.0));
    let max_sleep = std::time::Duration::from_millis(5);
    while let Some(remaining) = target_elapsed.checked_sub(started_at.elapsed()) {
        if !is_running.load(Ordering::SeqCst) || active_run_id.load(Ordering::SeqCst) != run_id {
            return false;
        }
        std::thread::sleep(remaining.min(max_sleep));
    }
    is_running.load(Ordering::SeqCst) && active_run_id.load(Ordering::SeqCst) == run_id
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
fn inject_live_mutation(
    state: tauri::State<'_, SimulationControlState>,
    mut mutation: ComponentMutation,
) -> Result<(), SimulationError> {
    if mutation.component_id.trim().is_empty() || mutation.component_id.len() > 128 {
        return Err(SimulationError::from(
            "La mutacion interactiva requiere un ID de componente valido.".to_string(),
        ));
    }
    if mutation.field != "value" || !mutation.value.is_finite() {
        return Err(SimulationError::from(
            "La mutacion interactiva solo admite el campo 'value' con un numero finito."
                .to_string(),
        ));
    }
    mutation.run_id = state.active_run_id.load(Ordering::SeqCst);
    if mutation.run_id == 0 || !state.is_running.load(Ordering::SeqCst) {
        return Err(SimulationError::from(
            "No hay una corrida transitoria activa para aplicar la mutación.".to_string(),
        ));
    }
    let mut queue = state
        .hot_mutations
        .lock()
        .map_err(|e| SimulationError::from(e.to_string()))?;
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
) -> Result<(), SimulationError> {
    if run_id == 0 {
        return Err(SimulationError::from(
            "El identificador de corrida debe ser mayor que cero.".to_string(),
        ));
    }
    settings.validate().map_err(SimulationError::from)?;
    let numerical_settings = numerical_settings(tolerance, max_iterations);
    numerical_settings
        .validate()
        .map_err(SimulationError::from)?;
    let netlist = parser::expand_netlist_subcircuits(&netlist).map_err(SimulationError::from)?;
    state.active_run_id.store(run_id, Ordering::SeqCst);
    state.is_running.store(true, Ordering::SeqCst);
    if let Ok(mut mutations) = state.hot_mutations.lock() {
        mutations.clear();
    }
    let is_running = state.is_running.clone();
    let active_run_id = state.active_run_id.clone();
    let hot_mutations = state.hot_mutations.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let window_inner = window.clone();
        let is_running_inner = is_running.clone();
        let active_run_id_inner = active_run_id.clone();
        let panic_run_id = active_run_id.clone();

        let catch_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            let mut frame_index = 0u64;
            let sample_period = interactive_transient_sample_period(settings.t_max, settings.dt);
            let mut next_sample_time = sample_period;
            let started_at = std::time::Instant::now();
            let final_is_running = is_running_inner.clone();
            let final_active_run_id = active_run_id_inner.clone();

            let result = solver::solve_transient_circuit_inner(
                &netlist,
                &settings,
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
                    if step.time >= next_sample_time {
                        if !pace_interactive_transient(
                            started_at,
                            step.time,
                            &is_running_inner,
                            &active_run_id_inner,
                            run_id,
                        ) {
                            return false;
                        }
                        let packet = SimulationFrame {
                            run_id,
                            time: step.time,
                            node_voltages: step.node_voltages.clone(),
                            branch_currents: step.branch_currents.clone(),
                            frame_index,
                            is_final: false,
                        };
                        window_inner.emit("sim-frame-update", &packet).ok();
                        frame_index += 1;
                        while next_sample_time <= step.time {
                            next_sample_time += sample_period;
                        }
                    }
                    true
                }),
            );

            if final_is_running.load(Ordering::SeqCst)
                && final_active_run_id.load(Ordering::SeqCst) == run_id
            {
                if let Ok((ref results, _, _)) = result {
                    if let Some(last) = results.last() {
                        if !pace_interactive_transient(
                            started_at,
                            last.time,
                            &final_is_running,
                            &final_active_run_id,
                            run_id,
                        ) {
                            return;
                        }
                        let packet = SimulationFrame {
                            run_id,
                            time: last.time,
                            node_voltages: last.node_voltages.clone(),
                            branch_currents: last.branch_currents.clone(),
                            frame_index,
                            is_final: true,
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
            window
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
        .add_filter("Esquemático Astryd", &["astryd", "json"])
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
    if !matches!(extension.as_deref(), Some("astryd" | "json")) {
        return Err("La ruta debe usar extension .astryd o .json.".to_string());
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
            "astryd-persistence-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("create test directory");
        let file_path = root.join("circuit.astryd");

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
    use super::interactive_transient_sample_period;

    #[test]
    fn samples_a_short_transient_by_physical_progress() {
        let period = interactive_transient_sample_period(0.05, 1e-4);

        assert!(period >= 1e-4);
        assert!((period - (0.05 / 240.0)).abs() < 1e-15);
        assert!((0.05 / period).ceil() <= 240.0);
    }

    #[test]
    fn never_requests_samples_finer_than_the_solver_step() {
        assert_eq!(interactive_transient_sample_period(1e-6, 1e-4), 1e-4);
    }

    #[test]
    fn caps_long_interactive_runs_at_a_responsive_frame_rate() {
        let period = interactive_transient_sample_period(60.0, 1e-4);
        assert!((period - (1.0 / 30.0)).abs() < 1e-15);
    }
}

#[tauri::command]
async fn open_circuit_file(
    state: tauri::State<'_, SimulationControlState>,
) -> Result<(String, String), String> {
    use std::fs::read_to_string;

    let file_path = rfd::AsyncFileDialog::new()
        .add_filter("Esquemático Astryd", &["astryd", "json"])
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
            active_run_id: Arc::new(AtomicU64::new(0)),
            hot_mutations: Arc::new(Mutex::new(Vec::new())),
            approved_circuit_paths: Arc::new(Mutex::new(HashSet::new())),
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            run_dc_simulation,
            run_transient_simulation,
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
            run_pss_simulation,
            run_stability_analysis,
            get_performance_telemetry,
            save_circuit_file,
            save_circuit_to_path,
            open_circuit_file,
            start_interactive_transient,
            stop_interactive_transient,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
