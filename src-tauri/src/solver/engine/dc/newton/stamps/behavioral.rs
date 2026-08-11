use crate::solver::types::ComponentData;
use std::collections::HashMap;

use super::super::super::super::devices::evaluate_expression_ad;
use super::StampContext;

pub(super) fn stamp_verilog_a(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let prev_voltages = ctx.prev_voltages;
    let matrix_a = &mut *ctx.matrix_a;
    let vector_z = &mut *ctx.vector_z;
    let node_drain = comp.pins[0].parse::<usize>().unwrap();
    let node_gate = comp.pins[1].parse::<usize>().unwrap();
    let node_source = comp.pins[2].parse::<usize>().unwrap();

    let v_drain = if node_drain > 0 {
        prev_voltages[node_drain]
    } else {
        0.0
    };
    let v_gate = if node_gate > 0 {
        prev_voltages[node_gate]
    } else {
        0.0
    };
    let v_source = if node_source > 0 {
        prev_voltages[node_source]
    } else {
        0.0
    };

    let vgs = v_gate - v_source;
    let vds = v_drain - v_source;

    let vgs_dual = crate::dual3::Dual3::new(vgs, 0);
    let vds_dual = crate::dual3::Dual3::new(vds, 1);
    let vbs_dual = crate::dual3::Dual3::new(0.0, 2);

    if let Some(ref eqs) = comp.va_equations {
        for (_from, _to, expr_str) in eqs {
            if let Ok(ast) = crate::parser::parse_va_expression(expr_str) {
                let ports = [vgs_dual, vds_dual, vbs_dual];

                let mut va_params = HashMap::new();
                va_params.insert("vth0".to_string(), 0.35);
                va_params.insert("beta".to_string(), 0.02);
                va_params.insert("lambda".to_string(), 0.02);

                if let Ok(i_dual) = ast.evaluate(&va_params, &ports) {
                    let ids = i_dual.val;
                    let gm = i_dual.deriv[0];
                    let gds = i_dual.deriv[1];

                    let ieq = ids - gm * vgs - gds * vds;

                    let mut stamp = |r: usize, c: usize, val: f64| {
                        if r > 0 && c > 0 {
                            matrix_a.add_element(r - 1, c - 1, val);
                        }
                    };

                    stamp(node_drain, node_drain, gds);
                    stamp(node_drain, node_gate, gm);
                    stamp(node_drain, node_source, -(gds + gm));

                    stamp(node_source, node_drain, -gds);
                    stamp(node_source, node_gate, -gm);
                    stamp(node_source, node_source, gds + gm);

                    if node_drain > 0 {
                        vector_z[node_drain - 1] -= ieq;
                    }
                    if node_source > 0 {
                        vector_z[node_source - 1] += ieq;
                    }
                }
            }
        }
    }
}

pub(super) fn stamp_bvoltage(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let netlist = ctx.netlist;
    let n = ctx.n;
    let size = ctx.size;
    let vsource_map = ctx.vsource_map;
    let prev_voltages = ctx.prev_voltages;
    let solution = ctx.solution;
    let ast_cache = &mut *ctx.ast_cache;
    let matrix_a = &mut *ctx.matrix_a;
    let vector_z = &mut *ctx.vector_z;
    if let Some(ref expr_str) = comp.expression {
        let _node_pos = comp.pins[0].parse::<usize>().unwrap_or(0);
        let _node_neg = comp.pins[1].parse::<usize>().unwrap_or(0);
        let mut nv = HashMap::new();
        nv.insert("0".to_string(), 0.0);
        for i in 1..=n {
            nv.insert(i.to_string(), prev_voltages[i]);
        }
        let mut bc = HashMap::new();
        for vs_comp in netlist
            .components
            .iter()
            .filter(|c| c.comp_type == "vsource" || c.comp_type == "bvoltage")
        {
            if let Some(&idx) = vsource_map.get(&vs_comp.id) {
                bc.insert(vs_comp.id.clone(), solution[n + idx]);
            }
        }
        if let Ok(ad) = evaluate_expression_ad(&expr_str, &nv, &bc, 0.0, ast_cache) {
            let vs_idx = *vsource_map.get(&comp.id).unwrap();
            let col = n + vs_idx;
            let mut ieq = ad.value;
            for (&node_idx, &dv_dvx) in &ad.grad {
                let v_k = if node_idx > 0 {
                    prev_voltages[node_idx]
                } else {
                    0.0
                };
                ieq -= dv_dvx * v_k;
                if col < size && node_idx > 0 {
                    matrix_a.add_element(col, node_idx - 1, -dv_dvx);
                }
            }
            vector_z[col] = ieq;
        }
    }
}

pub(super) fn stamp_bcurrent(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let netlist = ctx.netlist;
    let n = ctx.n;
    let vsource_map = ctx.vsource_map;
    let prev_voltages = ctx.prev_voltages;
    let solution = ctx.solution;
    let ast_cache = &mut *ctx.ast_cache;
    let matrix_a = &mut *ctx.matrix_a;
    let vector_z = &mut *ctx.vector_z;
    if let Some(ref expr_str) = comp.expression {
        let node_pos = comp.pins[0].parse::<usize>().unwrap_or(0);
        let node_neg = comp.pins[1].parse::<usize>().unwrap_or(0);
        let mut nv = HashMap::new();
        nv.insert("0".to_string(), 0.0);
        for i in 1..=n {
            nv.insert(i.to_string(), prev_voltages[i]);
        }
        let mut bc = HashMap::new();
        for vs_comp in netlist
            .components
            .iter()
            .filter(|c| c.comp_type == "vsource" || c.comp_type == "bvoltage")
        {
            if let Some(&idx) = vsource_map.get(&vs_comp.id) {
                bc.insert(vs_comp.id.clone(), solution[n + idx]);
            }
        }
        if let Ok(ad) = evaluate_expression_ad(&expr_str, &nv, &bc, 0.0, ast_cache) {
            let mut ieq = ad.value;
            for (&node_idx, &di_dv) in &ad.grad {
                let v_k = if node_idx > 0 {
                    prev_voltages[node_idx]
                } else {
                    0.0
                };
                ieq -= di_dv * v_k;
                if node_idx > 0 {
                    if node_pos > 0 {
                        matrix_a.add_element(node_pos - 1, node_idx - 1, di_dv);
                    }
                    if node_neg > 0 {
                        matrix_a.add_element(node_neg - 1, node_idx - 1, -di_dv);
                    }
                }
            }
            if node_pos > 0 {
                vector_z[node_pos - 1] -= ieq;
            }
            if node_neg > 0 {
                vector_z[node_neg - 1] += ieq;
            }
        }
    }
}
