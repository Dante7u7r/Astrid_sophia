---
name: rust-math-performance
description: Use when writing Rust numerical code, sparse/dense matrix solvers, parallelization with rayon, SIMD vectorization, or memory optimization in computation kernels
---

# Skill: Rust Math Performance
**Revision:** 2.0 — PhD-Grade Reference

---

## 1. Context and Objective

This skill equips the agent to write memory-safe, cache-efficient, and highly parallel numerical kernels in Rust for solving matrix algebra systems and graph-based circuit models.

Canonical references:
> Drepper, U. — *What Every Programmer Should Know About Memory*, Red Hat, 2007.
> Williams, S. et al. — *Roofline: An Insightful Visual Performance Model for Multicore Architectures*, CACM, 2009.
> Golub, G.H. & Van Loan, C.F. — *Matrix Computations*, 4th ed., §§3–4.

---

## 2. Core Directives & Standards

---

### A. Memory Layout and Allocation Discipline

#### A.1 Heap Allocation Rules

In any hot loop (Newton-Raphson iteration, transient time-step, frequency sweep):

- **Forbidden:** `vec![]`, `.collect()`, `Box::new(...)`, `Arc::new(...)`, `String::new()`, `HashMap::new()`.
- **Mandatory:** Pre-allocate **all** working buffers before the loop with `Vec::with_capacity(n)` or `[T; N]` arrays. Pass them as `&mut [T]` slices into helper functions.

Rationale: `malloc` / `free` round-trips introduce $O(1)$ latency spikes of 50–200 ns each, which compound to measurable overhead at $10^4$–$10^6$ iterations.

#### A.2 Cache-Friendly Matrix Storage

For dense matrices of size $N \leq 500$, use row-major (C order) contiguous `Vec<f64>` with manual 2D indexing:

```rust
let idx = |r: usize, c: usize| r * n + c;
matrix[idx(i, j)] += value;
```

`nalgebra`'s `DMatrix` is column-major (Fortran order). When using `nalgebra`, traverse columns in the outer loop:

```rust
for col in 0..n {
    for row in 0..n {
        // nalgebra[(row, col)] is cache-sequential
    }
}
```

Cache line size on modern x86_64: 64 bytes = 8 × `f64`. Accessing a row of a column-major matrix strides by $N \cdot 8$ bytes — a cache miss every access for large $N$.

#### A.3 Sparse Matrix Representation (CSC)

For $N > 100$ nodes, MNA matrices are sparse (typical fill-factor: $O(N)$ non-zeros out of $O(N^2)$ entries). Use Compressed Sparse Column (CSC) format:

```
values:     [f64; nnz]     // non-zero values
row_idx:    [usize; nnz]   // row index of each value
col_ptr:    [usize; n+1]   // col_ptr[j]..col_ptr[j+1] = column j's range in values
```

Column $j$ spans `values[col_ptr[j]..col_ptr[j+1]]`.

Fill the sparsity structure once from the netlist topology (symbolic phase), then numerically refactor at each NR iteration without reallocation (numeric phase). This is the AMD+KLU strategy used in SPICE3 and NGSPICE.

---

### B. Dense Linear Algebra with `nalgebra`

#### B.1 LU Decomposition with Partial Pivoting

For systems of size $N + M \leq 200$, LU with partial pivoting is $O(N^3 / 3)$ flops and numerically stable:

```rust
use nalgebra::{DMatrix, DVector};

// Perform PA = LU decomposition (P = permutation matrix)
let lu = matrix_a.clone().lu();

// Solve A * x = z in O(N^2) using forward/back substitution
let x = lu.solve(&vector_z)
    .ok_or("Matrix is singular — check for floating nodes or VS loops")?;
```

**Do not** call `.inverse()` on $\mathbf{A}$ to solve; inversion costs $O(N^3)$ flops with a larger constant and accumulates round-off error. $\mathbf{A}^{-1}\mathbf{z}$ is mathematically equivalent to solving $\mathbf{A}\mathbf{x} = \mathbf{z}$ but numerically inferior.

#### B.2 In-Place Matrix Mutation

Prefer `A.copy_from(&B)` over re-allocating a new matrix when resetting between NR iterations. Use `nalgebra`'s `fill`, `set_row`, `set_column`, and slice operations to mutate sub-blocks:

```rust
// Reset only the G sub-block; leave B, C stamps intact
matrix_a.view_mut((0, 0), (n, n)).fill(0.0);
```

#### B.3 Condition Number and Numerical Stability

