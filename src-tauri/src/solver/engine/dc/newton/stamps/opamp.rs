use crate::solver::types::ComponentData;

use super::StampContext;

pub(super) fn stamp_opamp(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let prev_voltages = ctx.prev_voltages;
    let matrix_a = &mut *ctx.matrix_a;
    let vector_z = &mut *ctx.vector_z;
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

    // Obtener voltajes previos
    let v_in_pos = if pin_in_pos > 0 {
        prev_voltages[pin_in_pos]
    } else {
        0.0
    };
    let v_in_neg = if pin_in_neg > 0 {
        prev_voltages[pin_in_neg]
    } else {
        0.0
    };
    let v_vplus = if pin_vplus > 0 {
        prev_voltages[pin_vplus]
    } else {
        15.0
    };
    let v_vminus = if pin_vminus > 0 {
        prev_voltages[pin_vminus]
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

    let g_out = 1.0 / r_out.max(1e-3);
    let g_in = 1.0 / r_in.max(1.0);

    // 1. Estampar conductancia de entrada diferencial R_in y corrientes de bias asimétricas (I_b, I_os)
    let mut stamp_conductance = |r: usize, c: usize, g: f64| {
        if r > 0 && c > 0 {
            matrix_a.add_element(r - 1, c - 1, g);
        }
    };
    stamp_conductance(pin_in_pos, pin_in_pos, g_in);
    stamp_conductance(pin_in_neg, pin_in_neg, g_in);
    stamp_conductance(pin_in_pos, pin_in_neg, -g_in);
    stamp_conductance(pin_in_neg, pin_in_pos, -g_in);

    let i_b_pos = i_b + 0.5 * i_os;
    let i_b_neg = i_b - 0.5 * i_os;

    if i_b_pos.abs() > 0.0 && pin_in_pos > 0 {
        vector_z[pin_in_pos - 1] -= i_b_pos;
    }
    if i_b_neg.abs() > 0.0 && pin_in_neg > 0 {
        vector_z[pin_in_neg - 1] -= i_b_neg;
    }

    // 2. Cálculo de rieles con caída configurable V_drop (o Rail-to-Rail si v_drop ~ 0)
    let v_max = v_vplus - v_drop;
    let v_min = v_vminus + v_drop;
    let mut v_span = v_max - v_min;
    let mut v_mid = 0.5 * (v_max + v_min);

    // Prevenir división por cero si no hay alimentación conectada
    if v_span.abs() < 1e-3 {
        v_span = 30.0;
        v_mid = 0.0;
    }

    // Errores referidos a la entrada por CMRR y PSRR
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

    // 3. Calcular V_int_ctrl no lineal con tanh y offset
    let v_diff = (v_in_pos - v_in_neg) + v_os + v_cm_err + v_psrr_err;
    let arg = ((a_ol * v_diff) / v_span).clamp(-50.0, 50.0);
    let tanh_val = arg.tanh();
    let v_int_raw = v_mid + 0.5 * v_span * tanh_val;
    let g_m_int_raw = 0.5 * a_ol * (1.0 - tanh_val * tanh_val);

    let v_out_prev = if pin_out > 0 {
        prev_voltages[pin_out]
    } else {
        0.0
    };

    // Limitación de corriente de cortocircuito (I_sc) suave con tanh
    let (v_int_ctrl, g_m_int) = if i_sc > 0.0 {
        let i_raw = g_out * (v_int_raw - v_out_prev);
        let x_sc = (i_raw / i_sc).clamp(-50.0, 50.0);
        let tanh_sc = x_sc.tanh();
        let s_limit = (1.0 - tanh_sc * tanh_sc).max(0.0);
        let i_clamped = i_sc * tanh_sc;
        let v_limited = v_out_prev + i_clamped / g_out;
        (v_limited, g_m_int_raw * s_limit)
    } else {
        (v_int_raw, g_m_int_raw)
    };

    let g_m_opamp = g_out * g_m_int;
    let ieq = g_out * v_int_ctrl - g_m_opamp * v_diff;

    // 4. Estampar en MNA etapa de salida Norton
    if pin_out > 0 {
        matrix_a.add_element(pin_out - 1, pin_out - 1, g_out);

        if pin_in_pos > 0 {
            matrix_a.add_element(pin_out - 1, pin_in_pos - 1, -g_m_opamp);
        }
        if pin_in_neg > 0 {
            matrix_a.add_element(pin_out - 1, pin_in_neg - 1, g_m_opamp);
        }

        vector_z[pin_out - 1] += ieq;
    }

    // 5. Conservación de KCL en rieles de alimentación VCC / VEE (Pines 2 y 3)
    let i_out_load = g_out * (v_int_ctrl - v_out_prev);
    let scale_i = (i_q.max(1e-4)).max(1e-6);
    let w_pos = 0.5 * (1.0 + (i_out_load / scale_i).clamp(-50.0, 50.0).tanh());
    let i_from_vplus = i_q + i_out_load * w_pos;
    let i_to_vminus = i_q - i_out_load * (1.0 - w_pos);

    if pin_vplus > 0 && i_from_vplus.abs() > 0.0 {
        vector_z[pin_vplus - 1] -= i_from_vplus;
    }
    if pin_vminus > 0 && i_to_vminus.abs() > 0.0 {
        vector_z[pin_vminus - 1] += i_to_vminus;
    }
}
