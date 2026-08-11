use super::super::super::devices::*;
use super::super::super::transient_companions::stamp_companion_conductance;
use super::StampContext;
use crate::solver::types::ComponentData;

pub(super) fn stamp_jfet(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let dt = ctx.dt;
    let t_amb = ctx.t_amb;
    let prev_v = ctx.prev_v;
    let current_solution = ctx.current_solution;
    let mut matrix_a_iter = &mut *ctx.matrix_a_iter;
    let vector_z_iter = &mut *ctx.vector_z_iter;
    let is_njf = comp.comp_type == "njf";
    let node_drain = comp.pins[0].parse::<usize>().unwrap();
    let node_gate = comp.pins[1].parse::<usize>().unwrap();
    let node_source = comp.pins[2].parse::<usize>().unwrap();

    let v_drain = if node_drain > 0 {
        prev_v[node_drain]
    } else {
        0.0
    };
    let v_gate = if node_gate > 0 {
        prev_v[node_gate]
    } else {
        0.0
    };
    let v_source = if node_source > 0 {
        prev_v[node_source]
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
            * ((2.0 * vgst - 2.0 * vds) * (1.0 + lambda * vds) + vds * (2.0 * vgst - vds) * lambda);
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

    stamp_companion_conductance(&mut matrix_a_iter, node_drain, node_drain, gds_final);
    stamp_companion_conductance(&mut matrix_a_iter, node_source, node_source, gds_final);
    stamp_companion_conductance(&mut matrix_a_iter, node_drain, node_source, -gds_final);
    stamp_companion_conductance(&mut matrix_a_iter, node_source, node_drain, -gds_final);

    if node_drain > 0 {
        if node_gate > 0 {
            matrix_a_iter[(node_drain - 1, node_gate - 1)] += gm_final;
        }
        if node_source > 0 {
            matrix_a_iter[(node_drain - 1, node_source - 1)] -= gm_final;
        }
    }
    if node_source > 0 {
        if node_gate > 0 {
            matrix_a_iter[(node_source - 1, node_gate - 1)] -= gm_final;
        }
        if node_source > 0 {
            matrix_a_iter[(node_source - 1, node_source - 1)] += gm_final;
        }
    }

    if node_drain > 0 {
        vector_z_iter[node_drain - 1] -= ieq;
    }
    if node_source > 0 {
        vector_z_iter[node_source - 1] += ieq;
    }

    // Estampar capacitancias dinámicas de puerta GS y GD
    let vgd_raw = v_gate - v_drain;
    let (c_gs, c_gd) = get_jfet_capacitances(vgs_raw, vgd_raw, comp);
    let g_eq_gs = c_gs / dt;
    let g_eq_gd = c_gd / dt;

    let v_drain_prev = if node_drain > 0 {
        current_solution[node_drain - 1]
    } else {
        0.0
    };
    let v_gate_prev = if node_gate > 0 {
        current_solution[node_gate - 1]
    } else {
        0.0
    };
    let v_source_prev = if node_source > 0 {
        current_solution[node_source - 1]
    } else {
        0.0
    };

    let vgs_prev = v_gate_prev - v_source_prev;
    let vgd_prev = v_gate_prev - v_drain_prev;

    let i_eq_gs = g_eq_gs * vgs_prev;
    let i_eq_gd = g_eq_gd * vgd_prev;

    stamp_companion_conductance(&mut matrix_a_iter, node_gate, node_gate, g_eq_gs + g_eq_gd);
    stamp_companion_conductance(&mut matrix_a_iter, node_gate, node_source, -g_eq_gs);
    stamp_companion_conductance(&mut matrix_a_iter, node_source, node_gate, -g_eq_gs);
    stamp_companion_conductance(&mut matrix_a_iter, node_source, node_source, g_eq_gs);

    stamp_companion_conductance(&mut matrix_a_iter, node_gate, node_drain, -g_eq_gd);
    stamp_companion_conductance(&mut matrix_a_iter, node_drain, node_gate, -g_eq_gd);
    stamp_companion_conductance(&mut matrix_a_iter, node_drain, node_drain, g_eq_gd);

    if node_gate > 0 {
        vector_z_iter[node_gate - 1] += i_eq_gs + i_eq_gd;
    }
    if node_source > 0 {
        vector_z_iter[node_source - 1] -= i_eq_gs;
    }
    if node_drain > 0 {
        vector_z_iter[node_drain - 1] -= i_eq_gd;
    }

    // Fuga de compuerta en transitorio (utilizando t_amb para calcular vt local)
    let vt_local = (8.617333262e-5 * t_amb) / 1.0; // k_B * T / q
    let gate_is = 1e-14;
    let exp_gs = ((v_gate - v_source) / vt_local).exp();
    let gg_gs = (gate_is / vt_local) * exp_gs;
    let ieq_gs_d = gate_is * (exp_gs - 1.0) - gg_gs * (v_gate - v_source);

    stamp_companion_conductance(&mut matrix_a_iter, node_gate, node_gate, gg_gs);
    stamp_companion_conductance(&mut matrix_a_iter, node_source, node_source, gg_gs);
    stamp_companion_conductance(&mut matrix_a_iter, node_gate, node_source, -gg_gs);
    stamp_companion_conductance(&mut matrix_a_iter, node_source, node_gate, -gg_gs);
    if node_gate > 0 {
        vector_z_iter[node_gate - 1] -= ieq_gs_d;
    }
    if node_source > 0 {
        vector_z_iter[node_source - 1] += ieq_gs_d;
    }

    let exp_gd = ((v_gate - v_drain) / vt_local).exp();
    let gg_gd = (gate_is / vt_local) * exp_gd;
    let ieq_gd_d = gate_is * (exp_gd - 1.0) - gg_gd * (v_gate - v_drain);

    stamp_companion_conductance(&mut matrix_a_iter, node_gate, node_gate, gg_gd);
    stamp_companion_conductance(&mut matrix_a_iter, node_drain, node_drain, gg_gd);
    stamp_companion_conductance(&mut matrix_a_iter, node_gate, node_drain, -gg_gd);
    stamp_companion_conductance(&mut matrix_a_iter, node_drain, node_gate, -gg_gd);
    if node_gate > 0 {
        vector_z_iter[node_gate - 1] -= ieq_gd_d;
    }
    if node_drain > 0 {
        vector_z_iter[node_drain - 1] += ieq_gd_d;
    }
}
