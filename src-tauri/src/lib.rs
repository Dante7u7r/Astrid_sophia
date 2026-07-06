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
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

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
        } else if err.contains("limit") || err.contains("max") || err.contains("iteration") {
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

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SimulationStreamError {
    pub run_id: u64,
    pub error: SimulationError,
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn ping() -> Result<String, String> {
    Ok("pong".to_string())
}

#[tauri::command]
async fn run_dc_simulation(
    netlist: solver::CircuitNetlist,
) -> Result<solver::SimulationResult, SimulationError> {
    let netlist = parser::expand_netlist_subcircuits(&netlist).map_err(SimulationError::from)?;
    solver::solve_dc_circuit(&netlist).map_err(SimulationError::from)
}

#[tauri::command]
async fn run_transient_simulation(
    netlist: solver::CircuitNetlist,
    settings: solver::TransientSettings,
) -> Result<Vec<solver::TimeStepResult>, SimulationError> {
    let netlist = parser::expand_netlist_subcircuits(&netlist).map_err(SimulationError::from)?;
    solver::solve_transient_circuit(&netlist, &settings).map_err(SimulationError::from)
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
    Ok(solver::expand_transmission_line(&params))
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
) -> Result<(), SimulationError> {
    if run_id == 0 {
        return Err(SimulationError::from(
            "El identificador de corrida debe ser mayor que cero.".to_string(),
        ));
    }
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
            let mut last_emit = std::time::Instant::now();
            let frame_interval = std::time::Duration::from_millis(16);
            let mut frame_index = 0u64;

            let result = solver::solve_transient_circuit_inner(
                &netlist,
                &settings,
                HashMap::new(),
                HashMap::new(),
                Some(hot_mutations),
                Some(run_id),
                Some(|step: &solver::TimeStepResult| -> bool {
                    if !is_running_inner.load(Ordering::SeqCst)
                        || active_run_id_inner.load(Ordering::SeqCst) != run_id
                    {
                        return false;
                    }
                    let now = std::time::Instant::now();
                    if now - last_emit >= frame_interval {
                        let packet = SimulationFrame {
                            run_id,
                            time: step.time,
                            node_voltages: step.node_voltages.clone(),
                            branch_currents: step.branch_currents.clone(),
                            frame_index,
                            is_final: false,
                        };
                        window_inner.emit("sim-frame-update", &packet).ok();
                        last_emit = now;
                        frame_index += 1;
                    }
                    true
                }),
            );

            if active_run_id_inner.load(Ordering::SeqCst) == run_id {
                if let Ok((ref results, _, _)) = result {
                    if let Some(last) = results.last() {
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
async fn save_circuit_file(content: String) -> Result<String, String> {
    let file_path = rfd::AsyncFileDialog::new()
        .add_filter("Esquemático Astryd", &["astryd", "json"])
        .set_title("Guardar Esquemático")
        .save_file()
        .await;

    if let Some(file_handle) = file_path {
        let path = file_handle.path();
        write_file_atomically(path, &content)?;
        Ok(path.to_string_lossy().to_string())
    } else {
        Err("Operación cancelada por el usuario".to_string())
    }
}

#[tauri::command]
async fn save_circuit_to_path(path: String, content: String) -> Result<(), String> {
    write_file_atomically(Path::new(&path), &content)
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

#[tauri::command]
async fn open_circuit_file() -> Result<(String, String), String> {
    use std::fs::read_to_string;

    let file_path = rfd::AsyncFileDialog::new()
        .add_filter("Esquemático Astryd", &["astryd", "json"])
        .set_title("Abrir Esquemático")
        .pick_file()
        .await;

    if let Some(file_handle) = file_path {
        let path = file_handle.path();
        let content = read_to_string(path).map_err(|e| e.to_string())?;
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

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(SimulationControlState {
            is_running: Arc::new(AtomicBool::new(false)),
            active_run_id: Arc::new(AtomicU64::new(0)),
            hot_mutations: Arc::new(Mutex::new(Vec::new())),
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
