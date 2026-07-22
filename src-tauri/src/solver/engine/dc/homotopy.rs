use crate::solver::matrix::SparseMatrix;
use crate::solver::types::CircuitNetlist;
use nalgebra::DVector;
use std::collections::HashMap;

mod stamps;

use super::super::devices::get_thermal_parameters;
use super::{diagnose_convergence_failure, stamp_linear_components_sparse};
use stamps::{stamp_component, StampContext};

#[allow(clippy::too_many_arguments)]
#[allow(clippy::ptr_arg)]
pub(super) fn solve_homotopy_core(
    netlist: &CircuitNetlist,
    n: usize,
    m: usize,
    vsource_map: &HashMap<String, usize>,
    gmin: f64,
    lambda: f64,
    x_init: &Vec<f64>,
    initial_guess: &Vec<f64>,
) -> Result<DVector<f64>, String> {
    let (vt, is_temp) = get_thermal_parameters(netlist.temperature, None);
    let size = n + m;
    let max_iter = 100;
    let tolerance = 1e-6;

    let mut prev_voltages = initial_guess.clone();
    let mut prev_prev_voltages = initial_guess.clone();
    let mut solution = DVector::<f64>::zeros(size);
    let mut converged = false;

    let mut csc_solver: Option<(
        crate::sparse_csc::SymbolicLU,
        crate::sparse_csc::NumericLUWorkspace,
        crate::sparse_csc::SparseMatrixCSC,
    )> = None;
    let mut parallel_solver: Option<crate::sparse_parallel::SchurParallelSolver> = None;

    let mut last_matrix_a = SparseMatrix::new(size);
    let mut last_vector_z = DVector::<f64>::zeros(size);

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

    // Escalar fuentes independientes por el factor lambda de Homotopía
    for idx in 0..m {
        vector_z_linear[n + idx] *= lambda;
    }

    // Inyectar conductancia Gmin artificial a tierra en todos los nodos activos
    if gmin > 0.0 {
        for i in 1..=n {
            matrix_a_linear.add_element(i - 1, i - 1, gmin);
        }
    }

    let mut lambda_backtrack = 1.0;
    let mut prev_max_diff = f64::MAX;

    // 2. Bucle Newton-Raphson
    for _iter in 1..=max_iter {
        let mut matrix_a = matrix_a_linear.clone();
        let mut vector_z = vector_z_linear.clone();

        // Estampar componentes no lineales
        for comp in &netlist.components {
            let mut context = StampContext {
                netlist,
                vt,
                is_temp,
                prev_voltages: &prev_voltages,
                prev_prev_voltages: &prev_prev_voltages,
                matrix_a: &mut matrix_a,
                vector_z: &mut vector_z,
            };
            stamp_component(comp, &mut context);
        }

        // Estampar admitancia homotópica de Punto Fijo y corriente de deformación homotópica
        let g_hom = (1.0 - lambda) * 1.0; // admitancia homotópica artificial de 1 Siemens
        for i in 1..=n {
            matrix_a.add_element(i - 1, i - 1, g_hom);
            vector_z[i - 1] += g_hom * x_init[i];
        }

        last_matrix_a = matrix_a.clone();
        last_vector_z = vector_z.clone();

        // Resolver el sistema MNA lineal para este paso de Newton usando Aritmética Plana CSC Left-Looking o Schur en paralelo (BBDF)
        let is_parallel = size >= 40;
        let mut solved_ok = false;
        let mut new_solution_res = None;

        if is_parallel {
            let solver = parallel_solver.get_or_insert_with(|| {
                crate::sparse_parallel::SchurParallelSolver::analyze(&matrix_a, 0.1)
            });
            if !solver.is_monolithic {
                if let Ok(sol) = solver.solve(&matrix_a, &vector_z) {
                    new_solution_res = Some(sol);
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
            new_solution_res = if matrix_csc
                .left_looking_factorize(symbolic, workspace)
                .is_ok()
            {
                symbolic.solve(workspace, &vector_z)
            } else {
                None
            };
        }

        if let Some(new_solution) = new_solution_res {
            // Comprobar si hay NaN, infinitos o divergencia extrema en la solución (> 1e9)
            let max_val = new_solution.iter().map(|x| x.abs()).fold(0.0, f64::max);
            if max_val.is_nan() || max_val.is_infinite() || max_val > 1e9 {
                return Err("Divergencia detectada: voltajes o corrientes fuera de rango (>1e9 V/A o NaN/Inf) en Homotopía".to_string());
            }

            let mut max_diff = 0.0;
            for i in 1..=n {
                let diff = (new_solution[i - 1] - prev_voltages[i]).abs();
                if diff.is_nan() {
                    return Err("Error de convergencia o circuito mal condicionado".to_string());
                }
                if diff > max_diff {
                    max_diff = diff;
                }
            }

            // Amortiguamiento dinámico Newton-Raphson con Backtracking acelerado:
            let base_lambda = if max_diff > 2.0 * vt { 0.35 } else { 1.0 };
            if _iter > 1 && max_diff >= prev_max_diff {
                lambda_backtrack *= 0.5;
            } else if _iter > 1 && max_diff < prev_max_diff {
                lambda_backtrack = f64::min(lambda_backtrack * 2.0, 1.0);
            }
            let lambda_damp = base_lambda * lambda_backtrack;
            prev_max_diff = max_diff;

            prev_prev_voltages = prev_voltages.clone();
            for i in 1..=n {
                prev_voltages[i] =
                    prev_voltages[i] + lambda_damp * (new_solution[i - 1] - prev_voltages[i]);
            }

            for i in n..size {
                solution[i] = new_solution[i];
            }

            for i in 0..n {
                solution[i] = prev_voltages[i + 1];
            }

            if max_diff < tolerance {
                converged = true;
                break;
            }
        } else {
            break;
        }
    }

    if converged {
        Ok(solution)
    } else {
        Err(diagnose_convergence_failure(
            netlist,
            n,
            m,
            vsource_map,
            &solution,
            &last_matrix_a,
            &last_vector_z,
        ))
    }
}
