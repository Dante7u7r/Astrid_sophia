use crate::solver::types::CircuitNetlist;
use nalgebra::DVector;
use std::collections::HashMap;

pub(crate) struct LteEstimate {
    pub(crate) maximum: f64,
    pub(crate) integrator_order: f64,
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn estimate_local_truncation_error(
    step_solution: &DVector<f64>,
    sol_n: &DVector<f64>,
    sol_n1: &DVector<f64>,
    sol_n2: &DVector<f64>,
    node_count: usize,
    dt: f64,
    previous_dt: f64,
    is_fixed: bool,
    steps_completed: usize,
    integration_method: &str,
) -> LteEstimate {
    if is_fixed || steps_completed < 2 {
        return LteEstimate {
            maximum: 0.0,
            integrator_order: 1.0,
        };
    }

    let third_order =
        steps_completed >= 3 && (integration_method == "trap" || integration_method == "gear2");
    if third_order {
        let coefficient = if integration_method == "trap" {
            1.0 / 12.0
        } else {
            2.0 / 9.0
        };
        let mut maximum: f64 = 0.0;
        for i in 0..node_count {
            let d3 =
                (step_solution[i] - 3.0 * sol_n[i] + 3.0 * sol_n1[i] - sol_n2[i]) / (dt * dt * dt);
            maximum = maximum.max(coefficient * dt * dt * dt * d3.abs());
        }
        return LteEstimate {
            maximum,
            integrator_order: 2.0,
        };
    }

    let mut maximum: f64 = 0.0;
    for i in 0..node_count {
        let d1 = (step_solution[i] - sol_n[i]) / dt;
        let d2 = (sol_n[i] - sol_n1[i]) / previous_dt;
        let second_derivative = 2.0 * (d1 - d2) / (dt + previous_dt);
        maximum = maximum.max(0.5 * dt * dt * second_derivative.abs());
    }
    LteEstimate {
        maximum,
        integrator_order: 1.0,
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn update_trapezoidal_history(
    netlist: &CircuitNetlist,
    step_solution: &DVector<f64>,
    dt: f64,
    cap_states: &HashMap<String, f64>,
    cap_currents: &mut HashMap<String, f64>,
    ind_states: &mut HashMap<String, f64>,
    ind_states_prev: &mut HashMap<String, f64>,
    ind_voltages: &mut HashMap<String, f64>,
) {
    for comp in &netlist.components {
        let node_voltage = |node: usize| {
            if node > 0 {
                step_solution[node - 1]
            } else {
                0.0
            }
        };
        if comp.comp_type == "capacitor" {
            let node_pos = comp.pins[0].parse::<usize>().unwrap();
            let node_neg = comp.pins[1].parse::<usize>().unwrap();
            let previous_voltage = *cap_states.get(&comp.id).unwrap_or(&0.0);
            let voltage = node_voltage(node_pos) - node_voltage(node_neg);
            let previous_current = *cap_currents.get(&comp.id).unwrap_or(&0.0);
            let current = (2.0 * comp.value / dt) * (voltage - previous_voltage) - previous_current;
            cap_currents.insert(comp.id.clone(), current);
        } else if comp.comp_type == "inductor" {
            let node_pos = comp.pins[0].parse::<usize>().unwrap();
            let node_neg = comp.pins[1].parse::<usize>().unwrap();
            let voltage = node_voltage(node_pos) - node_voltage(node_neg);
            let previous_current = *ind_states.get(&comp.id).unwrap();
            let previous_voltage = *ind_voltages.get(&comp.id).unwrap_or(&0.0);
            let current =
                previous_current + (dt / (2.0 * comp.value)) * (voltage + previous_voltage);
            ind_states_prev.insert(comp.id.clone(), previous_current);
            ind_states.insert(comp.id.clone(), current);
            ind_voltages.insert(comp.id.clone(), voltage);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_step_has_no_lte_rejection_signal() {
        let sample = DVector::from_vec(vec![1.0]);
        let estimate = estimate_local_truncation_error(
            &sample, &sample, &sample, &sample, 1, 1e-3, 1e-3, true, 4, "trap",
        );
        assert_eq!(estimate.maximum, 0.0);
        assert_eq!(estimate.integrator_order, 1.0);
    }

    #[test]
    fn linear_ramp_has_zero_euler_lte() {
        let estimate = estimate_local_truncation_error(
            &DVector::from_vec(vec![3.0]),
            &DVector::from_vec(vec![2.0]),
            &DVector::from_vec(vec![1.0]),
            &DVector::from_vec(vec![0.0]),
            1,
            1.0,
            1.0,
            false,
            2,
            "euler",
        );
        assert_eq!(estimate.maximum, 0.0);
    }
}
