use nalgebra::{DMatrix, DVector};
use num_complex::Complex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

#[derive(Debug, Clone)]
pub struct SparseMatrix {
    pub size: usize,
    pub rows: Vec<BTreeMap<usize, f64>>,
}

impl SparseMatrix {
    pub fn new(size: usize) -> Self {
        Self {
            size,
            rows: vec![BTreeMap::new(); size],
        }
    }

    pub fn add_element(&mut self, r: usize, c: usize, val: f64) {
        if r < self.size && c < self.size {
            *self.rows[r].entry(c).or_insert(0.0) += val;
        }
    }

    pub fn from_dense(dense: &DMatrix<f64>) -> Self {
        let size = dense.nrows();
        let mut rows = vec![BTreeMap::new(); size];
        for r in 0..size {
            for c in 0..size {
                let val = dense[(r, c)];
                if val.abs() > 1e-15 {
                    rows[r].insert(c, val);
                }
            }
        }
        Self { size, rows }
    }
}

#[derive(Debug, Clone)]
pub struct SparseLU {
    pub size: usize,
    pub l: Vec<BTreeMap<usize, f64>>, // Lower triangular (diagonal is implicit 1.0)
    pub u: Vec<BTreeMap<usize, f64>>, // Upper triangular
    pub p: Vec<usize>,                // Row permutations
    pub q: Vec<usize>,                // Column permutations
}

impl SparseLU {
    pub fn factorize(mut matrix: SparseMatrix) -> Result<Self, String> {
        let size = matrix.size;
        let mut p: Vec<usize> = (0..size).collect();
        let mut q: Vec<usize> = (0..size).collect();
        let mut l = vec![BTreeMap::new(); size];

        for i in 0..size {
            // 1. Calcular conteos activos R_r y C_c
            let mut r_count: Vec<usize> = vec![0; size];
            for r in i..size {
                r_count[r] = matrix.rows[r].keys().filter(|&&c| c >= i).count();
            }

            let mut c_count: Vec<usize> = vec![0; size];
            for c in i..size {
                let mut count = 0;
                for r in i..size {
                    if matrix.rows[r].contains_key(&c) {
                        count += 1;
                    }
                }
                c_count[c] = count;
            }

            // 2. Encontrar el valor máximo absoluto en cada columna activa c >= i
            let mut col_max = vec![0.0; size];
            for c in i..size {
                let mut max_val = 0.0;
                for r in i..size {
                    if let Some(&val) = matrix.rows[r].get(&c) {
                        let abs_val = val.abs();
                        if abs_val > max_val {
                            max_val = abs_val;
                        }
                    }
                }
                col_max[c] = max_val;
            }

            // 3. Buscar el mejor pivote (best_row, best_col) minimizando costo de Markowitz
            let mut best_row = None;
            let mut best_col = None;
            let mut min_markowitz = usize::MAX;
            let mut max_pivot_val = -1.0;
            let u_threshold = 1e-3; // Umbral de pivoteo relativo de SPICE

            for r in i..size {
                for &c in matrix.rows[r].keys() {
                    if c >= i {
                        if let Some(&val) = matrix.rows[r].get(&c) {
                            let abs_val = val.abs();
                            if abs_val > 1e-15 && abs_val >= u_threshold * col_max[c] {
                                let cost =
                                    (r_count[r].saturating_sub(1)) * (c_count[c].saturating_sub(1));
                                if cost < min_markowitz {
                                    min_markowitz = cost;
                                    best_row = Some(r);
                                    best_col = Some(c);
                                    max_pivot_val = abs_val;
                                } else if cost == min_markowitz && abs_val > max_pivot_val {
                                    best_row = Some(r);
                                    best_col = Some(c);
                                    max_pivot_val = abs_val;
                                }
                            }
                        }
                    }
                }
            }

            // Si no se encontró ningún pivote estable, buscar el elemento con mayor valor absoluto en la parte activa
            let (pivot_row, pivot_col) = match (best_row, best_col) {
                (Some(r), Some(c)) => (r, c),
                _ => {
                    let mut max_abs = 0.0;
                    let mut p_row = i;
                    let mut p_col = i;
                    for r in i..size {
                        for &c in matrix.rows[r].keys() {
                            if c >= i {
                                if let Some(&val) = matrix.rows[r].get(&c) {
                                    let abs_val = val.abs();
                                    if abs_val > max_abs {
                                        max_abs = abs_val;
                                        p_row = r;
                                        p_col = c;
                                    }
                                }
                            }
                        }
                    }
                    if max_abs < 1e-15 {
                        return Err(format!(
                            "Matriz singular detectada en paso {}. Imposible realizar factorización LU.",
                            i
                        ));
                    }
                    (p_row, p_col)
                }
            };

            // 4. Intercambiar filas (i <-> pivot_row)
            if pivot_row != i {
                matrix.rows.swap(i, pivot_row);
                l.swap(i, pivot_row);
                p.swap(i, pivot_row);
            }

            // 5. Intercambiar columnas (i <-> pivot_col)
            if pivot_col != i {
                for r in 0..size {
                    let val_i = matrix.rows[r].remove(&i);
                    let val_pc = matrix.rows[r].remove(&pivot_col);
                    if let Some(v) = val_i {
                        matrix.rows[r].insert(pivot_col, v);
                    }
                    if let Some(v) = val_pc {
                        matrix.rows[r].insert(i, v);
                    }
                }
                q.swap(i, pivot_col);
            }

            let pivot = *matrix.rows[i]
                .get(&i)
                .ok_or_else(|| "Fallo interno en pivot de LU".to_string())?;

            // 6. Eliminar entradas debajo del pivote en columna i
            let row_i_elements: Vec<(usize, f64)> = matrix.rows[i]
                .iter()
                .filter(|(&c, _)| c >= i)
                .map(|(&c, &v)| (c, v))
                .collect();

            for r in (i + 1)..size {
                if let Some(&val_r_i) = matrix.rows[r].get(&i) {
                    let factor = val_r_i / pivot;
                    if factor.abs() > 1e-15 {
                        l[r].insert(i, factor);
                    }

                    for &(c, val_i_c) in &row_i_elements {
                        let current_val = *matrix.rows[r].get(&c).unwrap_or(&0.0);
                        let new_val = current_val - factor * val_i_c;
                        if new_val.abs() > 1e-15 {
                            matrix.rows[r].insert(c, new_val);
                        } else {
                            matrix.rows[r].remove(&c);
                        }
                    }
                    matrix.rows[r].remove(&i);
                }
            }
        }

        Ok(Self {
            size,
            l,
            u: matrix.rows,
            p,
            q,
        })
    }

