use crate::solver::types::{CircuitNetlist, ComponentData, SimulationResult};
use nalgebra::DVector;
use std::collections::HashMap;

// Helper para armar la estructura final de resultado a partir del vector solución
pub(super) fn build_simulation_result(
    netlist: &CircuitNetlist,
    n: usize,
    _m: usize,
    vsource_map: &HashMap<String, usize>,
    solution: &DVector<f64>,
    iterations: usize,
) -> Result<SimulationResult, String> {
    let mut node_voltages = HashMap::new();
    node_voltages.insert("0".to_string(), 0.0);
    for i in 1..=n {
        node_voltages.insert(i.to_string(), solution[i - 1]);
    }

    let mut branch_currents = HashMap::new();
    let v_sources: Vec<&ComponentData> = netlist
        .components
        .iter()
        .filter(|c| {
            c.comp_type == "vsource"
                || c.comp_type == "bvoltage"
                || c.comp_type == "vcvs"
                || c.comp_type == "ccvs"
        })
        .collect();

    for vs in &v_sources {
        let vs_idx = *vsource_map.get(&vs.id).unwrap();
        branch_currents.insert(vs.id.clone(), solution[n + vs_idx]);
    }

    Ok(SimulationResult {
        node_voltages,
        branch_currents,
        convergence_iterations: iterations,
        error_log: None,
    })
}
