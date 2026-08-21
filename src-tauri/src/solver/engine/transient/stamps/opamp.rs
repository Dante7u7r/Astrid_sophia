use super::super::super::transient_companions::stamp_companion_conductance;
use super::StampContext;
use crate::solver::types::ComponentData;

pub(super) fn stamp_opamp(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let prev_v = ctx.prev_v;
    let current_solution = ctx.current_solution;
    let dt = ctx.dt;
    let mut matrix_a_iter = &mut *ctx.matrix_a_iter;
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

    let a_ol = comp.opamp_aol.unwrap_or(if comp.value > 0.0 { comp.value } else { 1e5 });
    let r_in = comp.opamp_rin.unwrap_or(1e7);
    let r_out = comp.opamp_rout.unwrap_or(75.0);
    let v_os = comp.opamp_vos.unwrap_or(0.0);
    let i_b = comp.opamp_ib.unwrap_or(0.0);
    let gbw = comp.opamp_gbw.unwrap_or(1.0e6);
    let slew_rate = comp.opamp_sr.map(|sr| sr * 1e6).unwrap_or(0.5e6); // V/μs -> V/s

    let g_out = 1.0 / r_out.max(1e-3);
    let g_in = 1.0 / r_in.max(1.0);

    // 1. Estampar conductancia de entrada diferencial R_in y corrientes de bias
    stamp_companion_conductance(&mut matrix_a_iter, pin_in_pos, pin_in_pos, g_in);
    stamp_companion_conductance(&mut matrix_a_iter, pin_in_neg, pin_in_neg, g_in);
    stamp_companion_conductance(&mut matrix_a_iter, pin_in_pos, pin_in_neg, -g_in);
    stamp_companion_conductance(&mut matrix_a_iter, pin_in_neg, pin_in_pos, -g_in);

    if i_b.abs() > 0.0 {
        if pin_in_pos > 0 {
            vector_z_iter[pin_in_pos - 1] -= i_b;
        }
        if pin_in_neg > 0 {
            vector_z_iter[pin_in_neg - 1] -= i_b;
        }
    }

    // 2. Cálculo de rieles de alimentación y saturación
    let v_max = v_vplus - 1.2;
    let v_min = v_vminus + 1.2;

    // 3. Macromodelo de OpAmp de 2 Polos + Slew Rate (Boyle SPICE)
    let v_diff = (v_in_pos - v_in_neg) + v_os;
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

    let (v_target, d_vtarget_dvdiff) = if sr_step > 0.0 {
        let x = (delta_v / sr_step).clamp(-50.0, 50.0);
        let tanh_x = x.tanh();
        let d_tanh_x = (1.0 - tanh_x * tanh_x).max(0.0);

        let delta_v_smooth = sr_step * tanh_x;
        let thev_comp = 1.0 + r_out * 1e-4;
        let v_slew = (v_out_prev + delta_v_smooth) * thev_comp;

        let dv_linear = a_ol / (1.0 + k_p);
        let dv_smooth = dv_linear * d_tanh_x * thev_comp;

        (v_slew.clamp(v_min, v_max), dv_smooth)
    } else {
        let dv_linear = a_ol / (1.0 + k_p);
        (v_target_linear.clamp(v_min, v_max), dv_linear)
    };

    let is_rail_clamped = v_target >= v_max || v_target <= v_min;
    let d_vtarget = if is_rail_clamped { 0.0 } else { d_vtarget_dvdiff };

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
}
