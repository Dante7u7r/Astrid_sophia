use crate::solver::types::{CircuitNetlist, ComponentData};
use nalgebra::DVector;
use std::collections::HashMap;

use super::transient_setup::ComponentOverrideMap;

pub(crate) fn stamp_dynamic_transient_sources(
    netlist: &CircuitNetlist,
    n: usize,
    t: f64,
    vsource_map: &HashMap<String, usize>,
    local_overrides: &ComponentOverrideMap,
    vector_z: &mut DVector<f64>,
) {
    for comp in &netlist.components {
        match comp.comp_type.as_str() {
            "vsource" => {
                stamp_dynamic_voltage_source(comp, n, t, vsource_map, local_overrides, vector_z);
            }
            "isource" => {
                stamp_dynamic_current_source(comp, t, local_overrides, vector_z);
            }
            _ => {}
        }
    }
}

fn stamp_dynamic_voltage_source(
    comp: &ComponentData,
    n: usize,
    t: f64,
    vsource_map: &HashMap<String, usize>,
    local_overrides: &ComponentOverrideMap,
    vector_z: &mut DVector<f64>,
) {
    let Some(wave) = comp.wave_type.as_ref() else {
        return;
    };

    let overrides = local_overrides.get(&comp.id);
    let fallback = overrides
        .and_then(|fields| fields.get("value").copied())
        .unwrap_or(comp.value);
    let v_val = evaluate_waveform(comp, overrides, wave, t, fallback);

    if let Some(&vs_idx) = vsource_map.get(&comp.id) {
        vector_z[n + vs_idx] = v_val;
    }
}

fn stamp_dynamic_current_source(
    comp: &ComponentData,
    t: f64,
    local_overrides: &ComponentOverrideMap,
    vector_z: &mut DVector<f64>,
) {
    let Some(wave) = comp.wave_type.as_ref() else {
        return;
    };

    let overrides = local_overrides.get(&comp.id);
    let i_val = evaluate_waveform(comp, overrides, wave, t, comp.value);
    let diff = i_val - comp.value;
    let node_pos = comp.pins[0].parse::<usize>().unwrap_or(0);
    let node_neg = comp.pins[1].parse::<usize>().unwrap_or(0);
    if node_pos > 0 {
        vector_z[node_pos - 1] -= diff;
    }
    if node_neg > 0 {
        vector_z[node_neg - 1] += diff;
    }
}

fn evaluate_waveform(
    comp: &ComponentData,
    overrides: Option<&HashMap<String, f64>>,
    wave: &str,
    t: f64,
    fallback: f64,
) -> f64 {
    let amp = override_or(overrides, "amplitude", comp.amplitude).unwrap_or(0.0);
    let freq = override_or(overrides, "frequency", comp.frequency).unwrap_or(1e3);
    let offset = override_or(overrides, "offset", comp.offset).unwrap_or(0.0);
    let duty = override_or(overrides, "duty_cycle", comp.duty_cycle).unwrap_or(0.5);

    match wave {
        "sine" => offset + amp * (2.0 * std::f64::consts::PI * freq * t).sin(),
        "square" => {
            let period = 1.0 / freq;
            let t_mod = t % period;
            if t_mod < duty * period {
                offset + amp
            } else {
                offset - amp
            }
        }
        "pulse" => {
            let period = 1.0 / freq;
            let t_mod = t % period;
            let pulse_width = duty * period;
            if t_mod < pulse_width {
                offset + amp
            } else {
                offset
            }
        }
        _ => fallback,
    }
}

fn override_or(
    overrides: Option<&HashMap<String, f64>>,
    field: &str,
    default: Option<f64>,
) -> Option<f64> {
    overrides
        .and_then(|fields| fields.get(field).copied())
        .or(default)
}
