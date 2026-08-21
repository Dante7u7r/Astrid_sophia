use crate::solver::{SparseLU, SparseMatrix};
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;

/// Trait unificado para precondicionadores lineales $M^{-1} \cdot v$.
pub trait Preconditioner: Send + Sync {
    /// Aplica el precondicionador: $out = M^{-1} \cdot rhs$.
    fn apply(&self, rhs: &[f64], out: &mut [f64]);
}

/// Precondicionador identidad: $M = I$, $out = rhs$ (GMRES sin precondicionar).
#[derive(Debug, Default, Clone, Copy)]
pub struct IdentityPreconditioner;

impl Preconditioner for IdentityPreconditioner {
    fn apply(&self, rhs: &[f64], out: &mut [f64]) {
        out.copy_from_slice(rhs);
    }
}

/// Precondicionador diagonal Jacobi: $M = \text{diag}(A)$, $out_i = rhs_i / A_{ii}$.
#[derive(Debug, Clone)]
pub struct JacobiPreconditioner {
    pub inv_diag: Vec<f64>,
}

impl JacobiPreconditioner {
    pub fn new(matrix: &SparseMatrix) -> Self {
        let n = matrix.size;
        let mut inv_diag = vec![1.0; n];
        for (r, row) in matrix.rows.iter().enumerate() {
            let d = row.get(&r).copied().unwrap_or(0.0);
            let val = if d.abs() < 1e-14 {
                if d >= 0.0 {
                    1e-12
                } else {
                    -1e-12
                }
            } else {
                d
            };
            inv_diag[r] = 1.0 / val;
        }
        Self { inv_diag }
    }
}

impl Preconditioner for JacobiPreconditioner {
    fn apply(&self, rhs: &[f64], out: &mut [f64]) {
        let len = rhs.len().min(self.inv_diag.len()).min(out.len());
        for i in 0..len {
            out[i] = rhs[i] * self.inv_diag[i];
        }
    }
}

/// Factorización LU Incompleta con Cero Fill-in (ILU(0)).
///
/// Conserva exactamente el patrón de dispersión de la matriz original $A$,
/// calculando matrices triangulares $L$ y $U$ tales que $(L \cdot U)_{ij} = A_{ij}$ para todo $(i, j) \in \text{pattern}(A)$.
/// Aplica sustitución progresiva y regresiva (forward/backward substitution) en tiempo $O(\text{nnz})$.
#[derive(Debug, Clone)]
pub struct Ilu0Preconditioner {
    pub size: usize,
    pub row_ptr: Vec<usize>,
    pub col_idx: Vec<usize>,
    pub lu_val: Vec<f64>,
    pub diag_idx: Vec<usize>,
}

impl Ilu0Preconditioner {
    /// Factoriza la matriz dispersa $A$ usando ILU(0) con estabilización diagonal MNA.
    pub fn factorize(matrix: &SparseMatrix) -> Result<Self, String> {
        let n = matrix.size;
        if n == 0 {
            return Ok(Self {
                size: 0,
                row_ptr: vec![0],
                col_idx: Vec::new(),
                lu_val: Vec::new(),
                diag_idx: Vec::new(),
            });
        }

        // 1. Construir representación CSR asegurando que cada fila contenga explícitamente su elemento diagonal
        let mut row_ptr = Vec::with_capacity(n + 1);
        let mut col_idx = Vec::new();
        let mut lu_val = Vec::new();
        let mut diag_idx = Vec::with_capacity(n);

        row_ptr.push(0);
        for r in 0..n {
            let mut entries: Vec<(usize, f64)> =
                matrix.rows[r].iter().map(|(&c, &v)| (c, v)).collect();
            if !matrix.rows[r].contains_key(&r) {
                entries.push((r, 0.0));
            }
            entries.sort_by_key(|&(c, _)| c);

            let mut d_pos = None;
            for (c, v) in entries {
                if c == r {
                    d_pos = Some(col_idx.len());
                }
                col_idx.push(c);
                lu_val.push(v);
            }
            diag_idx.push(d_pos.unwrap_or(row_ptr[r]));
            row_ptr.push(col_idx.len());
        }

        // 2. Factorización ILU(0) in-place
        for i in 0..n {
            let row_norm = matrix.rows[i]
                .values()
                .map(|v| v.abs())
                .fold(0.0, f64::max)
                .max(1.0);
            let diag_threshold = 1e-3 * row_norm;

            let r_start = row_ptr[i];
            let d_i = diag_idx[i];

            for k_idx in r_start..d_i {
                let k = col_idx[k_idx];
                let d_k = diag_idx[k];
                let mut piv = lu_val[d_k];
                if piv.abs() < 1e-14 {
                    piv = if piv >= 0.0 {
                        diag_threshold
                    } else {
                        -diag_threshold
                    };
                    lu_val[d_k] = piv;
                }

                let factor = lu_val[k_idx] / piv;
                lu_val[k_idx] = factor;

                // Actualizar elementos en fila i con la fila k
                for m_idx in (d_k + 1)..row_ptr[k + 1] {
                    let c = col_idx[m_idx];
                    for p_idx in (k_idx + 1)..row_ptr[i + 1] {
                        if col_idx[p_idx] == c {
                            lu_val[p_idx] -= factor * lu_val[m_idx];
                            break;
                        }
                    }
                }
            }

            // Regularización del pivote diagonal en fila i
            let mut piv_i = lu_val[d_i];
            if piv_i.abs() < 1e-14 {
                piv_i = if piv_i >= 0.0 {
                    diag_threshold
                } else {
                    -diag_threshold
                };
                lu_val[d_i] = piv_i;
            }
        }

        Ok(Self {
            size: n,
            row_ptr,
            col_idx,
            lu_val,
            diag_idx,
        })
    }
}

