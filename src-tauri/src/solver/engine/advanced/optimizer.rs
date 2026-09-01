// ==========================================================================
// ASTRYD SOPHIA — NONLINEAR PARAMETRIC CIRCUIT OPTIMIZER & AUTO-TUNING
// ==========================================================================
// Algoritmo de optimización de parámetros de circuitos analógicos basado en
// Levenberg-Marquardt en espacio logarítmico (Log-Scaled Damped Gauss-Newton)
// con proyección en caja, sensibilidades por diferencias finitas centrales
// y soporte multi-análisis (DC, AC, Transitorio).

use crate::solver::ac::{solve_ac_sweep, AcSweepSettings};
use crate::solver::dc::solve_dc_circuit;
use crate::solver::engine::transient::solve_transient_circuit;
use crate::solver::simulation_types::TransientSettings;
use crate::solver::types::CircuitNetlist;
use nalgebra::{DMatrix, DVector};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizableParam {
    pub component_id: String,
    pub property: String, // "value", "w", "l", "ron", "igbt_kp", "rth"
    pub min_val: f64,
    pub max_val: f64,
    pub initial_val: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum OptimizationTarget {
    DcNodeVoltage {
        node: String,
        target_voltage: f64,
        weight: f64,
    },
    DcBranchCurrent {
        vsource_id: String,
        target_current: f64,
        weight: f64,
    },
    AcGainAtFreq {
        node: String,
        freq: f64,
        target_gain_db: f64,
        weight: f64,
    },
    AcCutoffFreq {
        node: String,
        ref_freq: f64,
        target_cutoff_freq: f64,
        weight: f64,
    },
    TransientRiseTime {
        node: String,
        target_rise_time: f64,
        t_max: f64,
        weight: f64,
    },
    TransientSettleVoltage {
        node: String,
        target_voltage: f64,
        t_max: f64,
        weight: f64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizationSettings {
    pub max_iterations: usize,
    pub tolerance: f64,
    pub initial_mu: f64,
}

impl Default for OptimizationSettings {
    fn default() -> Self {
        Self {
            max_iterations: 50,
            tolerance: 1e-4,
            initial_mu: 1e-3,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizationIteration {
    pub iteration: usize,
    pub cost: f64,
    pub parameters: HashMap<String, f64>,
    pub achieved_values: HashMap<String, f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizationResult {
    pub converged: bool,
    pub iterations: usize,
    pub initial_cost: f64,
    pub final_cost: f64,
    pub optimal_parameters: HashMap<String, f64>,
    pub history: Vec<OptimizationIteration>,
    pub achieved_targets: HashMap<String, f64>,
}

fn apply_parameters_to_netlist(
    netlist: &mut CircuitNetlist,
    params: &[OptimizableParam],
    values: &[f64],
) {
    for (i, p) in params.iter().enumerate() {
        let val = values[i];
        for comp in &mut netlist.components {
            if comp.id == p.component_id {
                match p.property.as_str() {
                    "value" => comp.value = val,
                    "w" => comp.w = Some(val),
                    "l" => comp.l = Some(val),
                    "ron" => comp.ron = Some(val),
                    "igbt_kp" => comp.igbt_kp = Some(val),
                    "rth" => comp.rth = Some(val),
                    _ => comp.value = val,
                }
            }
        }
    }
}

fn evaluate_targets(
    netlist: &CircuitNetlist,
    targets: &[OptimizationTarget],
) -> Result<(Vec<f64>, HashMap<String, f64>), String> {
    let mut residuals = Vec::with_capacity(targets.len());
    let mut achieved = HashMap::new();

    let needs_dc = targets.iter().any(|t| {
        matches!(
            t,
            OptimizationTarget::DcNodeVoltage { .. } | OptimizationTarget::DcBranchCurrent { .. }
        )
    });

    let dc_result = if needs_dc {
        Some(solve_dc_circuit(netlist)?)
    } else {
        None
    };

    for (idx, target) in targets.iter().enumerate() {
        match target {
            OptimizationTarget::DcNodeVoltage {
                node,
                target_voltage,
                weight,
            } => {
                let res = dc_result
                    .as_ref()
                    .ok_or_else(|| "Resultado DC no disponible".to_string())?;
                let v_node = res.node_voltages.get(node).copied().unwrap_or(0.0);
                let diff = v_node - target_voltage;
                residuals.push(weight * diff);
                achieved.insert(format!("target_{}_DcNodeVoltage_{}", idx, node), v_node);
            }
            OptimizationTarget::DcBranchCurrent {
                vsource_id,
                target_current,
                weight,
            } => {
                let res = dc_result
                    .as_ref()
                    .ok_or_else(|| "Resultado DC no disponible".to_string())?;
                let i_branch = res.branch_currents.get(vsource_id).copied().unwrap_or(0.0);
                let diff = i_branch - target_current;
                residuals.push(weight * diff);
                achieved.insert(
                    format!("target_{}_DcBranchCurrent_{}", idx, vsource_id),
                    i_branch,
                );
            }
            OptimizationTarget::AcGainAtFreq {
                node,
                freq,
                target_gain_db,
                weight,
            } => {
                let ac_settings = AcSweepSettings {
                    f_start: *freq,
                    f_end: *freq,
                    points_per_decade: 1,
                    op_guess: None,
                };
                let ac_res = solve_ac_sweep(netlist, &ac_settings)?;
                let gain_db = ac_res
                    .node_amplitudes
                    .get(node)
                    .and_then(|v| v.first())
                    .copied()
                    .unwrap_or(-240.0);
                let diff = (gain_db - target_gain_db) / target_gain_db.abs().max(1.0);
                residuals.push(weight * diff);
                achieved.insert(format!("target_{}_AcGainAtFreq_{}", idx, node), gain_db);
            }
            OptimizationTarget::AcCutoffFreq {
                node,
                ref_freq,
                target_cutoff_freq,
                weight,
            } => {
                let ac_settings_ref = AcSweepSettings {
                    f_start: *ref_freq,
                    f_end: *ref_freq,
                    points_per_decade: 1,
                    op_guess: None,
                };
                let ac_res_ref = solve_ac_sweep(netlist, &ac_settings_ref)?;
                let gain_db_ref = ac_res_ref
                    .node_amplitudes
                    .get(node)
                    .and_then(|v| v.first())
                    .copied()
                    .unwrap_or(0.0);

                let ac_settings_cut = AcSweepSettings {
                    f_start: *target_cutoff_freq,
                    f_end: *target_cutoff_freq,
                    points_per_decade: 1,
                    op_guess: None,
                };
                let ac_res_cut = solve_ac_sweep(netlist, &ac_settings_cut)?;
                let gain_db_cut = ac_res_cut
                    .node_amplitudes
                    .get(node)
                    .and_then(|v| v.first())
                    .copied()
                    .unwrap_or(-240.0);

                // Convertir dB a magnitudes lineales para la razón de corte (-3.0103 dB -> ratio 1/sqrt(2))
                let mag_ref = 10.0f64.powf(gain_db_ref / 20.0);
                let mag_cut = 10.0f64.powf(gain_db_cut / 20.0);
                let ratio = mag_cut / mag_ref.max(1e-12);
                let target_ratio = 1.0 / std::f64::consts::SQRT_2;
                let diff = (ratio - target_ratio) / target_ratio;
                residuals.push(weight * diff);
                achieved.insert(format!("target_{}_AcCutoffFreq_{}", idx, node), gain_db_cut);
            }
            OptimizationTarget::TransientRiseTime {
                node,
                target_rise_time,
                t_max,
                weight,
            } => {
                let tr_settings = TransientSettings {
                    t_max: *t_max,
                    dt: *t_max / 50.0,
                    fixed_step: None,
                    integration_method: Some("trapezoidal".to_string()),
                };
                let tr_res = solve_transient_circuit(netlist, &tr_settings)?;
                let mut v_min = f64::MAX;
                let mut v_max = f64::MIN;
                for step in &tr_res {
                    if let Some(&v) = step.node_voltages.get(node) {
                        if v < v_min {
                            v_min = v;
                        }
                        if v > v_max {
                            v_max = v;
                        }
                    }
                }
                let v_10 = v_min + 0.1 * (v_max - v_min);
                let v_90 = v_min + 0.9 * (v_max - v_min);
                let mut t_10 = 0.0;
                let mut t_90 = *t_max;
                let mut found_10 = false;

                for step in &tr_res {
                    if let Some(&v) = step.node_voltages.get(node) {
                        if !found_10 && v >= v_10 {
                            t_10 = step.time;
                            found_10 = true;
                        }
                        if found_10 && v >= v_90 {
                            t_90 = step.time;
                            break;
                        }
                    }
                }
                let measured_rise_time = (t_90 - t_10).max(1e-12);
                let diff = (measured_rise_time - target_rise_time) / target_rise_time.max(1e-12);
                residuals.push(weight * diff);
                achieved.insert(
                    format!("target_{}_TransientRiseTime_{}", idx, node),
                    measured_rise_time,
                );
            }
            OptimizationTarget::TransientSettleVoltage {
                node,
                target_voltage,
                t_max,
                weight,
            } => {
                let tr_settings = TransientSettings {
                    t_max: *t_max,
                    dt: *t_max / 25.0,
                    fixed_step: None,
                    integration_method: Some("trapezoidal".to_string()),
                };
                let tr_res = solve_transient_circuit(netlist, &tr_settings)?;
                let last_v = tr_res
                    .last()
                    .and_then(|s| s.node_voltages.get(node))
                    .copied()
                    .unwrap_or(0.0);
                let diff = last_v - target_voltage;
                residuals.push(weight * diff);
                achieved.insert(
                    format!("target_{}_TransientSettleVoltage_{}", idx, node),
                    last_v,
                );
            }
        }
    }

    Ok((residuals, achieved))
}

/// Ejecuta la optimización paramétrica multivariable de un circuito con Levenberg-Marquardt en escala logarítmica.
pub fn solve_circuit_optimization(
    netlist: &CircuitNetlist,
    params: &[OptimizableParam],
    targets: &[OptimizationTarget],
    settings: &OptimizationSettings,
) -> Result<OptimizationResult, String> {
    if params.is_empty() {
        return Err("Debe especificarse al menos un parámetro optimizable.".to_string());
    }
    if targets.is_empty() {
        return Err("Debe especificarse al menos un objetivo de optimización.".to_string());
    }

    let m = params.len();
    let k = targets.len();

    // Mapeo a espacio logarítmico para parámetros positivos o lineal si admiten no positivos
    let use_log: Vec<bool> = params
        .iter()
        .map(|p| p.min_val > 0.0 && p.initial_val > 0.0)
        .collect();

    let mut current_theta: Vec<f64> = params
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let clamped = p.initial_val.clamp(p.min_val, p.max_val);
            if use_log[i] {
                clamped.ln()
            } else {
                clamped
            }
        })
        .collect();

    let theta_min: Vec<f64> = params
        .iter()
        .enumerate()
        .map(|(i, p)| {
            if use_log[i] {
                p.min_val.ln()
            } else {
                p.min_val
            }
        })
        .collect();

    let theta_max: Vec<f64> = params
        .iter()
        .enumerate()
        .map(|(i, p)| {
            if use_log[i] {
                p.max_val.ln()
            } else {
                p.max_val
            }
        })
        .collect();

    let theta_to_p = |th: &[f64]| -> Vec<f64> {
        th.iter()
            .enumerate()
            .map(|(i, &v)| if use_log[i] { v.exp() } else { v })
            .collect()
    };

    let mut current_p = theta_to_p(&current_theta);
    let mut working_netlist = netlist.clone();
    apply_parameters_to_netlist(&mut working_netlist, params, &current_p);

    let (mut current_res, mut current_achieved) = evaluate_targets(&working_netlist, targets)?;
    let mut current_cost = 0.5 * current_res.iter().map(|r| r * r).sum::<f64>();
    let initial_cost = current_cost;

    let mut history = Vec::new();
    let mut param_map = HashMap::new();
    for (i, p) in params.iter().enumerate() {
        param_map.insert(format!("{}.{}", p.component_id, p.property), current_p[i]);
    }
    history.push(OptimizationIteration {
        iteration: 0,
        cost: current_cost,
        parameters: param_map.clone(),
        achieved_values: current_achieved.clone(),
    });

    let mut mu = settings.initial_mu;
    let mut converged = false;
    let mut iter = 0;

    while iter < settings.max_iterations {
        iter += 1;

        if current_cost < settings.tolerance {
            converged = true;
            break;
        }

        // 1. Calcular Jacobiano J en R^(K x M) en el espacio theta por diferencias finitas centrales
        let mut jac = DMatrix::<f64>::zeros(k, m);
        for j in 0..m {
            let th_j = current_theta[j];
            let delta = if use_log[j] {
                1e-3
            } else {
                (1e-4 * th_j.abs()).max(1e-8)
            };

            let th_plus = (th_j + delta).clamp(theta_min[j], theta_max[j]);
            let th_minus = (th_j - delta).clamp(theta_min[j], theta_max[j]);
            let actual_delta = th_plus - th_minus;

            if actual_delta.abs() > 1e-15 {
                let mut p_plus = current_theta.clone();
                p_plus[j] = th_plus;
                let mut netlist_plus = netlist.clone();
                apply_parameters_to_netlist(&mut netlist_plus, params, &theta_to_p(&p_plus));

                let mut p_minus = current_theta.clone();
                p_minus[j] = th_minus;
                let mut netlist_minus = netlist.clone();
                apply_parameters_to_netlist(&mut netlist_minus, params, &theta_to_p(&p_minus));

                if let (Ok((res_plus, _)), Ok((res_minus, _))) = (
                    evaluate_targets(&netlist_plus, targets),
                    evaluate_targets(&netlist_minus, targets),
                ) {
                    for i_target in 0..k {
                        jac[(i_target, j)] =
                            (res_plus[i_target] - res_minus[i_target]) / actual_delta;
                    }
                }
            }
        }

        // 2. Formar sistema normal de Levenberg-Marquardt:
        // (J^T * J + mu * diag(J^T * J + I)) * d_theta = -J^T * r
        let j_mat = &jac;
        let r_vec = DVector::from_vec(current_res.clone());
        let jt_j = j_mat.transpose() * j_mat;
        let jt_r = j_mat.transpose() * &r_vec;

        let mut h_damped = jt_j.clone();
        for j in 0..m {
            let diag_elem = jt_j[(j, j)].max(1e-6);
            h_damped[(j, j)] += mu * diag_elem;
        }

        let d_th = match h_damped.lu().solve(&(-&jt_r)) {
            Some(sol) => sol,
            None => {
                mu *= 10.0;
                continue;
            }
        };

        // 3. Proyectar candidato en cotas de caja en theta con radio de confianza (Trust-Region step clamping)
        let mut max_ratio = 1.0f64;
        for j in 0..m {
            let max_allowed = if use_log[j] {
                1.5 // Factor máx e^1.5 ≈ 4.48x por iteración en espacio logarítmico
            } else {
                ((theta_max[j] - theta_min[j]) * 0.5).max(1.0)
            };
            let step_mag = d_th[j].abs();
            if step_mag > max_allowed {
                let ratio = max_allowed / step_mag;
                if ratio < max_ratio {
                    max_ratio = ratio;
                }
            }
        }

        let mut cand_theta = current_theta.clone();
        for j in 0..m {
            let step = d_th[j] * max_ratio;
            cand_theta[j] = (current_theta[j] + step).clamp(theta_min[j], theta_max[j]);
        }

        // 4. Evaluar costo candidato
        let cand_p = theta_to_p(&cand_theta);
        let mut cand_netlist = netlist.clone();
        apply_parameters_to_netlist(&mut cand_netlist, params, &cand_p);

        match evaluate_targets(&cand_netlist, targets) {
            Ok((cand_res, cand_achieved)) => {
                let cand_cost = 0.5 * cand_res.iter().map(|r| r * r).sum::<f64>();
                if cand_cost < current_cost {
                    let prev_cost = current_cost;
                    current_theta = cand_theta;
                    current_p = cand_p;
                    current_res = cand_res;
                    current_achieved = cand_achieved;
                    current_cost = cand_cost;
                    mu = (mu / 3.0).max(1e-8);

                    let mut iter_param_map = HashMap::new();
                    for (i, p) in params.iter().enumerate() {
                        iter_param_map
                            .insert(format!("{}.{}", p.component_id, p.property), current_p[i]);
                    }
                    history.push(OptimizationIteration {
                        iteration: iter,
                        cost: current_cost,
                        parameters: iter_param_map,
                        achieved_values: current_achieved.clone(),
                    });

                    let cost_drop = (prev_cost - current_cost).abs();
                    if current_cost < settings.tolerance
                        || (iter > 2 && cost_drop < 1e-7 * current_cost && current_cost < 1e-2)
                    {
                        converged = true;
                        break;
                    }
                } else {
                    // Paso rechazado: aumentar amortiguamiento
                    mu = (mu * 8.0).min(1e9);
                }
            }
            Err(_) => {
                mu = (mu * 10.0).min(1e9);
            }
        }
    }

    let mut final_param_map = HashMap::new();
    for (i, p) in params.iter().enumerate() {
        final_param_map.insert(format!("{}.{}", p.component_id, p.property), current_p[i]);
    }

    Ok(OptimizationResult {
        converged,
        iterations: iter,
        initial_cost,
        final_cost: current_cost,
        optimal_parameters: final_param_map,
        history,
        achieved_targets: current_achieved,
    })
}
