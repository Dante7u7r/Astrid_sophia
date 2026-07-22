use crate::solver::matrix::SparseMatrix;
use crate::solver::types::CircuitNetlist;
use nalgebra::DVector;
use std::collections::HashMap;

use super::super::devices::{
    evaluate_bsim3_nmos, evaluate_bsim3_pmos, evaluate_bsim4_nmos, evaluate_bsim4_pmos,
    evaluate_opto_receiver, evaluate_pn_junction, get_thermal_parameters, pnjlim,
    solve_diode_junction_voltage,
};
use super::{diagnose_convergence_failure, stamp_linear_components_sparse};

#[allow(clippy::too_many_arguments)]
#[allow(clippy::ptr_arg)]
pub(super) fn solve_homotopy_core(
    netlist: &CircuitNetlist,
    n: usize,
    m: usize,
    vsource_map: &HashMap<String, usize>,
    gmin: f64,
    lambda: f64,
    x_init: &Vec<f64>,
    initial_guess: &Vec<f64>,
) -> Result<DVector<f64>, String> {
    let (vt, is_temp) = get_thermal_parameters(netlist.temperature, None);
    let size = n + m;
    let max_iter = 100;
    let tolerance = 1e-6;

    let mut prev_voltages = initial_guess.clone();
    let mut prev_prev_voltages = initial_guess.clone();
    let mut solution = DVector::<f64>::zeros(size);
    let mut converged = false;

    let mut csc_solver: Option<(
        crate::sparse_csc::SymbolicLU,
        crate::sparse_csc::NumericLUWorkspace,
        crate::sparse_csc::SparseMatrixCSC,
    )> = None;
    let mut parallel_solver: Option<crate::sparse_parallel::SchurParallelSolver> = None;

    let mut last_matrix_a = SparseMatrix::new(size);
    let mut last_vector_z = DVector::<f64>::zeros(size);

    // 1. Armar matrices base lineales estáticas que no cambian en este NR
    let mut matrix_a_linear = SparseMatrix::new(size);
    let mut vector_z_linear = DVector::<f64>::zeros(size);
    stamp_linear_components_sparse(
        netlist,
        n,
        vsource_map,
        &mut matrix_a_linear,
        &mut vector_z_linear,
    )?;

    // Escalar fuentes independientes por el factor lambda de Homotopía
    for idx in 0..m {
        vector_z_linear[n + idx] *= lambda;
    }

    // Inyectar conductancia Gmin artificial a tierra en todos los nodos activos
    if gmin > 0.0 {
        for i in 1..=n {
            matrix_a_linear.add_element(i - 1, i - 1, gmin);
        }
    }

    let mut lambda_backtrack = 1.0;
    let mut prev_max_diff = f64::MAX;

    // 2. Bucle Newton-Raphson
    for _iter in 1..=max_iter {
        let mut matrix_a = matrix_a_linear.clone();
        let mut vector_z = vector_z_linear.clone();

        // Estampar componentes no lineales
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
                let vd_new = v_anode - v_cathode;
                let v_anode_old = if node_anode > 0 {
                    prev_prev_voltages[node_anode]
                } else {
                    0.0
                };
                let v_cathode_old = if node_cathode > 0 {
                    prev_prev_voltages[node_cathode]
                } else {
                    0.0
                };
                let vd_old = v_anode_old - v_cathode_old;
                let vd = pnjlim(vd_new, vd_old, vt, 0.6);
                let (_, id, geq) = solve_diode_junction_voltage(vd, netlist.temperature, comp);
                let ieq = id - geq * vd;

                let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                    if r > 0 && c > 0 {
                        matrix_a.add_element(r - 1, c - 1, g);
                    }
                };
                stamp_conductance(node_anode, node_anode, geq);
                stamp_conductance(node_cathode, node_cathode, geq);
                stamp_conductance(node_anode, node_cathode, -geq);
                stamp_conductance(node_cathode, node_anode, -geq);

                if node_anode > 0 {
                    vector_z[node_anode - 1] -= ieq;
                }
                if node_cathode > 0 {
                    vector_z[node_cathode - 1] += ieq;
                }
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

                let vd_new = v_a - v_k;
                let vd_old = (if node_a > 0 {
                    prev_prev_voltages[node_a]
                } else {
                    0.0
                }) - (if node_k > 0 {
                    prev_prev_voltages[node_k]
                } else {
                    0.0
                });
                let vd = pnjlim(vd_new, vd_old, vt, 0.6);
                let (_, id_led, gd_led) =
                    solve_diode_junction_voltage(vd, netlist.temperature, comp);
                let ieq_led = id_led - gd_led * vd;

                let v_ce = v_c - v_e;
                let (_i_ce, g_md, g_o, i_ce_eq) =
                    evaluate_opto_receiver(vd, gd_led, id_led, v_ce, comp);

                let mut stamp = |r: usize, c: usize, g: f64| {
                    if r > 0 && c > 0 {
                        matrix_a.add_element(r - 1, c - 1, g);
                    }
                };

                stamp(node_a, node_a, gd_led);
                stamp(node_k, node_k, gd_led);
                stamp(node_a, node_k, -gd_led);
                stamp(node_k, node_a, -gd_led);
                if node_a > 0 {
                    vector_z[node_a - 1] -= ieq_led;
                }
                if node_k > 0 {
                    vector_z[node_k - 1] += ieq_led;
                }

                stamp(node_c, node_a, g_md);
                stamp(node_c, node_k, -g_md);
                stamp(node_c, node_c, g_o);
                stamp(node_c, node_e, -g_o);
                stamp(node_e, node_a, -g_md);
                stamp(node_e, node_k, g_md);
                stamp(node_e, node_c, -g_o);
                stamp(node_e, node_e, g_o);
                if node_c > 0 {
                    vector_z[node_c - 1] -= i_ce_eq;
                }
                if node_e > 0 {
                    vector_z[node_e - 1] += i_ce_eq;
                }
            } else if comp.comp_type == "nmos"
                || comp.comp_type == "bsim3nmos"
                || comp.comp_type == "bsim4nmos"
            {
                let node_gate = comp.pins[0].parse::<usize>().unwrap();
                let node_drain = comp.pins[1].parse::<usize>().unwrap();
                let node_source = comp.pins[2].parse::<usize>().unwrap();
                let node_bulk = if comp.pins.len() >= 4 {
                    comp.pins[3].parse::<usize>().unwrap_or(0)
                } else {
                    0
                };

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
                let v_bulk = if node_bulk > 0 {
                    prev_voltages[node_bulk]
                } else {
                    0.0
                };

                let vgs = v_gate - v_source;
                let vds = v_drain - v_source;
                let vbs = v_bulk - v_source;

                let (ids, gm, gds) = if comp.comp_type == "bsim4nmos" {
                    let (ids_val, gm_val, gds_val, _, _) =
                        evaluate_bsim4_nmos(vgs, vds, vbs, comp.value, comp.w, comp.l);
                    (ids_val, gm_val, gds_val)
                } else if comp.comp_type == "bsim3nmos" {
                    evaluate_bsim3_nmos(
                        vgs,
                        vds,
                        vbs,
                        comp.value,
                        comp.w,
                        comp.l,
                        netlist.temperature,
                        Some(comp),
                    )
                } else {
                    let beta = 1e-3;
                    let vth = comp.value;
                    let ids_val = if vgs <= vth {
                        0.0
                    } else if vds < vgs - vth {
                        beta * (2.0 * (vgs - vth) * vds - vds * vds)
                    } else {
                        beta * (vgs - vth).powi(2)
                    };
                    let gm_val = if vgs <= vth {
                        0.0
                    } else if vds < vgs - vth {
                        2.0 * beta * vds
                    } else {
                        2.0 * beta * (vgs - vth)
                    };
                    let gds_val = if vgs > vth && vds < vgs - vth {
                        2.0 * beta * ((vgs - vth) - vds)
                    } else {
                        0.0
                    };
                    (ids_val, gm_val, gds_val)
                };

                let ieq = ids - gm * vgs - gds * vds;

                let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                    if r > 0 && c > 0 {
                        matrix_a.add_element(r - 1, c - 1, g);
                    }
                };
                stamp_conductance(node_drain, node_drain, gds);
                stamp_conductance(node_source, node_source, gds);
                stamp_conductance(node_drain, node_source, -gds);
                stamp_conductance(node_source, node_drain, -gds);

                if node_drain > 0 {
                    stamp_conductance(node_drain, node_gate, gm);
                    stamp_conductance(node_drain, node_source, -gm);
                }
                if node_source > 0 {
                    stamp_conductance(node_source, node_gate, -gm);
                    stamp_conductance(node_source, node_source, gm);
                }

                if node_drain > 0 {
                    vector_z[node_drain - 1] -= ieq;
                }
                if node_source > 0 {
                    vector_z[node_source - 1] += ieq;
                }
            } else if comp.comp_type == "pmos"
                || comp.comp_type == "bsim3pmos"
                || comp.comp_type == "bsim4pmos"
            {
                let node_gate = comp.pins[0].parse::<usize>().unwrap();
                let node_drain = comp.pins[1].parse::<usize>().unwrap();
                let node_source = comp.pins[2].parse::<usize>().unwrap();
                let node_bulk = if comp.pins.len() >= 4 {
                    comp.pins[3].parse::<usize>().unwrap_or(0)
                } else {
                    0
                };

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
                let v_bulk = if node_bulk > 0 {
                    prev_voltages[node_bulk]
                } else {
                    0.0
                };

                let vsg = v_source - v_gate;
                let vsd = v_source - v_drain;
                let vsb = v_source - v_bulk;

                let (isd, gm, gds) = if comp.comp_type == "bsim4pmos" {
                    let (isd_val, gm_val, gds_val, _, _) =
                        evaluate_bsim4_pmos(vsg, vsd, vsb, comp.value, comp.w, comp.l);
                    (isd_val, gm_val, gds_val)
                } else if comp.comp_type == "bsim3pmos" {
                    evaluate_bsim3_pmos(
                        vsg,
                        vsd,
                        vsb,
                        comp.value,
                        comp.w,
                        comp.l,
                        netlist.temperature,
                        Some(comp),
                    )
                } else {
                    let beta = 1e-3;
                    let vth = comp.value.abs();
                    let ids_val = if vsg <= vth {
                        0.0
                    } else if vsd < vsg - vth {
                        beta * (2.0 * (vsg - vth) * vsd - vsd * vsd)
                    } else {
                        beta * (vsg - vth).powi(2)
                    };
                    let gm_val = if vsg <= vth {
                        0.0
                    } else if vsd < vsg - vth {
                        2.0 * beta * vsd
                    } else {
                        2.0 * beta * (vsg - vth)
                    };
                    let gds_val = if vsg <= vth {
                        0.0
                    } else if vsd < vsg - vth {
                        2.0 * beta * ((vsg - vth) - vsd)
                    } else {
                        0.0
                    };
                    (ids_val, gm_val, gds_val)
                };

                let ieq = isd - gm * vsg - gds * vsd;

                let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                    if r > 0 && c > 0 {
                        matrix_a.add_element(r - 1, c - 1, g);
                    }
                };
                stamp_conductance(node_source, node_source, gds);
                stamp_conductance(node_drain, node_drain, gds);
                stamp_conductance(node_source, node_drain, -gds);
                stamp_conductance(node_drain, node_source, -gds);

                if node_drain > 0 {
                    stamp_conductance(node_drain, node_gate, -gm);
                    stamp_conductance(node_drain, node_source, gm);
                }
                if node_source > 0 {
                    stamp_conductance(node_source, node_gate, gm);
                    stamp_conductance(node_source, node_source, -gm);
                }

                if node_source > 0 {
                    vector_z[node_source - 1] -= ieq;
                }
                if node_drain > 0 {
                    vector_z[node_drain - 1] += ieq;
                }
            } else if comp.comp_type == "jfet" || comp.comp_type == "njf" || comp.comp_type == "pjf"
            {
                // JFET Shichman-Hodges
                let node_drain = comp.pins[0].parse::<usize>().unwrap();
                let node_gate = comp.pins[1].parse::<usize>().unwrap();
                let node_source = comp.pins[2].parse::<usize>().unwrap();

                let vd = if node_drain > 0 {
                    prev_voltages[node_drain]
                } else {
                    0.0
                };
                let vg = if node_gate > 0 {
                    prev_voltages[node_gate]
                } else {
                    0.0
                };
                let vs = if node_source > 0 {
                    prev_voltages[node_source]
                } else {
                    0.0
                };

                let is_n = comp.comp_type == "njf";
                let vgs = if is_n { vg - vs } else { vs - vg };
                let vds = if is_n { vd - vs } else { vs - vd };

                let vto = comp.jfet_vto.unwrap_or(-2.0);
                let beta = comp.jfet_beta.unwrap_or(1e-3);
                let lambda = comp.jfet_lambda.unwrap_or(0.0);

                let (ids, gm, gds) = if vgs <= vto {
                    (0.0, 0.0, 0.0)
                } else if vds >= 0.0 {
                    if vds < vgs - vto {
                        let ids_val = beta * vds * (2.0 * (vgs - vto) - vds) * (1.0 + lambda * vds);
                        let gm_val = 2.0 * beta * vds * (1.0 + lambda * vds);
                        let gds_val = beta * (2.0 * (vgs - vto) - 2.0 * vds) * (1.0 + lambda * vds)
                            + beta * vds * (2.0 * (vgs - vto) - vds) * lambda;
                        (ids_val, gm_val, gds_val)
                    } else {
                        let ids_val = beta * (vgs - vto).powi(2) * (1.0 + lambda * vds);
                        let gm_val = 2.0 * beta * (vgs - vto) * (1.0 + lambda * vds);
                        let gds_val = beta * (vgs - vto).powi(2) * lambda;
                        (ids_val, gm_val, gds_val)
                    }
                } else {
                    (0.0, 0.0, 0.0)
                };

                let ids_final = if is_n { ids } else { -ids };
                let gm_final = gm;
                let gds_final = gds;

                if node_drain > 0 {
                    matrix_a.add_element(node_drain - 1, node_drain - 1, gds_final);
                }
                if node_source > 0 {
                    matrix_a.add_element(node_source - 1, node_source - 1, gds_final);
                }
                if node_drain > 0 && node_source > 0 {
                    matrix_a.add_element(node_drain - 1, node_source - 1, -gds_final);
                    matrix_a.add_element(node_source - 1, node_drain - 1, -gds_final);
                }

                if is_n {
                    if node_drain > 0 {
                        matrix_a.add_element(node_drain - 1, node_gate - 1, gm_final);
                        matrix_a.add_element(node_drain - 1, node_source - 1, -gm_final);
                    }
                    if node_source > 0 {
                        matrix_a.add_element(node_source - 1, node_gate - 1, -gm_final);
                        matrix_a.add_element(node_source - 1, node_source - 1, gm_final);
                    }
                } else {
                    if node_drain > 0 {
                        matrix_a.add_element(node_drain - 1, node_source - 1, gm_final);
                        matrix_a.add_element(node_drain - 1, node_gate - 1, -gm_final);
                    }
                    if node_source > 0 {
                        matrix_a.add_element(node_source - 1, node_source - 1, -gm_final);
                        matrix_a.add_element(node_source - 1, node_gate - 1, gm_final);
                    }
                }

                let ieq = ids_final - gm_final * (vg - vs) - gds_final * (vd - vs);
                if node_drain > 0 {
                    vector_z[node_drain - 1] -= ieq;
                }
                if node_source > 0 {
                    vector_z[node_source - 1] += ieq;
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

                let (vbe_new_raw, vbc_new_raw) = if is_npn {
                    (v_base - v_emitter, v_base - v_collector)
                } else {
                    (v_emitter - v_base, v_collector - v_base)
                };

                let v_base_old = if node_base > 0 {
                    prev_prev_voltages[node_base]
                } else {
                    0.0
                };
                let v_collector_old = if node_collector > 0 {
                    prev_prev_voltages[node_collector]
                } else {
                    0.0
                };
                let v_emitter_old = if node_emitter > 0 {
                    prev_prev_voltages[node_emitter]
                } else {
                    0.0
                };

                let (vbe_old_raw, vbc_old_raw) = if is_npn {
                    (v_base_old - v_emitter_old, v_base_old - v_collector_old)
                } else {
                    (v_emitter_old - v_base_old, v_collector_old - v_base_old)
                };

                let bjt_is_val = if comp.bjt_is.is_some() {
                    let (_, scaled_is) = get_thermal_parameters(netlist.temperature, comp.bjt_is);
                    scaled_is
                } else {
                    is_temp
                };

                let beta_f =
                    comp.bjt_bf
                        .unwrap_or(if comp.value <= 1.0 { 100.0 } else { comp.value });
                let beta_r = 1.0;
                let alpha_f = beta_f / (beta_f + 1.0);
                let alpha_r = beta_r / (beta_r + 1.0);

                let vbe_prev_safe = pnjlim(vbe_old_raw, vbe_old_raw, vt, 0.6).min(0.95);
                let vbc_prev_safe = pnjlim(vbc_old_raw, vbc_old_raw, vt, 0.6).min(0.95);

                let exp_be_old = (vbe_prev_safe / vt).exp();
                let exp_bc_old = (vbc_prev_safe / vt).exp();
                let ide_old = bjt_is_val * (exp_be_old - 1.0);
                let idc_old = bjt_is_val * (exp_bc_old - 1.0);

                let ib_prev =
                    (ide_old / (beta_f + 1.0) + idc_old / (beta_r + 1.0)).clamp(-0.01, 0.01);
                let ic_prev = (alpha_f * ide_old - idc_old).clamp(-0.1, 0.1);

                let r_b = comp.bjt_rb.unwrap_or(10.0);
                let r_c = comp.bjt_rc.unwrap_or(2.0);

                let vbe_new = vbe_new_raw - ib_prev * r_b;
                let vbc_new = vbc_new_raw - ic_prev * r_c;
                let vbe_old = vbe_old_raw - ib_prev * r_b;
                let vbc_old = vbc_old_raw - ic_prev * r_c;

                let vbe = pnjlim(vbe_new, vbe_old, vt, 0.6);
                let vbc = pnjlim(vbc_new, vbc_old, vt, 0.6);

                let (ide, gbe, ieq_be) = evaluate_pn_junction(vbe, vt, bjt_is_val);
                let (_idc, gbc, ieq_bc) = evaluate_pn_junction(vbc, vt, bjt_is_val);

                let g_be_b = gbe / (beta_f + 1.0);
                let g_bc_b = gbc / (beta_r + 1.0);
                let ieq_b = ieq_be / (beta_f + 1.0) + ieq_bc / (beta_r + 1.0);

                let ieq_c = alpha_f * ieq_be - ieq_bc;
                let ieq_e = ieq_be - alpha_r * ieq_bc;

                let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                    if r > 0 && c > 0 {
                        matrix_a.add_element(r - 1, c - 1, g);
                    }
                };

                let v_af = comp.bjt_vaf.unwrap_or(if is_npn { 100.0 } else { 50.0 });
                let ic_active = (alpha_f * ide).abs();
                let go = ic_active / v_af;

                stamp_conductance(node_collector, node_collector, go);
                stamp_conductance(node_emitter, node_emitter, go);
                stamp_conductance(node_collector, node_emitter, -go);
                stamp_conductance(node_emitter, node_collector, -go);

                if is_npn {
                    stamp_conductance(node_base, node_base, g_be_b + g_bc_b);
                    stamp_conductance(node_base, node_emitter, -g_be_b);
                    stamp_conductance(node_base, node_collector, -g_bc_b);
                    if node_base > 0 {
                        vector_z[node_base - 1] -= ieq_b;
                    }

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
                        vector_z[node_collector - 1] -= ieq_c;
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
                        vector_z[node_emitter - 1] += ieq_e;
                    }
                } else {
                    stamp_conductance(node_base, node_base, g_be_b + g_bc_b);
                    stamp_conductance(node_base, node_emitter, -g_be_b);
                    stamp_conductance(node_base, node_collector, -g_bc_b);
                    if node_base > 0 {
                        vector_z[node_base - 1] += ieq_b;
                    }

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
                        vector_z[node_collector - 1] += ieq_c;
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
                        vector_z[node_emitter - 1] += ieq_e;
                    }
                }
            }
        }

        // Estampar admitancia homotópica de Punto Fijo y corriente de deformación homotópica
        let g_hom = (1.0 - lambda) * 1.0; // admitancia homotópica artificial de 1 Siemens
        for i in 1..=n {
            matrix_a.add_element(i - 1, i - 1, g_hom);
            vector_z[i - 1] += g_hom * x_init[i];
        }

        last_matrix_a = matrix_a.clone();
        last_vector_z = vector_z.clone();

        // Resolver el sistema MNA lineal para este paso de Newton usando Aritmética Plana CSC Left-Looking o Schur en paralelo (BBDF)
        let is_parallel = size >= 40;
        let mut solved_ok = false;
        let mut new_solution_res = None;

        if is_parallel {
            let solver = parallel_solver.get_or_insert_with(|| {
                crate::sparse_parallel::SchurParallelSolver::analyze(&matrix_a, 0.1)
            });
            if !solver.is_monolithic {
                if let Ok(sol) = solver.solve(&matrix_a, &vector_z) {
                    new_solution_res = Some(sol);
                    solved_ok = true;
                }
            }
        }

        if !solved_ok {
            let (symbolic, workspace, matrix_csc) = csc_solver.get_or_insert_with(|| {
                let sym = crate::sparse_csc::SymbolicLU::analyze(&matrix_a);
                let work = crate::sparse_csc::NumericLUWorkspace::new(&sym);
                let csc = crate::sparse_csc::SparseMatrixCSC::from_sparse(&matrix_a);
                (sym, work, csc)
            });

            matrix_csc.update_from_sparse(&matrix_a);
            new_solution_res = if matrix_csc
                .left_looking_factorize(symbolic, workspace)
                .is_ok()
            {
                symbolic.solve(workspace, &vector_z)
            } else {
                None
            };
        }

        if let Some(new_solution) = new_solution_res {
            // Comprobar si hay NaN, infinitos o divergencia extrema en la solución (> 1e9)
            let max_val = new_solution.iter().map(|x| x.abs()).fold(0.0, f64::max);
            if max_val.is_nan() || max_val.is_infinite() || max_val > 1e9 {
                return Err("Divergencia detectada: voltajes o corrientes fuera de rango (>1e9 V/A o NaN/Inf) en Homotopía".to_string());
            }

            let mut max_diff = 0.0;
            for i in 1..=n {
                let diff = (new_solution[i - 1] - prev_voltages[i]).abs();
                if diff.is_nan() {
                    return Err("Error de convergencia o circuito mal condicionado".to_string());
                }
                if diff > max_diff {
                    max_diff = diff;
                }
            }

            // Amortiguamiento dinámico Newton-Raphson con Backtracking acelerado:
            let base_lambda = if max_diff > 2.0 * vt { 0.35 } else { 1.0 };
            if _iter > 1 && max_diff >= prev_max_diff {
                lambda_backtrack *= 0.5;
            } else if _iter > 1 && max_diff < prev_max_diff {
                lambda_backtrack = f64::min(lambda_backtrack * 2.0, 1.0);
            }
            let lambda_damp = base_lambda * lambda_backtrack;
            prev_max_diff = max_diff;

            prev_prev_voltages = prev_voltages.clone();
            for i in 1..=n {
                prev_voltages[i] =
                    prev_voltages[i] + lambda_damp * (new_solution[i - 1] - prev_voltages[i]);
            }

            for i in n..size {
                solution[i] = new_solution[i];
            }

            for i in 0..n {
                solution[i] = prev_voltages[i + 1];
            }

            if max_diff < tolerance {
                converged = true;
                break;
            }
        } else {
            break;
        }
    }

    if converged {
        Ok(solution)
    } else {
        Err(diagnose_convergence_failure(
            netlist,
            n,
            m,
            vsource_map,
            &solution,
            &last_matrix_a,
            &last_vector_z,
        ))
    }
}
