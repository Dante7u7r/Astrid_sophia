use super::super::super::devices::*;
use super::StampContext;
use crate::solver::types::ComponentData;

pub(super) fn stamp_diode(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let dt = ctx.dt;
    let t_amb = ctx.t_amb;
    let prev_v = ctx.prev_v;
    let prev_prev_v = ctx.prev_prev_v;
    let current_solution = ctx.current_solution;
    let device_tjunc = ctx.device_tjunc;
    let matrix_a_iter = &mut *ctx.matrix_a_iter;
    let vector_z_iter = &mut *ctx.vector_z_iter;
    let node_anode = comp.pins[0].parse::<usize>().unwrap();
    let node_cathode = comp.pins[1].parse::<usize>().unwrap();

    // Self-Heating: usar temperatura de unión per-device en lugar de T global
    let tj_d = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
    let (vt_d, _is_d) = get_thermal_parameters_junction(tj_d, comp.diode_is);
    let _comp_n = comp.diode_n.unwrap_or(DIODE_N);

    let v_anode = if node_anode > 0 {
        prev_v[node_anode]
    } else {
        0.0
    };
    let v_cathode = if node_cathode > 0 {
        prev_v[node_cathode]
    } else {
        0.0
    };

    let vd_new = v_anode - v_cathode;

    let v_anode_old = if node_anode > 0 {
        prev_prev_v[node_anode]
    } else {
        0.0
    };
    let v_cathode_old = if node_cathode > 0 {
        prev_prev_v[node_cathode]
    } else {
        0.0
    };
    let vd_old = v_anode_old - v_cathode_old;

    let vd = pnjlim(vd_new, vd_old, vt_d, 0.6);

    let (_, id, geq) = solve_diode_junction_voltage(vd, Some(tj_d), comp);
    let ieq = id - geq * vd;

    // Estampar capacidad dinámica del diodo (difusión + deplexión) utilizando modelo cuasi-estático
    let v_anode_prev = if node_anode > 0 {
        current_solution[node_anode - 1]
    } else {
        0.0
    };
    let v_cathode_prev = if node_cathode > 0 {
        current_solution[node_cathode - 1]
    } else {
        0.0
    };
    let vd_prev = v_anode_prev - v_cathode_prev;

    let (vd_prev_j, _, geq_prev_int) = solve_diode_junction_voltage(vd_prev, Some(tj_d), comp);
    let rs = comp.diode_rs.unwrap_or(0.0);
    let gd_prev = if rs > 0.0 {
        let factor = 1.0 - geq_prev_int * rs;
        if factor > 1e-6 {
            geq_prev_int / factor
        } else {
            geq_prev_int
        }
    } else {
        geq_prev_int
    };
    let c_d = get_diode_capacitance_param(vd_prev_j, gd_prev, comp);
    let g_eq_d = c_d / dt;
    let i_eq_cd = g_eq_d * vd_prev;

    let mut stamp_conductance = |r: usize, c: usize, g: f64| {
        if r > 0 && c > 0 {
            matrix_a_iter[(r - 1, c - 1)] += g;
        }
    };

    stamp_conductance(node_anode, node_anode, geq + g_eq_d);
    stamp_conductance(node_cathode, node_cathode, geq + g_eq_d);
    stamp_conductance(node_anode, node_cathode, -geq - g_eq_d);
    stamp_conductance(node_cathode, node_anode, -geq - g_eq_d);

    if node_anode > 0 {
        vector_z_iter[node_anode - 1] -= ieq - i_eq_cd;
    }
    if node_cathode > 0 {
        vector_z_iter[node_cathode - 1] += ieq - i_eq_cd;
    }
}

pub(super) fn stamp_opto(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let t_amb = ctx.t_amb;
    let prev_v = ctx.prev_v;
    let prev_prev_v = ctx.prev_prev_v;
    let device_tjunc = ctx.device_tjunc;
    let matrix_a_iter = &mut *ctx.matrix_a_iter;
    let vector_z_iter = &mut *ctx.vector_z_iter;
    if comp.pins.len() < 4 {
        return;
    }
    let node_a = comp.pins[0].parse::<usize>().unwrap();
    let node_k = comp.pins[1].parse::<usize>().unwrap();
    let node_c = comp.pins[2].parse::<usize>().unwrap();
    let node_e = comp.pins[3].parse::<usize>().unwrap();

    // Self-Heating: el opto comparte un único nodo térmico (DIP-4)
    let tj_o = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
    let (vt_o, _is_o) = get_thermal_parameters_junction(tj_o, comp.opto_is);

    let v_a = if node_a > 0 { prev_v[node_a] } else { 0.0 };
    let v_k = if node_k > 0 { prev_v[node_k] } else { 0.0 };
    let v_c = if node_c > 0 { prev_v[node_c] } else { 0.0 };
    let v_e = if node_e > 0 { prev_v[node_e] } else { 0.0 };

    let vd_new = v_a - v_k;
    let vd_old = (if node_a > 0 { prev_prev_v[node_a] } else { 0.0 })
        - (if node_k > 0 { prev_prev_v[node_k] } else { 0.0 });
    let vd = pnjlim(vd_new, vd_old, vt_o, 0.6);
    let (_, id_led, gd_led) = solve_diode_junction_voltage(vd, Some(tj_o), comp);
    let ieq_led = id_led - gd_led * vd;

    let v_ce = v_c - v_e;
    let (_i_ce, g_md, g_o, i_ce_eq) = evaluate_opto_receiver(vd, gd_led, id_led, v_ce, comp);

    let mut stamp = |r: usize, c: usize, g: f64| {
        if r > 0 && c > 0 {
            matrix_a_iter[(r - 1, c - 1)] += g;
        }
    };

    // Lado LED
    stamp(node_a, node_a, gd_led);
    stamp(node_k, node_k, gd_led);
    stamp(node_a, node_k, -gd_led);
    stamp(node_k, node_a, -gd_led);
    if node_a > 0 {
        vector_z_iter[node_a - 1] -= ieq_led;
    }
    if node_k > 0 {
        vector_z_iter[node_k - 1] += ieq_led;
    }

    // Lado receptor
    stamp(node_c, node_a, g_md);
    stamp(node_c, node_k, -g_md);
    stamp(node_c, node_c, g_o);
    stamp(node_c, node_e, -g_o);
    stamp(node_e, node_a, -g_md);
    stamp(node_e, node_k, g_md);
    stamp(node_e, node_c, -g_o);
    stamp(node_e, node_e, g_o);
    if node_c > 0 {
        vector_z_iter[node_c - 1] -= i_ce_eq;
    }
    if node_e > 0 {
        vector_z_iter[node_e - 1] += i_ce_eq;
    }
}
