use crate::solver::{SparseMatrix, ComplexSparseMatrix};
use num_complex::Complex;
use nalgebra::DVector;
use std::collections::BTreeMap;

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct SparseMatrixCSC {
    pub size: usize,
    pub col_pointers: Vec<usize>,
    pub row_indices: Vec<usize>,
    pub values: Vec<f64>,
}

#[allow(dead_code)]
impl SparseMatrixCSC {
    pub fn from_sparse(matrix: &SparseMatrix) -> Self {
        let size = matrix.size;
        
        let mut elements = Vec::new();
        for (r, row_map) in matrix.rows.iter().enumerate() {
            for (&c, &val) in row_map {
                elements.push((r, c, val));
            }
        }


        elements.sort_by(|a, b| {
            match a.1.cmp(&b.1) {
                std::cmp::Ordering::Equal => a.0.cmp(&b.0),
                other => other,
            }
        });

        let mut col_pointers = vec![0; size + 1];
        let mut row_indices = Vec::with_capacity(elements.len());
        let mut values = Vec::with_capacity(elements.len());

        let mut current_col = 0;
        let mut count = 0;

        for (r, c, val) in elements {
            while current_col < c {
                col_pointers[current_col + 1] = count;
                current_col += 1;
            }
            row_indices.push(r);
            values.push(val);
            count += 1;
        }

        while current_col < size {
            col_pointers[current_col + 1] = count;
            current_col += 1;
        }

        Self {
            size,
            col_pointers,
            row_indices,
            values,
        }
    }

    /// Actualiza los valores numéricos de la matriz CSC desde una SparseMatrix MNA
    /// manteniendo el layout estructural estático e idéntico de forma ultra rápida en O(N) sin alocaciones de heap.
    pub fn update_from_sparse(&mut self, matrix: &SparseMatrix) {
        let n = self.size;
        for j in 0..n {
            let start = self.col_pointers[j];
            let end = self.col_pointers[j + 1];
            for idx in start..end {
                let r = self.row_indices[idx];
                self.values[idx] = *matrix.rows[r].get(&j).unwrap_or(&0.0);
            }
        }
    }


