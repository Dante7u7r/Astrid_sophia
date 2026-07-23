use crate::solver::matrix::{ComplexSparseMatrix, SparseMatrix};
use crate::solver::types::{CircuitNetlist, ComponentData};
use nalgebra::DVector;
use num_complex::Complex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::super::dc::solve_dc_circuit_with_guess;
use super::super::devices::{PHYS_KB, PHYS_Q, PHYS_T};
use super::sweep::AcSweepSettings;

mod operating_point;

use operating_point::{extract_noise_operating_point, NoiseOperatingPoint};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoiseSweepSettings {
    pub output_node: String,
    pub reference_node: String,
    pub ac_settings: AcSweepSettings,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoiseSweepResult {
    pub frequencies: Vec<f64>,
    pub output_noise_density: Vec<f64>, // V / sqrt(Hz)
    pub input_noise_density: Vec<f64>,  // V / sqrt(Hz) equivalente
    pub error_log: Option<String>,
}

pub fn solve_noise_sweep(
    netlist: &CircuitNetlist,
    settings: &NoiseSweepSettings,
) -> Result<NoiseSweepResult, String> {
    // 1. Resolver Punto de Operación DC
    let (op_result, _) =
        solve_dc_circuit_with_guess(netlist, settings.ac_settings.op_guess.as_ref())?;

    // 2. Extraer conductancias y parámetros linealizados
    let n = crate::topology::validate_netlist_topology(netlist, false)?;

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

    let NoiseOperatingPoint {
        diode_conductances,
        diode_currents,
        nmos_parameters,
        pmos_parameters,
        bjt_parameters,
        jfet_parameters,
        opamp_gm,
        opto_parameters,
        opto_currents,
    } = extract_noise_operating_point(netlist, &op_result);

    // 3. Generar vector de frecuencias logarítmicas
    let mut frequencies = Vec::new();
    let mut f = settings.ac_settings.f_start;
    let ratio = 10.0f64.powf(1.0 / settings.ac_settings.points_per_decade as f64);
    while f <= settings.ac_settings.f_end * 1.001 {
        frequencies.push(f);
        f *= ratio;
    }

    let n_out = settings.output_node.parse::<usize>().unwrap_or(0);
    let n_ref = settings.reference_node.parse::<usize>().unwrap_or(0);

    let mut output_noise_density = Vec::new();
    let mut input_noise_density = Vec::new();

    struct NoiseFrequencyResult {
        out_noise: f64,
        in_noise: f64,
    }

    // 4. Bucle en frecuencia
    let mut csc_solver: Option<(
        crate::sparse_csc::SymbolicLU,
        crate::sparse_csc::ComplexNumericLUWorkspace,
        crate::sparse_csc::ComplexSparseMatrixCSC,
    )> = None;

    let results: Vec<NoiseFrequencyResult> = frequencies
        .iter()
        .map(|&f_val| {
            let omega = 2.0 * std::f64::consts::PI * f_val;
            let mut matrix_a = ComplexSparseMatrix::new(size);
            let mut vector_z = DVector::<Complex<f64>>::zeros(size);

            // Estampar componentes AC normales
            let stamp_conductance =
                |matrix: &mut ComplexSparseMatrix, r: usize, c: usize, g: Complex<f64>| {
                    if r > 0 && c > 0 {
                        matrix.add_element(r - 1, c - 1, g);
                    }
                };

            for comp in &netlist.components {
                match comp.comp_type.as_str() {
                    "resistor" => {
                        let node_a = comp.pins[0].parse::<usize>().unwrap();
                        let node_b = comp.pins[1].parse::<usize>().unwrap();
                        let g = Complex::new(1.0 / comp.value, 0.0);
                        stamp_conductance(&mut matrix_a, node_a, node_a, g);
                        stamp_conductance(&mut matrix_a, node_b, node_b, g);
                        stamp_conductance(&mut matrix_a, node_a, node_b, -g);
                        stamp_conductance(&mut matrix_a, node_b, node_a, -g);
                    }
                    "vsource" => {
                        let node_pos = comp.pins[0].parse::<usize>().unwrap();
                        let node_neg = comp.pins[1].parse::<usize>().unwrap();
                        let vs_idx = *vsource_map.get(&comp.id).unwrap();
                        let col = n + vs_idx;

                        if node_pos > 0 {
                            matrix_a.add_element(node_pos - 1, col, Complex::new(1.0, 0.0));
                            matrix_a.add_element(col, node_pos - 1, Complex::new(1.0, 0.0));
                        }
                        if node_neg > 0 {
                            matrix_a.add_element(node_neg - 1, col, Complex::new(-1.0, 0.0));
                            matrix_a.add_element(col, node_neg - 1, Complex::new(-1.0, 0.0));
                        }
                        if comp.id == "V1" {
                            vector_z[col] = Complex::new(1.0, 0.0);
                        }
                    }
                    "capacitor" => {
                        let node_a = comp.pins[0].parse::<usize>().unwrap();
                        let node_b = comp.pins[1].parse::<usize>().unwrap();
                        let g = Complex::new(0.0, omega * comp.value);
                        stamp_conductance(&mut matrix_a, node_a, node_a, g);
                        stamp_conductance(&mut matrix_a, node_b, node_b, g);
                        stamp_conductance(&mut matrix_a, node_a, node_b, -g);
                        stamp_conductance(&mut matrix_a, node_b, node_a, -g);
                    }
                    "inductor" => {
                        let is_coupled = if let Some(ref mutuals) = netlist.mutual_inductances {
                            mutuals
                                .iter()
                                .any(|m| m.l1_id == comp.id || m.l2_id == comp.id)
                        } else {
                            false
                        };
                        if is_coupled {
                            continue;
                        }
                        let node_a = comp.pins[0].parse::<usize>().unwrap();
                        let node_b = comp.pins[1].parse::<usize>().unwrap();
                        let g = Complex::new(0.0, -1.0 / (omega * comp.value));
                        stamp_conductance(&mut matrix_a, node_a, node_a, g);
                        stamp_conductance(&mut matrix_a, node_b, node_b, g);
                        stamp_conductance(&mut matrix_a, node_a, node_b, -g);
                        stamp_conductance(&mut matrix_a, node_b, node_a, -g);
                    }
                    "diode" | "led" => {
                        let node_anode = comp.pins[0].parse::<usize>().unwrap();
                        let node_cathode = comp.pins[1].parse::<usize>().unwrap();
                        let gd = *diode_conductances.get(&comp.id).unwrap_or(&1e-9);
                        let g = Complex::new(gd, 0.0);
                        stamp_conductance(&mut matrix_a, node_anode, node_anode, g);
                        stamp_conductance(&mut matrix_a, node_cathode, node_cathode, g);
                        stamp_conductance(&mut matrix_a, node_anode, node_cathode, -g);
                        stamp_conductance(&mut matrix_a, node_cathode, node_anode, -g);
                    }
                    "opto" => {
                        if comp.pins.len() < 4 {
                            continue;
                        }
                        let node_a = comp.pins[0].parse::<usize>().unwrap();
                        let node_k = comp.pins[1].parse::<usize>().unwrap();
                        let node_c = comp.pins[2].parse::<usize>().unwrap();
                        let node_e = comp.pins[3].parse::<usize>().unwrap();

                        // Lado LED
                        let gd_led = *diode_conductances.get(&comp.id).unwrap_or(&1e-9);
                        let g_led = Complex::new(gd_led, 0.0);
                        stamp_conductance(&mut matrix_a, node_a, node_a, g_led);
                        stamp_conductance(&mut matrix_a, node_k, node_k, g_led);
                        stamp_conductance(&mut matrix_a, node_a, node_k, -g_led);
                        stamp_conductance(&mut matrix_a, node_k, node_a, -g_led);

                        // Lado receptor (g_md mutua + g_o de salida)
                        let (g_md_val, g_o_val) =
                            *opto_parameters.get(&comp.id).unwrap_or(&(0.0, 1e-9));
                        let g_md = Complex::new(g_md_val, 0.0);
                        let g_o = Complex::new(g_o_val, 0.0);
                        stamp_conductance(&mut matrix_a, node_c, node_a, g_md);
                        stamp_conductance(&mut matrix_a, node_c, node_k, -g_md);
                        stamp_conductance(&mut matrix_a, node_c, node_c, g_o);
                        stamp_conductance(&mut matrix_a, node_c, node_e, -g_o);
                        stamp_conductance(&mut matrix_a, node_e, node_a, -g_md);
                        stamp_conductance(&mut matrix_a, node_e, node_k, g_md);
                        stamp_conductance(&mut matrix_a, node_e, node_c, -g_o);
                        stamp_conductance(&mut matrix_a, node_e, node_e, g_o);
                    }
                    "nmos" | "bsim3nmos" | "bsim4nmos" | "pmos" | "bsim3pmos" | "bsim4pmos" => {
                        let is_nmos = comp.comp_type == "nmos"
                            || comp.comp_type == "bsim3nmos"
                            || comp.comp_type == "bsim4nmos";
                        let node_gate = comp.pins[0].parse::<usize>().unwrap();
                        let node_drain = comp.pins[1].parse::<usize>().unwrap();
                        let node_source = comp.pins[2].parse::<usize>().unwrap();

                        let (gm, gds, _, _, gg_val) = if is_nmos {
                            *nmos_parameters
                                .get(&comp.id)
                                .unwrap_or(&(0.0, 1e-5, 0.0, 0.0, 1e-12))
                        } else {
                            *pmos_parameters
                                .get(&comp.id)
                                .unwrap_or(&(0.0, 1e-5, 0.0, 0.0, 1e-12))
                        };

                        let gds_c = Complex::new(gds, 0.0);
                        let gm_c = Complex::new(gm, 0.0);
                        let gg_c = Complex::new(gg_val, 0.0);

                        if is_nmos {
                            stamp_conductance(&mut matrix_a, node_drain, node_drain, gds_c);
                            stamp_conductance(
                                &mut matrix_a,
                                node_source,
                                node_source,
                                gds_c + gg_c,
                            );
                            stamp_conductance(&mut matrix_a, node_drain, node_source, -gds_c);
                            stamp_conductance(&mut matrix_a, node_source, node_drain, -gds_c);

                            stamp_conductance(&mut matrix_a, node_gate, node_gate, gg_c);
                            stamp_conductance(&mut matrix_a, node_gate, node_source, -gg_c);
                            stamp_conductance(&mut matrix_a, node_source, node_gate, -gg_c);

                            if node_drain > 0 {
                                if node_gate > 0 {
                                    matrix_a.add_element(node_drain - 1, node_gate - 1, gm_c);
                                }
                                if node_source > 0 {
                                    matrix_a.add_element(node_drain - 1, node_source - 1, -gm_c);
                                }
                            }
                            if node_source > 0 {
                                if node_gate > 0 {
                                    matrix_a.add_element(node_source - 1, node_gate - 1, -gm_c);
                                }
                                if node_source > 0 {
                                    matrix_a.add_element(node_source - 1, node_source - 1, gm_c);
                                }
                            }
                        } else {
                            stamp_conductance(
                                &mut matrix_a,
                                node_source,
                                node_source,
                                gds_c + gg_c,
                            );
                            stamp_conductance(&mut matrix_a, node_drain, node_drain, gds_c);
                            stamp_conductance(&mut matrix_a, node_source, node_drain, -gds_c);
                            stamp_conductance(&mut matrix_a, node_drain, node_source, -gds_c);

                            stamp_conductance(&mut matrix_a, node_gate, node_gate, gg_c);
                            stamp_conductance(&mut matrix_a, node_gate, node_source, -gg_c);
                            stamp_conductance(&mut matrix_a, node_source, node_gate, -gg_c);

                            if node_drain > 0 {
                                if node_source > 0 {
                                    matrix_a.add_element(node_drain - 1, node_source - 1, -gm_c);
                                }
                                if node_gate > 0 {
                                    matrix_a.add_element(node_drain - 1, node_gate - 1, gm_c);
                                }
                            }
                            if node_source > 0 {
                                if node_source > 0 {
                                    matrix_a.add_element(node_source - 1, node_source - 1, gm_c);
                                }
                                if node_gate > 0 {
                                    matrix_a.add_element(node_source - 1, node_gate - 1, -gm_c);
                                }
                            }
                        }
                    }
                    "npn" | "pnp" => {
                        let node_base = comp.pins[0].parse::<usize>().unwrap();
                        let node_collector = comp.pins[1].parse::<usize>().unwrap();
                        let node_emitter = comp.pins[2].parse::<usize>().unwrap();

                        let (gbe, gbc, _, _) = *bjt_parameters
                            .get(&comp.id)
                            .unwrap_or(&(1e-3, 1e-5, 0.0, 0.0));
                        let beta_f = if comp.value <= 1.0 { 100.0 } else { comp.value };
                        let alpha_f = beta_f / (beta_f + 1.0);
                        let alpha_r = 0.5;

                        let gbe_c = Complex::new(gbe / (beta_f + 1.0), 0.0);
                        let gbc_c = Complex::new(gbc / 1.5, 0.0);

                        stamp_conductance(&mut matrix_a, node_base, node_base, gbe_c + gbc_c);
                        stamp_conductance(&mut matrix_a, node_base, node_emitter, -gbe_c);
                        stamp_conductance(&mut matrix_a, node_base, node_collector, -gbc_c);

                        if node_collector > 0 {
                            if node_base > 0 {
                                matrix_a.add_element(
                                    node_collector - 1,
                                    node_base - 1,
                                    Complex::new(alpha_f * gbe - gbc, 0.0),
                                );
                            }
                            if node_emitter > 0 {
                                matrix_a.add_element(
                                    node_collector - 1,
                                    node_emitter - 1,
                                    Complex::new(-alpha_f * gbe, 0.0),
                                );
                            }
                            matrix_a.add_element(
                                node_collector - 1,
                                node_collector - 1,
                                Complex::new(gbc, 0.0),
                            );
                        }

                        if node_emitter > 0 {
                            if node_base > 0 {
                                matrix_a.add_element(
                                    node_emitter - 1,
                                    node_base - 1,
                                    Complex::new(-(gbe - alpha_r * gbc), 0.0),
                                );
                            }
                            matrix_a.add_element(
                                node_emitter - 1,
                                node_emitter - 1,
                                Complex::new(gbe, 0.0),
                            );
                            if node_collector > 0 {
                                matrix_a.add_element(
                                    node_emitter - 1,
                                    node_collector - 1,
                                    Complex::new(-alpha_r * gbc, 0.0),
                                );
                            }
                        }
                    }
                    "njf" | "pjf" => {
                        let node_drain = comp.pins[0].parse::<usize>().unwrap();
                        let node_gate = comp.pins[1].parse::<usize>().unwrap();
                        let node_source = comp.pins[2].parse::<usize>().unwrap();

                        let (gm, gds, _) =
                            *jfet_parameters.get(&comp.id).unwrap_or(&(0.0, 1e-9, 0.0));

                        let gds_c = Complex::new(gds, 0.0);
                        let gm_c = Complex::new(gm, 0.0);

                        stamp_conductance(&mut matrix_a, node_drain, node_drain, gds_c);
                        stamp_conductance(&mut matrix_a, node_source, node_source, gds_c);
                        stamp_conductance(&mut matrix_a, node_drain, node_source, -gds_c);
                        stamp_conductance(&mut matrix_a, node_source, node_drain, -gds_c);

                        if node_drain > 0 {
                            if node_gate > 0 {
                                matrix_a.add_element(node_drain - 1, node_gate - 1, gm_c);
                            }
                            if node_source > 0 {
                                matrix_a.add_element(node_drain - 1, node_source - 1, -gm_c);
                            }
                        }
                        if node_source > 0 {
                            if node_gate > 0 {
                                matrix_a.add_element(node_source - 1, node_gate - 1, -gm_c);
                            }
                            if node_source > 0 {
                                matrix_a.add_element(node_source - 1, node_source - 1, gm_c);
                            }
                        }
                    }
                    "opamp" => {
                        let pin_in_pos = comp.pins[0].parse::<usize>().unwrap();
                        let pin_in_neg = comp.pins[1].parse::<usize>().unwrap();
                        let pin_out = comp.pins[4].parse::<usize>().unwrap();

                        let r_in = 1e7;
                        let r_out = 100.0;
                        let g_in = Complex::new(1.0 / r_in, 0.0);
                        let g_out = Complex::new(1.0 / r_out, 0.0);
                        let g_m_opamp_val = *opamp_gm.get(&comp.id).unwrap_or(&1000.0);
                        // Aplicar polo dominante a 10 Hz: g_m = g_m_static / (1 + j * f_val / 10.0)
                        let pole_factor = Complex::new(1.0, f_val / 10.0);
                        let g_m_opamp = Complex::new(g_m_opamp_val, 0.0) / pole_factor;

                        stamp_conductance(&mut matrix_a, pin_in_pos, pin_in_pos, g_in);
                        stamp_conductance(&mut matrix_a, pin_in_neg, pin_in_neg, g_in);
                        stamp_conductance(&mut matrix_a, pin_in_pos, pin_in_neg, -g_in);
                        stamp_conductance(&mut matrix_a, pin_in_neg, pin_in_pos, -g_in);

                        if pin_out > 0 {
                            stamp_conductance(&mut matrix_a, pin_out, pin_out, g_out);
                            if pin_in_pos > 0 {
                                matrix_a.add_element(pin_out - 1, pin_in_pos - 1, -g_m_opamp);
                            }
                            if pin_in_neg > 0 {
                                matrix_a.add_element(pin_out - 1, pin_in_neg - 1, g_m_opamp);
                            }
                        }
                    }
                    _ => {}
                }
            }

            // Estampar inductores acoplados en Noise Sweep
            if let Some(ref mutuals) = netlist.mutual_inductances {
                for k_comp in mutuals {
                    if let (Some(l1), Some(l2)) = (
                        netlist.components.iter().find(|c| c.id == k_comp.l1_id),
                        netlist.components.iter().find(|c| c.id == k_comp.l2_id),
                    ) {
                        let node_1pos = l1.pins[0].parse::<usize>().unwrap();
                        let node_1neg = l1.pins[1].parse::<usize>().unwrap();
                        let node_2pos = l2.pins[0].parse::<usize>().unwrap();
                        let node_2neg = l2.pins[1].parse::<usize>().unwrap();

                        let l1_val = l1.value;
                        let l2_val = l2.value;
                        let k = k_comp.k_coeff;

                        let m = k * (l1_val * l2_val).sqrt();
                        let delta = l1_val * l2_val - m * m;

                        if delta.abs() > 1e-30 && omega > 0.0 {
                            let y11 = Complex::new(1e-12, -l2_val / (omega * delta));
                            let y22 = Complex::new(1e-12, -l1_val / (omega * delta));
                            let y12 = Complex::new(0.0, m / (omega * delta));

                            stamp_conductance(&mut matrix_a, node_1pos, node_1pos, y11);
                            stamp_conductance(&mut matrix_a, node_1neg, node_1neg, y11);
                            stamp_conductance(&mut matrix_a, node_1pos, node_1neg, -y11);
                            stamp_conductance(&mut matrix_a, node_1neg, node_1pos, -y11);

                            stamp_conductance(&mut matrix_a, node_2pos, node_2pos, y22);
                            stamp_conductance(&mut matrix_a, node_2neg, node_2neg, y22);
                            stamp_conductance(&mut matrix_a, node_2pos, node_2neg, -y22);
                            stamp_conductance(&mut matrix_a, node_2neg, node_2pos, -y22);

                            // Acoplamiento cruzado
                            stamp_conductance(&mut matrix_a, node_1pos, node_2pos, y12);
                            stamp_conductance(&mut matrix_a, node_1neg, node_2neg, y12);
                            stamp_conductance(&mut matrix_a, node_1pos, node_2neg, -y12);
                            stamp_conductance(&mut matrix_a, node_1neg, node_2pos, -y12);

                            stamp_conductance(&mut matrix_a, node_2pos, node_1pos, y12);
                            stamp_conductance(&mut matrix_a, node_2neg, node_1neg, y12);
                            stamp_conductance(&mut matrix_a, node_2pos, node_1neg, -y12);
                            stamp_conductance(&mut matrix_a, node_2neg, node_1pos, -y12);
                        }
                    }
                }
            }

            // Resolver el sistema lineal usando Aritmética Plana CSC Compleja Left-Looking (Cero Alocaciones)
            let (symbolic, workspace, matrix_csc) = csc_solver.get_or_insert_with(|| {
                let mut real_pattern = SparseMatrix::new(size);
                for r in 0..size {
                    for (&c, &val) in &matrix_a.rows[r] {
                        real_pattern.add_element(r, c, val.norm());
                    }
                }
                let sym = crate::sparse_csc::SymbolicLU::analyze(&real_pattern);
                let work = crate::sparse_csc::ComplexNumericLUWorkspace::new(&sym);
                let csc = crate::sparse_csc::ComplexSparseMatrixCSC::from_sparse(&matrix_a);
                (sym, work, csc)
            });

            matrix_csc.update_from_sparse(&matrix_a);
            matrix_csc
                .left_looking_factorize(symbolic, workspace)
                .map_err(|e| format!("Fallo de factorización en análisis de ruido: {}", e))?;

            let sol_ac = symbolic
                .solve_complex(workspace, &vector_z)
                .unwrap_or_else(|| DVector::zeros(size));

            let v_out_ac = (if n_out > 0 {
                sol_ac[n_out - 1]
            } else {
                Complex::new(0.0, 0.0)
            }) - (if n_ref > 0 {
                sol_ac[n_ref - 1]
            } else {
                Complex::new(0.0, 0.0)
            });
            let ac_gain = v_out_ac.norm().max(1e-12);

            // 6. Sumar todas las fuentes de ruido estocásticas incorreladas
            let mut total_output_noise_sq = 0.0;

            for comp in &netlist.components {
                let (node_a, node_b, s_i) = match comp.comp_type.as_str() {
                    "resistor" => {
                        let n_a = comp.pins[0].parse::<usize>().unwrap();
                        let n_b = comp.pins[1].parse::<usize>().unwrap();
                        let s_val = 4.0 * PHYS_KB * PHYS_T / comp.value;
                        (n_a, n_b, s_val)
                    }
                    "diode" | "led" => {
                        let n_a = comp.pins[0].parse::<usize>().unwrap();
                        let n_b = comp.pins[1].parse::<usize>().unwrap();
                        let id = *diode_currents.get(&comp.id).unwrap_or(&0.0);
                        let s_val = 2.0 * PHYS_Q * id.abs() + (1e-14 * id.abs()) / f_val;
                        (n_a, n_b, s_val)
                    }
                    "opto" => {
                        // Ruido shot del LED interno (A-K) + ruido shot del fototransistor (C-E)
                        if comp.pins.len() < 4 {
                            (0, 0, 0.0)
                        } else {
                            let n_a = comp.pins[0].parse::<usize>().unwrap();
                            let n_k = comp.pins[1].parse::<usize>().unwrap();
                            let n_c = comp.pins[2].parse::<usize>().unwrap();
                            let n_e = comp.pins[3].parse::<usize>().unwrap();
                            let (i_led, i_ce) = *opto_currents.get(&comp.id).unwrap_or(&(0.0, 0.0));

                            // Ruido shot del LED (A-K): S = 2*q*|I_led| + flicker 1/f
                            let s_led = 2.0 * PHYS_Q * i_led.abs() + (1e-14 * i_led.abs()) / f_val;
                            if s_led > 0.0 && (n_a > 0 || n_k > 0) {
                                let mut z_led = DVector::<Complex<f64>>::zeros(size);
                                if n_a > 0 {
                                    z_led[n_a - 1] += Complex::new(1.0, 0.0);
                                }
                                if n_k > 0 {
                                    z_led[n_k - 1] -= Complex::new(1.0, 0.0);
                                }
                                let v_led_tf = symbolic
                                    .solve_complex(workspace, &z_led)
                                    .unwrap_or_else(|| DVector::zeros(size));
                                let v_out_led = (if n_out > 0 {
                                    v_led_tf[n_out - 1]
                                } else {
                                    Complex::new(0.0, 0.0)
                                }) - (if n_ref > 0 {
                                    v_led_tf[n_ref - 1]
                                } else {
                                    Complex::new(0.0, 0.0)
                                });
                                total_output_noise_sq += s_led * v_out_led.norm_sqr();
                            }

                            // Ruido shot del fototransistor (C-E): S = 2*q*|I_ce|
                            let s_ce = 2.0 * PHYS_Q * i_ce.abs();
                            if s_ce > 0.0 && (n_c > 0 || n_e > 0) {
                                let mut z_ce = DVector::<Complex<f64>>::zeros(size);
                                if n_c > 0 {
                                    z_ce[n_c - 1] += Complex::new(1.0, 0.0);
                                }
                                if n_e > 0 {
                                    z_ce[n_e - 1] -= Complex::new(1.0, 0.0);
                                }
                                let v_ce_tf = symbolic
                                    .solve_complex(workspace, &z_ce)
                                    .unwrap_or_else(|| DVector::zeros(size));
                                let v_out_ce = (if n_out > 0 {
                                    v_ce_tf[n_out - 1]
                                } else {
                                    Complex::new(0.0, 0.0)
                                }) - (if n_ref > 0 {
                                    v_ce_tf[n_ref - 1]
                                } else {
                                    Complex::new(0.0, 0.0)
                                });
                                total_output_noise_sq += s_ce * v_out_ce.norm_sqr();
                            }

                            (0, 0, 0.0)
                        }
                    }
                    "nmos" | "bsim3nmos" | "bsim4nmos" | "pmos" | "bsim3pmos" | "bsim4pmos" => {
                        let is_nmos = comp.comp_type == "nmos"
                            || comp.comp_type == "bsim3nmos"
                            || comp.comp_type == "bsim4nmos";
                        let n_g = comp.pins[0].parse::<usize>().unwrap();
                        let n_d = comp.pins[1].parse::<usize>().unwrap();
                        let n_s = comp.pins[2].parse::<usize>().unwrap();

                        let (gm, _, ids, igs, _): (f64, f64, f64, f64, f64) = if is_nmos {
                            *nmos_parameters
                                .get(&comp.id)
                                .unwrap_or(&(0.0, 1e-5, 0.0, 0.0, 1e-12))
                        } else {
                            *pmos_parameters
                                .get(&comp.id)
                                .unwrap_or(&(0.0, 1e-5, 0.0, 0.0, 1e-12))
                        };

                        let w = comp.w.unwrap_or(10.0e-6);
                        let l = comp.l.unwrap_or(0.18e-6);
                        let c_ox = 15e-12 / (10.0e-6 * 0.18e-6);
                        let s_flicker = (1e-13 * ids.abs()) / (f_val * w * l * c_ox);
                        let s_val_channel = (8.0 / 3.0) * PHYS_KB * PHYS_T * gm + s_flicker;

                        // Channel noise contribution
                        if s_val_channel > 0.0 && (n_d > 0 || n_s > 0) {
                            let mut z_chan = DVector::<Complex<f64>>::zeros(size);
                            if n_d > 0 {
                                z_chan[n_d - 1] += Complex::new(1.0, 0.0);
                            }
                            if n_s > 0 {
                                z_chan[n_s - 1] -= Complex::new(1.0, 0.0);
                            }
                            let v_chan_tf = symbolic
                                .solve_complex(workspace, &z_chan)
                                .unwrap_or_else(|| DVector::zeros(size));
                            let v_out_chan = (if n_out > 0 {
                                v_chan_tf[n_out - 1]
                            } else {
                                Complex::new(0.0, 0.0)
                            }) - (if n_ref > 0 {
                                v_chan_tf[n_ref - 1]
                            } else {
                                Complex::new(0.0, 0.0)
                            });
                            total_output_noise_sq += s_val_channel * v_out_chan.norm_sqr();
                        }

                        // Gate leakage tunneling shot noise contribution (S_ig = 2 * q * Ig)
                        let s_val_gate = 2.0 * PHYS_Q * igs.abs();
                        if s_val_gate > 0.0 && (n_g > 0 || n_s > 0) {
                            let mut z_gate = DVector::<Complex<f64>>::zeros(size);
                            if n_g > 0 {
                                z_gate[n_g - 1] += Complex::new(1.0, 0.0);
                            }
                            if n_s > 0 {
                                z_gate[n_s - 1] -= Complex::new(1.0, 0.0);
                            }
                            let v_gate_tf = symbolic
                                .solve_complex(workspace, &z_gate)
                                .unwrap_or_else(|| DVector::zeros(size));
                            let v_out_gate = (if n_out > 0 {
                                v_gate_tf[n_out - 1]
                            } else {
                                Complex::new(0.0, 0.0)
                            }) - (if n_ref > 0 {
                                v_gate_tf[n_ref - 1]
                            } else {
                                Complex::new(0.0, 0.0)
                            });
                            total_output_noise_sq += s_val_gate * v_out_gate.norm_sqr();
                        }

                        (0, 0, 0.0)
                    }
                    "npn" | "pnp" => {
                        let n_b = comp.pins[0].parse::<usize>().unwrap();
                        let n_c = comp.pins[1].parse::<usize>().unwrap();
                        let n_e = comp.pins[2].parse::<usize>().unwrap();

                        let (_, _, ib, ic) = *bjt_parameters
                            .get(&comp.id)
                            .unwrap_or(&(1e-3, 1e-5, 0.0, 0.0));

                        let s_ib = 2.0 * PHYS_Q * ib.abs() + (1e-14 * ib.abs()) / f_val;
                        let s_ic = 2.0 * PHYS_Q * ic.abs();

                        // Base contribution
                        let mut z_b = DVector::<Complex<f64>>::zeros(size);
                        if n_b > 0 {
                            z_b[n_b - 1] += Complex::new(1.0, 0.0);
                        }
                        if n_e > 0 {
                            z_b[n_e - 1] -= Complex::new(1.0, 0.0);
                        }
                        let v_b_tf = symbolic
                            .solve_complex(workspace, &z_b)
                            .unwrap_or_else(|| DVector::zeros(size));
                        let v_out_b = (if n_out > 0 {
                            v_b_tf[n_out - 1]
                        } else {
                            Complex::new(0.0, 0.0)
                        }) - (if n_ref > 0 {
                            v_b_tf[n_ref - 1]
                        } else {
                            Complex::new(0.0, 0.0)
                        });
                        total_output_noise_sq += s_ib * v_out_b.norm_sqr();

                        // Collector contribution
                        let mut z_c = DVector::<Complex<f64>>::zeros(size);
                        if n_c > 0 {
                            z_c[n_c - 1] += Complex::new(1.0, 0.0);
                        }
                        if n_e > 0 {
                            z_c[n_e - 1] -= Complex::new(1.0, 0.0);
                        }
                        let v_c_tf = symbolic
                            .solve_complex(workspace, &z_c)
                            .unwrap_or_else(|| DVector::zeros(size));
                        let v_out_c = (if n_out > 0 {
                            v_c_tf[n_out - 1]
                        } else {
                            Complex::new(0.0, 0.0)
                        }) - (if n_ref > 0 {
                            v_c_tf[n_ref - 1]
                        } else {
                            Complex::new(0.0, 0.0)
                        });
                        total_output_noise_sq += s_ic * v_out_c.norm_sqr();

                        (0, 0, 0.0)
                    }
                    _ => (0, 0, 0.0),
                };

                if s_i > 0.0 && (node_a > 0 || node_b > 0) {
                    let mut z_unit = DVector::<Complex<f64>>::zeros(size);
                    if node_a > 0 {
                        z_unit[node_a - 1] += Complex::new(1.0, 0.0);
                    }
                    if node_b > 0 {
                        z_unit[node_b - 1] -= Complex::new(1.0, 0.0);
                    }

                    let v_tf = symbolic
                        .solve_complex(workspace, &z_unit)
                        .unwrap_or_else(|| DVector::zeros(size));
                    let v_out_tf = (if n_out > 0 {
                        v_tf[n_out - 1]
                    } else {
                        Complex::new(0.0, 0.0)
                    }) - (if n_ref > 0 {
                        v_tf[n_ref - 1]
                    } else {
                        Complex::new(0.0, 0.0)
                    });

                    total_output_noise_sq += s_i * v_out_tf.norm_sqr();
                }
            }

            let out_noise = total_output_noise_sq.sqrt();
            let in_noise = out_noise / ac_gain;

            Ok(NoiseFrequencyResult {
                out_noise,
                in_noise,
            })
        })
        .collect::<Result<Vec<NoiseFrequencyResult>, String>>()?;

    for res in results {
        output_noise_density.push(res.out_noise);
        input_noise_density.push(res.in_noise);
    }

    Ok(NoiseSweepResult {
        frequencies,
        output_noise_density,
        input_noise_density,
        error_log: None,
    })
}