Before calling `lu.solve`, optionally check the matrix condition number estimate for diagnostic purposes:

$$\kappa(\mathbf{A}) = \|\mathbf{A}\|_\infty \cdot \|\mathbf{A}^{-1}\|_\infty$$

If $\kappa > 10^{12}$, warn the user of potential loss of 12 decimal digits of precision (double has ~15-16 significant digits). A high $\kappa$ usually indicates a near-floating node (connected via very large resistance).

---

### C. Parallelisation Strategy

#### C.1 Rayon for Embarrassingly Parallel Sweeps

AC frequency sweeps and DC parameter sweeps are embarrassingly parallel: each frequency/parameter point is independent. Parallelise with `rayon`:

```rust
use rayon::prelude::*;

let results: Vec<SimResult> = sweep_points
    .par_iter()
    .map(|&freq| solve_ac_point(&netlist, freq))
    .collect();
```

**Thread safety requirement:** Each closure must own its data or use read-only shared references. Pre-clone the `Netlist` per thread, or use `Arc<Netlist>` with immutable access. Never use `Mutex` on the hot path — it serialises execution.

**Recommended thread pool size:** `rayon` auto-tunes to the number of physical cores. Override with `ThreadPoolBuilder::new().num_threads(N).build_global()` if memory bandwidth saturation is observed.

#### C.2 Newton-Raphson — Why NOT to Parallelise

The NR iteration is **inherently sequential**: iteration $k+1$ depends on the solution of iteration $k$. Do not attempt to parallelise within a single operating-point solve.

Exception: multi-tone harmonic balance methods decompose frequency components in parallel — out of scope for standard transient/DC.

#### C.3 SIMD Auto-Vectorisation Prerequisites

The Rust compiler (LLVM backend) auto-vectorises arithmetic loops when:
1. The loop body is free of branches (no `if`/`match` inside).
2. Slice data is `f64` (64-bit aligned).
3. No aliasing: distinct `&mut [f64]` slices do not overlap.
4. Loop trip count is a compile-time constant **or** `#[allow(clippy::doc_markdown)]` annotations guide LLVM.

Verify vectorisation with `RUSTFLAGS="-C target-cpu=native" cargo build --release` and inspect the assembly (`cargo objdump --release`). Look for `vmovupd` / `vfmadd` (AVX) or `vmovapd` (AVX, aligned).

---

### D. Profiling and Benchmarking Protocol

1. **Macro-benchmark:** Use `criterion` crate. Run at least 100 samples; report mean ± standard deviation.
2. **Micro-profile:** Use `perf stat -e cache-misses,cache-references,instructions,cycles` on Linux to measure cache efficiency.
3. **Roofline check:** Compute arithmetic intensity (flops / bytes) for the dominant kernel. If $I < I_{ridge}$ (bandwidth-bound), optimise memory layout before algorithm. If $I > I_{ridge}$ (compute-bound), look at SIMD utilisation.
4. **Release mode is non-negotiable:** Never benchmark `cargo build` (debug). Always `cargo build --release` with `opt-level = 3` and `lto = "thin"` in `Cargo.toml`.

---

### E. Cargo.toml — Recommended Profile

```toml
[profile.release]
opt-level     = 3
lto           = "thin"     # Link-Time Optimisation across crates
codegen-units = 1           # Maximise inlining; slower compile, faster binary
panic         = "abort"     # Removes unwinding overhead in hot paths
strip         = "symbols"   # Smaller binary

[dependencies]
nalgebra = { version = "0.33", features = ["std"] }
rayon    = "1.10"
serde    = { version = "1", features = ["derive"] }
```

---

### F. Failure Modes and Diagnostics

| Symptom | Root Cause | Remedy |
|---|---|---|
| Heap allocation in hot loop | `vec![]` / `.collect()` inside iteration | Pre-allocate, pass `&mut` slices |
| Cache thrash on large matrices | Column-major access with row-major traversal | Swap loop order (col outer, row inner) |
| False sharing between rayon threads | Two threads writing adjacent cache lines | Pad thread-local buffers to 64-byte alignment |
| `Mutex` contention | Shared mutable state in parallel sweep | Clone per-thread; use read-only `Arc` |
| No SIMD in assembly | Branching or pointer aliasing in kernel | Remove branches; annotate with `#[target_feature(enable="avx2")]` |
| NaN propagation from LU solve | Singular or near-singular matrix | Check topology pre-solve; add guard against zero pivot |
