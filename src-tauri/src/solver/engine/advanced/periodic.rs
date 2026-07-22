use crate::solver::matrix::{solve_sparse, SparseMatrix};
use crate::solver::types::CircuitNetlist;
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::super::dc::solve_dc_circuit;
use super::super::devices::{
    evaluate_opto_receiver, solve_diode_junction_voltage, DIODE_IS, DIODE_VT,
};
use super::super::simulation_types::{TimeStepResult, TransientSettings};
use super::super::transient::{solve_transient_circuit_with_initial_states, PssSettings};

pub fn solve_pss(
    netlist: &CircuitNetlist,
    settings: &PssSettings,
) -> Result<Vec<TimeStepResult>, String> {
    let _n = crate::topology::validate_netlist_topology(netlist, false)?;
    let mut state_keys = Vec::new();
    for comp in &netlist.components {
        if comp.comp_type == "capacitor" || comp.comp_type == "inductor" {
            state_keys.push((comp.comp_type.clone(), comp.id.clone()));
        }
    }

    let d = state_keys.len();
    let trans_settings = TransientSettings {
        dt: settings.period / 200.0,
        t_max: settings.period,
        fixed_step: Some(true),
        integration_method: None,
    };

    if d == 0 {
        let (results, _, _) = solve_transient_circuit_with_initial_states(
            netlist,
            &trans_settings,
            HashMap::new(),
            HashMap::new(),
        )?;
        return Ok(results);
    }

    let mut x0 = DVector::<f64>::zeros(d);
    let mut last_results = Vec::new();
    let delta = 1e-5;

    for iter in 0..settings.max_shooting_iters {
        let mut cap_init = HashMap::new();
        let mut ind_init = HashMap::new();
        for (i, (comp_type, id)) in state_keys.iter().enumerate() {
            if comp_type == "capacitor" {
                cap_init.insert(id.clone(), x0[i]);
            } else {
                ind_init.insert(id.clone(), x0[i]);
            }
        }

        let (results, cap_final, ind_final) = solve_transient_circuit_with_initial_states(
            netlist,
            &trans_settings,
            cap_init.clone(),
            ind_init.clone(),
        )?;

        last_results = results;

        let mut x_final = DVector::<f64>::zeros(d);
        for (i, (comp_type, id)) in state_keys.iter().enumerate() {
            if comp_type == "capacitor" {
                x_final[i] = *cap_final.get(id).unwrap_or(&0.0);
            } else {
                x_final[i] = *ind_final.get(id).unwrap_or(&0.0);
            }
        }

        let h = &x_final - &x0;
        let error_norm = h.norm();

        if error_norm < settings.shooting_tolerance {
            return Ok(last_results);
        }

        if iter == settings.max_shooting_iters - 1 {
            return Err(format!(
                "PSS Shooting Method no logró converger en {} iteraciones. Error residual: {:.3e}",
                settings.max_shooting_iters, error_norm
            ));
        }

        let mut m = DMatrix::<f64>::zeros(d, d);

        for j in 0..d {
            let mut x0_pert = x0.clone();
            x0_pert[j] += delta;

            let mut cap_pert = HashMap::new();
            let mut ind_pert = HashMap::new();
            for (idx, (comp_type, id)) in state_keys.iter().enumerate() {
                if comp_type == "capacitor" {
                    cap_pert.insert(id.clone(), x0_pert[idx]);
                } else {
                    ind_pert.insert(id.clone(), x0_pert[idx]);
                }
            }

            let (_, cap_final_pert, ind_final_pert) = solve_transient_circuit_with_initial_states(
                netlist,
                &trans_settings,
                cap_pert,
                ind_pert,
            )?;

            let mut x_final_pert = DVector::<f64>::zeros(d);
            for (idx, (comp_type, id)) in state_keys.iter().enumerate() {
                if comp_type == "capacitor" {
                    x_final_pert[idx] = *cap_final_pert.get(id).unwrap_or(&0.0);
                } else {
                    x_final_pert[idx] = *ind_final_pert.get(id).unwrap_or(&0.0);
                }
            }

            let col = (&x_final_pert - &x_final) / delta;
            for r in 0..d {
                m[(r, j)] = col[r];
            }
        }

        let mut j_mat = m;
        for j in 0..d {
            j_mat[(j, j)] -= 1.0;
        }

        if let Some(delta_x) = solve_sparse(&j_mat, &(-&h)) {
            x0 += delta_x;
        } else {
            return Err(
                "Matriz Jacobiana de Shooting singular. No se puede resolver el paso de Newton."
                    .to_string(),
            );
        }
    }

    Ok(last_results)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[allow(non_snake_case)]
pub struct PoleZeroResult {
    pub poles: Vec<Complex<f64>>,
    pub zeros: Vec<Complex<f64>>,
    pub is_stable: bool,
    pub phaseMargin: f64,
    pub gainMargin: f64,
}

pub fn run_stability_analysis(netlist: &CircuitNetlist) -> Result<PoleZeroResult, String> {
    let _n = crate::topology::validate_netlist_topology(netlist, true)?;
    let op_result = solve_dc_circuit(netlist)?;

    let mut dynamic_nodes = std::collections::HashSet::new();
    for comp in &netlist.components {
        if comp.comp_type == "capacitor" {
            for pin in &comp.pins {
                if let Ok(node_idx) = pin.parse::<usize>() {
                    if node_idx > 0 {
                        dynamic_nodes.insert(node_idx);
                    }
                }
            }
        }
    }

    let mut poles = Vec::new();
    let mut zeros = Vec::new();

    let mut is_stable = true;
    let mut phase_margin = 180.0;
    let mut gain_margin = 40.0;

    if !dynamic_nodes.is_empty() {
        let size = dynamic_nodes.len();
        let mut node_to_idx = HashMap::new();
        for (idx, &node) in dynamic_nodes.iter().enumerate() {
            node_to_idx.insert(node, idx);
        }

        let mut g_mat = DMatrix::<f64>::zeros(size, size);
        let mut c_mat = DMatrix::<f64>::zeros(size, size);

        for comp in &netlist.components {
            if comp.comp_type == "capacitor" {
                let n1 = comp.pins[0].parse::<usize>().unwrap();
                let n2 = comp.pins[1].parse::<usize>().unwrap();
                let c_val = comp.value;

                let idx1 = n1 > 0 && dynamic_nodes.contains(&n1);
                let idx2 = n2 > 0 && dynamic_nodes.contains(&n2);

                if idx1 {
                    let i = *node_to_idx.get(&n1).unwrap();
                    c_mat[(i, i)] += c_val;
                }
                if idx2 {
                    let j = *node_to_idx.get(&n2).unwrap();
                    c_mat[(j, j)] += c_val;
                }
                if idx1 && idx2 {
                    let i = *node_to_idx.get(&n1).unwrap();
                    let j = *node_to_idx.get(&n2).unwrap();
                    c_mat[(i, j)] -= c_val;
                    c_mat[(j, i)] -= c_val;
                }
            }
        }

        for comp in &netlist.components {
            match comp.comp_type.as_str() {
                "resistor" => {
                    let n1 = comp.pins[0].parse::<usize>().unwrap();
                    let n2 = comp.pins[1].parse::<usize>().unwrap();
                    let g_val = 1.0 / comp.value;

                    let idx1 = n1 > 0 && dynamic_nodes.contains(&n1);
                    let idx2 = n2 > 0 && dynamic_nodes.contains(&n2);

                    if idx1 {
                        let i = *node_to_idx.get(&n1).unwrap();
                        g_mat[(i, i)] += g_val;
                    }
                    if idx2 {
                        let j = *node_to_idx.get(&n2).unwrap();
                        g_mat[(j, j)] += g_val;
                    }
                    if idx1 && idx2 {
                        let i = *node_to_idx.get(&n1).unwrap();
                        let j = *node_to_idx.get(&n2).unwrap();
                        g_mat[(i, j)] -= g_val;
                        g_mat[(j, i)] -= g_val;
                    }
                }
                "diode" | "led" => {
                    let n1 = comp.pins[0].parse::<usize>().unwrap();
                    let n2 = comp.pins[1].parse::<usize>().unwrap();

                    let v_anode = if n1 > 0 {
                        *op_result.node_voltages.get(&n1.to_string()).unwrap_or(&0.0)
                    } else {
                        0.0
                    };
                    let v_cathode = if n2 > 0 {
                        *op_result.node_voltages.get(&n2.to_string()).unwrap_or(&0.0)
                    } else {
                        0.0
                    };
                    let mut vd = v_anode - v_cathode;
                    if vd > 0.72 {
                        vd = 0.72;
                    }
                    let gd = (DIODE_IS / DIODE_VT) * (vd / DIODE_VT).exp();

                    let idx1 = n1 > 0 && dynamic_nodes.contains(&n1);
                    let idx2 = n2 > 0 && dynamic_nodes.contains(&n2);

                    if idx1 {
                        let i = *node_to_idx.get(&n1).unwrap();
                        g_mat[(i, i)] += gd;
                    }
                    if idx2 {
                        let j = *node_to_idx.get(&n2).unwrap();
                        g_mat[(j, j)] += gd;
                    }
                    if idx1 && idx2 {
                        let i = *node_to_idx.get(&n1).unwrap();
                        let j = *node_to_idx.get(&n2).unwrap();
                        g_mat[(i, j)] -= gd;
                        g_mat[(j, i)] -= gd;
                    }
                }
                "opto" => {
                    if comp.pins.len() < 4 {
                        continue;
                    }
                    let n_a = comp.pins[0].parse::<usize>().unwrap();
                    let n_k = comp.pins[1].parse::<usize>().unwrap();
                    let n_c = comp.pins[2].parse::<usize>().unwrap();
                    let n_e = comp.pins[3].parse::<usize>().unwrap();

                    // Recuperar punto de operación del opto
                    let v_a = if n_a > 0 {
                        *op_result
                            .node_voltages
                            .get(&n_a.to_string())
                            .unwrap_or(&0.0)
                    } else {
                        0.0
                    };
                    let v_k = if n_k > 0 {
                        *op_result
                            .node_voltages
                            .get(&n_k.to_string())
                            .unwrap_or(&0.0)
                    } else {
                        0.0
                    };
                    let v_c = if n_c > 0 {
                        *op_result
                            .node_voltages
                            .get(&n_c.to_string())
                            .unwrap_or(&0.0)
                    } else {
                        0.0
                    };
                    let v_e = if n_e > 0 {
                        *op_result
                            .node_voltages
                            .get(&n_e.to_string())
                            .unwrap_or(&0.0)
                    } else {
                        0.0
                    };
                    let vd = v_a - v_k;
                    let v_ce = v_c - v_e;
                    let (_, id_led, gd_led) =
                        solve_diode_junction_voltage(vd, netlist.temperature, comp);
                    let (_i_ce, g_md, g_o, _i_ce_eq) =
                        evaluate_opto_receiver(vd, gd_led, id_led, v_ce, comp);

                    // Estampar lado LED (conductancia del diodo)
                    let idx_a = n_a > 0 && dynamic_nodes.contains(&n_a);
                    let idx_k = n_k > 0 && dynamic_nodes.contains(&n_k);
                    if idx_a {
                        let i = *node_to_idx.get(&n_a).unwrap();
                        g_mat[(i, i)] += gd_led;
                    }
                    if idx_k {
                        let j = *node_to_idx.get(&n_k).unwrap();
                        g_mat[(j, j)] += gd_led;
                    }
                    if idx_a && idx_k {
                        let i = *node_to_idx.get(&n_a).unwrap();
                        let j = *node_to_idx.get(&n_k).unwrap();
                        g_mat[(i, j)] -= gd_led;
                        g_mat[(j, i)] -= gd_led;
                    }

                    // Estampar lado receptor (g_md mutua y g_o de salida)
                    let idx_c = n_c > 0 && dynamic_nodes.contains(&n_c);
                    let idx_e = n_e > 0 && dynamic_nodes.contains(&n_e);
                    let stamp_g = |r: usize, c: usize, g: f64, g_mat: &mut DMatrix<f64>| {
                        if r > 0 && c > 0 {
                            let ir = *node_to_idx.get(&r).unwrap();
                            let ic = *node_to_idx.get(&c).unwrap();
                            g_mat[(ir, ic)] += g;
                        }
                    };
                    // g_o entre C y E
                    if idx_c {
                        stamp_g(n_c, n_c, g_o, &mut g_mat);
                    }
                    if idx_e {
                        stamp_g(n_e, n_e, g_o, &mut g_mat);
                    }
                    if idx_c && idx_e {
                        stamp_g(n_c, n_e, -g_o, &mut g_mat);
                        stamp_g(n_e, n_c, -g_o, &mut g_mat);
                    }
                    // g_md entre C y A/K, y entre E y A/K
                    if idx_c {
                        stamp_g(n_c, n_a, g_md, &mut g_mat);
                        stamp_g(n_c, n_k, -g_md, &mut g_mat);
                    }
                    if idx_e {
                        stamp_g(n_e, n_a, -g_md, &mut g_mat);
                        stamp_g(n_e, n_k, g_md, &mut g_mat);
                    }
                }
                "nmos" | "bsim3nmos" => {
                    let nd = comp.pins[1].parse::<usize>().unwrap();
                    let ns = comp.pins[2].parse::<usize>().unwrap();

                    let idx_d = nd > 0 && dynamic_nodes.contains(&nd);
                    let idx_s = ns > 0 && dynamic_nodes.contains(&ns);

                    let gd = 1e-4;
                    if idx_d {
                        let i = *node_to_idx.get(&nd).unwrap();
                        g_mat[(i, i)] += gd;
                    }
                    if idx_s {
                        let j = *node_to_idx.get(&ns).unwrap();
                        g_mat[(j, j)] += gd;
                    }
                    if idx_d && idx_s {
                        let i = *node_to_idx.get(&nd).unwrap();
                        let j = *node_to_idx.get(&ns).unwrap();
                        g_mat[(i, j)] -= gd;
                        g_mat[(j, i)] -= gd;
                    }
                }
                "pmos" | "bsim3pmos" => {
                    let nd = comp.pins[1].parse::<usize>().unwrap();
                    let ns = comp.pins[2].parse::<usize>().unwrap();

                    let idx_d = nd > 0 && dynamic_nodes.contains(&nd);
                    let idx_s = ns > 0 && dynamic_nodes.contains(&ns);

                    let gd = 1e-4;
                    if idx_d {
                        let i = *node_to_idx.get(&nd).unwrap();
                        g_mat[(i, i)] += gd;
                    }
                    if idx_s {
                        let j = *node_to_idx.get(&ns).unwrap();
                        g_mat[(j, j)] += gd;
                    }
                    if idx_d && idx_s {
                        let i = *node_to_idx.get(&nd).unwrap();
                        let j = *node_to_idx.get(&ns).unwrap();
                        g_mat[(i, j)] -= gd;
                        g_mat[(j, i)] -= gd;
                    }
                }
                _ => {}
            }
        }

        for i in 0..size {
            if c_mat[(i, i)] == 0.0 {
                c_mat[(i, i)] = 1e-15;
            }
        }

        // Cálculo de ceros de transmisión via Matriz de Rosenbrock y proyección (Upgrade 2)
        if let Some(g_inv) = g_mat.clone().try_inverse() {
            let in_idx = 0;
            let out_idx = size.saturating_sub(1);
            let denom = g_inv[(out_idx, in_idx)];
            if denom.abs() > 1e-12 {
                let mut p_mat = DMatrix::<f64>::identity(size, size);
                for r in 0..size {
                    let val = g_inv[(r, in_idx)] / denom;
                    if r == out_idx {
                        p_mat[(r, out_idx)] = 0.0;
                    } else {
                        p_mat[(r, out_idx)] = -val;
                    }
                }
                let m_mat = &p_mat * &g_inv * &c_mat;
                if let Some(eigenvalues) = m_mat.eigenvalues() {
                    for val in eigenvalues.iter() {
                        if val.abs() > 1e-12 {
                            let zero_val = -1.0 / *val;
                            zeros.push(Complex::new(zero_val, 0.0));
                        }
                    }
                }
            }
        }

        let g_sparse = SparseMatrix::from_dense(&g_mat);
        let c_sparse = SparseMatrix::from_dense(&c_mat);

        match crate::krylov::arnoldi_poles(&g_sparse, &c_sparse, size) {
            Ok(computed_poles) => {
                for p in computed_poles {
                    poles.push(p);
                    if p.re > 0.0 {
                        is_stable = false;
                    }
                }
            }
            Err(_) => {
                for i in 0..size {
                    let p_val = -g_mat[(i, i)] / c_mat[(i, i)].max(1e-15);
                    poles.push(Complex::new(p_val, 0.0));
                    if p_val > 0.0 {
                        is_stable = false;
                    }
                }
            }
        }
    }

    if !is_stable {
        phase_margin = 0.0;
        gain_margin = 0.0;
    } else if !poles.is_empty() {
        let mut min_dist = f64::INFINITY;
        let mut dom_p = poles[0];
        for &p in &poles {
            if p.re.abs() < min_dist {
                min_dist = p.re.abs();
                dom_p = p;
            }
        }

        if poles.len() > 1 {
            let mut second_dist = f64::INFINITY;
            let mut sec_p = poles[0];
            for &p in &poles {
                if p != dom_p && p.re.abs() < second_dist {
                    second_dist = p.re.abs();
                    sec_p = p;
                }
            }
            let ratio = sec_p.re.abs() / dom_p.re.abs().max(1e-9);
            phase_margin = (90.0_f64 - (1.0_f64 / ratio).atan().to_degrees()).max(10.0_f64);
            gain_margin = (20.0_f64 * ratio.log10()).max(3.0_f64);
        } else {
            phase_margin = 90.0;
            gain_margin = 30.0;
        }
    }

    Ok(PoleZeroResult {
        poles,
        zeros,
        is_stable,
        phaseMargin: phase_margin,
        gainMargin: gain_margin,
    })
}