impl Preconditioner for Ilu0Preconditioner {
    fn apply(&self, rhs: &[f64], out: &mut [f64]) {
        let n = self.size;
        if n == 0 || rhs.len() != n || out.len() != n {
            return;
        }

        // 1. Forward solve: L * y = rhs (donde L tiene diagonal unitaria implícita)
        for i in 0..n {
            let mut sum = rhs[i];
            let d_i = self.diag_idx[i];
            for k_idx in self.row_ptr[i]..d_i {
                let c = self.col_idx[k_idx];
                sum -= self.lu_val[k_idx] * out[c];
            }
            out[i] = sum;
        }

        // 2. Backward solve: U * x = y (donde U contiene la diagonal en diag_idx)
        for i in (0..n).rev() {
            let mut sum = out[i];
            let d_i = self.diag_idx[i];
            for k_idx in (d_i + 1)..self.row_ptr[i + 1] {
                let c = self.col_idx[k_idx];
                sum -= self.lu_val[k_idx] * out[c];
            }
            let piv = self.lu_val[d_i];
            out[i] = sum / piv;
        }
    }
}

/// Opciones de configuración para el solver iterativo GMRES(m).
#[derive(Debug, Clone, Copy)]
pub struct GmresOptions {
    /// Dimensión del subespacio de Krylov antes de reiniciar (restart).
    pub restart: usize,
    /// Número máximo de iteraciones totales.
    pub max_iters: usize,
    /// Tolerancia de residuo relativo.
    pub tol: f64,
}

impl Default for GmresOptions {
    fn default() -> Self {
        Self {
            restart: 30,
            max_iters: 300,
            tol: 1e-9,
        }
    }
}

/// Resultado de la ejecución de GMRES.
#[derive(Debug, Clone)]
pub struct GmresResult {
    /// Vector solución aproximado $x$.
    pub x: Vec<f64>,
    /// Número total de iteraciones de Krylov ejecutadas.
    pub iterations: usize,
    /// Norma final del residuo relativo.
    pub final_residual: f64,
    /// Indica si el solver alcanzó la tolerancia especificada.
    pub converged: bool,
}

/// Multiplicación matriz-vector dispersa: $out = A \cdot v$.
fn matvec(matrix: &SparseMatrix, v: &[f64], out: &mut [f64]) {
    for (r, row) in matrix.rows.iter().enumerate() {
        let mut sum = 0.0;
        for (&c, &val) in row {
            if c < v.len() {
                sum += val * v[c];
            }
        }
        out[r] = sum;
    }
}

/// Producto punto entre dos vectores.
fn dot(a: &[f64], b: &[f64]) -> f64 {
    let mut sum = 0.0;
    for (&x, &y) in a.iter().zip(b.iter()) {
        sum += x * y;
    }
    sum
}

/// Calcula los coeficientes de rotación de Givens $(c, s, r)$ tales que:
/// $\begin{bmatrix} c & s \\ -s & c \end{bmatrix} \begin{bmatrix} a \\ b \end{bmatrix} = \begin{bmatrix} r \\ 0 \end{bmatrix}$
fn givens_rotation(a: f64, b: f64) -> (f64, f64, f64) {
    if b.abs() < 1e-15 {
        (1.0, 0.0, a)
    } else if a.abs() < 1e-15 {
        (0.0, 1.0, b)
    } else {
        let r = (a * a + b * b).sqrt();
        (a / r, b / r, r)
    }
}

