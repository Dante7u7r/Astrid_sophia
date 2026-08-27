use crate::solver::matrix::{ComplexSparseMatrix, SparseMatrix};
use crate::solver::types::CircuitNetlist;
use nalgebra::{DMatrix, DVector};
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

/// Resultado del análisis de Ganancia de Lazo (Loop Gain / STB) vía Tian / Middlebrook.
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

/// Resuelve un sistema lineal disperso complejo con backend optimizado.
fn solve_complex_system(
    matrix: &ComplexSparseMatrix,
    vector_z: &DVector<Complex<f64>>,
) -> Result<DVector<Complex<f64>>, String> {
    let slice: &[Complex<f64>] = vector_z.as_slice();
    let sol_vec = crate::solver::linear_backend::solve_linear_complex(matrix, slice)?;
    Ok(DVector::from_vec(sol_vec))
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
                    let g_val = 1.0 / comp.value.max(1e-12);

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
                "stb_probe" | "probe_stb" => {
                    let n1 = comp.pins[0].parse::<usize>().unwrap();
                    let n2 = comp.pins[1].parse::<usize>().unwrap();
                    let g_val = 1e6;

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

    // 2. Cálculo de Ganancia de Lazo Real (Tian / Middlebrook)
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

/// Calcula la Ganancia de Lazo Real T(s) mediante el método de Tian / Middlebrook
/// con inyección de perturbación de tensión y corriente en el lazo de realimentación.
pub fn calculate_middlebrook_loop_gain(
    netlist: &CircuitNetlist,
    probe_component_id: Option<&str>,
    custom_frequencies: Option<Vec<f64>>,
) -> Result<LoopGainResult, String> {
    let n = crate::topology::validate_netlist_topology(netlist, false)?;
    if n == 0 {
        return Err("El circuito no contiene nodos activos para analizar estabilidad.".to_string());
    }

    // 1. Identificar la sonda de estabilidad (stb_probe) o punto de inyección
    let probe = if let Some(pid) = probe_component_id {
        netlist.components.iter().find(|c| c.id == pid)
    } else {
        netlist
            .components
            .iter()
            .find(|c| c.comp_type == "stb_probe" || c.comp_type == "probe_stb")
    };

    let (node_a, node_b) = if let Some(p) = probe {
        let na = p.pins[0]
            .parse::<usize>()
            .map_err(|e| format!("Pin de entrada inválido en sonda STB: {}", e))?;
        let nb = p.pins[1]
            .parse::<usize>()
            .map_err(|e| format!("Pin de salida inválido en sonda STB: {}", e))?;
        (na, nb)
    } else {
        // Fallback: Detectar OpAmp con lazo de realimentación
        let mut found_pair = None;
        for comp in &netlist.components {
            if comp.comp_type == "opamp" || comp.comp_type == "opamp_ideal" {
                let pin_neg = comp.pins[1].parse::<usize>().unwrap_or(0);
                let pin_out = if comp.pins.len() >= 5 {
                    comp.pins[4].parse::<usize>().unwrap_or(0)
                } else {
                    comp.pins[2].parse::<usize>().unwrap_or(0)
                };
                if pin_neg > 0 && pin_out > 0 && pin_neg != pin_out {
                    found_pair = Some((pin_out, pin_neg));
                    break;
                }
            }
        }
        found_pair.ok_or_else(|| {
            "No se encontró sonda 'stb_probe' ni lazo de realimentación activo en el circuito."
                .to_string()
        })?
    };

    // 2. Frecuencias del barrido logarítmico (10 Hz a 100 MHz por defecto)
    let freqs = custom_frequencies.unwrap_or_else(|| {
        let mut f_vec = Vec::new();
        let dec_min = 1.0; // 10 Hz
        let dec_max = 8.0; // 100 MHz
        let steps = 100;
        for k in 0..=steps {
            let exp = dec_min + (dec_max - dec_min) * (k as f64) / (steps as f64);
            f_vec.push(10.0f64.powf(exp));
        }
        f_vec
    });

    // 3. Obtener punto de operación DC
    let op_result = solve_dc_circuit(netlist)?;
    let (vt, is_temp) =
        crate::solver::engine::devices::get_thermal_parameters(netlist.temperature, None);

    // 4. Precalcular conductancias / parámetros linealizados de dispositivos no lineales
    let mut diode_conductances = HashMap::new();
    for comp in &netlist.components {
        if comp.comp_type == "diode" || comp.comp_type == "led" {
            let n1 = comp.pins[0].parse::<usize>().unwrap_or(0);
            let n2 = comp.pins[1].parse::<usize>().unwrap_or(0);
            let v1 = if n1 > 0 {
                *op_result.node_voltages.get(&n1.to_string()).unwrap_or(&0.0)
            } else {
                0.0
            };
            let v2 = if n2 > 0 {
                *op_result.node_voltages.get(&n2.to_string()).unwrap_or(&0.0)
            } else {
                0.0
            };
            let vd = (v1 - v2).min(0.75);
            let gd = (is_temp / (crate::solver::engine::devices::DIODE_N * vt))
                * (vd / (crate::solver::engine::devices::DIODE_N * vt)).exp();
            diode_conductances.insert(comp.id.clone(), gd);
        }
    }

    // 5. Estructurar matriz MNA para la doble perturbación de Tian
    let v_sources: Vec<&crate::solver::types::ComponentData> = netlist
        .components
        .iter()
        .filter(|c| {
            c.comp_type == "vsource"
                || c.comp_type == "bvoltage"
                || c.comp_type == "vcvs"
                || c.comp_type == "ccvs"
        })
        .collect();
    let num_vs = v_sources.len();
    let mut vsource_map = HashMap::new();
    for (idx, vs) in v_sources.iter().enumerate() {
        vsource_map.insert(vs.id.clone(), idx);
    }

    let base_size = n + num_vs;
    let aux_idx = base_size;
    let total_size = base_size + 1;

    let mut sweep_points = Vec::new();

    for &f_val in &freqs {
        let omega = 2.0 * std::f64::consts::PI * f_val;

        let build_base_matrix = |mat: &mut ComplexSparseMatrix| {
            let stamp_conductance =
                |mat: &mut ComplexSparseMatrix, r: usize, c: usize, g: Complex<f64>| {
                    if r > 0 && c > 0 {
                        mat.add_element(r - 1, c - 1, g);
                    }
                };

            for comp in &netlist.components {
                if comp.comp_type == "stb_probe" || comp.comp_type == "probe_stb" {
                    continue;
                }
                match comp.comp_type.as_str() {
                    "resistor" => {
                        let na = comp.pins[0].parse::<usize>().unwrap_or(0);
                        let nb = comp.pins[1].parse::<usize>().unwrap_or(0);
                        let g = Complex::new(1.0 / comp.value.max(1e-12), 0.0);
                        stamp_conductance(mat, na, na, g);
                        stamp_conductance(mat, nb, nb, g);
                        stamp_conductance(mat, na, nb, -g);
                        stamp_conductance(mat, nb, na, -g);
                    }
                    "capacitor" => {
                        let na = comp.pins[0].parse::<usize>().unwrap_or(0);
                        let nb = comp.pins[1].parse::<usize>().unwrap_or(0);
                        let g = Complex::new(0.0, omega * comp.value.max(0.0));
                        stamp_conductance(mat, na, na, g);
                        stamp_conductance(mat, nb, nb, g);
                        stamp_conductance(mat, na, nb, -g);
                        stamp_conductance(mat, nb, na, -g);
                    }
                    "inductor" => {
                        let na = comp.pins[0].parse::<usize>().unwrap_or(0);
                        let nb = comp.pins[1].parse::<usize>().unwrap_or(0);
                        let g = Complex::new(0.0, -1.0 / (omega * comp.value.max(1e-15)));
                        stamp_conductance(mat, na, na, g);
                        stamp_conductance(mat, nb, nb, g);
                        stamp_conductance(mat, na, nb, -g);
                        stamp_conductance(mat, nb, na, -g);
                    }
                    "opamp" | "opamp_ideal" => {
                        let pin_in_pos = comp.pins[0].parse::<usize>().unwrap_or(0);
                        let pin_in_neg = comp.pins[1].parse::<usize>().unwrap_or(0);
                        let pin_out = if comp.pins.len() >= 5 {
                            comp.pins[4].parse::<usize>().unwrap_or(0)
                        } else {
                            comp.pins[2].parse::<usize>().unwrap_or(0)
                        };

                        let a_ol = comp.opamp_aol.unwrap_or(if comp.value > 0.0 {
                            comp.value
                        } else {
                            1e5
                        });
                        let gbw = comp.opamp_gbw.unwrap_or(1e6);
                        let r_in = comp.opamp_rin.unwrap_or(1e7);
                        let r_out = comp.opamp_rout.unwrap_or(75.0);
                        let g_in = Complex::new(1.0 / r_in.max(1.0), 0.0);
                        let g_out = Complex::new(1.0 / r_out.max(1e-3), 0.0);
                        let g_m_val = a_ol / r_out;

                        let f_p1 = (gbw / a_ol.max(1.0)).max(0.1);
                        let f_p2 = (2.0 * gbw).max(1.0);
                        let pole_factor1 = Complex::new(1.0, f_val / f_p1);
                        let pole_factor2 = Complex::new(1.0, f_val / f_p2);
                        let g_m_opamp =
                            (Complex::new(g_m_val, 0.0) / pole_factor1) / pole_factor2;

                        stamp_conductance(mat, pin_in_pos, pin_in_pos, g_in);
                        stamp_conductance(mat, pin_in_neg, pin_in_neg, g_in);
                        stamp_conductance(mat, pin_in_pos, pin_in_neg, -g_in);
                        stamp_conductance(mat, pin_in_neg, pin_in_pos, -g_in);

                        if pin_out > 0 {
                            stamp_conductance(mat, pin_out, pin_out, g_out);
                            if pin_in_pos > 0 {
                                mat.add_element(pin_out - 1, pin_in_pos - 1, -g_m_opamp);
                            }
                            if pin_in_neg > 0 {
                                mat.add_element(pin_out - 1, pin_in_neg - 1, g_m_opamp);
                            }
                        }
                    }
                    "diode" | "led" => {
                        let na = comp.pins[0].parse::<usize>().unwrap_or(0);
                        let nb = comp.pins[1].parse::<usize>().unwrap_or(0);
                        if let Some(&gd) = diode_conductances.get(&comp.id) {
                            let g = Complex::new(gd, 0.0);
                            stamp_conductance(mat, na, na, g);
                            stamp_conductance(mat, nb, nb, g);
                            stamp_conductance(mat, na, nb, -g);
                            stamp_conductance(mat, nb, na, -g);
                        }
                    }
                    "vsource" | "bvoltage" => {
                        let na = comp.pins[0].parse::<usize>().unwrap_or(0);
                        let nb = comp.pins[1].parse::<usize>().unwrap_or(0);
                        if let Some(&vs_idx) = vsource_map.get(&comp.id) {
                            let col = n + vs_idx;
                            if na > 0 {
                                mat.add_element(na - 1, col, Complex::new(1.0, 0.0));
                                mat.add_element(col, na - 1, Complex::new(1.0, 0.0));
                            }
                            if nb > 0 {
                                mat.add_element(nb - 1, col, Complex::new(-1.0, 0.0));
                                mat.add_element(col, nb - 1, Complex::new(-1.0, 0.0));
                            }
                        }
                    }
                    _ => {}
                }
            }
        };

        // ── Inyección 1: Perturbación de Tensión Serie (V_b - V_a = 1V) ──
        let mut mat_v = ComplexSparseMatrix::new(total_size);
        let mut vec_v = DVector::<Complex<f64>>::zeros(total_size);
        build_base_matrix(&mut mat_v);

        if node_b > 0 {
            mat_v.add_element(node_b - 1, aux_idx, Complex::new(1.0, 0.0));
            mat_v.add_element(aux_idx, node_b - 1, Complex::new(1.0, 0.0));
        }
        if node_a > 0 {
            mat_v.add_element(node_a - 1, aux_idx, Complex::new(-1.0, 0.0));
            mat_v.add_element(aux_idx, node_a - 1, Complex::new(-1.0, 0.0));
        }
        vec_v[aux_idx] = Complex::new(1.0, 0.0);

        let sol_v = solve_complex_system(&mat_v, &vec_v)?;
        let v_a_v = if node_a > 0 {
            sol_v[node_a - 1]
        } else {
            Complex::new(0.0, 0.0)
        };
        let v_b_v = if node_b > 0 {
            sol_v[node_b - 1]
        } else {
            Complex::new(0.0, 0.0)
        };

        let t_v = if v_b_v.norm() > 1e-18 {
            -v_a_v / v_b_v
        } else {
            Complex::new(1e9, 0.0)
        };

        // ── Inyección 2: Perturbación de Corriente Paralela (Iinj = 1A de A hacia B) ──
        let mut mat_i = ComplexSparseMatrix::new(total_size);
        let mut vec_i = DVector::<Complex<f64>>::zeros(total_size);
        build_base_matrix(&mut mat_i);

        if node_b > 0 {
            mat_i.add_element(node_b - 1, aux_idx, Complex::new(1.0, 0.0));
            mat_i.add_element(aux_idx, node_b - 1, Complex::new(1.0, 0.0));
            vec_i[node_b - 1] += Complex::new(1.0, 0.0);
        }
        if node_a > 0 {
            mat_i.add_element(node_a - 1, aux_idx, Complex::new(-1.0, 0.0));
            mat_i.add_element(aux_idx, node_a - 1, Complex::new(-1.0, 0.0));
            vec_i[node_a - 1] -= Complex::new(1.0, 0.0);
        }
        vec_i[aux_idx] = Complex::new(0.0, 0.0);

        let sol_i = solve_complex_system(&mat_i, &vec_i)?;
        let i_probe = sol_i[aux_idx];
        let denom_i = Complex::new(1.0, 0.0) - i_probe;
        let t_i = if denom_i.norm() > 1e-12 {
            i_probe / denom_i
        } else {
            Complex::new(1e9, 0.0)
        };

        // ── Combinación Tian: T = (Tv * Ti - 1) / (Tv + Ti + 2) ──
        let denom = t_v + t_i + Complex::new(2.0, 0.0);
        let t_loop = if denom.norm() > 1e-12 {
            (t_v * t_i - Complex::new(1.0, 0.0)) / denom
        } else {
            t_v
        };

        let mag_linear = t_loop.norm();
        let mag_db = 20.0 * mag_linear.max(1e-20).log10();
        let phase_deg = t_loop.arg() * (180.0 / std::f64::consts::PI);

        sweep_points.push(LoopGainPoint {
            frequency_hz: f_val,
            magnitude_db: mag_db,
            phase_deg,
            real: t_loop.re,
            imag: t_loop.im,
        });
    }

    // 6. Extracción de Frecuencia de Ganancia Unitaria y Margen de Fase
    let mut fugc = None;
    let mut pm = None;
    for i in 1..sweep_points.len() {
        let p_prev = &sweep_points[i - 1];
        let p_curr = &sweep_points[i];
        if (p_prev.magnitude_db >= 0.0 && p_curr.magnitude_db < 0.0)
            || (p_prev.magnitude_db <= 0.0 && p_curr.magnitude_db > 0.0)
        {
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

    // 7. Extracción de Frecuencia de Cruce de Fase y Margen de Ganancia
    let mut f180 = None;
    let mut gm = None;
    for i in 1..sweep_points.len() {
        let p_prev = &sweep_points[i - 1];
        let p_curr = &sweep_points[i];
        if (p_prev.phase_deg + 180.0 >= 0.0 && p_curr.phase_deg + 180.0 < 0.0)
            || (p_prev.phase_deg + 180.0 <= 0.0 && p_curr.phase_deg + 180.0 > 0.0)
        {
            let frac =
                (-180.0 - p_prev.phase_deg) / (p_curr.phase_deg - p_prev.phase_deg + 1e-30);
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

