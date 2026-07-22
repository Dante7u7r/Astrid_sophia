use crate::solver::matrix::{ComplexSparseMatrix, SparseMatrix};
use crate::solver::types::{CircuitNetlist, ComponentData};
use nalgebra::DVector;
use num_complex::Complex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::super::dc::solve_dc_circuit_with_guess;
use super::super::devices::{
    evaluate_bsim3_nmos, evaluate_bsim3_pmos, evaluate_bsim4_nmos, evaluate_bsim4_pmos,
    evaluate_opto_receiver, get_thermal_parameters, solve_diode_junction_voltage, DIODE_N,
};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AcSweepSettings {
    pub f_start: f64,
    pub f_end: f64,
    pub points_per_decade: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub op_guess: Option<Vec<f64>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AcSweepResult {
    pub frequencies: Vec<f64>,
    pub node_amplitudes: HashMap<String, Vec<f64>>,
    pub node_phases: HashMap<String, Vec<f64>>,
    pub error_log: Option<String>,
}

pub fn solve_ac_sweep(
    netlist: &CircuitNetlist,
    settings: &AcSweepSettings,
) -> Result<AcSweepResult, String> {
    let n = crate::topology::validate_netlist_topology(netlist, true)?;
    let (vt, is_temp) = get_thermal_parameters(netlist.temperature, None);

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

    // Resolver Punto de Operación (OP) DC para linealizar diodos y transistores NMOS
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

    // Generar vector de frecuencias logarítmicas
    let mut frequencies = Vec::new();
    let mut f = settings.f_start;
    let ratio = 10.0f64.powf(1.0 / settings.points_per_decade as f64);
    while f <= settings.f_end * 1.001 {
        frequencies.push(f);
        f *= ratio;
    }

    let mut node_amplitudes: HashMap<String, Vec<f64>> = HashMap::new();
    let mut node_phases: HashMap<String, Vec<f64>> = HashMap::new();

    node_amplitudes.insert("0".to_string(), vec![0.0; frequencies.len()]);
    node_phases.insert("0".to_string(), vec![0.0; frequencies.len()]);
    for i in 1..=n {
        node_amplitudes.insert(i.to_string(), Vec::new());
        node_phases.insert(i.to_string(), Vec::new());
    }

    struct AcFrequencyResult {
        _f_val: f64,
        node_vals: Vec<(String, f64, f64)>, // (node_name, amplitude_db, phase_deg)
    }

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

            Ok(AcFrequencyResult {
                _f_val: f_val,
                node_vals,
            })
        })
        .collect::<Result<Vec<AcFrequencyResult>, String>>()?;

    for res in results {
        for (node_name, amp, phase) in res.node_vals {
            node_amplitudes.get_mut(&node_name).unwrap().push(amp);
            node_phases.get_mut(&node_name).unwrap().push(phase);
        }
    }

    Ok(AcSweepResult {
        frequencies,
        node_amplitudes,
        node_phases,
        error_log: None,
    })
}
