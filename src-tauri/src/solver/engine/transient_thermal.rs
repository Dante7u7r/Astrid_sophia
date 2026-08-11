use crate::solver::types::CircuitNetlist;
use nalgebra::DVector;
use std::collections::HashMap;

use super::devices::*;

pub(crate) fn update_device_junction_temperatures(
    netlist: &CircuitNetlist,
    step_solution: &DVector<f64>,
    device_tjunc: &mut HashMap<String, f64>,
    t_amb: f64,
    dt: f64,
) {
    for comp in &netlist.components {
        let (rth, cth) = match comp.comp_type.as_str() {
            "diode" | "led" => (
                comp.rth.unwrap_or(DIODE_RTH_JA),
                comp.cth.unwrap_or(DIODE_CTH),
            ),
            "opto" => (
                comp.rth.unwrap_or(OPTO_RTH_JA),
                comp.cth.unwrap_or(OPTO_CTH),
            ),
            "nmos" | "pmos" | "bsim3nmos" | "bsim3pmos" | "bsim4nmos" | "bsim4pmos" => {
                (comp.rth.unwrap_or(MOS_RTH_JA), comp.cth.unwrap_or(MOS_CTH))
            }
            "npn" | "pnp" => (comp.rth.unwrap_or(BJT_RTH_JA), comp.cth.unwrap_or(BJT_CTH)),
            _ => continue,
        };

        let p_diss = match comp.comp_type.as_str() {
            "diode" | "led" => {
                let na = comp.pins[0].parse::<usize>().unwrap_or(0);
                let nc = comp.pins[1].parse::<usize>().unwrap_or(0);
                let va = if na > 0 { step_solution[na - 1] } else { 0.0 };
                let vc = if nc > 0 { step_solution[nc - 1] } else { 0.0 };
                let vd = va - vc;
                let tj = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                let (_, id, _) = solve_diode_junction_voltage(vd, Some(tj), comp);
                (vd * id).abs()
            }
            "opto" => {
                if comp.pins.len() < 4 {
                    continue;
                }
                let na = comp.pins[0].parse::<usize>().unwrap_or(0);
                let nk = comp.pins[1].parse::<usize>().unwrap_or(0);
                let nc = comp.pins[2].parse::<usize>().unwrap_or(0);
                let ne = comp.pins[3].parse::<usize>().unwrap_or(0);
                let va = if na > 0 { step_solution[na - 1] } else { 0.0 };
                let vk = if nk > 0 { step_solution[nk - 1] } else { 0.0 };
                let vc = if nc > 0 { step_solution[nc - 1] } else { 0.0 };
                let ve = if ne > 0 { step_solution[ne - 1] } else { 0.0 };
                let vd = va - vk;
                let v_ce = vc - ve;
                let tj = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                let (_, id_led, _) = solve_diode_junction_voltage(vd, Some(tj), comp);
                let ctr = comp.opto_ctr.unwrap_or(OPTO_DEFAULT_CTR);
                let vsat = comp.opto_vsat.unwrap_or(OPTO_DEFAULT_VSAT).max(1e-6);
                let i_ce = ctr * id_led * (v_ce / vsat).tanh();
                (vd * id_led).abs() + (v_ce * i_ce).abs()
            }
            "nmos" | "bsim3nmos" | "bsim4nmos" => {
                let ng = comp.pins[0].parse::<usize>().unwrap_or(0);
                let nd = comp.pins[1].parse::<usize>().unwrap_or(0);
                let ns = comp.pins[2].parse::<usize>().unwrap_or(0);
                let nb = if comp.pins.len() >= 4 {
                    comp.pins[3].parse::<usize>().unwrap_or(0)
                } else {
                    0
                };
                let vg = if ng > 0 { step_solution[ng - 1] } else { 0.0 };
                let vd_pin = if nd > 0 { step_solution[nd - 1] } else { 0.0 };
                let vs = if ns > 0 { step_solution[ns - 1] } else { 0.0 };
                let v_b = if nb > 0 { step_solution[nb - 1] } else { 0.0 };
                let vgs = vg - vs;
                let vds = (vd_pin - vs).max(0.0);
                let vbs = v_b - vs;
                let tj = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                let vth = comp.value + MOS_VTH_TC * (tj - PHYS_T);
                let kn = 0.02 * (tj / PHYS_T).powf(MOS_MOBILITY_EXPO);

                let (ids, igs) = if comp.comp_type == "bsim4nmos" {
                    let (ids_val, _, _, igs_val, _) =
                        evaluate_bsim4_nmos(vgs, vds, vbs, comp.value, comp.w, comp.l);
                    (ids_val, igs_val)
                } else if comp.comp_type == "bsim3nmos" {
                    let (ids_val, _, _) = evaluate_bsim3_nmos(
                        vgs,
                        vds,
                        vbs,
                        comp.value,
                        comp.w,
                        comp.l,
                        None,
                        Some(comp),
                    );
                    (ids_val, 0.0)
                } else {
                    let ids_val = if vgs <= vth {
                        0.0
                    } else if vds < vgs - vth {
                        kn * (2.0 * (vgs - vth) * vds - vds * vds)
                    } else {
                        kn * (vgs - vth).powi(2)
                    };
                    (ids_val, 0.0)
                };
                (vds * ids).abs() + (vgs * igs).abs()
            }
            "pmos" | "bsim3pmos" | "bsim4pmos" => {
                let ng = comp.pins[0].parse::<usize>().unwrap_or(0);
                let nd = comp.pins[1].parse::<usize>().unwrap_or(0);
                let ns = comp.pins[2].parse::<usize>().unwrap_or(0);
                let nb = if comp.pins.len() >= 4 {
                    comp.pins[3].parse::<usize>().unwrap_or(0)
                } else {
                    0
                };
                let vg = if ng > 0 { step_solution[ng - 1] } else { 0.0 };
                let vd_pin = if nd > 0 { step_solution[nd - 1] } else { 0.0 };
                let vs = if ns > 0 { step_solution[ns - 1] } else { 0.0 };
                let v_b = if nb > 0 { step_solution[nb - 1] } else { 0.0 };
                let vsg = vs - vg;
                let vsd = (vs - vd_pin).max(0.0);
                let vsb = vs - v_b;
                let tj = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                let vth_abs = comp.value.abs() + MOS_VTH_TC * (tj - PHYS_T);
                let kp = 0.01 * (tj / PHYS_T).powf(MOS_MOBILITY_EXPO);

                let (isd, igs) = if comp.comp_type == "bsim4pmos" {
                    let (isd_val, _, _, igs_val, _) =
                        evaluate_bsim4_pmos(vsg, vsd, vsb, comp.value, comp.w, comp.l);
                    (isd_val, igs_val)
                } else if comp.comp_type == "bsim3pmos" {
                    let (isd_val, _, _) = evaluate_bsim3_pmos(
                        vsg,
                        vsd,
                        vsb,
                        comp.value,
                        comp.w,
                        comp.l,
                        None,
                        Some(comp),
                    );
                    (isd_val, 0.0)
                } else {
                    let ids_val = if vsg <= vth_abs {
                        0.0
                    } else if vsd < vsg - vth_abs {
                        kp * (2.0 * (vsg - vth_abs) * vsd - vsd * vsd)
                    } else {
                        kp * (vsg - vth_abs).powi(2)
                    };
                    (ids_val, 0.0)
                };
                (vsd * isd).abs() + (vsg * igs).abs()
            }
            "npn" | "pnp" => {
                let nb = comp.pins[0].parse::<usize>().unwrap_or(0);
                let nc = comp.pins[1].parse::<usize>().unwrap_or(0);
                let ne = comp.pins[2].parse::<usize>().unwrap_or(0);
                let vb = if nb > 0 { step_solution[nb - 1] } else { 0.0 };
                let vc_pin = if nc > 0 { step_solution[nc - 1] } else { 0.0 };
                let ve = if ne > 0 { step_solution[ne - 1] } else { 0.0 };
                let (vce, vbe) = if comp.comp_type == "npn" {
                    ((vc_pin - ve).abs(), vb - ve)
                } else {
                    ((ve - vc_pin).abs(), ve - vb)
                };
                let tj = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                let (vt_b, is_b) = get_thermal_parameters_junction(tj, None);
                let ic = is_b * ((vbe / vt_b).exp() - 1.0) * comp.value.max(100.0);
                (vce * ic.abs()).min(50.0)
            }
            _ => 0.0,
        };

        let tj_prev = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
        let tj_new = (tj_prev + (dt / cth) * (p_diss + t_amb / rth)) / (1.0 + dt / (cth * rth));
        device_tjunc.insert(comp.id.clone(), tj_new.clamp(t_amb, 500.0));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::solver::types::ComponentData;

    const T_AMB: f64 = 300.0;

    fn component(comp_type: &str, value: f64, pins: &[&str]) -> ComponentData {
        ComponentData {
            id: comp_type.to_string(),
            comp_type: comp_type.to_string(),
            value,
            pins: pins.iter().map(|pin| (*pin).to_string()).collect(),
            rth: Some(100.0),
            cth: Some(0.01),
            ..Default::default()
        }
    }

    fn updated_temperature(component: ComponentData, voltages: &[f64]) -> f64 {
        let id = component.id.clone();
        let netlist = CircuitNetlist {
            components: vec![component],
            ..Default::default()
        };
        let mut temperatures = HashMap::from([(id.clone(), T_AMB)]);

        update_device_junction_temperatures(
            &netlist,
            &DVector::from_column_slice(voltages),
            &mut temperatures,
            T_AMB,
            0.01,
        );

        temperatures[&id]
    }

    fn assert_heats(comp_type: &str, value: f64, pins: &[&str], voltages: &[f64]) {
        let temperature = updated_temperature(component(comp_type, value, pins), voltages);
        assert!(
            temperature > T_AMB && temperature <= 500.0,
            "{comp_type} should heat above ambient, got {temperature} K"
        );
    }

    #[test]
    fn updates_diode_and_opto_temperatures() {
        assert_heats("diode", 0.0, &["1", "0"], &[0.7]);
        assert_heats("opto", 0.0, &["1", "0", "2", "0"], &[0.7, 5.0]);
    }

    #[test]
    fn updates_mos_and_bsim_temperatures() {
        for comp_type in ["nmos", "bsim3nmos", "bsim4nmos"] {
            assert_heats(comp_type, 1.0, &["1", "2", "0", "0"], &[5.0, 5.0]);
        }

        for comp_type in ["pmos", "bsim3pmos", "bsim4pmos"] {
            assert_heats(comp_type, -1.0, &["0", "1", "2", "0"], &[0.0, 5.0]);
        }
    }

    #[test]
    fn updates_bjt_temperatures() {
        assert_heats("npn", 100.0, &["1", "2", "0"], &[0.65, 5.0]);
        assert_heats("pnp", 100.0, &["1", "0", "2"], &[4.35, 5.0]);
    }
}
