use super::super::super::devices::*;
use super::super::super::transient_companions::stamp_companion_conductance;
use super::StampContext;
use crate::solver::types::ComponentData;

pub(super) fn stamp_nmos(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let dt = ctx.dt;
    let t_amb = ctx.t_amb;
    let prev_v = ctx.prev_v;
    let current_solution = ctx.current_solution;
    let device_tjunc = ctx.device_tjunc;
    let matrix_a_iter = &mut *ctx.matrix_a_iter;
    let vector_z_iter = &mut *ctx.vector_z_iter;
    let node_gate = comp.pins[0].parse::<usize>().unwrap();
    let node_drain = comp.pins[1].parse::<usize>().unwrap();
    let node_source = comp.pins[2].parse::<usize>().unwrap();
    let node_bulk = if comp.pins.len() >= 4 {
        comp.pins[3].parse::<usize>().unwrap_or(0)
    } else {
        0
    };

    let v_gate = if node_gate > 0 {
        prev_v[node_gate]
    } else {
        0.0
    };
    let v_drain = if node_drain > 0 {
        prev_v[node_drain]
    } else {
        0.0
    };
    let v_source = if node_source > 0 {
        prev_v[node_source]
    } else {
        0.0
    };
    let v_bulk = if node_bulk > 0 {
        prev_v[node_bulk]
    } else {
        0.0
    };

    let vgs = v_gate - v_source;
    let raw_vds = v_drain - v_source;
    let mut vds = raw_vds;
    if vds < 0.0 && comp.comp_type != "sic_mosfet" && comp.comp_type != "gan_hemt" && comp.comp_type != "igbt" {
        vds = 0.0;
    }
    let vbs = v_bulk - v_source;

    // Self-Heating: Vth y Kn dependen de la temperatura de unión
    let tj_m = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
    let vth_0 = comp.value;
    let vth = vth_0 + MOS_VTH_TC * (tj_m - PHYS_T);
    let kn_0 = 0.02;
    let kn = kn_0 * (tj_m / PHYS_T).powf(MOS_MOBILITY_EXPO);
    let lambda = 0.02;
    let vt = (PHYS_KB * tj_m) / PHYS_Q;

    let (ids, gm, gds, igs, gg, c_gs, c_gd, c_ds) = if comp.comp_type == "igbt" {
        let params = IgbtParams {
            vth: if comp.value > 0.0 { comp.value } else { 5.0 },
            kp: comp.igbt_kp.unwrap_or(12.0),
            alpha_pnp: comp.igbt_alpha.unwrap_or(0.55),
            tau_hl: comp.igbt_tau.unwrap_or(1.8e-6),
            wb0: comp.igbt_wb.unwrap_or(90e-6),
            cge: comp.igbt_cge.unwrap_or(2.2e-9),
            cgc0: comp.igbt_cgc.unwrap_or(180e-12),
            ..IgbtParams::default()
        };
        let res = evaluate_igbt(vgs, raw_vds, &params, Some(tj_m - 273.15), None, Some(dt));
        (res.ic, res.gm, res.go, 0.0, 1e-12, res.cge, res.cgc, res.cce)
    } else if comp.comp_type == "sic_mosfet" {
        let params = SicMosfetParams {
            vth: if comp.value > 0.0 { comp.value } else { 3.0 },
            rds_on: comp.ron.unwrap_or(0.065),
            ..SicMosfetParams::default()
        };
        let res = evaluate_sic_mosfet(vgs, raw_vds, tj_m, &params);
        (res.ids, res.gm, res.gds, 0.0, 1e-12, res.cgs, res.cgd, res.cds)
    } else if comp.comp_type == "gan_hemt" {
        let params = GanHemtParams {
            vth: if comp.value > 0.0 { comp.value } else { 1.5 },
            rds_on: comp.ron.unwrap_or(0.035),
            ..GanHemtParams::default()
        };
        let res = evaluate_gan_hemt(vgs, raw_vds, tj_m, &params);
        (res.ids, res.gm, res.gds, 0.0, 1e-12, res.cgs, res.cgd, res.cds)
    } else if comp.comp_type == "bsim4nmos" {
        let (i, g_m, g_ds, _gmb, i_g, g_g) =
            evaluate_bsim4_nmos(vgs, vds, vbs, comp.value, comp.w, comp.l, Some(tj_m), Some(comp));
        let toxe = comp.bsim_toxe.or(comp.bsim_tox).unwrap_or(1.4e-9);
        let (cgs, cgd, cds) = evaluate_bsim4_capacitances(
            vgs,
            vds,
            vbs,
            comp.bsim_vth0.unwrap_or(if comp.value != 0.0 { comp.value } else { 0.35 }),
            comp.w.unwrap_or(1.0e-6),
            comp.l.unwrap_or(0.045e-6),
            toxe,
            Some(comp),
        );
        (i, g_m, g_ds, i_g, g_g, cgs, cgd, cds)
    } else if comp.comp_type == "bsim3nmos" {
        let (ids_v, gm_v, gds_v) =
            evaluate_bsim3_nmos(vgs, vds, vbs, comp.value, comp.w, comp.l, Some(tj_m), Some(comp));
        let (cgs, cgd, cds) = evaluate_bsim3_capacitances(
            vgs,
            vds,
            vbs,
            comp.value,
            comp.w.unwrap_or(10.0e-6),
            comp.l.unwrap_or(0.18e-6),
            comp.bsim_tox.unwrap_or(4.0e-9),
        );
        (ids_v, gm_v, gds_v, 0.0, 1e-12, cgs, cgd, cds)
    } else if vgs <= vth {
        let i_sub0 = 1e-7;
        let n_factor = 1.5;
        let exp_sub = ((vgs - vth) / (n_factor * vt)).exp();
        let exp_vds = (-vds.max(0.0) / vt).exp();
        let sub_factor = 1.0 - exp_vds;

        let ids_val = i_sub0 * exp_sub * sub_factor * (1.0 + lambda * vds);
        let gm_val = ids_val / (n_factor * vt);
        let gds_val =
            i_sub0 * exp_sub * ((exp_vds / vt) * (1.0 + lambda * vds) + sub_factor * lambda);
        let (cgs, cgd, cds) = get_nmos_capacitances(vgs, vds, vth, comp.w, comp.l, comp.mos_cgs, comp.mos_cgd);
        (ids_val, gm_val, gds_val.max(1e-9), 0.0, 1e-12, cgs, cgd, cds)
    } else if vds < vgs - vth {
        // Región de Triodo con canal corto
        let factor_early = 1.0 + lambda * vds;
        let triode_curr = kn * (2.0 * (vgs - vth) * vds - vds * vds);

        let ids_val = triode_curr * factor_early;
        let gm_val = (2.0 * kn * vds) * factor_early;
        let gds_val = (2.0 * kn * (vgs - vth - vds)) * factor_early + triode_curr * lambda;
        let (cgs, cgd, cds) = get_nmos_capacitances(vgs, vds, vth, comp.w, comp.l, comp.mos_cgs, comp.mos_cgd);
        (ids_val, gm_val, gds_val.max(1e-9), 0.0, 1e-12, cgs, cgd, cds)
    } else {
        // Región de Saturación con canal corto
        let factor_early = 1.0 + lambda * vds;
        let sat_curr = kn * (vgs - vth) * (vgs - vth);

        let ids_val = sat_curr * factor_early;
        let gm_val = (2.0 * kn * (vgs - vth)) * factor_early;
        let gds_val = sat_curr * lambda;
        let (cgs, cgd, cds) = get_nmos_capacitances(vgs, vds, vth, comp.w, comp.l, comp.mos_cgs, comp.mos_cgd);
        (ids_val, gm_val, gds_val.max(1e-9), 0.0, 1e-12, cgs, cgd, cds)
    };

    let ieq = ids - gm * vgs - gds * vds;
    let ieq_g = igs - gg * vgs;

    // Estampar capacidades parásitas (Fase 13)
    let g_eq_gs = c_gs / dt;
    let g_eq_gd = c_gd / dt;
    let g_eq_ds = c_ds / dt;

    let v_gate_prev = if node_gate > 0 {
        current_solution[node_gate - 1]
    } else {
        0.0
    };
    let v_drain_prev = if node_drain > 0 {
        current_solution[node_drain - 1]
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
    let vds_prev = v_drain_prev - v_source_prev;

    let i_eq_gs = g_eq_gs * vgs_prev;
    let i_eq_gd = g_eq_gd * vgd_prev;
    let i_eq_ds = g_eq_ds * vds_prev;

    stamp_companion_conductance(
        matrix_a_iter,
        node_drain,
        node_drain,
        gds + g_eq_gd + g_eq_ds,
    );
    stamp_companion_conductance(
        matrix_a_iter,
        node_source,
        node_source,
        gds + g_eq_gs + g_eq_ds + gg,
    );
    stamp_companion_conductance(matrix_a_iter, node_drain, node_source, -gds - g_eq_ds);
    stamp_companion_conductance(matrix_a_iter, node_source, node_drain, -gds - g_eq_ds);

    stamp_companion_conductance(
        matrix_a_iter,
        node_gate,
        node_gate,
        g_eq_gs + g_eq_gd + gg,
    );
    stamp_companion_conductance(matrix_a_iter, node_gate, node_source, -g_eq_gs - gg);
    stamp_companion_conductance(matrix_a_iter, node_source, node_gate, -g_eq_gs - gg);
    stamp_companion_conductance(matrix_a_iter, node_gate, node_drain, -g_eq_gd);
    stamp_companion_conductance(matrix_a_iter, node_drain, node_gate, -g_eq_gd);

    if node_drain > 0 {
        if node_gate > 0 {
            matrix_a_iter[(node_drain - 1, node_gate - 1)] += gm;
        }
        if node_source > 0 {
            matrix_a_iter[(node_drain - 1, node_source - 1)] -= gm;
        }
    }
    if node_source > 0 {
        if node_gate > 0 {
            matrix_a_iter[(node_source - 1, node_gate - 1)] -= gm;
        }
        if node_source > 0 {
            matrix_a_iter[(node_source - 1, node_source - 1)] += gm;
        }
    }

    if node_drain > 0 {
        vector_z_iter[node_drain - 1] += -ieq - i_eq_gd + i_eq_ds;
    }
    if node_source > 0 {
        vector_z_iter[node_source - 1] += ieq - i_eq_gs - i_eq_ds + ieq_g;
    }
    if node_gate > 0 {
        vector_z_iter[node_gate - 1] += i_eq_gs + i_eq_gd - ieq_g;
    }
}

pub(super) fn stamp_pmos(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let dt = ctx.dt;
    let t_amb = ctx.t_amb;
    let prev_v = ctx.prev_v;
    let current_solution = ctx.current_solution;
    let device_tjunc = ctx.device_tjunc;
    let matrix_a_iter = &mut *ctx.matrix_a_iter;
    let vector_z_iter = &mut *ctx.vector_z_iter;
    let node_gate = comp.pins[0].parse::<usize>().unwrap();
    let node_drain = comp.pins[1].parse::<usize>().unwrap();
    let node_source = comp.pins[2].parse::<usize>().unwrap();
    let node_bulk = if comp.pins.len() >= 4 {
        comp.pins[3].parse::<usize>().unwrap_or(0)
    } else {
        0
    };

    let v_gate = if node_gate > 0 {
        prev_v[node_gate]
    } else {
        0.0
    };
    let v_drain = if node_drain > 0 {
        prev_v[node_drain]
    } else {
        0.0
    };
    let v_source = if node_source > 0 {
        prev_v[node_source]
    } else {
        0.0
    };
    let v_bulk = if node_bulk > 0 {
        prev_v[node_bulk]
    } else {
        0.0
    };

    let vsg = v_source - v_gate;
    let mut vsd = v_source - v_drain;
    if vsd < 0.0 {
        vsd = 0.0;
    }
    let vsb = v_source - v_bulk;

    // Self-Heating: Vth y Kp dependen de la temperatura de unión
    let tj_p = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
    let vth_0 = if comp.value == 0.0 { -1.5 } else { comp.value };
    let vth_abs = -(vth_0 + MOS_VTH_TC * (tj_p - PHYS_T));
    let kp_0 = 0.02;
    let kp = kp_0 * (tj_p / PHYS_T).powf(MOS_MOBILITY_EXPO);
    let lambda = 0.02;
    let vt = (PHYS_KB * tj_p) / PHYS_Q;

    let (isd, gm_sd, gds_cond, igs, gg) = if comp.comp_type == "bsim4pmos" {
        let (isd_v, gm_v, gds_v, _gmb_v, igs_v, gg_v) =
            evaluate_bsim4_pmos(vsg, vsd, vsb, comp.value, comp.w, comp.l, Some(tj_p), Some(comp));
        (isd_v, gm_v, gds_v, igs_v, gg_v)
    } else if comp.comp_type == "bsim3pmos" {
        let (isd_v, gm_v, gds_v) =
            evaluate_bsim3_pmos(vsg, vsd, vsb, comp.value, comp.w, comp.l, Some(tj_p), Some(comp));
        (isd_v, gm_v, gds_v, 0.0, 1e-12)
    } else if vsg <= vth_abs {
        // Conducción débil subumbral (weak inversion) PMOS
        let i_sub0 = 1e-7;
        let n_factor = 1.5;
        let exp_sub = ((vsg - vth_abs) / (n_factor * vt)).exp();
        let exp_vsd = (-vsd.max(0.0) / vt).exp();
        let sub_factor = 1.0 - exp_vsd;

        let isd_val = i_sub0 * exp_sub * sub_factor * (1.0 + lambda * vsd);
        let gm_sd_val = isd_val / (n_factor * vt);
        let gds_cond_val =
            i_sub0 * exp_sub * ((exp_vsd / vt) * (1.0 + lambda * vsd) + sub_factor * lambda);

        (isd_val, gm_sd_val, gds_cond_val.max(1e-9), 0.0, 1e-12)
    } else if vsd < vsg - vth_abs {
        // Triodo PMOS con canal corto
        let factor_early = 1.0 + lambda * vsd;
        let triode_curr = kp * (2.0 * (vsg - vth_abs) * vsd - vsd * vsd);

        let isd_val = triode_curr * factor_early;
        let gm_sd_val = (2.0 * kp * vsd) * factor_early;
        let gds_cond_val = (2.0 * kp * (vsg - vth_abs - vsd)) * factor_early + triode_curr * lambda;

        (isd_val, gm_sd_val, gds_cond_val.max(1e-9), 0.0, 1e-12)
    } else {
        // Saturación PMOS con canal corto
        let factor_early = 1.0 + lambda * vsd;
        let sat_curr = kp * (vsg - vth_abs) * (vsg - vth_abs);

        let isd_val = sat_curr * factor_early;
        let gm_sd_val = (2.0 * kp * (vsg - vth_abs)) * factor_early;
        let gds_cond_val = sat_curr * lambda;

        (isd_val, gm_sd_val, gds_cond_val.max(1e-9), 0.0, 1e-12)
    };

    let ieq_sd = isd - gm_sd * vsg - gds_cond * vsd;
    let ieq_g = igs - gg * vsg;

    // Estampar capacidades parásitas (Fase 13)
    let (c_sg, c_sd, c_gd) = if comp.comp_type == "bsim4pmos" {
        let toxe = comp.bsim_toxe.or(comp.bsim_tox).unwrap_or(1.4e-9);
        evaluate_bsim4_capacitances(
            vsg,
            vsd,
            vsb,
            comp.bsim_vth0.unwrap_or(if comp.value != 0.0 { comp.value.abs() } else { 0.35 }),
            comp.w.unwrap_or(1.0e-6),
            comp.l.unwrap_or(0.045e-6),
            toxe,
            Some(comp),
        )
    } else if comp.comp_type == "bsim3pmos" {
        evaluate_bsim3_capacitances(
            vsg,
            vsd,
            vsb,
            comp.value.abs(),
            comp.w.unwrap_or(10.0e-6),
            comp.l.unwrap_or(0.18e-6),
            comp.bsim_tox.unwrap_or(4.0e-9),
        )
    } else {
        get_pmos_capacitances(
            vsg,
            vsd,
            vth_abs,
            comp.w,
            comp.l,
            comp.mos_cgs,
            comp.mos_cgd,
        )
    };
    let g_eq_sg = c_sg / dt;
    let g_eq_sd = c_sd / dt;
    let g_eq_gd = c_gd / dt;

    let v_gate_prev = if node_gate > 0 {
        current_solution[node_gate - 1]
    } else {
        0.0
    };
    let v_drain_prev = if node_drain > 0 {
        current_solution[node_drain - 1]
    } else {
        0.0
    };
    let v_source_prev = if node_source > 0 {
        current_solution[node_source - 1]
    } else {
        0.0
    };
    let vsg_prev = v_source_prev - v_gate_prev;
    let vsd_prev = v_source_prev - v_drain_prev;
    let vgd_prev = v_gate_prev - v_drain_prev;

    let i_eq_sg = g_eq_sg * vsg_prev;
    let i_eq_sd = g_eq_sd * vsd_prev;
    let i_eq_gd = g_eq_gd * vgd_prev;

    stamp_companion_conductance(
        matrix_a_iter,
        node_source,
        node_source,
        gds_cond + g_eq_sg + g_eq_sd + gg,
    );
    stamp_companion_conductance(
        matrix_a_iter,
        node_drain,
        node_drain,
        gds_cond + g_eq_sd + g_eq_gd,
    );
    stamp_companion_conductance(
        matrix_a_iter,
        node_source,
        node_drain,
        -gds_cond - g_eq_sd,
    );
    stamp_companion_conductance(
        matrix_a_iter,
        node_drain,
        node_source,
        -gds_cond - g_eq_sd,
    );

    stamp_companion_conductance(
        matrix_a_iter,
        node_gate,
        node_gate,
        g_eq_sg + g_eq_gd + gg,
    );
    stamp_companion_conductance(matrix_a_iter, node_gate, node_source, -g_eq_sg - gg);
    stamp_companion_conductance(matrix_a_iter, node_source, node_gate, -g_eq_sg - gg);
    stamp_companion_conductance(matrix_a_iter, node_gate, node_drain, -g_eq_gd);
    stamp_companion_conductance(matrix_a_iter, node_drain, node_gate, -g_eq_gd);

    if node_drain > 0 {
        if node_source > 0 {
            matrix_a_iter[(node_drain - 1, node_source - 1)] -= gm_sd;
        }
        if node_gate > 0 {
            matrix_a_iter[(node_drain - 1, node_gate - 1)] += gm_sd;
        }
    }
    if node_source > 0 {
        if node_source > 0 {
            matrix_a_iter[(node_source - 1, node_source - 1)] += gm_sd;
        }
        if node_gate > 0 {
            matrix_a_iter[(node_source - 1, node_gate - 1)] -= gm_sd;
        }
    }

    if node_drain > 0 {
        vector_z_iter[node_drain - 1] += ieq_sd - i_eq_sd - i_eq_gd;
    }
    if node_source > 0 {
        vector_z_iter[node_source - 1] += -ieq_sd + i_eq_sg + i_eq_sd + ieq_g;
    }
    if node_gate > 0 {
        vector_z_iter[node_gate - 1] += -i_eq_sg + i_eq_gd - ieq_g;
    }
}
