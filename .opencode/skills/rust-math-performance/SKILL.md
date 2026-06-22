---
name: rust-math-performance
description: Use when writing Rust numerical code, matrix solvers, parallelization with rayon, or memory optimization in computation kernels
---

# Skill: Rust Math Performance

## 1. Context and Objective
This skill equips the agent with advanced Rust compiler optimization knowledge. It focuses on writing memory-safe, CPU cache-friendly, and highly parallel numerical computation engines for solving matrix algebra and graph-based models.

---

## 2. Core Directives & Standards

### A. Memory Optimization & Allocation Reduction
1. **Avoid Dynamic Allocations:** In performance-critical loops (such as the Transient integration loop or Newton-Raphson iteration), strictly avoid allocating heap memory. Do not call `.collect()`, `vec![]`, or push to dynamic arrays inside loops.
2. **Pre-allocate Vectors:** Pre-allocate vectors using `Vec::with_capacity(size)` or mutate arrays in-place (`&mut [f64]`) to minimize reallocation overhead.
3. **Minimize Smart Pointers:** Avoid reference counting (`Rc`, `Arc`) and interior mutability (`RefCell`, `Mutex`) inside numerical kernels. Use raw references (`&` and `&mut`) to guarantee compile-time borrow checking and optimize for static dispatch.

### B. Matrix Solver Operations (using `nalgebra`)
1. **Matrix In-place Mutation:** Prefer operating on in-place matrices rather than re-creating arrays. Use `A.copy_from(&B)` or edit matrix blocks directly using slice mutations.
2. **LU Decomposition:** For dense linear solvers of size $N < 100$, use LU decomposition with partial pivoting:
   ```rust
   let decomp = matrix_a.lu();
   let solution = decomp.solve(&vector_z).ok_or("Singular matrix")?;
   ```
3. **Sparse Matrix Engines:** For larger networks, implement Sparse Matrix structures (such as Compressed Sparse Column - CSC) and solve them using iterative methods or KLU direct solvers to avoid computing $O(N^3)$ operations on empty cells.

### C. Parallelization & Vectorization
1. **Rayon Multi-threading:** Use the `rayon` crate to parallelize decoupled sweeps (e.g., AC frequencies or DC parameter sweeps) using parallel iterators:
   ```rust
   use rayon::prelude::*;
   let results: Vec<SimResult> = sweep_points.par_iter().map(|p| solve_point(p)).collect();
   ```
2. **SIMD Alignment:** Ensure that large numerical arrays are aligned in contiguous memory blocks so the Rust compiler can auto-vectorize operations into SIMD (Single Instruction Multiple Data) registers (AVX/SSE).
