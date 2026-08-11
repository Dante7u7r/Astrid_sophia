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

const MAX_DC_SWEEP_POINTS: usize = 100_000;

impl DcSweepSettings {
    pub fn validate(&self) -> Result<usize, String> {
        if self.source_id.trim().is_empty() {
            return Err("La fuente del barrido DC no puede estar vacia.".to_string());
        }
        if !self.v_start.is_finite() || !self.v_end.is_finite() || !self.v_step.is_finite() {
            return Err("Los limites y el paso del barrido DC deben ser finitos.".to_string());
        }
        if self.v_step.abs() < 1e-12 {
            return Err("El paso de barrido (v_step) no puede ser cero.".to_string());
        }

        let span = (self.v_end - self.v_start).abs();
        let estimated_points = (span / self.v_step.abs()).floor() + 1.0;
        if !estimated_points.is_finite() || estimated_points > MAX_DC_SWEEP_POINTS as f64 {
            return Err(format!(
                "El barrido DC excede el limite de {MAX_DC_SWEEP_POINTS} puntos."
            ));
        }
        Ok(estimated_points as usize)
    }
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
    let estimated_points = settings.validate()?;
    let mut sweep_voltages = Vec::with_capacity(estimated_points);
    let mut v = settings.v_start;

    if settings.v_start <= settings.v_end {
        let step = settings.v_step.abs();
        while v <= settings.v_end + 1e-9 {
            if sweep_voltages.len() >= MAX_DC_SWEEP_POINTS {
                return Err(format!(
                    "El barrido DC excede el limite de {MAX_DC_SWEEP_POINTS} puntos."
                ));
            }
            sweep_voltages.push(v);
            v += step;
        }
    } else {
        let step = -settings.v_step.abs();
        while v >= settings.v_end - 1e-9 {
            if sweep_voltages.len() >= MAX_DC_SWEEP_POINTS {
                return Err(format!(
                    "El barrido DC excede el limite de {MAX_DC_SWEEP_POINTS} puntos."
                ));
            }
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

#[cfg(test)]
mod validation_tests {
    use super::*;

    #[test]
    fn rejects_zero_step_and_excessive_point_count() {
        assert!(DcSweepSettings {
            source_id: "V1".to_string(),
            v_start: 0.0,
            v_end: 1.0,
            v_step: 0.0,
        }
        .validate()
        .is_err());
        assert!(DcSweepSettings {
            source_id: "V1".to_string(),
            v_start: 0.0,
            v_end: 1.0,
            v_step: 1e-9,
        }
        .validate()
        .is_err());
    }
}
