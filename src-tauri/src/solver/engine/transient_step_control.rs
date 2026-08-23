use crate::solver::types::CircuitNetlist;
use nalgebra::DVector;
use std::collections::HashMap;

/// Tipos de métodos de integración numérica soportados en simulación transitoria.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntegrationMethodType {
    /// Backward Euler (Orden 1, L-estable, máxima disipación de alta frecuencia).
    Euler,
    /// Trapezoidal (Orden 2, A-estable, disipación numérica cero).
    Trap,
    /// Gear 2nd Order / BDF2 (Orden 2, L-estable, amortiguamiento de ringing numérico).
    Gear2,
}

impl IntegrationMethodType {
    pub fn as_str(&self) -> &'static str {
        match self {
            IntegrationMethodType::Euler => "euler",
            IntegrationMethodType::Trap => "trap",
            IntegrationMethodType::Gear2 => "gear2",
        }
    }
}

/// Controlador adaptativo de paso y orden variable para el integrador transitorio.
#[derive(Debug, Clone)]
pub struct VariableOrderController {
    /// Modo configurado por el usuario ("auto", "trap", "gear2", "euler").
    pub mode: String,
    /// Método activo para el paso actual.
    pub active_method: IntegrationMethodType,
    /// Número consecutivo de pasos con oscilación trapezoidal detectada.
    pub ringing_count: usize,
    /// Pasos completados con el método actual.
    pub steps_with_current_method: usize,
}

impl VariableOrderController {
    pub fn new(method_str: &str) -> Self {
        let (mode, active_method) = match method_str {
            "euler" | "BE" => ("euler".to_string(), IntegrationMethodType::Euler),
            "gear2" => ("gear2".to_string(), IntegrationMethodType::Gear2),
            "trap" | "trapezoidal" => ("trap".to_string(), IntegrationMethodType::Trap),
            _ => ("auto".to_string(), IntegrationMethodType::Trap),
        };
        Self {
            mode,
            active_method,
            ringing_count: 0,
            steps_with_current_method: 0,
        }
    }

    pub fn is_auto(&self) -> bool {
        self.mode == "auto"
    }
}

pub(crate) struct LteEstimate {
    pub(crate) maximum: f64,
    pub(crate) integrator_order: f64,
}

/// Detecta si existe oscilación numérica espuria (trapezoidal ringing)
/// manifestada por alternancia de signo en diferencias finitas sucesivas.
pub fn detect_trapezoidal_ringing(
    step_solution: &DVector<f64>,
    sol_n: &DVector<f64>,
    sol_n1: &DVector<f64>,
    node_count: usize,
    vntol: f64,
) -> bool {
    for i in 0..node_count {
        let d1 = step_solution[i] - sol_n[i];
        let d2 = sol_n[i] - sol_n1[i];
        let second_diff = (step_solution[i] - 2.0 * sol_n[i] + sol_n1[i]).abs();

        if d1 * d2 < -1e-15 && second_diff > 3.0 * vntol {
            return true;
        }
    }
    false
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
    reltol_opt: Option<f64>,
    vntol_opt: Option<f64>,
    dynamic_nodes: Option<&std::collections::HashSet<usize>>,
) -> LteEstimate {
    if is_fixed || steps_completed < 2 {
        return LteEstimate {
            maximum: 0.0,
            integrator_order: 1.0,
        };
    }

    if let Some(nodes) = dynamic_nodes {
        if nodes.is_empty() {
            return LteEstimate {
                maximum: 0.0,
                integrator_order: 1.0,
            };
        }
    }

    let reltol = reltol_opt.unwrap_or(1e-3);
    let vntol = vntol_opt.unwrap_or(1e-6);

    let third_order =
        steps_completed >= 3 && (integration_method == "trap" || integration_method == "gear2");
    if third_order {
        let coefficient = if integration_method == "trap" {
            1.0 / 12.0
        } else {
            2.0 / 9.0
        };
        let mut maximum: f64 = 0.0;
        let prev_h = previous_dt.max(1e-18);
        let mut check_node = |i: usize| {
            if i < node_count {
                let d1 = (step_solution[i] - sol_n[i]) / dt;
                let d2 = (sol_n[i] - sol_n1[i]) / prev_h;
                let d3 = (sol_n1[i] - sol_n2[i]) / prev_h;
                let dd1 = 2.0 * (d1 - d2) / (dt + prev_h);
                let dd2 = (d2 - d3) / prev_h;
                let third_derivative = 3.0 * (dd1 - dd2) / (dt + 2.0 * prev_h);
                let lte_raw = coefficient * dt.powi(3) * third_derivative.abs();
                let norm_scale = reltol * step_solution[i].abs() + vntol;
                maximum = maximum.max(lte_raw / norm_scale);
            }
        };

        if let Some(nodes) = dynamic_nodes {
            for &idx in nodes {
                check_node(idx);
            }
        } else {
            for i in 0..node_count {
                check_node(i);
            }
        }

        return LteEstimate {
            maximum,
            integrator_order: 2.0,
        };
    }

    let mut maximum: f64 = 0.0;
    let mut check_node_order1 = |i: usize| {
        if i < node_count {
            let d1 = (step_solution[i] - sol_n[i]) / dt;
            let d2 = (sol_n[i] - sol_n1[i]) / previous_dt;
            let second_derivative = 2.0 * (d1 - d2) / (dt + previous_dt);
            let lte_raw = 0.5 * dt * dt * second_derivative.abs();
            let norm_scale = reltol * step_solution[i].abs() + vntol;
            maximum = maximum.max(lte_raw / norm_scale);
        }
    };

    if let Some(nodes) = dynamic_nodes {
        for &idx in nodes {
            check_node_order1(idx);
        }
    } else {
        for i in 0..node_count {
            check_node_order1(i);
        }
    }

    LteEstimate {
        maximum,
        integrator_order: 1.0,
    }
}

