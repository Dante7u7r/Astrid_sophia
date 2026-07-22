use crate::solver::types::ComponentData;

use super::StampContext;

pub(super) fn stamp_jfet(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let vt = ctx.vt;
    let prev_voltages = ctx.prev_voltages;
    let matrix_a = &mut *ctx.matrix_a;
    let vector_z = &mut *ctx.vector_z;
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
}
