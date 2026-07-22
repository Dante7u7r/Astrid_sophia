use crate::solver::types::ComponentData;

use super::super::super::super::devices::{
    evaluate_opto_receiver, pnjlim, solve_diode_junction_voltage,
};
use super::StampContext;

pub(super) fn stamp_diode(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let netlist = ctx.netlist;
    let vt = ctx.vt;
    let prev_voltages = ctx.prev_voltages;
    let prev_prev_voltages = ctx.prev_prev_voltages;
    let matrix_a = &mut *ctx.matrix_a;
    let vector_z = &mut *ctx.vector_z;
    let node_anode = comp.pins[0].parse::<usize>().unwrap();
    let node_cathode = comp.pins[1].parse::<usize>().unwrap();

    // Obtener voltajes previos de los nodos correspondientes
    let v_anode = if node_anode > 0 {
        prev_voltages[node_anode]
    } else {
        0.0
    };
    let v_cathode = if node_cathode > 0 {
        prev_voltages[node_cathode]
    } else {
        0.0
    };

    let vd_new = v_anode - v_cathode;

    let v_anode_old = if node_anode > 0 {
        prev_prev_voltages[node_anode]
    } else {
        0.0
    };
    let v_cathode_old = if node_cathode > 0 {
        prev_prev_voltages[node_cathode]
    } else {
        0.0
    };
    let vd_old = v_anode_old - v_cathode_old;

    // Damping logarítmico suave (pnjlim) para evitar overflow exponencial (Upgrade 4)
    let vd = pnjlim(vd_new, vd_old, vt, 0.6);

    let (_, id, geq) = solve_diode_junction_voltage(vd, netlist.temperature, comp);

    // Corriente equivalente: Ieq = Id - geq * vd
    let ieq = id - geq * vd;

    // Estampar conductancia equivalente geq (igual que una resistencia)
    let mut stamp_conductance = |r: usize, c: usize, g: f64| {
        if r > 0 && c > 0 {
            matrix_a.add_element(r - 1, c - 1, g);
        }
    };

    stamp_conductance(node_anode, node_anode, geq);
    stamp_conductance(node_cathode, node_cathode, geq);
    stamp_conductance(node_anode, node_cathode, -geq);
    stamp_conductance(node_cathode, node_anode, -geq);

    // Estampar fuente de corriente equivalente ieq (fluye de Anode a Cathode)
    // Restar de z del ánodo, sumar a z del cátodo
    if node_anode > 0 {
        vector_z[node_anode - 1] -= ieq;
    }
    if node_cathode > 0 {
        vector_z[node_cathode - 1] += ieq;
    }
}

pub(super) fn stamp_opto(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let netlist = ctx.netlist;
    let vt = ctx.vt;
    let prev_voltages = ctx.prev_voltages;
    let prev_prev_voltages = ctx.prev_prev_voltages;
    let matrix_a = &mut *ctx.matrix_a;
    let vector_z = &mut *ctx.vector_z;
    if comp.pins.len() < 4 {
        return;
    }
    let node_a = comp.pins[0].parse::<usize>().unwrap();
    let node_k = comp.pins[1].parse::<usize>().unwrap();
    let node_c = comp.pins[2].parse::<usize>().unwrap();
    let node_e = comp.pins[3].parse::<usize>().unwrap();

    let v_a = if node_a > 0 {
        prev_voltages[node_a]
    } else {
        0.0
    };
    let v_k = if node_k > 0 {
        prev_voltages[node_k]
    } else {
        0.0
    };
    let v_c = if node_c > 0 {
        prev_voltages[node_c]
    } else {
        0.0
    };
    let v_e = if node_e > 0 {
        prev_voltages[node_e]
    } else {
        0.0
    };

    // Lado emisor (LED interno) con damping pnjlim
    let vd_new = v_a - v_k;
    let vd_old = (if node_a > 0 {
        prev_prev_voltages[node_a]
    } else {
        0.0
    }) - (if node_k > 0 {
        prev_prev_voltages[node_k]
    } else {
        0.0
    });
    let vd = pnjlim(vd_new, vd_old, vt, 0.6);
    let (_, id_led, gd_led) = solve_diode_junction_voltage(vd, netlist.temperature, comp);
    let ieq_led = id_led - gd_led * vd;

    // Lado receptor (fototransistor)
    let v_ce = v_c - v_e;
    let (_i_ce, g_md, g_o, i_ce_eq) = evaluate_opto_receiver(vd, gd_led, id_led, v_ce, comp);

    let mut stamp = |r: usize, c: usize, g: f64| {
        if r > 0 && c > 0 {
            matrix_a.add_element(r - 1, c - 1, g);
        }
    };

    // Estampar lado LED (igual que un diodo)
    stamp(node_a, node_a, gd_led);
    stamp(node_k, node_k, gd_led);
    stamp(node_a, node_k, -gd_led);
    stamp(node_k, node_a, -gd_led);
    if node_a > 0 {
        vector_z[node_a - 1] -= ieq_led;
    }
    if node_k > 0 {
        vector_z[node_k - 1] += ieq_led;
    }

    // Estampar lado receptor (fototransistor): fuente VCCS no lineal
    stamp(node_c, node_a, g_md);
    stamp(node_c, node_k, -g_md);
    stamp(node_c, node_c, g_o);
    stamp(node_c, node_e, -g_o);
    stamp(node_e, node_a, -g_md);
    stamp(node_e, node_k, g_md);
    stamp(node_e, node_c, -g_o);
    stamp(node_e, node_e, g_o);
    if node_c > 0 {
        vector_z[node_c - 1] -= i_ce_eq;
    }
    if node_e > 0 {
        vector_z[node_e - 1] += i_ce_eq;
    }
}
