pub mod solver;
mod telemetry;
pub mod parser;
mod topology;
mod sparse_csc;
mod symbolic;
mod krylov;
pub mod dual3;
pub mod sparse_parallel;
mod gpu_solver;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ComponentMutation {
    pub component_id: String,
    pub field: String,
    pub value: f64,
}

pub struct SimulationControlState {
    pub is_running: Arc<AtomicBool>,
    pub hot_mutations: Arc<Mutex<Vec<ComponentMutation>>>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SimulationFrame {
    pub time: f64,
    pub node_voltages: HashMap<String, f64>,
    pub branch_currents: HashMap<String, f64>,
    pub frame_index: u64,
    pub is_final: bool,
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn ping() -> String {
    "pong".to_string()
}

#[tauri::command]
async fn run_dc_simulation(netlist: solver::CircuitNetlist) -> Result<solver::SimulationResult, String> {
    let netlist = parser::expand_netlist_subcircuits(&netlist)?;
    solver::solve_dc_circuit(&netlist)
}

#[tauri::command]
async fn run_transient_simulation(
    netlist: solver::CircuitNetlist,
    settings: solver::TransientSettings,
) -> Result<Vec<solver::TimeStepResult>, String> {
    let netlist = parser::expand_netlist_subcircuits(&netlist)?;
    solver::solve_transient_circuit(&netlist, &settings)
}

#[tauri::command]
async fn run_ac_sweep(
    netlist: solver::CircuitNetlist,
    settings: solver::AcSweepSettings,
) -> Result<solver::AcSweepResult, String> {
    let netlist = parser::expand_netlist_subcircuits(&netlist)?;
    solver::solve_ac_sweep(&netlist, &settings)
}

#[tauri::command]
async fn run_dc_sweep(
    netlist: solver::CircuitNetlist,
    settings: solver::DcSweepSettings,
) -> Result<solver::DcSweepResult, String> {
    let netlist = parser::expand_netlist_subcircuits(&netlist)?;
    solver::solve_dc_sweep(&netlist, &settings)
}

#[tauri::command]
async fn parse_spice_netlist(netlist_str: String) -> Result<solver::CircuitNetlist, String> {
    parser::parse_spice_netlist_to_native(&netlist_str)
}

#[tauri::command]
async fn run_monte_carlo_transient(
    netlist: solver::CircuitNetlist,
    transient_settings: solver::TransientSettings,
    mc_settings: solver::MonteCarloSettings,
) -> Result<Vec<Vec<solver::TimeStepResult>>, String> {
    let netlist = parser::expand_netlist_subcircuits(&netlist)?;
    solver::solve_monte_carlo_transient(&netlist, &transient_settings, &mc_settings)
}

#[tauri::command]
async fn run_fft_analysis(
    time_steps: Vec<solver::TimeStepResult>,
    node_name: String,
    fundamental_freq: f64,
) -> Result<solver::FftResult, String> {
    solver::calculate_fft_and_thd(&time_steps, &node_name, fundamental_freq)
}

#[tauri::command]
async fn run_imd_analysis(
    time_steps: Vec<solver::TimeStepResult>,
    node_name: String,
    f1: f64,
    f2: f64,
) -> Result<solver::ImdResult, String> {
    solver::calculate_imd_analysis(&time_steps, &node_name, f1, f2)
}

#[tauri::command]
async fn run_noise_sweep(
    netlist: solver::CircuitNetlist,
    settings: solver::NoiseSweepSettings,
) -> Result<solver::NoiseSweepResult, String> {
    let netlist = parser::expand_netlist_subcircuits(&netlist)?;
    solver::solve_noise_sweep(&netlist, &settings)
}

#[tauri::command]
async fn evaluate_measures(
    time_steps: Vec<solver::TimeStepResult>,
    directives: Vec<solver::MeasureDirective>,
) -> solver::MeasureResult {
    solver::evaluate_measures(&time_steps, &directives)
}

#[tauri::command]
async fn expand_transmission_line(
    params: solver::TransmissionLineParams,
) -> Vec<solver::ComponentData> {
    solver::expand_transmission_line(&params)
}

#[tauri::command]
async fn run_sensitivity_analysis(
    netlist: solver::CircuitNetlist,
) -> Result<solver::SensitivityResult, String> {
    let netlist = parser::expand_netlist_subcircuits(&netlist)?;
    solver::solve_dc_sensitivity(&netlist)
}

#[tauri::command]
async fn solve_dc_thermal(
    netlist: solver::CircuitNetlist,
    temp_k: f64,
) -> Result<solver::SimulationResult, String> {
    let netlist = parser::expand_netlist_subcircuits(&netlist)?;
    solver::solve_dc_circuit_thermal(&netlist, temp_k)
}

#[tauri::command]
async fn run_pss_simulation(
    netlist: solver::CircuitNetlist,
    settings: solver::PssSettings,
) -> Result<Vec<solver::TimeStepResult>, String> {
    let netlist = parser::expand_netlist_subcircuits(&netlist)?;
    solver::solve_pss(&netlist, &settings)
}

#[tauri::command]
async fn run_stability_analysis(
    netlist: solver::CircuitNetlist,
) -> Result<solver::PoleZeroResult, String> {
    let netlist = parser::expand_netlist_subcircuits(&netlist)?;
    solver::run_stability_analysis(&netlist)
}

#[tauri::command]
fn inject_live_mutation(
    state: tauri::State<'_, SimulationControlState>,
    mutation: ComponentMutation,
) -> Result<(), String> {
    let queue = state.hot_mutations.lock().map_err(|e| e.to_string())?;
    queue.push(mutation);
    Ok(())
}

#[tauri::command]
async fn start_interactive_transient(
    window: tauri::Window,
    state: tauri::State<'_, SimulationControlState>,
    netlist: solver::CircuitNetlist,
    settings: solver::TransientSettings,
) -> Result<(), String> {
    let netlist = parser::expand_netlist_subcircuits(&netlist)?;
    state.is_running.store(true, Ordering::SeqCst);
    let is_running = state.is_running.clone();
    let hot_mutations = state.hot_mutations.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut last_emit = std::time::Instant::now();
        let frame_interval = std::time::Duration::from_millis(16);
        let mut frame_index = 0u64;

        let result = solver::solve_transient_circuit_inner(
            &netlist,
            &settings,
            HashMap::new(),
            HashMap::new(),
            Some(hot_mutations),
            Some(|step: &solver::TimeStepResult| -> bool {
                if !is_running.load(Ordering::SeqCst) {
                    return false;
                }
                let now = std::time::Instant::now();
                if now - last_emit >= frame_interval {
                    let packet = SimulationFrame {
                        time: step.time,
                        node_voltages: step.node_voltages.clone(),
                        branch_currents: step.branch_currents.clone(),
                        frame_index,
                        is_final: false,
                    };
                    window.emit("sim-frame-update", &packet).ok();
                    last_emit = now;
                    frame_index += 1;
                }
                true
            }),
        );

        if let Ok((ref results, _, _)) = result {
            if let Some(last) = results.last() {
                let packet = SimulationFrame {
                    time: last.time,
                    node_voltages: last.node_voltages.clone(),
                    branch_currents: last.branch_currents.clone(),
                    frame_index,
                    is_final: true,
                };
                window.emit("sim-frame-update", &packet).ok();
            }
        }
        if let Err(ref e) = result {
            window.emit("sim-frame-error", e).ok();
        }

        is_running.store(false, Ordering::SeqCst);
    });

    Ok(())
}

#[tauri::command]
fn stop_interactive_transient(state: tauri::State<'_, SimulationControlState>) {
    state.is_running.store(false, Ordering::SeqCst);
}

#[tauri::command]
fn get_performance_telemetry() -> telemetry::TelemetryData {
    telemetry::get_system_telemetry()
}

#[tauri::command]
async fn save_circuit_file(content: String) -> Result<String, String> {
    use std::fs::File;
    use std::io::Write;

    let file_path = rfd::AsyncFileDialog::new()
        .add_filter("Esquemático Astryd", &["astryd", "json"])
        .set_title("Guardar Esquemático")
        .save_file()
        .await;

    if let Some(file_handle) = file_path {
        let path = file_handle.path();
        let mut file = File::create(path).map_err(|e| e.to_string())?;
        file.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().to_string())
    } else {
        Err("Operación cancelada por el usuario".to_string())
    }
}

#[tauri::command]
async fn save_circuit_to_path(path: String, content: String) -> Result<(), String> {
    use std::fs::File;
    use std::io::Write;

    let mut file = File::create(&path).map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(SimulationControlState {
            is_running: Arc::new(AtomicBool::new(false)),
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
