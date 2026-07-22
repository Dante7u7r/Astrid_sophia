use crate::solver::types::CircuitNetlist;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::super::dc::solve_dc_circuit_with_guess;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DcSweepSettings {
    pub source_id: String,
    pub v_start: f64,
    pub v_end: f64,
    pub v_step: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DcSweepResult {
    pub sweep_voltages: Vec<f64>,
    pub node_voltages: HashMap<String, Vec<f64>>,
    pub branch_currents: HashMap<String, Vec<f64>>,
}

pub fn solve_dc_sweep(
    netlist: &CircuitNetlist,
    settings: &DcSweepSettings,
) -> Result<DcSweepResult, String> {
    let mut sweep_voltages = Vec::new();
    let mut v = settings.v_start;

    if settings.v_step.abs() < 1e-12 {
        return Err("El paso de barrido (v_step) no puede ser cero.".to_string());
    }

    if settings.v_start <= settings.v_end {
        let step = settings.v_step.abs();
        while v <= settings.v_end + 1e-9 {
            sweep_voltages.push(v);
            v += step;
        }
    } else {
        let step = -settings.v_step.abs();
        while v >= settings.v_end - 1e-9 {
            sweep_voltages.push(v);
            v += step;
        }
    }

    if sweep_voltages.is_empty() {
        return Err(
            "No se generaron puntos de barrido. Verifica v_start, v_end y v_step.".to_string(),
        );
    }

    let mut node_voltages: HashMap<String, Vec<f64>> = HashMap::new();
    let mut branch_currents: HashMap<String, Vec<f64>> = HashMap::new();
    let mut cloned_netlist = netlist.clone();

    let source_idx = cloned_netlist
        .components
        .iter()
        .position(|c| c.id == settings.source_id)
        .ok_or_else(|| {
            format!(
                "No se encontró la fuente de barrido [{}] en el circuito.",
                settings.source_id
            )
        })?;

    if cloned_netlist.components[source_idx].comp_type != "vsource" {
        return Err(format!(
            "El componente [{}] no es una fuente de tensión (vsource).",
            settings.source_id
        ));
    }

    let mut current_guess: Option<Vec<f64>> = None;

    for &v_val in &sweep_voltages {
        cloned_netlist.components[source_idx].value = v_val;
        let (step_res, next_guess) =
            solve_dc_circuit_with_guess(&cloned_netlist, current_guess.as_ref())?;
        current_guess = Some(next_guess);

        for (node_id, &voltage) in &step_res.node_voltages {
            node_voltages
                .entry(node_id.clone())
                .or_default()
                .push(voltage);
        }

        for (branch_id, &current) in &step_res.branch_currents {
            branch_currents
                .entry(branch_id.clone())
                .or_default()
                .push(current);
        }
    }

    Ok(DcSweepResult {
        sweep_voltages,
        node_voltages,
        branch_currents,
    })
}
