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
    /// TR-BDF2 (Trapezoidal + BDF2 compuesto, Orden 2, L-estable, amortigua ringing en electrónica de potencia).
    TrBdf2,
    /// Gear 2nd Order / BDF2 (Orden 2, L-estable, amortiguamiento de ringing numérico).
    Gear2,
    /// Gear 3rd Order / BDF3 (Orden 3, A(alpha)-estable con alpha=86°).
    Gear3,
    /// Gear 4th Order / BDF4 (Orden 4, A(alpha)-estable con alpha=73°).
    Gear4,
    /// Gear 5th Order / BDF5 (Orden 5, A(alpha)-estable con alpha=51°).
    Gear5,
    /// Gear 6th Order / BDF6 (Orden 6, A(alpha)-estable con alpha=18°).
    Gear6,
}

impl IntegrationMethodType {
    pub fn as_str(&self) -> &'static str {
        match self {
            IntegrationMethodType::Euler => "euler",
            IntegrationMethodType::Trap => "trap",
            IntegrationMethodType::TrBdf2 => "trbdf2",
            IntegrationMethodType::Gear2 => "gear2",
            IntegrationMethodType::Gear3 => "gear3",
            IntegrationMethodType::Gear4 => "gear4",
            IntegrationMethodType::Gear5 => "gear5",
            IntegrationMethodType::Gear6 => "gear6",
        }
    }

    pub fn order(&self) -> usize {
        match self {
            IntegrationMethodType::Euler => 1,
            IntegrationMethodType::Trap => 2,
            IntegrationMethodType::TrBdf2 => 2,
            IntegrationMethodType::Gear2 => 2,
            IntegrationMethodType::Gear3 => 3,
            IntegrationMethodType::Gear4 => 4,
            IntegrationMethodType::Gear5 => 5,
            IntegrationMethodType::Gear6 => 6,
        }
    }

    pub fn is_bdf(&self) -> bool {
        !matches!(self, IntegrationMethodType::Trap)
    }
}

/// Calcula los coeficientes de diferenciación hacia atrás (BDF / Gear) de orden $k \in [1, 6]$
/// para una secuencia de pasos de tiempo no uniformes:
/// $\dot{x}(t_n) \approx \alpha_0 x(t_n) + \sum_{j=1}^k \alpha_j x(t_{n-j})$
/// Devuelve un vector $[\alpha_0, \alpha_1, \dots, \alpha_k]$.
pub fn compute_bdf_coefficients(order: usize, dts: &[f64]) -> Vec<f64> {
    let k = order.clamp(1, 6).min(dts.len());
    if k == 0 {
        return vec![1.0];
    }
    let mut t = vec![0.0; k + 1];
    let mut acc_t = 0.0;
    for m in 0..k {
        acc_t += dts[m].max(1e-18);
        t[m + 1] = -acc_t;
    }

    let mut alphas = vec![0.0; k + 1];

    // alpha_0: derivada del polinomio base l_0(t) en t = 0
    let mut sum_inv_t = 0.0;
    for p in 1..=k {
        sum_inv_t += 1.0 / (-t[p]);
    }
    alphas[0] = sum_inv_t;

    // alpha_j (j >= 1): derivada del polinomio base l_j(t) en t = 0
    for j in 1..=k {
        let mut prod = 1.0;
        for m in 1..=k {
            if m != j {
                let denom = t[j] - t[m];
                if denom.abs() > 1e-30 {
                    prod *= (-t[m]) / denom;
                }
            }
        }
        alphas[j] = (1.0 / t[j]) * prod;
    }

    alphas
}

/// Controlador adaptativo de paso y orden variable para el integrador transitorio.
#[derive(Debug, Clone)]
pub struct VariableOrderController {
    /// Modo configurado por el usuario ("auto", "trap", "gear2", "gear3", "gear4", "gear5", "gear6", "euler").
    pub mode: String,
    /// Método activo para el paso actual.
    pub active_method: IntegrationMethodType,
    /// Número consecutivo de pasos con oscilación trapezoidal detectada.
    pub ringing_count: usize,
    /// Pasos completados con el método actual.
    pub steps_with_current_method: usize,
    /// Orden máximo permitido en modo auto (por defecto 6).
    pub max_order: usize,
}

