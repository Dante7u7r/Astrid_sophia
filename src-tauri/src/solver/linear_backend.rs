//! Linear Solver Backend — Abstracción y conectores de solvers lineales (faer + custom CSC).
//!
//! Proporciona:
//! 1. `LinearSolverBackend`: Trait unificado para resolución de sistemas lineales reales y complejos.
//! 2. `FaerLinearSolver`: Backend de alto rendimiento con SIMD vectorizado usando el crate `faer`.
//! 3. `CustomCscLinearSolver`: Backend legado basado en CSC left-looking y Markowitz estático.
//! 4. Funciones auxiliares `solve_linear_real` y `solve_linear_complex` para despacho optimizado.

use crate::solver::matrix::{ComplexSparseMatrix, SparseLU, SparseMatrix};
use faer::prelude::*;
use faer::{Col, Mat};
use num_complex::Complex;

/// Trait unificado para backends de resolución de sistemas lineales $A \cdot x = b$.
pub trait LinearSolverBackend: Send + Sync {
    /// Resuelve el sistema lineal real $A \cdot x = b$.
    fn solve_real(&self, matrix: &SparseMatrix, rhs: &[f64]) -> Result<Vec<f64>, String>;

    /// Resuelve el sistema lineal complejo $A \cdot x = b$.
    fn solve_complex(
        &self,
        matrix: &ComplexSparseMatrix,
        rhs: &[Complex<f64>],
    ) -> Result<Vec<Complex<f64>>, String>;
}

/// Backend de álgebra lineal de alto rendimiento impulsado por `faer`.
/// Utiliza kernels SIMD avanzados (AVX2, AVX-512, NEON) y pivoteo completo para estabilidad SPICE MNA.
#[derive(Debug, Default, Clone, Copy)]
pub struct FaerLinearSolver;

impl LinearSolverBackend for FaerLinearSolver {
    fn solve_real(&self, matrix: &SparseMatrix, rhs: &[f64]) -> Result<Vec<f64>, String> {
        let n = matrix.size;
        if n == 0 {
            return Ok(Vec::new());
        }
        if rhs.len() != n {
            return Err(format!(
                "Dimensión incompatible en FaerLinearSolver: matriz {}x{}, rhs {}",
                n,
                n,
                rhs.len()
            ));
        }

        // 1. Construir matriz contigua para faer
        let mut mat_a = Mat::<f64>::zeros(n, n);
        for (r, row_map) in matrix.rows.iter().enumerate() {
            for (&c, &val) in row_map {
                if r < n && c < n {
                    mat_a[(r, c)] += val;
                }
            }
        }

        // 2. Construir vector RHS
        let mut vec_b = Col::<f64>::zeros(n);
        for i in 0..n {
            vec_b[i] = rhs[i];
        }

        // 3. Factorización LU con pivoteo completo (Full Pivoting LU)
        let lu = mat_a.full_piv_lu();
        let sol_col = lu.solve(&vec_b);

        // 4. Extraer solución y verificar valores no finitos (NaN / Inf)
        let mut solution = vec![0.0; n];
        for i in 0..n {
            let val = sol_col[i];
            if !val.is_finite() {
                return Err(
                    "Error numérico: Solución contiene valores no finitos (singularidad o circuito singular/abierto)".to_string(),
                );
            }
            solution[i] = val;
        }

        Ok(solution)
    }

    fn solve_complex(
        &self,
        matrix: &ComplexSparseMatrix,
        rhs: &[Complex<f64>],
    ) -> Result<Vec<Complex<f64>>, String> {
        let n = matrix.size;
        if n == 0 {
            return Ok(Vec::new());
        }
        if rhs.len() != n {
            return Err(format!(
                "Dimensión incompatible en FaerLinearSolver (complejo): matriz {}x{}, rhs {}",
                n,
                n,
                rhs.len()
            ));
        }

        // Para sistemas complejos, convertimos al sistema aumentado real 2N x 2N equivalente:
        // [ A_r  -A_i ] [ x_r ] = [ b_r ]
        // [ A_i   A_r ] [ x_i ]   [ b_i ]
        let n2 = 2 * n;
        let mut mat_2n = Mat::<f64>::zeros(n2, n2);

        for (r, row_map) in matrix.rows.iter().enumerate() {
            for (&c, val) in row_map {
                if r < n && c < n {
                    let re = val.re;
                    let im = val.im;

                    // Bloque [A_r] en (r, c)
                    mat_2n[(r, c)] += re;
                    // Bloque [-A_i] en (r, c + n)
                    mat_2n[(r, c + n)] -= im;
                    // Bloque [A_i] en (r + n, c)
                    mat_2n[(r + n, c)] += im;
                    // Bloque [A_r] en (r + n, c + n)
                    mat_2n[(r + n, c + n)] += re;
                }
            }
        }

        let mut vec_2n = Col::<f64>::zeros(n2);
        for i in 0..n {
            vec_2n[i] = rhs[i].re;
            vec_2n[i + n] = rhs[i].im;
        }

        let lu_2n = mat_2n.full_piv_lu();
        let sol_2n = lu_2n.solve(&vec_2n);

        let mut solution = Vec::with_capacity(n);
        for i in 0..n {
            let re = sol_2n[i];
            let im = sol_2n[i + n];
            if !re.is_finite() || !im.is_finite() {
                return Err("Error numérico complejo en FaerLinearSolver: NaN/Inf detectado".to_string());
            }
            solution.push(Complex::new(re, im));
        }

        Ok(solution)
    }
}

