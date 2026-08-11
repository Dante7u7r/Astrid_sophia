use crate::solver::types::ComponentData;

use super::super::super::super::devices::{
    evaluate_bsim3_nmos, evaluate_bsim3_pmos, evaluate_bsim4_nmos, evaluate_bsim4_pmos,
};
use super::StampContext;

pub(super) fn stamp_nmos(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let prev_voltages = ctx.prev_voltages;
    let matrix_a = &mut *ctx.matrix_a;
    let vector_z = &mut *ctx.vector_z;
    let node_gate = comp.pins[0].parse::<usize>().unwrap();
    let node_drain = comp.pins[1].parse::<usize>().unwrap();
    let node_source = comp.pins[2].parse::<usize>().unwrap();
    let node_bulk = if comp.pins.len() >= 4 {
        comp.pins[3].parse::<usize>().unwrap_or(0)
    } else {
        0
    };

    // Obtener voltajes previos
    let v_gate = if node_gate > 0 {
        prev_voltages[node_gate]
    } else {
        0.0
    };
    let v_drain = if node_drain > 0 {
        prev_voltages[node_drain]
    } else {
        0.0
    };
    let v_source = if node_source > 0 {
        prev_voltages[node_source]
    } else {
        0.0
    };
    let v_bulk = if node_bulk > 0 {
        prev_voltages[node_bulk]
    } else {
        0.0
    };

    let vgs = v_gate - v_source;
    let mut vds = v_drain - v_source;
    if vds < 0.0 {
        vds = 0.0;
    }
    let vbs = v_bulk - v_source;

    let vth = comp.value; // Tensión de umbral
    let kn = 0.02; // transconductancia 20 mA/V^2

    // Ecuaciones Shichman-Hodges y derivadas para linealización Taylor
    let (ids, gm, gds, igs, gg) = if comp.comp_type == "bsim4nmos" {
        evaluate_bsim4_nmos(vgs, vds, vbs, comp.value, comp.w, comp.l)
    } else if comp.comp_type == "bsim3nmos" {
        let (ids_v, gm_v, gds_v) =
            evaluate_bsim3_nmos(vgs, vds, vbs, comp.value, comp.w, comp.l, None, Some(comp));
        (ids_v, gm_v, gds_v, 0.0, 1e-12)
    } else if vgs <= vth {
        // Corte
        (0.0, 0.0, 1e-9, 0.0, 1e-12)
    } else if vds < vgs - vth {
        // Lineal (Triodo)
        let ids_val = kn * (2.0 * (vgs - vth) * vds - vds * vds);
        let gm_val = 2.0 * kn * vds;
        let gds_val = 2.0 * kn * (vgs - vth - vds);
        (ids_val, gm_val, gds_val.max(1e-9), 0.0, 1e-12)
    } else {
        // Saturación
        let ids_val = kn * (vgs - vth) * (vgs - vth);
        let gm_val = 2.0 * kn * (vgs - vth);
        let gds_val = 1e-5;
        (ids_val, gm_val, gds_val, 0.0, 1e-12)
    };

    let ieq = ids - gm * vgs - gds * vds;
    let ieq_g = igs - gg * vgs;

    // Estampar conductancias de canal gds entre Drain y Source
    macro_rules! stamp_conductance {
        ($r:expr, $c:expr, $g:expr) => {{
            let r_val = $r;
            let c_val = $c;
            if r_val > 0 && c_val > 0 {
                matrix_a.add_element(r_val - 1, c_val - 1, $g);
            }
        }};
    }
    stamp_conductance!(node_drain, node_drain, gds);
    stamp_conductance!(node_source, node_source, gds);
    stamp_conductance!(node_drain, node_source, -gds);
    stamp_conductance!(node_source, node_drain, -gds);

    // Estampar transconductancia gm dependiente de Vg y Vs
    if node_drain > 0 {
        if node_gate > 0 {
            matrix_a.add_element(node_drain - 1, node_gate - 1, gm);
        }
        if node_source > 0 {
            matrix_a.add_element(node_drain - 1, node_source - 1, -gm);
        }
    }
    if node_source > 0 {
        if node_gate > 0 {
            matrix_a.add_element(node_source - 1, node_gate - 1, -gm);
        }
        if node_source > 0 {
            matrix_a.add_element(node_source - 1, node_source - 1, gm);
        }
    }

    // Estampar conductancia de fugas de compuerta gg entre Gate y Source
    if gg.abs() > 1e-12 {
        stamp_conductance!(node_gate, node_gate, gg);
        stamp_conductance!(node_source, node_source, gg);
        stamp_conductance!(node_gate, node_source, -gg);
        stamp_conductance!(node_source, node_gate, -gg);
    }

    // Estampar corriente equivalente ieq (D->S: entra a S, sale de D)
    if node_drain > 0 {
        vector_z[node_drain - 1] -= ieq;
    }
    if node_source > 0 {
        vector_z[node_source - 1] += ieq;
    }

    // Estampar corriente equivalente de compuerta ieq_g (G->S: entra a S, sale de G)
    if igs.abs() > 1e-15 {
        if node_gate > 0 {
            vector_z[node_gate - 1] -= ieq_g;
        }
        if node_source > 0 {
            vector_z[node_source - 1] += ieq_g;
        }
    }
}

