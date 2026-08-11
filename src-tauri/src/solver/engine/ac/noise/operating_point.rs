use crate::solver::engine::devices::{
    evaluate_bsim3_nmos, evaluate_bsim3_pmos, evaluate_bsim4_nmos, evaluate_bsim4_pmos,
    evaluate_opto_receiver, get_thermal_parameters, solve_diode_junction_voltage,
};
use crate::solver::types::{CircuitNetlist, SimulationResult};
use std::collections::HashMap;

pub(super) struct NoiseOperatingPoint {
    pub(super) diode_conductances: HashMap<String, f64>,
    pub(super) diode_currents: HashMap<String, f64>,
    pub(super) nmos_parameters: HashMap<String, (f64, f64, f64, f64, f64)>,
    pub(super) pmos_parameters: HashMap<String, (f64, f64, f64, f64, f64)>,
    pub(super) bjt_parameters: HashMap<String, (f64, f64, f64, f64)>,
    pub(super) jfet_parameters: HashMap<String, (f64, f64, f64)>,
    pub(super) opamp_gm: HashMap<String, f64>,
    pub(super) opto_parameters: HashMap<String, (f64, f64)>,
    pub(super) opto_currents: HashMap<String, (f64, f64)>,
}

pub(super) fn extract_noise_operating_point(
    netlist: &CircuitNetlist,
    op_result: &SimulationResult,
) -> NoiseOperatingPoint {
    let (vt, is_temp) = get_thermal_parameters(netlist.temperature, None);

    let mut diode_conductances = HashMap::new();
    let mut diode_currents = HashMap::new();
    let mut nmos_parameters = HashMap::new();
    let mut pmos_parameters = HashMap::new();
    let mut bjt_parameters = HashMap::new();
    let mut jfet_parameters = HashMap::new();
    let mut opamp_gm = HashMap::new();
    let mut opto_parameters = HashMap::new();
    let mut opto_currents = HashMap::new();

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

    NoiseOperatingPoint {
        diode_conductances,
        diode_currents,
        nmos_parameters,
        pmos_parameters,
        bjt_parameters,
        jfet_parameters,
        opamp_gm,
        opto_parameters,
        opto_currents,
    }
}
