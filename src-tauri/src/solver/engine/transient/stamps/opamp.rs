use super::super::super::transient_companions::stamp_companion_conductance;
use super::StampContext;
use crate::solver::types::ComponentData;

pub(super) fn stamp_opamp(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let prev_v = ctx.prev_v;
    let mut matrix_a_iter = &mut *ctx.matrix_a_iter;
    let vector_z_iter = &mut *ctx.vector_z_iter;
    let pin_in_pos = comp.pins[0].parse::<usize>().unwrap();
    let pin_in_neg = comp.pins[1].parse::<usize>().unwrap();
    let pin_vplus = comp.pins[2].parse::<usize>().unwrap();
    let pin_vminus = comp.pins[3].parse::<usize>().unwrap();
    let pin_out = comp.pins[4].parse::<usize>().unwrap();

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

    let v_diff = v_in_pos - v_in_neg;
    let mut v_span = v_vplus - v_vminus;
    let mut v_mid = 0.5 * (v_vplus + v_vminus);

    if v_span.abs() < 1e-3 {
        v_span = 30.0;
        v_mid = 0.0;
    }

    let a_ol = 1e5;
    let r_in = 1e7;
    let r_out = 100.0;
    let g_out = 1.0 / r_out;
    let g_in = 1.0 / r_in;

    stamp_companion_conductance(&mut matrix_a_iter, pin_in_pos, pin_in_pos, g_in);
    stamp_companion_conductance(&mut matrix_a_iter, pin_in_neg, pin_in_neg, g_in);
    stamp_companion_conductance(&mut matrix_a_iter, pin_in_pos, pin_in_neg, -g_in);
    stamp_companion_conductance(&mut matrix_a_iter, pin_in_neg, pin_in_pos, -g_in);

    let arg = (a_ol * v_diff) / v_span;
    let tanh_val = arg.tanh();
    let v_int_ctrl = v_mid + 0.5 * v_span * tanh_val;
    let g_m_int = 0.5 * a_ol * (1.0 - tanh_val * tanh_val);
    let g_m_opamp = g_out * g_m_int;
    let ieq = g_out * v_int_ctrl - g_m_opamp * v_diff;

    if pin_out > 0 {
        matrix_a_iter[(pin_out - 1, pin_out - 1)] += g_out;
        if pin_in_pos > 0 {
            matrix_a_iter[(pin_out - 1, pin_in_pos - 1)] -= g_m_opamp;
        }
        if pin_in_neg > 0 {
            matrix_a_iter[(pin_out - 1, pin_in_neg - 1)] += g_m_opamp;
        }
        vector_z_iter[pin_out - 1] += ieq;
    }
}
