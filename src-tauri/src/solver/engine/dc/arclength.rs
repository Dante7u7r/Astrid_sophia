use crate::solver::matrix::SparseMatrix;
use crate::solver::types::CircuitNetlist;
use crate::solver::SolverNumericalSettings;
use nalgebra::DVector;
use std::collections::HashMap;

use super::super::devices::get_thermal_parameters;
use super::homotopy::stamps::{stamp_component, StampContext};
use super::stamp_linear_components_sparse;

/// Resuelve el punto de operación DC usando Continuación por Pseudo-longitud de Arco (Método de Keller).
/// Parametriza tanto el estado del circuito $\mathbf{x}$ como el factor de homotopía $\lambda$ a lo largo de la
/// longitud de arco $s$, permitiendo rodear puntos de retorno (*turning/fold points*) y bifurcaciones donde
/// el Jacobiano estándar es singular.
#[allow(clippy::too_many_arguments)]
#[allow(clippy::ptr_arg)]
pub fn solve_arclength_continuation_core(
    netlist: &CircuitNetlist,
    n: usize,
    m: usize,
    vsource_map: &HashMap<String, usize>,
    gmin: f64,
    x_init: &Vec<f64>,
    numerical_settings: SolverNumericalSettings,
) -> Result<DVector<f64>, String> {
    let (vt, is_temp) = get_thermal_parameters(netlist.temperature, None);
    let size = n + m;
    let tolerance = numerical_settings.tolerance;
    let max_corrector_iters = 25;
    let max_arc_steps = 600;

    // 1. Armar matrices base lineales estáticas
    let mut matrix_a_linear = SparseMatrix::new(size);
    let mut vector_z_linear = DVector::<f64>::zeros(size);
    stamp_linear_components_sparse(
        netlist,
        n,
        vsource_map,
        &mut matrix_a_linear,
        &mut vector_z_linear,
    )?;

    if gmin > 0.0 {
        for i in 1..=n {
            matrix_a_linear.add_element(i - 1, i - 1, gmin);
        }
    }

    // Estado inicial en s = 0: x = x_init, lambda = 0.0
    let mut current_x = DVector::<f64>::zeros(size);
    for i in 1..=n {
        current_x[i - 1] = x_init[i];
    }
    let mut current_lambda = 0.0_f64;

    // Vector tangente previo inicializado hacia adelante (aumento de lambda)
    let mut prev_tangent_x = DVector::<f64>::zeros(size);
    let mut prev_tangent_lambda = 1.0_f64;

    let mut ds = 0.05_f64;
    let ds_min = 1e-7_f64;
    let ds_max = 0.25_f64;

    let mut steps = 0;

    while steps < max_arc_steps {
        steps += 1;

        // Convertir vector x actual a formato para evaluador de estampas
        let mut prev_voltages = vec![0.0; n + 1];
        for i in 1..=n {
            prev_voltages[i] = current_x[i - 1];
        }
        let prev_prev_voltages = prev_voltages.clone();

        // 2. Evaluar Jacobiano J_x y vector RHS z en el punto actual (x_0, lambda_0)
        let mut matrix_j = matrix_a_linear.clone();
        let mut vector_z_eval = vector_z_linear.clone();

        for idx in 0..m {
            vector_z_eval[n + idx] *= current_lambda;
        }

        // Estampar componentes no lineales
        for comp in &netlist.components {
            let mut context = StampContext {
                netlist,
                vt,
                is_temp,
                prev_voltages: &prev_voltages,
                prev_prev_voltages: &prev_prev_voltages,
                matrix_a: &mut matrix_j,
                vector_z: &mut vector_z_eval,
            };
            stamp_component(comp, &mut context);
        }

        // Estampar admitancia homotópica y fuente de deformación: g_hom = (1 - lambda) * g0
        let g_hom = (1.0 - current_lambda) * 1.0;
        for i in 1..=n {
            matrix_j.add_element(i - 1, i - 1, g_hom);
            vector_z_eval[i - 1] += g_hom * x_init[i];
        }

        // 3. Calcular vector de derivada parcial negativa respecto a lambda: -F_lambda
        // -F_lambda = [ g0 * (x - x_init); V_s ]
        let mut rhs_tangent = DVector::<f64>::zeros(size);
        for i in 1..=n {
            rhs_tangent[i - 1] = 1.0 * (current_x[i - 1] - x_init[i]);
        }
        for idx in 0..m {
            rhs_tangent[n + idx] = vector_z_linear[n + idx];
        }

        // 4. Calcular vector tangente unitario (dot_x, dot_lambda)
        // J_x * w = -F_lambda
        let w_sol = match crate::solver::linear_backend::solve_linear_real(
            &matrix_j,
            rhs_tangent.as_slice(),
        ) {
            Ok(sol) => DVector::from_vec(sol),
            Err(_) => {
                ds = (ds * 0.5).max(ds_min);
                if ds <= ds_min {
                    return Err(
                        "Fallo de cálculo de tangente en continuación por longitud de arco"
                            .to_string(),
                    );
                }
                continue;
            }
        };

        let norm_factor = (w_sol.dot(&w_sol) + 1.0).sqrt();
        let mut tangent_x = &w_sol / norm_factor;
        let mut tangent_lambda = 1.0 / norm_factor;

        // Asegurar orientación hacia adelante respecto a la dirección previa
        let dot_product = tangent_x.dot(&prev_tangent_x) + tangent_lambda * prev_tangent_lambda;
        if dot_product < 0.0 {
            tangent_x = -tangent_x;
            tangent_lambda = -tangent_lambda;
        }

        prev_tangent_x = tangent_x.clone();
        prev_tangent_lambda = tangent_lambda;

        // 5. Paso Predictor de Keller:
        let x_0 = current_x.clone();
        let lambda_0 = current_lambda;

        let mut pred_x = &x_0 + &tangent_x * ds;
        let mut pred_lambda = lambda_0 + tangent_lambda * ds;

        // 6. Corrector de Newton-Raphson en el sistema aumentado:
        let mut corrector_converged = false;
        let mut corr_iters = 0;

        for _c_iter in 0..max_corrector_iters {
            corr_iters += 1;

            let mut corr_prev_voltages = vec![0.0; n + 1];
            for i in 1..=n {
                corr_prev_voltages[i] = pred_x[i - 1];
            }
            let corr_prev_prev = corr_prev_voltages.clone();

            let mut corr_j = matrix_a_linear.clone();
            let mut corr_z = vector_z_linear.clone();
            for idx in 0..m {
                corr_z[n + idx] *= pred_lambda;
            }

            for comp in &netlist.components {
                let mut context = StampContext {
                    netlist,
                    vt,
                    is_temp,
                    prev_voltages: &corr_prev_voltages,
                    prev_prev_voltages: &corr_prev_prev,
                    matrix_a: &mut corr_j,
                    vector_z: &mut corr_z,
                };
                stamp_component(comp, &mut context);
            }

            let g_hom_corr = (1.0 - pred_lambda) * 1.0;
            for i in 1..=n {
                corr_j.add_element(i - 1, i - 1, g_hom_corr);
                corr_z[i - 1] += g_hom_corr * x_init[i];
            }

            // Residuo de circuito: r_x = corr_z - corr_j * pred_x
            let mut ax = DVector::<f64>::zeros(size);
            for (r, row_map) in corr_j.rows.iter().enumerate() {
                for (&c, &val) in row_map {
                    if r < size && c < size {
                        ax[r] += val * pred_x[c];
                    }
                }
            }
            let r_x = &corr_z - &ax;

            // Residuo de longitud de arco:
            // r_s = ds - [ tangent_x^T * (pred_x - x_0) + tangent_lambda * (pred_lambda - lambda_0) ]
            let dx_from_0 = &pred_x - &x_0;
            let dlam_from_0 = pred_lambda - lambda_0;
            let r_s = ds - (tangent_x.dot(&dx_from_0) + tangent_lambda * dlam_from_0);

            // Vector -F_lambda evaluado en el punto corrector:
            let mut rhs_lam_corr = DVector::<f64>::zeros(size);
            for i in 1..=n {
                rhs_lam_corr[i - 1] = 1.0 * (pred_x[i - 1] - x_init[i]);
            }
            for idx in 0..m {
                rhs_lam_corr[n + idx] = vector_z_linear[n + idx];
            }

            // Resolver sistema aumentado por bloques:
            // J_x * v1 = r_x
            // J_x * v2 = -F_lambda
            let v1 = match crate::solver::linear_backend::solve_linear_real(&corr_j, r_x.as_slice())
            {
                Ok(sol) => DVector::from_vec(sol),
                Err(_) => break,
            };

            let v2 = match crate::solver::linear_backend::solve_linear_real(
                &corr_j,
                rhs_lam_corr.as_slice(),
            ) {
                Ok(sol) => DVector::from_vec(sol),
                Err(_) => break,
            };

            let denom = tangent_lambda + tangent_x.dot(&v2);
            if denom.abs() < 1e-18 {
                break;
            }

            let delta_lambda = (r_s - tangent_x.dot(&v1)) / denom;
            let delta_x = &v1 + &v2 * delta_lambda;

            pred_x += &delta_x;
            pred_lambda += delta_lambda;

            let max_dx = delta_x.iter().map(|v| v.abs()).fold(0.0, f64::max);
            if max_dx < tolerance && delta_lambda.abs() < tolerance {
                corrector_converged = true;
                break;
            }
        }

        if corrector_converged {
            // Detección de cruce del plano físico lambda = 1.0
            if (current_lambda < 1.0 && pred_lambda >= 1.0)
                || (current_lambda >= 1.0 && pred_lambda < 1.0)
                || (pred_lambda >= 1.0 && steps == 1)
            {
                let theta = if (pred_lambda - current_lambda).abs() > 1e-12 {
                    ((1.0 - current_lambda) / (pred_lambda - current_lambda)).clamp(0.0, 1.0)
                } else {
                    1.0
                };
                let mut x_interp = &current_x * (1.0 - theta) + &pred_x * theta;
                let mut interp_prev_voltages = vec![0.0; n + 1];
                for i in 1..=n {
                    interp_prev_voltages[i] = x_interp[i - 1];
                }

                // Pulido de Newton-Raphson exacto a lambda = 1.0
                let mut polished = false;
                for _ in 0..20 {
                    let mut polish_j = matrix_a_linear.clone();
                    let mut polish_z = vector_z_linear.clone();

                    for comp in &netlist.components {
                        let mut context = StampContext {
                            netlist,
                            vt,
                            is_temp,
                            prev_voltages: &interp_prev_voltages,
                            prev_prev_voltages: &interp_prev_voltages,
                            matrix_a: &mut polish_j,
                            vector_z: &mut polish_z,
                        };
                        stamp_component(comp, &mut context);
                    }

                    let mut ax = DVector::<f64>::zeros(size);
                    for (r, row_map) in polish_j.rows.iter().enumerate() {
                        for (&c, &val) in row_map {
                            if r < size && c < size {
                                ax[r] += val * x_interp[c];
                            }
                        }
                    }
                    let res = &polish_z - &ax;
                    if res.iter().map(|v| v.abs()).fold(0.0, f64::max) < tolerance {
                        polished = true;
                        break;
                    }

                    if let Ok(dx) =
                        crate::solver::linear_backend::solve_linear_real(&polish_j, res.as_slice())
                    {
                        let dx_vec = DVector::from_vec(dx);
                        x_interp += &dx_vec;
                        for i in 1..=n {
                            interp_prev_voltages[i] = x_interp[i - 1];
                        }
                        if dx_vec.iter().map(|v| v.abs()).fold(0.0, f64::max) < tolerance {
                            polished = true;
                            break;
                        }
                    } else {
                        break;
                    }
                }

                if polished {
                    return Ok(x_interp);
                }
            }

            current_x = pred_x;
            current_lambda = pred_lambda;

            // Control de paso adaptativo:
            if corr_iters <= 4 {
                ds = (ds * 1.4).min(ds_max);
            } else if corr_iters >= 12 {
                ds = (ds * 0.75).max(ds_min);
            }

            // Comprobar si hemos alcanzado lambda = 1.0
            if current_lambda >= 1.0 {
                return Ok(current_x);
            }
        } else {
            // Si el corrector no converge, reducir ds y reintentar desde el último punto convergido
            ds *= 0.5;
            if ds < ds_min {
                return Err(
                    "Paso de pseudo-longitud de arco inferior al mínimo admisible".to_string(),
                );
            }
        }
    }

    if current_lambda >= 0.999 {
        Ok(current_x)
    } else {
        Err(format!(
            "Continuación por pseudo-longitud de arco no alcanzó lambda=1.0 tras {} pasos (lambda final: {:.4})",
            steps, current_lambda
        ))
    }
}

