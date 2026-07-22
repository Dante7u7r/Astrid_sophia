use crate::solver::types::CircuitNetlist;
use nalgebra::{DMatrix, DVector};
use std::collections::HashMap;

use super::transient_setup::ComponentOverrideMap;
use super::transient_state_updates::IntegrationHistoryParams;

pub(crate) struct CompanionStampState<'a> {
    pub current_solution: &'a DVector<f64>,
    pub cap_states: &'a HashMap<String, f64>,
    pub cap_states_prev: &'a HashMap<String, f64>,
    pub cap_currents: &'a HashMap<String, f64>,
    pub ind_states: &'a HashMap<String, f64>,
    pub ind_states_prev: &'a HashMap<String, f64>,
    pub ind_voltages: &'a HashMap<String, f64>,
    pub switch_states: &'a HashMap<String, bool>,
    pub local_overrides: &'a ComponentOverrideMap,
}

pub(crate) fn stamp_transient_companions(
    netlist: &CircuitNetlist,
    matrix: &mut DMatrix<f64>,
    vector: &mut DVector<f64>,
    state: &CompanionStampState<'_>,
    params: &IntegrationHistoryParams<'_>,
) {
    for comp in &netlist.components {
        match comp.comp_type.as_str() {
            "capacitor" => {
                let node_pos = comp.pins[0].parse::<usize>().unwrap();
                let node_neg = comp.pins[1].parse::<usize>().unwrap();
                let prev_vc = *state.cap_states.get(&comp.id).unwrap();

                let (g_eq, i_eq) = if params.gear2_active_this_step {
                    let prev_prev_vc = *state.cap_states_prev.get(&comp.id).unwrap_or(&prev_vc);
                    let g = params.gear_a * comp.value;
                    let i = -comp.value * (params.gear_b * prev_vc + params.gear_c * prev_prev_vc);
                    (g, i)
                } else if params.integration_method == "trap" {
                    let prev_ic = *state.cap_currents.get(&comp.id).unwrap_or(&0.0);
                    let g = 2.0 * comp.value / params.dt;
                    let i = -prev_ic - g * prev_vc;
                    (g, i)
                } else {
                    let g = comp.value / params.dt;
                    let i = g * prev_vc;
                    (g, i)
                };

                stamp_conductance(matrix, node_pos, node_pos, g_eq);
                stamp_conductance(matrix, node_neg, node_neg, g_eq);
                stamp_conductance(matrix, node_pos, node_neg, -g_eq);
                stamp_conductance(matrix, node_neg, node_pos, -g_eq);

                if node_pos > 0 {
                    vector[node_pos - 1] += i_eq;
                }
                if node_neg > 0 {
                    vector[node_neg - 1] -= i_eq;
                }
            }
            "inductor" => {
                if is_coupled_inductor(netlist, &comp.id) {
                    continue;
                }

                let node_pos = comp.pins[0].parse::<usize>().unwrap();
                let node_neg = comp.pins[1].parse::<usize>().unwrap();
                let prev_il = *state.ind_states.get(&comp.id).unwrap();

                let (g_eq, i_eq) = if params.gear2_active_this_step {
                    let prev_prev_il = *state.ind_states_prev.get(&comp.id).unwrap_or(&prev_il);
                    let g = 1.0 / (params.gear_a * comp.value);
                    let i = -(params.gear_b / params.gear_a) * prev_il
                        - (params.gear_c / params.gear_a) * prev_prev_il;
                    (g, i)
                } else if params.integration_method == "trap" {
                    let g = params.dt / (2.0 * comp.value);
                    let prev_vl = *state.ind_voltages.get(&comp.id).unwrap_or(&0.0);
                    let i = prev_il + g * prev_vl;
                    (g, i)
                } else {
                    let g = params.dt / comp.value;
                    let i = prev_il;
                    (g, i)
                };

                let g_tot = g_eq + 1e-12;
                stamp_conductance(matrix, node_pos, node_pos, g_tot);
                stamp_conductance(matrix, node_neg, node_neg, g_tot);
                stamp_conductance(matrix, node_pos, node_neg, -g_tot);
                stamp_conductance(matrix, node_neg, node_pos, -g_tot);

                if node_pos > 0 {
                    vector[node_pos - 1] -= i_eq;
                }
                if node_neg > 0 {
                    vector[node_neg - 1] += i_eq;
                }
            }
            "and_gate" | "or_gate" | "not_gate" | "nand_gate" | "nor_gate" | "xor_gate" => {
                let node_out = comp.pins[comp.pins.len() - 1].parse::<usize>().unwrap();
                let inputs = comp.pins[..comp.pins.len() - 1]
                    .iter()
                    .map(|pin| {
                        let node = pin.parse::<usize>().unwrap();
                        node > 0 && state.current_solution[node - 1] > 1.5
                    })
                    .collect::<Vec<_>>();

                let out_high = match comp.comp_type.as_str() {
                    "and_gate" => inputs.iter().all(|&input| input),
                    "or_gate" => inputs.iter().any(|&input| input),
                    "not_gate" => !inputs.first().copied().unwrap_or(false),
                    "nand_gate" => !inputs.iter().all(|&input| input),
                    "nor_gate" => !inputs.iter().any(|&input| input),
                    "xor_gate" => inputs.iter().filter(|&&input| input).count() % 2 == 1,
                    _ => false,
                };

                let r_out = 100.0;
                let g_eq = 1.0 / r_out;
                let i_eq = if out_high { 5.0 / r_out } else { 0.0 };

                stamp_conductance(matrix, node_out, node_out, g_eq);
                if node_out > 0 {
                    vector[node_out - 1] += i_eq;
                }
            }
            "switch" => {
                let overrides = state.local_overrides.get(&comp.id);
                let node_a = comp.pins[0].parse::<usize>().unwrap();
                let node_b = comp.pins[1].parse::<usize>().unwrap();
                let ron = overrides
                    .and_then(|fields| fields.get("switch_ron").copied())
                    .unwrap_or(comp.switch_ron.unwrap_or(0.01));
                let roff = overrides
                    .and_then(|fields| fields.get("switch_roff").copied())
                    .unwrap_or(comp.switch_roff.unwrap_or(1e9));
                let is_closed = state.switch_states.get(&comp.id).copied().unwrap_or(false);
                let conductance = 1.0 / if is_closed { ron } else { roff };

                stamp_conductance(matrix, node_a, node_a, conductance);
                stamp_conductance(matrix, node_b, node_b, conductance);
                stamp_conductance(matrix, node_a, node_b, -conductance);
                stamp_conductance(matrix, node_b, node_a, -conductance);
            }
            _ => {}
        }
    }

    stamp_coupled_inductors(netlist, matrix, vector, state, params);
}

