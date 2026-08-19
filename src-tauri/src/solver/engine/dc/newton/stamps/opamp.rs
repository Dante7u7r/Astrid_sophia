use crate::solver::types::ComponentData;

use super::StampContext;

pub(super) fn stamp_opamp(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let prev_voltages = ctx.prev_voltages;
    let matrix_a = &mut *ctx.matrix_a;
    let vector_z = &mut *ctx.vector_z;
    let pin_in_pos = comp.pins[0].parse::<usize>().unwrap();
    let pin_in_neg = comp.pins[1].parse::<usize>().unwrap();
    let pin_vplus = comp.pins[2].parse::<usize>().unwrap();
    let pin_vminus = comp.pins[3].parse::<usize>().unwrap();
    let pin_out = comp.pins[4].parse::<usize>().unwrap();

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

    let mut v_span = v_vplus - v_vminus;
    let mut v_mid = 0.5 * (v_vplus + v_vminus);

    // Prevenir división por cero si no hay alimentación conectada
    if v_span.abs() < 1e-3 {
        v_span = 30.0;
        v_mid = 0.0;
    }

    let a_ol = comp.opamp_aol.unwrap_or(if comp.value > 0.0 { comp.value } else { 1e5 });
    let r_in = comp.opamp_rin.unwrap_or(1e7);
    let r_out = comp.opamp_rout.unwrap_or(75.0);
    let v_os = comp.opamp_vos.unwrap_or(0.0);
    let i_b = comp.opamp_ib.unwrap_or(0.0);
    let g_out = 1.0 / r_out.max(1e-3);
    let g_in = 1.0 / r_in.max(1.0);

    // 1. Estampar conductancia de entrada diferencial R_in y bias currents
    let mut stamp_conductance = |r: usize, c: usize, g: f64| {
        if r > 0 && c > 0 {
            matrix_a.add_element(r - 1, c - 1, g);
        }
    };
    stamp_conductance(pin_in_pos, pin_in_pos, g_in);
    stamp_conductance(pin_in_neg, pin_in_neg, g_in);
    stamp_conductance(pin_in_pos, pin_in_neg, -g_in);
    stamp_conductance(pin_in_neg, pin_in_pos, -g_in);

    if i_b.abs() > 0.0 {
        if pin_in_pos > 0 {
            vector_z[pin_in_pos - 1] -= i_b;
        }
        if pin_in_neg > 0 {
            vector_z[pin_in_neg - 1] -= i_b;
        }
    }

    // 2. Calcular V_int_ctrl no lineal con tanh y offset
    let v_diff = (v_in_pos - v_in_neg) + v_os;
    let arg = (a_ol * v_diff) / v_span;
    let tanh_val = arg.tanh();
    let v_int_ctrl = v_mid + 0.5 * v_span * tanh_val;

    // Derivada de V_int_ctrl respecto a V_diff:
    // d(V_int)/d(V_diff) = 0.5 * A_ol * (1 - tanh^2)
    let g_m_int = 0.5 * a_ol * (1.0 - tanh_val * tanh_val);
    let g_m_opamp = g_out * g_m_int;

    // Corriente equivalente de Norton a inyectar en pin_out
    let ieq = g_out * v_int_ctrl - g_m_opamp * v_diff;

    // 3. Estampar en MNA
    // Conductancia de salida
    if pin_out > 0 {
        matrix_a.add_element(pin_out - 1, pin_out - 1, g_out);

        // Transconductancias gm controladas en la fila de pin_out
        if pin_in_pos > 0 {
            matrix_a.add_element(pin_out - 1, pin_in_pos - 1, -g_m_opamp);
        }
        if pin_in_neg > 0 {
            matrix_a.add_element(pin_out - 1, pin_in_neg - 1, g_m_opamp);
        }

        // Inyección de corriente equivalente en vector Z
        vector_z[pin_out - 1] += ieq;
    }
}
