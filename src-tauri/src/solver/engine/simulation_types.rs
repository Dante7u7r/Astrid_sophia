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

impl TransientSettings {
    pub fn validate(&self) -> Result<(), String> {
        if !self.dt.is_finite() || self.dt <= 0.0 {
            return Err("El paso temporal dt debe ser finito y mayor que cero.".to_string());
        }
        if !self.t_max.is_finite() || self.t_max < 0.0 {
            return Err("La duración transitoria tMax debe ser finita y no negativa.".to_string());
        }

        let estimated_steps = self.t_max / self.dt;
        if !estimated_steps.is_finite() || estimated_steps > 2_000_000.0 {
            return Err(
                "La simulación transitoria excede el límite de 2 000 000 de pasos solicitados."
                    .to_string(),
            );
        }

        if let Some(method) = self.integration_method.as_deref() {
            if !matches!(
                method,
                "auto"
                    | "euler"
                    | "BE"
                    | "gear2"
                    | "gear3"
                    | "gear4"
                    | "gear5"
                    | "gear6"
                    | "trap"
                    | "trapezoidal"
            ) {
                return Err(format!(
                    "Método de integración no compatible: {method}. Use auto, euler, BE, gear2, gear3, gear4, gear5, gear6, trap o trapezoidal."
                ));
            }
        }
        Ok(())
    }

