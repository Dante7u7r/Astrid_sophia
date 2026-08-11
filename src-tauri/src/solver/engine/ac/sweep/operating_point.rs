use super::AcSweepSettings;
use crate::solver::engine::dc::solve_dc_circuit_with_guess;
use crate::solver::engine::devices::{
    evaluate_bsim3_nmos, evaluate_bsim3_pmos, evaluate_bsim4_nmos, evaluate_bsim4_pmos,
    evaluate_opto_receiver, get_thermal_parameters, solve_diode_junction_voltage, DIODE_N,
};
use crate::solver::types::CircuitNetlist;
use std::collections::HashMap;

pub(super) struct AcOperatingPoint {
    pub(super) diode_conductances: HashMap<String, f64>,
    pub(super) nmos_parameters: HashMap<String, (f64, f64, f64)>,
    pub(super) pmos_parameters: HashMap<String, (f64, f64, f64)>,
    pub(super) bjt_parameters: HashMap<String, (f64, f64)>,
    pub(super) opamp_gm: HashMap<String, f64>,
    pub(super) opto_parameters: HashMap<String, (f64, f64)>,
}

pub(super) fn prepare_ac_operating_point(
    netlist: &CircuitNetlist,
    settings: &AcSweepSettings,
) -> Result<AcOperatingPoint, String> {
    let (vt, is_temp) = get_thermal_parameters(netlist.temperature, None);

    let mut diode_conductances = HashMap::new();
    let mut nmos_parameters = HashMap::new();
    let mut pmos_parameters = HashMap::new();
    let mut bjt_parameters = HashMap::new();
    let mut opamp_gm = HashMap::new();
    let mut opto_parameters: HashMap<String, (f64, f64)> = HashMap::new(); // (g_md, g_o)

    let has_diodes = netlist
        .components
        .iter()
        .any(|c| c.comp_type == "diode" || c.comp_type == "led");
    let has_optos = netlist.components.iter().any(|c| c.comp_type == "opto");
    let has_nmos = netlist
        .components
        .iter()
        .any(|c| c.comp_type == "nmos" || c.comp_type == "bsim3nmos" || c.comp_type == "bsim4nmos");
    let has_pmos = netlist
        .components
        .iter()
        .any(|c| c.comp_type == "pmos" || c.comp_type == "bsim3pmos" || c.comp_type == "bsim4pmos");
    let has_npn = netlist.components.iter().any(|c| c.comp_type == "npn");
    let has_pnp = netlist.components.iter().any(|c| c.comp_type == "pnp");
    let has_opamps = netlist.components.iter().any(|c| c.comp_type == "opamp");
    if has_diodes || has_optos || has_nmos || has_pmos || has_npn || has_pnp || has_opamps {
        let (op_result, _) = solve_dc_circuit_with_guess(netlist, settings.op_guess.as_ref())?;

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
                let exp_factor = (vd / (DIODE_N * vt)).exp();
                let gd = (is_temp / (DIODE_N * vt)) * exp_factor;
                diode_conductances.insert(comp.id.clone(), gd);
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
                let (_, id_led, gd_led) =
                    solve_diode_junction_voltage(vd, netlist.temperature, comp);
                let (_i_ce, g_md, g_o, _i_ce_eq) =
                    evaluate_opto_receiver(vd, gd_led, id_led, v_ce, comp);
                // Lado LED se estampa como diodo estándar
                diode_conductances.insert(comp.id.clone(), gd_led);
                // Lado receptor se guarda aparte
                opto_parameters.insert(comp.id.clone(), (g_md, g_o));
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
                let mut vds = v_drain - v_source;
                if vds < 0.0 {
                    vds = 0.0;
                }
                let vbs = v_bulk - v_source;

                let (gm, gds, gg) = if comp.comp_type == "bsim4nmos" {
                    let (_, gm_val, gds_val, _, gg_val) =
                        evaluate_bsim4_nmos(vgs, vds, vbs, comp.value, comp.w, comp.l);
                    (gm_val, gds_val, gg_val)
                } else if comp.comp_type == "bsim3nmos" {
                    let (_, gm_val, gds_val) = evaluate_bsim3_nmos(
                        vgs,
                        vds,
                        vbs,
                        comp.value,
                        comp.w,
                        comp.l,
                        None,
                        Some(comp),
                    );
                    (gm_val, gds_val, 1e-12)
                } else {
                    let vth = comp.value;
                    let kn = 0.02;
                    if vgs <= vth {
                        (0.0, 1e-9, 1e-12)
                    } else if vds < vgs - vth {
                        let gm_val = 2.0 * kn * vds;
                        let gds_val: f64 = 2.0 * kn * (vgs - vth - vds);
                        (gm_val, gds_val.max(1e-9), 1e-12)
                    } else {
                        let gm_val = 2.0 * kn * (vgs - vth);
                        (gm_val, 1e-5, 1e-12)
                    }
                };
                nmos_parameters.insert(comp.id.clone(), (gm, gds, gg));
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
                let mut vsd = v_source - v_drain;
                if vsd < 0.0 {
                    vsd = 0.0;
                }
                let vsb = v_source - v_bulk;

                let (gm, gds, gg) = if comp.comp_type == "bsim4pmos" {
                    let (_, gm_val, gds_val, _, gg_val) =
                        evaluate_bsim4_pmos(vsg, vsd, vsb, comp.value, comp.w, comp.l);
                    (gm_val, gds_val, gg_val)
                } else if comp.comp_type == "bsim3pmos" {
                    let (_, gm_val, gds_val) = evaluate_bsim3_pmos(
                        vsg,
                        vsd,
                        vsb,
                        comp.value,
                        comp.w,
                        comp.l,
                        None,
                        Some(comp),
                    );
                    (gm_val, gds_val, 1e-12)
                } else {
                    let vth = if comp.value == 0.0 { -1.5 } else { comp.value };
                    let vth_abs = -vth;
                    let kp = 0.02;
                    if vsg <= vth_abs {
                        (0.0, 1e-9, 1e-12)
                    } else if vsd < vsg - vth_abs {
                        let gm_val = 2.0 * kp * vsd;
                        let gds_val: f64 = 2.0 * kp * (vsg - vth_abs - vsd);
                        (gm_val, gds_val.max(1e-9), 1e-12)
                    } else {
                        let gm_val = 2.0 * kp * (vsg - vth_abs);
                        (gm_val, 1e-5, 1e-12)
                    }
                };
                pmos_parameters.insert(comp.id.clone(), (gm, gds, gg));
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

                let exp_be = (vbe / vt).exp();
                let exp_bc = (vbc / vt).exp();

                let gbe = (is_temp / vt) * exp_be;
                let gbc = (is_temp / vt) * exp_bc;

                bjt_parameters.insert(comp.id.clone(), (gbe, gbc));
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
    }

    Ok(AcOperatingPoint {
        diode_conductances,
        nmos_parameters,
        pmos_parameters,
        bjt_parameters,
        opamp_gm,
        opto_parameters,
    })
}
