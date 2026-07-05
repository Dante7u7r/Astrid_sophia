use crate::solver::matrix::*;
use crate::solver::types::*;
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;
use rayon::iter::{IntoParallelIterator, ParallelIterator};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[allow(unused_imports)]
use super::ac::*;
#[allow(unused_imports)]
use super::dc::*;
#[allow(unused_imports)]
use super::devices::*;
#[allow(unused_imports)]
use super::transient::*;

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

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MonteCarloSettings {
    pub runs: usize,
    pub seed: Option<u64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct MonteCarloResult {
    pub run_results: Vec<Vec<TimeStepResult>>,
}

// Generador pseudoaleatorio LCG simple determinista
fn lcg_next(seed: &mut u64) -> f64 {
    *seed = seed
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    ((*seed >> 32) as f64) / 4294967295.0
}

// Transformación de Box-Muller para distribución normal estándar N(0, 1)
fn box_muller_standard(seed: &mut u64) -> f64 {
    let mut u1 = lcg_next(seed);
    while u1 < 1e-15 {
        u1 = lcg_next(seed);
    }
    let u2 = lcg_next(seed);
    let r = (-2.0 * u1.ln()).sqrt();
    let theta = 2.0 * std::f64::consts::PI * u2;
    r * theta.cos()
}

pub fn solve_monte_carlo_transient(
    netlist: &CircuitNetlist,
    transient_settings: &TransientSettings,
    mc_settings: &MonteCarloSettings,
) -> Result<Vec<Vec<TimeStepResult>>, String> {
    let rng_seed_base = mc_settings.seed.unwrap_or(123456789);

    (0..mc_settings.runs)
        .into_par_iter()
        .map(|run_idx| {
            // Cada hilo tiene su propia semilla única derivada de la semilla base de forma determinista
            let mut run_seed = rng_seed_base.wrapping_add(run_idx as u64 * 72057594037927931);
            if run_seed == 0 {
                run_seed = 123456789;
            }

            // Clonar netlist original para variarlo
            let mut varied_netlist = netlist.clone();
            for comp in &mut varied_netlist.components {
                if let Some(tol) = comp.tolerance {
                    if tol > 0.0 {
                        // Variación gaussiana usando la regla de 3-sigma (la tolerancia es el límite del 99.7%)
                        let std_dev = (comp.value * tol) / 3.0;
                        let noise = box_muller_standard(&mut run_seed) * std_dev;
                        comp.value = (comp.value + noise).max(1e-15); // evitar valores no físicos negativos o cero
                    }
                }
            }

            // Resolver simulación transitoria para esta muestra
            solve_transient_circuit(&varied_netlist, transient_settings)
        })
        .collect()
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DcSweepSettings {
    pub source_id: String,
    pub v_start: f64,
    pub v_end: f64,
    pub v_step: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DcSweepResult {
    pub sweep_voltages: Vec<f64>,
    pub node_voltages: HashMap<String, Vec<f64>>,
    pub branch_currents: HashMap<String, Vec<f64>>,
}

pub fn calculate_imd_analysis(
    time_steps: &[TimeStepResult],
    node_name: &str,
    f1: f64,
    f2: f64,
) -> Result<ImdResult, String> {
    if time_steps.len() < 2 {
        return Err(
            "No hay suficientes pasos de tiempo para análisis de intermodulación.".to_string(),
        );
    }

    let t_max = time_steps.last().unwrap().time;
    let n_points = 2048; // Potencia de 2
    let dt_uniform = t_max / (n_points - 1) as f64;

    // 1. Remuestrear la señal de forma uniforme con Ventana de Hann para reducir la fuga espectral
    let mut v_samples = vec![Complex::new(0.0, 0.0); n_points];
    for i in 0..n_points {
        let t_target = i as f64 * dt_uniform;
        let v_val = interpolate_node_voltage(time_steps, node_name, t_target);

        // Ventana de Hann: 0.5 * (1.0 - cos(2 * PI * i / (N - 1)))
        let hann =
            0.5 * (1.0 - (2.0 * std::f64::consts::PI * i as f64 / (n_points - 1) as f64).cos());
        v_samples[i] = Complex::new(v_val * hann, 0.0);
    }

    // 2. Correr FFT
    fft_radix2(&mut v_samples);

    // 3. Extraer densidades espectrales del espectro unilateral
    let fs = 1.0 / dt_uniform;
    let half_n = n_points / 2;
    let mut frequencies = Vec::with_capacity(half_n);
    let mut magnitudes = Vec::with_capacity(half_n);
    let mut magnitudes_db = Vec::with_capacity(half_n);

    // Con ventana de Hann, multiplicamos por 2 para restaurar la amplitud del pico senoidal
    for k in 0..half_n {
        let freq = k as f64 * fs / n_points as f64;
        frequencies.push(freq);

        let raw_mag = v_samples[k].norm();
        let mag = if k == 0 {
            2.0 * raw_mag / n_points as f64
        } else {
            4.0 * raw_mag / n_points as f64
        };
        magnitudes.push(mag);

        let db = 20.0 * mag.max(1e-9).log10();
        magnitudes_db.push(db);
    }

    // 4. Medir componentes fundamentales
    let mag_f1 = find_peak_magnitude(&frequencies, &magnitudes, f1);
    let mag_f2 = find_peak_magnitude(&frequencies, &magnitudes, f2);

    let a_fund: f64 = 0.5 * (mag_f1 + mag_f2);
    let fund_power_dbv = 20.0 * a_fund.max(1e-9).log10();

    // 5. Medir productos IM2
    let mag_im2_diff = find_peak_magnitude(&frequencies, &magnitudes, (f1 - f2).abs());
    let mag_im2_sum = find_peak_magnitude(&frequencies, &magnitudes, f1 + f2);
    let a_im2: f64 = 0.5 * (mag_im2_diff + mag_im2_sum);
    let im2_power_dbv = 20.0 * a_im2.max(1e-9).log10();

    // 6. Medir productos IM3
    let mag_im3_lower = find_peak_magnitude(&frequencies, &magnitudes, (2.0 * f1 - f2).abs());
    let mag_im3_upper = find_peak_magnitude(&frequencies, &magnitudes, (2.0 * f2 - f1).abs());
    let a_im3: f64 = 0.5 * (mag_im3_lower + mag_im3_upper);
    let im3_power_dbv = 20.0 * a_im3.max(1e-9).log10();

    // 7. Calcular tasa de IMD en porcentaje
    let total_im_sq = (mag_im2_diff * mag_im2_diff)
        + (mag_im2_sum * mag_im2_sum)
        + (mag_im3_lower * mag_im3_lower)
        + (mag_im3_upper * mag_im3_upper);
    let imd_ratio_percent = if a_fund > 1e-6 {
        (total_im_sq.sqrt() / a_fund) * 100.0
    } else {
        0.0
    };

    // 8. Extrapolar IP3 de salida
    let ip3_out_dbv = fund_power_dbv + (fund_power_dbv - im3_power_dbv) / 2.0;

    Ok(ImdResult {
        fundamental_power_dbv: fund_power_dbv,
        im2_power_dbv,
        im3_power_dbv,
        imd_ratio_percent,
        ip3_out_dbv,
        frequencies,
        magnitudes_db,
    })
}

// Remuestreo por interpolación lineal para redes temporales no uniformes del paso adaptativo
fn interpolate_node_voltage(results: &[TimeStepResult], node_name: &str, t_target: f64) -> f64 {
    if results.is_empty() {
        return 0.0;
    }
    if t_target <= results[0].time {
        return *results[0].node_voltages.get(node_name).unwrap_or(&0.0);
    }
    if t_target >= results.last().unwrap().time {
        return *results
            .last()
            .unwrap()
            .node_voltages
            .get(node_name)
            .unwrap_or(&0.0);
    }

    // Búsqueda binaria para encontrar el intervalo [low, high]
    let mut low = 0;
    let mut high = results.len() - 1;
    while low + 1 < high {
        let mid = (low + high) / 2;
        if results[mid].time <= t_target {
            low = mid;
        } else {
            high = mid;
        }
    }

    let t0 = results[low].time;
    let t1 = results[high].time;
    let v0 = *results[low].node_voltages.get(node_name).unwrap_or(&0.0);
    let v1 = *results[high].node_voltages.get(node_name).unwrap_or(&0.0);

    if (t1 - t0).abs() < 1e-15 {
        v0
    } else {
        let fraction = (t_target - t0) / (t1 - t0);
        v0 + fraction * (v1 - v0)
    }
}

// Transformada Rápida de Fourier Cooley-Tukey Radix-2 en Rust puro
fn fft_radix2(a: &mut [Complex<f64>]) {
    let n = a.len();
    if n <= 1 {
        return;
    }

    let mut even = vec![Complex::new(0.0, 0.0); n / 2];
    let mut odd = vec![Complex::new(0.0, 0.0); n / 2];
    for i in 0..n / 2 {
        even[i] = a[2 * i];
        odd[i] = a[2 * i + 1];
    }

    fft_radix2(&mut even);
    fft_radix2(&mut odd);

    for k in 0..n / 2 {
        let angle = -2.0 * std::f64::consts::PI * (k as f64) / (n as f64);
        let t = Complex::from_polar(1.0, angle) * odd[k];
        a[k] = even[k] + t;
        a[k + n / 2] = even[k] - t;
    }
}

// Core analítico de cálculo FFT y THD
pub fn calculate_fft_and_thd(
    time_steps: &[TimeStepResult],
    node_name: &str,
    fundamental_freq: f64,
) -> Result<FftResult, String> {
    if time_steps.len() < 2 {
        return Err("No hay suficientes pasos de tiempo para análisis FFT.".to_string());
    }

    let t_max = time_steps.last().unwrap().time;
    let n_points = 2048; // Potencia de 2
    let dt_uniform = t_max / (n_points - 1) as f64;

    // 1. Remuestrear la señal de forma uniforme
    let mut v_samples = vec![Complex::new(0.0, 0.0); n_points];
    for i in 0..n_points {
        let t_target = i as f64 * dt_uniform;
        let v_val = interpolate_node_voltage(time_steps, node_name, t_target);
        v_samples[i] = Complex::new(v_val, 0.0);
    }

    // 2. Correr FFT
    fft_radix2(&mut v_samples);

    // 3. Extraer densidades espectrales del espectro unilateral (hasta Nyquist)
    let fs = 1.0 / dt_uniform;
    let half_n = n_points / 2;
    let mut frequencies = Vec::with_capacity(half_n);
    let mut magnitudes = Vec::with_capacity(half_n);
    let mut magnitudes_db = Vec::with_capacity(half_n);

    for k in 0..half_n {
        let freq = k as f64 * fs / n_points as f64;
        frequencies.push(freq);

        let raw_mag = v_samples[k].norm();
        let mag = if k == 0 {
            raw_mag / n_points as f64
        } else {
            2.0 * raw_mag / n_points as f64
        };
        magnitudes.push(mag);

        let db = 20.0 * mag.max(1e-9).log10();
        magnitudes_db.push(db);
    }

    // 4. Calcular THD espectral de precisión
    let mut fund_bin = 0;
    let mut min_diff = f64::MAX;
    for (i, &f) in frequencies.iter().enumerate() {
        let diff = (f - fundamental_freq).abs();
        if diff < min_diff {
            min_diff = diff;
            fund_bin = i;
        }
    }

    let mut max_fund_mag = magnitudes[fund_bin];
    let start_fund = fund_bin.saturating_sub(3);
    let end_fund = (fund_bin + 3).min(half_n - 1);
    for i in start_fund..=end_fund {
        if magnitudes[i] > max_fund_mag {
            max_fund_mag = magnitudes[i];
        }
    }

    let a1 = max_fund_mag;
    let mut sum_harmonics_sq = 0.0;

    if a1 > 1e-6 {
        for h in 2..=8 {
            let target_harmonic_freq = h as f64 * fundamental_freq;
            if target_harmonic_freq > fs / 2.0 {
                break;
            }

            let mut harm_bin = 0;
            let mut min_harm_diff = f64::MAX;
            for (i, &f) in frequencies.iter().enumerate() {
                let diff = (f - target_harmonic_freq).abs();
                if diff < min_harm_diff {
                    min_harm_diff = diff;
                    harm_bin = i;
                }
            }

            let mut peak_harm_mag = magnitudes[harm_bin];
            let start_harm = harm_bin.saturating_sub(3);
            let end_harm = (harm_bin + 3).min(half_n - 1);
            for i in start_harm..=end_harm {
                if magnitudes[i] > peak_harm_mag {
                    peak_harm_mag = magnitudes[i];
                }
            }

            sum_harmonics_sq += peak_harm_mag * peak_harm_mag;
        }
    }

    let thd = if a1 > 1e-6 {
        (sum_harmonics_sq.sqrt() / a1) * 100.0
    } else {
        0.0
    };

    Ok(FftResult {
        frequencies,
        magnitudes_db,
        thd,
    })
}

// ==================================================================================
// FASE 23: Evaluador de Mediciones Transitorias (.measure)
// ==================================================================================
// Módulo analítico que escanea el histórico de simulación transitoria para medir
// de forma automatizada retardos de propagación, tiempos de subida/bajada,
// picos e integrales promedio con interpolación lineal de alta precisión.

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MeasureDirective {
    pub name: String,
    pub measure_type: String, // "delay", "risetime", "falltime", "peak", "avg", "rms", "min", "max", "pp"
    pub node: String,
    /// Nodo de referencia para medición de retardo (trig)
    pub trig_node: Option<String>,
    /// Valor de umbral (fracción 0..1) para cruces, por defecto 0.5 (50%)
    pub threshold: Option<f64>,
    /// Rango de tiempo [t_start, t_end] para restringir la búsqueda
    pub t_start: Option<f64>,
    pub t_end: Option<f64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MeasureResult {
    pub measurements: HashMap<String, f64>,
    pub error_log: Option<String>,
}

/// Encuentra el tiempo exacto (interpolado linealmente) en que la señal cruza
/// un nivel `level` en la dirección `rising` (true = flanco de subida, false = bajada).
/// `occurrence` = 1 para el primer cruce, 2 para el segundo, etc.
fn find_threshold_crossing(
    results: &[TimeStepResult],
    node: &str,
    level: f64,
    rising: bool,
    occurrence: usize,
    t_start: f64,
    t_end: f64,
) -> Option<f64> {
    let mut count = 0;
    for i in 1..results.len() {
        let t0 = results[i - 1].time;
        let t1 = results[i].time;
        if t1 < t_start || t0 > t_end {
            continue;
        }

        let v0 = *results[i - 1].node_voltages.get(node).unwrap_or(&0.0);
        let v1 = *results[i].node_voltages.get(node).unwrap_or(&0.0);

        let crosses = if rising {
            v0 < level && v1 >= level
        } else {
            v0 > level && v1 <= level
        };

        if crosses {
            count += 1;
            if count == occurrence {
                // Interpolación lineal del instante exacto de cruce
                if (v1 - v0).abs() < 1e-18 {
                    return Some(t0);
                }
                let fraction = (level - v0) / (v1 - v0);
                return Some(t0 + fraction * (t1 - t0));
            }
        }
    }
    None
}

/// Obtener el rango dinámico de una señal en el nodo dado dentro del intervalo [t_start, t_end]
fn get_signal_range(
    results: &[TimeStepResult],
    node: &str,
    t_start: f64,
    t_end: f64,
) -> (f64, f64) {
    let mut v_min = f64::MAX;
    let mut v_max = f64::MIN;
    for step in results {
        if step.time < t_start || step.time > t_end {
            continue;
        }
        let v = *step.node_voltages.get(node).unwrap_or(&0.0);
        if v < v_min {
            v_min = v;
        }
        if v > v_max {
            v_max = v;
        }
    }
    if v_min == f64::MAX {
        v_min = 0.0;
    }
    if v_max == f64::MIN {
        v_max = 0.0;
    }
    (v_min, v_max)
}

/// Motor de evaluación de directivas `.measure` sobre resultados de simulación transitoria.
pub fn evaluate_measures(
    results: &[TimeStepResult],
    directives: &[MeasureDirective],
) -> MeasureResult {
    let mut measurements = HashMap::new();
    let mut errors = Vec::new();

    if results.is_empty() {
        return MeasureResult {
            measurements,
            error_log: Some(
                "No hay resultados de simulación transitoria para evaluar.".to_string(),
            ),
        };
    }

    let t_global_start = results[0].time;
    let t_global_end = results.last().unwrap().time;

    for dir in directives {
        let t_start = dir.t_start.unwrap_or(t_global_start);
        let t_end = dir.t_end.unwrap_or(t_global_end);
        let threshold_frac = dir.threshold.unwrap_or(0.5);

        match dir.measure_type.to_lowercase().as_str() {
            "delay" => {
                // Medir el retardo de propagación entre trig_node y node al cruce del umbral
                let trig_node = dir.trig_node.as_deref().unwrap_or(&dir.node);
                let (trig_min, trig_max) = get_signal_range(results, trig_node, t_start, t_end);
                let trig_level = trig_min + threshold_frac * (trig_max - trig_min);

                let (targ_min, targ_max) = get_signal_range(results, &dir.node, t_start, t_end);
                let targ_level = targ_min + threshold_frac * (targ_max - targ_min);

                if let Some(t_trig) =
                    find_threshold_crossing(results, trig_node, trig_level, true, 1, t_start, t_end)
                {
                    if let Some(t_targ) = find_threshold_crossing(
                        results, &dir.node, targ_level, true, 1, t_start, t_end,
                    ) {
                        measurements.insert(dir.name.clone(), (t_targ - t_trig).abs());
                    } else {
                        errors.push(format!(
                            "MEASURE {}: No se encontró cruce objetivo en nodo '{}'.",
                            dir.name, dir.node
                        ));
                    }
                } else {
                    errors.push(format!(
                        "MEASURE {}: No se encontró cruce de disparo en nodo '{}'.",
                        dir.name, trig_node
                    ));
                }
            }
            "risetime" => {
                // Tiempo de subida: del 10% al 90% del rango dinámico
                let (v_min, v_max) = get_signal_range(results, &dir.node, t_start, t_end);
                let level_10 = v_min + 0.1 * (v_max - v_min);
                let level_90 = v_min + 0.9 * (v_max - v_min);

                if let Some(t_10) =
                    find_threshold_crossing(results, &dir.node, level_10, true, 1, t_start, t_end)
                {
                    if let Some(t_90) = find_threshold_crossing(
                        results, &dir.node, level_90, true, 1, t_start, t_end,
                    ) {
                        measurements.insert(dir.name.clone(), (t_90 - t_10).abs());
                    } else {
                        errors.push(format!(
                            "MEASURE {}: No se encontró cruce del 90% en nodo '{}'.",
                            dir.name, dir.node
                        ));
                    }
                } else {
                    errors.push(format!(
                        "MEASURE {}: No se encontró cruce del 10% en nodo '{}'.",
                        dir.name, dir.node
                    ));
                }
            }
            "falltime" => {
                // Tiempo de bajada: del 90% al 10% del rango dinámico
                let (v_min, v_max) = get_signal_range(results, &dir.node, t_start, t_end);
                let level_90 = v_min + 0.9 * (v_max - v_min);
                let level_10 = v_min + 0.1 * (v_max - v_min);

                if let Some(t_90) =
                    find_threshold_crossing(results, &dir.node, level_90, false, 1, t_start, t_end)
                {
                    if let Some(t_10) = find_threshold_crossing(
                        results, &dir.node, level_10, false, 1, t_start, t_end,
                    ) {
                        measurements.insert(dir.name.clone(), (t_10 - t_90).abs());
                    } else {
                        errors.push(format!(
                            "MEASURE {}: No se encontró cruce descendente del 10% en nodo '{}'.",
                            dir.name, dir.node
                        ));
                    }
                } else {
                    errors.push(format!(
                        "MEASURE {}: No se encontró cruce descendente del 90% en nodo '{}'.",
                        dir.name, dir.node
                    ));
                }
            }
            "peak" | "max" => {
                let mut v_peak = f64::MIN;
                for step in results {
                    if step.time < t_start || step.time > t_end {
                        continue;
                    }
                    let v = *step.node_voltages.get(&dir.node).unwrap_or(&0.0);
                    if v > v_peak {
                        v_peak = v;
                    }
                }
                if v_peak > f64::MIN {
                    measurements.insert(dir.name.clone(), v_peak);
                }
            }
            "min" => {
                let mut v_min = f64::MAX;
                for step in results {
                    if step.time < t_start || step.time > t_end {
                        continue;
                    }
                    let v = *step.node_voltages.get(&dir.node).unwrap_or(&0.0);
                    if v < v_min {
                        v_min = v;
                    }
                }
                if v_min < f64::MAX {
                    measurements.insert(dir.name.clone(), v_min);
                }
            }
            "pp" => {
                // Peak-to-peak
                let (v_min, v_max) = get_signal_range(results, &dir.node, t_start, t_end);
                measurements.insert(dir.name.clone(), v_max - v_min);
            }
            "avg" => {
                // Promedio temporal por integración trapezoidal
                let mut integral = 0.0;
                let mut t_total: f64 = 0.0;
                for i in 1..results.len() {
                    let t0 = results[i - 1].time;
                    let t1 = results[i].time;
                    if t1 < t_start || t0 > t_end {
                        continue;
                    }
                    let v0 = *results[i - 1].node_voltages.get(&dir.node).unwrap_or(&0.0);
                    let v1 = *results[i].node_voltages.get(&dir.node).unwrap_or(&0.0);
                    let dt_seg = t1 - t0;
                    integral += 0.5 * (v0 + v1) * dt_seg;
                    t_total += dt_seg;
                }
                if t_total > 0.0 {
                    measurements.insert(dir.name.clone(), integral / t_total);
                }
            }
            "rms" => {
                // Valor eficaz (RMS) por integración trapezoidal de v^2
                let mut integral_sq: f64 = 0.0;
                let mut t_total: f64 = 0.0;
                for i in 1..results.len() {
                    let t0 = results[i - 1].time;
                    let t1 = results[i].time;
                    if t1 < t_start || t0 > t_end {
                        continue;
                    }
                    let v0 = *results[i - 1].node_voltages.get(&dir.node).unwrap_or(&0.0);
                    let v1 = *results[i].node_voltages.get(&dir.node).unwrap_or(&0.0);
                    let dt_seg = t1 - t0;
                    integral_sq += 0.5 * (v0 * v0 + v1 * v1) * dt_seg;
                    t_total += dt_seg;
                }
                if t_total > 0.0 {
                    measurements.insert(dir.name.clone(), (integral_sq / t_total).sqrt());
                }
            }
            _ => {
                errors.push(format!(
                    "MEASURE {}: Tipo de medición '{}' no reconocido.",
                    dir.name, dir.measure_type
                ));
            }
        }
    }

    MeasureResult {
        measurements,
        error_log: if errors.is_empty() {
            None
        } else {
            Some(errors.join("\n"))
        },
    }
}

// ==================================================================================
// FASE 24: Macromodelo de Líneas de Transmisión RLCG Segmentadas
// ==================================================================================
// Segmenta una línea de transmisión ideal o dispersiva con pérdidas en N secciones
// pasivas equivalentes en cascada Pi (inductores L, capacitores C, resistencias R
// y conductancias de fuga G) para integridad de señal en RF.

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransmissionLineParams {
    pub id: String,
    pub pin_in: String,    // Nodo de entrada
    pub pin_out: String,   // Nodo de salida
    pub gnd: String,       // Nodo de referencia (tierra)
    pub z0: f64,           // Impedancia característica (Ω)
    pub td: f64,           // Retardo de propagación (s)
    pub r_total: f64,      // Resistencia serie total de la línea (Ω), 0 para ideal
    pub g_total: f64,      // Conductancia de fuga total (S), 0 para ideal
    pub n_segments: usize, // Número de segmentos de la cascada Pi
}

/// Expande una línea de transmisión en N segmentos pasivos equivalentes en cascada Pi.
/// Cada segmento genera: L_seg en serie, C_seg/2 a cada extremo en paralelo, R_seg en serie,
/// y G_seg/2 a cada extremo. Se crean nodos internos virtuales `TL{id}.n{i}`.
///
/// Parámetros por segmento:
///   L_seg = Z0 * Td / N
///   C_seg = Td / (Z0 * N)
///   R_seg = R_total / N
///   G_seg = G_total / N
pub fn expand_transmission_line(params: &TransmissionLineParams) -> Vec<ComponentData> {
    let n = params.n_segments.max(1);
    let l_seg = params.z0 * params.td / n as f64;
    let c_seg = params.td / (params.z0 * n as f64);
    let r_seg = params.r_total / n as f64;
    let g_seg = params.g_total / n as f64;

    let mut components = Vec::new();
    let prefix = format!("TL{}", params.id);

    for i in 0..n {
        // Nodo de entrada del segmento
        let node_left = if i == 0 {
            params.pin_in.clone()
        } else {
            format!("{}.n{}", prefix, i)
        };

        // Nodo de salida del segmento
        let node_right = if i == n - 1 {
            params.pin_out.clone()
        } else {
            format!("{}.n{}", prefix, i + 1)
        };

        // Nodo intermedio entre R y L dentro del segmento
        let node_mid = format!("{}.m{}", prefix, i);

        // R_seg en serie (nodo_left → node_mid)
        if r_seg > 1e-15 {
            components.push(ComponentData {
                id: format!("{}.R{}", prefix, i),
                comp_type: "resistor".to_string(),
                value: r_seg,
                pins: vec![node_left.clone(), node_mid.clone()],
                ..Default::default()
            });
        }

        // L_seg en serie (node_mid → node_right) o (node_left → node_right) si no hay R
        let l_left = if r_seg > 1e-15 {
            node_mid.clone()
        } else {
            node_left.clone()
        };
        components.push(ComponentData {
            id: format!("{}.L{}", prefix, i),
            comp_type: "inductor".to_string(),
            value: l_seg,
            pins: vec![l_left, node_right.clone()],
            ..Default::default()
        });

        // C_seg/2 al lado izquierdo (node_left → gnd)
        components.push(ComponentData {
            id: format!("{}.CL{}", prefix, i),
            comp_type: "capacitor".to_string(),
            value: c_seg / 2.0,
            pins: vec![node_left.clone(), params.gnd.clone()],
            ..Default::default()
        });

        // C_seg/2 al lado derecho (node_right → gnd)
        components.push(ComponentData {
            id: format!("{}.CR{}", prefix, i),
            comp_type: "capacitor".to_string(),
            value: c_seg / 2.0,
            pins: vec![node_right.clone(), params.gnd.clone()],
            ..Default::default()
        });

        // G_seg/2 al lado izquierdo (conductancia de fuga) modelada como resistor grande
        if g_seg > 1e-15 {
            let r_shunt = 2.0 / g_seg; // R = 1/G, dividido por 2 porque tenemos G/2 a cada lado
            components.push(ComponentData {
                id: format!("{}.GL{}", prefix, i),
                comp_type: "resistor".to_string(),
                value: r_shunt,
                pins: vec![node_left.clone(), params.gnd.clone()],
                ..Default::default()
            });
            components.push(ComponentData {
                id: format!("{}.GR{}", prefix, i),
                comp_type: "resistor".to_string(),
                value: r_shunt,
                pins: vec![node_right.clone(), params.gnd.clone()],
                ..Default::default()
            });
        }
    }

    components
}

// ==================================================================================
// FASE 25: Modelos de Deriva y Dependencia Térmica
// ==================================================================================
// Inyecta los modelos físicos de variación de temperatura global (T) en:
// - Pasivos: Coeficientes TC1, TC2 de primer y segundo orden.
// - Unión PN (Diodo/BJT): Escalamiento de Is(T) con Varshni Eg(T).
// - MOSFETs: Degradación de movilidad T^-1.5 y corrimiento lineal de Vth.

/// Parámetros de banda prohibida de Silicio para el modelo de Varshni
#[allow(dead_code)]
pub const EG_SI_300: f64 = 1.12; // Banda prohibida del Si a 300K (eV)
#[allow(dead_code)]
const VARSHNI_ALPHA: f64 = 7.021e-4; // Parámetro α de Varshni para Si (eV/K)
#[allow(dead_code)]
const VARSHNI_BETA: f64 = 1108.0; // Parámetro β de Varshni para Si (K)

/// Calcula el potencial de banda prohibida del Silicio según Varshni:
///   Eg(T) = Eg(0) - α * T² / (T + β)
///   donde Eg(0) = Eg(300) + α * 300² / (300 + β)
#[allow(dead_code)]
pub fn bandgap_varshni(temp_k: f64) -> f64 {
    let eg0 = EG_SI_300 + VARSHNI_ALPHA * 300.0 * 300.0 / (300.0 + VARSHNI_BETA);
    eg0 - VARSHNI_ALPHA * temp_k * temp_k / (temp_k + VARSHNI_BETA)
}

/// Escalamiento térmico de la corriente de saturación inversa de la unión PN:
///   Is(T) = Is(T0) * (T/T0)^(XTI/N) * exp(-Eg/(kB*T) * (1 - T/T0))
///
/// Parámetros:
///   is_t0: Corriente de saturación a temperatura de referencia (A)
///   t0: Temperatura de referencia (K), típicamente 300
///   t: Temperatura actual (K)
///   xti: Exponente de temperatura de saturación (típicamente 3.0 para Si)
///   n: Coeficiente de emisión (idealidad)
#[allow(dead_code)]
pub fn thermal_is_pn(is_t0: f64, t0: f64, t: f64, xti: f64, n: f64) -> f64 {
    let eg_t0 = bandgap_varshni(t0);
    let eg_t = bandgap_varshni(t);
    let vt_t0 = PHYS_KB * t0 / PHYS_Q;
    let vt_t = PHYS_KB * t / PHYS_Q;

    // Modelo exacto SPICE: Is(T) = Is(T0) * (T/T0)^(XTI/N) * exp((Eg(T0)/Vt(T0) - Eg(T)/Vt(T)) / N)
    let ratio = (t / t0).powf(xti / n);
    let exp_term = ((eg_t0 / vt_t0 - eg_t / vt_t) / n).exp();
    is_t0 * ratio * exp_term
}

/// Voltaje térmico a temperatura T:
///   Vt(T) = kB * T / q
#[allow(dead_code)]
pub fn thermal_vt(temp_k: f64) -> f64 {
    PHYS_KB * temp_k / PHYS_Q
}

/// Escalamiento térmico de resistencia con coeficientes de primer y segundo orden:
///   R(T) = R0 * [1 + TC1*(T - T0) + TC2*(T - T0)²]
pub fn thermal_resistance(r0: f64, t0: f64, t: f64, tc1: f64, tc2: f64) -> f64 {
    let dt = t - t0;
    r0 * (1.0 + tc1 * dt + tc2 * dt * dt)
}

/// Degradación de movilidad de portadores en MOSFETs:
///   β(T) = β(T0) * (T/T0)^(-BEX)
/// donde BEX ≈ 1.5 para Si (empírico)
///
/// Parámetros:
///   beta_t0: Transconductancia o factor β a temperatura de referencia
///   t0: Temperatura de referencia (K)
///   t: Temperatura actual (K)
///   bex: Exponente de movilidad (típicamente 1.5)
#[allow(dead_code)]
pub fn thermal_mosfet_beta(beta_t0: f64, t0: f64, t: f64, bex: f64) -> f64 {
    beta_t0 * (t / t0).powf(-bex)
}

/// Corrimiento térmico de la tensión de umbral de MOSFETs:
///   Vth(T) = Vth(T0) - TCV * (T - T0)
/// donde TCV ≈ 2 mV/K para MOSFETs de Si
pub fn thermal_mosfet_vth(vth_t0: f64, t0: f64, t: f64, tcv: f64) -> f64 {
    vth_t0 - tcv * (t - t0)
}

/// Aplica correcciones térmicas completas a un netlist, devolviendo un netlist
/// modificado con los valores ajustados a la temperatura `temp_k`.
///
/// Se aplican los siguientes modelos físicos:
///   - Resistores: R(T) = R0 * [1 + TC1*(T-T0) + TC2*(T-T0)²]
///   - Capacitores: C(T) = C0 * [1 + TC1*(T-T0)]
///   - Inductores: L(T) = L0 * [1 + TC1*(T-T0)]
///   - Diodos: Is(T) escalado con Varshni, Vt(T) actualizado
///   - MOSFETs: β(T) degradada, Vth(T) desplazada
///   - BJTs: Is(T) escalado con Varshni
pub fn apply_thermal_drift(netlist: &CircuitNetlist, temp_k: f64) -> CircuitNetlist {
    let t0 = PHYS_T; // 300K referencia

    let mut adjusted = netlist.clone();

    for comp in &mut adjusted.components {
        match comp.comp_type.as_str() {
            "resistor" => {
                // TC1 = 3900 ppm/K típico para metales, TC2 = 0 por defecto
                let tc1 = 3.9e-3; // 3900 ppm/K
                let tc2 = 0.0;
                comp.value = thermal_resistance(comp.value, t0, temp_k, tc1, tc2);
            }
            "capacitor" => {
                // Coeficiente de temperatura para cerámicos X7R: ~±15% sobre rango
                let tc1 = 30e-6; // 30 ppm/K (conservador)
                comp.value *= 1.0 + tc1 * (temp_k - t0);
            }
            "inductor" => {
                // Coeficiente de temperatura del inductor: ~50 ppm/K
                let tc1 = 50e-6;
                comp.value *= 1.0 + tc1 * (temp_k - t0);
            }
            "diode" | "led" => {
                // El campo `value` de diodos a menudo es nominal; pero internamente
                // la corriente Is se escala en el solver. Aquí ajustamos un factor
                // de escala que el solver DC puede usar directamente.
                // Nota: el solver usa DIODE_IS global, así que aquí no modificamos
                // comp.value. El escalamiento real se aplica en solve_dc_circuit_thermal.
            }
            "opto" => {
                // El opto sigue la misma lógica del diodo: Is se escala en el solver
                // mediante get_thermal_parameters, no se modifica comp.value aquí.
            }
            "nmos" | "pmos" => {
                // Vth se almacena en comp.value para MOSFETs
                let vth_t0 = comp.value;
                let tcv = 2.0e-3; // 2 mV/K
                comp.value = thermal_mosfet_vth(vth_t0, t0, temp_k, tcv);
            }
            _ => {}
        }
    }

    adjusted
}

/// Resolvedor DC con temperatura global inyectada.
/// Aplica el modelo de deriva térmica completo al netlist y resuelve.
pub fn solve_dc_circuit_thermal(
    netlist: &CircuitNetlist,
    temp_k: f64,
) -> Result<SimulationResult, String> {
    let mut adjusted_netlist = apply_thermal_drift(netlist, temp_k);
    adjusted_netlist.temperature = Some(temp_k);
    solve_dc_circuit(&adjusted_netlist)
}

/// Resolvedor DC con acoplamiento electro-térmico completo (Relaxation Loop).
/// Alterna entre:
///   1. Resolver el circuito eléctrico con temperaturas fijas → obtener corrientes/voltajes
///   2. Calcular potencia disipada por dispositivo → resolver red térmica → actualizar T_j
/// Converge cuando max(|ΔT_j|) < thermal_tol.
pub fn solve_dc_electrothermal(
    netlist: &CircuitNetlist,
) -> Result<(SimulationResult, HashMap<String, f64>), String> {
    let config = netlist
        .thermal_config
        .as_ref()
        .ok_or("Se requiere .THERMAL en el netlist para simulación electro-térmica".to_string())?;

    let t_amb = config.t_amb;
    let max_iters = config.max_thermal_iters;
    let tol = config.thermal_tol;

    // Identificar dispositivos térmicamente activos y sus índices
    let thermal_devices: Vec<(usize, String)> = netlist
        .components
        .iter()
        .enumerate()
        .filter_map(|(i, c)| match c.comp_type.as_str() {
            "diode" | "led" | "nmos" | "pmos" | "bsim3nmos" | "bsim3pmos" | "bsim4nmos"
            | "bsim4pmos" | "npn" | "pnp" | "opto" => Some((i, c.id.clone())),
            _ => None,
        })
        .collect();

    let n_dev = thermal_devices.len();
    if n_dev == 0 {
        // Sin dispositivos térmicos, resolver normalmente
        let result = solve_dc_circuit(netlist)?;
        return Ok((result, HashMap::new()));
    }

    // Inicializar temperaturas de unión a T_amb
    let mut device_temps: HashMap<String, f64> = HashMap::new();
    for (_, id) in &thermal_devices {
        device_temps.insert(id.clone(), t_amb);
    }

    let mut last_result: Option<SimulationResult> = None;

    for _iter in 0..max_iters {
        // --- Paso 1: Resolver circuito eléctrico con temperaturas actuales ---
        let mut adjusted_netlist = netlist.clone();
        // Inyectar temperatura promedio como temperatura global del circuito
        let avg_temp = if device_temps.is_empty() {
            t_amb
        } else {
            device_temps.values().sum::<f64>() / device_temps.len() as f64
        };
        adjusted_netlist = apply_thermal_drift(&adjusted_netlist, avg_temp);
        adjusted_netlist.temperature = Some(avg_temp);

        let result = solve_dc_circuit(&adjusted_netlist)?;

        // --- Paso 2: Calcular potencia disipada por dispositivo ---
        let mut power_diss: HashMap<String, f64> = HashMap::new();

        for (comp_idx, comp_id) in &thermal_devices {
            let comp = &netlist.components[*comp_idx];
            let p = match comp.comp_type.as_str() {
                "diode" | "led" => {
                    let na = comp.pins[0].parse::<usize>().unwrap_or(0);
                    let nc = comp.pins[1].parse::<usize>().unwrap_or(0);
                    let va = *result.node_voltages.get(&na.to_string()).unwrap_or(&0.0);
                    let vc = *result.node_voltages.get(&nc.to_string()).unwrap_or(&0.0);
                    let vd = va - vc;
                    let tj = *device_temps.get(comp_id).unwrap_or(&t_amb);
                    let (_, id_val, _) = solve_diode_junction_voltage(vd, Some(tj), comp);
                    (vd * id_val).abs()
                }
                "nmos" | "bsim3nmos" | "bsim4nmos" => {
                    if comp.pins.len() < 3 {
                        0.0
                    } else {
                        let ng = comp.pins[0].parse::<usize>().unwrap_or(0);
                        let nd = comp.pins[1].parse::<usize>().unwrap_or(0);
                        let ns = comp.pins[2].parse::<usize>().unwrap_or(0);
                        let vg = *result.node_voltages.get(&ng.to_string()).unwrap_or(&0.0);
                        let vd_pin = *result.node_voltages.get(&nd.to_string()).unwrap_or(&0.0);
                        let vs = *result.node_voltages.get(&ns.to_string()).unwrap_or(&0.0);
                        let vds = vd_pin - vs;
                        let vgs = vg - vs;
                        let vbs = if comp.pins.len() > 3 {
                            let nb = comp.pins[3].parse::<usize>().unwrap_or(0);
                            let vb = *result.node_voltages.get(&nb.to_string()).unwrap_or(&0.0);
                            vb - vs
                        } else {
                            0.0
                        };
                        let (ids, _, _) = evaluate_bsim3_nmos(
                            vgs,
                            vds,
                            vbs,
                            comp.value,
                            comp.w,
                            comp.l,
                            Some(avg_temp),
                            Some(comp),
                        );
                        (vds * ids).abs()
                    }
                }
                "pmos" | "bsim3pmos" | "bsim4pmos" => {
                    if comp.pins.len() < 3 {
                        0.0
                    } else {
                        let ng = comp.pins[0].parse::<usize>().unwrap_or(0);
                        let nd = comp.pins[1].parse::<usize>().unwrap_or(0);
                        let ns = comp.pins[2].parse::<usize>().unwrap_or(0);
                        let vg = *result.node_voltages.get(&ng.to_string()).unwrap_or(&0.0);
                        let vd_pin = *result.node_voltages.get(&nd.to_string()).unwrap_or(&0.0);
                        let vs = *result.node_voltages.get(&ns.to_string()).unwrap_or(&0.0);
                        let vsd = vs - vd_pin;
                        let vsg = vs - vg;
                        let vsb = if comp.pins.len() > 3 {
                            let nb = comp.pins[3].parse::<usize>().unwrap_or(0);
                            let vb = *result.node_voltages.get(&nb.to_string()).unwrap_or(&0.0);
                            vs - vb
                        } else {
                            0.0
                        };
                        let (isd, _, _) = evaluate_bsim3_pmos(
                            vsg,
                            vsd,
                            vsb,
                            comp.value,
                            comp.w,
                            comp.l,
                            Some(avg_temp),
                            Some(comp),
                        );
                        (vsd * isd).abs()
                    }
                }
                "npn" | "pnp" => {
                    if comp.pins.len() < 3 {
                        0.0
                    } else {
                        let nb = comp.pins[0].parse::<usize>().unwrap_or(0);
                        let nc = comp.pins[1].parse::<usize>().unwrap_or(0);
                        let ne = comp.pins[2].parse::<usize>().unwrap_or(0);
                        let _vb = *result.node_voltages.get(&nb.to_string()).unwrap_or(&0.0);
                        let vc_pin = *result.node_voltages.get(&nc.to_string()).unwrap_or(&0.0);
                        let ve = *result.node_voltages.get(&ne.to_string()).unwrap_or(&0.0);
                        let vce = if comp.comp_type == "npn" {
                            vc_pin - ve
                        } else {
                            ve - vc_pin
                        };
                        // Corriente de colector simplificada
                        let ic_branch = result.branch_currents.get(comp_id).copied().unwrap_or(0.0);
                        (vce.abs() * ic_branch.abs()).min(50.0)
                    }
                }
                _ => 0.0,
            };
            power_diss.insert(comp_id.clone(), p);
        }

        // --- Paso 3: Construir y resolver la red térmica Gth ---
        // Para cada dispositivo i: Tj_i = T_amb + Rth_i * P_i + Σ_j(Rth_ij * P_j)
        let mut new_temps: HashMap<String, f64> = HashMap::new();

        for (comp_idx, comp_id) in &thermal_devices {
            let comp = &netlist.components[*comp_idx];

            // Rth propio: desde comp.rth > constante por defecto
            let rth_self = comp.rth.unwrap_or_else(|| match comp.comp_type.as_str() {
                "diode" | "led" => DIODE_RTH_JA,
                "opto" => OPTO_RTH_JA,
                "nmos" | "pmos" | "bsim3nmos" | "bsim3pmos" | "bsim4nmos" | "bsim4pmos" => {
                    MOS_RTH_JA
                }
                "npn" | "pnp" => BJT_RTH_JA,
                _ => 100.0,
            });

            let p_self = *power_diss.get(comp_id).unwrap_or(&0.0);

            // Contribución propia
            let mut tj = t_amb + rth_self * p_self;

            // Contribución de acoplamiento térmico mutuo
            for (id1, id2, rth_mutual) in &config.thermal_coupling {
                if id1 == comp_id {
                    let p_other = *power_diss.get(id2).unwrap_or(&0.0);
                    tj += rth_mutual * p_other;
                } else if id2 == comp_id {
                    let p_other = *power_diss.get(id1).unwrap_or(&0.0);
                    tj += rth_mutual * p_other;
                }
            }

            // Clampar temperatura: no puede ser menor que ambiente ni mayor que 500K
            let tj_clamped = tj.clamp(t_amb, 500.0);
            new_temps.insert(comp_id.clone(), tj_clamped);
        }

        // --- Paso 4: Verificar convergencia ---
        let max_delta_t = thermal_devices
            .iter()
            .map(|(_, id)| {
                let t_old = *device_temps.get(id).unwrap_or(&t_amb);
                let t_new = *new_temps.get(id).unwrap_or(&t_amb);
                (t_new - t_old).abs()
            })
            .fold(0.0_f64, f64::max);

        device_temps = new_temps;
        last_result = Some(result);

        if max_delta_t < tol {
            break;
        }
    }

    let final_result = last_result.unwrap_or_else(|| SimulationResult {
        node_voltages: HashMap::new(),
        branch_currents: HashMap::new(),
        convergence_iterations: 0,
        error_log: Some("Simulación electro-térmica no convergió".to_string()),
    });

    Ok((final_result, device_temps))
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ParameterSensitivity {
    pub component_id: String,
    pub parameter_name: String,
    pub parameter_value: f64,
    pub absolute_sensitivities: HashMap<String, f64>,
    pub normalized_sensitivities: HashMap<String, f64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorstCaseLimits {
    pub nominal_value: f64,
    pub worst_case_high: f64,
    pub worst_case_low: f64,
    pub max_deviation: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SensitivityResult {
    pub nominal_voltages: HashMap<String, f64>,
    pub sensitivities: Vec<ParameterSensitivity>,
    pub worst_case_limits: HashMap<String, WorstCaseLimits>,
}

/// Realiza un análisis de sensibilidad en corriente continua (DC Sensitivity) y
/// evalúa automáticamente los límites del peor caso (Worst-Case Analysis) de todos los nodos.
pub fn solve_dc_sensitivity(netlist: &CircuitNetlist) -> Result<SensitivityResult, String> {
    // 1. Resolver el punto de operación DC nominal
    let nominal_res = solve_dc_circuit(netlist)?;
    let nominal_voltages = nominal_res.node_voltages.clone();

    // 2. Identificar el número máximo de nodos activos y mapear fuentes
    let n = crate::topology::validate_netlist_topology(netlist, true)?;
    let v_sources: Vec<&ComponentData> = netlist
        .components
        .iter()
        .filter(|c| {
            c.comp_type == "vsource"
                || c.comp_type == "bvoltage"
                || c.comp_type == "vcvs"
                || c.comp_type == "ccvs"
        })
        .collect();
    let m = v_sources.len();
    let size = n + m;

    if size == 0 {
        return Err("El circuito no contiene nodos activos o componentes.".to_string());
    }

    let mut vsource_map = HashMap::new();
    for (idx, vs) in v_sources.iter().enumerate() {
        vsource_map.insert(vs.id.clone(), idx);
    }

    // 3. Re-construir la matriz Jacobiana (J) en el punto de operación nominal
    let mut j_matrix = DMatrix::<f64>::zeros(size, size);
    let mut z_temp = DVector::<f64>::zeros(size);
    stamp_linear_components(netlist, n, &vsource_map, &mut j_matrix, &mut z_temp)?;

    // Añadir Gmin residual (1e-12 S) en la diagonal de nodos para evitar singularidades
    for i in 1..=n {
        j_matrix[(i - 1, i - 1)] += 1e-12;
    }

    // Convertir nominal_voltages a un vector de voltajes prev_voltages de tamaño n+1
    let mut prev_voltages = vec![0.0; n + 1];
    for i in 1..=n {
        prev_voltages[i] = *nominal_voltages.get(&i.to_string()).unwrap_or(&0.0);
    }

    // Estampar componentes no lineales en j_matrix usando prev_voltages
    for comp in &netlist.components {
        if comp.comp_type == "diode" || comp.comp_type == "led" {
            let node_anode = comp.pins[0].parse::<usize>().unwrap();
            let node_cathode = comp.pins[1].parse::<usize>().unwrap();
            let v_anode = if node_anode > 0 {
                prev_voltages[node_anode]
            } else {
                0.0
            };
            let v_cathode = if node_cathode > 0 {
                prev_voltages[node_cathode]
            } else {
                0.0
            };
            let vd = v_anode - v_cathode;
            let (_, _, geq) = solve_diode_junction_voltage(vd, netlist.temperature, comp);

            let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                if r > 0 && c > 0 {
                    j_matrix[(r - 1, c - 1)] += g;
                }
            };
            stamp_conductance(node_anode, node_anode, geq);
            stamp_conductance(node_cathode, node_cathode, geq);
            stamp_conductance(node_anode, node_cathode, -geq);
            stamp_conductance(node_cathode, node_anode, -geq);
        } else if comp.comp_type == "opto" {
            if comp.pins.len() < 4 {
                continue;
            }
            let node_a = comp.pins[0].parse::<usize>().unwrap();
            let node_k = comp.pins[1].parse::<usize>().unwrap();
            let node_c = comp.pins[2].parse::<usize>().unwrap();
            let node_e = comp.pins[3].parse::<usize>().unwrap();
            let v_a = if node_a > 0 {
                prev_voltages[node_a]
            } else {
                0.0
            };
            let v_k = if node_k > 0 {
                prev_voltages[node_k]
            } else {
                0.0
            };
            let v_c = if node_c > 0 {
                prev_voltages[node_c]
            } else {
                0.0
            };
            let v_e = if node_e > 0 {
                prev_voltages[node_e]
            } else {
                0.0
            };
            let vd = v_a - v_k;
            let v_ce = v_c - v_e;
            let (_, id_led, gd_led) = solve_diode_junction_voltage(vd, netlist.temperature, comp);
            let (_i_ce, g_md, g_o, _i_ce_eq) =
                evaluate_opto_receiver(vd, gd_led, id_led, v_ce, comp);

            let mut stamp = |r: usize, c: usize, g: f64| {
                if r > 0 && c > 0 {
                    j_matrix[(r - 1, c - 1)] += g;
                }
            };
            // Lado LED
            stamp(node_a, node_a, gd_led);
            stamp(node_k, node_k, gd_led);
            stamp(node_a, node_k, -gd_led);
            stamp(node_k, node_a, -gd_led);
            // Lado receptor
            stamp(node_c, node_a, g_md);
            stamp(node_c, node_k, -g_md);
            stamp(node_c, node_c, g_o);
            stamp(node_c, node_e, -g_o);
            stamp(node_e, node_a, -g_md);
            stamp(node_e, node_k, g_md);
            stamp(node_e, node_c, -g_o);
            stamp(node_e, node_e, g_o);
        } else if comp.comp_type == "nmos" {
            let node_gate = comp.pins[0].parse::<usize>().unwrap();
            let node_drain = comp.pins[1].parse::<usize>().unwrap();
            let node_source = comp.pins[2].parse::<usize>().unwrap();
            let v_gate = if node_gate > 0 {
                prev_voltages[node_gate]
            } else {
                0.0
            };
            let v_drain = if node_drain > 0 {
                prev_voltages[node_drain]
            } else {
                0.0
            };
            let v_source = if node_source > 0 {
                prev_voltages[node_source]
            } else {
                0.0
            };
            let vgs = v_gate - v_source;
            let mut vds = v_drain - v_source;
            if vds < 0.0 {
                vds = 0.0;
            }
            let vth = comp.value;
            let kn = 0.02;

            let (_ids, gm, gds) = if vgs <= vth {
                (0.0, 0.0, 1e-9)
            } else if vds < vgs - vth {
                let ids_val = kn * (2.0 * (vgs - vth) * vds - vds * vds);
                let gm_val = 2.0 * kn * vds;
                let gds_val = 2.0 * kn * (vgs - vth - vds);
                (ids_val, gm_val, gds_val.max(1e-9))
            } else {
                let ids_val = kn * (vgs - vth) * (vgs - vth);
                let gm_val = 2.0 * kn * (vgs - vth);
                let gds_val = 1e-5;
                (ids_val, gm_val, gds_val)
            };

            let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                if r > 0 && c > 0 {
                    j_matrix[(r - 1, c - 1)] += g;
                }
            };
            stamp_conductance(node_drain, node_drain, gds);
            stamp_conductance(node_source, node_source, gds);
            stamp_conductance(node_drain, node_source, -gds);
            stamp_conductance(node_source, node_drain, -gds);

            if node_drain > 0 {
                if node_gate > 0 {
                    j_matrix[(node_drain - 1, node_gate - 1)] += gm;
                }
                if node_source > 0 {
                    j_matrix[(node_drain - 1, node_source - 1)] -= gm;
                }
            }
            if node_source > 0 {
                if node_gate > 0 {
                    j_matrix[(node_source - 1, node_gate - 1)] -= gm;
                }
                if node_source > 0 {
                    j_matrix[(node_source - 1, node_source - 1)] += gm;
                }
            }
        } else if comp.comp_type == "pmos" {
            let node_gate = comp.pins[0].parse::<usize>().unwrap();
            let node_drain = comp.pins[1].parse::<usize>().unwrap();
            let node_source = comp.pins[2].parse::<usize>().unwrap();
            let v_gate = if node_gate > 0 {
                prev_voltages[node_gate]
            } else {
                0.0
            };
            let v_drain = if node_drain > 0 {
                prev_voltages[node_drain]
            } else {
                0.0
            };
            let v_source = if node_source > 0 {
                prev_voltages[node_source]
            } else {
                0.0
            };
            let vsg = v_source - v_gate;
            let mut vsd = v_source - v_drain;
            if vsd < 0.0 {
                vsd = 0.0;
            }
            let vth = if comp.value == 0.0 { -1.5 } else { comp.value };
            let vth_abs = -vth;
            let kp = 0.02;

            let (_isd, gm_sd, gds_cond) = if vsg <= vth_abs {
                (0.0, 0.0, 1e-9)
            } else if vsd < vsg - vth_abs {
                let isd_val = kp * (2.0 * (vsg - vth_abs) * vsd - vsd * vsd);
                let gm_sd_val = 2.0 * kp * vsd;
                let gds_cond_val = 2.0 * kp * (vsg - vth_abs - vsd);
                (isd_val, gm_sd_val, gds_cond_val.max(1e-9))
            } else {
                let isd_val = kp * (vsg - vth_abs) * (vsg - vth_abs);
                let gm_sd_val = 2.0 * kp * (vsg - vth_abs);
                let gds_cond_val = 1e-5;
                (isd_val, gm_sd_val, gds_cond_val)
            };

            let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                if r > 0 && c > 0 {
                    j_matrix[(r - 1, c - 1)] += g;
                }
            };
            stamp_conductance(node_source, node_source, gds_cond);
            stamp_conductance(node_drain, node_drain, gds_cond);
            stamp_conductance(node_source, node_drain, -gds_cond);
            stamp_conductance(node_drain, node_source, -gds_cond);

            if node_drain > 0 {
                if node_source > 0 {
                    j_matrix[(node_drain - 1, node_source - 1)] -= gm_sd;
                }
                if node_gate > 0 {
                    j_matrix[(node_drain - 1, node_gate - 1)] += gm_sd;
                }
            }
            if node_source > 0 {
                if node_source > 0 {
                    j_matrix[(node_source - 1, node_source - 1)] += gm_sd;
                }
                if node_gate > 0 {
                    j_matrix[(node_source - 1, node_gate - 1)] -= gm_sd;
                }
            }
        } else if comp.comp_type == "npn" || comp.comp_type == "pnp" {
            let is_npn = comp.comp_type == "npn";
            let node_base = comp.pins[0].parse::<usize>().unwrap();
            let node_collector = comp.pins[1].parse::<usize>().unwrap();
            let node_emitter = comp.pins[2].parse::<usize>().unwrap();
            let v_base = if node_base > 0 {
                prev_voltages[node_base]
            } else {
                0.0
            };
            let v_collector = if node_collector > 0 {
                prev_voltages[node_collector]
            } else {
                0.0
            };
            let v_emitter = if node_emitter > 0 {
                prev_voltages[node_emitter]
            } else {
                0.0
            };

            let (mut vbe, mut vbc) = if is_npn {
                (v_base - v_emitter, v_base - v_collector)
            } else {
                (v_emitter - v_base, v_collector - v_base)
            };

            if vbe > 0.72 {
                vbe = 0.72;
            }
            if vbc > 0.72 {
                vbc = 0.72;
            }

            let beta_f = comp
                .bjt_bf
                .unwrap_or(if comp.value <= 1.0 { 100.0 } else { comp.value });
            let beta_r = 1.0;
            let alpha_f = beta_f / (beta_f + 1.0);
            let alpha_r = beta_r / (beta_r + 1.0);

            let (vt_b, is_b) = get_thermal_parameters(netlist.temperature, comp.bjt_is);
            let exp_be = (vbe / vt_b).exp();
            let exp_bc = (vbc / vt_b).exp();

            let gbe = (is_b / vt_b) * exp_be;
            let gbc = (is_b / vt_b) * exp_bc;

            let g_be_b = gbe / (beta_f + 1.0);
            let g_bc_b = gbc / (beta_r + 1.0);

            let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                if r > 0 && c > 0 {
                    j_matrix[(r - 1, c - 1)] += g;
                }
            };

            stamp_conductance(node_base, node_base, g_be_b + g_bc_b);
            stamp_conductance(node_base, node_emitter, -g_be_b);
            stamp_conductance(node_base, node_collector, -g_bc_b);

            if node_collector > 0 {
                if node_base > 0 {
                    j_matrix[(node_collector - 1, node_base - 1)] += alpha_f * gbe - gbc;
                }
                if node_emitter > 0 {
                    j_matrix[(node_collector - 1, node_emitter - 1)] -= alpha_f * gbe;
                }
                j_matrix[(node_collector - 1, node_collector - 1)] += gbc;
            }

            if node_emitter > 0 {
                if node_base > 0 {
                    j_matrix[(node_emitter - 1, node_base - 1)] -= gbe - alpha_r * gbc;
                }
                j_matrix[(node_emitter - 1, node_emitter - 1)] += gbe;
                if node_collector > 0 {
                    j_matrix[(node_emitter - 1, node_collector - 1)] -= alpha_r * gbc;
                }
            }
        } else if comp.comp_type == "njf" || comp.comp_type == "pjf" {
            let is_njf = comp.comp_type == "njf";
            let node_drain = comp.pins[0].parse::<usize>().unwrap();
            let node_gate = comp.pins[1].parse::<usize>().unwrap();
            let node_source = comp.pins[2].parse::<usize>().unwrap();

            let v_drain = if node_drain > 0 {
                prev_voltages[node_drain]
            } else {
                0.0
            };
            let v_gate = if node_gate > 0 {
                prev_voltages[node_gate]
            } else {
                0.0
            };
            let v_source = if node_source > 0 {
                prev_voltages[node_source]
            } else {
                0.0
            };

            let vto = comp.jfet_vto.unwrap_or(if is_njf { -2.0 } else { 2.0 });
            let beta = comp.jfet_beta.unwrap_or(1e-3);
            let lambda = comp.jfet_lambda.unwrap_or(0.0);

            let (vgs_raw, vds_raw, factor_pol) = if is_njf {
                (v_gate - v_source, v_drain - v_source, 1.0)
            } else {
                (v_source - v_gate, v_source - v_drain, -1.0)
            };

            let mut vgs = vgs_raw;
            let mut vds = vds_raw;
            let mut _swapped = false;
            if vds < 0.0 {
                vds = -vds;
                vgs = if is_njf {
                    v_gate - v_drain
                } else {
                    v_drain - v_gate
                };
                _swapped = true;
            }

            let vgst = if is_njf { vgs - vto } else { vto - vgs };
            let (_, gm, gds) = if vgst <= 0.0 {
                (0.0, 0.0, 1e-9)
            } else if vds < vgst {
                let gm_val = 2.0 * beta * vds * (1.0 + lambda * vds);
                let gds_val = beta
                    * ((2.0 * vgst - 2.0 * vds) * (1.0 + lambda * vds)
                        + vds * (2.0 * vgst - vds) * lambda);
                (0.0, gm_val, gds_val.max(1e-9))
            } else {
                let gm_val = 2.0 * beta * vgst * (1.0 + lambda * vds);
                let gds_val = beta * vgst * vgst * lambda;
                (0.0, gm_val, gds_val.max(1e-9))
            };

            let gm_final = gm * factor_pol;
            let gds_final = gds;

            // Estampar gds directamente (evita conflicto de borrow con closure)
            if node_drain > 0 {
                j_matrix[(node_drain - 1, node_drain - 1)] += gds_final;
            }
            if node_source > 0 {
                j_matrix[(node_source - 1, node_source - 1)] += gds_final;
            }
            if node_drain > 0 && node_source > 0 {
                j_matrix[(node_drain - 1, node_source - 1)] -= gds_final;
            }
            if node_source > 0 && node_drain > 0 {
                j_matrix[(node_source - 1, node_drain - 1)] -= gds_final;
            }

            if node_drain > 0 {
                if node_gate > 0 {
                    j_matrix[(node_drain - 1, node_gate - 1)] += gm_final;
                }
                if node_source > 0 {
                    j_matrix[(node_drain - 1, node_source - 1)] -= gm_final;
                }
            }
            if node_source > 0 {
                if node_gate > 0 {
                    j_matrix[(node_source - 1, node_gate - 1)] -= gm_final;
                }
                if node_source > 0 {
                    j_matrix[(node_source - 1, node_source - 1)] += gm_final;
                }
            }

            let (vt_local, _) = get_thermal_parameters(netlist.temperature, None);
            let gate_is = 1e-14;
            let exp_gs = ((v_gate - v_source) / vt_local).exp();
            let gg_gs = (gate_is / vt_local) * exp_gs;
            if node_gate > 0 {
                j_matrix[(node_gate - 1, node_gate - 1)] += gg_gs;
            }
            if node_source > 0 {
                j_matrix[(node_source - 1, node_source - 1)] += gg_gs;
            }
            if node_gate > 0 && node_source > 0 {
                j_matrix[(node_gate - 1, node_source - 1)] -= gg_gs;
            }
            if node_source > 0 && node_gate > 0 {
                j_matrix[(node_source - 1, node_gate - 1)] -= gg_gs;
            }

            let exp_gd = ((v_gate - v_drain) / vt_local).exp();
            let gg_gd = (gate_is / vt_local) * exp_gd;
            if node_gate > 0 {
                j_matrix[(node_gate - 1, node_gate - 1)] += gg_gd;
            }
            if node_drain > 0 {
                j_matrix[(node_drain - 1, node_drain - 1)] += gg_gd;
            }
            if node_gate > 0 && node_drain > 0 {
                j_matrix[(node_gate - 1, node_drain - 1)] -= gg_gd;
            }
            if node_drain > 0 && node_gate > 0 {
                j_matrix[(node_drain - 1, node_gate - 1)] -= gg_gd;
            }
        } else if comp.comp_type == "opamp" {
            let pin_in_pos = comp.pins[0].parse::<usize>().unwrap();
            let pin_in_neg = comp.pins[1].parse::<usize>().unwrap();
            let pin_vplus = comp.pins[2].parse::<usize>().unwrap();
            let pin_vminus = comp.pins[3].parse::<usize>().unwrap();
            let pin_out = comp.pins[4].parse::<usize>().unwrap();

            let v_in_pos = if pin_in_pos > 0 {
                prev_voltages[pin_in_pos]
            } else {
                0.0
            };
            let v_in_neg = if pin_in_neg > 0 {
                prev_voltages[pin_in_neg]
            } else {
                0.0
            };
            let v_vplus = if pin_vplus > 0 {
                prev_voltages[pin_vplus]
            } else {
                15.0
            };
            let v_vminus = if pin_vminus > 0 {
                prev_voltages[pin_vminus]
            } else {
                -15.0
            };

            let v_diff = v_in_pos - v_in_neg;
            let mut v_span = v_vplus - v_vminus;
            if v_span.abs() < 1e-3 {
                v_span = 30.0;
            }

            let a_ol = 1e5;
            let r_in = 1e7;
            let r_out = 100.0;
            let g_out = 1.0 / r_out;
            let g_in = 1.0 / r_in;

            let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                if r > 0 && c > 0 {
                    j_matrix[(r - 1, c - 1)] += g;
                }
            };
            stamp_conductance(pin_in_pos, pin_in_pos, g_in);
            stamp_conductance(pin_in_neg, pin_in_neg, g_in);
            stamp_conductance(pin_in_pos, pin_in_neg, -g_in);
            stamp_conductance(pin_in_neg, pin_in_pos, -g_in);

            let arg = (a_ol * v_diff) / v_span;
            let tanh_val = arg.tanh();
            let g_m_int = 0.5 * a_ol * (1.0 - tanh_val * tanh_val);
            let g_m_opamp = g_out * g_m_int;

            if pin_out > 0 {
                j_matrix[(pin_out - 1, pin_out - 1)] += g_out;
                if pin_in_pos > 0 {
                    j_matrix[(pin_out - 1, pin_in_pos - 1)] -= g_m_opamp;
                }
                if pin_in_neg > 0 {
                    j_matrix[(pin_out - 1, pin_in_neg - 1)] += g_m_opamp;
                }
            }
        }
    }

    // 4. Descomponer J usando LU disperso para resolver eficientemente
    let j_decomp = SparseLU::factorize(SparseMatrix::from_dense(&j_matrix))
        .map_err(|e| format!("Fallo de factorización en sensibilidad: {}", e))?;

    // 5. Analizar sensibilidades respecto a parámetros
    let mut sensitivities = Vec::new();
    let mut worst_case_deviations = HashMap::new(); // nodo -> sum(abs(dV/dp) * delta_p)
    for i in 1..=n {
        worst_case_deviations.insert(i.to_string(), 0.0);
    }

    for comp in &netlist.components {
        if comp.comp_type == "resistor" {
            let node_a = comp.pins[0].parse::<usize>().unwrap();
            let node_b = comp.pins[1].parse::<usize>().unwrap();
            let v_a = *nominal_voltages.get(&node_a.to_string()).unwrap_or(&0.0);
            let v_b = *nominal_voltages.get(&node_b.to_string()).unwrap_or(&0.0);
            let r_val = comp.value;

            if r_val > 1e-12 {
                let mut b_vec = DVector::<f64>::zeros(size);
                // dF/dR = -(V_A - V_B) / R^2
                // RHS b = -dF/dR = (V_A - V_B) / R^2
                let rhs_val = (v_a - v_b) / (r_val * r_val);
                if node_a > 0 {
                    b_vec[node_a - 1] += rhs_val;
                }
                if node_b > 0 {
                    b_vec[node_b - 1] -= rhs_val;
                }

                if let Some(sens_sol) = j_decomp.solve(&b_vec) {
                    let mut absolute_sensitivities = HashMap::new();
                    let mut normalized_sensitivities = HashMap::new();

                    for node_idx in 1..=n {
                        let node_str = node_idx.to_string();
                        let abs_sens = sens_sol[node_idx - 1];
                        absolute_sensitivities.insert(node_str.clone(), abs_sens);

                        let v_node = *nominal_voltages.get(&node_str).unwrap_or(&0.0);
                        let norm_sens = if v_node.abs() > 1e-5 {
                            abs_sens * r_val / v_node
                        } else {
                            0.0
                        };
                        normalized_sensitivities.insert(node_str.clone(), norm_sens);

                        // Contribución al Peor Caso (Worst Case)
                        let tolerance = comp.tolerance.unwrap_or(0.01); // 1% por defecto
                        let delta_p = r_val * tolerance;
                        let dev = abs_sens.abs() * delta_p;
                        if let Some(total_dev) = worst_case_deviations.get_mut(&node_str) {
                            *total_dev += dev;
                        }
                    }

                    sensitivities.push(ParameterSensitivity {
                        component_id: comp.id.clone(),
                        parameter_name: "resistance".to_string(),
                        parameter_value: r_val,
                        absolute_sensitivities,
                        normalized_sensitivities,
                    });
                }
            }
        } else if comp.comp_type == "vsource" {
            let vs_idx = *vsource_map.get(&comp.id).unwrap();
            let v_val = comp.value;

            let mut b_vec = DVector::<f64>::zeros(size);
            // dF/dVsrc = -1 en la ecuación de rama, así que b = -dF/dVsrc = 1
            b_vec[n + vs_idx] = 1.0;

            if let Some(sens_sol) = j_decomp.solve(&b_vec) {
                let mut absolute_sensitivities = HashMap::new();
                let mut normalized_sensitivities = HashMap::new();

                for node_idx in 1..=n {
                    let node_str = node_idx.to_string();
                    let abs_sens = sens_sol[node_idx - 1];
                    absolute_sensitivities.insert(node_str.clone(), abs_sens);

                    let v_node = *nominal_voltages.get(&node_str).unwrap_or(&0.0);
                    let norm_sens = if v_node.abs() > 1e-5 {
                        abs_sens * v_val / v_node
                    } else {
                        0.0
                    };
                    normalized_sensitivities.insert(node_str.clone(), norm_sens);

                    // Contribución al Peor Caso
                    let tolerance = comp.tolerance.unwrap_or(0.0); // 0% por defecto para fuentes
                    let delta_p = v_val * tolerance;
                    let dev = abs_sens.abs() * delta_p;
                    if let Some(total_dev) = worst_case_deviations.get_mut(&node_str) {
                        *total_dev += dev;
                    }
                }

                sensitivities.push(ParameterSensitivity {
                    component_id: comp.id.clone(),
                    parameter_name: "voltage".to_string(),
                    parameter_value: v_val,
                    absolute_sensitivities,
                    normalized_sensitivities,
                });
            }
        }
    }

    // 6. Consolidar límites de peor caso por nodo
    let mut worst_case_limits = HashMap::new();
    for node_idx in 1..=n {
        let node_str = node_idx.to_string();
        let nominal_val = *nominal_voltages.get(&node_str).unwrap_or(&0.0);
        let max_dev = *worst_case_deviations.get(&node_str).unwrap_or(&0.0);

        worst_case_limits.insert(
            node_str,
            WorstCaseLimits {
                nominal_value: nominal_val,
                worst_case_high: nominal_val + max_dev,
                worst_case_low: nominal_val - max_dev,
                max_deviation: max_dev,
            },
        );
    }

    Ok(SensitivityResult {
        nominal_voltages,
        sensitivities,
        worst_case_limits,
    })
}
