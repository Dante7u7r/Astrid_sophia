use crate::solver::types::ComponentData;

use super::super::super::super::devices::{evaluate_pn_junction, get_thermal_parameters, pnjlim};
use super::StampContext;

pub(super) fn stamp_bipolar(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let netlist = ctx.netlist;
    let vt = ctx.vt;
    let is_temp = ctx.is_temp;
    let prev_voltages = ctx.prev_voltages;
    let prev_prev_voltages = ctx.prev_prev_voltages;
    let matrix_a = &mut *ctx.matrix_a;
    let vector_z = &mut *ctx.vector_z;
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

    let beta_f = comp
        .bjt_bf
        .unwrap_or(if comp.value <= 1.0 { 100.0 } else { comp.value });
    let beta_r = 1.0;
    let alpha_f = beta_f / (beta_f + 1.0);
    let alpha_r = beta_r / (beta_r + 1.0);

    let vbe_prev_safe = pnjlim(vbe_old_raw, vbe_old_raw, vt, 0.6).min(0.95);
    let vbc_prev_safe = pnjlim(vbc_old_raw, vbc_old_raw, vt, 0.6).min(0.95);

    let exp_be_old = (vbe_prev_safe / vt).exp();
    let exp_bc_old = (vbc_prev_safe / vt).exp();
    let ide_old = bjt_is_val * (exp_be_old - 1.0);
    let idc_old = bjt_is_val * (exp_bc_old - 1.0);

    let ib_prev = (ide_old / (beta_f + 1.0) + idc_old / (beta_r + 1.0)).clamp(-0.01, 0.01);
    let ic_prev = (alpha_f * ide_old - idc_old).clamp(-0.1, 0.1);

    let r_b = comp.bjt_rb.unwrap_or(10.0);
    let r_c = comp.bjt_rc.unwrap_or(2.0);

    let vbe_new = vbe_new_raw - ib_prev * r_b;
    let vbc_new = vbc_new_raw - ic_prev * r_c;
    let vbe_old = vbe_old_raw - ib_prev * r_b;
    let vbc_old = vbc_old_raw - ic_prev * r_c;

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
                matrix_a.add_element(node_collector - 1, node_base - 1, alpha_f * gbe - gbc);
            }
            if node_emitter > 0 {
                matrix_a.add_element(node_collector - 1, node_emitter - 1, -alpha_f * gbe);
            }
            matrix_a.add_element(node_collector - 1, node_collector - 1, gbc);
            vector_z[node_collector - 1] -= ieq_c;
        }

        if node_emitter > 0 {
            if node_base > 0 {
                matrix_a.add_element(node_emitter - 1, node_base - 1, -(gbe - alpha_r * gbc));
            }
            matrix_a.add_element(node_emitter - 1, node_emitter - 1, gbe);
            if node_collector > 0 {
                matrix_a.add_element(node_emitter - 1, node_collector - 1, -alpha_r * gbc);
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
                matrix_a.add_element(node_collector - 1, node_base - 1, alpha_f * gbe - gbc);
            }
            if node_emitter > 0 {
                matrix_a.add_element(node_collector - 1, node_emitter - 1, -alpha_f * gbe);
            }
            matrix_a.add_element(node_collector - 1, node_collector - 1, gbc);
            vector_z[node_collector - 1] += ieq_c;
        }

        if node_emitter > 0 {
            if node_base > 0 {
                matrix_a.add_element(node_emitter - 1, node_base - 1, -(gbe - alpha_r * gbc));
            }
            matrix_a.add_element(node_emitter - 1, node_emitter - 1, gbe);
            if node_collector > 0 {
                matrix_a.add_element(node_emitter - 1, node_collector - 1, -alpha_r * gbc);
            }
            vector_z[node_emitter - 1] += ieq_e;
        }
    }
}
