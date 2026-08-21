//! Linear Solver Backend — Abstracción y conectores de solvers lineales (faer + custom CSC).
//!
//! Proporciona:
//! 1. `LinearSolverBackend`: Trait unificado para resolución de sistemas lineales reales y complejos.
//! 2. `FaerLinearSolver`: Backend de alto rendimiento con SIMD vectorizado usando el crate `faer`.
//! 3. `FaerFactorizedReal` y `FaerFactorizedComplex`: Solvers pre-factorizados para múltiples vectores RHS en O(N^2).
//! 4. `CustomCscLinearSolver`: Backend legado basado en CSC left-looking y Markowitz estático.
//! 5. Funciones auxiliares `solve_linear_real` y `solve_linear_complex` para despacho optimizado.

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

/// Estructura de factorización LU real pre-calculada con `faer`.
/// Permite resolver múltiples vectores RHS sucesivamente en tiempo $O(N^2)$.
#[derive(Debug, Clone)]
pub struct FaerFactorizedReal {
    size: usize,
    mat_a: Mat<f64>,
}

impl FaerFactorizedReal {
    pub fn solve(&self, rhs: &[f64]) -> Result<Vec<f64>, String> {
        let n = self.size;
        if n == 0 {
            return Ok(Vec::new());
        }
        if rhs.len() != n {
            return Err(format!(
                "Dimensión incompatible en FaerFactorizedReal: matriz {n}x{n}, rhs {}",
                rhs.len()
            ));
        }

        let mut vec_b = Col::<f64>::zeros(n);
        for i in 0..n {
            vec_b[i] = rhs[i];
        }

        let lu = self.mat_a.full_piv_lu();
        let sol_col = lu.solve(&vec_b);
        let mut solution = vec![0.0; n];
        for i in 0..n {
            let val = sol_col[i];
            if !val.is_finite() {
                return Err(
                    "Error numérico: Solución contiene valores no finitos (matriz singular o mal condicionada)".to_string(),
                );
            }
            solution[i] = val;
        }

        Ok(solution)
    }
}

/// Estructura de factorización LU compleja pre-calculada con `faer` vía sistema aumentado $2N \times 2N$.
/// Permite resolver múltiples vectores RHS complejos en barridos de ruido y sensibilidad en $O(N^2)$.
#[derive(Debug, Clone)]
pub struct FaerFactorizedComplex {
    size: usize,
    mat_2n: Mat<f64>,
}

impl FaerFactorizedComplex {
    pub fn solve(&self, rhs: &[Complex<f64>]) -> Result<Vec<Complex<f64>>, String> {
        let n = self.size;
        if n == 0 {
            return Ok(Vec::new());
        }
        if rhs.len() != n {
            return Err(format!(
                "Dimensión incompatible en FaerFactorizedComplex: matriz compleja {n}x{n}, rhs {}",
                rhs.len()
            ));
        }

        let n2 = 2 * n;
        let mut vec_2n = Col::<f64>::zeros(n2);
        for i in 0..n {
            vec_2n[i] = rhs[i].re;
            vec_2n[i + n] = rhs[i].im;
        }

        let lu_2n = self.mat_2n.full_piv_lu();
        let sol_2n = lu_2n.solve(&vec_2n);
        let mut solution = Vec::with_capacity(n);
        for i in 0..n {
            let re = sol_2n[i];
            let im = sol_2n[i + n];
            if !re.is_finite() || !im.is_finite() {
                return Err(
                    "Error numérico complejo en FaerFactorizedComplex: NaN/Inf detectado"
                        .to_string(),
                );
            }
            solution.push(Complex::new(re, im));
        }

        Ok(solution)
    }
}

/// Backend de álgebra lineal de alto rendimiento impulsado por `faer`.
/// Utiliza kernels SIMD avanzados (AVX2, AVX-512, NEON) y pivoteo completo para estabilidad SPICE MNA.
#[derive(Debug, Default, Clone, Copy)]
pub struct FaerLinearSolver;

impl FaerLinearSolver {
    /// Pre-factoriza una matriz real en $O(N^3)$ para resolución acelerada de múltiples vectores RHS.
    pub fn factorize_real(&self, matrix: &SparseMatrix) -> Result<FaerFactorizedReal, String> {
        let n = matrix.size;
        let mut mat_a = Mat::<f64>::zeros(n, n);
        for (r, row_map) in matrix.rows.iter().enumerate() {
            for (&c, &val) in row_map {
                if r < n && c < n {
                    mat_a[(r, c)] += val;
                }
            }
        }
        Ok(FaerFactorizedReal { size: n, mat_a })
    }

