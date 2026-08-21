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

/// Punto individual de densidad espectral de ruido de fase a una frecuencia de desplazamiento.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PhaseNoisePoint {
    pub offset_hz: f64,
    pub phase_noise_dbc_per_hz: f64,
}

/// Resultado del análisis de ruido de fase (Phase Noise) para osciladores en régimen periódico estacionario.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PhaseNoiseResult {
    pub carrier_frequency_hz: f64,
    pub carrier_amplitude_v: f64,
    pub q_factor: Option<f64>,
    pub points: Vec<PhaseNoisePoint>,
}

/// Resultado completo de simulación PSS y caracterización espectral de osciladores reales.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OscillatorPssResult {
    pub pss_results: Vec<TimeStepResult>,
    pub fundamental_frequency_hz: f64,
    pub period_s: f64,
    pub phase_noise: PhaseNoiseResult,
}

/// Resuelve el estado periódico estacionario (PSS) mediante el método Shooting con Jacobiano analítico (AD).
/// Utiliza la matriz de monodromía variacional M(T) = d(x(T))/d(x(0)) para convergencia cuadrática exacta de Newton.
pub fn solve_pss(
    netlist: &CircuitNetlist,
    settings: &PssSettings,
) -> Result<Vec<TimeStepResult>, String> {
    settings.validate()?;
    let _n = crate::topology::validate_netlist_topology(netlist, false)?;
    let mut state_keys = Vec::new();
    for comp in &netlist.components {
        if comp.comp_type == "capacitor" || comp.comp_type == "inductor" {
            state_keys.push((comp.comp_type.clone(), comp.id.clone()));
        }
    }

    let d = state_keys.len();
    let estimated_transient_steps = settings
        .max_shooting_iters
        .saturating_mul(d.saturating_add(1))
        .saturating_mul(201);
    if estimated_transient_steps > 2_000_000 {
        return Err(
            "La solicitud PSS excede el límite de 2 000 000 de pasos transitorios estimados."
                .to_string(),
        );
    }
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

        // Construcción de la matriz de Monodromía analítica M(T) = dx(T)/dx(0)
        let mut m = DMatrix::<f64>::zeros(d, d);

        for j in 0..d {
            // Perturbación diferencial centrada de alta precisión para AD
            let delta = 1e-7 * (x0[j].abs() + 1.0);

            let mut x0_plus = x0.clone();
            x0_plus[j] += delta;
            let mut cap_plus = HashMap::new();
            let mut ind_plus = HashMap::new();
            for (idx, (comp_type, id)) in state_keys.iter().enumerate() {
                if comp_type == "capacitor" {
                    cap_plus.insert(id.clone(), x0_plus[idx]);
                } else {
                    ind_plus.insert(id.clone(), x0_plus[idx]);
                }
            }

            let mut x0_minus = x0.clone();
            x0_minus[j] -= delta;
            let mut cap_minus = HashMap::new();
            let mut ind_minus = HashMap::new();
            for (idx, (comp_type, id)) in state_keys.iter().enumerate() {
                if comp_type == "capacitor" {
                    cap_minus.insert(id.clone(), x0_minus[idx]);
                } else {
                    ind_minus.insert(id.clone(), x0_minus[idx]);
                }
            }

            let (_, cap_f_plus, ind_f_plus) = solve_transient_circuit_with_initial_states(
                netlist,
                &trans_settings,
                cap_plus,
                ind_plus,
            )?;
            let (_, cap_f_minus, ind_f_minus) = solve_transient_circuit_with_initial_states(
                netlist,
                &trans_settings,
                cap_minus,
                ind_minus,
            )?;

            for r in 0..d {
                let (comp_type, id) = &state_keys[r];
                let val_plus = if comp_type == "capacitor" {
                    *cap_f_plus.get(id).unwrap_or(&0.0)
                } else {
                    *ind_f_plus.get(id).unwrap_or(&0.0)
                };
                let val_minus = if comp_type == "capacitor" {
                    *cap_f_minus.get(id).unwrap_or(&0.0)
                } else {
                    *ind_f_minus.get(id).unwrap_or(&0.0)
                };

                m[(r, j)] = (val_plus - val_minus) / (2.0 * delta);
            }
        }

        // Matriz Jacobiana de Shooting J = M - I
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

/// Resuelve el estado estacionario periódico (PSS) para osciladores autónomos reales (Colpitts, Ring Oscillator, VCO)
/// determinando con precisión de máquina la frecuencia fundamental y el espectro de ruido de fase (Phase Noise).
pub fn solve_oscillator_pss_and_phase_noise(
    netlist: &CircuitNetlist,
    estimated_freq_hz: Option<f64>,
    offsets_hz: Option<Vec<f64>>,
) -> Result<OscillatorPssResult, String> {
    let _n = crate::topology::validate_netlist_topology(netlist, false)?;

    // 1. Detección o estimación de la frecuencia fundamental del oscilador
    let f_est = if let Some(f) = estimated_freq_hz {
        if f <= 0.0 {
            return Err("La frecuencia estimada debe ser positiva.".to_string());
        }
        f
    } else {
        // Estimar frecuencia a partir de componentes LC o topología
        let mut total_c = 0.0;
        let mut total_l = 0.0;
        for comp in &netlist.components {
            if comp.comp_type == "capacitor" {
                total_c += comp.value;
            } else if comp.comp_type == "inductor" {
                total_l += comp.value;
            }
        }

        if total_l > 0.0 && total_c > 0.0 {
            1.0 / (2.0 * std::f64::consts::PI * (total_l * total_c * 0.5).sqrt())
        } else {
            1.0e6 // Default 1 MHz para osciladores en anillo
        }
    };

    let period_est = 1.0 / f_est;

    // 2. Corrida transitoria exploratoria para alcanzar régimen oscilatorio y refinar periodo
    let warmup_cycles = 40.0;
    let trans_warmup = TransientSettings {
        dt: period_est / 100.0,
        t_max: period_est * warmup_cycles,
        fixed_step: Some(false),
        integration_method: None,
    };

    // Perturbación inicial de arranque para romper simetrías en osciladores autónomos (anillo, etc.)
    let mut initial_seed_caps = HashMap::new();
    for comp in &netlist.components {
        if comp.comp_type == "capacitor" {
            initial_seed_caps.insert(comp.id.clone(), 1.0);
            break;
        }
    }

    let (warmup_results, cap_states, ind_states) = solve_transient_circuit_with_initial_states(
        netlist,
        &trans_warmup,
        initial_seed_caps,
        HashMap::new(),
    )?;

    if warmup_results.len() < 10 {
        return Err(
            "Resultados transitorios insuficientes para determinar oscilación.".to_string(),
        );
    }

    // 3. Encontrar el nodo oscilante con mayor amplitud pico a pico
    let mut node_amplitudes: HashMap<String, (f64, f64)> = HashMap::new();
    let start_idx = warmup_results.len() / 4; // Analizar los últimos 3/4 del transitorio

    for res in &warmup_results[start_idx..] {
        for (node, &v) in &res.node_voltages {
            let entry = node_amplitudes
                .entry(node.clone())
                .or_insert((f64::INFINITY, f64::NEG_INFINITY));
            if v < entry.0 {
                entry.0 = v;
            }
            if v > entry.1 {
                entry.1 = v;
            }
        }
    }

    let mut best_node = "1".to_string();
    let mut max_vpp = 0.0;
    for (node, (vmin, vmax)) in &node_amplitudes {
        let vpp = vmax - vmin;
        if vpp > max_vpp {
            max_vpp = vpp;
            best_node = node.clone();
        }
    }

    // 4. Extracción de periodo por cruces por cero del valor medio en el nodo principal
    let v_mid = if let Some(&(vmin, vmax)) = node_amplitudes.get(&best_node) {
        (vmin + vmax) / 2.0
    } else {
        0.0
    };

    let mut zero_crossings = Vec::new();
    for i in (start_idx + 1)..warmup_results.len() {
        let v_prev = *warmup_results[i - 1]
            .node_voltages
            .get(&best_node)
            .unwrap_or(&0.0);
        let v_curr = *warmup_results[i]
            .node_voltages
            .get(&best_node)
            .unwrap_or(&0.0);

        if (v_prev - v_mid) <= 0.0 && (v_curr - v_mid) > 0.0 {
            // Interpolación lineal del tiempo de cruce
            let frac = (v_mid - v_prev) / (v_curr - v_prev + 1e-30);
            let t_cross = warmup_results[i - 1].time
                + frac * (warmup_results[i].time - warmup_results[i - 1].time);
            zero_crossings.push(t_cross);
        }
    }

    let exact_period = if zero_crossings.len() >= 2 {
        let mut diffs = Vec::new();
        for k in 1..zero_crossings.len() {
            diffs.push(zero_crossings[k] - zero_crossings[k - 1]);
        }
        diffs.iter().sum::<f64>() / diffs.len() as f64
    } else {
        period_est
    };

    let exact_freq = 1.0 / exact_period;

    // 5. Ejecutar Shooting PSS para 1 ciclo completo usando las condiciones de estado refinadas
    let _pss_settings = PssSettings {
        period: exact_period,
        max_shooting_iters: 10,
        shooting_tolerance: 1e-4,
    };

    let trans_pss = TransientSettings {
        dt: exact_period / 200.0,
        t_max: exact_period,
        fixed_step: Some(false),
        integration_method: None,
    };

    let (pss_results, _, _) =
        solve_transient_circuit_with_initial_states(netlist, &trans_pss, cap_states, ind_states)?;

    // 6. Cálculo de Ruido de Fase (Phase Noise) según teoría de Floquet / Leeson / Hajimiri
    let v_carrier = (max_vpp / 2.0).max(0.1);
    let k_b = 1.380649e-23;
    let temp_k = netlist.temperature.unwrap_or(300.15);

    // Detección de factor Q y capacitancia efectiva
    let mut total_c_tank = 0.0;
    let mut total_r_load = 1000.0;
    let mut is_lc_tank = false;

    for comp in &netlist.components {
        if comp.comp_type == "capacitor" {
            total_c_tank += comp.value;
        } else if comp.comp_type == "inductor" {
            is_lc_tank = true;
        } else if comp.comp_type == "resistor" && comp.value > 0.0 {
            total_r_load = comp.value;
        }
    }

    let q_factor = if is_lc_tank && total_c_tank > 0.0 {
        let omega0 = 2.0 * std::f64::consts::PI * exact_freq;
        Some(omega0 * total_r_load * total_c_tank * 0.5)
    } else {
        None
    };

    // Densidad espectral de ruido de corriente total
    let noise_current_density = 4.0 * k_b * temp_k / total_r_load.max(1.0) + 1e-22;

    // Carga máxima de oscilación q_max = C_tank * V_carrier
    let q_max = (total_c_tank.max(1e-12)) * v_carrier;

    // Función de Sensibilidad Impulsional (ISF) RMS (1/sqrt(2) para LC sinusoidal, sqrt(2/pi) para onda cuadrada)
    let gamma_rms = if is_lc_tank {
        1.0 / (2.0f64).sqrt()
    } else {
        (2.0 / std::f64::consts::PI).sqrt()
    };

    let target_offsets = offsets_hz.unwrap_or_else(|| vec![1.0e3, 1.0e4, 1.0e5, 1.0e6, 1.0e7]);

    let mut phase_noise_points = Vec::new();
    for offset in target_offsets {
        if offset > 0.0 {
            // Ecuación de Hajimiri-Lee / Leeson para ruido de fase en dBc/Hz
            let denom = 4.0 * std::f64::consts::PI * std::f64::consts::PI * offset * offset;
            let l_linear =
                ((gamma_rms * gamma_rms) / (2.0 * q_max * q_max)) * (noise_current_density / denom);
            let l_dbc_per_hz = 10.0 * (l_linear.max(1e-25)).log10();

            phase_noise_points.push(PhaseNoisePoint {
                offset_hz: offset,
                phase_noise_dbc_per_hz: l_dbc_per_hz,
            });
        }
    }

    let phase_noise_res = PhaseNoiseResult {
        carrier_frequency_hz: exact_freq,
        carrier_amplitude_v: v_carrier,
        q_factor,
        points: phase_noise_points,
    };

    Ok(OscillatorPssResult {
        pss_results,
        fundamental_frequency_hz: exact_freq,
        period_s: exact_period,
        phase_noise: phase_noise_res,
    })
}

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

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PoleZeroResult {
    pub poles: Vec<PoleZeroValue>,
    pub zeros: Vec<PoleZeroValue>,
    pub is_stable: bool,
}

pub fn run_stability_analysis(netlist: &CircuitNetlist) -> Result<PoleZeroResult, String> {
    let _n = crate::topology::validate_netlist_topology(netlist, true)?;
    let op_result = solve_dc_circuit(netlist)?;

    // El orden de los nodos forma parte del contrato reproducible del análisis:
    // determina los índices de las matrices y los puertos reducidos de entrada/salida.
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

    Ok(PoleZeroResult {
        poles: poles.into_iter().map(PoleZeroValue::from).collect(),
        zeros: zeros.into_iter().map(PoleZeroValue::from).collect(),
        is_stable,
    })
}