pub(super) fn stamp_pmos(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let prev_voltages = ctx.prev_voltages;
    let matrix_a = &mut *ctx.matrix_a;
    let vector_z = &mut *ctx.vector_z;
    let node_gate = comp.pins[0].parse::<usize>().unwrap();
    let node_drain = comp.pins[1].parse::<usize>().unwrap();
    let node_source = comp.pins[2].parse::<usize>().unwrap();
    let node_bulk = if comp.pins.len() >= 4 {
        comp.pins[3].parse::<usize>().unwrap_or(0)
    } else {
        0
    };

    // Obtener voltajes previos
    let v_gate = if node_gate > 0 {
        prev_voltages[node_gate]
    } else {
        0.0
    };
    let v_drain = if node_drain > 0 {
        prev_voltages[node_drain]
    } else {
        0.0
    };
    let v_source = if node_source > 0 {
        prev_voltages[node_source]
    } else {
        0.0
    };
    let v_bulk = if node_bulk > 0 {
        prev_voltages[node_bulk]
    } else {
        0.0
    };

    let vsg = v_source - v_gate;
    let mut vsd = v_source - v_drain;
    if vsd < 0.0 {
        vsd = 0.0;
    }
    let vsb = v_source - v_bulk;

    let vth = if comp.value == 0.0 { -1.5 } else { comp.value };
    let vth_abs = -vth;
    let kp = 0.02;

    let (isd, gm_sd, gds_cond, igs, gg) = if comp.comp_type == "bsim4pmos" {
        evaluate_bsim4_pmos(vsg, vsd, vsb, comp.value, comp.w, comp.l)
    } else if comp.comp_type == "bsim3pmos" {
        let (isd_v, gm_v, gds_v) =
            evaluate_bsim3_pmos(vsg, vsd, vsb, comp.value, comp.w, comp.l, None, Some(comp));
        (isd_v, gm_v, gds_v, 0.0, 1e-12)
    } else if vsg <= vth_abs {
        (0.0, 0.0, 1e-9, 0.0, 1e-12)
    } else if vsd < vsg - vth_abs {
        let isd_val = kp * (2.0 * (vsg - vth_abs) * vsd - vsd * vsd);
        let gm_sd_val = 2.0 * kp * vsd;
        let gds_cond_val = 2.0 * kp * (vsg - vth_abs - vsd);
        (isd_val, gm_sd_val, gds_cond_val.max(1e-9), 0.0, 1e-12)
    } else {
        let isd_val = kp * (vsg - vth_abs) * (vsg - vth_abs);
        let gm_sd_val = 2.0 * kp * (vsg - vth_abs);
        let gds_cond_val = 1e-5;
        (isd_val, gm_sd_val, gds_cond_val, 0.0, 1e-12)
    };

    let ieq_sd = isd - gm_sd * vsg - gds_cond * vsd;
    let ieq_g = igs - gg * vsg;

    macro_rules! stamp_conductance {
        ($r:expr, $c:expr, $g:expr) => {{
            let r_val = $r;
            let c_val = $c;
            if r_val > 0 && c_val > 0 {
                matrix_a.add_element(r_val - 1, c_val - 1, $g);
            }
        }};
    }

    stamp_conductance!(node_source, node_source, gds_cond);
    stamp_conductance!(node_drain, node_drain, gds_cond);
    stamp_conductance!(node_source, node_drain, -gds_cond);
    stamp_conductance!(node_drain, node_source, -gds_cond);

    if node_drain > 0 {
        if node_source > 0 {
            matrix_a.add_element(node_drain - 1, node_source - 1, -gm_sd);
        }
        if node_gate > 0 {
            matrix_a.add_element(node_drain - 1, node_gate - 1, gm_sd);
        }
    }
    if node_source > 0 {
        if node_source > 0 {
            matrix_a.add_element(node_source - 1, node_source - 1, gm_sd);
        }
        if node_gate > 0 {
            matrix_a.add_element(node_source - 1, node_gate - 1, -gm_sd);
        }
    }

    // Estampar conductancia de fugas de compuerta gg entre Source y Gate
    if gg.abs() > 1e-12 {
        stamp_conductance!(node_gate, node_gate, gg);
        stamp_conductance!(node_source, node_source, gg);
        stamp_conductance!(node_gate, node_source, -gg);
        stamp_conductance!(node_source, node_gate, -gg);
    }

    if node_drain > 0 {
        vector_z[node_drain - 1] += ieq_sd;
    }
    if node_source > 0 {
        vector_z[node_source - 1] -= ieq_sd;
    }

    // Estampar corriente equivalente de compuerta ieq_g (S->G: entra a G, sale de S)
    if igs.abs() > 1e-15 {
        if node_gate > 0 {
            vector_z[node_gate - 1] += ieq_g;
        }
        if node_source > 0 {
            vector_z[node_source - 1] -= ieq_g;
        }
    }
}
