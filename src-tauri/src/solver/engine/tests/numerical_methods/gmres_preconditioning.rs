use crate::krylov::{
    gmres, gmres_solve_ilu0, GmresOptions, IdentityPreconditioner, Ilu0Preconditioner,
    JacobiPreconditioner, Preconditioner,
};
use crate::solver::linear_backend::solve_linear_real;
use crate::solver::matrix::SparseMatrix;

#[test]
fn test_ilu0_preconditioner_factorization_and_solve() {
    let size = 5;
    let mut mat = SparseMatrix::new(size);

    mat.add_element(0, 0, 4.0);
    mat.add_element(0, 1, -1.0);
    mat.add_element(0, 3, -1.0);

    mat.add_element(1, 0, -1.0);
    mat.add_element(1, 1, 4.0);
    mat.add_element(1, 2, -1.0);

    mat.add_element(2, 1, -1.0);
    mat.add_element(2, 2, 4.0);
    mat.add_element(2, 4, -1.0);

    mat.add_element(3, 0, -1.0);
    mat.add_element(3, 3, 4.0);
    mat.add_element(3, 4, -1.0);

    mat.add_element(4, 2, -1.0);
    mat.add_element(4, 3, -1.0);
    mat.add_element(4, 4, 4.0);

    let ilu = Ilu0Preconditioner::factorize(&mat).expect("Factorización ILU(0) fallida");

    let rhs = vec![1.0, 2.0, 3.0, 4.0, 5.0];
    let mut out = vec![0.0; size];
    ilu.apply(&rhs, &mut out);

    // Verificar que la salida es finita y no nula
    for (i, &v) in out.iter().enumerate() {
        assert!(v.is_finite(), "Valor no finito en out[{}]", i);
        assert!(v.abs() > 1e-12, "Valor nulo en out[{}]", i);
    }
}

#[test]
fn test_gmres_ilu0_vs_identity_on_resistor_grid() {
    // Malla resistiva 2D 15x15 (225 nodos) con fuerte gradiente de conductancia
    let grid_dim = 15;
    let num_nodes = grid_dim * grid_dim;
    let mut mat = SparseMatrix::new(num_nodes);
    let mut rhs = vec![0.0; num_nodes];

    // Inyección de corriente en la esquina (0, 0) y drenaje en (grid_dim-1, grid_dim-1)
    rhs[0] = 10.0;
    rhs[num_nodes - 1] = -10.0;

    let node_idx = |r: usize, c: usize| r * grid_dim + c;

    for r in 0..grid_dim {
        for c in 0..grid_dim {
            let u = node_idx(r, c);
            // Conductancia variable espacialmente para crear mal condicionamiento
            let g_val = 1e-2 * (1.0 + (r + c) as f64 * 0.5);

            if r + 1 < grid_dim {
                let v = node_idx(r + 1, c);
                mat.add_element(u, u, g_val);
                mat.add_element(u, v, -g_val);
                mat.add_element(v, u, -g_val);
                mat.add_element(v, v, g_val);
            }
            if c + 1 < grid_dim {
                let v = node_idx(r, c + 1);
                mat.add_element(u, u, g_val);
                mat.add_element(u, v, -g_val);
                mat.add_element(v, u, -g_val);
                mat.add_element(v, v, g_val);
            }
        }
    }

    // Fijar referencia a tierra en nodo último para evitar singularidad flotante
    mat.add_element(num_nodes - 1, num_nodes - 1, 1.0);

    let opts = GmresOptions {
        restart: 20,
        max_iters: 150,
        tol: 1e-7,
    };

    // 1. GMRES con Precondicionador Identidad (sin precondicionar)
    let id_precond = IdentityPreconditioner;
    let res_id = gmres(&mat, &rhs, None, &id_precond, opts).expect("GMRES Identity falló");

    // 2. GMRES con Precondicionador Jacobi
    let jacobi = JacobiPreconditioner::new(&mat);
    let res_jacobi = gmres(&mat, &rhs, None, &jacobi, opts).expect("GMRES Jacobi falló");

    // 3. GMRES con Precondicionador ILU(0)
    let ilu = Ilu0Preconditioner::factorize(&mat).expect("Factorización ILU(0) fallida");
    let res_ilu = gmres(&mat, &rhs, None, &ilu, opts).expect("GMRES ILU0 falló");

    println!(
        "Resistor Grid 15x15 (225 nodos) — Iteraciones: Identity={}, Jacobi={}, ILU0={}",
        res_id.iterations, res_jacobi.iterations, res_ilu.iterations
    );
    println!(
        "Residuos finales: Identity={:e}, Jacobi={:e}, ILU0={:e}",
        res_id.final_residual, res_jacobi.final_residual, res_ilu.final_residual
    );

    // ILU(0) debe converger en significativamente menos iteraciones o menor residuo que Identity
    assert!(
        res_ilu.iterations <= res_id.iterations,
        "ILU(0) iteraciones ({}) debe ser <= Identity ({})",
        res_ilu.iterations,
        res_id.iterations
    );
    assert!(
        res_ilu.final_residual < 1e-6,
        "ILU(0) debe alcanzar convergencia con residuo < 1e-6, obtenido {:e}",
        res_ilu.final_residual
    );
}

#[test]
fn test_gmres_ilu0_solution_accuracy() {
    // Sistema disperso de 20 nodos y comparación con solver directo faer
    let size = 20;
    let mut mat = SparseMatrix::new(size);
    let mut rhs = vec![0.0; size];

    for i in 0..size {
        mat.add_element(i, i, 3.0 + (i as f64 * 0.2));
        if i > 0 {
            mat.add_element(i, i - 1, -1.0);
            mat.add_element(i - 1, i, -1.0);
        }
        rhs[i] = (i + 1) as f64;
    }

    let direct_sol = solve_linear_real(&mat, &rhs).expect("Solver directo falló");
    let gmres_sol = gmres_solve_ilu0(&mat, &rhs, 1e-9, 200).expect("GMRES(ILU0) falló");

    for i in 0..size {
        let diff = (direct_sol[i] - gmres_sol[i]).abs();
        assert!(
            diff < 1e-6,
            "Discrepancia en nodo {}: Directo = {}, GMRES = {}, diff = {:e}",
            i,
            direct_sol[i],
            gmres_sol[i],
            diff
        );
    }
}

#[test]
fn test_gmres_zero_diagonal_regularization() {
    // Matriz con cero en la diagonal (rama MNA)
    // [ 0  1 ] [ x ] = [ 5 ]
    // [ 1  2 ] [ y ]   [ 13 ]
    // Solución exacta: y = 5, x = 3
    let mut mat = SparseMatrix::new(2);
    mat.add_element(0, 1, 1.0);
    mat.add_element(1, 0, 1.0);
    mat.add_element(1, 1, 2.0);

    let rhs = vec![5.0, 13.0];
    let sol = gmres_solve_ilu0(&mat, &rhs, 1e-8, 100).expect("GMRES con diagonal cero falló");

    assert!(
        (sol[0] - 3.0).abs() < 1e-4,
        "x esperado 3.0, obtenido {}",
        sol[0]
    );
    assert!(
        (sol[1] - 5.0).abs() < 1e-4,
        "y esperado 5.0, obtenido {}",
        sol[1]
    );
}
