#![allow(clippy::needless_range_loop)]
use crate::solver::SparseMatrix;

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct SymbolicFactorization {
    pub size: usize,
    pub p: Vec<usize>,                        // Permutación de filas
    pub q: Vec<usize>,                        // Permutación de columnas
    pub elimination_tree: Vec<Option<usize>>, // Árbol de eliminación (padres de cada nodo)
}

#[allow(dead_code)]
impl SymbolicFactorization {
    /// Genera un análisis simbólico inicial basado en la topología estructural de la matriz
    pub fn analyze(matrix: &SparseMatrix) -> Self {
        let size = matrix.size;
        let mut p: Vec<usize> = (0..size).collect();
        let mut q: Vec<usize> = (0..size).collect();
        let mut elimination_tree = vec![None; size];

        // Simulamos el análisis Markowitz para encontrar el ordenamiento estático de pivoteo
        let mut temp_matrix = matrix.clone();

        for i in 0..size {
            // 1. Calcular conteos estructurales activos (no nulos)
            let mut r_count = vec![0usize; size];
            for r in i..size {
                r_count[r] = temp_matrix.rows[r].keys().filter(|&&c| c >= i).count();
            }

            let mut c_count = vec![0usize; size];
            for c in i..size {
                let mut count = 0;
                for r in i..size {
                    if temp_matrix.rows[r].contains_key(&c) {
                        count += 1;
                    }
                }
                c_count[c] = count;
            }

            // 2. Encontrar el pivote que minimiza el costo Markowitz estructural
            let mut best_row = i;
            let mut best_col = i;
            let mut min_cost = usize::MAX;

            for r in i..size {
                for &c in temp_matrix.rows[r].keys() {
                    if c >= i {
                        let cost = (r_count[r].saturating_sub(1)) * (c_count[c].saturating_sub(1));
                        if cost < min_cost {
                            min_cost = cost;
                            best_row = r;
                            best_col = c;
                        }
                    }
                }
            }

            // Aplicar permutaciones en las copias simbólicas
            if best_row != i {
                temp_matrix.rows.swap(i, best_row);
                p.swap(i, best_row);
            }
            if best_col != i {
                for r in 0..size {
                    let val_i = temp_matrix.rows[r].remove(&i);
                    let val_col = temp_matrix.rows[r].remove(&best_col);
                    if let Some(vi) = val_i {
                        temp_matrix.rows[r].insert(best_col, vi);
                    }
                    if let Some(vc) = val_col {
                        temp_matrix.rows[r].insert(i, vc);
                    }
                }
                q.swap(i, best_col);
            }

            // 3. Simular eliminación e inyectar fill-ins simbólicos
            let row_i = temp_matrix.rows[i].clone();
            let mut first_lower_row = None;

            for r in (i + 1)..size {
                if temp_matrix.rows[r].contains_key(&i) {
                    if first_lower_row.is_none() {
                        first_lower_row = Some(r);
                    }
                    // Inyectar fill-ins simbólicos estructurales
                    for &c in row_i.keys() {
                        if c > i {
                            temp_matrix.rows[r].entry(c).or_insert(1.0);
                        }
                    }
                }
            }

            // Registrar padre en el árbol de eliminación
            if let Some(r_parent) = first_lower_row {
                elimination_tree[i] = Some(r_parent);
            }
        }

        Self {
            size,
            p,
            q,
            elimination_tree,
        }
    }
}