    pub fn solve(&self, b: &DVector<f64>) -> Option<DVector<f64>> {
        let size = self.size;
        let mut y = vec![0.0; size];

        // Forward substitution: L * y = P * b
        for r in 0..size {
            let pb_r = b[self.p[r]];
            let mut sum = 0.0;
            for (&c, &val) in &self.l[r] {
                sum += val * y[c];
            }
            y[r] = pb_r - sum;
        }

        // Backward substitution: U * x_perm = y
        let mut x_perm = DVector::zeros(size);
        for r in (0..size).rev() {
            let u_rr = *self.u[r].get(&r)?;
            if u_rr.abs() < 1e-30 {
                return None; // Singular upper triangle
            }
            let mut sum = 0.0;
            for (&c, &val) in &self.u[r] {
                if c > r {
                    sum += val * x_perm[c];
                }
            }
            x_perm[r] = (y[r] - sum) / u_rr;
        }

        // Desordenar usando permutación de columnas q
        let mut x = DVector::zeros(size);
        for r in 0..size {
            x[self.q[r]] = x_perm[r];
        }

        Some(x)
    }
}

#[derive(Debug, Clone)]
pub struct ComplexSparseMatrix {
    pub size: usize,
    pub rows: Vec<BTreeMap<usize, Complex<f64>>>,
}

impl ComplexSparseMatrix {
    pub fn new(size: usize) -> Self {
        Self {
            size,
            rows: vec![BTreeMap::new(); size],
        }
    }

    pub fn add_element(&mut self, r: usize, c: usize, val: Complex<f64>) {
        if r < self.size && c < self.size {
            *self.rows[r].entry(c).or_insert(Complex::new(0.0, 0.0)) += val;
        }
    }

    #[allow(dead_code)]
    pub fn from_dense(dense: &DMatrix<Complex<f64>>) -> Self {
        let size = dense.nrows();
        let mut rows = vec![BTreeMap::new(); size];
        for r in 0..size {
            for c in 0..size {
                let val = dense[(r, c)];
                if val.norm() > 1e-15 {
                    rows[r].insert(c, val);
                }
            }
        }
        Self { size, rows }
    }
}

#[derive(Debug, Clone)]
pub struct ComplexSparseLU {
    pub size: usize,
    pub l: Vec<BTreeMap<usize, Complex<f64>>>,
    pub u: Vec<BTreeMap<usize, Complex<f64>>>,
    pub p: Vec<usize>,
    pub q: Vec<usize>,
}

