use crate::solver::matrix::{SparseLU, SparseMatrix};
use crate::solver::types::{CircuitNetlist, ComponentData, SimulationResult};
use nalgebra::DVector;
use std::collections::HashMap;

mod diagnostics;
mod homotopy;
mod linear;
mod newton;
mod result;

use diagnostics::{diagnose_convergence_failure, multiply_sparse_matrix_vector};
use homotopy::solve_homotopy_core;
use result::build_simulation_result;

pub use linear::{stamp_linear_components, stamp_linear_components_sparse};
pub use newton::solve_newton_raphson_core;

pub fn solve_dc_circuit(netlist: &CircuitNetlist) -> Result<SimulationResult, String> {
    solve_dc_circuit_with_guess(netlist, None).map(|(res, _)| res)
}

pub fn solve_dc_circuit_with_guess(
    netlist: &CircuitNetlist,
    initial_guess_opt: Option<&Vec<f64>>,
) -> Result<(SimulationResult, Vec<f64>), String> {
    // 1. Identificar el número máximo de nodos activos y validar topología
    let n = crate::topology::validate_netlist_topology(netlist, false)?;

    // Identificar fuentes independientes de tensión y controladas de tensión (vcvs, ccvs)
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
    let m = v_sources.len(); // Cantidad de fuentes de voltaje (incluyendo bvoltage, vcvs, ccvs)

    let size = n + m;
    if size == 0 {
        return Err("El circuito no contiene nodos activos o componentes.".to_string());
    }

    // Mapear IDs de fuentes a índices
    let mut vsource_map = HashMap::new();
    for (idx, vs) in v_sources.iter().enumerate() {
        vsource_map.insert(vs.id.clone(), idx);
    }

    // Comprobar si el circuito tiene componentes no lineales (Diodos, MOSFETs, BJTs, Op-Amps, B-Sources)
    let has_nonlinear = netlist.components.iter().any(|c| {
        c.comp_type == "diode"
            || c.comp_type == "led"
            || c.comp_type == "opto"
            || c.comp_type == "nmos"
            || c.comp_type == "pmos"
            || c.comp_type == "npn"
            || c.comp_type == "pnp"
            || c.comp_type == "opamp"
            || c.comp_type == "bsim3nmos"
            || c.comp_type == "bsim3pmos"
            || c.comp_type == "bsim4nmos"
            || c.comp_type == "bsim4pmos"
            || c.comp_type == "verilog_a"
            || c.comp_type.ends_with("_gate")
            || c.comp_type == "arduino_uno"
            || c.comp_type == "esp32"
            || c.comp_type == "raspberry_pi_pico"
            || c.comp_type == "bvoltage"
            || c.comp_type == "bcurrent"
    });

    // Si tiene componentes no lineales, ejecutamos el Solver iterativo Newton-Raphson
    if has_nonlinear {
        return solve_newton_raphson(netlist, n, m, &vsource_map, initial_guess_opt);
    }

    // Si es un circuito puramente lineal, resolvemos con una sola ejecución MNA dispersa directa
    let mut matrix_a = SparseMatrix::new(size);
    let mut vector_z = DVector::<f64>::zeros(size);

    stamp_linear_components_sparse(netlist, n, &vsource_map, &mut matrix_a, &mut vector_z)?;

    // Resolver A * x = z de forma directa dispersa con Markowitz
    let lu = SparseLU::factorize(matrix_a)
        .map_err(|_| "Error de convergencia o circuito mal condicionado".to_string())?;
    let solution = lu
        .solve(&vector_z)
        .ok_or_else(|| "Error de convergencia o circuito mal condicionado".to_string())?;

    // Desempaquetar voltajes de nodos
    let mut node_voltages = HashMap::new();
    node_voltages.insert("0".to_string(), 0.0);
    let mut final_voltages = vec![0.0; n + 1];
    for i in 1..=n {
        node_voltages.insert(i.to_string(), solution[i - 1]);
        final_voltages[i] = solution[i - 1];
    }

    // Desempaquetar corrientes de fuentes
    let mut branch_currents = HashMap::new();
    for vs in &v_sources {
        let vs_idx = *vsource_map
            .get(&vs.id)
            .ok_or_else(|| format!("Fuente {} no encontrada en el mapa de mapeo MNA.", vs.id))?;
        branch_currents.insert(vs.id.clone(), solution[n + vs_idx]);
    }

    Ok((
        SimulationResult {
            node_voltages,
            branch_currents,
            convergence_iterations: 1,
            error_log: None,
        },
        final_voltages,
    ))
}

