use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransientSettings {
    pub dt: f64,
    pub t_max: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fixed_step: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub integration_method: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TimeStepResult {
    pub time: f64,
    pub node_voltages: HashMap<String, f64>,
    pub branch_currents: HashMap<String, f64>,
}
