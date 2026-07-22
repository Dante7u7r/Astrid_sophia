use crate::solver::matrix::{ComplexSparseMatrix, SparseMatrix};
use crate::solver::types::{CircuitNetlist, ComponentData};
use nalgebra::DVector;
use num_complex::Complex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::super::dc::solve_dc_circuit_with_guess;
use super::super::devices::{
    evaluate_bsim3_nmos, evaluate_bsim3_pmos, evaluate_bsim4_nmos, evaluate_bsim4_pmos,
    evaluate_opto_receiver, get_thermal_parameters, solve_diode_junction_voltage, PHYS_KB, PHYS_Q,
    PHYS_T,
};
use super::sweep::AcSweepSettings;

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
    let (vt, is_temp) = get_thermal_parameters(netlist.temperature, None);
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

    // Linealizar no lineales en el OP
    let mut diode_conductances = HashMap::new();
    let mut diode_currents = HashMap::new();
    let mut nmos_parameters = HashMap::new(); // (gm, gds, ids)
    let mut pmos_parameters = HashMap::new(); // (gm, gds, ids)
    let mut bjt_parameters = HashMap::new(); // (gbe, gbc, ib, ic)
    let mut jfet_parameters = HashMap::new(); // (gm, gds, ids)
    let mut opamp_gm = HashMap::new();
    let mut opto_parameters: HashMap<String, (f64, f64)> = HashMap::new(); // (g_md, g_o)
    let mut opto_currents: HashMap<String, (f64, f64)> = HashMap::new(); // (i_led, i_ce)

    for comp in &netlist.components {
        if comp.comp_type == "diode" || comp.comp_type == "led" {
            let node_anode = comp.pins[0].parse::<usize>().unwrap();
            let node_cathode = comp.pins[1].parse::<usize>().unwrap();
            let v_anode = if node_anode > 0 {
                *op_result
                    .node_voltages
                    .get(&node_anode.to_string())
                    .unwrap_or(&0.0)
            } else {
                0.0
            };
            let v_cathode = if node_cathode > 0 {
                *op_result
                    .node_voltages
                    .get(&node_cathode.to_string())
                    .unwrap_or(&0.0)
            } else {
                0.0
            };
            let vd = v_anode - v_cathode;
            let (_, id, gd) = solve_diode_junction_voltage(vd, netlist.temperature, comp);
            diode_conductances.insert(comp.id.clone(), gd);
            diode_currents.insert(comp.id.clone(), id);
        } else if comp.comp_type == "opto" {
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
            let (_, id_led, gd_led) = solve_diode_junction_voltage(vd, netlist.temperature, comp);
            let (i_ce, g_md, g_o, _i_ce_eq) =
                evaluate_opto_receiver(vd, gd_led, id_led, v_ce, comp);
            diode_conductances.insert(comp.id.clone(), gd_led);
            diode_currents.insert(comp.id.clone(), id_led);
            opto_parameters.insert(comp.id.clone(), (g_md, g_o));
            opto_currents.insert(comp.id.clone(), (id_led, i_ce));
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
                *op_result
                    .node_voltages
                    .get(&node_gate.to_string())
                    .unwrap_or(&0.0)
            } else {
                0.0
            };
            let v_drain = if node_drain > 0 {
                *op_result
                    .node_voltages
                    .get(&node_drain.to_string())
                    .unwrap_or(&0.0)
            } else {
                0.0
            };
            let v_source = if node_source > 0 {
                *op_result
                    .node_voltages
                    .get(&node_source.to_string())
                    .unwrap_or(&0.0)
            } else {
                0.0
            };
            let v_bulk = if node_bulk > 0 {
                *op_result
                    .node_voltages
                    .get(&node_bulk.to_string())
                    .unwrap_or(&0.0)
            } else {
                0.0
            };

            let vgs = v_gate - v_source;
            let vds = (v_drain - v_source).max(0.0);
            let vbs = v_bulk - v_source;

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
            } else {
                let lambda = 0.02;
                let vth = comp.value;
                let kn = 0.02;
                if vgs <= vth {
                    let i_sub0 = 1e-7;
                    let n_factor = 1.5;
                    let exp_sub = ((vgs - vth) / (n_factor * vt)).exp();
                    let exp_vds = (-vds / vt).exp();
                    let sub_factor = 1.0 - exp_vds;
                    let ids_val = i_sub0 * exp_sub * sub_factor * (1.0 + lambda * vds);
                    let gm_val = ids_val / (n_factor * vt);
                    let gds_val: f64 = i_sub0
                        * exp_sub
                        * ((exp_vds / vt) * (1.0 + lambda * vds) + sub_factor * lambda);
                    (ids_val, gm_val, gds_val.max(1e-9), 0.0, 1e-12)
                } else if vds < vgs - vth {
                    let triode_curr = kn * (2.0 * (vgs - vth) * vds - vds * vds);
                    let ids_val = triode_curr * (1.0 + lambda * vds);
                    let gm_val = (2.0 * kn * vds) * (1.0 + lambda * vds);
                    let gds_val: f64 = (2.0 * kn * (vgs - vth - vds)) * (1.0 + lambda * vds)
                        + triode_curr * lambda;
                    (ids_val, gm_val, gds_val.max(1e-9), 0.0, 1e-12)
                } else {
                    let sat_curr = kn * (vgs - vth) * (vgs - vth);
                    let ids_val = sat_curr * (1.0 + lambda * vds);
                    let gm_val = (2.0 * kn * (vgs - vth)) * (1.0 + lambda * vds);
                    let gds_val: f64 = sat_curr * lambda;
                    (ids_val, gm_val, gds_val.max(1e-9), 0.0, 1e-12)
                }
            };
            nmos_parameters.insert(comp.id.clone(), (gm, gds, ids, igs, gg));
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
                *op_result
                    .node_voltages
                    .get(&node_gate.to_string())
                    .unwrap_or(&0.0)
            } else {
                0.0
            };
            let v_drain = if node_drain > 0 {
                *op_result
                    .node_voltages
                    .get(&node_drain.to_string())
                    .unwrap_or(&0.0)
            } else {
                0.0
            };
            let v_source = if node_source > 0 {
                *op_result
                    .node_voltages
                    .get(&node_source.to_string())
                    .unwrap_or(&0.0)
            } else {
                0.0
            };
            let v_bulk = if node_bulk > 0 {
                *op_result
                    .node_voltages
                    .get(&node_bulk.to_string())
                    .unwrap_or(&0.0)
            } else {
                0.0
            };

            let vsg = v_source - v_gate;
            let vsd = (v_source - v_drain).max(0.0);
            let vsb = v_source - v_bulk;

            let (isd, gm, gds, igs, gg) = if comp.comp_type == "bsim4pmos" {
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
            } else {
                let lambda = 0.02;
                let vth = if comp.value == 0.0 { -1.5 } else { comp.value };
                let vth_abs = -vth;
                let kp = 0.02;
                if vsg <= vth_abs {
                    let i_sub0 = 1e-7;
                    let n_factor = 1.5;
                    let exp_sub = ((vsg - vth_abs) / (n_factor * vt)).exp();
                    let exp_vsd = (-vsd / vt).exp();
                    let sub_factor = 1.0 - exp_vsd;
                    let isd_val = i_sub0 * exp_sub * sub_factor * (1.0 + lambda * vsd);
                    let gm_val = isd_val / (n_factor * vt);
                    let gds_cond_val = i_sub0
                        * exp_sub
                        * ((exp_vsd / vt) * (1.0 + lambda * vsd) + sub_factor * lambda);
                    (isd_val, gm_val, gds_cond_val.max(1e-9), 0.0, 1e-12)
                } else if vsd < vsg - vth_abs {
                    let triode_curr = kp * (2.0 * (vsg - vth_abs) * vsd - vsd * vsd);
                    let isd_val = triode_curr * (1.0 + lambda * vsd);
                    let gm_val = (2.0 * kp * vsd) * (1.0 + lambda * vsd);
                    let gds_cond_val = (2.0 * kp * (vsg - vth_abs - vsd)) * (1.0 + lambda * vsd)
                        + triode_curr * lambda;
                    (isd_val, gm_val, gds_cond_val.max(1e-9), 0.0, 1e-12)
                } else {
                    let sat_curr = kp * (vsg - vth_abs) * (vsg - vth_abs);
                    let isd_val = sat_curr * (1.0 + lambda * vsd);
                    let gm_val = (2.0 * kp * (vsg - vth_abs)) * (1.0 + lambda * vsd);
                    let gds_cond_val = sat_curr * lambda;
                    (isd_val, gm_val, gds_cond_val.max(1e-9), 0.0, 1e-12)
                }
            };
            pmos_parameters.insert(comp.id.clone(), (gm, gds, isd, igs, gg));
        } else if comp.comp_type == "npn" || comp.comp_type == "pnp" {
            let is_npn = comp.comp_type == "npn";
            let node_base = comp.pins[0].parse::<usize>().unwrap();
            let node_collector = comp.pins[1].parse::<usize>().unwrap();
            let node_emitter = comp.pins[2].parse::<usize>().unwrap();

            let v_base = if node_base > 0 {
                *op_result
                    .node_voltages
                    .get(&node_base.to_string())
                    .unwrap_or(&0.0)
            } else {
                0.0
            };
            let v_collector = if node_collector > 0 {
                *op_result
                    .node_voltages
                    .get(&node_collector.to_string())
                    .unwrap_or(&0.0)
            } else {
                0.0
            };
            let v_emitter = if node_emitter > 0 {
                *op_result
                    .node_voltages
                    .get(&node_emitter.to_string())
                    .unwrap_or(&0.0)
            } else {
                0.0
            };

            let (vbe, vbc) = if is_npn {
                (v_base - v_emitter, v_base - v_collector)
            } else {
                (v_emitter - v_base, v_collector - v_base)
            };

            let bjt_is_val = if comp.bjt_is.is_some() {
                let (_, scaled_is) = get_thermal_parameters(netlist.temperature, comp.bjt_is);
                scaled_is
            } else {
                is_temp
            };
            let beta_f = comp
                .bjt_bf
                .unwrap_or(if comp.value <= 1.0 { 100.0 } else { comp.value });
            let v_af = comp.bjt_vaf.unwrap_or(if is_npn { 100.0 } else { 50.0 });
            let k_early = (1.0 + (vbe - vbc) / v_af).max(0.1);

            let exp_be = (vbe / vt).exp();
            let exp_bc = (vbc / vt).exp();

            let ide = bjt_is_val * (exp_be - 1.0) * k_early;
            let idc = bjt_is_val * (exp_bc - 1.0) * k_early;
            let gbe = (bjt_is_val / vt) * exp_be * k_early;
            let gbc = (bjt_is_val / vt) * exp_bc * k_early;

            let ib = ide / (beta_f + 1.0) + idc / 2.0;
            let ic = ide - idc;

            bjt_parameters.insert(comp.id.clone(), (gbe, gbc, ib, ic));
        } else if comp.comp_type == "njf" || comp.comp_type == "pjf" {
            let is_njf = comp.comp_type == "njf";
            let node_drain = comp.pins[0].parse::<usize>().unwrap();
            let node_gate = comp.pins[1].parse::<usize>().unwrap();
            let node_source = comp.pins[2].parse::<usize>().unwrap();

            let v_drain = if node_drain > 0 {
                *op_result
                    .node_voltages
                    .get(&node_drain.to_string())
                    .unwrap_or(&0.0)
            } else {
                0.0
            };
            let v_gate = if node_gate > 0 {
                *op_result
                    .node_voltages
                    .get(&node_gate.to_string())
                    .unwrap_or(&0.0)
            } else {
                0.0
            };
            let v_source = if node_source > 0 {
                *op_result
                    .node_voltages
                    .get(&node_source.to_string())
                    .unwrap_or(&0.0)
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
                let gm_val = 2.0 * beta * vds * (1.0 + lambda * vds);
                let gds_val = beta
                    * ((2.0 * vgst - 2.0 * vds) * (1.0 + lambda * vds)
                        + vds * (2.0 * vgst - vds) * lambda);
                let ids_val = beta * vds * (2.0 * vgst - vds) * (1.0 + lambda * vds);
                (ids_val, gm_val, gds_val.max(1e-9))
            } else {
                let gm_val = 2.0 * beta * vgst * (1.0 + lambda * vds);
                let gds_val = beta * vgst * vgst * lambda;
                let ids_val = beta * vgst * vgst * (1.0 + lambda * vds);
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

            jfet_parameters.insert(comp.id.clone(), (gm_final, gds_final, ids_final));
        } else if comp.comp_type == "opamp" {
            let pin_in_pos = comp.pins[0].parse::<usize>().unwrap();
            let pin_in_neg = comp.pins[1].parse::<usize>().unwrap();
            let pin_vplus = comp.pins[2].parse::<usize>().unwrap();
            let pin_vminus = comp.pins[3].parse::<usize>().unwrap();

            let v_in_pos = if pin_in_pos > 0 {
                *op_result
                    .node_voltages
                    .get(&pin_in_pos.to_string())
                    .unwrap_or(&0.0)
            } else {
                0.0
            };
            let v_in_neg = if pin_in_neg > 0 {
                *op_result
                    .node_voltages
                    .get(&pin_in_neg.to_string())
                    .unwrap_or(&0.0)
            } else {
                0.0
            };
            let v_vplus = if pin_vplus > 0 {
                *op_result
                    .node_voltages
                    .get(&pin_vplus.to_string())
                    .unwrap_or(&15.0)
            } else {
                15.0
            };
            let v_vminus = if pin_vminus > 0 {
                *op_result
                    .node_voltages
                    .get(&pin_vminus.to_string())
                    .unwrap_or(&-15.0)
            } else {
                -15.0
            };

            let v_diff = v_in_pos - v_in_neg;
            let mut v_span = v_vplus - v_vminus;
            if v_span.abs() < 1e-3 {
                v_span = 30.0;
            }
            let a_ol = 1e5;
            let r_out = 100.0;
            let g_out = 1.0 / r_out;
            let arg: f64 = (a_ol * v_diff) / v_span;
            let tanh_val = arg.tanh();
            let g_m_int = 0.5 * a_ol * (1.0 - tanh_val * tanh_val);
            let g_m_opamp = g_out * g_m_int;
            opamp_gm.insert(comp.id.clone(), g_m_opamp);
        }
    }

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
