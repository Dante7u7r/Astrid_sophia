use crate::solver::matrix::SparseMatrix;
use crate::solver::types::CircuitNetlist;
use nalgebra::DVector;
use std::collections::HashMap;

use super::super::devices::{
    evaluate_bsim3_nmos, evaluate_bsim3_pmos, evaluate_bsim4_nmos, evaluate_bsim4_pmos,
    evaluate_expression_ad, evaluate_opto_receiver, evaluate_pn_junction, get_thermal_parameters,
    pnjlim, solve_diode_junction_voltage, ExprAST,
};
use super::{
    diagnose_convergence_failure, multiply_sparse_matrix_vector, stamp_linear_components_sparse,
};

// CORES MATEMÁTICOS AVANZADOS: CORE DE NEWTON-RAPHSON CON AMORTIGUAMIENTO Y GMIN DINÁMICO (Fases 14 y 15)
#[allow(clippy::too_many_arguments)]
#[allow(clippy::ptr_arg)]
pub fn solve_newton_raphson_core(
    netlist: &CircuitNetlist,
    n: usize,
    m: usize,
    vsource_map: &HashMap<String, usize>,
    gmin: f64,
    alpha: f64,
    initial_guess: &Vec<f64>,
    pta_params: Option<(f64, f64, &DVector<f64>)>,
    switch_frozen_states: &HashMap<String, bool>,
) -> Result<DVector<f64>, String> {
    let (vt, is_temp) = get_thermal_parameters(netlist.temperature, None);
    let size = n + m;
    let max_iter = 100;
    let tolerance = 1e-6;

    let mut prev_voltages = initial_guess.clone();
    let mut solution = DVector::<f64>::zeros(size);
    if let Some((_, _, prev_sol)) = pta_params {
        for i in 1..=n {
            prev_voltages[i] = prev_sol[i - 1];
        }
        solution = prev_sol.clone();
    }
    let mut prev_prev_voltages = prev_voltages.clone();
    let mut converged = false;

    let mut csc_solver: Option<(
        crate::sparse_csc::SymbolicLU,
        crate::sparse_csc::NumericLUWorkspace,
        crate::sparse_csc::SparseMatrixCSC,
    )> = None;
    let mut parallel_solver: Option<crate::sparse_parallel::SchurParallelSolver> = None;

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

    // Escalar fuentes independientes por el factor alpha de Source Stepping
    for idx in 0..m {
        vector_z_linear[n + idx] *= alpha;
    }

    // Inyectar conductancia Gmin artificial a tierra en todos los nodos activos para evitar singularidades
    if gmin > 0.0 {
        for i in 1..=n {
            matrix_a_linear.add_element(i - 1, i - 1, gmin);
        }
    }

    // Inyectar elementos de Pseudo-Transient Analysis (PTA) si están activos
    if let Some((g_pseudo, r_pseudo, prev_sol)) = pta_params {
        for i in 1..=n {
            matrix_a_linear.add_element(i - 1, i - 1, g_pseudo);
            vector_z_linear[i - 1] += g_pseudo * prev_sol[i - 1];
        }
        for vs_idx in 0..m {
            matrix_a_linear.add_element(n + vs_idx, n + vs_idx, r_pseudo);
            vector_z_linear[n + vs_idx] += r_pseudo * prev_sol[n + vs_idx];
        }
    }

    // Caché de ASTs para B-sources
    let mut ast_cache: HashMap<String, ExprAST> = HashMap::new();

    // Clausura para estampar los componentes no lineales a partir de cualquier estimación de tensiones y corrientes
    // NOTA: FnMut porque captura ast_cache por &mut para el caché de ASTs
    let mut stamp_at = |prev_voltages: &Vec<f64>,
                        prev_prev_voltages: &Vec<f64>,
                        solution: &DVector<f64>|
     -> Result<(SparseMatrix, DVector<f64>), String> {
        let mut matrix_a = matrix_a_linear.clone();
        let mut vector_z = vector_z_linear.clone();

        // Estampar cada componente no lineal usando aproximación lineal de primer orden de Taylor
        for comp in &netlist.components {
            if comp.comp_type == "diode" || comp.comp_type == "led" {
                let node_anode = comp.pins[0].parse::<usize>().unwrap();
                let node_cathode = comp.pins[1].parse::<usize>().unwrap();

                // Obtener voltajes previos de los nodos correspondientes
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

                // Damping logarítmico suave (pnjlim) para evitar overflow exponencial (Upgrade 4)
                let vd = pnjlim(vd_new, vd_old, vt, 0.6);

                let (_, id, geq) = solve_diode_junction_voltage(vd, netlist.temperature, comp);

                // Corriente equivalente: Ieq = Id - geq * vd
                let ieq = id - geq * vd;

                // Estampar conductancia equivalente geq (igual que una resistencia)
                let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                    if r > 0 && c > 0 {
                        matrix_a.add_element(r - 1, c - 1, g);
                    }
                };

                stamp_conductance(node_anode, node_anode, geq);
                stamp_conductance(node_cathode, node_cathode, geq);
                stamp_conductance(node_anode, node_cathode, -geq);
                stamp_conductance(node_cathode, node_anode, -geq);

                // Estampar fuente de corriente equivalente ieq (fluye de Anode a Cathode)
                // Restar de z del ánodo, sumar a z del cátodo
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

                // Lado emisor (LED interno) con damping pnjlim
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

                // Lado receptor (fototransistor)
                let v_ce = v_c - v_e;
                let (_i_ce, g_md, g_o, i_ce_eq) =
                    evaluate_opto_receiver(vd, gd_led, id_led, v_ce, comp);

                let mut stamp = |r: usize, c: usize, g: f64| {
                    if r > 0 && c > 0 {
                        matrix_a.add_element(r - 1, c - 1, g);
                    }
                };

                // Estampar lado LED (igual que un diodo)
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

                // Estampar lado receptor (fototransistor): fuente VCCS no lineal
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
            } else if comp.comp_type == "verilog_a" {
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

                let vgs = v_gate - v_source;
                let vds = v_drain - v_source;

                let vgs_dual = crate::dual3::Dual3::new(vgs, 0);
                let vds_dual = crate::dual3::Dual3::new(vds, 1);
                let vbs_dual = crate::dual3::Dual3::new(0.0, 2);

                if let Some(ref eqs) = comp.va_equations {
                    for (_from, _to, expr_str) in eqs {
                        if let Ok(ast) = crate::parser::parse_va_expression(expr_str) {
                            let ports = [vgs_dual, vds_dual, vbs_dual];

                            let mut va_params = HashMap::new();
                            va_params.insert("vth0".to_string(), 0.35);
                            va_params.insert("beta".to_string(), 0.02);
                            va_params.insert("lambda".to_string(), 0.02);

                            if let Ok(i_dual) = ast.evaluate(&va_params, &ports) {
                                let ids = i_dual.val;
                                let gm = i_dual.deriv[0];
                                let gds = i_dual.deriv[1];

                                let ieq = ids - gm * vgs - gds * vds;

                                let mut stamp = |r: usize, c: usize, val: f64| {
                                    if r > 0 && c > 0 {
                                        matrix_a.add_element(r - 1, c - 1, val);
                                    }
                                };

                                stamp(node_drain, node_drain, gds);
                                stamp(node_drain, node_gate, gm);
                                stamp(node_drain, node_source, -(gds + gm));

                                stamp(node_source, node_drain, -gds);
                                stamp(node_source, node_gate, -gm);
                                stamp(node_source, node_source, gds + gm);

                                if node_drain > 0 {
                                    vector_z[node_drain - 1] -= ieq;
                                }
                                if node_source > 0 {
                                    vector_z[node_source - 1] += ieq;
                                }
                            }
                        }
                    }
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

                // Obtener voltajes previos
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
                let mut vds = v_drain - v_source;
                if vds < 0.0 {
                    vds = 0.0;
                }
                let vbs = v_bulk - v_source;

                let vth = comp.value; // Tensión de umbral
                let kn = 0.02; // transconductancia 20 mA/V^2

                // Ecuaciones Shichman-Hodges y derivadas para linealización Taylor
                let (ids, gm, gds, igs, gg) = if comp.comp_type == "bsim4nmos" {
                    evaluate_bsim4_nmos(vgs, vds, vbs, comp.value, comp.w, comp.l)
                } else if comp.comp_type == "bsim3nmos" {
                    let (ids_v, gm_v, gds_v) = evaluate_bsim3_nmos(
                        vgs,
                        vds,
                        vbs,
                        comp.value,
                        comp.w,
                        comp.l,
                        None,
                        Some(comp),
                    );
                    (ids_v, gm_v, gds_v, 0.0, 1e-12)
                } else if vgs <= vth {
                    // Corte
                    (0.0, 0.0, 1e-9, 0.0, 1e-12)
                } else if vds < vgs - vth {
                    // Lineal (Triodo)
                    let ids_val = kn * (2.0 * (vgs - vth) * vds - vds * vds);
                    let gm_val = 2.0 * kn * vds;
                    let gds_val = 2.0 * kn * (vgs - vth - vds);
                    (ids_val, gm_val, gds_val.max(1e-9), 0.0, 1e-12)
                } else {
                    // Saturación
                    let ids_val = kn * (vgs - vth) * (vgs - vth);
                    let gm_val = 2.0 * kn * (vgs - vth);
                    let gds_val = 1e-5;
                    (ids_val, gm_val, gds_val, 0.0, 1e-12)
                };

                let ieq = ids - gm * vgs - gds * vds;
                let ieq_g = igs - gg * vgs;

                // Estampar conductancias de canal gds entre Drain y Source
                macro_rules! stamp_conductance {
                    ($r:expr, $c:expr, $g:expr) => {{
                        let r_val = $r;
                        let c_val = $c;
                        if r_val > 0 && c_val > 0 {
                            matrix_a.add_element(r_val - 1, c_val - 1, $g);
                        }
                    }};
                }
                stamp_conductance!(node_drain, node_drain, gds);
                stamp_conductance!(node_source, node_source, gds);
                stamp_conductance!(node_drain, node_source, -gds);
                stamp_conductance!(node_source, node_drain, -gds);

                // Estampar transconductancia gm dependiente de Vg y Vs
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

                // Estampar conductancia de fugas de compuerta gg entre Gate y Source
                if gg.abs() > 1e-12 {
                    stamp_conductance!(node_gate, node_gate, gg);
                    stamp_conductance!(node_source, node_source, gg);
                    stamp_conductance!(node_gate, node_source, -gg);
                    stamp_conductance!(node_source, node_gate, -gg);
                }

                // Estampar corriente equivalente ieq (D->S: entra a S, sale de D)
                if node_drain > 0 {
                    vector_z[node_drain - 1] -= ieq;
                }
                if node_source > 0 {
                    vector_z[node_source - 1] += ieq;
                }

                // Estampar corriente equivalente de compuerta ieq_g (G->S: entra a S, sale de G)
                if igs.abs() > 1e-15 {
                    if node_gate > 0 {
                        vector_z[node_gate - 1] -= ieq_g;
                    }
                    if node_source > 0 {
                        vector_z[node_source - 1] += ieq_g;
                    }
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

                // Obtener voltajes previos
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
                let mut vsd = v_source - v_drain;
                if vsd < 0.0 {
                    vsd = 0.0;
                }
                let vsb = v_source - v_bulk;

                let vth = if comp.value == 0.0 { -1.5 } else { comp.value };
                let vth_abs = -vth;
                let kp = 0.02;

                let (isd, gm_sd, gds_cond, igs, gg) = if comp.comp_type == "bsim4pmos" {
                    evaluate_bsim4_pmos(vsg, vsd, vsb, comp.value, comp.w, comp.l)
                } else if comp.comp_type == "bsim3pmos" {
                    let (isd_v, gm_v, gds_v) = evaluate_bsim3_pmos(
                        vsg,
                        vsd,
                        vsb,
                        comp.value,
                        comp.w,
                        comp.l,
                        None,
                        Some(comp),
                    );
                    (isd_v, gm_v, gds_v, 0.0, 1e-12)
                } else if vsg <= vth_abs {
                    (0.0, 0.0, 1e-9, 0.0, 1e-12)
                } else if vsd < vsg - vth_abs {
                    let isd_val = kp * (2.0 * (vsg - vth_abs) * vsd - vsd * vsd);
                    let gm_sd_val = 2.0 * kp * vsd;
                    let gds_cond_val = 2.0 * kp * (vsg - vth_abs - vsd);
                    (isd_val, gm_sd_val, gds_cond_val.max(1e-9), 0.0, 1e-12)
                } else {
                    let isd_val = kp * (vsg - vth_abs) * (vsg - vth_abs);
                    let gm_sd_val = 2.0 * kp * (vsg - vth_abs);
                    let gds_cond_val = 1e-5;
                    (isd_val, gm_sd_val, gds_cond_val, 0.0, 1e-12)
                };

                let ieq_sd = isd - gm_sd * vsg - gds_cond * vsd;
                let ieq_g = igs - gg * vsg;

                macro_rules! stamp_conductance {
                    ($r:expr, $c:expr, $g:expr) => {{
                        let r_val = $r;
                        let c_val = $c;
                        if r_val > 0 && c_val > 0 {
                            matrix_a.add_element(r_val - 1, c_val - 1, $g);
                        }
                    }};
                }

                stamp_conductance!(node_source, node_source, gds_cond);
                stamp_conductance!(node_drain, node_drain, gds_cond);
                stamp_conductance!(node_source, node_drain, -gds_cond);
                stamp_conductance!(node_drain, node_source, -gds_cond);

                if node_drain > 0 {
                    if node_source > 0 {
                        matrix_a.add_element(node_drain - 1, node_source - 1, -gm_sd);
                    }
                    if node_gate > 0 {
                        matrix_a.add_element(node_drain - 1, node_gate - 1, gm_sd);
                    }
                }
                if node_source > 0 {
                    if node_source > 0 {
                        matrix_a.add_element(node_source - 1, node_source - 1, gm_sd);
                    }
                    if node_gate > 0 {
                        matrix_a.add_element(node_source - 1, node_gate - 1, -gm_sd);
                    }
                }

                // Estampar conductancia de fugas de compuerta gg entre Source y Gate
                if gg.abs() > 1e-12 {
                    stamp_conductance!(node_gate, node_gate, gg);
                    stamp_conductance!(node_source, node_source, gg);
                    stamp_conductance!(node_gate, node_source, -gg);
                    stamp_conductance!(node_source, node_gate, -gg);
                }

                if node_drain > 0 {
                    vector_z[node_drain - 1] += ieq_sd;
                }
                if node_source > 0 {
                    vector_z[node_source - 1] -= ieq_sd;
                }

                // Estampar corriente equivalente de compuerta ieq_g (S->G: entra a G, sale de S)
                if igs.abs() > 1e-15 {
                    if node_gate > 0 {
                        vector_z[node_gate - 1] += ieq_g;
                    }
                    if node_source > 0 {
                        vector_z[node_source - 1] -= ieq_g;
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

                // Estimar corrientes de base y colector de la iteración previa para calcular caídas óhmicas
                // Damping preliminar de voltajes previos para cálculo seguro sin desbordamiento
                let vbe_prev_safe = pnjlim(vbe_old_raw, vbe_old_raw, vt, 0.6).min(0.95);
                let vbc_prev_safe = pnjlim(vbc_old_raw, vbc_old_raw, vt, 0.6).min(0.95);

                let exp_be_old = (vbe_prev_safe / vt).exp();
                let exp_bc_old = (vbc_prev_safe / vt).exp();
                let ide_old = bjt_is_val * (exp_be_old - 1.0);
                let idc_old = bjt_is_val * (exp_bc_old - 1.0);

                // Clampear corrientes previas a rangos físicos seguros para evitar oscilación numérica salvaje
                let ib_prev =
                    (ide_old / (beta_f + 1.0) + idc_old / (beta_r + 1.0)).clamp(-0.01, 0.01);
                let ic_prev = (alpha_f * ide_old - idc_old).clamp(-0.1, 0.1);

                let r_b = comp.bjt_rb.unwrap_or(10.0);
                let r_c = comp.bjt_rc.unwrap_or(2.0);

                let vbe_new = vbe_new_raw - ib_prev * r_b;
                let vbc_new = vbc_new_raw - ic_prev * r_c;
                let vbe_old = vbe_old_raw - ib_prev * r_b;
                let vbc_old = vbc_old_raw - ic_prev * r_c;

                // Damping logarítmico suave (pnjlim) para evitar overflow (Upgrade 4)
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

                // Modelado de Efecto Early (V_A) (Upgrade 3)
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
                let mut swapped = false;
                if vds < 0.0 {
                    vds = -vds;
                    vgs = if is_njf {
                        v_gate - v_drain
                    } else {
                        v_drain - v_gate
                    };
                    swapped = true;
                }

                let vgst = if is_njf { vgs - vto } else { vto - vgs };
                let (ids, gm, gds) = if vgst <= 0.0 {
                    (0.0, 0.0, 1e-9)
                } else if vds < vgst {
                    let ids_val = beta * vds * (2.0 * vgst - vds) * (1.0 + lambda * vds);
                    let gm_val = 2.0 * beta * vds * (1.0 + lambda * vds);
                    let gds_val = beta
                        * ((2.0 * vgst - 2.0 * vds) * (1.0 + lambda * vds)
                            + vds * (2.0 * vgst - vds) * lambda);
                    (ids_val, gm_val, gds_val.max(1e-9))
                } else {
                    let ids_val = beta * vgst * vgst * (1.0 + lambda * vds);
                    let gm_val = 2.0 * beta * vgst * (1.0 + lambda * vds);
                    let gds_val = beta * vgst * vgst * lambda;
                    (ids_val, gm_val, gds_val.max(1e-9))
                };

                let (ids_eff, gm_eff, gds_eff) = if swapped {
                    (-ids, -gm, gds)
                } else {
                    (ids, gm, gds)
                };

                let ids_final = ids_eff * factor_pol;
                let gm_final = gm_eff * factor_pol;
                let gds_final = gds_eff;

                let ieq = ids_final - gm_final * vgs_raw - gds_final * vds_raw;

                // Estampar gds usando acceso directo a la matriz (evita conflicto de borrow)
                if node_drain > 0 {
                    matrix_a.add_element(node_drain - 1, node_drain - 1, gds_final);
                }
                if node_source > 0 {
                    matrix_a.add_element(node_source - 1, node_source - 1, gds_final);
                }
                if node_drain > 0 && node_source > 0 {
                    matrix_a.add_element(node_drain - 1, node_source - 1, -gds_final);
                }
                if node_source > 0 && node_drain > 0 {
                    matrix_a.add_element(node_source - 1, node_drain - 1, -gds_final);
                }

                // Estampar gm (transconductancia)
                if node_drain > 0 {
                    if node_gate > 0 {
                        matrix_a.add_element(node_drain - 1, node_gate - 1, gm_final);
                    }
                    if node_source > 0 {
                        matrix_a.add_element(node_drain - 1, node_source - 1, -gm_final);
                    }
                }
                if node_source > 0 {
                    if node_gate > 0 {
                        matrix_a.add_element(node_source - 1, node_gate - 1, -gm_final);
                    }
                    if node_source > 0 {
                        matrix_a.add_element(node_source - 1, node_source - 1, gm_final);
                    }
                }

                if node_drain > 0 {
                    vector_z[node_drain - 1] -= ieq;
                }
                if node_source > 0 {
                    vector_z[node_source - 1] += ieq;
                }

                // Diodos parásitos de puerta
                let gate_is = 1e-14;
                let exp_gs = ((v_gate - v_source) / vt).exp();
                let igs = gate_is * (exp_gs - 1.0);
                let gg_gs = (gate_is / vt) * exp_gs;
                let ieq_gs = igs - gg_gs * (v_gate - v_source);

                if node_gate > 0 {
                    matrix_a.add_element(node_gate - 1, node_gate - 1, gg_gs);
                }
                if node_source > 0 {
                    matrix_a.add_element(node_source - 1, node_source - 1, gg_gs);
                }
                if node_gate > 0 && node_source > 0 {
                    matrix_a.add_element(node_gate - 1, node_source - 1, -gg_gs);
                }
                if node_source > 0 && node_gate > 0 {
                    matrix_a.add_element(node_source - 1, node_gate - 1, -gg_gs);
                }
                if node_gate > 0 {
                    vector_z[node_gate - 1] -= ieq_gs;
                }
                if node_source > 0 {
                    vector_z[node_source - 1] += ieq_gs;
                }

                let exp_gd = ((v_gate - v_drain) / vt).exp();
                let igd = gate_is * (exp_gd - 1.0);
                let gg_gd = (gate_is / vt) * exp_gd;
                let ieq_gd = igd - gg_gd * (v_gate - v_drain);

                if node_gate > 0 {
                    matrix_a.add_element(node_gate - 1, node_gate - 1, gg_gd);
                }
                if node_drain > 0 {
                    matrix_a.add_element(node_drain - 1, node_drain - 1, gg_gd);
                }
                if node_gate > 0 && node_drain > 0 {
                    matrix_a.add_element(node_gate - 1, node_drain - 1, -gg_gd);
                }
                if node_drain > 0 && node_gate > 0 {
                    matrix_a.add_element(node_drain - 1, node_gate - 1, -gg_gd);
                }
                if node_gate > 0 {
                    vector_z[node_gate - 1] -= ieq_gd;
                }
                if node_drain > 0 {
                    vector_z[node_drain - 1] += ieq_gd;
                }
            } else if comp.comp_type == "opamp" {
                let pin_in_pos = comp.pins[0].parse::<usize>().unwrap();
                let pin_in_neg = comp.pins[1].parse::<usize>().unwrap();
                let pin_vplus = comp.pins[2].parse::<usize>().unwrap();
                let pin_vminus = comp.pins[3].parse::<usize>().unwrap();
                let pin_out = comp.pins[4].parse::<usize>().unwrap();

                // Obtener voltajes previos
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
                let mut v_mid = 0.5 * (v_vplus + v_vminus);

                // Prevenir división por cero si no hay alimentación conectada
                if v_span.abs() < 1e-3 {
                    v_span = 30.0;
                    v_mid = 0.0;
                }

                let a_ol = 1e5; // Ganancia de lazo abierto
                let r_in = 1e7; // 10 Mohm
                let r_out = 100.0; // 100 ohm
                let g_out = 1.0 / r_out;
                let g_in = 1.0 / r_in;

                // 1. Estampar conductancia de entrada diferencial R_in
                let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                    if r > 0 && c > 0 {
                        matrix_a.add_element(r - 1, c - 1, g);
                    }
                };
                stamp_conductance(pin_in_pos, pin_in_pos, g_in);
                stamp_conductance(pin_in_neg, pin_in_neg, g_in);
                stamp_conductance(pin_in_pos, pin_in_neg, -g_in);
                stamp_conductance(pin_in_neg, pin_in_pos, -g_in);

                // 2. Calcular V_int_ctrl no lineal con tanh
                let arg = (a_ol * v_diff) / v_span;
                let tanh_val = arg.tanh();
                let v_int_ctrl = v_mid + 0.5 * v_span * tanh_val;

                // Derivada de V_int_ctrl respecto a V_diff:
                // d(V_int)/d(V_diff) = 0.5 * A_ol * (1 - tanh^2)
                let g_m_int = 0.5 * a_ol * (1.0 - tanh_val * tanh_val);
                let g_m_opamp = g_out * g_m_int;

                // Corriente equivalente de Norton a inyectar en pin_out
                let ieq = g_out * v_int_ctrl - g_m_opamp * v_diff;

                // 3. Estampar en MNA
                // Conductancia de salida
                if pin_out > 0 {
                    matrix_a.add_element(pin_out - 1, pin_out - 1, g_out);

                    // Transconductancias gm controladas en la fila de pin_out
                    if pin_in_pos > 0 {
                        matrix_a.add_element(pin_out - 1, pin_in_pos - 1, -g_m_opamp);
                    }
                    if pin_in_neg > 0 {
                        matrix_a.add_element(pin_out - 1, pin_in_neg - 1, g_m_opamp);
                    }

                    // Inyección de corriente equivalente en vector Z
                    vector_z[pin_out - 1] += ieq;
                }
            } else if comp.comp_type.ends_with("_gate") {
                let is_not = comp.comp_type == "not_gate";

                let (pin_in_a, pin_in_b, pin_out) = if is_not {
                    let pa = comp.pins[0].parse::<usize>().unwrap();
                    let po = comp.pins[1].parse::<usize>().unwrap();
                    (pa, 0, po)
                } else {
                    let pa = comp.pins[0].parse::<usize>().unwrap();
                    let pb = comp.pins[1].parse::<usize>().unwrap();
                    let po = comp.pins[2].parse::<usize>().unwrap();
                    (pa, pb, po)
                };

                let v_a = if pin_in_a > 0 {
                    prev_voltages[pin_in_a]
                } else {
                    0.0
                };
                let v_b = if pin_in_b > 0 {
                    prev_voltages[pin_in_b]
                } else {
                    0.0
                };

                let v_a_clamped = v_a.clamp(0.0, 5.0);
                let v_b_clamped = v_b.clamp(0.0, 5.0);

                let val_a = 1.0 / (1.0 + (-(v_a_clamped - 1.4) / 0.15).exp());
                let val_b = 1.0 / (1.0 + (-(v_b_clamped - 1.4) / 0.15).exp());

                let logic_out = match comp.comp_type.as_str() {
                    "and_gate" => val_a * val_b,
                    "or_gate" => val_a + val_b - val_a * val_b,
                    "not_gate" => 1.0 - val_a,
                    "nand_gate" => 1.0 - (val_a * val_b),
                    "nor_gate" => (1.0 - val_a) * (1.0 - val_b),
                    "xor_gate" => val_a * (1.0 - val_b) + val_b * (1.0 - val_a),
                    _ => 0.0,
                };

                let v_oh = 5.0 * alpha;
                let v_out_ideal = logic_out * v_oh;

                let r_out = 50.0;
                let g_out = 1.0 / r_out;
                let ieq = v_out_ideal / r_out;

                if pin_out > 0 {
                    matrix_a.add_element(pin_out - 1, pin_out - 1, g_out);
                    vector_z[pin_out - 1] += ieq;
                }
            } else if comp.comp_type == "arduino_uno"
                || comp.comp_type == "esp32"
                || comp.comp_type == "raspberry_pi_pico"
            {
                if comp.pins.len() >= 6 {
                    let pin_in = comp.pins[0].parse::<usize>().unwrap_or(0);
                    let pin_out = comp.pins[1].parse::<usize>().unwrap_or(0);
                    let pin_adc = comp.pins[2].parse::<usize>().unwrap_or(0);
                    let pin_dac = comp.pins[3].parse::<usize>().unwrap_or(0);
                    let pin_vcc = comp.pins[4].parse::<usize>().unwrap_or(0);
                    let pin_gnd = comp.pins[5].parse::<usize>().unwrap_or(0);

                    let v_cc = match comp.comp_type.as_str() {
                        "arduino_uno" => 5.0,
                        "esp32" | "raspberry_pi_pico" => 3.3,
                        _ => 5.0,
                    };

                    let mode = comp.value as i32;

                    // 1. Impedancia de entrada (Pin_In y Pin_ADC)
                    let g_in = 1e-6; // 1 MΩ
                    let g_adc = 1e-7; // 10 MΩ

                    let stamp_g = |matrix: &mut SparseMatrix, r: usize, c: usize, g: f64| {
                        if r > 0 && c > 0 {
                            matrix.add_element(r - 1, c - 1, g);
                        }
                    };

                    // Pin_In a GND
                    stamp_g(&mut matrix_a, pin_in, pin_in, g_in);
                    stamp_g(&mut matrix_a, pin_gnd, pin_gnd, g_in);
                    stamp_g(&mut matrix_a, pin_in, pin_gnd, -g_in);
                    stamp_g(&mut matrix_a, pin_gnd, pin_in, -g_in);

                    // Pin_ADC a GND
                    stamp_g(&mut matrix_a, pin_adc, pin_adc, g_adc);
                    stamp_g(&mut matrix_a, pin_gnd, pin_gnd, g_adc);
                    stamp_g(&mut matrix_a, pin_adc, pin_gnd, -g_adc);
                    stamp_g(&mut matrix_a, pin_gnd, pin_adc, -g_adc);

                    // 2. Alimentación Pin_VCC con consumo dinámico linealizado
                    let i_baseline = match comp.comp_type.as_str() {
                        "arduino_uno" => 0.015,
                        "esp32" => 0.060,
                        "raspberry_pi_pico" => 0.025,
                        _ => 0.015,
                    };
                    let c_eff = match comp.comp_type.as_str() {
                        "arduino_uno" => 150e-12,
                        "esp32" => 450e-12,
                        "raspberry_pi_pico" => 250e-12,
                        _ => 150e-12,
                    };
                    let f_clk = match comp.comp_type.as_str() {
                        "arduino_uno" => 16e6,
                        "esp32" => 240e6,
                        "raspberry_pi_pico" => 133e6,
                        _ => 16e6,
                    };

                    let g_vcc_draw = c_eff * f_clk;
                    let i_leakage = 1e-6; // 1 uA baseline leakage
                    let i_vcc_draw_static = i_baseline + i_leakage;

                    let g_vcc = 10.0; // 0.1 Ω internal supply impedance
                    let i_vcc_eq = g_vcc * v_cc - i_vcc_draw_static;

                    // Estampar conductancia de carril y conductancia de carga dinámica
                    let g_vcc_total = g_vcc + g_vcc_draw;
                    stamp_g(&mut matrix_a, pin_vcc, pin_vcc, g_vcc_total);
                    stamp_g(&mut matrix_a, pin_gnd, pin_gnd, g_vcc_total);
                    stamp_g(&mut matrix_a, pin_vcc, pin_gnd, -g_vcc_total);
                    stamp_g(&mut matrix_a, pin_gnd, pin_vcc, -g_vcc_total);

                    if pin_vcc > 0 {
                        vector_z[pin_vcc - 1] += i_vcc_eq;
                    }
                    if pin_gnd > 0 {
                        vector_z[pin_gnd - 1] -= i_vcc_eq;
                    }

                    // 3. Drivers de Salida con protección activa de sobrecorriente por saturación
                    let g_out = 0.05; // 20 Ω
                    let i_max = match comp.comp_type.as_str() {
                        "arduino_uno" => 0.040, // 40 mA
                        _ => 0.012,             // 12 mA
                    };

                    let v_adc_val = if pin_adc > 0 {
                        prev_voltages[pin_adc]
                    } else {
                        0.0
                    };
                    let v_gnd_val = if pin_gnd > 0 {
                        prev_voltages[pin_gnd]
                    } else {
                        0.0
                    };
                    let v_adc_diff = v_adc_val - v_gnd_val;

                    let v_out_val = if pin_out > 0 {
                        prev_voltages[pin_out]
                    } else {
                        0.0
                    };
                    let v_out_diff = v_out_val - v_gnd_val;

                    let v_target_out = match mode {
                        1 => v_cc,
                        2 => {
                            let v_threshold = 0.5 * v_cc;
                            if v_adc_diff > v_threshold {
                                v_cc
                            } else {
                                0.0
                            }
                        }
                        _ => 0.0,
                    };

                    let i_linear_out = g_out * (v_target_out - v_out_diff);

                    let i_stamp_out = if i_linear_out > i_max {
                        i_max + g_out * v_out_diff
                    } else if i_linear_out < -i_max {
                        -i_max + g_out * v_out_diff
                    } else {
                        g_out * v_target_out
                    };

                    // Stamp Pin_Out
                    stamp_g(&mut matrix_a, pin_out, pin_out, g_out);
                    stamp_g(&mut matrix_a, pin_gnd, pin_gnd, g_out);
                    stamp_g(&mut matrix_a, pin_out, pin_gnd, -g_out);
                    stamp_g(&mut matrix_a, pin_gnd, pin_out, -g_out);

                    if pin_out > 0 {
                        vector_z[pin_out - 1] += i_stamp_out;
                    }
                    if pin_gnd > 0 {
                        vector_z[pin_gnd - 1] -= i_stamp_out;
                    }

                    // Stamp Pin_DAC
                    let v_dac_val = if pin_dac > 0 {
                        prev_voltages[pin_dac]
                    } else {
                        0.0
                    };
                    let v_dac_diff = v_dac_val - v_gnd_val;

                    let v_target_dac = if mode == 0 || mode == 3 {
                        v_adc_diff.clamp(0.0, v_cc)
                    } else {
                        0.0
                    };

                    let i_linear_dac = g_out * (v_target_dac - v_dac_diff);

                    let (i_stamp_dac, g_transfer) = if i_linear_dac > i_max {
                        (i_max + g_out * v_dac_diff, 0.0)
                    } else if i_linear_dac < -i_max {
                        (-i_max + g_out * v_dac_diff, 0.0)
                    } else {
                        let g_trans = if mode == 0 || mode == 3 { g_out } else { 0.0 };
                        (g_out * v_target_dac, g_trans)
                    };

                    stamp_g(&mut matrix_a, pin_dac, pin_dac, g_out);
                    stamp_g(&mut matrix_a, pin_gnd, pin_gnd, g_out);
                    stamp_g(&mut matrix_a, pin_dac, pin_gnd, -g_out);
                    stamp_g(&mut matrix_a, pin_gnd, pin_dac, -g_out);

                    let i_eq_dac_residue = i_stamp_dac - g_transfer * v_adc_diff;

                    if pin_dac > 0 && pin_adc > 0 {
                        matrix_a.add_element(pin_dac - 1, pin_adc - 1, -g_transfer);
                    }
                    if pin_dac > 0 && pin_gnd > 0 {
                        matrix_a.add_element(pin_dac - 1, pin_gnd - 1, g_transfer);
                    }
                    if pin_gnd > 0 && pin_adc > 0 {
                        matrix_a.add_element(pin_gnd - 1, pin_adc - 1, g_transfer);
                    }
                    if pin_gnd > 0 {
                        matrix_a.add_element(pin_gnd - 1, pin_gnd - 1, -g_transfer);
                    }

                    if pin_dac > 0 {
                        vector_z[pin_dac - 1] += i_eq_dac_residue;
                    }
                    if pin_gnd > 0 {
                        vector_z[pin_gnd - 1] -= i_eq_dac_residue;
                    }
                }
            // B-Sources: Evaluar expresiones y actualizar vector de excitación
            } else if comp.comp_type == "switch" {
                // Frozen-state stamping: state determined before NR loop from initial_guess
                let node_a = comp.pins[0].parse::<usize>().unwrap();
                let node_b = comp.pins[1].parse::<usize>().unwrap();
                let ron = comp.switch_ron.unwrap_or(0.01);
                let roff = comp.switch_roff.unwrap_or(1e9);
                let is_closed = switch_frozen_states.get(&comp.id).copied().unwrap_or(false);
                let conductance = 1.0 / if is_closed { ron } else { roff };

                let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                    if r > 0 && c > 0 {
                        matrix_a.add_element(r - 1, c - 1, g);
                    }
                };

                stamp_conductance(node_a, node_a, conductance);
                stamp_conductance(node_b, node_b, conductance);
                stamp_conductance(node_a, node_b, -conductance);
                stamp_conductance(node_b, node_a, -conductance);
            } else if comp.comp_type == "bvoltage" {
                if let Some(ref expr_str) = comp.expression {
                    let _node_pos = comp.pins[0].parse::<usize>().unwrap_or(0);
                    let _node_neg = comp.pins[1].parse::<usize>().unwrap_or(0);
                    let mut nv = HashMap::new();
                    nv.insert("0".to_string(), 0.0);
                    for i in 1..=n {
                        nv.insert(i.to_string(), prev_voltages[i]);
                    }
                    let mut bc = HashMap::new();
                    for vs_comp in netlist
                        .components
                        .iter()
                        .filter(|c| c.comp_type == "vsource" || c.comp_type == "bvoltage")
                    {
                        if let Some(&idx) = vsource_map.get(&vs_comp.id) {
                            bc.insert(vs_comp.id.clone(), solution[n + idx]);
                        }
                    }
                    if let Ok(ad) = evaluate_expression_ad(&expr_str, &nv, &bc, 0.0, &mut ast_cache)
                    {
                        let vs_idx = *vsource_map.get(&comp.id).unwrap();
                        let col = n + vs_idx;
                        let mut ieq = ad.value;
                        for (&node_idx, &dv_dvx) in &ad.grad {
                            let v_k = if node_idx > 0 {
                                prev_voltages[node_idx]
                            } else {
                                0.0
                            };
                            ieq -= dv_dvx * v_k;
                            if col < size && node_idx > 0 {
                                matrix_a.add_element(col, node_idx - 1, -dv_dvx);
                            }
                        }
                        vector_z[col] = ieq;
                    }
                }
            } else if comp.comp_type == "bcurrent" {
                if let Some(ref expr_str) = comp.expression {
                    let node_pos = comp.pins[0].parse::<usize>().unwrap_or(0);
                    let node_neg = comp.pins[1].parse::<usize>().unwrap_or(0);
                    let mut nv = HashMap::new();
                    nv.insert("0".to_string(), 0.0);
                    for i in 1..=n {
                        nv.insert(i.to_string(), prev_voltages[i]);
                    }
                    let mut bc = HashMap::new();
                    for vs_comp in netlist
                        .components
                        .iter()
                        .filter(|c| c.comp_type == "vsource" || c.comp_type == "bvoltage")
                    {
                        if let Some(&idx) = vsource_map.get(&vs_comp.id) {
                            bc.insert(vs_comp.id.clone(), solution[n + idx]);
                        }
                    }
                    if let Ok(ad) = evaluate_expression_ad(&expr_str, &nv, &bc, 0.0, &mut ast_cache)
                    {
                        let mut ieq = ad.value;
                        for (&node_idx, &di_dv) in &ad.grad {
                            let v_k = if node_idx > 0 {
                                prev_voltages[node_idx]
                            } else {
                                0.0
                            };
                            ieq -= di_dv * v_k;
                            if node_idx > 0 {
                                if node_pos > 0 {
                                    matrix_a.add_element(node_pos - 1, node_idx - 1, di_dv);
                                }
                                if node_neg > 0 {
                                    matrix_a.add_element(node_neg - 1, node_idx - 1, -di_dv);
                                }
                            }
                        }
                        if node_pos > 0 {
                            vector_z[node_pos - 1] -= ieq;
                        }
                        if node_neg > 0 {
                            vector_z[node_neg - 1] += ieq;
                        }
                    }
                }
            }
        }
        Ok((matrix_a, vector_z))
    };

    let mut stamped_matrix_and_vector: Option<(SparseMatrix, DVector<f64>)> = None;
    let _lambda_backtrack = 1.0;
    let _prev_max_diff = f64::MAX;

    // 2. Bucle Newton-Raphson amortiguado
    for _iter in 1..=max_iter {
        let (matrix_a, vector_z) = if let Some(mv) = stamped_matrix_and_vector.take() {
            mv
        } else {
            stamp_at(&prev_voltages, &prev_prev_voltages, &solution)?
        };

        // Resolver el sistema lineal de esta iteración A * x = z usando Aritmética Plana CSC Left-Looking o Schur en paralelo (BBDF)
        let is_parallel = size >= 40;
        let mut solved_ok = false;
        let mut new_solution = DVector::<f64>::zeros(size);

        if is_parallel {
            let solver = parallel_solver.get_or_insert_with(|| {
                crate::sparse_parallel::SchurParallelSolver::analyze(&matrix_a, 0.1)
            });
            if !solver.is_monolithic {
                if let Ok(sol) = solver.solve(&matrix_a, &vector_z) {
                    new_solution = sol;
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
            matrix_csc
                .left_looking_factorize(symbolic, workspace)
                .map_err(|_| "Error de convergencia o circuito mal condicionado".to_string())?;
            new_solution = symbolic
                .solve(workspace, &vector_z)
                .ok_or_else(|| "Error de convergencia o circuito mal condicionado".to_string())?;
        }

        // Comprobar si hay NaN, infinitos o divergencia extrema en la solución (> 1e9)
        let max_val = new_solution.iter().map(|x| x.abs()).fold(0.0, f64::max);
        if max_val.is_nan() || max_val.is_infinite() || max_val > 1e9 {
            return Err(
                "Divergencia detectada: voltajes o corrientes fuera de rango (>1e9 V/A o NaN/Inf)"
                    .to_string(),
            );
        }

        // Calcular la norma del residuo real E_0 en el punto actual (sin pnjlim para evaluar el residuo físico real)
        let e_0 = {
            let (matrix_a_true, vector_z_true) =
                stamp_at(&prev_voltages, &prev_voltages, &solution)?;
            let f_k = multiply_sparse_matrix_vector(&matrix_a_true, &solution) - &vector_z_true;
            f_k.norm()
        };

        // Búsqueda Lineal con Retroceso (Backtracking Line Search)
        let mut lambda = 1.0;
        let mut best_prev_voltages = prev_voltages.clone();
        let mut best_solution = solution.clone();
        let mut best_max_diff = 0.0;
        let mut _found_descent = false;

        for search_step in 0..4 {
            // Calcular estado candidato para este lambda
            let mut prev_voltages_cand = prev_voltages.clone();
            for i in 1..=n {
                prev_voltages_cand[i] =
                    prev_voltages[i] + lambda * (new_solution[i - 1] - prev_voltages[i]);
            }
            let mut solution_cand = solution.clone();
            for i in 0..n {
                solution_cand[i] = prev_voltages_cand[i + 1];
            }
            for i in n..size {
                solution_cand[i] = solution[i] + lambda * (new_solution[i] - solution[i]);
            }

            // Estampar en el estado candidato (sin pnjlim para evaluar el residuo real)
            if let Ok((matrix_a_cand, vector_z_cand)) =
                stamp_at(&prev_voltages_cand, &prev_voltages_cand, &solution_cand)
            {
                let f_cand =
                    multiply_sparse_matrix_vector(&matrix_a_cand, &solution_cand) - &vector_z_cand;
                let e_cand = f_cand.norm();

                // Si reduce el residuo, o es el paso mínimo de salvaguarda (search_step == 3), lo aceptamos
                if e_cand < e_0 || search_step == 3 {
                    let mut max_diff_cand = 0.0;
                    for i in 1..=n {
                        let diff = (prev_voltages_cand[i] - prev_voltages[i]).abs();
                        if diff > max_diff_cand {
                            max_diff_cand = diff;
                        }
                    }
                    best_prev_voltages = prev_voltages_cand;
                    best_solution = solution_cand;
                    best_max_diff = max_diff_cand;
                    _found_descent = e_cand < e_0;
                    break;
                }
            }
            lambda *= 0.5;
        }

        // Actualizar el estado con el mejor candidato encontrado
        let old_prev_voltages = prev_voltages.clone();
        prev_prev_voltages = old_prev_voltages.clone();
        prev_voltages = best_prev_voltages;
        solution = best_solution;

        // Estampar con pnjlim habilitado para usar como matriz Jacobian en la siguiente iteración de resolución lineal
        let (matrix_a_accepted, vector_z_accepted) =
            stamp_at(&prev_voltages, &old_prev_voltages, &solution)?;
        stamped_matrix_and_vector = Some((matrix_a_accepted, vector_z_accepted));

        if best_max_diff < tolerance {
            converged = true;
            break;
        }
    }

    if converged {
        Ok(solution)
    } else {
        if let Some((matrix_a_accepted, vector_z_accepted)) = stamped_matrix_and_vector {
            Err(diagnose_convergence_failure(
                netlist,
                n,
                m,
                vsource_map,
                &solution,
                &matrix_a_accepted,
                &vector_z_accepted,
            ))
        } else {
            Err("Error de convergencia o circuito mal condicionado".to_string())
        }
    }
}
