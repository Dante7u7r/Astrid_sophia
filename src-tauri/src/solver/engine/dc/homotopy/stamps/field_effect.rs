use crate::solver::types::ComponentData;

use super::super::super::super::devices::{
    evaluate_bsim3_nmos, evaluate_bsim3_pmos, evaluate_bsim4_nmos, evaluate_bsim4_pmos,
};
use super::StampContext;

pub(super) fn stamp_nmos(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let netlist = ctx.netlist;
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
    let vds = v_drain - v_source;
    let vbs = v_bulk - v_source;

    let (ids, gm, gds) = if comp.comp_type == "bsim4nmos" {
        let (ids_val, gm_val, gds_val, _, _) =
            evaluate_bsim4_nmos(vgs, vds, vbs, comp.value, comp.w, comp.l);
        (ids_val, gm_val, gds_val)
    } else if comp.comp_type == "bsim3nmos" {
        evaluate_bsim3_nmos(
            vgs,
            vds,
            vbs,
            comp.value,
            comp.w,
            comp.l,
            netlist.temperature,
            Some(comp),
        )
    } else {
        let beta = 1e-3;
        let vth = comp.value;
        let ids_val = if vgs <= vth {
            0.0
        } else if vds < vgs - vth {
            beta * (2.0 * (vgs - vth) * vds - vds * vds)
        } else {
            beta * (vgs - vth).powi(2)
        };
        let gm_val = if vgs <= vth {
            0.0
        } else if vds < vgs - vth {
            2.0 * beta * vds
        } else {
            2.0 * beta * (vgs - vth)
        };
        let gds_val = if vgs > vth && vds < vgs - vth {
            2.0 * beta * ((vgs - vth) - vds)
        } else {
            0.0
        };
        (ids_val, gm_val, gds_val)
    };

    let ieq = ids - gm * vgs - gds * vds;

    let mut stamp_conductance = |r: usize, c: usize, g: f64| {
        if r > 0 && c > 0 {
            matrix_a.add_element(r - 1, c - 1, g);
        }
    };
    stamp_conductance(node_drain, node_drain, gds);
    stamp_conductance(node_source, node_source, gds);
    stamp_conductance(node_drain, node_source, -gds);
    stamp_conductance(node_source, node_drain, -gds);

    if node_drain > 0 {
        stamp_conductance(node_drain, node_gate, gm);
        stamp_conductance(node_drain, node_source, -gm);
    }
    if node_source > 0 {
        stamp_conductance(node_source, node_gate, -gm);
        stamp_conductance(node_source, node_source, gm);
    }

    if node_drain > 0 {
        vector_z[node_drain - 1] -= ieq;
    }
    if node_source > 0 {
        vector_z[node_source - 1] += ieq;
    }
}

pub(super) fn stamp_pmos(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let netlist = ctx.netlist;
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
    let vsd = v_source - v_drain;
    let vsb = v_source - v_bulk;

    let (isd, gm, gds) = if comp.comp_type == "bsim4pmos" {
        let (isd_val, gm_val, gds_val, _, _) =
            evaluate_bsim4_pmos(vsg, vsd, vsb, comp.value, comp.w, comp.l);
        (isd_val, gm_val, gds_val)
    } else if comp.comp_type == "bsim3pmos" {
        evaluate_bsim3_pmos(
            vsg,
            vsd,
            vsb,
            comp.value,
            comp.w,
            comp.l,
            netlist.temperature,
            Some(comp),
        )
    } else {
        let beta = 1e-3;
        let vth = comp.value.abs();
        let ids_val = if vsg <= vth {
            0.0
        } else if vsd < vsg - vth {
            beta * (2.0 * (vsg - vth) * vsd - vsd * vsd)
        } else {
            beta * (vsg - vth).powi(2)
        };
        let gm_val = if vsg <= vth {
            0.0
        } else if vsd < vsg - vth {
            2.0 * beta * vsd
        } else {
            2.0 * beta * (vsg - vth)
        };
        let gds_val = if vsg <= vth {
            0.0
        } else if vsd < vsg - vth {
            2.0 * beta * ((vsg - vth) - vsd)
        } else {
            0.0
        };
        (ids_val, gm_val, gds_val)
    };

    let ieq = isd - gm * vsg - gds * vsd;

    let mut stamp_conductance = |r: usize, c: usize, g: f64| {
        if r > 0 && c > 0 {
            matrix_a.add_element(r - 1, c - 1, g);
        }
    };
    stamp_conductance(node_source, node_source, gds);
    stamp_conductance(node_drain, node_drain, gds);
    stamp_conductance(node_source, node_drain, -gds);
    stamp_conductance(node_drain, node_source, -gds);

    if node_drain > 0 {
        stamp_conductance(node_drain, node_gate, -gm);
        stamp_conductance(node_drain, node_source, gm);
    }
    if node_source > 0 {
        stamp_conductance(node_source, node_gate, gm);
        stamp_conductance(node_source, node_source, -gm);
    }

    if node_source > 0 {
        vector_z[node_source - 1] -= ieq;
    }
    if node_drain > 0 {
        vector_z[node_drain - 1] += ieq;
    }
}