    /// Ejecuta la factorización numérica LU contigua sobre el layout simbólico precalculado.
    /// Utiliza el acumulador SPA provisto en el workspace para operar con cero asignaciones de heap.
    pub fn left_looking_factorize(
        &self,
        symbolic: &SymbolicLU,
        workspace: &mut NumericLUWorkspace,
    ) -> Result<(), String> {
        let n = self.size;
        
        // Resetear valores de L y U a cero
        workspace.l_values.fill(0.0);
        workspace.u_values.fill(0.0);

        for j in 0..n {
            // 1. Cargar la columna j de la matriz original A en el acumulador SPA (mapeando columna ordenada a original c_orig = q[j])
            let c_orig = symbolic.q[j];
            let col_start = self.col_pointers[c_orig];
            let col_end = self.col_pointers[c_orig + 1];
            for idx in col_start..col_end {
                let r_perm = symbolic.inv_p[self.row_indices[idx]]; // Fila permutada
                workspace.spa_values[r_perm] = self.values[idx];
                workspace.spa_occupied[r_perm] = true;
            }



            // 2. Left-Looking: Resolver la columna j usando columnas factorizadas de la izquierda (k < j)
            // Usamos el camino de eliminación precalculado estáticamente en SymbolicLU
            let elimination_path = &symbolic.elimination_paths[j];
            for &k in elimination_path {
                if workspace.spa_occupied[k] {
                    let l_col_start = symbolic.l_col_pointers[k];
                    let l_col_end = symbolic.l_col_pointers[k + 1];
                    let pivot = workspace.spa_values[k]; // El valor en la fila k es el multiplicador

                    for idx in l_col_start..l_col_end {
                        let r = symbolic.l_row_indices[idx];
                        if r > k {
                            workspace.spa_values[r] -= pivot * workspace.l_values[idx];
                            workspace.spa_occupied[r] = true;
                        }
                    }
                }
            }

            // 3. Descargar el acumulador SPA en los arrays contiguos de L y U
            // Elementos de la fila r < j van a U_j; fila r >= j van a L_j
            let u_col_start = symbolic.u_col_pointers[j];
            let u_col_end = symbolic.u_col_pointers[j + 1];
            for idx in u_col_start..u_col_end {
                let r = symbolic.u_row_indices[idx];
                workspace.u_values[idx] = workspace.spa_values[r];
                workspace.spa_values[r] = 0.0;
                workspace.spa_occupied[r] = false;
            }

            let l_col_start = symbolic.l_col_pointers[j];
            let l_col_end = symbolic.l_col_pointers[j + 1];
            
            // El último elemento de la columna en U es el pivote diagonal U_jj
            let mut u_diag_val = if u_col_end > u_col_start {
                workspace.u_values[u_col_end - 1]
            } else {
                0.0
            };
            
            if u_diag_val.abs() < 1e-13 {
                // Reemplazo Estático de Pivote (Static Pivoting)
                let sign = if u_diag_val >= 0.0 { 1.0 } else { -1.0 };
                u_diag_val = sign * 1e-13;
                if u_col_end > u_col_start {
                    workspace.u_values[u_col_end - 1] = u_diag_val;
                }
            }

            for idx in l_col_start..l_col_end {
                let r = symbolic.l_row_indices[idx];
                if r == j {
                    workspace.l_values[idx] = 1.0;
                } else {
                    workspace.l_values[idx] = workspace.spa_values[r] / u_diag_val;
                }
                workspace.spa_values[r] = 0.0;
                workspace.spa_occupied[r] = false;
            }
        }

        Ok(())
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct ComplexSparseMatrixCSC {
    pub size: usize,
    pub col_pointers: Vec<usize>,
    pub row_indices: Vec<usize>,
    pub values: Vec<Complex<f64>>,
}

#[allow(dead_code)]
impl ComplexSparseMatrixCSC {
    pub fn from_sparse(matrix: &ComplexSparseMatrix) -> Self {
        let size = matrix.size;
        
        let mut elements = Vec::new();
        for (r, row_map) in matrix.rows.iter().enumerate() {
            for (&c, &val) in row_map {
                elements.push((r, c, val));
            }
        }


        elements.sort_by(|a, b| {
            match a.1.cmp(&b.1) {
                std::cmp::Ordering::Equal => a.0.cmp(&b.0),
                other => other,
            }
        });

        let mut col_pointers = vec![0; size + 1];
        let mut row_indices = Vec::with_capacity(elements.len());
        let mut values = Vec::with_capacity(elements.len());

        let mut current_col = 0;
        let mut count = 0;

        for (r, c, val) in elements {
            while current_col < c {
                col_pointers[current_col + 1] = count;
                current_col += 1;
            }
            row_indices.push(r);
            values.push(val);
            count += 1;
        }

        while current_col < size {
            col_pointers[current_col + 1] = count;
            current_col += 1;
        }

        Self {
            size,
            col_pointers,
            row_indices,
            values,
        }
    }

    /// Actualiza los valores complejos de la matriz CSC desde una ComplexSparseMatrix MNA
    /// manteniendo el layout estructural estático e idéntico sin alocaciones.
    pub fn update_from_sparse(&mut self, matrix: &ComplexSparseMatrix) {
        let n = self.size;
        for j in 0..n {
            let start = self.col_pointers[j];
            let end = self.col_pointers[j + 1];
            for idx in start..end {
                let r = self.row_indices[idx];
                self.values[idx] = *matrix.rows[r].get(&j).unwrap_or(&Complex::new(0.0, 0.0));
            }
        }
    }

    /// Ejecuta la factorización numérica LU compleja contigua sobre el layout simbólico precalculado.
    /// Utiliza el acumulador Complex SPA provisto para operar con cero asignaciones de heap.
    pub fn left_looking_factorize(
        &self,
        symbolic: &SymbolicLU,
        workspace: &mut ComplexNumericLUWorkspace,
    ) -> Result<(), String> {
        let n = self.size;
        workspace.l_values.fill(Complex::new(0.0, 0.0));
        workspace.u_values.fill(Complex::new(0.0, 0.0));

        for j in 0..n {
            // 1. Cargar la columna j de la matriz original A en el acumulador SPA (mapeando columna ordenada a original c_orig = q[j])
            let c_orig = symbolic.q[j];
            let col_start = self.col_pointers[c_orig];
            let col_end = self.col_pointers[c_orig + 1];
            for idx in col_start..col_end {
                let r_perm = symbolic.inv_p[self.row_indices[idx]];
                workspace.spa_values[r_perm] = self.values[idx];
                workspace.spa_occupied[r_perm] = true;
            }

            // 2. Left-Looking: Resolver la columna j usando columnas factorizadas de la izquierda (k < j)
            let elimination_path = &symbolic.elimination_paths[j];
            for &k in elimination_path {
                if workspace.spa_occupied[k] {
                    let l_col_start = symbolic.l_col_pointers[k];
                    let l_col_end = symbolic.l_col_pointers[k + 1];
                    let pivot = workspace.spa_values[k];

                    for idx in l_col_start..l_col_end {
                        let r = symbolic.l_row_indices[idx];
                        if r > k {
                            workspace.spa_values[r] -= pivot * workspace.l_values[idx];
                            workspace.spa_occupied[r] = true;
                        }
                    }
                }
            }

            // 3. Descargar el acumulador SPA en los arrays contiguos de L y U
            let u_col_start = symbolic.u_col_pointers[j];
            let u_col_end = symbolic.u_col_pointers[j + 1];
            for idx in u_col_start..u_col_end {
                let r = symbolic.u_row_indices[idx];
                workspace.u_values[idx] = workspace.spa_values[r];
                workspace.spa_values[r] = Complex::new(0.0, 0.0);
                workspace.spa_occupied[r] = false;
            }

            let l_col_start = symbolic.l_col_pointers[j];
            let l_col_end = symbolic.l_col_pointers[j + 1];
            let mut u_diag_val = if u_col_end > u_col_start {
                workspace.u_values[u_col_end - 1]
            } else {
                Complex::new(0.0, 0.0)
            };

            if u_diag_val.norm() < 1e-13 {
                // Reemplazo Estático de Pivote Complejo
                let norm = u_diag_val.norm();
                let factor = if norm < 1e-30 {
                    Complex::new(1e-13, 0.0)
                } else {
                    u_diag_val * (1e-13 / norm)
                };
                u_diag_val = factor;
                if u_col_end > u_col_start {
                    workspace.u_values[u_col_end - 1] = u_diag_val;
                }
            }

            for idx in l_col_start..l_col_end {
                let r = symbolic.l_row_indices[idx];
                if r == j {
                    workspace.l_values[idx] = Complex::new(1.0, 0.0);
                } else {
                    workspace.l_values[idx] = workspace.spa_values[r] / u_diag_val;
                }
                workspace.spa_values[r] = Complex::new(0.0, 0.0);
                workspace.spa_occupied[r] = false;
            }
        }

        Ok(())
    }
}


#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct SymbolicLU {
    pub size: usize,
    pub p: Vec<usize>,                    // Permutación de filas (ordenado -> original)
    pub q: Vec<usize>,                    // Permutación de columnas (ordenado -> original)
    pub inv_p: Vec<usize>,                // Permutación inversa de filas (original -> ordenado)
    pub inv_q: Vec<usize>,                // Permutación inversa de columnas (original -> ordenado)
    pub l_col_pointers: Vec<usize>,       // Patrón de columnas de L
    pub l_row_indices: Vec<usize>,
    pub u_col_pointers: Vec<usize>,       // Patrón de columnas de U
    pub u_row_indices: Vec<usize>,
    pub elimination_paths: Vec<Vec<usize>>, // Caminos de dependencias estáticos k < j
}

#[allow(dead_code)]
impl SymbolicLU {
    pub fn analyze(matrix: &SparseMatrix) -> Self {
        // Ejecutar el análisis estructural de ordenación estática (AMD / Markowitz estático)
        let sym = crate::symbolic::SymbolicFactorization::analyze(matrix);
        let size = sym.size;

        // Calcular permutaciones inversas
        let mut inv_p = vec![0; size];
        for i in 0..size {
            inv_p[sym.p[i]] = i;
        }
        let mut inv_q = vec![0; size];
        for i in 0..size {
            inv_q[sym.q[i]] = i;
        }

        // Simulamos la eliminación para construir el patrón exacto de no-ceros de L y U
        let mut row_patterns = vec![BTreeMap::new(); size];
        for r in 0..size {
            for (&c, _) in &matrix.rows[r] {
                let r_perm = inv_p[r];
                let c_perm = inv_q[c];
                row_patterns[r_perm].insert(c_perm, 1.0);
            }
        }


        let mut l_rows = vec![BTreeMap::new(); size];
        let mut u_rows = vec![BTreeMap::new(); size];

        for i in 0..size {
            let row_i = row_patterns[i].clone();
            
            // Registrar diagonal de L
            l_rows[i].insert(i, 1.0);

            for &c in row_i.keys() {
                if c < i {
                    l_rows[i].insert(c, 1.0);
                } else {
                    u_rows[i].insert(c, 1.0);
                }
            }

            // Inyectar fill-ins simbólicos
            for r in (i + 1)..size {
                if row_patterns[r].contains_key(&i) {
                    for &c in row_i.keys() {
                        if c > i {
                            row_patterns[r].entry(c).or_insert(1.0);
                        }
                    }
                }
            }
        }

        // Convertir patrones por fila a formato por columna CSC para L
        let mut l_elements = Vec::new();
        for r in 0..size {
            for &c in l_rows[r].keys() {
                l_elements.push((r, c));
            }
        }
        l_elements.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));

