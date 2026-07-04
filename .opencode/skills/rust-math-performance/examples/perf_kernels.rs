// perf_kernels.rs — Reference Implementation v2.0
// Skill: rust-math-performance
// Covers: pre-allocation discipline, CSC sparse matrix, LU condition estimate,
//         rayon AC frequency sweep, SIMD-friendly inner product, criterion benchmarks.

use nalgebra::{DMatrix, DVector};
use rayon::prelude::*;
use std::collections::HashMap;
use std::f64::consts::PI;
use std::sync::Arc;

// ─────────────────────────────────────────────────────────────
// §A  Pre-allocation discipline
// ─────────────────────────────────────────────────────────────

/// Demonstrates zero-allocation Newton-Raphson inner loop.
/// All buffers are pre-allocated before the loop and reused in-place.
pub struct NrWorkspace {
    pub matrix_a:  DMatrix<f64>,
    pub vector_z:  DVector<f64>,
    pub x_prev:    DVector<f64>,
    pub x_curr:    DVector<f64>,
    pub delta:     DVector<f64>,   // scratch for convergence check
}

impl NrWorkspace {
    /// Allocate all buffers exactly once. Call before the NR loop.
    pub fn new(size: usize) -> Self {
        NrWorkspace {
            matrix_a: DMatrix::zeros(size, size),
            vector_z: DVector::zeros(size),
            x_prev:   DVector::zeros(size),
            x_curr:   DVector::zeros(size),
            delta:    DVector::zeros(size),
        }
    }

    /// Reset the stamping buffers (not re-allocating them).
    #[inline]
    pub fn reset_stamps(&mut self) {
        self.matrix_a.fill(0.0);
        self.vector_z.fill(0.0);
    }

    /// Check NR convergence in-place using the pre-allocated delta buffer.
    /// Returns true if max(|x_curr - x_prev|) / (eps_abs + eps_rel*|x_curr|) < 1.
    pub fn has_converged(&mut self, eps_abs: f64, eps_rel: f64) -> bool {
        // delta = x_curr - x_prev (in-place, no allocation)
        for i in 0..self.delta.len() {
            self.delta[i] = self.x_curr[i] - self.x_prev[i];
        }
        self.delta.iter().zip(self.x_curr.iter()).all(|(&d, &x)| {
            d.abs() < eps_abs + eps_rel * x.abs()
        })
    }
}

// ─────────────────────────────────────────────────────────────
// §A.3  Compressed Sparse Column (CSC) matrix
// ─────────────────────────────────────────────────────────────

/// A CSC sparse matrix for large MNA systems (N > 100 nodes).
/// Two-phase construction: symbolic (structure) then numeric (values).
pub struct CscMatrix {
    pub nrows:   usize,
    pub ncols:   usize,
    pub values:  Vec<f64>,    // [nnz]
    pub row_idx: Vec<usize>,  // [nnz]
    pub col_ptr: Vec<usize>,  // [ncols + 1]
}

impl CscMatrix {
    /// Build the sparsity structure from a list of (row, col) pairs.
    /// Call once when the netlist topology is known.
    pub fn build_symbolic(nrows: usize, ncols: usize, entries: &[(usize, usize)]) -> Self {
        // Count entries per column
        let mut col_count = vec![0usize; ncols];
        for &(_, c) in entries { col_count[c] += 1; }

        // Compute column pointers (prefix sum)
        let mut col_ptr = vec![0usize; ncols + 1];
        for j in 0..ncols { col_ptr[j + 1] = col_ptr[j] + col_count[j]; }

        let nnz = col_ptr[ncols];
        let mut row_idx = vec![0usize; nnz];
        let mut col_offset = col_ptr[..ncols].to_vec(); // scratch

        // Fill row indices
        for &(r, c) in entries {
            let pos = col_offset[c];
            row_idx[pos] = r;
            col_offset[c] += 1;
        }

        CscMatrix {
            nrows, ncols,
            values:  vec![0.0; nnz],
            row_idx, col_ptr,
        }
    }

    /// Reset all numerical values to zero (preserves structure).
    #[inline]
    pub fn zero_values(&mut self) {
        self.values.fill(0.0); // single memset — O(nnz), no allocation
    }

