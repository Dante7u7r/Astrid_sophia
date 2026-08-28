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
use super::simulation_types::{SolverNumericalSettings, TimeStepResult, TransientSettings};
use super::transient_companions::{stamp_transient_companions, CompanionStampState};
use super::transient_mcu::{
    is_mcu_component, update_mcu_accepted_states, McuAcceptedStateMaps, McuRuntimeManager,
};
use super::transient_mixed_signal::{
    detect_mixed_signal_crossings, initialize_mixed_signal_scheduler, process_mixed_signal_events,
};
use super::transient_setup::{
    apply_static_live_overrides, drain_live_overrides, has_transient_nonlinearity,
    initialize_device_junction_temperatures, initialize_energy_storage_states,
    initialize_mcu_transient_state, is_uic_active, ComponentOverrideMap, EnergyStorageState,
    McuTransientState,
};
use super::transient_sources::stamp_dynamic_transient_sources;
use super::transient_state_updates::{
    update_coupled_inductor_states, update_passive_storage_states, IntegrationHistoryParams,
};
use super::transient_step_control::{
    compute_bdf_coefficients, predict_variable_order_step, update_trapezoidal_history,
    IntegrationMethodType, VariableOrderController,
};
use super::transient_switches::update_switch_states;
use super::transient_thermal::{initialize_transient_thermal_models, update_device_junction_temperatures};
use super::transient_workspace::TransientWorkspace;
use stamps::{stamp_behavioral_sources, stamp_component, StampContext};

pub fn solve_transient_circuit(
    netlist: &CircuitNetlist,
    settings: &TransientSettings,
) -> Result<Vec<TimeStepResult>, String> {
    solve_transient_circuit_with_numerical_settings(
        netlist,
        settings,
        SolverNumericalSettings::default(),
    )
}

