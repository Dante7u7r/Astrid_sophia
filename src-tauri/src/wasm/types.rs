use crate::solver::{AcSweepResult, SimulationResult, TimeStepResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WasmSimulationRequest {
    pub netlist_json: String,
    pub analysis_mode: String, // "DC", "TRAN", "AC"
    pub t_stop: Option<f64>,
    pub max_step: Option<f64>,
    pub f_start: Option<f64>,
    pub f_stop: Option<f64>,
    pub points_per_decade: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WasmSimulationResponse {
    pub success: bool,
    pub error: Option<String>,
    pub dc_result: Option<SimulationResult>,
    pub transient_result: Option<Vec<TimeStepResult>>,
    pub ac_result: Option<AcSweepResult>,
}
