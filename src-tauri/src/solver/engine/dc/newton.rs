use crate::solver::matrix::SparseMatrix;
use crate::solver::types::CircuitNetlist;
use nalgebra::DVector;
use std::collections::HashMap;

mod stamps;

use super::super::devices::get_thermal_parameters;
use super::{
    diagnose_convergence_failure, multiply_sparse_matrix_vector, stamp_linear_components_sparse,
};
use stamps::{stamp_component, StampContext};

// CORES MATEMÁTICOS AVANZADOS: CORE DE NEWTON-RAPHSON CON AMORTIGUAMIENTO Y GMIN DINÁMICO (Fases 14 y 15)
#[allow(clippy::too_many_arguments)]
#[allow(clippy::ptr_arg)]
pub fn solve_newton_raphson_core(
    netlist: &CircuitNetlist,
    n: usize,
    m: usize,
    vsource_map: &HashMap<String, usize>,
    gmin: f64,
    alpha: f64,
    initial_guess: &Vec<f64>,
    pta_params: Option<(f64, f64, &DVector<f64>)>,
    switch_frozen_states: &HashMap<String, bool>,
) -> Result<DVector<f64>, String> {
    let (vt, is_temp) = get_thermal_parameters(netlist.temperature, None);
    let size = n + m;
    let max_iter = 100;
    let tolerance = 1e-6;

    let mut prev_voltages = initial_guess.clone();
    let mut solution = DVector::<f64>::zeros(size);
    if let Some((_, _, prev_sol)) = pta_params {
        for i in 1..=n {
            prev_voltages[i] = prev_sol[i - 1];
        }
        solution = prev_sol.clone();
    }
    let mut prev_prev_voltages = prev_voltages.clone();
    let mut converged = false;

    let mut csc_solver: Option<(
        crate::sparse_csc::SymbolicLU,
        crate::sparse_csc::NumericLUWorkspace,
        crate::sparse_csc::SparseMatrixCSC,
    )> = None;
    let mut parallel_solver: Option<crate::sparse_parallel::SchurParallelSolver> = None;

    // 1. Armar matrices base lineales estáticas que no cambian en este NR
    let mut matrix_a_linear = SparseMatrix::new(size);
    let mut vector_z_linear = DVector::<f64>::zeros(size);
    stamp_linear_components_sparse(
        netlist,
        n,
        vsource_map,
        &mut matrix_a_linear,
        &mut vector_z_linear,
    )?;

    // Escalar fuentes independientes por el factor alpha de Source Stepping
    for idx in 0..m {
        vector_z_linear[n + idx] *= alpha;
    }

    // Inyectar conductancia Gmin artificial a tierra en todos los nodos activos para evitar singularidades
    if gmin > 0.0 {
        for i in 1..=n {
            matrix_a_linear.add_element(i - 1, i - 1, gmin);
        }
    }

    // Inyectar elementos de Pseudo-Transient Analysis (PTA) si están activos
    if let Some((g_pseudo, r_pseudo, prev_sol)) = pta_params {
        for i in 1..=n {
            matrix_a_linear.add_element(i - 1, i - 1, g_pseudo);
            vector_z_linear[i - 1] += g_pseudo * prev_sol[i - 1];
        }
        for vs_idx in 0..m {
            matrix_a_linear.add_element(n + vs_idx, n + vs_idx, r_pseudo);
            vector_z_linear[n + vs_idx] += r_pseudo * prev_sol[n + vs_idx];
        }
    }

    // Caché de ASTs para B-sources
    let mut ast_cache = HashMap::new();

    // Clausura para estampar los componentes no lineales a partir de cualquier estimación de tensiones y corrientes
    // NOTA: FnMut porque captura ast_cache por &mut para el caché de ASTs
    let mut stamp_at = |prev_voltages: &Vec<f64>,
                        prev_prev_voltages: &Vec<f64>,
                        solution: &DVector<f64>|
     -> Result<(SparseMatrix, DVector<f64>), String> {
        let mut matrix_a = matrix_a_linear.clone();
        let mut vector_z = vector_z_linear.clone();

        // Estampar cada componente no lineal usando aproximación lineal de primer orden de Taylor
        for comp in &netlist.components {
            let mut context = StampContext {
                netlist,
                n,
                size,
                vsource_map,
                vt,
                is_temp,
                alpha,
                prev_voltages,
                prev_prev_voltages,
                solution,
                switch_frozen_states,
                ast_cache: &mut ast_cache,
                matrix_a: &mut matrix_a,
                vector_z: &mut vector_z,
            };
            stamp_component(comp, &mut context);
        }
        Ok((matrix_a, vector_z))
    };

    let mut stamped_matrix_and_vector: Option<(SparseMatrix, DVector<f64>)> = None;
    let _lambda_backtrack = 1.0;
    let _prev_max_diff = f64::MAX;

    // 2. Bucle Newton-Raphson amortiguado
    for _iter in 1..=max_iter {
        let (matrix_a, vector_z) = if let Some(mv) = stamped_matrix_and_vector.take() {
            mv
        } else {
            stamp_at(&prev_voltages, &prev_prev_voltages, &solution)?
        };

        // Resolver el sistema lineal de esta iteración A * x = z usando Aritmética Plana CSC Left-Looking o Schur en paralelo (BBDF)
        let is_parallel = size >= 40;
        let mut solved_ok = false;
        let mut new_solution = DVector::<f64>::zeros(size);

        if is_parallel {
            let solver = parallel_solver.get_or_insert_with(|| {
                crate::sparse_parallel::SchurParallelSolver::analyze(&matrix_a, 0.1)
            });
            if !solver.is_monolithic {
                if let Ok(sol) = solver.solve(&matrix_a, &vector_z) {
                    new_solution = sol;
                    solved_ok = true;
                }
            }
        }

        if !solved_ok {
            let (symbolic, workspace, matrix_csc) = csc_solver.get_or_insert_with(|| {
                let sym = crate::sparse_csc::SymbolicLU::analyze(&matrix_a);
                let work = crate::sparse_csc::NumericLUWorkspace::new(&sym);
                let csc = crate::sparse_csc::SparseMatrixCSC::from_sparse(&matrix_a);
                (sym, work, csc)
            });

            matrix_csc.update_from_sparse(&matrix_a);
            matrix_csc
                .left_looking_factorize(symbolic, workspace)
                .map_err(|_| "Error de convergencia o circuito mal condicionado".to_string())?;
            new_solution = symbolic
                .solve(workspace, &vector_z)
                .ok_or_else(|| "Error de convergencia o circuito mal condicionado".to_string())?;
        }

        // Comprobar si hay NaN, infinitos o divergencia extrema en la solución (> 1e9)
        let max_val = new_solution.iter().map(|x| x.abs()).fold(0.0, f64::max);
        if max_val.is_nan() || max_val.is_infinite() || max_val > 1e9 {
            return Err(
                "Divergencia detectada: voltajes o corrientes fuera de rango (>1e9 V/A o NaN/Inf)"
                    .to_string(),
            );
        }

        // Calcular la norma del residuo real E_0 en el punto actual (sin pnjlim para evaluar el residuo físico real)
        let e_0 = {
            let (matrix_a_true, vector_z_true) =
                stamp_at(&prev_voltages, &prev_voltages, &solution)?;
            let f_k = multiply_sparse_matrix_vector(&matrix_a_true, &solution) - &vector_z_true;
            f_k.norm()
        };

        // Búsqueda Lineal con Retroceso (Backtracking Line Search)
        let mut lambda = 1.0;
        let mut best_prev_voltages = prev_voltages.clone();
        let mut best_solution = solution.clone();
        let mut best_max_diff = 0.0;
        let mut _found_descent = false;

        for search_step in 0..4 {
            // Calcular estado candidato para este lambda
            let mut prev_voltages_cand = prev_voltages.clone();
            for i in 1..=n {
                prev_voltages_cand[i] =
                    prev_voltages[i] + lambda * (new_solution[i - 1] - prev_voltages[i]);
            }
            let mut solution_cand = solution.clone();
            for i in 0..n {
                solution_cand[i] = prev_voltages_cand[i + 1];
            }
            for i in n..size {
                solution_cand[i] = solution[i] + lambda * (new_solution[i] - solution[i]);
            }

            // Estampar en el estado candidato (sin pnjlim para evaluar el residuo real)
            if let Ok((matrix_a_cand, vector_z_cand)) =
                stamp_at(&prev_voltages_cand, &prev_voltages_cand, &solution_cand)
            {
                let f_cand =
                    multiply_sparse_matrix_vector(&matrix_a_cand, &solution_cand) - &vector_z_cand;
                let e_cand = f_cand.norm();

                // Si reduce el residuo, o es el paso mínimo de salvaguarda (search_step == 3), lo aceptamos
                if e_cand < e_0 || search_step == 3 {
                    let mut max_diff_cand = 0.0;
                    for i in 1..=n {
                        let diff = (prev_voltages_cand[i] - prev_voltages[i]).abs();
                        if diff > max_diff_cand {
                            max_diff_cand = diff;
                        }
                    }
                    best_prev_voltages = prev_voltages_cand;
                    best_solution = solution_cand;
                    best_max_diff = max_diff_cand;
                    _found_descent = e_cand < e_0;
                    break;
                }
            }
            lambda *= 0.5;
        }

        // Actualizar el estado con el mejor candidato encontrado
        let old_prev_voltages = prev_voltages.clone();
        prev_prev_voltages = old_prev_voltages.clone();
        prev_voltages = best_prev_voltages;
        solution = best_solution;

        // Estampar con pnjlim habilitado para usar como matriz Jacobian en la siguiente iteración de resolución lineal
        let (matrix_a_accepted, vector_z_accepted) =
            stamp_at(&prev_voltages, &old_prev_voltages, &solution)?;
        stamped_matrix_and_vector = Some((matrix_a_accepted, vector_z_accepted));

        if best_max_diff < tolerance {
            converged = true;
            break;
        }
    }

    if converged {
        Ok(solution)
    } else {
        if let Some((matrix_a_accepted, vector_z_accepted)) = stamped_matrix_and_vector {
            Err(diagnose_convergence_failure(
                netlist,
                n,
                m,
                vsource_map,
                &solution,
                &matrix_a_accepted,
                &vector_z_accepted,
            ))
        } else {
            Err("Error de convergencia o circuito mal condicionado".to_string())
        }
    }
}