pub(super) fn stamp_jfet(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let prev_voltages = ctx.prev_voltages;
    let matrix_a = &mut *ctx.matrix_a;
    let vector_z = &mut *ctx.vector_z;
    // JFET Shichman-Hodges
    let node_drain = comp.pins[0].parse::<usize>().unwrap();
    let node_gate = comp.pins[1].parse::<usize>().unwrap();
    let node_source = comp.pins[2].parse::<usize>().unwrap();

    let vd = if node_drain > 0 {
        prev_voltages[node_drain]
    } else {
        0.0
    };
    let vg = if node_gate > 0 {
        prev_voltages[node_gate]
    } else {
        0.0
    };
    let vs = if node_source > 0 {
        prev_voltages[node_source]
    } else {
        0.0
    };

    let is_n = comp.comp_type == "njf";
    let vgs = if is_n { vg - vs } else { vs - vg };
    let vds = if is_n { vd - vs } else { vs - vd };

    let vto = comp.jfet_vto.unwrap_or(-2.0);
    let beta = comp.jfet_beta.unwrap_or(1e-3);
    let lambda = comp.jfet_lambda.unwrap_or(0.0);

    let (ids, gm, gds) = if vgs <= vto {
        (0.0, 0.0, 0.0)
    } else if vds >= 0.0 {
        if vds < vgs - vto {
            let ids_val = beta * vds * (2.0 * (vgs - vto) - vds) * (1.0 + lambda * vds);
            let gm_val = 2.0 * beta * vds * (1.0 + lambda * vds);
            let gds_val = beta * (2.0 * (vgs - vto) - 2.0 * vds) * (1.0 + lambda * vds)
                + beta * vds * (2.0 * (vgs - vto) - vds) * lambda;
            (ids_val, gm_val, gds_val)
        } else {
            let ids_val = beta * (vgs - vto).powi(2) * (1.0 + lambda * vds);
            let gm_val = 2.0 * beta * (vgs - vto) * (1.0 + lambda * vds);
            let gds_val = beta * (vgs - vto).powi(2) * lambda;
            (ids_val, gm_val, gds_val)
        }
    } else {
        (0.0, 0.0, 0.0)
    };

    let ids_final = if is_n { ids } else { -ids };
    let gm_final = gm;
    let gds_final = gds;

    if node_drain > 0 {
        matrix_a.add_element(node_drain - 1, node_drain - 1, gds_final);
    }
    if node_source > 0 {
        matrix_a.add_element(node_source - 1, node_source - 1, gds_final);
    }
    if node_drain > 0 && node_source > 0 {
        matrix_a.add_element(node_drain - 1, node_source - 1, -gds_final);
        matrix_a.add_element(node_source - 1, node_drain - 1, -gds_final);
    }

    if is_n {
        if node_drain > 0 {
            matrix_a.add_element(node_drain - 1, node_gate - 1, gm_final);
            matrix_a.add_element(node_drain - 1, node_source - 1, -gm_final);
        }
        if node_source > 0 {
            matrix_a.add_element(node_source - 1, node_gate - 1, -gm_final);
            matrix_a.add_element(node_source - 1, node_source - 1, gm_final);
        }
    } else {
        if node_drain > 0 {
            matrix_a.add_element(node_drain - 1, node_source - 1, gm_final);
            matrix_a.add_element(node_drain - 1, node_gate - 1, -gm_final);
        }
        if node_source > 0 {
            matrix_a.add_element(node_source - 1, node_source - 1, -gm_final);
            matrix_a.add_element(node_source - 1, node_gate - 1, gm_final);
        }
    }

    let ieq = ids_final - gm_final * (vg - vs) - gds_final * (vd - vs);
    if node_drain > 0 {
        vector_z[node_drain - 1] -= ieq;
    }
    if node_source > 0 {
        vector_z[node_source - 1] += ieq;
    }
}
