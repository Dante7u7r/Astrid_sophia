use crate::solver::matrix::*;
use crate::solver::types::*;
use nalgebra::{DMatrix, DVector};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

mod stamps;

#[allow(unused_imports)]
use super::ac::*;
#[allow(unused_imports)]
use super::advanced::*;
#[allow(unused_imports)]
use super::dc::*;
#[allow(unused_imports)]
use super::devices::*;
use super::simulation_types::{TimeStepResult, TransientSettings};
use super::transient_companions::{stamp_transient_companions, CompanionStampState};
use super::transient_mcu::{update_mcu_accepted_states, McuAcceptedStateMaps};
use super::transient_mixed_signal::{
    detect_mixed_signal_crossings, initialize_mixed_signal_scheduler, process_mixed_signal_events,
};
use super::transient_setup::{
    apply_static_live_overrides, drain_live_overrides, has_transient_nonlinearity,
    initialize_device_junction_temperatures, initialize_energy_storage_states,
    initialize_mcu_transient_state, ComponentOverrideMap, EnergyStorageState, McuTransientState,
};
use super::transient_sources::stamp_dynamic_transient_sources;
use super::transient_state_updates::{
    update_coupled_inductor_states, update_passive_storage_states, IntegrationHistoryParams,
};
use super::transient_step_control::{estimate_local_truncation_error, update_trapezoidal_history};
use super::transient_switches::update_switch_states;
use super::transient_thermal::update_device_junction_temperatures;
use stamps::{stamp_behavioral_sources, stamp_component, StampContext};

pub fn solve_transient_circuit(
    netlist: &CircuitNetlist,
    settings: &TransientSettings,
) -> Result<Vec<TimeStepResult>, String> {
    let (results, _, _) = solve_transient_circuit_with_initial_states(
        netlist,
        settings,
        HashMap::new(),
        HashMap::new(),
    )?;
    Ok(results)
}

pub fn solve_transient_circuit_with_initial_states(
    netlist: &CircuitNetlist,
    settings: &TransientSettings,
    cap_init: HashMap<String, f64>,
    ind_init: HashMap<String, f64>,
) -> Result<
    (
        Vec<TimeStepResult>,
        HashMap<String, f64>,
        HashMap<String, f64>,
    ),
    String,
> {
    solve_transient_circuit_inner(
        netlist,
        settings,
        cap_init,
        ind_init,
        None::<Arc<Mutex<Vec<crate::ComponentMutation>>>>,
        None,
        None::<fn(&TimeStepResult) -> bool>,
    )
}

#[allow(clippy::type_complexity)]
pub(crate) fn solve_transient_circuit_inner<F>(
    netlist: &CircuitNetlist,
    settings: &TransientSettings,
    cap_init: HashMap<String, f64>,
    ind_init: HashMap<String, f64>,
    live_overrides: Option<Arc<Mutex<Vec<crate::ComponentMutation>>>>,
    live_run_id: Option<u64>,
    mut on_step: Option<F>,
) -> Result<
    (
        Vec<TimeStepResult>,
        HashMap<String, f64>,
        HashMap<String, f64>,
    ),
    String,