fn stamp_coupled_inductors(
    netlist: &CircuitNetlist,
    matrix: &mut DMatrix<f64>,
    vector: &mut DVector<f64>,
    state: &CompanionStampState<'_>,
    params: &IntegrationHistoryParams<'_>,
) {
    let Some(mutuals) = netlist.mutual_inductances.as_ref() else {
        return;
    };

    for mutual in mutuals {
        let (Some(l1), Some(l2)) = (
            netlist
                .components
                .iter()
                .find(|comp| comp.id == mutual.l1_id),
            netlist
                .components
                .iter()
                .find(|comp| comp.id == mutual.l2_id),
        ) else {
            continue;
        };

        let node_1pos = l1.pins[0].parse::<usize>().unwrap();
        let node_1neg = l1.pins[1].parse::<usize>().unwrap();
        let node_2pos = l2.pins[0].parse::<usize>().unwrap();
        let node_2neg = l2.pins[1].parse::<usize>().unwrap();
        let mutual_inductance = mutual.k_coeff * (l1.value * l2.value).sqrt();
        let determinant = l1.value * l2.value - mutual_inductance * mutual_inductance;

        if determinant.abs() <= 1e-30 {
            continue;
        }

        let step_factor = if params.gear2_active_this_step {
            1.0 / params.gear_a
        } else {
            params.dt
        };
        let g11 = step_factor * l2.value / determinant;
        let g22 = step_factor * l1.value / determinant;
        let g12 = -step_factor * mutual_inductance / determinant;

        stamp_two_terminal_conductance(matrix, node_1pos, node_1neg, g11 + 1e-12);
        stamp_two_terminal_conductance(matrix, node_2pos, node_2neg, g22 + 1e-12);

        stamp_conductance(matrix, node_1pos, node_2pos, g12);
        stamp_conductance(matrix, node_1neg, node_2neg, g12);
        stamp_conductance(matrix, node_1pos, node_2neg, -g12);
        stamp_conductance(matrix, node_1neg, node_2pos, -g12);
        stamp_conductance(matrix, node_2pos, node_1pos, g12);
        stamp_conductance(matrix, node_2neg, node_1neg, g12);
        stamp_conductance(matrix, node_2pos, node_1neg, -g12);
        stamp_conductance(matrix, node_2neg, node_1pos, -g12);

        let prev_il1 = *state.ind_states.get(&l1.id).unwrap_or(&0.0);
        let prev_il2 = *state.ind_states.get(&l2.id).unwrap_or(&0.0);
        let (i_eq1, i_eq2) = if params.gear2_active_this_step {
            let prev_prev_il1 = *state.ind_states_prev.get(&l1.id).unwrap_or(&prev_il1);
            let prev_prev_il2 = *state.ind_states_prev.get(&l2.id).unwrap_or(&prev_il2);
            (
                -(params.gear_b / params.gear_a) * prev_il1
                    - (params.gear_c / params.gear_a) * prev_prev_il1,
                -(params.gear_b / params.gear_a) * prev_il2
                    - (params.gear_c / params.gear_a) * prev_prev_il2,
            )
        } else {
            (prev_il1, prev_il2)
        };

        stamp_current(vector, node_1pos, node_1neg, i_eq1);
        stamp_current(vector, node_2pos, node_2neg, i_eq2);
    }
}

