use super::super::super::devices::*;
use super::super::super::transient_companions::stamp_companion_conductance;
use super::StampContext;
use crate::solver::types::ComponentData;

pub(super) fn stamp_bipolar(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let dt = ctx.dt;
    let t_amb = ctx.t_amb;
    let prev_v = ctx.prev_v;
    let prev_prev_v = ctx.prev_prev_v;
    let current_solution = ctx.current_solution;
    let device_tjunc = ctx.device_tjunc;
    let mut matrix_a_iter = &mut *ctx.matrix_a_iter;
    let vector_z_iter = &mut *ctx.vector_z_iter;
    let is_npn = comp.comp_type == "npn";
    let node_base = comp.pins[0].parse::<usize>().unwrap();
    let node_collector = comp.pins[1].parse::<usize>().unwrap();
    let node_emitter = comp.pins[2].parse::<usize>().unwrap();

    // Self-Heating: Is, Vt y β dependen de la temperatura de unión
    let tj_b = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
    let (vt_b, is_b) = get_thermal_parameters_junction(tj_b, comp.bjt_is);
    let beta_scale = (tj_b / PHYS_T).powf(BJT_BETA_EXPO);

    let v_base = if node_base > 0 {
        prev_v[node_base]
    } else {
        0.0
    };
    let v_collector = if node_collector > 0 {
        prev_v[node_collector]
    } else {
        0.0
    };
    let v_emitter = if node_emitter > 0 {
        prev_v[node_emitter]
    } else {
        0.0
    };

    let (vbe_new_raw, vbc_new_raw) = if is_npn {
        (v_base - v_emitter, v_base - v_collector)
    } else {
        (v_emitter - v_base, v_collector - v_base)
    };

    let v_base_old = if node_base > 0 {
        prev_prev_v[node_base]
    } else {
        0.0
    };
    let v_collector_old = if node_collector > 0 {
        prev_prev_v[node_collector]
    } else {
        0.0
    };
    let v_emitter_old = if node_emitter > 0 {
        prev_prev_v[node_emitter]
    } else {
        0.0
    };

    let (vbe_old_raw, vbc_old_raw) = if is_npn {
        (v_base_old - v_emitter_old, v_base_old - v_collector_old)
    } else {
        (v_emitter_old - v_base_old, v_collector_old - v_base_old)
    };

    let beta_f_base = comp
        .bjt_bf
        .unwrap_or(if comp.value <= 1.0 { 100.0 } else { comp.value });
    let beta_f = beta_f_base * beta_scale;
    let beta_r = 1.0;
    let alpha_f = beta_f / (beta_f + 1.0);
    let alpha_r = beta_r / (beta_r + 1.0);

    // Estimar corrientes de base y colector de la iteración previa para calcular caídas óhmicas
    // Damping preliminar de voltajes previos para cálculo seguro sin desbordamiento
    let vbe_prev_safe = pnjlim(vbe_old_raw, vbe_old_raw, vt_b, 0.6).min(0.95);
    let vbc_prev_safe = pnjlim(vbc_old_raw, vbc_old_raw, vt_b, 0.6).min(0.95);

    let exp_be_old = (vbe_prev_safe / vt_b).exp();
    let exp_bc_old = (vbc_prev_safe / vt_b).exp();
    let ide_old = is_b * (exp_be_old - 1.0);
    let idc_old = is_b * (exp_bc_old - 1.0);

    // Clampear corrientes previas a rangos físicos seguros para evitar oscilación numérica salvaje
    let ib_prev = (ide_old / (beta_f + 1.0) + idc_old / (beta_r + 1.0)).clamp(-0.01, 0.01);
    let ic_prev = (alpha_f * ide_old - idc_old).clamp(-0.1, 0.1);

    let r_b = comp.bjt_rb.unwrap_or(10.0);
    let r_c = comp.bjt_rc.unwrap_or(2.0);

    let vbe_new = vbe_new_raw - ib_prev * r_b;
    let vbc_new = vbc_new_raw - ic_prev * r_c;
    let vbe_old = vbe_old_raw - ib_prev * r_b;
    let vbc_old = vbc_old_raw - ic_prev * r_c;

    // Damping logarítmico suave (pnjlim) (Upgrade 4)
    let vbe = pnjlim(vbe_new, vbe_old, vt_b, 0.6);
    let vbc = pnjlim(vbc_new, vbc_old, vt_b, 0.6);

    // Multiplicador de Efecto Early directo en activo (Upgrade 3)
    let vce = if is_npn {
        v_collector - v_emitter
    } else {
        v_emitter - v_collector
    };
    let v_af = comp.bjt_vaf.unwrap_or(if is_npn { 100.0 } else { 50.0 });
    let k_early = 1.0 + vce.max(0.0) / v_af;

    let (ide_raw, gbe_raw, _ieq_be_raw) = evaluate_pn_junction(vbe, vt_b, is_b);
    let ide = ide_raw * k_early;
    let gbe = gbe_raw * k_early;
    let ieq_be = ide - gbe * vbe;

    let (idc_raw, gbc_raw, _ieq_bc_raw) = evaluate_pn_junction(vbc, vt_b, is_b);
    let idc = idc_raw * k_early;
    let gbc = gbc_raw * k_early;
    let ieq_bc = idc - gbc * vbc;

    let g_be_b = gbe / (beta_f + 1.0);
    let g_bc_b = gbc / (beta_r + 1.0);
    let ieq_b = ieq_be / (beta_f + 1.0) + ieq_bc / (beta_r + 1.0);

    let ieq_c = alpha_f * ieq_be - ieq_bc;
    let ieq_e = ieq_be - alpha_r * ieq_bc;

    // Estampar capacidades parásitas dinámicas del BJT (Fase 16)
    let c_be = get_bjt_be_capacitance(vbe, gbe, comp);
    let c_bc = get_bjt_bc_capacitance(vbc, gbc, comp);
    let g_eq_be = c_be / dt;
    let g_eq_bc = c_bc / dt;

    let v_base_prev = if node_base > 0 {
        current_solution[node_base - 1]
    } else {
        0.0
    };
    let v_collector_prev = if node_collector > 0 {
        current_solution[node_collector - 1]
    } else {
        0.0
    };
    let v_emitter_prev = if node_emitter > 0 {
        current_solution[node_emitter - 1]
    } else {
        0.0
    };

    let vbe_prev = if is_npn {
        v_base_prev - v_emitter_prev
    } else {
        v_emitter_prev - v_base_prev
    };
    let vbc_prev = if is_npn {
        v_base_prev - v_collector_prev
    } else {
        v_collector_prev - v_base_prev
    };

    let i_eq_be = g_eq_be * vbe_prev;
    let i_eq_bc = g_eq_bc * vbc_prev;

    if is_npn {
        stamp_companion_conductance(&mut matrix_a_iter, node_base, node_base, g_be_b + g_bc_b);
        stamp_companion_conductance(&mut matrix_a_iter, node_base, node_emitter, -g_be_b);
        stamp_companion_conductance(&mut matrix_a_iter, node_base, node_collector, -g_bc_b);
        if node_base > 0 {
            vector_z_iter[node_base - 1] -= ieq_b;
        }

        if node_collector > 0 {
            if node_base > 0 {
                matrix_a_iter[(node_collector - 1, node_base - 1)] += alpha_f * gbe - gbc;
            }
            if node_emitter > 0 {
                matrix_a_iter[(node_collector - 1, node_emitter - 1)] -= alpha_f * gbe;
            }
            matrix_a_iter[(node_collector - 1, node_collector - 1)] += gbc;
            vector_z_iter[node_collector - 1] -= ieq_c;
        }

        if node_emitter > 0 {
            if node_base > 0 {
                matrix_a_iter[(node_emitter - 1, node_base - 1)] -= gbe - alpha_r * gbc;
            }
            matrix_a_iter[(node_emitter - 1, node_emitter - 1)] += gbe;
            if node_collector > 0 {
                matrix_a_iter[(node_emitter - 1, node_collector - 1)] -= alpha_r * gbc;
            }
            vector_z_iter[node_emitter - 1] += ieq_e;
        }

        // Estampado reactivo parásito BE y BC NPN
        stamp_companion_conductance(&mut matrix_a_iter, node_base, node_base, g_eq_be + g_eq_bc);
        stamp_companion_conductance(&mut matrix_a_iter, node_emitter, node_emitter, g_eq_be);
        stamp_companion_conductance(&mut matrix_a_iter, node_collector, node_collector, g_eq_bc);
        stamp_companion_conductance(&mut matrix_a_iter, node_base, node_emitter, -g_eq_be);
        stamp_companion_conductance(&mut matrix_a_iter, node_emitter, node_base, -g_eq_be);
        stamp_companion_conductance(&mut matrix_a_iter, node_base, node_collector, -g_eq_bc);
        stamp_companion_conductance(&mut matrix_a_iter, node_collector, node_base, -g_eq_bc);

        if node_base > 0 {
            vector_z_iter[node_base - 1] += i_eq_be + i_eq_bc;
        }
        if node_emitter > 0 {
            vector_z_iter[node_emitter - 1] -= i_eq_be;
        }
        if node_collector > 0 {
            vector_z_iter[node_collector - 1] -= i_eq_bc;
        }
    } else {
        stamp_companion_conductance(&mut matrix_a_iter, node_base, node_base, g_be_b + g_bc_b);
        stamp_companion_conductance(&mut matrix_a_iter, node_base, node_emitter, -g_be_b);
        stamp_companion_conductance(&mut matrix_a_iter, node_base, node_collector, -g_bc_b);
        if node_base > 0 {
            vector_z_iter[node_base - 1] += ieq_b;
        }

        if node_collector > 0 {
            if node_base > 0 {
                matrix_a_iter[(node_collector - 1, node_base - 1)] += alpha_f * gbe - gbc;
            }
            if node_emitter > 0 {
                matrix_a_iter[(node_collector - 1, node_emitter - 1)] -= alpha_f * gbe;
            }
            matrix_a_iter[(node_collector - 1, node_collector - 1)] += gbc;
            vector_z_iter[node_collector - 1] += ieq_c;
        }

        if node_emitter > 0 {
            if node_base > 0 {
                matrix_a_iter[(node_emitter - 1, node_base - 1)] -= gbe - alpha_r * gbc;
            }
            matrix_a_iter[(node_emitter - 1, node_emitter - 1)] += gbe;
            if node_collector > 0 {
                matrix_a_iter[(node_emitter - 1, node_collector - 1)] -= alpha_r * gbc;
            }
            vector_z_iter[node_emitter - 1] += ieq_e;
        }

        // Estampado reactivo parásito BE y BC PNP
        stamp_companion_conductance(&mut matrix_a_iter, node_base, node_base, g_eq_be + g_eq_bc);
        stamp_companion_conductance(&mut matrix_a_iter, node_emitter, node_emitter, g_eq_be);
        stamp_companion_conductance(&mut matrix_a_iter, node_collector, node_collector, g_eq_bc);
        stamp_companion_conductance(&mut matrix_a_iter, node_base, node_emitter, -g_eq_be);
        stamp_companion_conductance(&mut matrix_a_iter, node_emitter, node_base, -g_eq_be);
        stamp_companion_conductance(&mut matrix_a_iter, node_base, node_collector, -g_eq_bc);
        stamp_companion_conductance(&mut matrix_a_iter, node_collector, node_base, -g_eq_bc);

        if node_base > 0 {
            vector_z_iter[node_base - 1] -= i_eq_be + i_eq_bc;
        }
        if node_emitter > 0 {
            vector_z_iter[node_emitter - 1] += i_eq_be;
        }
        if node_collector > 0 {
            vector_z_iter[node_collector - 1] += i_eq_bc;
        }
    }
}