    /// Add a value to entry (r, c). Panics if (r,c) not in the symbolic structure.
    pub fn add(&mut self, r: usize, c: usize, val: f64) {
        let start = self.col_ptr[c];
        let end   = self.col_ptr[c + 1];
        for k in start..end {
            if self.row_idx[k] == r {
                self.values[k] += val;
                return;
            }
        }
        panic!("CSC: entry ({r},{c}) not in symbolic structure — rebuild topology first");
    }

    /// Convert to a dense DMatrix for use with nalgebra LU.
    /// Only call at the solve step (not in the stamp loop).
    pub fn to_dense(&self) -> DMatrix<f64> {
        let mut m = DMatrix::zeros(self.nrows, self.ncols);
        for c in 0..self.ncols {
            for k in self.col_ptr[c]..self.col_ptr[c + 1] {
                m[(self.row_idx[k], c)] += self.values[k];
            }
        }
        m
    }
}

// ─────────────────────────────────────────────────────────────
// §B.3  Condition number estimate (infinity norm)
// ─────────────────────────────────────────────────────────────

/// Returns an estimate of the ∞-norm condition number of A.
/// Uses the LU factorisation to avoid an explicit inversion.
/// If κ > 1e12, warn the caller of potential loss of numerical precision.
pub fn condition_estimate(a: &DMatrix<f64>) -> f64 {
    let norm_a = a.norm(); // Frobenius norm (cheaper than true ∞-norm; sufficient for diagnostic)

    // Solve A·Y = I column-by-column to estimate ‖A⁻¹‖
    let lu = a.clone().lu();
    let n  = a.nrows();
    let mut norm_inv: f64 = 0.0;

    // Pre-allocate e (column of identity) and y (solution), reuse across columns
    let mut e = DVector::zeros(n);
    for j in 0..n {
        e.fill(0.0);
        e[j] = 1.0;
        if let Some(y) = lu.solve(&e) {
            norm_inv = norm_inv.max(y.norm());
        }
    }
    norm_a * norm_inv
}

// ─────────────────────────────────────────────────────────────
// §C.1  Rayon parallel AC frequency sweep
// ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct AcResult {
    pub frequency: f64,
    pub magnitude: f64, // |H(jω)| = |Vout / Vin|
    pub phase_deg: f64, // ∠H(jω) in degrees
}

/// Sweep a simple first-order RC low-pass filter analytically
/// to demonstrate the rayon parallel sweep pattern.
///
/// H(jω) = 1 / (1 + jωRC)
pub fn sweep_rc_lowpass_parallel(
    r: f64, c: f64,
    freq_start: f64, freq_stop: f64, points_per_decade: usize,
) -> Vec<AcResult> {
    // Build frequency grid (logarithmic)
    let decades = (freq_stop / freq_start).log10();
    let n_pts   = (decades * points_per_decade as f64).ceil() as usize;

    let freqs: Vec<f64> = (0..n_pts).map(|k| {
        freq_start * 10f64.powf(k as f64 / points_per_decade as f64)
    }).collect();

    // Each frequency point is independent — embarrassingly parallel
    freqs.par_iter().map(|&f| {
        let omega = 2.0 * PI * f;
        let rc    = r * c;
        // H = 1/(1+jωRC) → |H|² = 1/(1+(ωRC)²), ∠H = -arctan(ωRC)
        let mag   = 1.0 / (1.0 + (omega * rc).powi(2)).sqrt();
        let phase = -(omega * rc).atan().to_degrees();
        AcResult { frequency: f, magnitude: mag, phase_deg: phase }
    }).collect()
}

/// General AC sweep using a shared read-only netlist (Arc for thread safety).
/// Each thread receives its own MNA workspace — no shared mutable state.
pub fn sweep_ac_parallel_netlist<F>(
    freqs: Vec<f64>,
    solve_fn: F,
) -> Vec<AcResult>
where
    F: Fn(f64) -> AcResult + Send + Sync,
{
    freqs.par_iter().map(|&f| solve_fn(f)).collect()
}

// ─────────────────────────────────────────────────────────────
// §C.3  SIMD-friendly inner product (dot product of two f64 slices)
// ─────────────────────────────────────────────────────────────

