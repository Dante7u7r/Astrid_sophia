use crate::solver::types::CircuitNetlist;
use nalgebra::{DMatrix, DVector};
use std::collections::HashMap;

use super::transient_setup::ComponentOverrideMap;
use super::transient_state_updates::IntegrationHistoryParams;

pub(crate) struct CompanionStampState<'a> {
    pub cap_states: &'a HashMap<String, f64>,
    pub cap_states_prev: &'a HashMap<String, f64>,
    pub cap_history: Option<&'a [HashMap<String, f64>]>,
    pub cap_currents: &'a HashMap<String, f64>,
    pub ind_states: &'a HashMap<String, f64>,
    pub ind_states_prev: &'a HashMap<String, f64>,
    pub ind_history: Option<&'a [HashMap<String, f64>]>,
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
                let node_pos = comp
                    .pins
                    .first()
                    .and_then(|p| p.parse::<usize>().ok())
                    .unwrap_or(0);
                let node_neg = comp
                    .pins
                    .get(1)
                    .and_then(|p| p.parse::<usize>().ok())
                    .unwrap_or(0);
                let prev_vc = *state.cap_states.get(&comp.id).unwrap_or(&0.0);
                let dt_safe = params.dt.max(1e-18);
                let cap_val_safe = comp.value.max(1e-18);

                let (g_eq, i_eq) = if params.trap_active_this_step {
                    let prev_ic = *state.cap_currents.get(&comp.id).unwrap_or(&0.0);
                    let g = 2.0 * cap_val_safe / dt_safe;
                    let i = prev_ic + g * prev_vc;
                    (g, i)
                } else if params.bdf_order >= 1 && !params.bdf_alphas.is_empty() {
                    let alpha_0 = params.bdf_alphas[0].max(1e-18);
                    let g = alpha_0 * cap_val_safe;
                    let mut sum_hist = 0.0;
                    for j in 1..=params.bdf_order.min(params.bdf_alphas.len() - 1) {
                        let past_v = if j == 1 {
                            prev_vc
                        } else if j == 2 {
                            *state.cap_states_prev.get(&comp.id).unwrap_or(&prev_vc)
                        } else if let Some(hist) = state.cap_history {
                            if j - 1 < hist.len() {
                                *hist[j - 1].get(&comp.id).unwrap_or(&prev_vc)
                            } else {
                                prev_vc
                            }
                        } else {
                            prev_vc
                        };
                        sum_hist += params.bdf_alphas[j] * past_v;
                    }
                    let i = -cap_val_safe * sum_hist;
                    (g, i)
                } else if params.gear2_active_this_step {
                    let prev_prev_vc = *state.cap_states_prev.get(&comp.id).unwrap_or(&prev_vc);
                    let g = params.gear_a * cap_val_safe;
                    let i =
                        -cap_val_safe * (params.gear_b * prev_vc + params.gear_c * prev_prev_vc);
                    (g, i)
                } else {
                    let g = cap_val_safe / dt_safe;
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

                let node_pos = comp
                    .pins
                    .first()
                    .and_then(|p| p.parse::<usize>().ok())
                    .unwrap_or(0);
                let node_neg = comp
                    .pins
                    .get(1)
                    .and_then(|p| p.parse::<usize>().ok())
                    .unwrap_or(0);
                let prev_il = *state.ind_states.get(&comp.id).unwrap_or(&0.0);
                let dt_safe = params.dt.max(1e-18);
                let l_nominal = comp.value.max(1e-18);
                let ind_val_safe = if let Some(isat) = comp.isat {
                    if isat > 0.0 {
                        let ratio = prev_il / isat;
                        l_nominal / (1.0 + ratio * ratio)
                    } else {
                        l_nominal
                    }
                } else {
                    l_nominal
                }
                .max(1e-18);

                let (g_eq, i_eq) = if params.trap_active_this_step {
                    let g = dt_safe / (2.0 * ind_val_safe);
                    let prev_vl = *state.ind_voltages.get(&comp.id).unwrap_or(&0.0);
                    let i = prev_il + g * prev_vl;
                    (g, i)
                } else if params.bdf_order >= 1 && !params.bdf_alphas.is_empty() {
                    let alpha_0 = params.bdf_alphas[0].max(1e-18);
                    let g = 1.0 / (alpha_0 * ind_val_safe);
                    let mut sum_hist = 0.0;
                    for j in 1..=params.bdf_order.min(params.bdf_alphas.len() - 1) {
                        let past_i = if j == 1 {
                            prev_il
                        } else if j == 2 {
                            *state.ind_states_prev.get(&comp.id).unwrap_or(&prev_il)
                        } else if let Some(hist) = state.ind_history {
                            if j - 1 < hist.len() {
                                *hist[j - 1].get(&comp.id).unwrap_or(&prev_il)
                            } else {
                                prev_il
                            }
                        } else {
                            prev_il
                        };
                        sum_hist += params.bdf_alphas[j] * past_i;
                    }
                    let i = -(1.0 / alpha_0) * sum_hist;
                    (g, i)
                } else if params.gear2_active_this_step {
                    let prev_prev_il = *state.ind_states_prev.get(&comp.id).unwrap_or(&prev_il);
                    let g = 1.0 / (params.gear_a.max(1e-18) * ind_val_safe);
                    let i = -(params.gear_b / params.gear_a.max(1e-18)) * prev_il
                        - (params.gear_c / params.gear_a.max(1e-18)) * prev_prev_il;
                    (g, i)
                } else {
                    let g = dt_safe / ind_val_safe;
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
            "switch" => {
                let overrides = state.local_overrides.get(&comp.id);
                let node_a = comp
                    .pins
                    .first()
                    .and_then(|p| p.parse::<usize>().ok())
                    .unwrap_or(0);
                let node_b = comp
                    .pins
                    .get(1)
                    .and_then(|p| p.parse::<usize>().ok())
                    .unwrap_or(0);
                let ron = overrides
                    .and_then(|fields| fields.get("switch_ron").copied())
                    .unwrap_or(comp.switch_ron.unwrap_or(0.01))
                    .max(1e-9);
                let roff = overrides
                    .and_then(|fields| fields.get("switch_roff").copied())
                    .unwrap_or(comp.switch_roff.unwrap_or(1e9))
                    .max(1e-9);
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

        let node_1pos = l1
            .pins
            .first()
            .and_then(|p| p.parse::<usize>().ok())
            .unwrap_or(0);
        let node_1neg = l1
            .pins
            .get(1)
            .and_then(|p| p.parse::<usize>().ok())
            .unwrap_or(0);
        let node_2pos = l2
            .pins
            .first()
            .and_then(|p| p.parse::<usize>().ok())
            .unwrap_or(0);
        let node_2neg = l2
            .pins
            .get(1)
            .and_then(|p| p.parse::<usize>().ok())
            .unwrap_or(0);
        let mutual_inductance = mutual.k_coeff * (l1.value * l2.value).sqrt();
        let determinant = l1.value * l2.value - mutual_inductance * mutual_inductance;

        if determinant.abs() <= 1e-30 {
            continue;
        }

        let step_factor = if params.bdf_order >= 1 && !params.bdf_alphas.is_empty() {
            1.0 / params.bdf_alphas[0].max(1e-18)
        } else if params.gear2_active_this_step {
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
        let (i_eq1, i_eq2) = if params.bdf_order >= 1 && !params.bdf_alphas.is_empty() {
            let alpha_0 = params.bdf_alphas[0].max(1e-18);
            let mut sum1 = 0.0;
            let mut sum2 = 0.0;
            for j in 1..=params.bdf_order.min(params.bdf_alphas.len() - 1) {
                let past_il1 = if j == 1 {
                    prev_il1
                } else if j == 2 {
                    *state.ind_states_prev.get(&l1.id).unwrap_or(&prev_il1)
                } else if let Some(hist) = state.ind_history {
                    if j - 1 < hist.len() {
                        *hist[j - 1].get(&l1.id).unwrap_or(&prev_il1)
                    } else {
                        prev_il1
                    }
                } else {
                    prev_il1
                };
                let past_il2 = if j == 1 {
                    prev_il2
                } else if j == 2 {
                    *state.ind_states_prev.get(&l2.id).unwrap_or(&prev_il2)
                } else if let Some(hist) = state.ind_history {
                    if j - 1 < hist.len() {
                        *hist[j - 1].get(&l2.id).unwrap_or(&prev_il2)
                    } else {
                        prev_il2
                    }
                } else {
                    prev_il2
                };
                sum1 += params.bdf_alphas[j] * past_il1;
                sum2 += params.bdf_alphas[j] * past_il2;
            }
            (-(1.0 / alpha_0) * sum1, -(1.0 / alpha_0) * sum2)
        } else if params.gear2_active_this_step {
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
        fn as_stamp_state(&self) -> CompanionStampState<'_> {
            CompanionStampState {
                cap_states: &self.cap_states,
                cap_states_prev: &self.cap_states_prev,
                cap_history: None,
                cap_currents: &self.cap_currents,
                ind_states: &self.ind_states,
                ind_states_prev: &self.ind_states_prev,
                ind_history: None,
                ind_voltages: &self.ind_voltages,
                switch_states: &self.switch_states,
                local_overrides: &self.local_overrides,
            }
        }
    }

    fn integration_params(dt: f64) -> IntegrationHistoryParams<'static> {
        IntegrationHistoryParams {
            integration_method: "euler",
            trap_active_this_step: false,
            gear2_active_this_step: false,
            bdf_order: 1,
            bdf_alphas: &[],
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
        let mut matrix = DMatrix::zeros(1, 1);
        let mut vector = DVector::zeros(1);

        stamp_transient_companions(
            &netlist,
            &mut matrix,
            &mut vector,
            &owned_state.as_stamp_state(),
            &integration_params(0.5),
        );

        assert_eq!(matrix[(0, 0)], 4.0);
        assert_eq!(vector[0], 12.0);
    }

    #[test]
    fn trapezoidal_startup_uses_euler_before_history_exists() {
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
        owned_state.cap_currents.insert("C1".to_string(), 5.0);
        let mut matrix = DMatrix::zeros(1, 1);
        let mut vector = DVector::zeros(1);
        let params = IntegrationHistoryParams {
            integration_method: "trap",
            trap_active_this_step: false,
            gear2_active_this_step: false,
            bdf_order: 1,
            bdf_alphas: &[2.0, -2.0],
            gear_a: 0.0,
            gear_b: 0.0,
            gear_c: 0.0,
            dt: 0.5,
        };

        stamp_transient_companions(
            &netlist,
            &mut matrix,
            &mut vector,
            &owned_state.as_stamp_state(),
            &params,
        );

        assert_eq!(matrix[(0, 0)], 4.0);
        assert_eq!(vector[0], 12.0);
    }

    #[test]
    fn stamps_trapezoidal_capacitor_history_with_physical_sign() {
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
        owned_state.cap_currents.insert("C1".to_string(), 5.0);
        let mut matrix = DMatrix::zeros(1, 1);
        let mut vector = DVector::zeros(1);
        let params = IntegrationHistoryParams {
            integration_method: "trap",
            trap_active_this_step: true,
            gear2_active_this_step: false,
            bdf_order: 2,
            bdf_alphas: &[],
            gear_a: 0.0,
            gear_b: 0.0,
            gear_c: 0.0,
            dt: 0.5,
        };

        stamp_transient_companions(
            &netlist,
            &mut matrix,
            &mut vector,
            &owned_state.as_stamp_state(),
            &params,
        );

        assert_eq!(matrix[(0, 0)], 8.0);
        assert_eq!(vector[0], 29.0);
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
        let mut matrix = DMatrix::zeros(2, 2);
        let mut vector = DVector::zeros(2);

        stamp_transient_companions(
            &netlist,
            &mut matrix,
            &mut vector,
            &owned_state.as_stamp_state(),
            &integration_params(1.0),
        );

        assert_eq!(matrix[(0, 0)], 2.0);
        assert_eq!(matrix[(1, 1)], 2.0);
        assert_eq!(matrix[(0, 1)], -2.0);
        assert_eq!(matrix[(1, 0)], -2.0);
        assert_eq!(vector, DVector::zeros(2));
    }

    #[test]
    fn logic_gates_are_not_stamped_as_dynamic_companions() {
        let netlist = CircuitNetlist {
            components: vec![ComponentData {
                id: "U1".to_string(),
                comp_type: "not_gate".to_string(),
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            }],
            ..Default::default()
        };
        let owned_state = OwnedStampState::default();
        let mut matrix = DMatrix::zeros(2, 2);
        let mut vector = DVector::zeros(2);

        stamp_transient_companions(
            &netlist,
            &mut matrix,
            &mut vector,
            &owned_state.as_stamp_state(),
            &integration_params(1e-6),
        );

        assert_eq!(matrix, DMatrix::zeros(2, 2));
        assert_eq!(vector, DVector::zeros(2));
    }
}