impl ComplexSparseLU {
    pub fn factorize(mut matrix: ComplexSparseMatrix) -> Result<Self, String> {
        let size = matrix.size;
        let mut p: Vec<usize> = (0..size).collect();
        let mut q: Vec<usize> = (0..size).collect();
        let mut l = vec![BTreeMap::new(); size];

        for i in 0..size {
            // 1. Calcular conteos activos R_r y C_c
            let mut r_count: Vec<usize> = vec![0; size];
            for r in i..size {
                r_count[r] = matrix.rows[r].keys().filter(|&&c| c >= i).count();
            }

            let mut c_count: Vec<usize> = vec![0; size];
            for c in i..size {
                let mut count = 0;
                for r in i..size {
                    if matrix.rows[r].contains_key(&c) {
                        count += 1;
                    }
                }
                c_count[c] = count;
            }

            // 2. Encontrar el valor máximo absoluto (norma) en cada columna activa c >= i
            let mut col_max = vec![0.0; size];
            for c in i..size {
                let mut max_val = 0.0;
                for r in i..size {
                    if let Some(&val) = matrix.rows[r].get(&c) {
                        let abs_val = val.norm();
                        if abs_val > max_val {
                            max_val = abs_val;
                        }
                    }
                }
                col_max[c] = max_val;
            }

            // 3. Buscar el mejor pivote (best_row, best_col) minimizando costo de Markowitz
            let mut best_row = None;
            let mut best_col = None;
            let mut min_markowitz = usize::MAX;
            let mut max_pivot_val = -1.0;
            let u_threshold = 1e-3; // Umbral de pivoteo relativo de SPICE

            for r in i..size {
                for &c in matrix.rows[r].keys() {
                    if c >= i {
                        if let Some(&val) = matrix.rows[r].get(&c) {
                            let abs_val = val.norm();
                            if abs_val > 1e-15 && abs_val >= u_threshold * col_max[c] {
                                let cost =
                                    (r_count[r].saturating_sub(1)) * (c_count[c].saturating_sub(1));
                                if cost < min_markowitz {
                                    min_markowitz = cost;
                                    best_row = Some(r);
                                    best_col = Some(c);
                                    max_pivot_val = abs_val;
                                } else if cost == min_markowitz && abs_val > max_pivot_val {
                                    best_row = Some(r);
                                    best_col = Some(c);
                                    max_pivot_val = abs_val;
                                }
                            }
                        }
                    }
                }
            }

            // Si no se encontró ningún pivote estable, buscar el elemento con mayor norma en la parte activa
            let (pivot_row, pivot_col) = match (best_row, best_col) {
                (Some(r), Some(c)) => (r, c),
                _ => {
                    let mut max_abs = 0.0;
                    let mut p_row = i;
                    let mut p_col = i;
                    for r in i..size {
                        for &c in matrix.rows[r].keys() {
                            if c >= i {
                                if let Some(&val) = matrix.rows[r].get(&c) {
                                    let abs_val = val.norm();
                                    if abs_val > max_abs {
                                        max_abs = abs_val;
                                        p_row = r;
                                        p_col = c;
                                    }
                                }
                            }
                        }
                    }
                    if max_abs < 1e-15 {
                        return Err(format!(
                            "Matriz compleja singular detectada en paso {}. Imposible realizar factorización LU.",
                            i
                        ));
                    }
                    (p_row, p_col)
                }
            };

            // 4. Intercambiar filas (i <-> pivot_row)
            if pivot_row != i {
                matrix.rows.swap(i, pivot_row);
                l.swap(i, pivot_row);
                p.swap(i, pivot_row);
            }

            // 5. Intercambiar columnas (i <-> pivot_col)
            if pivot_col != i {
                for r in 0..size {
                    let val_i = matrix.rows[r].remove(&i);
                    let val_pc = matrix.rows[r].remove(&pivot_col);
                    if let Some(v) = val_i {
                        matrix.rows[r].insert(pivot_col, v);
                    }
                    if let Some(v) = val_pc {
                        matrix.rows[r].insert(i, v);
                    }
                }
                q.swap(i, pivot_col);
            }

            let pivot = *matrix.rows[i]
                .get(&i)
                .ok_or_else(|| "Fallo interno en pivot de LU compleja".to_string())?;

            // 6. Eliminar entradas debajo del pivote en columna i
            let row_i_elements: Vec<(usize, Complex<f64>)> = matrix.rows[i]
                .iter()
                .filter(|(&c, _)| c >= i)
                .map(|(&c, &v)| (c, v))
                .collect();

            for r in (i + 1)..size {
                if let Some(&val_r_i) = matrix.rows[r].get(&i) {
                    let factor = val_r_i / pivot;
                    if factor.norm() > 1e-15 {
                        l[r].insert(i, factor);
                    }

                    for &(c, val_i_c) in &row_i_elements {
                        let current_val =
                            *matrix.rows[r].get(&c).unwrap_or(&Complex::new(0.0, 0.0));
                        let new_val = current_val - factor * val_i_c;
                        if new_val.norm() > 1e-15 {
                            matrix.rows[r].insert(c, new_val);
                        } else {
                            matrix.rows[r].remove(&c);
                        }
                    }
                    matrix.rows[r].remove(&i);
                }
            }
        }

        Ok(Self {
            size,
            l,
            u: matrix.rows,
            p,
            q,
        })
    }

