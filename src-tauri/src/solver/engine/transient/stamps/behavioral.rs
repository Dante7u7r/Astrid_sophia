use super::super::super::devices::evaluate_expression_ad;
use super::StampContext;
use std::collections::HashMap;

pub(super) fn stamp_behavioral_sources(ctx: &mut StampContext<'_>) {
    let netlist = ctx.netlist;
    let n = ctx.n;
    let size = ctx.size;
    let vsource_map = ctx.vsource_map;
    let t = ctx.t;
    let prev_v = ctx.prev_v;
    let solution_iter = ctx.solution_iter;
    let mut ast_cache_t = &mut *ctx.ast_cache_t;
    let matrix_a_iter = &mut *ctx.matrix_a_iter;
    let vector_z_iter = &mut *ctx.vector_z_iter;
    // B-Sources dinámicas en transitorio
    // B-Sources dinámicas en transitorio con diferenciación automática
    for comp_bs in &netlist.components {
        if comp_bs.comp_type == "bvoltage" {
            if let Some(ref expr_str) = comp_bs.expression {
                let _node_pos_t = comp_bs.pins[0].parse::<usize>().unwrap_or(0);
                let _node_neg_t = comp_bs.pins[1].parse::<usize>().unwrap_or(0);
                let mut nv = HashMap::new();
                nv.insert("0".to_string(), 0.0);
                for i in 1..=n {
                    nv.insert(i.to_string(), prev_v[i]);
                }
                let mut bc = HashMap::new();
                for (sid, &sidx) in vsource_map.iter() {
                    bc.insert(sid.clone(), solution_iter[n + sidx]);
                }
                if let Ok(ad) = evaluate_expression_ad(expr_str, &nv, &bc, t, &mut ast_cache_t) {
                    let vs_idx = *vsource_map.get(&comp_bs.id).unwrap();
                    let col = n + vs_idx;
                    let mut ieq = ad.value;
                    for (&node_idx, &dv_dvx) in &ad.grad {
                        let v_k = if node_idx > 0 { prev_v[node_idx] } else { 0.0 };
                        ieq -= dv_dvx * v_k;
                        if col < size && node_idx > 0 {
                            matrix_a_iter[(col, node_idx - 1)] += -dv_dvx;
                        }
                    }
                    vector_z_iter[col] = ieq;
                }
            }
        } else if comp_bs.comp_type == "bcurrent" {
            if let Some(ref expr_str) = comp_bs.expression {
                let node_pos = comp_bs.pins[0].parse::<usize>().unwrap_or(0);
                let node_neg = comp_bs.pins[1].parse::<usize>().unwrap_or(0);
                let mut nv = HashMap::new();
                nv.insert("0".to_string(), 0.0);
                for i in 1..=n {
                    nv.insert(i.to_string(), prev_v[i]);
                }
                let mut bc = HashMap::new();
                for (sid, &sidx) in vsource_map.iter() {
                    bc.insert(sid.clone(), solution_iter[n + sidx]);
                }
                if let Ok(ad) = evaluate_expression_ad(expr_str, &nv, &bc, t, &mut ast_cache_t) {
                    let mut ieq = ad.value;
                    for (&node_idx, &di_dv) in &ad.grad {
                        let v_k = if node_idx > 0 { prev_v[node_idx] } else { 0.0 };
                        ieq -= di_dv * v_k;
                        if node_idx > 0 {
                            if node_pos > 0 {
                                matrix_a_iter[(node_pos - 1, node_idx - 1)] += di_dv;
                            }
                            if node_neg > 0 {
                                matrix_a_iter[(node_neg - 1, node_idx - 1)] += -di_dv;
                            }
                        }
                    }
                    if node_pos > 0 {
                        vector_z_iter[node_pos - 1] -= ieq;
                    }
                    if node_neg > 0 {
                        vector_z_iter[node_neg - 1] += ieq;
                    }
                }
            }
        }
    }
}
