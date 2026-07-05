use crate::solver::{SparseLU, SparseMatrix};
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;

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
