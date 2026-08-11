use crate::solver::matrix::{ComplexSparseMatrix, SparseMatrix};
use crate::solver::types::CircuitNetlist;
use nalgebra::DVector;
use num_complex::Complex;
use std::collections::HashMap;

pub(super) struct AcFrequencyContext<'a> {
    pub(super) netlist: &'a CircuitNetlist,
    pub(super) n: usize,
    pub(super) size: usize,
    pub(super) vsource_map: &'a HashMap<String, usize>,
    pub(super) diode_conductances: &'a HashMap<String, f64>,
    pub(super) nmos_parameters: &'a HashMap<String, (f64, f64, f64)>,
    pub(super) pmos_parameters: &'a HashMap<String, (f64, f64, f64)>,
    pub(super) bjt_parameters: &'a HashMap<String, (f64, f64)>,
    pub(super) opamp_gm: &'a HashMap<String, f64>,
    pub(super) opto_parameters: &'a HashMap<String, (f64, f64)>,
}

pub(super) struct AcFrequencyResult {
    pub(super) node_vals: Vec<(String, f64, f64)>,
}

pub(super) fn solve_ac_frequencies(
    context: AcFrequencyContext<'_>,
    frequencies: &[f64],
) -> Result<Vec<AcFrequencyResult>, String> {
    let AcFrequencyContext {
        netlist,
        n,
        size,
        vsource_map,
        diode_conductances,
        nmos_parameters,
        pmos_parameters,
        bjt_parameters,
        opamp_gm,
        opto_parameters,
    } = context;

    let mut csc_solver: Option<(
        crate::sparse_csc::SymbolicLU,
        crate::sparse_csc::ComplexNumericLUWorkspace,
        crate::sparse_csc::ComplexSparseMatrixCSC,
    )> = None;

    let results: Vec<AcFrequencyResult> = frequencies
        .iter()
        .map(|&f_val| {
            let omega = 2.0 * std::f64::consts::PI * f_val;
            let mut matrix_a = ComplexSparseMatrix::new(size);
            let mut vector_z = DVector::<Complex<f64>>::zeros(size);

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
                        let ac_amp = comp.amplitude.unwrap_or(if comp.id == "V1" {
                            comp.value
                        } else {
                            0.0
                        });
                        vector_z[col] = Complex::new(ac_amp, 0.0);
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

                        // Lado LED: conductancia del diodo
                        let gd_led = *diode_conductances.get(&comp.id).unwrap_or(&1e-9);
                        let g_led = Complex::new(gd_led, 0.0);
                        stamp_conductance(&mut matrix_a, node_a, node_a, g_led);
                        stamp_conductance(&mut matrix_a, node_k, node_k, g_led);
                        stamp_conductance(&mut matrix_a, node_a, node_k, -g_led);
                        stamp_conductance(&mut matrix_a, node_k, node_a, -g_led);

                        // Lado receptor: g_md mutua y g_o de salida
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
                    "nmos" | "bsim3nmos" | "bsim4nmos" => {
                        let node_gate = comp.pins[0].parse::<usize>().unwrap();
                        let node_drain = comp.pins[1].parse::<usize>().unwrap();
                        let node_source = comp.pins[2].parse::<usize>().unwrap();

                        let (gm_val, gds_val, gg_val) =
                            *nmos_parameters.get(&comp.id).unwrap_or(&(0.0, 1e-9, 1e-12));
                        let gm = Complex::new(gm_val, 0.0);
                        let gds = Complex::new(gds_val, 0.0);
                        let gg = Complex::new(gg_val, 0.0);

                        stamp_conductance(&mut matrix_a, node_drain, node_drain, gds);
                        stamp_conductance(&mut matrix_a, node_source, node_source, gds + gg);
                        stamp_conductance(&mut matrix_a, node_drain, node_source, -gds);
                        stamp_conductance(&mut matrix_a, node_source, node_drain, -gds);

                        stamp_conductance(&mut matrix_a, node_gate, node_gate, gg);
                        stamp_conductance(&mut matrix_a, node_gate, node_source, -gg);
                        stamp_conductance(&mut matrix_a, node_source, node_gate, -gg);

                        if node_drain > 0 {
                            if node_gate > 0 {
                                matrix_a.add_element(node_drain - 1, node_gate - 1, gm);
                            }
                            if node_source > 0 {
                                matrix_a.add_element(node_drain - 1, node_source - 1, -gm);
                            }
                        }
                        if node_source > 0 {
                            if node_gate > 0 {
                                matrix_a.add_element(node_source - 1, node_gate - 1, -gm);
                            }
                            if node_source > 0 {
                                matrix_a.add_element(node_source - 1, node_source - 1, gm);
                            }
                        }
                    }
                    "pmos" | "bsim3pmos" | "bsim4pmos" => {
                        let node_gate = comp.pins[0].parse::<usize>().unwrap();
                        let node_drain = comp.pins[1].parse::<usize>().unwrap();
                        let node_source = comp.pins[2].parse::<usize>().unwrap();

                        let (gm_val, gds_val, gg_val) =
                            *pmos_parameters.get(&comp.id).unwrap_or(&(0.0, 1e-9, 1e-12));
                        let gm = Complex::new(gm_val, 0.0);
                        let gds = Complex::new(gds_val, 0.0);
                        let gg = Complex::new(gg_val, 0.0);

                        stamp_conductance(&mut matrix_a, node_source, node_source, gds + gg);
                        stamp_conductance(&mut matrix_a, node_drain, node_drain, gds);
                        stamp_conductance(&mut matrix_a, node_source, node_drain, -gds);
                        stamp_conductance(&mut matrix_a, node_drain, node_source, -gds);

                        stamp_conductance(&mut matrix_a, node_gate, node_gate, gg);
                        stamp_conductance(&mut matrix_a, node_gate, node_source, -gg);
                        stamp_conductance(&mut matrix_a, node_source, node_gate, -gg);

                        if node_drain > 0 {
                            if node_source > 0 {
                                matrix_a.add_element(node_drain - 1, node_source - 1, -gm);
                            }
                            if node_gate > 0 {
                                matrix_a.add_element(node_drain - 1, node_gate - 1, gm);
                            }
                        }
                        if node_source > 0 {
                            if node_source > 0 {
                                matrix_a.add_element(node_source - 1, node_source - 1, gm);
                            }
                            if node_gate > 0 {
                                matrix_a.add_element(node_source - 1, node_gate - 1, -gm);
                            }
                        }
                    }
                    "npn" | "pnp" => {
                        let node_base = comp.pins[0].parse::<usize>().unwrap();
                        let node_collector = comp.pins[1].parse::<usize>().unwrap();
                        let node_emitter = comp.pins[2].parse::<usize>().unwrap();

                        let (gbe_val, gbc_val) =
                            *bjt_parameters.get(&comp.id).unwrap_or(&(1e-9, 1e-9));
                        let gbe = Complex::new(gbe_val, 0.0);
                        let gbc = Complex::new(gbc_val, 0.0);

                        let beta_f = if comp.value <= 1.0 { 100.0 } else { comp.value };
                        let beta_r = 1.0;
                        let alpha_f = Complex::new(beta_f / (beta_f + 1.0), 0.0);
                        let alpha_r = Complex::new(beta_r / (beta_r + 1.0), 0.0);

                        let g_be_b = gbe / Complex::new(beta_f + 1.0, 0.0);
                        let g_bc_b = gbc / Complex::new(beta_r + 1.0, 0.0);

                        stamp_conductance(&mut matrix_a, node_base, node_base, g_be_b + g_bc_b);
                        stamp_conductance(&mut matrix_a, node_base, node_emitter, -g_be_b);
                        stamp_conductance(&mut matrix_a, node_base, node_collector, -g_bc_b);

                        if node_collector > 0 {
                            if node_base > 0 {
                                matrix_a.add_element(
                                    node_collector - 1,
                                    node_base - 1,
                                    alpha_f * gbe - gbc,
                                );
                            }
                            if node_emitter > 0 {
                                matrix_a.add_element(
                                    node_collector - 1,
                                    node_emitter - 1,
                                    -alpha_f * gbe,
                                );
                            }
                            matrix_a.add_element(node_collector - 1, node_collector - 1, gbc);
                        }

                        if node_emitter > 0 {
                            if node_base > 0 {
                                matrix_a.add_element(
                                    node_emitter - 1,
                                    node_base - 1,
                                    -(gbe - alpha_r * gbc),
                                );
                            }
                            matrix_a.add_element(node_emitter - 1, node_emitter - 1, gbe);
                            if node_collector > 0 {
                                matrix_a.add_element(
                                    node_emitter - 1,
                                    node_collector - 1,
                                    -alpha_r * gbc,
                                );
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
                    "isource" => {
                        let node_pos = comp.pins[0].parse::<usize>().unwrap();
                        let node_neg = comp.pins[1].parse::<usize>().unwrap();
                        let ac_amp = comp.amplitude.unwrap_or(if comp.id == "I1" {
                            comp.value
                        } else {
                            0.0
                        });
                        let ac_val = Complex::new(ac_amp, 0.0);
                        if node_pos > 0 {
                            vector_z[node_pos - 1] -= ac_val;
                        }
                        if node_neg > 0 {
                            vector_z[node_neg - 1] += ac_val;
                        }
                    }
                    "vcvs" => {
                        let node_pos = comp.pins[0].parse::<usize>().unwrap();
                        let node_neg = comp.pins[1].parse::<usize>().unwrap();
                        let ctrl_pos = comp.pins[2].parse::<usize>().unwrap();
                        let ctrl_neg = comp.pins[3].parse::<usize>().unwrap();
                        let gain = comp.value;
                        let vs_idx = *vsource_map
                            .get(&comp.id)
                            .ok_or_else(|| format!("VCVS id {} no mapeado en AC", comp.id))?;
                        let col = n + vs_idx;
                        if node_pos > 0 {
                            matrix_a.add_element(node_pos - 1, col, Complex::new(1.0, 0.0));
                            matrix_a.add_element(col, node_pos - 1, Complex::new(1.0, 0.0));
                        }
                        if node_neg > 0 {
                            matrix_a.add_element(node_neg - 1, col, Complex::new(-1.0, 0.0));
                            matrix_a.add_element(col, node_neg - 1, Complex::new(-1.0, 0.0));
                        }
                        if ctrl_pos > 0 {
                            matrix_a.add_element(col, ctrl_pos - 1, Complex::new(-gain, 0.0));
                        }
                        if ctrl_neg > 0 {
                            matrix_a.add_element(col, ctrl_neg - 1, Complex::new(gain, 0.0));
                        }
                    }
                    "vccs" => {
                        let node_pos = comp.pins[0].parse::<usize>().unwrap();
                        let node_neg = comp.pins[1].parse::<usize>().unwrap();
                        let ctrl_pos = comp.pins[2].parse::<usize>().unwrap();
                        let ctrl_neg = comp.pins[3].parse::<usize>().unwrap();
                        let g = comp.value;
                        let g_comp = Complex::new(g, 0.0);
                        if node_pos > 0 {
                            if ctrl_pos > 0 {
                                matrix_a.add_element(node_pos - 1, ctrl_pos - 1, g_comp);
                            }
                            if ctrl_neg > 0 {
                                matrix_a.add_element(node_pos - 1, ctrl_neg - 1, -g_comp);
                            }
                        }
                        if node_neg > 0 {
                            if ctrl_pos > 0 {
                                matrix_a.add_element(node_neg - 1, ctrl_pos - 1, -g_comp);
                            }
                            if ctrl_neg > 0 {
                                matrix_a.add_element(node_neg - 1, ctrl_neg - 1, g_comp);
                            }
                        }
                    }
                    "cccs" => {
                        let node_pos = comp.pins[0].parse::<usize>().unwrap();
                        let node_neg = comp.pins[1].parse::<usize>().unwrap();
                        let gain = comp.value;
                        if let Some(ref ctrl_source_id) = comp.controlling_source {
                            if let Some(&ctrl_vs_idx) = vsource_map.get(ctrl_source_id) {
                                let col = n + ctrl_vs_idx;
                                if node_pos > 0 {
                                    matrix_a.add_element(
                                        node_pos - 1,
                                        col,
                                        Complex::new(gain, 0.0),
                                    );
                                }
                                if node_neg > 0 {
                                    matrix_a.add_element(
                                        node_neg - 1,
                                        col,
                                        Complex::new(-gain, 0.0),
                                    );
                                }
                            } else {
                                return Err(format!(
                                    "CCCS id {}: Fuente controladora {} no encontrada en AC.",
                                    comp.id, ctrl_source_id
                                ));
                            }
                        } else {
                            return Err(format!(
                                "CCCS id {}: Falta especificar la fuente controladora en AC.",
                                comp.id
                            ));
                        }
                    }
                    "ccvs" => {
                        let node_pos = comp.pins[0].parse::<usize>().unwrap();
                        let node_neg = comp.pins[1].parse::<usize>().unwrap();
                        let r = comp.value;
                        let vs_idx = *vsource_map
                            .get(&comp.id)
                            .ok_or_else(|| format!("CCVS id {} no mapeado en AC", comp.id))?;
                        let col = n + vs_idx;
                        if node_pos > 0 {
                            matrix_a.add_element(node_pos - 1, col, Complex::new(1.0, 0.0));
                            matrix_a.add_element(col, node_pos - 1, Complex::new(1.0, 0.0));
                        }
                        if node_neg > 0 {
                            matrix_a.add_element(node_neg - 1, col, Complex::new(-1.0, 0.0));
                            matrix_a.add_element(col, node_neg - 1, Complex::new(-1.0, 0.0));
                        }
                        if let Some(ref ctrl_source_id) = comp.controlling_source {
                            if let Some(&ctrl_vs_idx) = vsource_map.get(ctrl_source_id) {
                                let ctrl_col = n + ctrl_vs_idx;
                                matrix_a.add_element(col, ctrl_col, Complex::new(-r, 0.0));
                            } else {
                                return Err(format!(
                                    "CCVS id {}: Fuente controladora {} no encontrada en AC.",
                                    comp.id, ctrl_source_id
                                ));
                            }
                        } else {
                            return Err(format!(
                                "CCVS id {}: Falta especificar la fuente controladora en AC.",
                                comp.id
                            ));
                        }
                    }
                    _ => {}
                }
            }

            // Estampar inductores acoplados en AC
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

            // Resolver el sistema lineal de esta iteración usando Aritmética Plana CSC Compleja Left-Looking (Cero Alocaciones)
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
                .map_err(|_| {
                    format!(
                        "Matriz MNA singular en f = {} Hz. Agrega referencia a Tierra (GND).",
                        f_val
                    )
                })?;

            let solution = symbolic
                .solve_complex(workspace, &vector_z)
                .ok_or_else(|| {
                    format!(
                        "Matriz MNA singular en f = {} Hz. Agrega referencia a Tierra (GND).",
                        f_val
                    )
                })?;

            let mut node_vals = Vec::new();
            for i in 1..=n {
                let val = solution[i - 1];
                let mag_val = val.norm();
                let amplitude_db = if mag_val < 1e-12 {
                    -240.0
                } else {
                    20.0 * mag_val.log10()
                };
                let phase_deg = val.to_polar().1 * (180.0 / std::f64::consts::PI);
                node_vals.push((i.to_string(), amplitude_db, phase_deg));
            }

            Ok(AcFrequencyResult { node_vals })
        })
        .collect::<Result<Vec<AcFrequencyResult>, String>>()?;

    Ok(results)
}