/// Backend legado basado en descomposición LU propia con Markowitz.
#[derive(Debug, Default, Clone, Copy)]
pub struct CustomCscLinearSolver;

impl LinearSolverBackend for CustomCscLinearSolver {
    fn solve_real(&self, matrix: &SparseMatrix, rhs: &[f64]) -> Result<Vec<f64>, String> {
        let lu = SparseLU::factorize(matrix.clone())?;
        let rhs_vec = nalgebra::DVector::from_row_slice(rhs);
        let sol = lu
            .solve(&rhs_vec)
            .ok_or_else(|| "Error en resolución con solver custom".to_string())?;
        Ok(sol.as_slice().to_vec())
    }

    fn solve_complex(
        &self,
        matrix: &ComplexSparseMatrix,
        rhs: &[Complex<f64>],
    ) -> Result<Vec<Complex<f64>>, String> {
        let lu = crate::solver::matrix::ComplexSparseLU::factorize(matrix.clone())?;
        let rhs_vec = nalgebra::DVector::from_row_slice(rhs);
        let sol = lu
            .solve(&rhs_vec)
            .ok_or_else(|| "Error en resolución compleja con solver custom".to_string())?;
        Ok(sol.as_slice().to_vec())
    }
}

/// Resuelve un sistema lineal real utilizando el solver óptimo (faer con fallback custom).
pub fn solve_linear_real(matrix: &SparseMatrix, rhs: &[f64]) -> Result<Vec<f64>, String> {
    let faer_solver = FaerLinearSolver;
    match faer_solver.solve_real(matrix, rhs) {
        Ok(sol) => Ok(sol),
        Err(_) => {
            // Fallback a solver custom
            let fallback = CustomCscLinearSolver;
            fallback.solve_real(matrix, rhs)
        }
    }
}

/// Resuelve un sistema lineal complejo utilizando el solver óptimo (faer con fallback custom).
pub fn solve_linear_complex(
    matrix: &ComplexSparseMatrix,
    rhs: &[Complex<f64>],
) -> Result<Vec<Complex<f64>>, String> {
    let faer_solver = FaerLinearSolver;
    match faer_solver.solve_complex(matrix, rhs) {
        Ok(sol) => Ok(sol),
        Err(_) => {
            // Fallback a solver custom
            let fallback = CustomCscLinearSolver;
            fallback.solve_complex(matrix, rhs)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_faer_linear_solver_resistive_divider() {
        // Divisor resistivo 10V con R1 = 1k, R2 = 1k
        // Nodos: 1 (10V), 2 (5V)
        // MNA:
        // Fila 0: G1 + G2 en nodo 2 -> 2e-3 * V2 - G1 * V1 = 0
        // Fila 1: V1 = 10 -> rama de voltaje
        let mut mat = SparseMatrix::new(3);
        // Nodo 1: Vsource
        mat.add_element(0, 2, 1.0); // I_V1 en nodo 1
        mat.add_element(0, 0, 1e-3); // G1 de nodo 1
        mat.add_element(0, 1, -1e-3);

        // Nodo 2: Divisor
        mat.add_element(1, 0, -1e-3);
        mat.add_element(1, 1, 2e-3);

        // Ecuación de fuente V1 = 10
        mat.add_element(2, 0, 1.0);

        let rhs = vec![0.0, 0.0, 10.0];

        let solver = FaerLinearSolver;
        let sol = solver.solve_real(&mat, &rhs).expect("Resolución con faer fallida");

        assert_eq!(sol.len(), 3);
        assert!((sol[0] - 10.0).abs() < 1e-9, "V1 debe ser 10V");
        assert!((sol[1] - 5.0).abs() < 1e-9, "V2 debe ser 5V");
    }

    #[test]
    fn test_faer_linear_solver_complex_ac() {
        // Circuito RC con V_in = 1.0 + 0.0i, R = 1k, C = 1uF a f = 1kHz (w = 2*pi*1000)
        let mut mat = ComplexSparseMatrix::new(2);
        let w = 2.0 * std::f64::consts::PI * 1000.0;
        let c_val = 1e-6;
        let g_val = 1e-3;

        // Nodo 1: Vin = 1.0
        mat.add_element(0, 0, Complex::new(1.0, 0.0));
        // Nodo 2: G*(V2 - V1) + j*w*C*V2 = 0 => -G*V1 + (G + j*w*C)*V2 = 0
        mat.add_element(1, 0, Complex::new(-g_val, 0.0));
        mat.add_element(1, 1, Complex::new(g_val, w * c_val));

        let rhs = vec![Complex::new(1.0, 0.0), Complex::new(0.0, 0.0)];

        let solver = FaerLinearSolver;
        let sol = solver.solve_complex(&mat, &rhs).expect("Resolución compleja faer fallida");

        assert!((sol[0].re - 1.0).abs() < 1e-9);
        assert!((sol[0].im).abs() < 1e-9);

        // V2 analítico = 1 / (1 + j*w*R*C)
        let expected = 1.0 / Complex::new(1.0, w * 1e3 * 1e-6);
        assert!((sol[1].re - expected.re).abs() < 1e-6);
        assert!((sol[1].im - expected.im).abs() < 1e-6);
    }
}
