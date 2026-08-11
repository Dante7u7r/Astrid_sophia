use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComponentData {
    pub id: String,
    #[serde(rename = "type")]
    pub comp_type: String,
    pub value: f64,
    pub pins: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub controlling_source: Option<String>,
    pub wave_type: Option<String>,
    pub amplitude: Option<f64>,
    pub frequency: Option<f64>,
    pub offset: Option<f64>,
    pub duty_cycle: Option<f64>,
    pub tolerance: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub w: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub l: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expression: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delay: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rise_delay: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fall_delay: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diode_is: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diode_rs: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diode_n: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diode_tt: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diode_cjo: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diode_vj: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diode_m: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diode_bv: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diode_ibv: Option<f64>,
    // Parámetros del optoacoplador (componente de 4 pines: A, K, C, E)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opto_ctr: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opto_is: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opto_n: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opto_vsat: Option<f64>,
    // Parámetros de tiristores (SCR) y TRIACs
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scr_vgt: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scr_ih: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bjt_is: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bjt_bf: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bjt_vaf: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bjt_rb: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bjt_rc: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bjt_cje: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bjt_cjc: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bjt_tf: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bjt_tr: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gate_vhigh: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gate_vlow: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jfet_vto: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jfet_beta: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jfet_lambda: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jfet_cgs: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jfet_cgd: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub va_model_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub va_ports: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bsim_vmax: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bsim_u0: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bsim_tox: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bsim_eta0: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bsim_theta: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub va_equations: Option<Vec<(String, String, String)>>, // (from_port, to_port, expr_string)
    // Parámetros térmicos por componente (overridable desde netlist)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rth: Option<f64>, // Resistencia térmica unión-ambiente (°C/W)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cth: Option<f64>, // Capacidad térmica (J/°C)
    // Switch parameters
    #[serde(skip_serializing_if = "Option::is_none")]
    pub switch_ron: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub switch_roff: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub switch_vth: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub switch_vh: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub switch_state: Option<bool>,
    // Nombre del subcircuito a instanciar (para componentes tipo 'x')
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subcircuit_name: Option<String>,
}

/// Configuración de simulación electro-térmica acoplada.
/// Permite al usuario especificar parámetros de la red térmica global.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ThermalConfig {
    /// Temperatura ambiente en Kelvin (por defecto 300.15 K = 27°C)
    pub t_amb: f64,
    /// Máximo de iteraciones del relaxation loop eléctrico-térmico
    pub max_thermal_iters: usize,
    /// Tolerancia de convergencia térmica (ΔT máximo entre iteraciones, en K)
    pub thermal_tol: f64,
    /// Acoplamiento térmico entre pares de dispositivos: (id1, id2, Rth_mutuo en °C/W)
    pub thermal_coupling: Vec<(String, String, f64)>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WireData {
    pub id: String,
    pub nodes: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct MutualInductance {
    pub id: String,
    pub l1_id: String,
    pub l2_id: String,
    pub k_coeff: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub enum DigitalThresholdDirection {
    #[serde(rename = "rising")]
    Rising,
    #[serde(rename = "falling")]
    Falling,
    #[serde(rename = "either")]
    Either,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnalogEventTrigger {
    pub component_id: String,
    pub node_idx: usize,
    pub threshold_voltage: f64,
    pub direction: DigitalThresholdDirection,
    pub interrupt_vector: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CircuitNetlist {
    pub components: Vec<ComponentData>,
    pub wires: Vec<WireData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fixed_step: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mutual_inductances: Option<Vec<MutualInductance>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thermal_config: Option<ThermalConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subcircuit_definitions: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub triggers: Option<Vec<AnalogEventTrigger>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SimulationResult {
    pub node_voltages: HashMap<String, f64>,
    pub branch_currents: HashMap<String, f64>,
    pub convergence_iterations: usize,
    pub error_log: Option<String>,
}
