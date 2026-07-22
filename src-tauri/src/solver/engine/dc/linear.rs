use crate::solver::matrix::SparseMatrix;
use crate::solver::types::CircuitNetlist;
use nalgebra::{DMatrix, DVector};
use std::collections::HashMap;

// Estampar componentes lineales de forma dispersa directa (Direct Sparse Stamping O1)
pub fn stamp_linear_components_sparse(
    netlist: &CircuitNetlist,
    n: usize,
    vsource_map: &HashMap<String, usize>,
    matrix_a: &mut SparseMatrix,
    vector_z: &mut DVector<f64>,
) -> Result<(), String> {
    // 1. Ejecutar análisis de topología por teoría de grafos para detectar y estabilizar nodos flotantes en DC
    let floating_nodes = crate::topology::find_floating_nodes(netlist, n);
    for &node_idx in &floating_nodes {
        if node_idx > 0 && node_idx <= n {
            matrix_a.add_element(node_idx - 1, node_idx - 1, 1e-12);
        }
    }

    // 2. Verificar preventivamente si hay ciclos ideales de fuentes de voltaje
    crate::topology::detect_ideal_voltage_loops(netlist, n)?;

    let stamp_conductance =
        |matrix: &mut SparseMatrix, row_node: usize, col_node: usize, conductance: f64| {
            if row_node > 0 && col_node > 0 {
                matrix.add_element(row_node - 1, col_node - 1, conductance);
            }
        };

    let stamp_voltage_branch = |matrix: &mut SparseMatrix,
                                vector: &mut DVector<f64>,
                                vsource_idx: usize,
                                node_pos: usize,
                                node_neg: usize,
                                voltage: f64| {
        let col = n + vsource_idx;
        if node_pos > 0 {
            matrix.add_element(node_pos - 1, col, 1.0);
            matrix.add_element(col, node_pos - 1, 1.0);
        }
        if node_neg > 0 {
            matrix.add_element(node_neg - 1, col, -1.0);
            matrix.add_element(col, node_neg - 1, -1.0);
        }
        vector[col] = voltage;
    };

    for comp in &netlist.components {
        match comp.comp_type.as_str() {
            "resistor" => {
                let node_a = comp.pins[0].parse::<usize>().unwrap();
                let node_b = comp.pins[1].parse::<usize>().unwrap();
                if comp.value <= 1e-12 {
                    return Err(format!(
                        "Resistencia demasiado baja en el componente pasivo R [{}].",
                        comp.id
                    ));
                }
                let conductance = 1.0 / comp.value;
                stamp_conductance(matrix_a, node_a, node_a, conductance);
                stamp_conductance(matrix_a, node_b, node_b, conductance);
                stamp_conductance(matrix_a, node_a, node_b, -conductance);
                stamp_conductance(matrix_a, node_b, node_a, -conductance);
            }
            "vsource" | "bvoltage" => {
                let node_pos = comp.pins[0].parse::<usize>().unwrap();
                let node_neg = comp.pins[1].parse::<usize>().unwrap();
                let vs_idx = *vsource_map.get(&comp.id).unwrap();
                let v_static = if comp.comp_type == "bvoltage" {
                    0.0
                } else {
                    comp.value
                };
                stamp_voltage_branch(matrix_a, vector_z, vs_idx, node_pos, node_neg, v_static);
            }
            "capacitor" => {
                let node_a = comp.pins[0].parse::<usize>().unwrap();
                let node_b = comp.pins[1].parse::<usize>().unwrap();
                let conductance = 1e-9;
                stamp_conductance(matrix_a, node_a, node_a, conductance);
                stamp_conductance(matrix_a, node_b, node_b, conductance);
                stamp_conductance(matrix_a, node_a, node_b, -conductance);
                stamp_conductance(matrix_a, node_b, node_a, -conductance);
            }
            "inductor" => {
                let is_coupled = if let Some(ref mutuals) = netlist.mutual_inductances {
                    mutuals
                        .iter()
                        .any(|m| m.l1_id == comp.id || m.l2_id == comp.id)
                } else {
                    false
                };
                if is_coupled {
                    continue;
                }

                let node_a = comp.pins[0].parse::<usize>().unwrap();
                let node_b = comp.pins[1].parse::<usize>().unwrap();
                let conductance = 1e3;
                stamp_conductance(matrix_a, node_a, node_a, conductance);
                stamp_conductance(matrix_a, node_b, node_b, conductance);
                stamp_conductance(matrix_a, node_a, node_b, -conductance);
                stamp_conductance(matrix_a, node_b, node_a, -conductance);
            }
            "isource" => {
                let node_pos = comp.pins[0].parse::<usize>().unwrap();
                let node_neg = comp.pins[1].parse::<usize>().unwrap();
                let val = comp.value;
                if node_pos > 0 {
                    vector_z[node_pos - 1] -= val;
                }
                if node_neg > 0 {
                    vector_z[node_neg - 1] += val;
                }
            }
            "vcvs" => {
                let node_pos = comp.pins[0].parse::<usize>().unwrap();
                let node_neg = comp.pins[1].parse::<usize>().unwrap();
                let ctrl_pos = comp.pins[2].parse::<usize>().unwrap();
                let ctrl_neg = comp.pins[3].parse::<usize>().unwrap();
                let gain = comp.value;
                let vs_idx = *vsource_map
                    .get(&comp.id)
                    .ok_or_else(|| format!("VCVS id {} no mapeado", comp.id))?;
                let col = n + vs_idx;
                if node_pos > 0 {
                    matrix_a.add_element(node_pos - 1, col, 1.0);
                    matrix_a.add_element(col, node_pos - 1, 1.0);
                }
                if node_neg > 0 {
                    matrix_a.add_element(node_neg - 1, col, -1.0);
                    matrix_a.add_element(col, node_neg - 1, -1.0);
                }
                if ctrl_pos > 0 {
                    matrix_a.add_element(col, ctrl_pos - 1, -gain);
                }
                if ctrl_neg > 0 {
                    matrix_a.add_element(col, ctrl_neg - 1, gain);
                }
            }
            "vccs" => {
                let node_pos = comp.pins[0].parse::<usize>().unwrap();
                let node_neg = comp.pins[1].parse::<usize>().unwrap();
                let ctrl_pos = comp.pins[2].parse::<usize>().unwrap();
                let ctrl_neg = comp.pins[3].parse::<usize>().unwrap();
                let g = comp.value;
                if node_pos > 0 {
                    if ctrl_pos > 0 {
                        matrix_a.add_element(node_pos - 1, ctrl_pos - 1, g);
                    }
                    if ctrl_neg > 0 {
                        matrix_a.add_element(node_pos - 1, ctrl_neg - 1, -g);
                    }
                }
                if node_neg > 0 {
                    if ctrl_pos > 0 {
                        matrix_a.add_element(node_neg - 1, ctrl_pos - 1, -g);
                    }
                    if ctrl_neg > 0 {
                        matrix_a.add_element(node_neg - 1, ctrl_neg - 1, g);
                    }
                }
            }
            "cccs" => {
                let node_pos = comp.pins[0].parse::<usize>().unwrap();
                let node_neg = comp.pins[1].parse::<usize>().unwrap();
                let gain = comp.value;
                if let Some(ref ctrl_source_id) = comp.controlling_source {
                    if let Some(&ctrl_vs_idx) = vsource_map.get(ctrl_source_id) {
                        let col = n + ctrl_vs_idx;
                        if node_pos > 0 {
                            matrix_a.add_element(node_pos - 1, col, gain);
                        }
                        if node_neg > 0 {
                            matrix_a.add_element(node_neg - 1, col, -gain);
                        }
                    } else {
                        return Err(format!(
                            "CCCS id {}: Fuente controladora {} no encontrada en el circuito.",
                            comp.id, ctrl_source_id
                        ));
                    }
                } else {
                    return Err(format!(
                        "CCCS id {}: Falta especificar la fuente controladora.",
                        comp.id
                    ));
                }
            }
            "ccvs" => {
                let node_pos = comp.pins[0].parse::<usize>().unwrap();
                let node_neg = comp.pins[1].parse::<usize>().unwrap();
                let r = comp.value;
                let vs_idx = *vsource_map
                    .get(&comp.id)
                    .ok_or_else(|| format!("CCVS id {} no mapeado", comp.id))?;
                let col = n + vs_idx;
                if node_pos > 0 {
                    matrix_a.add_element(node_pos - 1, col, 1.0);
                    matrix_a.add_element(col, node_pos - 1, 1.0);
                }
                if node_neg > 0 {
                    matrix_a.add_element(node_neg - 1, col, -1.0);
                    matrix_a.add_element(col, node_neg - 1, -1.0);
                }
                if let Some(ref ctrl_source_id) = comp.controlling_source {
                    if let Some(&ctrl_vs_idx) = vsource_map.get(ctrl_source_id) {
                        let ctrl_col = n + ctrl_vs_idx;
                        matrix_a.add_element(col, ctrl_col, -r);
                    } else {
                        return Err(format!(
                            "CCVS id {}: Fuente controladora {} no encontrada en el circuito.",
                            comp.id, ctrl_source_id
                        ));
                    }
                } else {
                    return Err(format!(
                        "CCVS id {}: Falta especificar la fuente controladora.",
                        comp.id
                    ));
                }
            }
            _ => {}
        }
    }

    Ok(())
}

// Estampar componentes lineales del circuito en la matriz MNA (Adaptador Retrocompatible)
pub fn stamp_linear_components(
    netlist: &CircuitNetlist,
    n: usize,
    vsource_map: &HashMap<String, usize>,
    matrix_a: &mut DMatrix<f64>,
    vector_z: &mut DVector<f64>,
) -> Result<(), String> {
    let size = matrix_a.nrows();
    let mut sparse = SparseMatrix::new(size);
    stamp_linear_components_sparse(netlist, n, vsource_map, &mut sparse, vector_z)?;
    for r in 0..size {
        for (&c, &val) in &sparse.rows[r] {
            matrix_a[(r, c)] = val;
        }
    }
    Ok(())
}
