use crate::solver::types::CircuitNetlist;
use nalgebra::DVector;
use std::collections::HashMap;

pub(crate) struct IntegrationHistoryParams<'a> {
    pub integration_method: &'a str,
    pub gear2_active_this_step: bool,
    pub gear_a: f64,
    pub gear_b: f64,
    pub gear_c: f64,
    pub dt: f64,
}

pub(crate) fn update_passive_storage_states(
    netlist: &CircuitNetlist,
    step_solution: &DVector<f64>,
    cap_states: &mut HashMap<String, f64>,
    cap_states_prev: &mut HashMap<String, f64>,
    ind_states: &mut HashMap<String, f64>,
    ind_states_prev: &mut HashMap<String, f64>,
    params: &IntegrationHistoryParams<'_>,
) {
    for comp in &netlist.components {
        match comp.comp_type.as_str() {
            "capacitor" => {
                let node_pos = comp.pins[0].parse::<usize>().unwrap();
                let node_neg = comp.pins[1].parse::<usize>().unwrap();
                let new_vc =
                    node_voltage(step_solution, node_pos) - node_voltage(step_solution, node_neg);
                let prev_vc = *cap_states.get(&comp.id).unwrap_or(&0.0);
                cap_states_prev.insert(comp.id.clone(), prev_vc);
                cap_states.insert(comp.id.clone(), new_vc);
            }
            "inductor" => {
                if is_coupled_inductor(netlist, &comp.id) || params.integration_method == "trap" {
                    continue;
                }

                let node_pos = comp.pins[0].parse::<usize>().unwrap();
                let node_neg = comp.pins[1].parse::<usize>().unwrap();
                let new_vl =
                    node_voltage(step_solution, node_pos) - node_voltage(step_solution, node_neg);
                let prev_il = *ind_states.get(&comp.id).unwrap();
                let prev_prev_il = *ind_states_prev.get(&comp.id).unwrap_or(&prev_il);

                let new_il = if params.gear2_active_this_step {
                    let g_eq = 1.0 / (params.gear_a * comp.value);
                    let i_eq_val = -(params.gear_b / params.gear_a) * prev_il
                        - (params.gear_c / params.gear_a) * prev_prev_il;
                    g_eq * new_vl + i_eq_val
                } else {
                    (params.dt / comp.value) * new_vl + prev_il
                };

                ind_states_prev.insert(comp.id.clone(), prev_il);
                ind_states.insert(comp.id.clone(), new_il);
            }
            _ => {}
        }
    }
}

pub(crate) fn update_coupled_inductor_states(
    netlist: &CircuitNetlist,
    step_solution: &DVector<f64>,
    ind_states: &mut HashMap<String, f64>,
    ind_states_prev: &mut HashMap<String, f64>,
    params: &IntegrationHistoryParams<'_>,
) {
    if let Some(ref mutuals) = netlist.mutual_inductances {
        for k_comp in mutuals {
            if let (Some(l1), Some(l2)) = (
                netlist.components.iter().find(|c| c.id == k_comp.l1_id),
                netlist.components.iter().find(|c| c.id == k_comp.l2_id),
            ) {
                let node_1pos = l1.pins[0].parse::<usize>().unwrap();
                let node_1neg = l1.pins[1].parse::<usize>().unwrap();
                let node_2pos = l2.pins[0].parse::<usize>().unwrap();
                let node_2neg = l2.pins[1].parse::<usize>().unwrap();

                let v1 =
                    node_voltage(step_solution, node_1pos) - node_voltage(step_solution, node_1neg);
                let v2 =
                    node_voltage(step_solution, node_2pos) - node_voltage(step_solution, node_2neg);

                let l1_val = l1.value;
                let l2_val = l2.value;
                let m = k_comp.k_coeff * (l1_val * l2_val).sqrt();
                let delta = l1_val * l2_val - m * m;

                if delta.abs() <= 1e-30 {
                    continue;
                }

                let prev_il1 = *ind_states.get(&l1.id).unwrap_or(&0.0);
                let prev_il2 = *ind_states.get(&l2.id).unwrap_or(&0.0);
                let f_step = if params.gear2_active_this_step {
                    1.0 / params.gear_a
                } else {
                    params.dt
                };

                let g11 = (f_step * l2_val) / delta;
                let g22 = (f_step * l1_val) / delta;
                let g12 = -(f_step * m) / delta;

                let (i_eq1, i_eq2) = if params.gear2_active_this_step {
                    let prev_prev_il1 = *ind_states_prev.get(&l1.id).unwrap_or(&prev_il1);
                    let prev_prev_il2 = *ind_states_prev.get(&l2.id).unwrap_or(&prev_il2);
                    (
                        -(params.gear_b / params.gear_a) * prev_il1
                            - (params.gear_c / params.gear_a) * prev_prev_il1,
                        -(params.gear_b / params.gear_a) * prev_il2
                            - (params.gear_c / params.gear_a) * prev_prev_il2,
                    )
                } else {
                    (prev_il1, prev_il2)
                };

                let new_il1 = g11 * v1 + g12 * v2 + i_eq1;
                let new_il2 = g12 * v1 + g22 * v2 + i_eq2;

                ind_states_prev.insert(l1.id.clone(), prev_il1);
                ind_states.insert(l1.id.clone(), new_il1);
                ind_states_prev.insert(l2.id.clone(), prev_il2);
                ind_states.insert(l2.id.clone(), new_il2);
            }
        }
    }
}

fn is_coupled_inductor(netlist: &CircuitNetlist, component_id: &str) -> bool {
    netlist.mutual_inductances.as_ref().is_some_and(|mutuals| {
        mutuals
            .iter()
            .any(|m| m.l1_id == component_id || m.l2_id == component_id)
    })
}

fn node_voltage(solution: &DVector<f64>, node: usize) -> f64 {
    if node > 0 {
        solution[node - 1]
    } else {
        0.0
    }
}
