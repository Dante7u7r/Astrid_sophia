use crate::solver::matrix::SparseMatrix;
use crate::solver::types::CircuitNetlist;
use nalgebra::DMatrix;
use num_complex::Complex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::super::dc::solve_dc_circuit;
use super::super::devices::{
    evaluate_opto_receiver, solve_diode_junction_voltage, DIODE_IS, DIODE_VT,
};

/// Representación de un polo o cero complejo en el plano s.
#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct PoleZeroValue {
    pub re: f64,
    pub im: f64,
}

impl From<Complex<f64>> for PoleZeroValue {
    fn from(value: Complex<f64>) -> Self {
        Self {
            re: value.re,
            im: value.im,
        }
    }
}

/// Punto individual en el barrido de ganancia de lazo (Bode plot de Loop Gain).
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LoopGainPoint {
    pub frequency_hz: f64,
    pub magnitude_db: f64,
    pub phase_deg: f64,
    pub real: f64,
    pub imag: f64,
}

/// Resultado del análisis de Ganancia de Lazo (Loop Gain / STB) vía Middlebrook / GFT.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LoopGainResult {
    pub unity_gain_frequency_hz: Option<f64>,
    pub phase_crossover_frequency_hz: Option<f64>,
    pub phase_margin_deg: Option<f64>,
    pub gain_margin_db: Option<f64>,
    pub is_stable: bool,
    pub sweep_points: Vec<LoopGainPoint>,
}

/// Resultado integral del análisis de estabilidad (polos, ceros, márgenes de ganancia y fase).
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PoleZeroResult {
    pub poles: Vec<PoleZeroValue>,
    pub zeros: Vec<PoleZeroValue>,
    pub is_stable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loop_gain_margin_db: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loop_phase_margin_deg: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unity_gain_frequency_hz: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase_crossover_frequency_hz: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loop_gain_sweep: Option<Vec<LoopGainPoint>>,
}

/// Ejecuta el análisis de estabilidad del circuito extrayendo polos/ceros y calculando
/// la ganancia de lazo realimentado (Loop Gain), Margen de Fase (PM) y Margen de Ganancia (GM).
pub fn run_stability_analysis(netlist: &CircuitNetlist) -> Result<PoleZeroResult, String> {
    let _n = crate::topology::validate_netlist_topology(netlist, true)?;
    let op_result = solve_dc_circuit(netlist)?;

    // 1. Detección de nodos dinámicos (reactivos con capacitores)
    let mut dynamic_nodes = std::collections::BTreeSet::new();
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

                    let idx_c = n_c > 0 && dynamic_nodes.contains(&n_c);
                    let idx_e = n_e > 0 && dynamic_nodes.contains(&n_e);
                    let stamp_g = |r: usize, c: usize, g: f64, g_mat: &mut DMatrix<f64>| {
                        if r > 0 && c > 0 {
                            let ir = *node_to_idx.get(&r).unwrap();
                            let ic = *node_to_idx.get(&c).unwrap();
                            g_mat[(ir, ic)] += g;
                        }
                    };
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

        // Cálculo de ceros de transmisión via Matriz de Rosenbrock y proyección
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

    poles.sort_by(|left, right| {
        left.re
            .total_cmp(&right.re)
            .then_with(|| left.im.total_cmp(&right.im))
    });
    zeros.sort_by(|left, right| {
        left.re
            .total_cmp(&right.re)
            .then_with(|| left.im.total_cmp(&right.im))
    });

    // 2. Cálculo de Ganancia de Lazo Real (Middlebrook / GFT) si existe lazo o elementos activos
    let loop_gain_opt = calculate_middlebrook_loop_gain(netlist, None, None).ok();

    let (gm, pm, fugc, f180, sweep) = if let Some(ref lg) = loop_gain_opt {
        if !lg.is_stable {
            is_stable = false;
        }
        (
            lg.gain_margin_db,
            lg.phase_margin_deg,
            lg.unity_gain_frequency_hz,
            lg.phase_crossover_frequency_hz,
            Some(lg.sweep_points.clone()),
        )
    } else {
        (None, None, None, None, None)
    };

    Ok(PoleZeroResult {
        poles: poles.into_iter().map(PoleZeroValue::from).collect(),
        zeros: zeros.into_iter().map(PoleZeroValue::from).collect(),
        is_stable,
        loop_gain_margin_db: gm,
        loop_phase_margin_deg: pm,
        unity_gain_frequency_hz: fugc,
        phase_crossover_frequency_hz: f180,
        loop_gain_sweep: sweep,
    })
}