fn is_coupled_inductor(netlist: &CircuitNetlist, component_id: &str) -> bool {
    netlist.mutual_inductances.as_ref().is_some_and(|mutuals| {
        mutuals
            .iter()
            .any(|mutual| mutual.l1_id == component_id || mutual.l2_id == component_id)
    })
}

fn stamp_two_terminal_conductance(
    matrix: &mut DMatrix<f64>,
    node_pos: usize,
    node_neg: usize,
    conductance: f64,
) {
    stamp_conductance(matrix, node_pos, node_pos, conductance);
    stamp_conductance(matrix, node_neg, node_neg, conductance);
    stamp_conductance(matrix, node_pos, node_neg, -conductance);
    stamp_conductance(matrix, node_neg, node_pos, -conductance);
}

fn stamp_conductance(matrix: &mut DMatrix<f64>, row: usize, column: usize, value: f64) {
    if row > 0 && column > 0 {
        matrix[(row - 1, column - 1)] += value;
    }
}

pub(crate) fn stamp_companion_conductance(
    matrix: &mut DMatrix<f64>,
    row: usize,
    column: usize,
    value: f64,
) {
    stamp_conductance(matrix, row, column, value);
}

fn stamp_current(vector: &mut DVector<f64>, node_pos: usize, node_neg: usize, current: f64) {
    if node_pos > 0 {
        vector[node_pos - 1] -= current;
    }
    if node_neg > 0 {
        vector[node_neg - 1] += current;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::solver::types::ComponentData;

    #[derive(Default)]
    struct OwnedStampState {
        cap_states: HashMap<String, f64>,
        cap_states_prev: HashMap<String, f64>,
        cap_currents: HashMap<String, f64>,
        ind_states: HashMap<String, f64>,
        ind_states_prev: HashMap<String, f64>,
        ind_voltages: HashMap<String, f64>,
        switch_states: HashMap<String, bool>,
        local_overrides: ComponentOverrideMap,
    }

    impl OwnedStampState {
        fn as_stamp_state<'a>(
            &'a self,
            current_solution: &'a DVector<f64>,
        ) -> CompanionStampState<'a> {
            CompanionStampState {
                current_solution,
                cap_states: &self.cap_states,
                cap_states_prev: &self.cap_states_prev,
                cap_currents: &self.cap_currents,
                ind_states: &self.ind_states,
                ind_states_prev: &self.ind_states_prev,
                ind_voltages: &self.ind_voltages,
                switch_states: &self.switch_states,
                local_overrides: &self.local_overrides,
            }
        }
    }

    fn integration_params(dt: f64) -> IntegrationHistoryParams<'static> {
        IntegrationHistoryParams {
            integration_method: "euler",
            gear2_active_this_step: false,
            gear_a: 0.0,
            gear_b: 0.0,
            gear_c: 0.0,
            dt,
        }
    }

    #[test]
    fn stamps_euler_capacitor_companion_exactly() {
        let netlist = CircuitNetlist {
            components: vec![ComponentData {
                id: "C1".to_string(),
                comp_type: "capacitor".to_string(),
                value: 2.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            }],
            ..Default::default()
        };
        let mut owned_state = OwnedStampState::default();
        owned_state.cap_states.insert("C1".to_string(), 3.0);
        let current_solution = DVector::zeros(1);
        let mut matrix = DMatrix::zeros(1, 1);
        let mut vector = DVector::zeros(1);

        stamp_transient_companions(
            &netlist,
            &mut matrix,
            &mut vector,
            &owned_state.as_stamp_state(&current_solution),
            &integration_params(0.5),
        );

        assert_eq!(matrix[(0, 0)], 4.0);
        assert_eq!(vector[0], 12.0);
    }

    #[test]
    fn stamps_closed_switch_using_live_ron_override() {
        let netlist = CircuitNetlist {
            components: vec![ComponentData {
                id: "S1".to_string(),
                comp_type: "switch".to_string(),
                pins: vec!["1".to_string(), "2".to_string()],
                switch_ron: Some(10.0),
                ..Default::default()
            }],
            ..Default::default()
        };
        let mut owned_state = OwnedStampState::default();
        owned_state.switch_states.insert("S1".to_string(), true);
        owned_state.local_overrides.insert(
            "S1".to_string(),
            HashMap::from([("switch_ron".to_string(), 0.5)]),
        );
        let current_solution = DVector::zeros(2);
        let mut matrix = DMatrix::zeros(2, 2);
        let mut vector = DVector::zeros(2);

        stamp_transient_companions(
            &netlist,
            &mut matrix,
            &mut vector,
            &owned_state.as_stamp_state(&current_solution),
            &integration_params(1.0),
        );

        assert_eq!(matrix[(0, 0)], 2.0);
        assert_eq!(matrix[(1, 1)], 2.0);
        assert_eq!(matrix[(0, 1)], -2.0);
        assert_eq!(matrix[(1, 0)], -2.0);
        assert_eq!(vector, DVector::zeros(2));
    }
}