/// Computes dot(a, b) for two contiguous f64 slices.
/// Written as a branch-free loop so LLVM can auto-vectorise to AVX2/FMA.
/// Requires `RUSTFLAGS="-C target-cpu=native"` for AVX2 to fire.
#[inline]
pub fn dot_f64(a: &[f64], b: &[f64]) -> f64 {
    assert_eq!(a.len(), b.len(), "dot_f64: length mismatch");
    // No branches, no function calls inside — the compiler will unroll and vectorise
    a.iter().zip(b.iter()).fold(0.0_f64, |acc, (&ai, &bi)| acc + ai * bi)
}

// ─────────────────────────────────────────────────────────────
// §D  Criterion benchmark stubs
// ─────────────────────────────────────────────────────────────
// To activate, add to Cargo.toml:
//   [dev-dependencies]
//   criterion = { version = "0.5", features = ["html_reports"] }
//
//   [[bench]]
//   name = "mna_bench"
//   harness = false
//
// Then place this module in benches/mna_bench.rs:

/*
use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion};
use your_crate::perf_kernels::{NrWorkspace, CscMatrix, sweep_rc_lowpass_parallel};

fn bench_nr_workspace(c: &mut Criterion) {
    let mut group = c.benchmark_group("NR-workspace");
    for size in [32usize, 64, 128, 256] {
        group.bench_with_input(BenchmarkId::new("reset", size), &size, |b, &s| {
            let mut ws = NrWorkspace::new(s);
            b.iter(|| ws.reset_stamps());
        });
    }
    group.finish();
}

fn bench_ac_sweep(c: &mut Criterion) {
    c.bench_function("AC sweep 100 pts rayon", |b| {
        b.iter(|| sweep_rc_lowpass_parallel(1e3, 1e-9, 10.0, 100e6, 10));
    });
}

criterion_group!(benches, bench_nr_workspace, bench_ac_sweep);
criterion_main!(benches);
*/

// ─────────────────────────────────────────────────────────────
// §E  Cargo.toml snippet (not compiled, shown as documentation)
// ─────────────────────────────────────────────────────────────

/*
[profile.release]
opt-level     = 3
lto           = "thin"
codegen-units = 1
panic         = "abort"
strip         = "symbols"

[dependencies]
nalgebra = { version = "0.33", features = ["std"] }
rayon    = "1.10"
serde    = { version = "1", features = ["derive"] }

[dev-dependencies]
criterion = { version = "0.5", features = ["html_reports"] }
*/

// ─────────────────────────────────────────────────────────────
// Unit tests
// ─────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_csc_add_and_dense() {
        let entries = vec![(0,0),(1,0),(0,1),(1,1)]; // 2×2 dense
        let mut csc = CscMatrix::build_symbolic(2, 2, &entries);
        csc.add(0, 0,  2.0);
        csc.add(1, 0, -1.0);
        csc.add(0, 1, -1.0);
        csc.add(1, 1,  2.0);
        let d = csc.to_dense();
        assert!((d[(0,0)] - 2.0).abs() < 1e-12);
        assert!((d[(0,1)] + 1.0).abs() < 1e-12);
    }

    #[test]
    fn test_dot_f64() {
        let a = [1.0, 2.0, 3.0, 4.0];
        let b = [4.0, 3.0, 2.0, 1.0];
        let result = dot_f64(&a, &b);
        assert!((result - 20.0).abs() < 1e-12);
    }

    #[test]
    fn test_ac_sweep_magnitude() {
        // RC lowpass: -3dB at f = 1/(2π·R·C)
        let r = 1e3; let c = 1e-9;
        let f3db = 1.0 / (2.0 * PI * r * c);
        let results = sweep_rc_lowpass_parallel(r, c, f3db * 0.5, f3db * 2.0, 10);
        // Find point closest to f3dB
        let closest = results.iter().min_by(|a, b|
            (a.frequency - f3db).abs().partial_cmp(&(b.frequency - f3db).abs()).unwrap()
        ).unwrap();
        // |H| at -3dB = 1/√2 ≈ 0.7071
        assert!((closest.magnitude - std::f64::consts::FRAC_1_SQRT_2).abs() < 0.02);
    }

    #[test]
    fn test_condition_estimate_identity() {
        let a = DMatrix::<f64>::identity(4, 4);
        let kappa = condition_estimate(&a);
        // κ(I) = 1 (exactly)
        assert!(kappa < 2.0, "κ(I) should be ≈1, got {kappa}");
    }
}