pub fn solve_transient_circuit_with_numerical_settings(
    netlist: &CircuitNetlist,
    settings: &TransientSettings,
    numerical_settings: SolverNumericalSettings,
) -> Result<Vec<TimeStepResult>, String> {
    let (results, _, _) = solve_transient_circuit_with_initial_states_and_numerical_settings(
        netlist,
        settings,
        HashMap::new(),
        HashMap::new(),
        numerical_settings,
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
    solve_transient_circuit_with_initial_states_and_numerical_settings(
        netlist,
        settings,
        cap_init,
        ind_init,
        SolverNumericalSettings::default(),
    )
}

pub fn solve_transient_circuit_with_initial_states_and_numerical_settings(
    netlist: &CircuitNetlist,
    settings: &TransientSettings,
    cap_init: HashMap<String, f64>,
    ind_init: HashMap<String, f64>,
    numerical_settings: SolverNumericalSettings,
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
        numerical_settings,
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
    numerical_settings: SolverNumericalSettings,
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
    if live_run_id.is_some() {
        settings.validate_interactive()?;
    } else {
        settings.validate()?;
    }
    numerical_settings.validate()?;
    let n = crate::topology::validate_netlist_topology(netlist, false)?;
    let (vt, _is_temp) = get_thermal_parameters(netlist.temperature, None);
    let is_fixed = settings.fixed_step.unwrap_or(false) || netlist.fixed_step.unwrap_or(false);
    let integration_method_str = match settings.integration_method.as_deref().unwrap_or("auto") {
        "BE" => "euler",
        "trapezoidal" => "trap",
        method => method,
    };
    let mut order_controller = VariableOrderController::new(integration_method_str);
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

    let uic = is_uic_active(netlist, &cap_init, &ind_init);
    let dc_op_result = if !uic {
        solve_dc_circuit_with_numerical_settings(netlist, numerical_settings).ok()
    } else {
        None
    };

    let EnergyStorageState {
        mut cap_states,
        mut ind_states,
        mut cap_states_prev,
        mut ind_states_prev,
        mut cap_currents,
        mut ind_voltages,
        mut switch_states,
    } = initialize_energy_storage_states(netlist, &cap_init, &ind_init, dc_op_result.as_ref());

    let has_nonlinear = has_transient_nonlinearity(netlist);

    let t_amb = netlist.temperature.unwrap_or(300.0);

    let McuTransientState {
        mut mcu_tchip,
        mut mcu_vsample,
        mut mcu_vdaceff,
    } = initialize_mcu_transient_state(netlist, t_amb);
    let mut device_tjunc = initialize_device_junction_temperatures(netlist, t_amb);
    let mut thermal_models = initialize_transient_thermal_models(netlist, t_amb);

    // Armar la matriz lineal estática BASE (Resistores, Fuentes de voltaje independientes)
    let mut matrix_a_linear = DMatrix::<f64>::zeros(size, size);
    let mut vector_z_linear = DVector::<f64>::zeros(size);

    stamp_transient_linear_components(
        netlist,
        n,
        &vsource_map,
        &mut matrix_a_linear,
        &mut vector_z_linear,
    )?;

    let mut ms_scheduler = initialize_mixed_signal_scheduler(netlist);
    let mut mcu_manager = McuRuntimeManager::new(netlist)?;

    // VARIABLES DE TIEMPO ADAPTATIVO
    let mut dt = settings.dt;
    let mut prev_dt = settings.dt;
    let mut t = 0.0;
    let t_max = settings.t_max;

    let mut current_solution = DVector::<f64>::zeros(size);
    if let Some(ref dc_result) = dc_op_result {
        for i in 1..=n {
            current_solution[i - 1] = *dc_result.node_voltages.get(&i.to_string()).unwrap_or(&0.0);
        }
        for (source_id, source_index) in &vsource_map {
            current_solution[n + source_index] =
                *dc_result.branch_currents.get(source_id).unwrap_or(&0.0);
        }
    } else {
        for comp in &netlist.components {
            if comp.comp_type == "capacitor" {
                if let Some(&v_c) = cap_init.get(&comp.id) {
                    let n_pos = comp.pins[0].parse::<usize>().unwrap_or(0);
                    let n_neg = comp.pins[1].parse::<usize>().unwrap_or(0);
                    if n_pos > 0 && n_neg == 0 {
                        current_solution[n_pos - 1] = v_c;
                    }
                }
            } else if comp.comp_type == "vsource" {
                let n_pos = comp.pins[0].parse::<usize>().unwrap_or(0);
                let n_neg = comp.pins[1].parse::<usize>().unwrap_or(0);
                if n_pos > 0 && n_neg == 0 {
                    current_solution[n_pos - 1] = comp.value;
                }
            }
        }
    }

    // Histórico de soluciones para cálculo de la segunda derivada (Euler/Gear2) y tercera derivada (TRAP) del LTE
    let mut sol_n = current_solution.clone(); // Solución actual (n)
    let mut sol_n1 = current_solution.clone(); // Solución en n-1
    let mut sol_n2 = current_solution.clone(); // Solución en n-2
    let mut steps_completed = 0;

    let mut cap_history: Vec<HashMap<String, f64>> = Vec::new();
    let mut ind_history: Vec<HashMap<String, f64>> = Vec::new();
    let mut recent_dts: Vec<f64> = Vec::new();

    // Identificar nodos conectados a componentes dinámicos reactivos para acotar LTE
    let mut dynamic_nodes = std::collections::HashSet::new();
    for comp in &netlist.components {
        if comp.comp_type == "capacitor"
            || comp.comp_type == "inductor"
            || comp.comp_type == "transmission_line"
            || comp.comp_type == "coupled_inductor"
            || comp.comp_type == "diode"
            || comp.comp_type == "nmos"
            || comp.comp_type == "pmos"
            || comp.comp_type == "npn"
            || comp.comp_type == "pnp"
            || comp.comp_type == "bsim3nmos"
            || comp.comp_type == "bsim3pmos"
            || comp.comp_type == "bsim4nmos"
            || comp.comp_type == "bsim4pmos"
            || comp.comp_type.ends_with("_gate")
            || is_mcu_component(comp)
        {
            for pin in &comp.pins {
                if let Ok(node_idx) = pin.parse::<usize>() {
                    if node_idx > 0 && node_idx <= n {
                        dynamic_nodes.insert(node_idx - 1);
                    }
                }
            }
        }
    }

    // Tolerancia LTE normalizada: lte_max <= 1.0 cumple reltol y vntol
    let lte_tol = 1.0;
    // El mínimo adaptativo permite reducir el paso hasta 1000x en transiciones rápidas
    let dt_min = (settings.dt * 1e-3).max(1e-12);
    let dt_max = settings.dt * 2.5;

    let mut results = Vec::new();
    let mut local_overrides = ComponentOverrideMap::new();
    let mut ws = TransientWorkspace::new(size, n);

    // `t` representa siempre el último tiempo aceptado. No se publica un falso
    // estado inicial: la primera solución integrada corresponde a t=dt.
    let time_epsilon = (t_max.abs() * 1e-12).max(f64::EPSILON * t_max.abs().max(settings.dt));
    while t + time_epsilon < t_max {
        // El último paso puede ser menor que el nominal para terminar exactamente
        // en tMax sin calcular ni etiquetar una muestra fuera del intervalo.
        dt = dt.min(t_max - t);
        drain_live_overrides(&mut local_overrides, &live_overrides, live_run_id);

        let active_method = order_controller.active_method;
        let trap_active_this_step = active_method == IntegrationMethodType::Trap
            && order_controller.steps_with_current_method >= 1;
        let gear2_active_this_step = (active_method == IntegrationMethodType::Gear2
            || active_method == IntegrationMethodType::TrBdf2)
            && order_controller.steps_with_current_method >= 2;

        let bdf_order = match active_method {
            IntegrationMethodType::Euler => 1,
            IntegrationMethodType::TrBdf2 | IntegrationMethodType::Gear2 => {
                2.min(order_controller.steps_with_current_method + 1)
            }
            IntegrationMethodType::Gear3 => 3.min(order_controller.steps_with_current_method + 1),
            IntegrationMethodType::Gear4 => 4.min(order_controller.steps_with_current_method + 1),
            IntegrationMethodType::Gear5 => 5.min(order_controller.steps_with_current_method + 1),
            IntegrationMethodType::Gear6 => 6.min(order_controller.steps_with_current_method + 1),
            IntegrationMethodType::Trap => 2,
        };
        let mut dts_for_bdf = vec![dt];
        dts_for_bdf.extend_from_slice(&recent_dts);
        let bdf_alphas = compute_bdf_coefficients(bdf_order, &dts_for_bdf);

        // Respaldar estados antes de intentar resolver el paso reutilizando la memoria del workspace
        ws.backup.save(
            &cap_states,
            &ind_states,
            &cap_states_prev,
            &ind_states_prev,
            &cap_history,
            &ind_history,
            &switch_states,
            &mcu_tchip,
            &mcu_vsample,
            &mcu_vdaceff,
            &device_tjunc,
            &thermal_models,
            &ms_scheduler,
        );

        // Acotar timestep si se intercepta un evento digital intermedio
        let mut event_intercepted = false;
        let original_dt = dt;
        if let Some(next_event_t) = ms_scheduler.get_next_event_time() {
            if next_event_t > t && next_event_t < t + dt {
                dt = next_event_t - t;
                event_intercepted = true;
            }
        }
        let step_time = t + dt;

        // Preparar matrices del paso en buffers de trabajo preasignados
        ws.prepare_step_matrix(&matrix_a_linear, &vector_z_linear);

        apply_static_live_overrides(
            netlist,
            n,
            &vsource_map,
            &local_overrides,
            &mut ws.matrix_a_step,
            &mut ws.vector_z_step,
        );

        stamp_dynamic_transient_sources(
            netlist,
            n,
            step_time,
            &vsource_map,
            &local_overrides,
            &mut ws.vector_z_step,
        );

        let switches_changed = update_switch_states(
            netlist,
            &local_overrides,
            &current_solution,
            &mut switch_states,
        );
        if switches_changed {
            ws.invalidate_linear_factorization();
        }
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
            integration_method: active_method.as_str(),
            trap_active_this_step,
            gear2_active_this_step,
            bdf_order: if active_method.is_bdf() { bdf_order } else { 0 },
            bdf_alphas: &bdf_alphas,
            gear_a,
            gear_b,
            gear_c,
            dt,
        };
        stamp_transient_companions(
            netlist,
            &mut ws.matrix_a_step,
            &mut ws.vector_z_step,
            &CompanionStampState {
                cap_states: &cap_states,
                cap_states_prev: &cap_states_prev,
                cap_history: Some(&cap_history),
                cap_currents: &cap_currents,
                ind_states: &ind_states,
                ind_states_prev: &ind_states_prev,
                ind_history: Some(&ind_history),
                ind_voltages: &ind_voltages,
                switch_states: &switch_states,
                local_overrides: &local_overrides,
            },
            &companion_params,
        );

        // Si hay componentes no lineales, resolvemos con Newton-Raphson
        let step_solution_res = if has_nonlinear {
            let max_iter = numerical_settings.max_iterations;
            let tolerance = numerical_settings.tolerance;
            let mut converged = false;

            ws.init_prev_voltages(&current_solution);
            ws.ast_cache_t.clear();

            let mut solve_err = None;
            let mut lambda_backtrack = 1.0;
            let mut prev_max_diff = f64::MAX;

            for _iter in 0..max_iter {
                ws.prepare_iter_matrix();

                for comp in &netlist.components {
                    let mut context = StampContext {
                        netlist,
                        n,
                        size,
                        vsource_map: &vsource_map,
                        t: step_time,
                        dt,
                        t_amb,
                        prev_v: &ws.prev_v,
                        prev_prev_v: &ws.prev_prev_v,
                        current_solution: &current_solution,
                        solution_iter: &ws.solution_iter,
                        device_tjunc: &device_tjunc,
                        mcu_vdaceff: &mcu_vdaceff,
                        ms_scheduler: &ms_scheduler,
                        ast_cache_t: &mut ws.ast_cache_t,
                        matrix_a_iter: &mut ws.matrix_a_iter,
                        vector_z_iter: &mut ws.vector_z_iter,
                        diode_bypass: &mut ws.diode_bypass,
                        bjt_bypass: &mut ws.bjt_bypass,
                        mos_bypass: &mut ws.mos_bypass,
                        iter: _iter,
                    };
                    stamp_component(comp, &mut context);
                }

                let mut context = StampContext {
                    netlist,
                    n,
                    size,
                    vsource_map: &vsource_map,
                    t: step_time,
                    dt,
                    t_amb,
                    prev_v: &ws.prev_v,
                    prev_prev_v: &ws.prev_prev_v,
                    current_solution: &current_solution,
                    solution_iter: &ws.solution_iter,
                    device_tjunc: &device_tjunc,
                    mcu_vdaceff: &mcu_vdaceff,
                    ms_scheduler: &ms_scheduler,
                    ast_cache_t: &mut ws.ast_cache_t,
                    matrix_a_iter: &mut ws.matrix_a_iter,
                    vector_z_iter: &mut ws.vector_z_iter,
                    diode_bypass: &mut ws.diode_bypass,
                    bjt_bypass: &mut ws.bjt_bypass,
                    mos_bypass: &mut ws.mos_bypass,
                    iter: _iter,
                };
                stamp_behavioral_sources(&mut context);

                if let Some(new_sol) = solve_sparse(&ws.matrix_a_iter, &ws.vector_z_iter) {
                    let mut max_diff = 0.0;
                    for i in 1..=n {
                        let diff = (new_sol[i - 1] - ws.prev_v[i]).abs();
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

                    ws.prev_prev_v.copy_from_slice(&ws.prev_v);
                    for i in 1..=n {
                        ws.prev_v[i] = ws.prev_v[i] + lambda * (new_sol[i - 1] - ws.prev_v[i]);
                    }

                    // Actualizar variables de corriente y voltajes en solution_iter
                    let size = n + m;
                    for i in 0..n {
                        ws.solution_iter[i] = ws.prev_v[i + 1];
                    }
                    for i in n..size {
                        ws.solution_iter[i] = new_sol[i];
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
                Ok(ws.solution_iter.clone())
            } else {
                Err(solve_err.unwrap_or_else(|| {
                    "Error de convergencia o circuito mal condicionado".to_string()
                }))
            }
        } else {
            // Factorization Caching para circuitos lineales con validación exacta de firma de integración:
            let current_sig = crate::solver::engine::transient_workspace::LinearCompanionSignature {
                dt_bits: dt.to_bits(),
                trap_active: trap_active_this_step,
                gear2_active: gear2_active_this_step,
                bdf_order: if active_method.is_bdf() { bdf_order } else { 0 },
                bdf_alpha0_bits: bdf_alphas.first().copied().unwrap_or(0.0).to_bits(),
                gear_a_bits: gear_a.to_bits(),
            };

            let is_cache_valid = ws.cached_linear_factorization.is_some() && ws.cached_signature == current_sig;
            let linear_sol_res = if is_cache_valid {
                ws.cached_linear_factorization
                    .as_ref()
                    .unwrap()
                    .solve(ws.vector_z_step.as_slice())
                    .map(DVector::from_vec)
            } else {
                match crate::solver::linear_backend::factorize_dense_real(&ws.matrix_a_step) {
                    Ok(new_fact) => {
                        let sol = new_fact
                            .solve(ws.vector_z_step.as_slice())
                            .map(DVector::from_vec);
                        ws.cached_linear_factorization = Some(new_fact);
                        ws.cached_signature = current_sig;
                        sol
                    }
                    Err(e) => Err(e),
                }
            };

            match linear_sol_res {
                Ok(sol) => Ok(sol),
                Err(_) => solve_sparse(&ws.matrix_a_step, &ws.vector_z_step)
                    .ok_or_else(|| "Error de convergencia o circuito mal condicionado".to_string()),
            }
        };

        // Si convergió, evaluamos el LTE y predecimos método y timestep
        if let Ok(ref step_solution) = step_solution_res {
            let decision = predict_variable_order_step(
                &mut order_controller,
                step_solution,
                &sol_n,
                &sol_n1,
                &sol_n2,
                n,
                dt,
                prev_dt,
                is_fixed,
                steps_completed,
                lte_tol,
                dt_min,
                dt_max,
                numerical_settings.tolerance,
                1e-6,
                Some(&dynamic_nodes),
            );

            // Decidir si aceptamos o rechazamos el paso temporal
            if !is_fixed && !decision.step_accepted {
                // RECHAZAR PASO: Restaurar estados del backup y reducir dt
                ws.backup.restore(
                    &mut cap_states,
                    &mut ind_states,
                    &mut cap_states_prev,
                    &mut ind_states_prev,
                    &mut cap_history,
                    &mut ind_history,
                    &mut switch_states,
                    &mut mcu_tchip,
                    &mut mcu_vsample,
                    &mut mcu_vdaceff,
                    &mut device_tjunc,
                    &mut thermal_models,
                    &mut ms_scheduler,
                );

                order_controller.active_method = decision.next_method;
                dt = decision.next_dt;
                continue; // Volver a intentar la misma iteración temporal con el dt reducido
            } else {
                // ACEPTAR PASO: Guardar resultado y avanzar
                let accepted_dt = dt;
                let accepted_time = step_time;
                current_solution = step_solution.clone();
                prev_dt = accepted_dt;
                recent_dts.insert(0, accepted_dt);
                if recent_dts.len() > 6 {
                    recent_dts.pop();
                }

                // Rotar histórico de soluciones
                sol_n2 = sol_n1.clone();
                sol_n1 = sol_n.clone();
                sol_n = step_solution.clone();
                steps_completed += 1;

                // Actualizar corrientes de capacitores y voltajes de inductores para TRAP
                if active_method == IntegrationMethodType::Trap {
                    update_trapezoidal_history(
                        netlist,
                        step_solution,
                        accepted_dt,
                        &cap_states,
                        &mut cap_currents,
                        &mut ind_states,
                        &mut ind_states_prev,
                        &mut ind_voltages,
                        trap_active_this_step,
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

                update_device_junction_temperatures(
                    netlist,
                    step_solution,
                    &mut device_tjunc,
                    &mut thermal_models,
                    t_amb,
                    accepted_dt,
                );

                if live_run_id.is_some() {
                    results.clear();
                }
                results.push(TimeStepResult {
                    time: accepted_time,
                    node_voltages,
                    branch_currents,
                    device_temperatures: if !device_tjunc.is_empty() {
                        Some(device_tjunc.clone())
                    } else {
                        None
                    },
                });

                detect_mixed_signal_crossings(
                    netlist,
                    &mut ms_scheduler,
                    step_solution,
                    t,
                    accepted_dt,
                );
                process_mixed_signal_events(netlist, &mut ms_scheduler, accepted_time);
                mcu_manager.step_native_mcus(
                    netlist,
                    step_solution,
                    t,
                    accepted_dt,
                    &mut ms_scheduler,
                );

                let integration_history = IntegrationHistoryParams {
                    integration_method: active_method.as_str(),
                    trap_active_this_step,
                    gear2_active_this_step,
                    bdf_order: if active_method.is_bdf() { bdf_order } else { 0 },
                    bdf_alphas: &bdf_alphas,
                    gear_a,
                    gear_b,
                    gear_c,
                    dt: accepted_dt,
                };

                update_passive_storage_states(
                    netlist,
                    step_solution,
                    &mut cap_states,
                    &mut cap_states_prev,
                    &mut cap_history,
                    &mut ind_states,
                    &mut ind_states_prev,
                    &mut ind_history,
                    &integration_history,
                );
                update_mcu_accepted_states(
                    netlist,
                    step_solution,
                    &mut McuAcceptedStateMaps {
                        tchip: &mut mcu_tchip,
                        vsample: &mut mcu_vsample,
                        vdaceff: &mut mcu_vdaceff,
                    },
                    accepted_time,
                    accepted_dt,
                    t_amb,
                );

                update_coupled_inductor_states(
                    netlist,
                    step_solution,
                    &mut ind_states,
                    &mut ind_states_prev,
                    &ind_history,
                    &integration_history,
                );

                // Avanzar exclusivamente con el paso que produjo esta solución.
                t = accepted_time;
                order_controller.active_method = decision.next_method;

                // Calcular el paso candidato de la siguiente iteración.
                let next_dt = if event_intercepted {
                    original_dt
                } else if is_fixed {
                    settings.dt
                } else {
                    decision.next_dt
                };
                dt = next_dt.clamp(dt_min, dt_max);

                // El callback observa un estado ya aceptado y con historiales coherentes.
                if let Some(ref mut cb) = on_step {
                    if let Some(last_result) = results.last() {
                        if !cb(last_result) {
                            break;
                        }
                    }
                }
            }
        } else {
            // Si la iteración física en sí misma divergió matemáticamente y dt > dt_min, reducimos dt e intentamos nuevamente
            if dt > dt_min {
                ws.backup.restore(
                    &mut cap_states,
                    &mut ind_states,
                    &mut cap_states_prev,
                    &mut ind_states_prev,
                    &mut cap_history,
                    &mut ind_history,
                    &mut switch_states,
                    &mut mcu_tchip,
                    &mut mcu_vsample,
                    &mut mcu_vdaceff,
                    &mut device_tjunc,
                    &mut thermal_models,
                    &mut ms_scheduler,
                );
                if order_controller.is_auto() {
                    order_controller.active_method = IntegrationMethodType::Euler;
                }
                dt = (dt / 2.0).max(dt_min);
                continue;
            } else {
                return Err(format!(
                    "Error de convergencia o circuito mal condicionado en t={step_time:.6e} s (dt={dt:.6e} s)"
                ));
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

impl PssSettings {
    pub fn validate(&self) -> Result<(), String> {
        if !self.period.is_finite() || self.period <= 0.0 || self.period / 200.0 == 0.0 {
            return Err("El periodo PSS debe ser finito y mayor que cero.".to_string());
        }
        if self.max_shooting_iters == 0 || self.max_shooting_iters > 1_000 {
            return Err("Las iteraciones de shooting PSS deben estar entre 1 y 1 000.".to_string());
        }
        if !self.shooting_tolerance.is_finite()
            || self.shooting_tolerance <= 0.0
            || self.shooting_tolerance > 1.0
        {
            return Err(
                "La tolerancia de shooting PSS debe ser finita, mayor que cero y menor o igual que 1."
                    .to_string(),
            );
        }
        Ok(())
    }
}

#[cfg(test)]
mod pss_validation_tests {
    use super::*;

    #[test]
    fn pss_settings_reject_zero_period_and_iterations() {
        assert!(PssSettings {
            period: 0.0,
            max_shooting_iters: 10,
            shooting_tolerance: 1e-4,
        }
        .validate()
        .is_err());
        assert!(PssSettings {
            period: 1e-3,
            max_shooting_iters: 0,
            shooting_tolerance: 1e-4,
        }
        .validate()
        .is_err());
    }
}