    pub fn solve(&self, b: &DVector<Complex<f64>>) -> Option<DVector<Complex<f64>>> {
        let size = self.size;
        let mut y = vec![Complex::new(0.0, 0.0); size];

        // Forward substitution: L * y = P * b
        for r in 0..size {
            let pb_r = b[self.p[r]];
            let mut sum = Complex::new(0.0, 0.0);
            for (&c, &val) in &self.l[r] {
                sum += val * y[c];
            }
            y[r] = pb_r - sum;
        }

        // Backward substitution: U * x_perm = y
        let mut x_perm = DVector::zeros(size);
        for r in (0..size).rev() {
            let u_rr = *self.u[r].get(&r)?;
            if u_rr.norm() < 1e-30 {
                return None;
            }
            let mut sum = Complex::new(0.0, 0.0);
            for (&c, &val) in &self.u[r] {
                if c > r {
                    sum += val * x_perm[c];
                }
            }
            x_perm[r] = (y[r] - sum) / u_rr;
        }

        // Desordenar usando permutación de columnas q
        let mut x = DVector::zeros(size);
        for r in 0..size {
            x[self.q[r]] = x_perm[r];
        }

        Some(x)
    }
}

pub fn solve_sparse(matrix: &DMatrix<f64>, b: &DVector<f64>) -> Option<DVector<f64>> {
    let sparse = SparseMatrix::from_dense(matrix);
    let lu = SparseLU::factorize(sparse).ok()?;
    lu.solve(b)
}

#[allow(dead_code)]
pub fn solve_complex_sparse(
    matrix: &DMatrix<Complex<f64>>,
    b: &DVector<Complex<f64>>,
) -> Option<DVector<Complex<f64>>> {
    let sparse = ComplexSparseMatrix::from_dense(matrix);
    let lu = ComplexSparseLU::factorize(sparse).ok()?;
    lu.solve(b)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum MixedSignalEventType {
    LogicInputCrossing { pin_idx: usize, direction: bool }, // direction: true = HIGH, false = LOW
    LogicOutputTransition { pin_idx: usize, new_state: bool },
    McuPeriodicTick,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MixedSignalEvent {
    pub time: f64,
    pub component_id: String,
    pub event_type: MixedSignalEventType,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MixedSignalScheduler {
    pub events: Vec<MixedSignalEvent>, // Keep sorted by time ascending
    // Maps component_id -> HashMap<pin_idx -> current logic state>
    pub digital_states: HashMap<String, HashMap<usize, bool>>,
    // Maps component_id -> HashMap<pin_idx -> last analog voltage>
    pub last_analog_v: HashMap<String, HashMap<usize, f64>>,
}

impl MixedSignalScheduler {
    pub fn new() -> Self {
        Self {
            events: Vec::new(),
            digital_states: HashMap::new(),
            last_analog_v: HashMap::new(),
        }
    }

    pub fn schedule_event(&mut self, event: MixedSignalEvent) {
        let pos = self
            .events
            .binary_search_by(|e| {
                e.time
                    .partial_cmp(&event.time)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .unwrap_or_else(|e| e);
        self.events.insert(pos, event);
    }

    pub fn get_next_event_time(&self) -> Option<f64> {
        self.events.first().map(|e| e.time)
    }

    pub fn get_state(&self, comp_id: &str, pin_idx: usize) -> bool {
        self.digital_states
            .get(comp_id)
            .and_then(|m| m.get(&pin_idx))
            .copied()
            .unwrap_or(false)
    }

    pub fn set_state(&mut self, comp_id: &str, pin_idx: usize, state: bool) {
        self.digital_states
            .entry(comp_id.to_string())
            .or_default()
            .insert(pin_idx, state);
    }
}