    pub fn validate_interactive(&self) -> Result<(), String> {
        if !self.dt.is_finite() || self.dt <= 0.0 {
            return Err("El paso temporal dt debe ser finito y mayor que cero.".to_string());
        }
        if self.t_max.is_nan() || self.t_max < 0.0 {
            return Err("La duración transitoria tMax no puede ser negativa.".to_string());
        }

        if let Some(method) = self.integration_method.as_deref() {
            if !matches!(
                method,
                "auto"
                    | "euler"
                    | "BE"
                    | "gear2"
                    | "gear3"
                    | "gear4"
                    | "gear5"
                    | "gear6"
                    | "trap"
                    | "trapezoidal"
            ) {
                return Err(format!(
                    "Método de integración no compatible: {method}. Use auto, euler, BE, gear2, gear3, gear4, gear5, gear6, trap o trapezoidal."
                ));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy)]
pub struct SolverNumericalSettings {
    pub tolerance: f64,
    pub max_iterations: usize,
}

impl Default for SolverNumericalSettings {
    fn default() -> Self {
        Self {
            tolerance: 1e-6,
            max_iterations: 100,
        }
    }
}

impl SolverNumericalSettings {
    pub fn validate(&self) -> Result<(), String> {
        if !self.tolerance.is_finite() || self.tolerance <= 0.0 || self.tolerance > 1.0 {
            return Err(
                "La tolerancia de convergencia debe ser finita, mayor que cero y menor o igual que 1."
                    .to_string(),
            );
        }
        if self.max_iterations == 0 || self.max_iterations > 10_000 {
            return Err("El máximo de iteraciones debe estar entre 1 y 10 000.".to_string());
        }
        Ok(())
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TimeStepResult {
    pub time: f64,
    pub node_voltages: HashMap<String, f64>,
    pub branch_currents: HashMap<String, f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_temperatures: Option<HashMap<String, f64>>,
}

impl TimeStepResult {
    pub fn new(
        time: f64,
        node_voltages: HashMap<String, f64>,
        branch_currents: HashMap<String, f64>,
    ) -> Self {
        Self {
            time,
            node_voltages,
            branch_currents,
            device_temperatures: None,
        }
    }
}

/// Representación plana de memoria contigua para transferencia IPC de ultra-alto rendimiento.
/// Evita la creación de millones de HashMaps en Rust y la deserialización de millones de objetos en JS.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PackedTransientResult {
    pub node_names: Vec<String>,
    pub branch_names: Vec<String>,
    pub times: Vec<f64>,
    /// Matriz contigua ordenada por pasos: [paso0_nodos..., paso1_nodos..., ...]
    pub node_voltages: Vec<f64>,
    /// Matriz contigua ordenada por pasos: [paso0_ramas..., paso1_ramas..., ...]
    pub branch_currents: Vec<f64>,
}

pub fn pack_transient_results(results: &[TimeStepResult]) -> PackedTransientResult {
    if results.is_empty() {
        return PackedTransientResult {
            node_names: Vec::new(),
            branch_names: Vec::new(),
            times: Vec::new(),
            node_voltages: Vec::new(),
            branch_currents: Vec::new(),
        };
    }

    let mut node_set = std::collections::BTreeSet::new();
    let mut branch_set = std::collections::BTreeSet::new();
    for step in results {
        for k in step.node_voltages.keys() {
            node_set.insert(k.clone());
        }
        for k in step.branch_currents.keys() {
            branch_set.insert(k.clone());
        }
    }

    let node_names: Vec<String> = node_set.into_iter().collect();
    let branch_names: Vec<String> = branch_set.into_iter().collect();
    let num_steps = results.len();
    let num_nodes = node_names.len();
    let num_branches = branch_names.len();

    let mut times = Vec::with_capacity(num_steps);
    let mut node_voltages = Vec::with_capacity(num_steps * num_nodes);
    let mut branch_currents = Vec::with_capacity(num_steps * num_branches);

    for step in results {
        times.push(step.time);
        for node in &node_names {
            node_voltages.push(*step.node_voltages.get(node).unwrap_or(&0.0));
        }
        for branch in &branch_names {
            branch_currents.push(*step.branch_currents.get(branch).unwrap_or(&0.0));
        }
    }

    PackedTransientResult {
        node_names,
        branch_names,
        times,
        node_voltages,
        branch_currents,
    }
}

pub fn unpack_transient_results(packed: &PackedTransientResult) -> Vec<TimeStepResult> {
    let num_steps = packed.times.len();
    let num_nodes = packed.node_names.len();
    let num_branches = packed.branch_names.len();

    let mut results = Vec::with_capacity(num_steps);
    for s in 0..num_steps {
        let time = packed.times[s];
        let mut node_voltages = HashMap::with_capacity(num_nodes);
        let node_offset = s * num_nodes;
        for (n_idx, name) in packed.node_names.iter().enumerate() {
            if let Some(&val) = packed.node_voltages.get(node_offset + n_idx) {
                node_voltages.insert(name.clone(), val);
            }
        }

        let mut branch_currents = HashMap::with_capacity(num_branches);
        let branch_offset = s * num_branches;
        for (b_idx, name) in packed.branch_names.iter().enumerate() {
            if let Some(&val) = packed.branch_currents.get(branch_offset + b_idx) {
                branch_currents.insert(name.clone(), val);
            }
        }

        results.push(TimeStepResult::new(time, node_voltages, branch_currents));
    }
    results
}

#[cfg(test)]
mod validation_tests {
    use super::*;

    #[test]
    fn transient_settings_reject_non_positive_or_unbounded_steps() {
        let invalid_dt = TransientSettings {
            dt: 0.0,
            t_max: 1.0,
            fixed_step: None,
            integration_method: None,
        };
        assert!(invalid_dt.validate().is_err());

        let excessive_steps = TransientSettings {
            dt: 1e-9,
            t_max: 1.0,
            fixed_step: Some(true),
            integration_method: None,
        };
        assert!(excessive_steps.validate().is_err());
    }

    #[test]
    fn numerical_settings_reject_invalid_limits() {
        assert!(SolverNumericalSettings {
            tolerance: f64::NAN,
            max_iterations: 100,
        }
        .validate()
        .is_err());
        assert!(SolverNumericalSettings {
            tolerance: 1e-6,
            max_iterations: 0,
        }
        .validate()
        .is_err());
    }

    #[test]
    fn test_pack_and_unpack_transient_results() {
        let mut step1_nodes = HashMap::new();
        step1_nodes.insert("1".to_string(), 5.0);
        step1_nodes.insert("2".to_string(), 2.5);
        let mut step1_branches = HashMap::new();
        step1_branches.insert("R1".to_string(), 0.005);

        let mut step2_nodes = HashMap::new();
        step2_nodes.insert("1".to_string(), 4.8);
        step2_nodes.insert("2".to_string(), 2.4);
        let mut step2_branches = HashMap::new();
        step2_branches.insert("R1".to_string(), 0.0048);

        let original = vec![
            TimeStepResult::new(0.0, step1_nodes, step1_branches),
            TimeStepResult::new(0.001, step2_nodes, step2_branches),
        ];

        let packed = pack_transient_results(&original);
        assert_eq!(packed.times, vec![0.0, 0.001]);
        assert_eq!(packed.node_names, vec!["1", "2"]);
        assert_eq!(packed.branch_names, vec!["R1"]);
        assert_eq!(packed.node_voltages, vec![5.0, 2.5, 4.8, 2.4]);
        assert_eq!(packed.branch_currents, vec![0.005, 0.0048]);

        let unpacked = unpack_transient_results(&packed);
        assert_eq!(unpacked.len(), 2);
        assert_eq!(unpacked[0].time, 0.0);
        assert_eq!(unpacked[0].node_voltages.get("1"), Some(&5.0));
        assert_eq!(unpacked[1].time, 0.001);
        assert_eq!(unpacked[1].node_voltages.get("1"), Some(&4.8));
    }
}