impl VariableOrderController {
    pub fn new(method_str: &str) -> Self {
        let (mode, active_method) = match method_str {
            "euler" | "BE" => ("euler".to_string(), IntegrationMethodType::Euler),
            "gear2" => ("gear2".to_string(), IntegrationMethodType::Gear2),
            "gear3" => ("gear3".to_string(), IntegrationMethodType::Gear3),
            "gear4" => ("gear4".to_string(), IntegrationMethodType::Gear4),
            "gear5" => ("gear5".to_string(), IntegrationMethodType::Gear5),
            "gear6" => ("gear6".to_string(), IntegrationMethodType::Gear6),
            "trbdf2" | "tr-bdf2" => ("trbdf2".to_string(), IntegrationMethodType::TrBdf2),
            "trap" | "trapezoidal" => ("trap".to_string(), IntegrationMethodType::Trap),
            _ => ("auto".to_string(), IntegrationMethodType::Trap),
        };
        Self {
            mode,
            active_method,
            ringing_count: 0,
            steps_with_current_method: 0,
            max_order: 6,
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
    older_dt: f64,
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

    let is_higher_order = steps_completed >= 3
        && (integration_method == "trap"
            || integration_method == "gear2"
            || integration_method == "gear3"
            || integration_method == "gear4"
            || integration_method == "gear5"
            || integration_method == "gear6");

    if is_higher_order {
        let coefficient = match integration_method {
            "trap" => 1.0 / 12.0,
            "gear2" => 2.0 / 9.0,
            "gear3" => 3.0 / 16.0,
            "gear4" => 12.0 / 75.0,
            "gear5" => 60.0 / 441.0,
            "gear6" => 360.0 / 3025.0,
            _ => 2.0 / 9.0,
        };
        let mut maximum: f64 = 0.0;
        let prev_h = previous_dt.max(1e-18);
        let older_h = older_dt.max(1e-18);
        let mut check_node = |i: usize| {
            if i < node_count {
                // Cada diferencia usa el intervalo de sus muestras aceptadas.
                // En una malla adaptativa el intervalo anterior no sustituye al más antiguo.
                let d1 = (step_solution[i] - sol_n[i]) / dt;
                let d2 = (sol_n[i] - sol_n1[i]) / prev_h;
                let d3 = (sol_n1[i] - sol_n2[i]) / older_h;
                let dd1 = 2.0 * (d1 - d2) / (dt + prev_h);
                let dd2 = 2.0 * (d2 - d3) / (prev_h + older_h);
                let third_derivative = 3.0 * (dd1 - dd2) / (dt + prev_h + older_h);
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

        let order_val = match integration_method {
            "gear3" => 3.0,
            "gear4" => 4.0,
            "gear5" => 5.0,
            "gear6" => 6.0,
            _ => 2.0,
        };

        return LteEstimate {
            maximum,
            integrator_order: order_val,
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

/// Evalúa el LTE y predice el método óptimo (TRAP ↔ BE ↔ GEAR2..6) y el siguiente paso temporal $dt$.
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
    older_dt: f64,
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
        older_dt,
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

        // Si se detecta ringing trapezoidal, conmutar a GEAR2. Si el error fue severo sin ringing, reiniciar con Euler/Gear2.
        let next_method = if controller.is_auto() && ringing {
            IntegrationMethodType::Gear2
        } else if controller.is_auto() && lte_max > 5.0 * lte_tol {
            IntegrationMethodType::Euler
        } else if controller.active_method.order() > 2 {
            IntegrationMethodType::Gear2
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
            && controller.steps_with_current_method >= 4
            && !ringing
        {
            // Promoción adaptativa a órdenes superiores en regiones suaves
            if controller.max_order >= 3 {
                next_method = IntegrationMethodType::Gear3;
                controller.steps_with_current_method = 0;
            } else {
                next_method = IntegrationMethodType::Trap;
                controller.steps_with_current_method = 0;
            }
        } else if controller.active_method == IntegrationMethodType::Gear3
            && controller.steps_with_current_method >= 4
            && controller.max_order >= 4
        {
            next_method = IntegrationMethodType::Gear4;
            controller.steps_with_current_method = 0;
        } else if controller.active_method == IntegrationMethodType::Gear4
            && controller.steps_with_current_method >= 4
            && controller.max_order >= 5
        {
            next_method = IntegrationMethodType::Gear5;
            controller.steps_with_current_method = 0;
        } else if controller.active_method == IntegrationMethodType::Gear5
            && controller.steps_with_current_method >= 4
            && controller.max_order >= 6
        {
            next_method = IntegrationMethodType::Gear6;
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
    fn nonuniform_linear_ramp_has_zero_trapezoidal_lte() {
        // V(t)=1000*t V; los intervalos reales son 0.1, 0.2 y 0.1 ms.
        let estimate = estimate_local_truncation_error(
            &DVector::from_vec(vec![0.4]),
            &DVector::from_vec(vec![0.3]),
            &DVector::from_vec(vec![0.1]),
            &DVector::from_vec(vec![0.0]),
            1,
            1e-4,
            2e-4,
            1e-4,
            false,
            3,
            "trap",
            Some(1e-5),
            Some(1e-6),
            None,
        );
        assert!(
            estimate.maximum < 1e-9,
            "Una rampa exacta debe tener LTE nulo: obtenido {}",
            estimate.maximum
        );
    }

    fn polynomial_lte(intervals: [f64; 3], degree: i32) -> (f64, f64) {
        let [dt, previous_dt, older_dt] = intervals;
        let times = [
            dt + previous_dt + older_dt,
            previous_dt + older_dt,
            older_dt,
            0.0,
        ];
        // V(t)=7+5t+2t^p V con t en segundos. V'''=12 V/s³ si p=3, cero si p<3.
        let values = times.map(|t| DVector::from_vec(vec![7.0 + 5.0 * t + 2.0 * t.powi(degree)]));
        let estimate = estimate_local_truncation_error(
            &values[0],
            &values[1],
            &values[2],
            &values[3],
            1,
            dt,
            previous_dt,
            older_dt,
            false,
            3,
            "trap",
            Some(1e-5),
            Some(1e-6),
            None,
        );
        let expected = if degree == 3 {
            // Se conserva el coeficiente trapezoidal existente de 1/12.
            dt.powi(3) / (1e-5 * values[0][0].abs() + 1e-6)
        } else {
            0.0
        };
        (estimate.maximum, expected)
    }

    #[test]
    fn nonuniform_quadratic_has_zero_trapezoidal_lte() {
        for intervals in [[0.1, 0.2, 0.1], [0.1, 0.3, 0.2], [0.25, 0.125, 0.375]] {
            let (actual, expected) = polynomial_lte(intervals, 2);
            assert!(
                (actual - expected).abs() < 1e-9,
                "Intervalos {intervals:?}: una cuadrática exige LTE=0, obtenido {actual}"
            );
        }
    }

    #[test]
    fn nonuniform_cubic_uses_its_exact_third_derivative() {
        for intervals in [[0.1, 0.2, 0.1], [0.1, 0.3, 0.2], [0.25, 0.125, 0.375]] {
            let (actual, expected) = polynomial_lte(intervals, 3);
            assert!(
                (actual - expected).abs() < 1e-9,
                "Intervalos {intervals:?}: esperado {expected}, obtenido {actual}"
            );
        }
    }

    #[test]
    fn uniform_polynomials_preserve_the_trapezoidal_lte_coefficient() {
        for degree in 1..=3 {
            for dt in [0.1, 0.25, 1.0] {
                let (actual, expected) = polynomial_lte([dt; 3], degree);
                assert!(
                    (actual - expected).abs() < 1e-9,
                    "Grado {degree}, dt={dt}: esperado {expected}, obtenido {actual}"
                );
            }
        }
    }

    #[test]
    fn rejected_proposal_does_not_advance_the_accepted_lte_history() {
        let mut controller = VariableOrderController::new("trap");
        controller.steps_with_current_method = 3;
        let accepted = [0.3, 0.1, 0.0].map(|v| DVector::from_vec(vec![v]));
        let rejected = predict_variable_order_step(
            &mut controller,
            &DVector::from_vec(vec![20.0]),
            &accepted[0],
            &accepted[1],
            &accepted[2],
            1,
            1e-4,
            2e-4,
            1e-4,
            false,
            3,
            1.0,
            1e-7,
            2.5e-4,
            1e-5,
            1e-6,
            None,
        );
        assert!(!rejected.step_accepted);
        assert_eq!(controller.steps_with_current_method, 3);

        // El reintento vuelve a usar los mismos tres estados y sus intervalos aceptados.
        let retried = predict_variable_order_step(
            &mut controller,
            &DVector::from_vec(vec![0.35]),
            &accepted[0],
            &accepted[1],
            &accepted[2],
            1,
            0.5e-4,
            2e-4,
            1e-4,
            false,
            3,
            1.0,
            1e-7,
            2.5e-4,
            1e-5,
            1e-6,
            None,
        );
        assert!(retried.step_accepted);
        assert!(retried.lte_max < 1e-9);
        assert_eq!(controller.steps_with_current_method, 4);
    }

    #[test]
    fn fixed_step_has_no_lte_rejection_signal() {
        let sample = DVector::from_vec(vec![1.0]);
        let estimate = estimate_local_truncation_error(
            &sample, &sample, &sample, &sample, 1, 1e-3, 1e-3, 1e-3, true, 4, "trap", None, None,
            None,
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
        let sol_n = DVector::from_vec(vec![5.0]);
        let sol_n1 = DVector::from_vec(vec![3.0]);
        let sol_n2 = DVector::from_vec(vec![5.0]);

        let ringing = detect_trapezoidal_ringing(&sol_n, &sol_n1, &sol_n2, 1, 1e-6);
        assert!(ringing, "Debe detectar ringing trapezoidal");
    }

    #[test]
    fn test_bdf_coefficients_exactness() {
        // BDF1 uniform
        let c1 = compute_bdf_coefficients(1, &[1.0]);
        assert_eq!(c1.len(), 2);
        assert!((c1[0] - 1.0).abs() < 1e-12);
        assert!((c1[1] - (-1.0)).abs() < 1e-12);

        // BDF2 uniform
        let c2 = compute_bdf_coefficients(2, &[1.0, 1.0]);
        assert_eq!(c2.len(), 3);
        assert!((c2[0] - 1.5).abs() < 1e-12);
        assert!((c2[1] - (-2.0)).abs() < 1e-12);
        assert!((c2[2] - 0.5).abs() < 1e-12);

        // BDF3 uniform: 11/6, -3, 3/2, -1/3
        let c3 = compute_bdf_coefficients(3, &[1.0, 1.0, 1.0]);
        assert_eq!(c3.len(), 4);
        assert!((c3[0] - 11.0 / 6.0).abs() < 1e-12);
        assert!((c3[1] - (-3.0)).abs() < 1e-12);
        assert!((c3[2] - 1.5).abs() < 1e-12);
        assert!((c3[3] - (-1.0 / 3.0)).abs() < 1e-12);

        // BDF4 uniform: 25/12, -4, 3, -4/3, 1/4
        let c4 = compute_bdf_coefficients(4, &[1.0, 1.0, 1.0, 1.0]);
        assert_eq!(c4.len(), 5);
        assert!((c4[0] - 25.0 / 12.0).abs() < 1e-12);
        assert!((c4[1] - (-4.0)).abs() < 1e-12);
        assert!((c4[2] - 3.0).abs() < 1e-12);
        assert!((c4[3] - (-4.0 / 3.0)).abs() < 1e-12);
        assert!((c4[4] - 0.25).abs() < 1e-12);
    }
}
