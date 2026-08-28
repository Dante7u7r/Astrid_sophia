use super::super::super::transient_companions::stamp_companion_conductance;
use super::StampContext;
use crate::solver::types::ComponentData;

pub(super) fn stamp_opamp(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let prev_v = ctx.prev_v;
    let current_solution = ctx.current_solution;
    let dt = ctx.dt;
    let matrix_a_iter = &mut *ctx.matrix_a_iter;
    let vector_z_iter = &mut *ctx.vector_z_iter;
    let pin_in_pos = comp.pins[0].parse::<usize>().unwrap();
    let pin_in_neg = comp.pins[1].parse::<usize>().unwrap();
    let (pin_vplus, pin_vminus, pin_out) = if comp.pins.len() >= 5 {
        (
            comp.pins[2].parse::<usize>().unwrap_or(0),
            comp.pins[3].parse::<usize>().unwrap_or(0),
            comp.pins[4].parse::<usize>().unwrap(),
        )
    } else {
        (0, 0, comp.pins[2].parse::<usize>().unwrap())
    };

    let v_in_pos = if pin_in_pos > 0 {
        prev_v[pin_in_pos]
    } else {
        0.0
    };
    let v_in_neg = if pin_in_neg > 0 {
        prev_v[pin_in_neg]
    } else {
        0.0
    };
    let v_vplus = if pin_vplus > 0 {
        prev_v[pin_vplus]
    } else {
        15.0
    };
    let v_vminus = if pin_vminus > 0 {
        prev_v[pin_vminus]
    } else {
        -15.0
    };

    let a_ol = comp
        .opamp_aol
        .unwrap_or(if comp.value > 0.0 { comp.value } else { 1e5 });
    let r_in = comp.opamp_rin.unwrap_or(1e7);
    let r_out = comp.opamp_rout.unwrap_or(75.0);
    let v_os = comp.opamp_vos.unwrap_or(0.0);
    let i_b = comp.opamp_ib.unwrap_or(0.0);
    let i_os = comp.opamp_ios.unwrap_or(0.0);
    let i_q = comp.opamp_iq.unwrap_or(0.0);
    let i_sc = comp.opamp_isc.unwrap_or(0.0);
    let v_drop = comp.opamp_vdrop.unwrap_or(1.2).max(0.0);
    let cmrr_db = comp.opamp_cmrr.unwrap_or(120.0);
    let psrr_db = comp.opamp_psrr.unwrap_or(120.0);
    let gbw = comp.opamp_gbw.unwrap_or(1.0e6);
    let slew_rate = comp.opamp_sr.map(|sr| sr * 1e6).unwrap_or(0.5e6); // V/μs -> V/s

    let g_out = 1.0 / r_out.max(1e-3);
    let g_in = 1.0 / r_in.max(1.0);

    // 1. Estampar conductancia de entrada diferencial R_in y corrientes de bias asimétricas (I_b, I_os)
    stamp_companion_conductance(matrix_a_iter, pin_in_pos, pin_in_pos, g_in);
    stamp_companion_conductance(matrix_a_iter, pin_in_neg, pin_in_neg, g_in);
    stamp_companion_conductance(matrix_a_iter, pin_in_pos, pin_in_neg, -g_in);
    stamp_companion_conductance(matrix_a_iter, pin_in_neg, pin_in_pos, -g_in);

    let i_b_pos = i_b + 0.5 * i_os;
    let i_b_neg = i_b - 0.5 * i_os;

    if i_b_pos.abs() > 0.0 && pin_in_pos > 0 {
        vector_z_iter[pin_in_pos - 1] -= i_b_pos;
    }
    if i_b_neg.abs() > 0.0 && pin_in_neg > 0 {
        vector_z_iter[pin_in_neg - 1] -= i_b_neg;
    }

    // 2. Cálculo de rieles de alimentación y saturación con V_drop configurable
    let v_max = v_vplus - v_drop;
    let v_min = v_vminus + v_drop;

    // 3. Macromodelo de OpAmp de 2 Polos + Slew Rate + CMRR + PSRR + I_sc
    let cmrr_lin = 10.0_f64.powf(cmrr_db / 20.0);
    let psrr_lin = 10.0_f64.powf(psrr_db / 20.0);
    let v_cm = 0.5 * (v_in_pos + v_in_neg);
    let v_cm_err = if cmrr_lin > 1.0 { v_cm / cmrr_lin } else { 0.0 };
    let v_supply_diff = (v_vplus - 15.0) - (v_vminus - (-15.0));
    let v_psrr_err = if psrr_lin > 1.0 {
        v_supply_diff / psrr_lin
    } else {
        0.0
    };

    let v_diff = (v_in_pos - v_in_neg) + v_os + v_cm_err + v_psrr_err;
    let tau_p = a_ol / (2.0 * std::f64::consts::PI * gbw.max(1.0));
    let k_p = tau_p / dt.max(1e-12);

    let v_out_prev = if pin_out > 0 {
        current_solution[pin_out - 1]
    } else {
        0.0
    };

    // Tensión objetivo dinámica considerando el polo dominante
    let v_target_linear = (a_ol * v_diff + k_p * v_out_prev) / (1.0 + k_p);
    let delta_v = v_target_linear - v_out_prev;
    let sr_step = slew_rate * dt;

    let (v_target_raw, d_vtarget_dvdiff) = if sr_step > 0.0 {
        let x = (delta_v / sr_step).clamp(-50.0, 50.0);
        let tanh_x = x.tanh();
        let d_tanh_x = (1.0 - tanh_x * tanh_x).max(0.0);

        let delta_v_smooth = sr_step * tanh_x;
        let thev_comp = 1.0 + r_out * 1e-4;
        let v_slew = (v_out_prev + delta_v_smooth) * thev_comp;

        let dv_linear = a_ol / (1.0 + k_p);
        let dv_smooth = dv_linear * d_tanh_x * thev_comp;

        (v_slew, dv_smooth)
    } else {
        let dv_linear = a_ol / (1.0 + k_p);
        (v_target_linear, dv_linear)
    };

    let is_rail_clamped = v_target_raw >= v_max || v_target_raw <= v_min;
    let d_vtarget_raw = if is_rail_clamped {
        0.0
    } else {
        d_vtarget_dvdiff
    };
    let v_target_bounded = v_target_raw.clamp(v_min, v_max);

    // Limitación de corriente de cortocircuito (I_sc) suave con tanh
    let (v_target, d_vtarget) = if i_sc > 0.0 {
        let i_raw = g_out * (v_target_bounded - v_out_prev);
        let x_sc = (i_raw / i_sc).clamp(-50.0, 50.0);
        let tanh_sc = x_sc.tanh();
        let s_limit = (1.0 - tanh_sc * tanh_sc).max(0.0);
        let i_clamped = i_sc * tanh_sc;
        let v_lim = v_out_prev + i_clamped / g_out;
        (v_lim.clamp(v_min, v_max), d_vtarget_raw * s_limit)
    } else {
        (v_target_bounded, d_vtarget_raw)
    };

    let g_m_opamp = g_out * d_vtarget;
    let ieq = g_out * v_target - g_m_opamp * v_diff;

    // 4. Estampar etapa de salida Norton
    if pin_out > 0 {
        matrix_a_iter[(pin_out - 1, pin_out - 1)] += g_out;
        if pin_in_pos > 0 && g_m_opamp.abs() > 0.0 {
            matrix_a_iter[(pin_out - 1, pin_in_pos - 1)] -= g_m_opamp;
        }
        if pin_in_neg > 0 && g_m_opamp.abs() > 0.0 {
            matrix_a_iter[(pin_out - 1, pin_in_neg - 1)] += g_m_opamp;
        }
        vector_z_iter[pin_out - 1] += ieq;
    }

    // 5. Conservación de KCL en rieles de alimentación VCC / VEE (Pines 2 y 3)
    let i_out_load = g_out * (v_target - v_out_prev);
    let scale_i = (i_q.max(1e-4)).max(1e-6);
    let w_pos = 0.5 * (1.0 + (i_out_load / scale_i).clamp(-50.0, 50.0).tanh());
    let i_from_vplus = i_q + i_out_load * w_pos;
    let i_to_vminus = i_q - i_out_load * (1.0 - w_pos);

    if pin_vplus > 0 && i_from_vplus.abs() > 0.0 {
        vector_z_iter[pin_vplus - 1] -= i_from_vplus;
    }
    if pin_vminus > 0 && i_to_vminus.abs() > 0.0 {
        vector_z_iter[pin_vminus - 1] += i_to_vminus;
    }
}