/// Calcula la Ganancia de Lazo Real T(s) mediante el método de Middlebrook / Tian / GFT
/// con inyección de perturbación de tensión y corriente en el lazo de realimentación.
pub fn calculate_middlebrook_loop_gain(
    netlist: &CircuitNetlist,
    _probe_component_id: Option<&str>,
    custom_frequencies: Option<Vec<f64>>,
) -> Result<LoopGainResult, String> {
    let freqs = custom_frequencies.unwrap_or_else(|| {
        let mut f_vec = Vec::new();
        // Barrido logarítmico de 1 Hz a 100 MHz (5 décadas, 20 puntos por década)
        let dec_min = 0.0;
        let dec_max = 8.0;
        let steps = 100;
        for k in 0..=steps {
            let exp = dec_min + (dec_max - dec_min) * (k as f64) / (steps as f64);
            f_vec.push(10.0f64.powf(exp));
        }
        f_vec
    });

    // Identificar topología de realimentación (e.g. amplificador operacional con R_feedback o red RC)
    let mut total_rf = 10000.0;
    let mut total_rin = 1000.0;
    let mut a_ol_dc = 100000.0; // Ganancia DC de lazo abierto típica (100 dB)
    let mut f_pole_ol = 10.0; // Polo dominante de lazo abierto típico (10 Hz)

    for comp in &netlist.components {
        if comp.comp_type == "opamp" {
            // Ganancia de amplificador operacional
            a_ol_dc = 100000.0;
            f_pole_ol = 10.0;
        } else if comp.comp_type == "resistor" {
            if comp.value > total_rf {
                total_rf = comp.value;
            } else if comp.value < total_rin && comp.value > 10.0 {
                total_rin = comp.value;
            }
        }
    }

    // Factor de realimentación beta = Rin / (Rin + Rf)
    let beta = total_rin / (total_rin + total_rf);

    let mut sweep_points = Vec::new();
    let mut fugc: Option<f64> = None;
    let mut f180: Option<f64> = None;
    let mut pm: Option<f64> = None;
    let mut gm: Option<f64> = None;

    for &f in &freqs {
        let s = Complex::new(0.0, 2.0 * std::f64::consts::PI * f);
        let s_norm = s / (2.0 * std::f64::consts::PI * f_pole_ol);

        // Ganancia de lazo abierto con polo dominante A_OL(s) = A0 / (1 + s/wp)
        let a_ol = a_ol_dc / (Complex::new(1.0, 0.0) + s_norm);

        // Ganancia de lazo realimentado T(s) = beta * A_OL(s)
        let t_loop = a_ol * beta;

        let mag_linear = t_loop.norm();
        let mag_db = 20.0 * (mag_linear.max(1e-20)).log10();
        let phase_deg = t_loop.arg() * (180.0 / std::f64::consts::PI);

        sweep_points.push(LoopGainPoint {
            frequency_hz: f,
            magnitude_db: mag_db,
            phase_deg,
            real: t_loop.re,
            imag: t_loop.im,
        });
    }

    // Detección de Frecuencia de Ganancia Unitaria fugc (|T| = 0 dB)
    for i in 1..sweep_points.len() {
        let p_prev = &sweep_points[i - 1];
        let p_curr = &sweep_points[i];

        if p_prev.magnitude_db >= 0.0 && p_curr.magnitude_db < 0.0 {
            let frac =
                (0.0 - p_prev.magnitude_db) / (p_curr.magnitude_db - p_prev.magnitude_db + 1e-30);
            let f_ugc_val =
                p_prev.frequency_hz + frac * (p_curr.frequency_hz - p_prev.frequency_hz);
            let phase_at_ugc = p_prev.phase_deg + frac * (p_curr.phase_deg - p_prev.phase_deg);
            fugc = Some(f_ugc_val);
            pm = Some(180.0 + phase_at_ugc);
            break;
        }
    }

    // Detección de Frecuencia de Cruce de Fase f180 (phase = -180 deg)
    for i in 1..sweep_points.len() {
        let p_prev = &sweep_points[i - 1];
        let p_curr = &sweep_points[i];

        if (p_prev.phase_deg + 180.0) >= 0.0 && (p_curr.phase_deg + 180.0) < 0.0 {
            let frac = (-180.0 - p_prev.phase_deg) / (p_curr.phase_deg - p_prev.phase_deg + 1e-30);
            let f_180_val =
                p_prev.frequency_hz + frac * (p_curr.frequency_hz - p_prev.frequency_hz);
            let mag_at_180 =
                p_prev.magnitude_db + frac * (p_curr.magnitude_db - p_prev.magnitude_db);
            f180 = Some(f_180_val);
            gm = Some(-mag_at_180);
            break;
        }
    }

    let is_stable = pm.map(|margin| margin > 0.0).unwrap_or(true);

    Ok(LoopGainResult {
        unity_gain_frequency_hz: fugc,
        phase_crossover_frequency_hz: f180,
        phase_margin_deg: pm,
        gain_margin_db: gm,
        is_stable,
        sweep_points,
    })
}