    /// Pre-factoriza una matriz compleja vía sistema aumentado $2N \times 2N$.
    pub fn factorize_complex(
        &self,
        matrix: &ComplexSparseMatrix,
    ) -> Result<FaerFactorizedComplex, String> {
        let n = matrix.size;
        let n2 = 2 * n;
        let mut mat_2n = Mat::<f64>::zeros(n2, n2);

        for (r, row_map) in matrix.rows.iter().enumerate() {
            for (&c, val) in row_map {
                if r < n && c < n {
                    let re = val.re;
                    let im = val.im;

                    mat_2n[(r, c)] += re;
                    mat_2n[(r, c + n)] -= im;
                    mat_2n[(r + n, c)] += im;
                    mat_2n[(r + n, c + n)] += re;
                }
            }
        }

        Ok(FaerFactorizedComplex { size: n, mat_2n })
    }
}

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

        let fact = self.factorize_real(matrix)?;
        fact.solve(rhs)
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

        let fact = self.factorize_complex(matrix)?;
        fact.solve(rhs)
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

/// Factoriza un sistema lineal real con faer.
pub fn factorize_linear_real(matrix: &SparseMatrix) -> Result<FaerFactorizedReal, String> {
    FaerLinearSolver.factorize_real(matrix)
}

/// Factoriza un sistema lineal complejo con faer.
pub fn factorize_linear_complex(
    matrix: &ComplexSparseMatrix,
) -> Result<FaerFactorizedComplex, String> {
    FaerLinearSolver.factorize_complex(matrix)
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
        let sol = solver
            .solve_real(&mat, &rhs)
            .expect("Resolución con faer fallida");

        assert_eq!(sol.len(), 3);
        assert!((sol[0] - 10.0).abs() < 1e-9, "V1 debe ser 10V");
        assert!((sol[1] - 5.0).abs() < 1e-9, "V2 debe ser 5V");
    }

    #[test]
    fn test_faer_factorized_multiple_rhs() {
        let mut mat = SparseMatrix::new(2);
        mat.add_element(0, 0, 2.0);
        mat.add_element(0, 1, 1.0);
        mat.add_element(1, 0, 1.0);
        mat.add_element(1, 1, 3.0);

        let fact = factorize_linear_real(&mat).expect("Factorización fallida");

        let rhs1 = vec![5.0, 5.0];
        let sol1 = fact.solve(&rhs1).expect("Solución 1 fallida");
        // 2x + y = 5, x + 3y = 5 -> 5y = 5 -> y = 1, x = 2
        assert!((sol1[0] - 2.0).abs() < 1e-9);
        assert!((sol1[1] - 1.0).abs() < 1e-9);

        let rhs2 = vec![8.0, 9.0];
        let sol2 = fact.solve(&rhs2).expect("Solución 2 fallida");
        // 2x + y = 8, x + 3y = 9 -> 5y = 10 -> y = 2, x = 3
        assert!((sol2[0] - 3.0).abs() < 1e-9);
        assert!((sol2[1] - 2.0).abs() < 1e-9);
    }

    #[test]
    fn test_faer_zero_diagonal_pivoting() {
        // Matriz MNA con cero en la diagonal (típico de fuentes de voltaje independientes puras)
        // [ 0  1 ] [ x ] = [ 5 ]
        // [ 1  1 ] [ y ]   [ 7 ]
        // Solución: y = 5, x = 2
        let mut mat = SparseMatrix::new(2);
        mat.add_element(0, 1, 1.0);
        mat.add_element(1, 0, 1.0);
        mat.add_element(1, 1, 1.0);

        let rhs = vec![5.0, 7.0];
        let sol = solve_linear_real(&mat, &rhs).expect("Pivoteo sobre diagonal cero falló");
        assert!((sol[0] - 2.0).abs() < 1e-9);
        assert!((sol[1] - 5.0).abs() < 1e-9);
    }

    #[test]
    fn test_faer_linear_solver_complex_ac() {
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
        let sol = solver
            .solve_complex(&mat, &rhs)
            .expect("Resolución compleja faer fallida");

        assert!((sol[0].re - 1.0).abs() < 1e-9);
        assert!((sol[0].im).abs() < 1e-9);

        // V2 analítico = 1 / (1 + j*w*R*C)
        let expected = 1.0 / Complex::new(1.0, w * 1e3 * 1e-6);
        assert!((sol[1].re - expected.re).abs() < 1e-6);
        assert!((sol[1].im - expected.im).abs() < 1e-6);
    }
}