/// Encuentra múltiples puntos de operación DC en circuitos biestables/multiestables (SRAM, Schmitt, Túnel)
/// trazando la curva de homotopía continua y detectando todas las intersecciones con el hiperplano físico $\lambda = 1.0$.
#[allow(clippy::too_many_arguments)]
#[allow(clippy::ptr_arg)]
pub fn find_multiple_dc_operating_points_arclength(
    netlist: &CircuitNetlist,
    n: usize,
    m: usize,
    vsource_map: &HashMap<String, usize>,
    gmin: f64,
    x_init: &Vec<f64>,
    max_solutions: usize,
    numerical_settings: SolverNumericalSettings,
) -> Result<Vec<DVector<f64>>, String> {
    let (vt, is_temp) = get_thermal_parameters(netlist.temperature, None);
    let size = n + m;
    let tolerance = numerical_settings.tolerance;
    let max_corrector_iters = 25;
    let max_arc_steps = 600;

    let mut matrix_a_linear = SparseMatrix::new(size);
    let mut vector_z_linear = DVector::<f64>::zeros(size);
    stamp_linear_components_sparse(
        netlist,
        n,
        vsource_map,
        &mut matrix_a_linear,
        &mut vector_z_linear,
    )?;

    if gmin > 0.0 {
        for i in 1..=n {
            matrix_a_linear.add_element(i - 1, i - 1, gmin);
        }
    }

    let mut current_x = DVector::<f64>::zeros(size);
    for i in 1..=n {
        current_x[i - 1] = x_init[i];
    }
    let mut current_lambda = 0.0_f64;

    let mut prev_tangent_x = DVector::<f64>::zeros(size);
    let mut prev_tangent_lambda = 1.0_f64;

    let mut ds = 0.05_f64;
    let ds_min = 1e-7_f64;
    let ds_max = 0.25_f64;

    let mut solutions: Vec<DVector<f64>> = Vec::new();
    let mut steps = 0;

    while steps < max_arc_steps && solutions.len() < max_solutions {
        steps += 1;

        let mut prev_voltages = vec![0.0; n + 1];
        for i in 1..=n {
            prev_voltages[i] = current_x[i - 1];
        }
        let prev_prev_voltages = prev_voltages.clone();

        let mut matrix_j = matrix_a_linear.clone();
        let mut vector_z_eval = vector_z_linear.clone();

        for idx in 0..m {
            vector_z_eval[n + idx] *= current_lambda;
        }

        for comp in &netlist.components {
            let mut context = StampContext {
                netlist,
                vt,
                is_temp,
                prev_voltages: &prev_voltages,
                prev_prev_voltages: &prev_prev_voltages,
                matrix_a: &mut matrix_j,
                vector_z: &mut vector_z_eval,
            };
            stamp_component(comp, &mut context);
        }

        let g_hom = (1.0 - current_lambda) * 1.0;
        for i in 1..=n {
            matrix_j.add_element(i - 1, i - 1, g_hom);
            vector_z_eval[i - 1] += g_hom * x_init[i];
        }

        let mut rhs_tangent = DVector::<f64>::zeros(size);
        for i in 1..=n {
            rhs_tangent[i - 1] = 1.0 * (current_x[i - 1] - x_init[i]);
        }
        for idx in 0..m {
            rhs_tangent[n + idx] = vector_z_linear[n + idx];
        }

        let w_sol = match crate::solver::linear_backend::solve_linear_real(
            &matrix_j,
            rhs_tangent.as_slice(),
        ) {
            Ok(sol) => DVector::from_vec(sol),
            Err(_) => {
                ds = (ds * 0.5).max(ds_min);
                if ds <= ds_min {
                    break;
                }
                continue;
            }
        };

        let norm_factor = (w_sol.dot(&w_sol) + 1.0).sqrt();
        let mut tangent_x = &w_sol / norm_factor;
        let mut tangent_lambda = 1.0 / norm_factor;

        let dot_product = tangent_x.dot(&prev_tangent_x) + tangent_lambda * prev_tangent_lambda;
        if dot_product < 0.0 {
            tangent_x = -tangent_x;
            tangent_lambda = -tangent_lambda;
        }

        prev_tangent_x = tangent_x.clone();
        prev_tangent_lambda = tangent_lambda;

        let x_0 = current_x.clone();
        let lambda_0 = current_lambda;

        let mut pred_x = &x_0 + &tangent_x * ds;
        let mut pred_lambda = lambda_0 + tangent_lambda * ds;

        let mut corrector_converged = false;
        let mut corr_iters = 0;

        for _c_iter in 0..max_corrector_iters {
            corr_iters += 1;

            let mut corr_prev_voltages = vec![0.0; n + 1];
            for i in 1..=n {
                corr_prev_voltages[i] = pred_x[i - 1];
            }
            let corr_prev_prev = corr_prev_voltages.clone();

            let mut corr_j = matrix_a_linear.clone();
            let mut corr_z = vector_z_linear.clone();
            for idx in 0..m {
                corr_z[n + idx] *= pred_lambda;
            }

            for comp in &netlist.components {
                let mut context = StampContext {
                    netlist,
                    vt,
                    is_temp,
                    prev_voltages: &corr_prev_voltages,
                    prev_prev_voltages: &corr_prev_prev,
                    matrix_a: &mut corr_j,
                    vector_z: &mut corr_z,
                };
                stamp_component(comp, &mut context);
            }

            let g_hom_corr = (1.0 - pred_lambda) * 1.0;
            for i in 1..=n {
                corr_j.add_element(i - 1, i - 1, g_hom_corr);
                corr_z[i - 1] += g_hom_corr * x_init[i];
            }

            let mut ax = DVector::<f64>::zeros(size);
            for (r, row_map) in corr_j.rows.iter().enumerate() {
                for (&c, &val) in row_map {
                    if r < size && c < size {
                        ax[r] += val * pred_x[c];
                    }
                }
            }
            let r_x = &corr_z - &ax;

            let dx_from_0 = &pred_x - &x_0;
            let dlam_from_0 = pred_lambda - lambda_0;
            let r_s = ds - (tangent_x.dot(&dx_from_0) + tangent_lambda * dlam_from_0);

            let mut rhs_lam_corr = DVector::<f64>::zeros(size);
            for i in 1..=n {
                rhs_lam_corr[i - 1] = 1.0 * (pred_x[i - 1] - x_init[i]);
            }
            for idx in 0..m {
                rhs_lam_corr[n + idx] = vector_z_linear[n + idx];
            }

            let v1 = match crate::solver::linear_backend::solve_linear_real(&corr_j, r_x.as_slice())
            {
                Ok(sol) => DVector::from_vec(sol),
                Err(_) => break,
            };

            let v2 = match crate::solver::linear_backend::solve_linear_real(
                &corr_j,
                rhs_lam_corr.as_slice(),
            ) {
                Ok(sol) => DVector::from_vec(sol),
                Err(_) => break,
            };

            let denom = tangent_lambda + tangent_x.dot(&v2);
            if denom.abs() < 1e-18 {
                break;
            }

            let delta_lambda = (r_s - tangent_x.dot(&v1)) / denom;
            let delta_x = &v1 + &v2 * delta_lambda;

            pred_x += &delta_x;
            pred_lambda += delta_lambda;

            let max_dx = delta_x.iter().map(|v| v.abs()).fold(0.0, f64::max);
            if max_dx < tolerance && delta_lambda.abs() < tolerance {
                corrector_converged = true;
                break;
            }
        }

        if corrector_converged {
            // Verificar cruce con lambda = 1.0
            if (current_lambda - 1.0) * (pred_lambda - 1.0) <= 0.0
                && (pred_lambda - current_lambda).abs() > 1e-9
            {
                let theta =
                    ((1.0 - current_lambda) / (pred_lambda - current_lambda)).clamp(0.0, 1.0);
                let mut x_interp = &current_x * (1.0 - theta) + &pred_x * theta;
                let mut interp_prev_voltages = vec![0.0; n + 1];
                for i in 1..=n {
                    interp_prev_voltages[i] = x_interp[i - 1];
                }

                let mut polished = false;
                for _ in 0..20 {
                    let mut polish_j = matrix_a_linear.clone();
                    let mut polish_z = vector_z_linear.clone();

                    for comp in &netlist.components {
                        let mut context = StampContext {
                            netlist,
                            vt,
                            is_temp,
                            prev_voltages: &interp_prev_voltages,
                            prev_prev_voltages: &interp_prev_voltages,
                            matrix_a: &mut polish_j,
                            vector_z: &mut polish_z,
                        };
                        stamp_component(comp, &mut context);
                    }

                    let mut ax = DVector::<f64>::zeros(size);
                    for (r, row_map) in polish_j.rows.iter().enumerate() {
                        for (&c, &val) in row_map {
                            if r < size && c < size {
                                ax[r] += val * x_interp[c];
                            }
                        }
                    }
                    let res = &polish_z - &ax;
                    if res.iter().map(|v| v.abs()).fold(0.0, f64::max) < tolerance {
                        polished = true;
                        break;
                    }

                    if let Ok(dx) =
                        crate::solver::linear_backend::solve_linear_real(&polish_j, res.as_slice())
                    {
                        let dx_vec = DVector::from_vec(dx);
                        x_interp += &dx_vec;
                        for i in 1..=n {
                            interp_prev_voltages[i] = x_interp[i - 1];
                        }
                        if dx_vec.iter().map(|v| v.abs()).fold(0.0, f64::max) < tolerance {
                            polished = true;
                            break;
                        }
                    } else {
                        break;
                    }
                }

                if polished {
                    let is_duplicate = solutions.iter().any(|existing| {
                        (&x_interp - existing)
                            .iter()
                            .map(|v| v.abs())
                            .fold(0.0, f64::max)
                            < 1e-3
                    });
                    if !is_duplicate {
                        solutions.push(x_interp);
                    }
                }
            }

            current_x = pred_x;
            current_lambda = pred_lambda;

            if corr_iters <= 4 {
                ds = (ds * 1.4).min(ds_max);
            } else if corr_iters >= 12 {
                ds = (ds * 0.75).max(ds_min);
            }
        } else {
            ds *= 0.5;
            if ds < ds_min {
                break;
            }
        }
    }

    if !solutions.is_empty() {
        Ok(solutions)
    } else {
        Err("No se encontraron puntos de operación DC con continuación de arclength".to_string())
    }
}
