use crate::solver::types::ComponentData;

use super::StampContext;

pub(super) fn stamp_jfet(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let prev_voltages = ctx.prev_voltages;
    let matrix_a = &mut *ctx.matrix_a;
    let vector_z = &mut *ctx.vector_z;
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
}
