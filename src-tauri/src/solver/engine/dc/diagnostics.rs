use crate::solver::matrix::SparseMatrix;
use crate::solver::types::CircuitNetlist;
use nalgebra::DVector;
use std::collections::HashMap;

pub(super) fn multiply_sparse_matrix_vector(
    matrix: &SparseMatrix,
    x: &DVector<f64>,
) -> DVector<f64> {
    let mut y = DVector::zeros(matrix.size);
    for r in 0..matrix.size {
        let mut sum = 0.0;
        for (&c, &val) in &matrix.rows[r] {
            sum += val * x[c];
        }
        y[r] = sum;
    }
    y
}

pub(super) fn diagnose_convergence_failure(
    netlist: &CircuitNetlist,
    n: usize,
    _m: usize,
    vsource_map: &HashMap<String, usize>,
    solution: &DVector<f64>,
    matrix_a: &SparseMatrix,
    vector_z: &DVector<f64>,
) -> String {
    let f_k = multiply_sparse_matrix_vector(matrix_a, solution) - vector_z;
    let mut max_err = -1.0;
    let mut max_idx = 0;
    for (i, val) in f_k.iter().enumerate() {
        let abs_val = val.abs();
        if abs_val > max_err {
            max_err = abs_val;
            max_idx = i;
        }
    }

    if max_idx < n {
        let node_num = max_idx + 1;
        let mut connected_comps = Vec::new();
        for comp in &netlist.components {
            for pin in &comp.pins {
                if let Ok(p_num) = pin.parse::<usize>() {
                    if p_num == node_num {
                        connected_comps.push(format!("{} [{}]", comp.id, comp.comp_type));
                    }
                }
            }
        }
        if !connected_comps.is_empty() {
            format!(
                "Error de convergencia en el Nodo {} (error residual: {:.2e}). Componentes sospechosos conectados: {}. Sugerencia: Verifique los valores nominales o agregue una resistencia en paralelo si el circuito no tiene retorno de CC.",
                node_num, max_err, connected_comps.join(", ")
            )
        } else {
            format!(
                "Error de convergencia en el Nodo {} (error residual: {:.2e}).",
                node_num, max_err
            )
        }
    } else {
        let vs_idx = max_idx - n;
        let mut vs_id = "Desconocida".to_string();
        for (id, &idx) in vsource_map {
            if idx == vs_idx {
                vs_id = id.clone();
                break;
            }
        }
        format!(
            "Error de convergencia en la ecuación de corriente de la fuente de tensión {} (error residual: {:.2e}). Sugerencia: Verifique que no haya lazos de fuentes ideales o cortocircuitos.",
            vs_id, max_err
        )
    }
}