        let mut l_col_pointers = vec![0; size + 1];
        let mut l_row_indices = Vec::with_capacity(l_elements.len());
        let mut current_col = 0;
        let mut count = 0;
        for (r, c) in l_elements {
            while current_col < c {
                l_col_pointers[current_col + 1] = count;
                current_col += 1;
            }
            l_row_indices.push(r);
            count += 1;
        }
        while current_col < size {
            l_col_pointers[current_col + 1] = count;
            current_col += 1;
        }

        // Convertir patrones por fila a formato por columna CSC para U
        let mut u_elements = Vec::new();
        for r in 0..size {
            for &c in u_rows[r].keys() {
                u_elements.push((r, c));
            }
        }
        u_elements.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));

        let mut u_col_pointers = vec![0; size + 1];
        let mut u_row_indices = Vec::with_capacity(u_elements.len());
        current_col = 0;
        count = 0;
        for (r, c) in u_elements {
            while current_col < c {
                u_col_pointers[current_col + 1] = count;
                current_col += 1;
            }
            u_row_indices.push(r);
            count += 1;
        }
        while current_col < size {
            u_col_pointers[current_col + 1] = count;
            current_col += 1;
        }

        // Calcular caminos de eliminación precalculados (elimination_paths)
        let mut elimination_paths = vec![Vec::new(); size];
        for j in 0..size {
            for k in 0..j {
                let col_start = l_col_pointers[k];
                let col_end = l_col_pointers[k + 1];
                if l_row_indices[col_start..col_end].contains(&j) {
                    elimination_paths[j].push(k);
                }
            }
        }

        Self {
            size,
            p: sym.p,
            q: sym.q,
            inv_p,
            inv_q,
            l_col_pointers,
            l_row_indices,
            u_col_pointers,
            u_row_indices,
            elimination_paths,
        }
    }


    /// Resuelve el sistema lineal L * U * x = P * b usando los valores numéricos planos factorizados
    pub fn solve(
        &self,
        workspace: &NumericLUWorkspace,
        b: &DVector<f64>,
    ) -> Option<DVector<f64>> {
        let n = self.size;
        let mut x = DVector::zeros(n);
        let mut y = DVector::zeros(n);

        // 1. Permutar el vector b: y_perm = P * b
        for r in 0..n {
            y[r] = b[self.p[r]];
        }

        // 2. Sustitución hacia adelante: L * z = y_perm (L es triangular inferior con diag=1)
        for j in 0..n {
            let col_start = self.l_col_pointers[j];
            let col_end = self.l_col_pointers[j + 1];
            let z_j = y[j];
            for idx in col_start..col_end {
                let r = self.l_row_indices[idx];
                if r > j {
                    y[r] -= workspace.l_values[idx] * z_j;
                }
            }
        }

        // 3. Sustitución hacia atrás: U * x_perm = y (U es triangular superior)
        for j in (0..n).rev() {
            let col_start = self.u_col_pointers[j];
            let col_end = self.u_col_pointers[j + 1];
            
            if col_end == col_start {
                return None;
            }
            
            // El último elemento de la columna en U es el pivote diagonal U_jj
            let diag_idx = col_end - 1;
            let u_jj = workspace.u_values[diag_idx];
            if u_jj.is_nan() || u_jj.abs() < 1e-15 {
                return None;
            }
            
            let x_j = y[j] / u_jj;
            x[j] = x_j;

            for idx in col_start..diag_idx {
                let r = self.u_row_indices[idx];
                y[r] -= workspace.u_values[idx] * x_j;
            }
        }

        // 4. Desordenar el vector x usando la permutación de columnas q
        let mut x_final = DVector::zeros(n);
        for r in 0..n {
            x_final[self.q[r]] = x[r];
        }

        Some(x_final)
    }

    /// Resuelve el sistema lineal complejo L * U * x = P * b usando los valores complejos planos factorizados
    pub fn solve_complex(
        &self,
        workspace: &ComplexNumericLUWorkspace,
        b: &DVector<Complex<f64>>,
    ) -> Option<DVector<Complex<f64>>> {
        let n = self.size;
        let mut x = DVector::zeros(n);
        let mut y = DVector::zeros(n);

        // 1. Permutar el vector b: y_perm = P * b
        for r in 0..n {
            y[r] = b[self.p[r]];
        }

        // 2. Sustitución hacia adelante: L * z = y_perm
        for j in 0..n {
            let col_start = self.l_col_pointers[j];
            let col_end = self.l_col_pointers[j + 1];
            let z_j = y[j];
            for idx in col_start..col_end {
                let r = self.l_row_indices[idx];
                if r > j {
                    y[r] -= workspace.l_values[idx] * z_j;
                }
            }
        }

        // 3. Sustitución hacia atrás: U * x_perm = y
        for j in (0..n).rev() {
            let col_start = self.u_col_pointers[j];
            let col_end = self.u_col_pointers[j + 1];
            
            if col_end == col_start {
                return None;
            }
            
            let diag_idx = col_end - 1;
            let u_jj = workspace.u_values[diag_idx];
            if u_jj.re.is_nan() || u_jj.im.is_nan() || u_jj.norm() < 1e-30 {
                return None;
            }
            
            let x_j = y[j] / u_jj;
            x[j] = x_j;

            for idx in col_start..diag_idx {
                let r = self.u_row_indices[idx];
                y[r] -= workspace.u_values[idx] * x_j;
            }
        }

        // 4. Desordenar el vector x usando la permutación de columnas q
        let mut x_final = DVector::zeros(n);
        for r in 0..n {
            x_final[self.q[r]] = x[r];
        }

        Some(x_final)
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct NumericLUWorkspace {
    pub spa_values: Vec<f64>,      // Acumulador denso temporal SPA
    pub spa_occupied: Vec<bool>,   // Marcas booleanas de marcas del SPA
    pub l_values: Vec<f64>,        // Valores numéricos planos factorizados de L
    pub u_values: Vec<f64>,        // Valores numéricos planos factorizados de U
}

#[allow(dead_code)]
impl NumericLUWorkspace {
    pub fn new(symbolic: &SymbolicLU) -> Self {
        let l_size = *symbolic.l_col_pointers.last().unwrap_or(&0);
        let u_size = *symbolic.u_col_pointers.last().unwrap_or(&0);
        Self {
            spa_values: vec![0.0; symbolic.size],
            spa_occupied: vec![false; symbolic.size],
            l_values: vec![0.0; l_size],
            u_values: vec![0.0; u_size],
        }
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct ComplexNumericLUWorkspace {
    pub spa_values: Vec<Complex<f64>>,   // Acumulador complejo temporal (SPA)
    pub spa_occupied: Vec<bool>,
    pub l_values: Vec<Complex<f64>>,     // Valores numéricos complejos factorizados de L
    pub u_values: Vec<Complex<f64>>,     // Valores numéricos complejos factorizados de U
}

#[allow(dead_code)]
impl ComplexNumericLUWorkspace {
    pub fn new(symbolic: &SymbolicLU) -> Self {
        let l_size = *symbolic.l_col_pointers.last().unwrap_or(&0);
        let u_size = *symbolic.u_col_pointers.last().unwrap_or(&0);
        Self {
            spa_values: vec![Complex::new(0.0, 0.0); symbolic.size],
            spa_occupied: vec![false; symbolic.size],
            l_values: vec![Complex::new(0.0, 0.0); l_size],
            u_values: vec![Complex::new(0.0, 0.0); u_size],
        }
    }
}

