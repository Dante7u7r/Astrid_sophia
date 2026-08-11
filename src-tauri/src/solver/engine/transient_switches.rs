use crate::solver::types::{CircuitNetlist, ComponentData};
use nalgebra::DVector;
use std::collections::HashMap;

use super::transient_setup::ComponentOverrideMap;

pub(crate) fn update_switch_states(
    netlist: &CircuitNetlist,
    local_overrides: &ComponentOverrideMap,
    current_solution: &DVector<f64>,
    switch_states: &mut HashMap<String, bool>,
) {
    for comp in &netlist.components {
        if comp.comp_type == "switch" {
            update_switch_state(comp, local_overrides, current_solution, switch_states);
        }
    }
}

fn update_switch_state(
    comp: &ComponentData,
    local_overrides: &ComponentOverrideMap,
    current_solution: &DVector<f64>,
    switch_states: &mut HashMap<String, bool>,
) {
    let overrides = local_overrides.get(&comp.id);

    if let Some(&forced) = overrides.and_then(|fields| fields.get("switch_state")) {
        switch_states.insert(comp.id.clone(), forced >= 0.5);
        return;
    }

    let (Ok(node_a), Ok(node_b)) = (comp.pins[0].parse::<usize>(), comp.pins[1].parse::<usize>())
    else {
        return;
    };

    let v_a = if node_a > 0 {
        current_solution[node_a - 1]
    } else {
        0.0
    };
    let v_b = if node_b > 0 {
        current_solution[node_b - 1]
    } else {
        0.0
    };
    let v_ab = v_a - v_b;
    let vth = overrides
        .and_then(|fields| fields.get("switch_vth").copied())
        .unwrap_or(comp.switch_vth.unwrap_or(0.5));
    let vh = overrides
        .and_then(|fields| fields.get("switch_vh").copied())
        .unwrap_or(comp.switch_vh.unwrap_or(0.05));
    let was_closed = switch_states.get(&comp.id).copied().unwrap_or(false);
    let new_state = if !was_closed && v_ab > vth + vh / 2.0 {
        true
    } else if was_closed && v_ab < vth - vh / 2.0 {
        false
    } else {
        was_closed
    };
    switch_states.insert(comp.id.clone(), new_state);
}
