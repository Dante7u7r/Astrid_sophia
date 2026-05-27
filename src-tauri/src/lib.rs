mod solver;
mod telemetry;
mod parser;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn ping() -> String {
    "pong".to_string()
}

#[tauri::command]
async fn run_dc_simulation(netlist: solver::CircuitNetlist) -> Result<solver::SimulationResult, String> {
    solver::solve_dc_circuit(&netlist)
}

#[tauri::command]
async fn run_transient_simulation(
    netlist: solver::CircuitNetlist,
    settings: solver::TransientSettings,
) -> Result<Vec<solver::TimeStepResult>, String> {
    solver::solve_transient_circuit(&netlist, &settings)
}

#[tauri::command]
async fn run_ac_sweep(
    netlist: solver::CircuitNetlist,
    settings: solver::AcSweepSettings,
) -> Result<solver::AcSweepResult, String> {
    solver::solve_ac_sweep(&netlist, &settings)
}

#[tauri::command]
async fn run_dc_sweep(
    netlist: solver::CircuitNetlist,
    settings: solver::DcSweepSettings,
) -> Result<solver::DcSweepResult, String> {
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
async fn run_noise_sweep(
    netlist: solver::CircuitNetlist,
    settings: solver::NoiseSweepSettings,
) -> Result<solver::NoiseSweepResult, String> {
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
async fn solve_dc_thermal(
    netlist: solver::CircuitNetlist,
    temp_k: f64,
) -> Result<solver::SimulationResult, String> {
    solver::solve_dc_circuit_thermal(&netlist, temp_k)
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
async fn open_circuit_file() -> Result<String, String> {
    use std::fs::read_to_string;

    let file_path = rfd::AsyncFileDialog::new()
        .add_filter("Esquemático Astryd", &["astryd", "json"])
        .set_title("Abrir Esquemático")
        .pick_file()
        .await;

    if let Some(file_handle) = file_path {
        let path = file_handle.path();
        let content = read_to_string(path).map_err(|e| e.to_string())?;
        Ok(content)
    } else {
        Err("Operación cancelada por el usuario".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            ping,
            run_dc_simulation,
            run_transient_simulation,
            run_ac_sweep,
            run_dc_sweep,
            parse_spice_netlist,
            run_monte_carlo_transient,
            run_fft_analysis,
            run_noise_sweep,
            evaluate_measures,
            expand_transmission_line,
            solve_dc_thermal,
            get_performance_telemetry,
            save_circuit_file,
            open_circuit_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
