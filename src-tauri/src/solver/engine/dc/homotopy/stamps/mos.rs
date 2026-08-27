use crate::solver::types::ComponentData;

use super::super::super::super::devices::{
    evaluate_bsim3_nmos, evaluate_bsim3_pmos, evaluate_bsim4_nmos, evaluate_bsim4_pmos,
    evaluate_gan_hemt, evaluate_igbt, evaluate_sic_mosfet, GanHemtParams, IgbtParams,
    SicMosfetParams,
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

    let (ids, gm, gds) = if comp.comp_type == "igbt" {
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
        let res = evaluate_igbt(vgs, vds, &params, netlist.temperature, None, None);
        (res.ic, res.gm, res.go)
    } else if comp.comp_type == "sic_mosfet" {
        let params = SicMosfetParams {
            vth: if comp.value > 0.0 { comp.value } else { 3.0 },
            rds_on: comp.ron.unwrap_or(0.065),
            ..SicMosfetParams::default()
        };
        let res = evaluate_sic_mosfet(vgs, vds, netlist.temperature.unwrap_or(300.0), &params);
        (res.ids, res.gm, res.gds)
    } else if comp.comp_type == "gan_hemt" {
        let params = GanHemtParams {
            vth: if comp.value > 0.0 { comp.value } else { 1.5 },
            rds_on: comp.ron.unwrap_or(0.035),
            ..GanHemtParams::default()
        };
        let res = evaluate_gan_hemt(vgs, vds, netlist.temperature.unwrap_or(300.0), &params);
        (res.ids, res.gm, res.gds)
    } else if comp.comp_type == "bsim4nmos" {
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
