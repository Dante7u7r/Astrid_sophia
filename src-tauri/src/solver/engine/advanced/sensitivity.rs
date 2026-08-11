use crate::solver::matrix::{SparseLU, SparseMatrix};
use crate::solver::types::{CircuitNetlist, ComponentData};
use nalgebra::{DMatrix, DVector};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::super::dc::{solve_dc_circuit, stamp_linear_components};
use super::super::devices::{
    evaluate_opto_receiver, get_thermal_parameters, solve_diode_junction_voltage,
};

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