>
where
    F: FnMut(&TimeStepResult) -> bool,
{
    let n = crate::topology::validate_netlist_topology(netlist, false)?;
    let (vt, _is_temp) = get_thermal_parameters(netlist.temperature, None);
    let is_fixed = settings.fixed_step.unwrap_or(false) || netlist.fixed_step.unwrap_or(false);
    let integration_method = settings.integration_method.as_deref().unwrap_or("euler");
    let v_sources: Vec<&ComponentData> = netlist
        .components
        .iter()
        .filter(|c| {
            c.comp_type == "vsource"
                || c.comp_type == "bvoltage"
                || c.comp_type == "vcvs"
                || c.comp_type == "ccvs"
        })
        .collect();
    let m = v_sources.len();

    let size = n + m;
    if size == 0 {
        return Err("El circuito no contiene nodos activos o componentes.".to_string());
    }

    let mut vsource_map = HashMap::new();
    for (idx, vs) in v_sources.iter().enumerate() {
        vsource_map.insert(vs.id.clone(), idx);
    }

    let EnergyStorageState {
        mut cap_states,
        mut ind_states,
        mut cap_states_prev,
        mut ind_states_prev,
        mut cap_currents,
        mut ind_voltages,
        mut switch_states,
    } = initialize_energy_storage_states(netlist, &cap_init, &ind_init);

    let has_nonlinear = has_transient_nonlinearity(netlist);

    let t_amb = netlist.temperature.unwrap_or(300.0);

    let McuTransientState {
        mut mcu_tchip,
        mut mcu_vsample,
        mut mcu_vdaceff,
    } = initialize_mcu_transient_state(netlist, t_amb);
    let mut device_tjunc = initialize_device_junction_temperatures(netlist, t_amb);

    // Armar la matriz lineal estática BASE (Resistores, Fuentes de voltaje independientes)
    let mut matrix_a_linear = DMatrix::<f64>::zeros(size, size);
    let mut vector_z_linear = DVector::<f64>::zeros(size);

    stamp_linear_components(
        netlist,
        n,
        &vsource_map,
        &mut matrix_a_linear,
        &mut vector_z_linear,
    )?;

    let mut ms_scheduler = initialize_mixed_signal_scheduler(netlist);

    // VARIABLES DE TIEMPO ADAPTATIVO
    let mut dt = settings.dt;
    let mut prev_dt = settings.dt;
    let mut t = 0.0;
    let t_max = settings.t_max;

    // Histórico de soluciones para cálculo de la segunda derivada (Euler/Gear2) y tercera derivada (TRAP) del LTE
    let mut sol_n = DVector::<f64>::zeros(size); // Solución actual (n)
    let mut sol_n1 = DVector::<f64>::zeros(size); // Solución en n-1
    let mut sol_n2 = DVector::<f64>::zeros(size); // Solución en n-2
    let mut steps_completed = 0;

    // Tolerancia LTE y límites de paso
    let lte_tol = 2e-4; // 200 uV de tolerancia de truncamiento
    let dt_min = 1e-7; // 100 ns paso mínimo
    let dt_max = settings.dt * 2.5;

    let mut results = Vec::new();
    let mut current_solution = DVector::<f64>::zeros(size);
    let mut local_overrides = ComponentOverrideMap::new();

    // Iterar en el tiempo de forma dinámica
    while t <= t_max {
        drain_live_overrides(&mut local_overrides, &live_overrides, live_run_id);

        let gear2_active_this_step = integration_method == "gear2" && steps_completed >= 2;

        // Respaldar estados antes de intentar resolver el paso
        let cap_states_backup = cap_states.clone();
        let ind_states_backup = ind_states.clone();
        let cap_states_prev_backup = cap_states_prev.clone();
        let ind_states_prev_backup = ind_states_prev.clone();
        let switch_states_backup = switch_states.clone();
        let mcu_tchip_backup = mcu_tchip.clone();
        let mcu_vsample_backup = mcu_vsample.clone();
        let mcu_vdaceff_backup = mcu_vdaceff.clone();
        let device_tjunc_backup = device_tjunc.clone();
        let ms_scheduler_backup = ms_scheduler.clone();

        // Acotar timestep si se intercepta un evento digital intermedio
        let mut event_intercepted = false;
        let original_dt = dt;
        if let Some(next_event_t) = ms_scheduler.get_next_event_time() {
            if next_event_t > t && next_event_t < t + dt {
                dt = next_event_t - t;
                event_intercepted = true;
            }
        }

        // Clonar matrices base que no cambian
        let mut matrix_a = matrix_a_linear.clone();
        let mut vector_z = vector_z_linear.clone();

        apply_static_live_overrides(
            netlist,
            n,
            &vsource_map,
            &local_overrides,
            &mut matrix_a,
            &mut vector_z,
        );

        stamp_dynamic_transient_sources(
            netlist,
            n,
            t,
            &vsource_map,
            &local_overrides,
            &mut vector_z,
        );

        update_switch_states(
            netlist,
            &local_overrides,
            &current_solution,
            &mut switch_states,
        );
        let (gear_a, gear_b, gear_c) = if gear2_active_this_step {
            let dt1 = dt;
            let dt2 = prev_dt;
            let a = (2.0 * dt1 + dt2) / (dt1 * (dt1 + dt2));
            let b = -(dt1 + dt2) / (dt1 * dt2);
            let c = dt1 / (dt2 * (dt1 + dt2));
            (a, b, c)
        } else {
            (0.0, 0.0, 0.0)
        };
        let companion_params = IntegrationHistoryParams {
            integration_method,
            gear2_active_this_step,
            gear_a,
            gear_b,
            gear_c,
            dt,
        };
        stamp_transient_companions(
            netlist,
            &mut matrix_a,
            &mut vector_z,
            &CompanionStampState {
                current_solution: &current_solution,
                cap_states: &cap_states,
                cap_states_prev: &cap_states_prev,
                cap_currents: &cap_currents,
                ind_states: &ind_states,
                ind_states_prev: &ind_states_prev,
                ind_voltages: &ind_voltages,
                switch_states: &switch_states,
                local_overrides: &local_overrides,
            },
            &companion_params,
        );

        // Si hay componentes no lineales, resolvemos con Newton-Raphson
        let step_solution_res = if has_nonlinear {
            let max_iter = 50;
            let tolerance = 1e-5;
            let mut converged = false;
            let mut solution_iter = current_solution.clone();

            let mut prev_v = vec![0.0; n + 1];
            for i in 1..=n {
                prev_v[i] = solution_iter[i - 1];
            }
            let mut prev_prev_v = prev_v.clone();

            let mut ast_cache_t = HashMap::new();

            let mut solve_err = None;
            let mut lambda_backtrack = 1.0;
            let mut prev_max_diff = f64::MAX;

            for _iter in 0..max_iter {
                let mut matrix_a_iter = matrix_a.clone();
                let mut vector_z_iter = vector_z.clone();

                for comp in &netlist.components {
                    let mut context = StampContext {
                        netlist,
                        n,
                        size,
                        vsource_map: &vsource_map,
                        t,
                        dt,
                        t_amb,
                        prev_v: &prev_v,
                        prev_prev_v: &prev_prev_v,
                        current_solution: &current_solution,
                        solution_iter: &solution_iter,
                        device_tjunc: &device_tjunc,
                        mcu_vdaceff: &mcu_vdaceff,
                        ms_scheduler: &ms_scheduler,
                        ast_cache_t: &mut ast_cache_t,
                        matrix_a_iter: &mut matrix_a_iter,
                        vector_z_iter: &mut vector_z_iter,
                    };
                    stamp_component(comp, &mut context);
                }

                let mut context = StampContext {
                    netlist,
                    n,
                    size,
                    vsource_map: &vsource_map,
                    t,
                    dt,
                    t_amb,
                    prev_v: &prev_v,
                    prev_prev_v: &prev_prev_v,
                    current_solution: &current_solution,
                    solution_iter: &solution_iter,
                    device_tjunc: &device_tjunc,
                    mcu_vdaceff: &mcu_vdaceff,
                    ms_scheduler: &ms_scheduler,
                    ast_cache_t: &mut ast_cache_t,
                    matrix_a_iter: &mut matrix_a_iter,
                    vector_z_iter: &mut vector_z_iter,
                };
                stamp_behavioral_sources(&mut context);

                if let Some(new_sol) = solve_sparse(&matrix_a_iter, &vector_z_iter) {
                    let mut max_diff = 0.0;
                    for i in 1..=n {
                        let diff = (new_sol[i - 1] - prev_v[i]).abs();
                        if diff > max_diff {
                            max_diff = diff;
                        }
                    }

                    // Amortiguamiento dinámico Newton-Raphson transitorio con Backtracking acelerado:
                    // Si el error de esta iteración es mayor o igual que el de la anterior, reducimos el paso por 0.5.
                    // Si el error es menor, aumentamos el paso de forma multiplicativa para acelerar.
                    let base_lambda = if max_diff > 2.0 * vt { 0.35 } else { 1.0 };
                    if _iter > 0 && max_diff >= prev_max_diff {
                        lambda_backtrack *= 0.5;
                    } else if _iter > 0 && max_diff < prev_max_diff {
                        lambda_backtrack = f64::min(lambda_backtrack * 2.0, 1.0);
                    }
                    let lambda = base_lambda * lambda_backtrack;
                    prev_max_diff = max_diff;

                    prev_prev_v = prev_v.clone();
                    for i in 1..=n {
                        prev_v[i] = prev_v[i] + lambda * (new_sol[i - 1] - prev_v[i]);
                    }

                    // Actualizar variables de corriente y voltajes en solution_iter
                    let size = n + m;
                    for i in 0..n {
                        solution_iter[i] = prev_v[i + 1];
                    }
                    for i in n..size {
                        solution_iter[i] = new_sol[i];
                    }

                    if max_diff < tolerance {
                        converged = true;
                        break;
                    }
                } else {
                    solve_err =
                        Some("Error de convergencia o circuito mal condicionado".to_string());
                    break;
                }
            }

            if converged {
                Ok(solution_iter)
            } else {
                Err(solve_err.unwrap_or_else(|| {
                    "Error de convergencia o circuito mal condicionado".to_string()
                }))
            }
        } else {
            solve_sparse(&matrix_a, &vector_z)
                .ok_or_else(|| "Error de convergencia o circuito mal condicionado".to_string())
        };

        // Si convergió, evaluamos el LTE (Error de Truncamiento Local)
        if let Ok(ref step_solution) = step_solution_res {
            let lte = estimate_local_truncation_error(
                step_solution,
                &sol_n,
                &sol_n1,
                &sol_n2,
                n,
                dt,
                prev_dt,
                is_fixed,
                steps_completed,
                integration_method,
            );
            let lte_max = lte.maximum;
            let integrator_order = lte.integrator_order;

            // Decidir si aceptamos o rechazamos el paso temporal
            if !is_fixed && lte_max > lte_tol && dt > dt_min {
                // RECHAZAR PASO: Restaurar estados del backup y reducir dt asintóticamente
                cap_states = cap_states_backup;
                ind_states = ind_states_backup;
                cap_states_prev = cap_states_prev_backup;
                ind_states_prev = ind_states_prev_backup;
                switch_states = switch_states_backup;
                mcu_tchip = mcu_tchip_backup;
                mcu_vsample = mcu_vsample_backup;
                mcu_vdaceff = mcu_vdaceff_backup;
                device_tjunc = device_tjunc_backup;
                ms_scheduler = ms_scheduler_backup;

                let ratio = lte_tol / lte_max;
                let factor = 0.9 * ratio.powf(1.0 / (integrator_order + 1.0));
                let bounded_factor = factor.clamp(0.1, 0.5);
                dt = (dt * bounded_factor).max(dt_min);
                continue; // Volver a intentar la misma iteración temporal con el dt reducido
            } else {
                // ACEPTAR PASO: Guardar resultado y avanzar
                current_solution = step_solution.clone();
                prev_dt = dt;

                if event_intercepted {
                    dt = original_dt;
                } else if !is_fixed && steps_completed >= 2 {
                    if lte_max > 1e-15 {
                        let ratio = lte_tol / lte_max;
                        let factor = 0.9 * ratio.powf(1.0 / (integrator_order + 1.0));
                        let bounded_factor = factor.clamp(1.0, 2.0);
                        dt = (dt * bounded_factor).min(dt_max);
                    } else {
                        dt = (dt * 2.0).min(dt_max);
                    }
                } else if is_fixed {
                    dt = settings.dt;
                }

                // Rotar histórico de soluciones
                sol_n2 = sol_n1.clone();
                sol_n1 = sol_n.clone();
                sol_n = step_solution.clone();
                steps_completed += 1;

                // Actualizar corrientes de capacitores y voltajes de inductores para TRAP
                if integration_method == "trap" {
                    update_trapezoidal_history(
                        netlist,
                        step_solution,
                        dt,
                        &cap_states,
                        &mut cap_currents,
                        &mut ind_states,
                        &mut ind_states_prev,
                        &mut ind_voltages,
                    );
                }

                // Desempaquetar voltajes de nodos
                let mut node_voltages = HashMap::new();
                node_voltages.insert("0".to_string(), 0.0);
                for i in 1..=n {
                    node_voltages.insert(i.to_string(), step_solution[i - 1]);
                }

                // Desempaquetar corrientes de fuentes
                let mut branch_currents = HashMap::new();
                for vs in &v_sources {
                    let vs_idx = *vsource_map.get(&vs.id).unwrap();
                    branch_currents.insert(vs.id.clone(), step_solution[n + vs_idx]);
                }

                results.push(TimeStepResult {
                    time: t,
                    node_voltages,
                    branch_currents,
                });

                // --- STREAMING CALLBACK: punto de extension para emision en vivo ---
                if let Some(ref mut cb) = on_step {
                    if let Some(last_result) = results.last() {
                        if !cb(last_result) {
                            break;
                        }
                    }
                }

                detect_mixed_signal_crossings(netlist, &mut ms_scheduler, &step_solution, t, dt);
                process_mixed_signal_events(netlist, &mut ms_scheduler, t + dt);

                let integration_history = IntegrationHistoryParams {
                    integration_method,
                    gear2_active_this_step,
                    gear_a,
                    gear_b,
                    gear_c,
                    dt,
                };

                update_passive_storage_states(
                    netlist,
                    &step_solution,
                    &mut cap_states,
                    &mut cap_states_prev,
                    &mut ind_states,
                    &mut ind_states_prev,
                    &integration_history,
                );
                update_mcu_accepted_states(
                    netlist,
                    &step_solution,
                    &mut McuAcceptedStateMaps {
                        tchip: &mut mcu_tchip,
                        vsample: &mut mcu_vsample,
                        vdaceff: &mut mcu_vdaceff,
                    },
                    t,
                    dt,
                    t_amb,
                );

                update_coupled_inductor_states(
                    netlist,
                    &step_solution,
                    &mut ind_states,
                    &mut ind_states_prev,
                    &integration_history,
                );
                update_device_junction_temperatures(
                    netlist,
                    &step_solution,
                    &mut device_tjunc,
                    t_amb,
                    dt,
                );

                // Avanzar tiempo t con el dt actual
                t += dt;

                // Ajustar dt dinámicamente para el paso siguiente
                if !is_fixed && lte_max < 0.1 * lte_tol {
                    // Si el error es sumamente pequeño, duplicamos el paso para ir más rápido
                    dt = (dt * 1.5).min(dt_max);
                }
            }
        } else {
            // Si la iteración física en sí misma divergió matemáticamente y dt > dt_min, reducimos dt e intentamos nuevamente
            if dt > dt_min {
                cap_states = cap_states_backup;
                ind_states = ind_states_backup;
                cap_states_prev = cap_states_prev_backup;
                ind_states_prev = ind_states_prev_backup;
                switch_states = switch_states_backup;
                mcu_tchip = mcu_tchip_backup;
                mcu_vsample = mcu_vsample_backup;
                mcu_vdaceff = mcu_vdaceff_backup;
                device_tjunc = device_tjunc_backup;
                ms_scheduler = ms_scheduler_backup;
                dt = (dt / 2.0).max(dt_min);
                continue;
            } else {
                return Err("Error de convergencia o circuito mal condicionado".to_string());
            }
        }
    }

    Ok((results, cap_states, ind_states))
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PssSettings {
    pub period: f64,
    pub max_shooting_iters: usize,
    pub shooting_tolerance: f64,
}