/// Resuelve el sistema lineal general $A \cdot x = b$ usando el método GMRES(m)
/// con precondicionamiento izquierdo $M^{-1} A x = M^{-1} b$ y rotaciones de Givens.
pub fn gmres<P: Preconditioner>(
    matrix: &SparseMatrix,
    b: &[f64],
    x0: Option<&[f64]>,
    preconditioner: &P,
    options: GmresOptions,
) -> Result<GmresResult, String> {
    let n = matrix.size;
    if n == 0 {
        return Ok(GmresResult {
            x: Vec::new(),
            iterations: 0,
            final_residual: 0.0,
            converged: true,
        });
    }
    if b.len() != n {
        return Err(format!(
            "Dimensión incompatible en GMRES: matriz {n}x{n}, rhs {}",
            b.len()
        ));
    }

    let mut x = if let Some(x_init) = x0 {
        if x_init.len() != n {
            return Err("Dimensión incompatible de x0 en GMRES".to_string());
        }
        x_init.to_vec()
    } else {
        vec![0.0; n]
    };

    let mut r = vec![0.0; n];
    let mut z0 = vec![0.0; n];
    let mut ax = vec![0.0; n];
    let mut w = vec![0.0; n];
    let mut z = vec![0.0; n];

    // Residuo inicial: r0 = b - A * x0
    matvec(matrix, &x, &mut ax);
    for i in 0..n {
        r[i] = b[i] - ax[i];
    }
    let initial_true_res = dot(&r, &r).sqrt();
    let b_norm = dot(b, b).sqrt().max(1e-14);

    if initial_true_res < options.tol * b_norm || initial_true_res < 1e-14 {
        return Ok(GmresResult {
            x,
            iterations: 0,
            final_residual: initial_true_res,
            converged: true,
        });
    }

    preconditioner.apply(&r, &mut z0);
    let mut beta = dot(&z0, &z0).sqrt();

    let m = options.restart.min(n).max(1);
    let mut total_iters = 0;
    let mut final_res = initial_true_res;
    let mut converged = false;

    while total_iters < options.max_iters && !converged {
        if beta < 1e-14 {
            converged = true;
            break;
        }

        let mut v: Vec<Vec<f64>> = Vec::with_capacity(m + 1);
        let v0: Vec<f64> = z0.iter().map(|&val| val / beta).collect();
        v.push(v0);

        let mut h = vec![vec![0.0; m]; m + 1];
        let mut cs = vec![0.0; m];
        let mut sn = vec![0.0; m];
        let mut g = vec![0.0; m + 1];
        g[0] = beta;

        let mut k_steps = 0;

        for j in 0..m {
            total_iters += 1;
            k_steps = j + 1;

            // w = A * v_j
            matvec(matrix, &v[j], &mut w);
            // z = M^{-1} * w
            preconditioner.apply(&w, &mut z);

            // Modified Gram-Schmidt
            for i in 0..=j {
                let h_ij = dot(&v[i], &z);
                h[i][j] = h_ij;
                for l in 0..n {
                    z[l] -= h_ij * v[i][l];
                }
            }

            let h_next = dot(&z, &z).sqrt();
            h[j + 1][j] = h_next;
            if h_next > 1e-14 {
                let v_next: Vec<f64> = z.iter().map(|&val| val / h_next).collect();
                v.push(v_next);
            } else {
                v.push(vec![0.0; n]);
            }

            // Aplicar rotaciones de Givens previas a la columna j de H
            for i in 0..j {
                let temp = cs[i] * h[i][j] + sn[i] * h[i + 1][j];
                h[i + 1][j] = -sn[i] * h[i][j] + cs[i] * h[i + 1][j];
                h[i][j] = temp;
            }

            // Calcular nueva rotación de Givens para eliminar h_{j+1, j}
            let (c_j, s_j, r_val) = givens_rotation(h[j][j], h[j + 1][j]);
            cs[j] = c_j;
            sn[j] = s_j;
            h[j][j] = r_val;
            h[j + 1][j] = 0.0;

            // Aplicar rotación a g
            let temp_g = c_j * g[j] + s_j * g[j + 1];
            g[j + 1] = -s_j * g[j] + c_j * g[j + 1];
            g[j] = temp_g;

            let est_res = g[j + 1].abs();
            if est_res < options.tol * b_norm || est_res < 1e-14 {
                break;
            }

            if total_iters >= options.max_iters {
                break;
            }
        }

        // Resolver sistema triangular superior H_{1..k, 1..k} * y = g_{1..k}
        let mut y = vec![0.0; k_steps];
        for i in (0..k_steps).rev() {
            let mut sum = g[i];
            for l in (i + 1)..k_steps {
                sum -= h[i][l] * y[l];
            }
            let diag_elem = if h[i][i].abs() < 1e-14 {
                1e-12
            } else {
                h[i][i]
            };
            y[i] = sum / diag_elem;
        }

        // Actualizar solución x = x + sum_{i=0}^{k_steps-1} y_i * v_i
        for i in 0..k_steps {
            let y_i = y[i];
            for l in 0..n {
                x[l] += y_i * v[i][l];
            }
        }

        // Calcular residuo exacto real no precondicionado
        matvec(matrix, &x, &mut ax);
        for i in 0..n {
            r[i] = b[i] - ax[i];
        }
        let true_res = dot(&r, &r).sqrt();
        final_res = true_res;

        if true_res < options.tol * b_norm || true_res < 1e-14 {
            converged = true;
            break;
        }

        if total_iters < options.max_iters {
            preconditioner.apply(&r, &mut z0);
            beta = dot(&z0, &z0).sqrt();
            if beta < 1e-14 {
                converged = true;
                break;
            }
        }
    }

    Ok(GmresResult {
        x,
        iterations: total_iters,
        final_residual: final_res,
        converged,
    })
}