// SOLVER ITERATIVO NEWTON-RAPHSON ROBUSTO CON AUTO-RECUPERACIÓN (GMIN STEPPING Y SOURCE STEPPING)
// Incluye bucle externo de convergencia de estados del Switch (Latching)
pub fn solve_newton_raphson(
    netlist: &CircuitNetlist,
    n: usize,
    m: usize,
    vsource_map: &HashMap<String, usize>,
    initial_guess_opt: Option<&Vec<f64>>,
) -> Result<(SimulationResult, Vec<f64>), String> {
    let mut initial_guess = match initial_guess_opt {
        Some(guess) if guess.len() == n + 1 => guess.clone(),
        _ => vec![0.0; n + 1],
    };

    if initial_guess_opt.is_none() {
        for comp in &netlist.components {
            if comp.comp_type == "nodeset_directive" {
                if let Some(node_str) = comp.pins.first() {
                    if let Ok(node_idx) = node_str.parse::<usize>() {
                        if node_idx > 0 && node_idx <= n {
                            initial_guess[node_idx] = comp.value;
                        }
                    }
                }
            }
        }
    }
    let base_gmin = 1e-12; // G_min residual para estabilidad permanente de nodos flotantes

    // Construir estados iniciales congelados del switch evaluando initial_guess
    let mut switch_frozen_states: HashMap<String, bool> = HashMap::new();
    for comp in &netlist.components {
        if comp.comp_type == "switch" {
            let is_closed = comp.switch_state.unwrap_or(false);
            if let (Ok(node_a), Ok(node_b)) =
                (comp.pins[0].parse::<usize>(), comp.pins[1].parse::<usize>())
            {
                let v_a = if node_a <= n {
                    initial_guess[node_a]
                } else {
                    0.0
                };
                let v_b = if node_b <= n {
                    initial_guess[node_b]
                } else {
                    0.0
                };
                let v_ab = v_a - v_b;
                let vth = comp.switch_vth.unwrap_or(0.5);
                let vh = comp.switch_vh.unwrap_or(0.05);
                let mut state = is_closed;
                if !is_closed && v_ab > vth + vh / 2.0 {
                    state = true;
                } else if is_closed && v_ab < vth - vh / 2.0 {
                    state = false;
                }
                switch_frozen_states.insert(comp.id.clone(), state);
            } else {
                switch_frozen_states.insert(comp.id.clone(), is_closed);
            }
        }
    }

    // Helper: verificar si algún switch debe cambiar de estado tras convergencia
    let check_switch_convergence = |solution: &DVector<f64>,
                                    current_states: &HashMap<String, bool>|
     -> (bool, HashMap<String, bool>) {
        let mut changed = false;
        let mut new_states = current_states.clone();
        for comp in &netlist.components {
            if comp.comp_type == "switch" {
                if let (Ok(node_a), Ok(node_b)) =
                    (comp.pins[0].parse::<usize>(), comp.pins[1].parse::<usize>())
                {
                    let v_a = if node_a > 0 {
                        solution[node_a - 1]
                    } else {
                        0.0
                    };
                    let v_b = if node_b > 0 {
                        solution[node_b - 1]
                    } else {
                        0.0
                    };
                    let v_ab = v_a - v_b;
                    let vth = comp.switch_vth.unwrap_or(0.5);
                    let vh = comp.switch_vh.unwrap_or(0.05);
                    let is_closed = current_states.get(&comp.id).copied().unwrap_or(false);
                    let desired = if !is_closed && v_ab > vth + vh / 2.0 {
                        true
                    } else if is_closed && v_ab < vth - vh / 2.0 {
                        false
                    } else {
                        is_closed
                    };
                    if desired != is_closed {
                        new_states.insert(comp.id.clone(), desired);
                        changed = true;
                    }
                }
            }
        }
        (changed, new_states)
    };

    // Bucle externo: reintentar con estados de switch actualizados hasta estabilizar
    for _outer_iter in 0..4 {
        // Intento 1: Newton-Raphson básico amortiguado
        match solve_newton_raphson_core(
            netlist,
            n,
            m,
            vsource_map,
            base_gmin,
            1.0,
            &initial_guess,
            None,
            &switch_frozen_states,
        ) {
            Ok(solution) => {
                let (sw_changed, new_sw) =
                    check_switch_convergence(&solution, &switch_frozen_states);
                if !sw_changed {
                    let res = build_simulation_result(netlist, n, m, vsource_map, &solution, 1)?;
                    let mut final_voltages = vec![0.0; n + 1];
                    for i in 1..=n {
                        final_voltages[i] = solution[i - 1];
                    }
                    return Ok((res, final_voltages));
                }
                switch_frozen_states = new_sw;
                for i in 1..=n {
                    initial_guess[i] = solution[i - 1];
                }
                continue;
            }
            Err(_) => {}
        }

        // Intento 2: Gmin Stepping logarítmico (Fase 14)
        let mut gmin_temp = 1e-3;
        let mut current_guess = initial_guess.clone();
        let mut gmin_success = true;
        let mut iters_gmin = 0;

        while gmin_temp >= base_gmin {
            iters_gmin += 1;
            match solve_newton_raphson_core(
                netlist,
                n,
                m,
                vsource_map,
                gmin_temp,
                1.0,
                &current_guess,
                None,
                &switch_frozen_states,
            ) {
                Ok(sol) => {
                    for i in 1..=n {
                        current_guess[i] = sol[i - 1];
                    }
                    if gmin_temp <= base_gmin {
                        break;
                    }
                    gmin_temp *= 0.1;
                    if gmin_temp < base_gmin {
                        gmin_temp = base_gmin;
                    }
                }
                Err(_) => {
                    gmin_success = false;
                    break;
                }
            }
        }

        if gmin_success {
            if let Ok(solution) = solve_newton_raphson_core(
                netlist,
                n,
                m,
                vsource_map,
                base_gmin,
                1.0,
                &current_guess,
                None,
                &switch_frozen_states,
            ) {
                let (sw_changed, new_sw) =
                    check_switch_convergence(&solution, &switch_frozen_states);
                if !sw_changed {
                    let res = build_simulation_result(
                        netlist,
                        n,
                        m,
                        vsource_map,
                        &solution,
                        iters_gmin * 15,
                    )?;
                    let mut final_voltages = vec![0.0; n + 1];
                    for i in 1..=n {
                        final_voltages[i] = solution[i - 1];
                    }
                    return Ok((res, final_voltages));
                }
                switch_frozen_states = new_sw;
                for i in 1..=n {
                    initial_guess[i] = solution[i - 1];
                }
                continue;
            }
        }

        // Intento 3: Source Stepping adaptativo (Fase 14)
        let mut alpha: f64 = 0.0;
        let mut d_alpha: f64 = 0.05;
        let mut current_guess = initial_guess.clone();
        let mut source_success = true;
        let mut iters_source = 0;

        while alpha < 1.0_f64 {
            iters_source += 1;
            let next_alpha = (alpha + d_alpha).min(1.0_f64);
            match solve_newton_raphson_core(
                netlist,
                n,
                m,
                vsource_map,
                base_gmin,
                next_alpha,
                &current_guess,
                None,
                &switch_frozen_states,
            ) {
                Ok(sol) => {
                    for i in 1..=n {
                        current_guess[i] = sol[i - 1];
                    }
                    alpha = next_alpha;
                    d_alpha = (d_alpha * 1.5).min(0.2_f64);
                }
                Err(_) => {
                    d_alpha /= 2.0;
                    if d_alpha < 1e-4_f64 {
                        source_success = false;
                        break;
                    }
                }
            }
        }

        if source_success && alpha >= 1.0 {
            if let Ok(solution) = solve_newton_raphson_core(
                netlist,
                n,
                m,
                vsource_map,
                base_gmin,
                1.0,
                &current_guess,
                None,
                &switch_frozen_states,
            ) {
                let (sw_changed, new_sw) =
                    check_switch_convergence(&solution, &switch_frozen_states);
                if !sw_changed {
                    let res = build_simulation_result(
                        netlist,
                        n,
                        m,
                        vsource_map,
                        &solution,
                        iters_source * 20,
                    )?;
                    let mut final_voltages = vec![0.0; n + 1];
                    for i in 1..=n {
                        final_voltages[i] = solution[i - 1];
                    }
                    return Ok((res, final_voltages));
                }
                switch_frozen_states = new_sw;
                for i in 1..=n {
                    initial_guess[i] = solution[i - 1];
                }
                continue;
            }
        }

        // Intento 4: Homotopía de Continuación de Punto Fijo
        let mut lambda: f64 = 0.0;
        let mut d_lambda: f64 = 0.05;
        let mut current_guess_hom = initial_guess.clone();
        let x_init = initial_guess.clone();
        let mut homotopy_success = true;
        let mut iters_homotopy = 0;

        while lambda < 1.0_f64 {
            iters_homotopy += 1;
            let next_lambda = (lambda + d_lambda).min(1.0_f64);
            match solve_homotopy_core(
                netlist,
                n,
                m,
                vsource_map,
                base_gmin,
                next_lambda,
                &x_init,
                &current_guess_hom,
            ) {
                Ok(sol) => {
                    for i in 1..=n {
                        current_guess_hom[i] = sol[i - 1];
                    }
                    lambda = next_lambda;
                    d_lambda = (d_lambda * 1.5).min(0.2_f64);
                }
                Err(_e) => {
                    d_lambda /= 2.0;
                    if d_lambda < 1e-4_f64 {
                        homotopy_success = false;
                        break;
                    }
                }
            }
        }

        if homotopy_success && lambda >= 1.0 {
            match solve_newton_raphson_core(
                netlist,
                n,
                m,
                vsource_map,
                base_gmin,
                1.0,
                &current_guess_hom,
                None,
                &switch_frozen_states,
            ) {
                Ok(solution) => {
                    let (sw_changed, new_sw) =
                        check_switch_convergence(&solution, &switch_frozen_states);
                    if !sw_changed {
                        let res = build_simulation_result(
                            netlist,
                            n,
                            m,
                            vsource_map,
                            &solution,
                            iters_homotopy * 20,
                        )?;
                        let mut final_voltages = vec![0.0; n + 1];
                        for i in 1..=n {
                            final_voltages[i] = solution[i - 1];
                        }
                        return Ok((res, final_voltages));
                    }
                    switch_frozen_states = new_sw;
                    for i in 1..=n {
                        initial_guess[i] = solution[i - 1];
                    }
                    continue;
                }
                Err(_e) => {}
            }
        }

        // Intento 5: Pseudo-Transient Analysis (PTA)
        let size = n + m;
        let mut pta_sol = DVector::<f64>::zeros(size);
        for i in 1..=n {
            pta_sol[i - 1] = initial_guess[i];
        }

        let c_pseudo = 1e-6;
        let l_pseudo = 1e-3;
        let mut dt_pseudo = 1e-6;
        let mut t_pseudo = 0.0;
        let t_max_pseudo = 0.5;
        let mut steps_completed = 0;
        let max_pta_steps = 300;
        let mut pta_success = true;

        while t_pseudo < t_max_pseudo && steps_completed < max_pta_steps {
            let g_pseudo = c_pseudo / dt_pseudo;
            let r_pseudo = l_pseudo / dt_pseudo;

            let mut current_guess = vec![0.0; n + 1];
            for i in 1..=n {
                current_guess[i] = pta_sol[i - 1];
            }

            match solve_newton_raphson_core(
                netlist,
                n,
                m,
                vsource_map,
                base_gmin,
                1.0,
                &current_guess,
                Some((g_pseudo, r_pseudo, &pta_sol)),
                &switch_frozen_states,
            ) {
                Ok(sol) => {
                    pta_sol = sol;
                    t_pseudo += dt_pseudo;
                    steps_completed += 1;
                    dt_pseudo = (dt_pseudo * 1.5).min(0.1);
                }
                Err(_) => {
                    dt_pseudo /= 2.0;
                    if dt_pseudo < 1e-12 {
                        pta_success = false;
                        break;
                    }
                }
            }
        }

        if pta_success && steps_completed > 0 {
            let mut final_guess = vec![0.0; n + 1];
            for i in 1..=n {
                final_guess[i] = pta_sol[i - 1];
            }
            if let Ok(solution) = solve_newton_raphson_core(
                netlist,
                n,
                m,
                vsource_map,
                base_gmin,
                1.0,
                &final_guess,
                None,
                &switch_frozen_states,
            ) {
                let (sw_changed, new_sw) =
                    check_switch_convergence(&solution, &switch_frozen_states);
                if !sw_changed {
                    let res = build_simulation_result(
                        netlist,
                        n,
                        m,
                        vsource_map,
                        &solution,
                        steps_completed * 10 + 10,
                    )?;
                    let mut final_voltages = vec![0.0; n + 1];
                    for i in 1..=n {
                        final_voltages[i] = solution[i - 1];
                    }
                    return Ok((res, final_voltages));
                }
                switch_frozen_states = new_sw;
                for i in 1..=n {
                    initial_guess[i] = solution[i - 1];
                }
                continue;
            }
        }

        // Si ningún mecanismo de recuperación funcionó, retornar error
        return Err("Error de convergencia o circuito mal condicionado".to_string());
    }

    Err("Error de convergencia o circuito mal condicionado".to_string())
}