/// Decisión del predictor de orden variable y control de paso temporal.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct VariableOrderDecision {
    pub step_accepted: bool,
    pub next_method: IntegrationMethodType,
    pub next_dt: f64,
    pub lte_max: f64,
    pub ringing_detected: bool,
}

/// Evalúa el LTE y predice el método óptimo (TRAP ↔ BE ↔ GEAR2) y el siguiente paso temporal $dt$.
#[allow(clippy::too_many_arguments)]
pub fn predict_variable_order_step(
    controller: &mut VariableOrderController,
    step_solution: &DVector<f64>,
    sol_n: &DVector<f64>,
    sol_n1: &DVector<f64>,
    sol_n2: &DVector<f64>,
    node_count: usize,
    dt: f64,
    previous_dt: f64,
    is_fixed: bool,
    steps_completed: usize,
    lte_tol: f64,
    dt_min: f64,
    dt_max: f64,
    reltol: f64,
    vntol: f64,
    dynamic_nodes: Option<&std::collections::HashSet<usize>>,
) -> VariableOrderDecision {
    if is_fixed {
        controller.steps_with_current_method += 1;
        return VariableOrderDecision {
            step_accepted: true,
            next_method: controller.active_method,
            next_dt: dt,
            lte_max: 0.0,
            ringing_detected: false,
        };
    }

    // Estimar LTE con el método activo actual
    let lte = estimate_local_truncation_error(
        step_solution,
        sol_n,
        sol_n1,
        sol_n2,
        node_count,
        dt,
        previous_dt,
        false,
        steps_completed,
        controller.active_method.as_str(),
        Some(reltol),
        Some(vntol),
        dynamic_nodes,
    );
    let lte_max = lte.maximum;
    let order = lte.integrator_order;

    // Detectar ringing si estamos en TRAP y llevamos al menos 2 pasos
    let ringing = if steps_completed >= 2 && controller.active_method == IntegrationMethodType::Trap
    {
        detect_trapezoidal_ringing(step_solution, sol_n, sol_n1, node_count, vntol)
    } else {
        false
    };

    if ringing {
        controller.ringing_count += 1;
    } else {
        controller.ringing_count = 0;
    }

    // 1. RECHAZO DE PASO
    if lte_max > lte_tol && dt > dt_min {
        let ratio = lte_tol / lte_max;
        let factor = 0.9 * ratio.powf(1.0 / (order + 1.0));
        let bounded_factor = factor.clamp(0.1, 0.5);
        let reduced_dt = (dt * bounded_factor).max(dt_min);

        // Si se detecta ringing trapezoidal, conmutar a GEAR2. Si el error fue severo sin ringing, reiniciar con Euler.
        let next_method = if controller.is_auto() && ringing {
            IntegrationMethodType::Gear2
        } else if controller.is_auto() && lte_max > 5.0 * lte_tol {
            IntegrationMethodType::Euler
        } else {
            controller.active_method
        };

        return VariableOrderDecision {
            step_accepted: false,
            next_method,
            next_dt: reduced_dt,
            lte_max,
            ringing_detected: ringing,
        };
    }

    // 2. ACEPTACIÓN DE PASO — Predecir siguiente método y timestep
    controller.steps_with_current_method += 1;

    let mut next_method = controller.active_method;

    if controller.is_auto() {
        if ringing && controller.ringing_count >= 1 {
            // Conmutar a GEAR2 para amortiguar el ringing trapezoidal
            next_method = IntegrationMethodType::Gear2;
            controller.steps_with_current_method = 0;
        } else if controller.active_method == IntegrationMethodType::Euler
            && controller.steps_with_current_method >= 2
        {
            // Tras salir de una discontinuidad con Euler, promover a TRAP o GEAR2
            next_method = IntegrationMethodType::Trap;
            controller.steps_with_current_method = 0;
        } else if controller.active_method == IntegrationMethodType::Gear2
            && controller.steps_with_current_method >= 5
            && !ringing
        {
            // Si el sistema se estabilizó en régimen suave, retornar a TRAP para preservar resonancias
            next_method = IntegrationMethodType::Trap;
            controller.steps_with_current_method = 0;
        }
    }

    let next_dt = if steps_completed >= 2 {
        if lte_max > 1e-15 {
            let ratio = lte_tol / lte_max;
            let factor = 0.9 * ratio.powf(1.0 / (order + 1.0));
            let bounded_factor = factor.clamp(0.5, 2.0);
            (dt * bounded_factor).clamp(dt_min, dt_max)
        } else {
            (dt * 2.0).clamp(dt_min, dt_max)
        }
    } else {
        dt
    };

    VariableOrderDecision {
        step_accepted: true,
        next_method,
        next_dt,
        lte_max,
        ringing_detected: ringing,
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
    trap_active_this_step: bool,
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
            let current = if trap_active_this_step {
                let previous_current = *cap_currents.get(&comp.id).unwrap_or(&0.0);
                (2.0 * comp.value / dt) * (voltage - previous_voltage) - previous_current
            } else {
                comp.value * (voltage - previous_voltage) / dt
            };
            cap_currents.insert(comp.id.clone(), current);
        } else if comp.comp_type == "inductor" {
            let node_pos = comp.pins[0].parse::<usize>().unwrap();
            let node_neg = comp.pins[1].parse::<usize>().unwrap();
            let voltage = node_voltage(node_pos) - node_voltage(node_neg);
            let previous_current = *ind_states.get(&comp.id).unwrap();
            let previous_voltage = *ind_voltages.get(&comp.id).unwrap_or(&0.0);
            let l_nominal = comp.value.max(1e-18);
            let ind_val_safe = if let Some(isat) = comp.isat {
                if isat > 0.0 {
                    let ratio = previous_current / isat;
                    l_nominal / (1.0 + ratio * ratio)
                } else {
                    l_nominal
                }
            } else {
                l_nominal
            }
            .max(1e-18);

            let current = if trap_active_this_step {
                previous_current + (dt / (2.0 * ind_val_safe)) * (voltage + previous_voltage)
            } else {
                previous_current + (dt / ind_val_safe) * voltage
            };
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
            &sample, &sample, &sample, &sample, 1, 1e-3, 1e-3, true, 4, "trap", None, None, None,
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
            None,
            None,
            None,
        );
        assert_eq!(estimate.maximum, 0.0);
    }

    #[test]
    fn test_variable_order_ringing_detection() {
        // Simular oscilación de alta frecuencia tipo (-1)^k
        let sol_n = DVector::from_vec(vec![5.0]);
        let sol_n1 = DVector::from_vec(vec![3.0]);
        let sol_n2 = DVector::from_vec(vec![5.0]);

        let ringing = detect_trapezoidal_ringing(&sol_n, &sol_n1, &sol_n2, 1, 1e-6);
        assert!(ringing, "Debe detectar ringing trapezoidal");
    }
}
