use crate::solver::types::{CircuitNetlist, ComponentData};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

mod frequency;
mod operating_point;

use frequency::{solve_ac_frequencies, AcFrequencyContext};
use operating_point::{prepare_ac_operating_point, AcOperatingPoint};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AcSweepSettings {
    pub f_start: f64,
    pub f_end: f64,
    pub points_per_decade: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub op_guess: Option<Vec<f64>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AcSweepResult {
    pub frequencies: Vec<f64>,
    pub node_amplitudes: HashMap<String, Vec<f64>>,
    pub node_phases: HashMap<String, Vec<f64>>,
    pub error_log: Option<String>,
}

pub fn solve_ac_sweep(
    netlist: &CircuitNetlist,
    settings: &AcSweepSettings,
) -> Result<AcSweepResult, String> {
    let n = crate::topology::validate_netlist_topology(netlist, true)?;

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
    let m = v_sources.len();
    let size = n + m;

    if size == 0 {
        return Err("El circuito no contiene nodos activos o componentes.".to_string());
    }

    let mut vsource_map = HashMap::new();
    for (idx, vs) in v_sources.iter().enumerate() {
        vsource_map.insert(vs.id.clone(), idx);
    }

    let AcOperatingPoint {
        diode_conductances,
        nmos_parameters,
        pmos_parameters,
        bjt_parameters,
        opamp_gm,
        opto_parameters,
    } = prepare_ac_operating_point(netlist, settings)?;

    // Generar vector de frecuencias logarítmicas
    let mut frequencies = Vec::new();
    let mut f = settings.f_start;
    let ratio = 10.0f64.powf(1.0 / settings.points_per_decade as f64);
    while f <= settings.f_end * 1.001 {
        frequencies.push(f);
        f *= ratio;
    }

    let mut node_amplitudes: HashMap<String, Vec<f64>> = HashMap::new();
    let mut node_phases: HashMap<String, Vec<f64>> = HashMap::new();

    node_amplitudes.insert("0".to_string(), vec![0.0; frequencies.len()]);
    node_phases.insert("0".to_string(), vec![0.0; frequencies.len()]);
    for i in 1..=n {
        node_amplitudes.insert(i.to_string(), Vec::new());
        node_phases.insert(i.to_string(), Vec::new());
    }

    let results = solve_ac_frequencies(
        AcFrequencyContext {
            netlist,
            n,
            size,
            vsource_map: &vsource_map,
            diode_conductances: &diode_conductances,
            nmos_parameters: &nmos_parameters,
            pmos_parameters: &pmos_parameters,
            bjt_parameters: &bjt_parameters,
            opamp_gm: &opamp_gm,
            opto_parameters: &opto_parameters,
        },
        &frequencies,
    )?;

    for res in results {
        for (node_name, amp, phase) in res.node_vals {
            node_amplitudes.get_mut(&node_name).unwrap().push(amp);
            node_phases.get_mut(&node_name).unwrap().push(phase);
        }
    }

    Ok(AcSweepResult {
        frequencies,
        node_amplitudes,
        node_phases,
        error_log: None,
    })
}