/// Resuelve $A \cdot x = b$ utilizando GMRES con precondicionamiento ILU(0).
pub fn gmres_solve_ilu0(
    matrix: &SparseMatrix,
    b: &[f64],
    tol: f64,
    max_iters: usize,
) -> Result<Vec<f64>, String> {
    let ilu = Ilu0Preconditioner::factorize(matrix)?;
    let options = GmresOptions {
        restart: 30,
        max_iters,
        tol,
    };
    let res = gmres(matrix, b, None, &ilu, options)?;
    if !res.converged && res.final_residual > tol * 10.0 {
        return Err(format!(
            "GMRES(ILU0) no convergió tras {} iteraciones (residuo final: {})",
            res.iterations, res.final_residual
        ));
    }
    Ok(res.x)
}

/// Implementa la Iteración de Arnoldi para extraer los polos de estabilidad dominantes
/// directamente sobre las matrices dispersas nativas C y G en O(k * N^2)
pub fn arnoldi_poles(
    g_sparse: &SparseMatrix,
    c_sparse: &SparseMatrix,
    k_poles: usize,
) -> Result<Vec<Complex<f64>>, String> {
    let size = g_sparse.size;
    if size == 0 {
        return Ok(Vec::new());
    }

    let k = k_poles.min(size - 1).max(1);

    // 1. Factorizar la matriz de capacitancias C
    let c_lu = SparseLU::factorize(c_sparse.clone())
        .map_err(|e| format!("Fallo de factorización de C en Arnoldi: {}", e))?;

    // 2. Asignar arrays de Arnoldi
    let mut v = vec![DVector::<f64>::zeros(size); k + 1];
    let mut h = DMatrix::<f64>::zeros(k + 1, k);

    // Vector inicial estocástico ortonormalizado
    let rng_vec = DVector::<f64>::from_fn(size, |i, _| ((i + 1) as f64).sin());
    let norm = rng_vec.norm();
    if norm < 1e-12 {
        return Err("Vector de inicialización Arnoldi singular.".to_string());
    }
    v[0] = rng_vec / norm;

    // 3. Iteración de Arnoldi modificada con ortogonalización Gram-Schmidt
    for j in 0..k {
        // w = A * v_j = -C^{-1} * G * v_j
        // a. Multiplicación dispersa por -G: temp = -G * v_j
        let mut temp = DVector::<f64>::zeros(size);
        for r in 0..size {
            let mut sum = 0.0;
            for (&col, &val) in &g_sparse.rows[r] {
                sum += val * v[j][col];
            }
            temp[r] = -sum;
        }

        // b. Resolución del sistema disperso: w = C^{-1} * temp
        let w = c_lu
            .solve(&temp)
            .ok_or_else(|| "Fallo al resolver sistema triangular en Arnoldi.".to_string())?;

        let mut w_orth = w.clone();
        for i in 0..=j {
            h[(i, j)] = w.dot(&v[i]);
            w_orth -= h[(i, j)] * &v[i];
        }

        h[(j + 1, j)] = w_orth.norm();
        if h[(j + 1, j)] > 1e-12 {
            v[j + 1] = w_orth / h[(j + 1, j)];
        } else {
            // El subespacio convergió prematuramente
            break;
        }
    }

    // 4. Reducir a la submatriz Hessenberg H_k y extraer autovalores Ritz
    #[allow(deprecated)]
    let h_sub = h.slice((0, 0), (k, k)).into_owned();

    if let Some(eigenvalues) = h_sub.eigenvalues() {
        let mut poles = Vec::new();
        for val in eigenvalues.iter() {
            poles.push(Complex::new(*val, 0.0));
        }
        Ok(poles)
    } else {
        Err("Fallo en la diagonalización QR de Hessenberg en Arnoldi.".to_string())
    }
}
