use crate::solver::{
    solve_ac_sweep, solve_dc_circuit, solve_transient_circuit, AcSweepSettings, CircuitNetlist,
    TransientSettings,
};

/// Solve DC Operating point from JSON netlist string
pub fn solve_dc_wasm_core(netlist_json: &str) -> Result<String, String> {
    let netlist: CircuitNetlist = serde_json::from_str(netlist_json)
        .map_err(|e| format!("Error deserializing netlist JSON: {}", e))?;

    let result =
        solve_dc_circuit(&netlist).map_err(|e| format!("DC Operating Point error: {:?}", e))?;

    serde_json::to_string(&result).map_err(|e| format!("Error serializing DC result: {}", e))
}

/// Solve Transient analysis from JSON netlist and parameters
pub fn solve_transient_wasm_core(
    netlist_json: &str,
    t_stop: f64,
    max_step: f64,
) -> Result<String, String> {
    let netlist: CircuitNetlist = serde_json::from_str(netlist_json)
        .map_err(|e| format!("Error deserializing netlist JSON: {}", e))?;

    let settings = TransientSettings {
        dt: max_step,
        t_max: t_stop,
        fixed_step: None,
        integration_method: None,
    };

    let result = solve_transient_circuit(&netlist, &settings)
        .map_err(|e| format!("Transient simulation error: {:?}", e))?;

    serde_json::to_string(&result).map_err(|e| format!("Error serializing Transient result: {}", e))
}

/// Solve AC frequency sweep from JSON netlist and parameters
pub fn solve_ac_wasm_core(
    netlist_json: &str,
    f_start: f64,
    f_stop: f64,
    points_per_decade: usize,
) -> Result<String, String> {
    let netlist: CircuitNetlist = serde_json::from_str(netlist_json)
        .map_err(|e| format!("Error deserializing netlist JSON: {}", e))?;

    let settings = AcSweepSettings {
        f_start,
        f_end: f_stop,
        points_per_decade,
        op_guess: None,
    };

    let result =
        solve_ac_sweep(&netlist, &settings).map_err(|e| format!("AC Sweep error: {:?}", e))?;

    serde_json::to_string(&result).map_err(|e| format!("Error serializing AC result: {}", e))
}
