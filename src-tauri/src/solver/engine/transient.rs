use crate::solver::matrix::*;
use crate::solver::types::*;
use nalgebra::{DMatrix, DVector};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[allow(unused_imports)]
use super::ac::*;
#[allow(unused_imports)]
use super::advanced::*;
#[allow(unused_imports)]
use super::dc::*;
#[allow(unused_imports)]
use super::devices::*;
use super::live_mutations::take_live_mutations;
use super::simulation_types::{TimeStepResult, TransientSettings};

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

    // Inicializar estados de los almacenes de energía (Capacitores y Bobinas) con valores pasados o 0.0
    let mut cap_states: HashMap<String, f64> = HashMap::new();
    let mut ind_states: HashMap<String, f64> = HashMap::new();
    let mut cap_states_prev: HashMap<String, f64> = HashMap::new();
    let mut ind_states_prev: HashMap<String, f64> = HashMap::new();
    let mut cap_currents: HashMap<String, f64> = HashMap::new();
    let mut ind_voltages: HashMap<String, f64> = HashMap::new();
    let mut switch_states: HashMap<String, bool> = HashMap::new();

    // Extraer .ic_directive a un mapa local para facilidad de acceso
    let mut ic_map = HashMap::new();
    for comp in &netlist.components {
        if comp.comp_type == "ic_directive" {
            if let Some(node) = comp.pins.first() {
                ic_map.insert(node.clone(), comp.value);
            }
        }
    }
    let has_ic = !ic_map.is_empty();

    for comp in &netlist.components {
        if comp.comp_type == "capacitor" {
            let pin_a = &comp.pins[0];
            let pin_b = &comp.pins[1];
            let mut v_ic = 0.0;
            if has_ic {
                let v_a = if pin_a == "0" {
                    0.0
                } else {
                    *ic_map.get(pin_a).unwrap_or(&0.0)
                };
                let v_b = if pin_b == "0" {
                    0.0
                } else {
                    *ic_map.get(pin_b).unwrap_or(&0.0)
                };
                v_ic = v_a - v_b;
            }
            let val = if has_ic {
                v_ic
            } else {
                *cap_init.get(&comp.id).unwrap_or(&0.0)
            };
            cap_states.insert(comp.id.clone(), val);
            cap_states_prev.insert(comp.id.clone(), val);
            cap_currents.insert(comp.id.clone(), 0.0);
        } else if comp.comp_type == "inductor" {
            let val = *ind_init.get(&comp.id).unwrap_or(&0.0);
            ind_states.insert(comp.id.clone(), val);
            ind_states_prev.insert(comp.id.clone(), val);
            ind_voltages.insert(comp.id.clone(), 0.0);
        } else if comp.comp_type == "switch" {
            switch_states.insert(comp.id.clone(), comp.switch_state.unwrap_or(false));
        }
    }

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
            || c.comp_type.ends_with("_gate")
            || c.comp_type == "arduino_uno"
            || c.comp_type == "esp32"
            || c.comp_type == "raspberry_pi_pico"
            || c.comp_type == "bvoltage"
            || c.comp_type == "bcurrent"
            || c.comp_type == "njf"
            || c.comp_type == "pjf"
            || c.comp_type == "switch"
    });

    let mut mcu_tchip: HashMap<String, f64> = HashMap::new();
    let mut mcu_vsample: HashMap<String, f64> = HashMap::new();
    let mut mcu_vdaceff: HashMap<String, f64> = HashMap::new();

    let t_amb = netlist.temperature.unwrap_or(300.0);

    for comp in &netlist.components {
        if comp.comp_type == "arduino_uno"
            || comp.comp_type == "esp32"
            || comp.comp_type == "raspberry_pi_pico"
        {
            mcu_tchip.insert(comp.id.clone(), t_amb);
            mcu_vsample.insert(comp.id.clone(), 0.0);
            mcu_vdaceff.insert(comp.id.clone(), 0.0);
        }
    }

    // Temperaturas de unión para self-heating de dispositivos discretos (Diodos, BJTs, MOSFETs, Optos)
    let mut device_tjunc: HashMap<String, f64> = HashMap::new();
    for comp in &netlist.components {
        if comp.comp_type == "diode"
            || comp.comp_type == "led"
            || comp.comp_type == "nmos"
            || comp.comp_type == "pmos"
            || comp.comp_type == "npn"
            || comp.comp_type == "pnp"
            || comp.comp_type == "bsim3nmos"
            || comp.comp_type == "bsim3pmos"
            || comp.comp_type == "bsim4nmos"
            || comp.comp_type == "bsim4pmos"
            || comp.comp_type == "njf"
            || comp.comp_type == "pjf"
            || comp.comp_type == "opto"
        {
            device_tjunc.insert(comp.id.clone(), t_amb);
        }
    }

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

    // Inicializar planificador Mixed-Signal y estados iniciales
    let mut ms_scheduler = MixedSignalScheduler::new();
    for comp in &netlist.components {
        if comp.comp_type.ends_with("_gate") {
            let is_not = comp.comp_type == "not_gate";
            let po = if is_not { 1 } else { 2 };
            // Estado inicial LOW por defecto
            ms_scheduler.set_state(&comp.id, po, false);
            // Inicializar voltajes de entrada analógicos pasados en el scheduler
            ms_scheduler
                .last_analog_v
                .entry(comp.id.clone())
                .or_default()
                .insert(0, 0.0);
            if !is_not {
                ms_scheduler
                    .last_analog_v
                    .get_mut(&comp.id)
                    .unwrap()
                    .insert(1, 0.0);
            }
        } else if comp.comp_type == "arduino_uno"
            || comp.comp_type == "esp32"
            || comp.comp_type == "raspberry_pi_pico"
        {
            // Salida digital inicial LOW (pin_idx = 1 es output)
            ms_scheduler.set_state(&comp.id, 1, false);
            // Schedulizar el primer McuPeriodicTick a t = 0.0
            ms_scheduler.schedule_event(MixedSignalEvent {
                time: 0.0,
                component_id: comp.id.clone(),
                event_type: MixedSignalEventType::McuPeriodicTick,
            });
        }
    }

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
    let mut local_overrides: HashMap<String, HashMap<String, f64>> = HashMap::new();

    // Iterar en el tiempo de forma dinámica
    while t <= t_max {
        // Drenar mutaciones en caliente hacia el mapa local de overrides
        if let Some(ref queue) = live_overrides {
            if let Ok(mut guard) = queue.lock() {
                for mutation in take_live_mutations(&mut guard, live_run_id) {
                    local_overrides
                        .entry(mutation.component_id)
                        .or_default()
                        .insert(mutation.field, mutation.value);
                }
            }
        }

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

        // Aplicar overrides sobre la matriz y vector clonados (resistor DC, fuente DC)
        for (comp_id, fields) in &local_overrides {
            if let Some(&new_val) = fields.get("value") {
                if let Some(comp) = netlist.components.iter().find(|c| c.id == *comp_id) {
                    match comp.comp_type.as_str() {
                        "resistor" => {
                            if comp.value > 0.0 && new_val > 0.0 {
                                let g_old = 1.0 / comp.value;
                                let g_new = 1.0 / new_val;
                                let dg = g_new - g_old;
                                let node_a = comp.pins[0].parse::<usize>().unwrap_or(0);
                                let node_b = comp.pins[1].parse::<usize>().unwrap_or(0);
                                if node_a > 0 {
                                    matrix_a[(node_a - 1, node_a - 1)] += dg;
                                }
                                if node_b > 0 {
                                    matrix_a[(node_b - 1, node_b - 1)] += dg;
                                }
                                if node_a > 0 && node_b > 0 {
                                    matrix_a[(node_a - 1, node_b - 1)] -= dg;
                                    matrix_a[(node_b - 1, node_a - 1)] -= dg;
                                }
                            }
                        }
                        "vsource" => {
                            if comp.wave_type.is_none() {
                                if let Some(&vs_idx) = vsource_map.get(comp_id) {
                                    let diff = new_val - comp.value;
                                    vector_z[n + vs_idx] += diff;
                                }
                            }
                        }
                        "isource" => {
                            if comp.wave_type.is_none() {
                                let node_pos = comp.pins[0].parse::<usize>().unwrap_or(0);
                                let node_neg = comp.pins[1].parse::<usize>().unwrap_or(0);
                                let diff = new_val - comp.value;
                                if node_pos > 0 {
                                    vector_z[node_pos - 1] -= diff;
                                }
                                if node_neg > 0 {
                                    vector_z[node_neg - 1] += diff;
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
        }

        // Actualizar fuentes de tensión dinámicas transitorias para el t actual
        for comp in &netlist.components {
            if comp.comp_type == "vsource" {
                let co = local_overrides.get(&comp.id);
                if let Some(ref wave) = comp.wave_type {
                    let amp = co
                        .and_then(|f| f.get("amplitude").copied())
                        .or(comp.amplitude)
                        .unwrap_or(0.0);
                    let freq = co
                        .and_then(|f| f.get("frequency").copied())
                        .or(comp.frequency)
                        .unwrap_or(1e3);
                    let offset = co
                        .and_then(|f| f.get("offset").copied())
                        .or(comp.offset)
                        .unwrap_or(0.0);
                    let duty = co
                        .and_then(|f| f.get("duty_cycle").copied())
                        .or(comp.duty_cycle)
                        .unwrap_or(0.5);
                    let v_base = co
                        .and_then(|f| f.get("value").copied())
                        .unwrap_or(comp.value);

                    let v_val = match wave.as_str() {
                        "sine" => offset + amp * (2.0 * std::f64::consts::PI * freq * t).sin(),
                        "square" => {
                            let period = 1.0 / freq;
                            let t_mod = t % period;
                            if t_mod < duty * period {
                                offset + amp
                            } else {
                                offset - amp
                            }
                        }
                        "pulse" => {
                            let period = 1.0 / freq;
                            let t_mod = t % period;
                            let pulse_width = duty * period;
                            if t_mod < pulse_width {
                                offset + amp
                            } else {
                                offset
                            }
                        }
                        _ => v_base,
                    };

                    let vs_idx = *vsource_map.get(&comp.id).unwrap();
                    vector_z[n + vs_idx] = v_val;
                }
            } else if comp.comp_type == "isource" {
                let co = local_overrides.get(&comp.id);
                if let Some(ref wave) = comp.wave_type {
                    let amp = co
                        .and_then(|f| f.get("amplitude").copied())
                        .or(comp.amplitude)
                        .unwrap_or(0.0);
                    let freq = co
                        .and_then(|f| f.get("frequency").copied())
                        .or(comp.frequency)
                        .unwrap_or(1e3);
                    let offset = co
                        .and_then(|f| f.get("offset").copied())
                        .or(comp.offset)
                        .unwrap_or(0.0);
                    let duty = co
                        .and_then(|f| f.get("duty_cycle").copied())
                        .or(comp.duty_cycle)
                        .unwrap_or(0.5);

                    let i_val = match wave.as_str() {
                        "sine" => offset + amp * (2.0 * std::f64::consts::PI * freq * t).sin(),
                        "square" => {
                            let period = 1.0 / freq;
                            let t_mod = t % period;
                            if t_mod < duty * period {
                                offset + amp
                            } else {
                                offset - amp
                            }
                        }
                        "pulse" => {
                            let period = 1.0 / freq;
                            let t_mod = t % period;
                            let pulse_width = duty * period;
                            if t_mod < pulse_width {
                                offset + amp
                            } else {
                                offset
                            }
                        }
                        _ => comp.value,
                    };

                    let node_pos = comp.pins[0].parse::<usize>().unwrap();
                    let node_neg = comp.pins[1].parse::<usize>().unwrap();
                    let static_val = comp.value;
                    let diff = i_val - static_val;
                    if node_pos > 0 {
                        vector_z[node_pos - 1] -= diff;
                    }
                    if node_neg > 0 {
                        vector_z[node_neg - 1] += diff;
                    }
                }
            }
        }

        // Actualizar estados congelados del switch usando voltajes del paso anterior convergido
        for comp in &netlist.components {
            if comp.comp_type == "switch" {
                let co = local_overrides.get(&comp.id);
                // Si hay override de switch_state, forzar estado sin pasar por histéresis
                if let Some(&forced) = co.and_then(|f| f.get("switch_state")) {
                    switch_states.insert(comp.id.clone(), forced >= 0.5);
                } else if let (Ok(node_a), Ok(node_b)) =
                    (comp.pins[0].parse::<usize>(), comp.pins[1].parse::<usize>())
                {
                    let v_a = if node_a > 0 {
                        current_solution[node_a - 1]
                    } else {
                        0.0
                    };
                    let v_b = if node_b > 0 {
                        current_solution[node_b - 1]
                    } else {
                        0.0
                    };
                    let v_ab = v_a - v_b;
                    let vth = co
                        .and_then(|f| f.get("switch_vth").copied())
                        .unwrap_or(comp.switch_vth.unwrap_or(0.5));
                    let vh = co
                        .and_then(|f| f.get("switch_vh").copied())
                        .unwrap_or(comp.switch_vh.unwrap_or(0.05));
                    let was_closed = switch_states.get(&comp.id).copied().unwrap_or(false);
                    let new_state = if !was_closed && v_ab > vth + vh / 2.0 {
                        true
                    } else if was_closed && v_ab < vth - vh / 2.0 {
                        false
                    } else {
                        was_closed
                    };
                    switch_states.insert(comp.id.clone(), new_state);
                }
            }
        }

        let stamp_companion_conductance =
            |matrix: &mut DMatrix<f64>, r: usize, c: usize, g: f64| {
                if r > 0 && c > 0 {
                    matrix[(r - 1, c - 1)] += g;
                }
            };

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

        // Estampar los modelos de integración acompañantes y compuertas lógicas Mixed-Signal
        for comp in &netlist.components {
            match comp.comp_type.as_str() {
                "capacitor" => {
                    let node_pos = comp.pins[0].parse::<usize>().unwrap();
                    let node_neg = comp.pins[1].parse::<usize>().unwrap();
                    let prev_vc = *cap_states.get(&comp.id).unwrap();

                    let (g_eq, i_eq) = if gear2_active_this_step {
                        let prev_prev_vc = *cap_states_prev.get(&comp.id).unwrap_or(&prev_vc);
                        let g = gear_a * comp.value;
                        let i = -comp.value * (gear_b * prev_vc + gear_c * prev_prev_vc);
                        (g, i)
                    } else if integration_method == "trap" {
                        let prev_ic = *cap_currents.get(&comp.id).unwrap_or(&0.0);
                        let g = 2.0 * comp.value / dt;
                        let i = -prev_ic - g * prev_vc;
                        (g, i)
                    } else {
                        let g = comp.value / dt;
                        let i = g * prev_vc;
                        (g, i)
                    };

                    stamp_companion_conductance(&mut matrix_a, node_pos, node_pos, g_eq);
                    stamp_companion_conductance(&mut matrix_a, node_neg, node_neg, g_eq);
                    stamp_companion_conductance(&mut matrix_a, node_pos, node_neg, -g_eq);
                    stamp_companion_conductance(&mut matrix_a, node_neg, node_pos, -g_eq);

                    if node_pos > 0 {
                        vector_z[node_pos - 1] += i_eq;
                    }
                    if node_neg > 0 {
                        vector_z[node_neg - 1] -= i_eq;
                    }
                }
                "inductor" => {
                    let is_coupled = if let Some(ref mutuals) = netlist.mutual_inductances {
                        mutuals
                            .iter()
                            .any(|m| m.l1_id == comp.id || m.l2_id == comp.id)
                    } else {
                        false
                    };
                    if is_coupled {
                        continue;
                    }

                    let node_pos = comp.pins[0].parse::<usize>().unwrap();
                    let node_neg = comp.pins[1].parse::<usize>().unwrap();
                    let prev_il = *ind_states.get(&comp.id).unwrap();

                    let (g_eq, i_eq) = if gear2_active_this_step {
                        let prev_prev_il = *ind_states_prev.get(&comp.id).unwrap_or(&prev_il);
                        let g = 1.0 / (gear_a * comp.value);
                        let i = -(gear_b / gear_a) * prev_il - (gear_c / gear_a) * prev_prev_il;
                        (g, i)
                    } else if integration_method == "trap" {
                        let g = dt / (2.0 * comp.value);
                        let prev_vl = *ind_voltages.get(&comp.id).unwrap_or(&0.0);
                        let i = prev_il + g * prev_vl;
                        (g, i)
                    } else {
                        let g = dt / comp.value;
                        let i = prev_il;
                        (g, i)
                    };

                    // Estampar conductancia equivalente + conductancia Gmin mínima en paralelo para evitar singularidad (Upgrade 5)
                    let g_tot = g_eq + 1e-12;

                    stamp_companion_conductance(&mut matrix_a, node_pos, node_pos, g_tot);
                    stamp_companion_conductance(&mut matrix_a, node_neg, node_neg, g_tot);
                    stamp_companion_conductance(&mut matrix_a, node_pos, node_neg, -g_tot);
                    stamp_companion_conductance(&mut matrix_a, node_neg, node_pos, -g_tot);

                    if node_pos > 0 {
                        vector_z[node_pos - 1] -= i_eq;
                    }
                    if node_neg > 0 {
                        vector_z[node_neg - 1] += i_eq;
                    }
                }
                // --- FASE 30: CO-SIMULACIÓN MIXED-SIGNAL DE EVENTOS DISCRETOS ---
                "and_gate" | "or_gate" | "not_gate" | "nand_gate" | "nor_gate" | "xor_gate" => {
                    let node_out = comp.pins[comp.pins.len() - 1].parse::<usize>().unwrap();
                    let mut inputs = Vec::new();
                    for i in 0..(comp.pins.len() - 1) {
                        let pin_in = comp.pins[i].parse::<usize>().unwrap();
                        let v_in = if pin_in > 0 {
                            current_solution[pin_in - 1]
                        } else {
                            0.0
                        };
                        inputs.push(v_in > 1.5); // Umbral de histéresis ideal 1.5 V
                    }

                    let out_high = match comp.comp_type.as_str() {
                        "and_gate" => inputs.iter().all(|&x| x),
                        "or_gate" => inputs.iter().any(|&x| x),
                        "not_gate" => !inputs.first().copied().unwrap_or(false),
                        "nand_gate" => !inputs.iter().all(|&x| x),
                        "nor_gate" => !inputs.iter().any(|&x| x),
                        "xor_gate" => inputs.iter().filter(|&&x| x).count() % 2 == 1,
                        _ => false,
                    };

                    // Equivalente Norton de interfaz D/A: R_out = 100 Ohm, V_out = 5V si High, 0V si Low
                    let r_out = 100.0;
                    let g_eq = 1.0 / r_out;
                    let i_eq = if out_high { 5.0 / r_out } else { 0.0 };

                    stamp_companion_conductance(&mut matrix_a, node_out, node_out, g_eq);
                    if node_out > 0 {
                        vector_z[node_out - 1] += i_eq;
                    }
                }
                "switch" => {
                    let co = local_overrides.get(&comp.id);
                    let node_a = comp.pins[0].parse::<usize>().unwrap();
                    let node_b = comp.pins[1].parse::<usize>().unwrap();
                    let ron = co
                        .and_then(|f| f.get("switch_ron").copied())
                        .unwrap_or(comp.switch_ron.unwrap_or(0.01));
                    let roff = co
                        .and_then(|f| f.get("switch_roff").copied())
                        .unwrap_or(comp.switch_roff.unwrap_or(1e9));
                    let is_closed = switch_states.get(&comp.id).copied().unwrap_or(false);
                    let conductance = 1.0 / if is_closed { ron } else { roff };
                    stamp_companion_conductance(&mut matrix_a, node_a, node_a, conductance);
                    stamp_companion_conductance(&mut matrix_a, node_b, node_b, conductance);
                    stamp_companion_conductance(&mut matrix_a, node_a, node_b, -conductance);
                    stamp_companion_conductance(&mut matrix_a, node_b, node_a, -conductance);
                }
                _ => {}
            }
        }

        // Estampar inductores acoplados (Inductancia Mutua K)
        if let Some(ref mutuals) = netlist.mutual_inductances {
            for k_comp in mutuals {
                if let (Some(l1), Some(l2)) = (
                    netlist.components.iter().find(|c| c.id == k_comp.l1_id),
                    netlist.components.iter().find(|c| c.id == k_comp.l2_id),
                ) {
                    let node_1pos = l1.pins[0].parse::<usize>().unwrap();
                    let node_1neg = l1.pins[1].parse::<usize>().unwrap();
                    let node_2pos = l2.pins[0].parse::<usize>().unwrap();
                    let node_2neg = l2.pins[1].parse::<usize>().unwrap();

                    let l1_val = l1.value;
                    let l2_val = l2.value;
                    let k = k_comp.k_coeff;

                    let m = k * (l1_val * l2_val).sqrt();
                    let delta = l1_val * l2_val - m * m;

                    if delta.abs() > 1e-30 {
                        let f_step = if gear2_active_this_step {
                            1.0 / gear_a
                        } else {
                            dt
                        };

                        let g11 = (f_step * l2_val) / delta;
                        let g22 = (f_step * l1_val) / delta;
                        let g12 = -(f_step * m) / delta;

                        // Estampar conductancias propias
                        let g11_tot = g11 + 1e-12;
                        stamp_companion_conductance(&mut matrix_a, node_1pos, node_1pos, g11_tot);
                        stamp_companion_conductance(&mut matrix_a, node_1neg, node_1neg, g11_tot);
                        stamp_companion_conductance(&mut matrix_a, node_1pos, node_1neg, -g11_tot);
                        stamp_companion_conductance(&mut matrix_a, node_1neg, node_1pos, -g11_tot);

                        let g22_tot = g22 + 1e-12;
                        stamp_companion_conductance(&mut matrix_a, node_2pos, node_2pos, g22_tot);
                        stamp_companion_conductance(&mut matrix_a, node_2neg, node_2neg, g22_tot);
                        stamp_companion_conductance(&mut matrix_a, node_2pos, node_2neg, -g22_tot);
                        stamp_companion_conductance(&mut matrix_a, node_2neg, node_2pos, -g22_tot);

                        // Estampar conductancia de acoplamiento cruzado G12
                        stamp_companion_conductance(&mut matrix_a, node_1pos, node_2pos, g12);
                        stamp_companion_conductance(&mut matrix_a, node_1neg, node_2neg, g12);
                        stamp_companion_conductance(&mut matrix_a, node_1pos, node_2neg, -g12);
                        stamp_companion_conductance(&mut matrix_a, node_1neg, node_2pos, -g12);

                        stamp_companion_conductance(&mut matrix_a, node_2pos, node_1pos, g12);
                        stamp_companion_conductance(&mut matrix_a, node_2neg, node_1neg, g12);
                        stamp_companion_conductance(&mut matrix_a, node_2pos, node_1neg, -g12);
                        stamp_companion_conductance(&mut matrix_a, node_2neg, node_1pos, -g12);

                        // Estampar fuentes de corriente equivalentes
                        let prev_il1 = *ind_states.get(&l1.id).unwrap_or(&0.0);
                        let prev_il2 = *ind_states.get(&l2.id).unwrap_or(&0.0);

                        let (i_eq1, i_eq2) = if gear2_active_this_step {
                            let prev_prev_il1 = *ind_states_prev.get(&l1.id).unwrap_or(&prev_il1);
                            let prev_prev_il2 = *ind_states_prev.get(&l2.id).unwrap_or(&prev_il2);
                            (
                                -(gear_b / gear_a) * prev_il1 - (gear_c / gear_a) * prev_prev_il1,
                                -(gear_b / gear_a) * prev_il2 - (gear_c / gear_a) * prev_prev_il2,
                            )
                        } else {
                            (prev_il1, prev_il2)
                        };

                        if node_1pos > 0 {
                            vector_z[node_1pos - 1] -= i_eq1;
                        }
                        if node_1neg > 0 {
                            vector_z[node_1neg - 1] += i_eq1;
                        }

                        if node_2pos > 0 {
                            vector_z[node_2pos - 1] -= i_eq2;
                        }
                        if node_2neg > 0 {
                            vector_z[node_2neg - 1] += i_eq2;
                        }
                    }
                }
            }
        }

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

            let mut ast_cache_t: HashMap<String, ExprAST> = HashMap::new();

            let mut solve_err = None;
            let mut lambda_backtrack = 1.0;
            let mut prev_max_diff = f64::MAX;

            for _iter in 0..max_iter {
                let mut matrix_a_iter = matrix_a.clone();
                let mut vector_z_iter = vector_z.clone();

                for comp in &netlist.components {
                    if comp.comp_type == "diode" || comp.comp_type == "led" {
                        let node_anode = comp.pins[0].parse::<usize>().unwrap();
                        let node_cathode = comp.pins[1].parse::<usize>().unwrap();

                        // Self-Heating: usar temperatura de unión per-device en lugar de T global
                        let tj_d = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                        let (vt_d, _is_d) = get_thermal_parameters_junction(tj_d, comp.diode_is);
                        let _comp_n = comp.diode_n.unwrap_or(DIODE_N);

                        let v_anode = if node_anode > 0 {
                            prev_v[node_anode]
                        } else {
                            0.0
                        };
                        let v_cathode = if node_cathode > 0 {
                            prev_v[node_cathode]
                        } else {
                            0.0
                        };

                        let vd_new = v_anode - v_cathode;

                        let v_anode_old = if node_anode > 0 {
                            prev_prev_v[node_anode]
                        } else {
                            0.0
                        };
                        let v_cathode_old = if node_cathode > 0 {
                            prev_prev_v[node_cathode]
                        } else {
                            0.0
                        };
                        let vd_old = v_anode_old - v_cathode_old;

                        let vd = pnjlim(vd_new, vd_old, vt_d, 0.6);

                        let (_, id, geq) = solve_diode_junction_voltage(vd, Some(tj_d), comp);
                        let ieq = id - geq * vd;

                        // Estampar capacidad dinámica del diodo (difusión + deplexión) utilizando modelo cuasi-estático
                        let v_anode_prev = if node_anode > 0 {
                            current_solution[node_anode - 1]
                        } else {
                            0.0
                        };
                        let v_cathode_prev = if node_cathode > 0 {
                            current_solution[node_cathode - 1]
                        } else {
                            0.0
                        };
                        let vd_prev = v_anode_prev - v_cathode_prev;

                        let (vd_prev_j, _, geq_prev_int) =
                            solve_diode_junction_voltage(vd_prev, Some(tj_d), comp);
                        let rs = comp.diode_rs.unwrap_or(0.0);
                        let gd_prev = if rs > 0.0 {
                            let factor = 1.0 - geq_prev_int * rs;
                            if factor > 1e-6 {
                                geq_prev_int / factor
                            } else {
                                geq_prev_int
                            }
                        } else {
                            geq_prev_int
                        };
                        let c_d = get_diode_capacitance_param(vd_prev_j, gd_prev, comp);
                        let g_eq_d = c_d / dt;
                        let i_eq_cd = g_eq_d * vd_prev;

                        let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                            if r > 0 && c > 0 {
                                matrix_a_iter[(r - 1, c - 1)] += g;
                            }
                        };

                        stamp_conductance(node_anode, node_anode, geq + g_eq_d);
                        stamp_conductance(node_cathode, node_cathode, geq + g_eq_d);
                        stamp_conductance(node_anode, node_cathode, -geq - g_eq_d);
                        stamp_conductance(node_cathode, node_anode, -geq - g_eq_d);

                        if node_anode > 0 {
                            vector_z_iter[node_anode - 1] -= ieq - i_eq_cd;
                        }
                        if node_cathode > 0 {
                            vector_z_iter[node_cathode - 1] += ieq - i_eq_cd;
                        }
                    } else if comp.comp_type == "opto" {
                        if comp.pins.len() < 4 {
                            continue;
                        }
                        let node_a = comp.pins[0].parse::<usize>().unwrap();
                        let node_k = comp.pins[1].parse::<usize>().unwrap();
                        let node_c = comp.pins[2].parse::<usize>().unwrap();
                        let node_e = comp.pins[3].parse::<usize>().unwrap();

                        // Self-Heating: el opto comparte un único nodo térmico (DIP-4)
                        let tj_o = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                        let (vt_o, _is_o) = get_thermal_parameters_junction(tj_o, comp.opto_is);

                        let v_a = if node_a > 0 { prev_v[node_a] } else { 0.0 };
                        let v_k = if node_k > 0 { prev_v[node_k] } else { 0.0 };
                        let v_c = if node_c > 0 { prev_v[node_c] } else { 0.0 };
                        let v_e = if node_e > 0 { prev_v[node_e] } else { 0.0 };

                        let vd_new = v_a - v_k;
                        let vd_old = (if node_a > 0 { prev_prev_v[node_a] } else { 0.0 })
                            - (if node_k > 0 { prev_prev_v[node_k] } else { 0.0 });
                        let vd = pnjlim(vd_new, vd_old, vt_o, 0.6);
                        let (_, id_led, gd_led) =
                            solve_diode_junction_voltage(vd, Some(tj_o), comp);
                        let ieq_led = id_led - gd_led * vd;

                        let v_ce = v_c - v_e;
                        let (_i_ce, g_md, g_o, i_ce_eq) =
                            evaluate_opto_receiver(vd, gd_led, id_led, v_ce, comp);

                        let mut stamp = |r: usize, c: usize, g: f64| {
                            if r > 0 && c > 0 {
                                matrix_a_iter[(r - 1, c - 1)] += g;
                            }
                        };

                        // Lado LED
                        stamp(node_a, node_a, gd_led);
                        stamp(node_k, node_k, gd_led);
                        stamp(node_a, node_k, -gd_led);
                        stamp(node_k, node_a, -gd_led);
                        if node_a > 0 {
                            vector_z_iter[node_a - 1] -= ieq_led;
                        }
                        if node_k > 0 {
                            vector_z_iter[node_k - 1] += ieq_led;
                        }

                        // Lado receptor
                        stamp(node_c, node_a, g_md);
                        stamp(node_c, node_k, -g_md);
                        stamp(node_c, node_c, g_o);
                        stamp(node_c, node_e, -g_o);
                        stamp(node_e, node_a, -g_md);
                        stamp(node_e, node_k, g_md);
                        stamp(node_e, node_c, -g_o);
                        stamp(node_e, node_e, g_o);
                        if node_c > 0 {
                            vector_z_iter[node_c - 1] -= i_ce_eq;
                        }
                        if node_e > 0 {
                            vector_z_iter[node_e - 1] += i_ce_eq;
                        }
                    } else if comp.comp_type == "nmos"
                        || comp.comp_type == "bsim3nmos"
                        || comp.comp_type == "bsim4nmos"
                    {
                        let node_gate = comp.pins[0].parse::<usize>().unwrap();
                        let node_drain = comp.pins[1].parse::<usize>().unwrap();
                        let node_source = comp.pins[2].parse::<usize>().unwrap();
                        let node_bulk = if comp.pins.len() >= 4 {
                            comp.pins[3].parse::<usize>().unwrap_or(0)
                        } else {
                            0
                        };

                        let v_gate = if node_gate > 0 {
                            prev_v[node_gate]
                        } else {
                            0.0
                        };
                        let v_drain = if node_drain > 0 {
                            prev_v[node_drain]
                        } else {
                            0.0
                        };
                        let v_source = if node_source > 0 {
                            prev_v[node_source]
                        } else {
                            0.0
                        };
                        let v_bulk = if node_bulk > 0 {
                            prev_v[node_bulk]
                        } else {
                            0.0
                        };

                        let vgs = v_gate - v_source;
                        let mut vds = v_drain - v_source;
                        if vds < 0.0 {
                            vds = 0.0;
                        }
                        let vbs = v_bulk - v_source;

                        // Self-Heating: Vth y Kn dependen de la temperatura de unión
                        let tj_m = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                        let vth_0 = comp.value;
                        let vth = vth_0 + MOS_VTH_TC * (tj_m - PHYS_T);
                        let kn_0 = 0.02;
                        let kn = kn_0 * (tj_m / PHYS_T).powf(MOS_MOBILITY_EXPO);
                        let lambda = 0.02;
                        let vt = (PHYS_KB * tj_m) / PHYS_Q;

                        let (ids, gm, gds, igs, gg) = if comp.comp_type == "bsim4nmos" {
                            evaluate_bsim4_nmos(vgs, vds, vbs, comp.value, comp.w, comp.l)
                        } else if comp.comp_type == "bsim3nmos" {
                            let (ids_v, gm_v, gds_v) = evaluate_bsim3_nmos(
                                vgs,
                                vds,
                                vbs,
                                comp.value,
                                comp.w,
                                comp.l,
                                None,
                                Some(comp),
                            );
                            (ids_v, gm_v, gds_v, 0.0, 1e-12)
                        } else if vgs <= vth {
                            let i_sub0 = 1e-7;
                            let n_factor = 1.5;
                            let exp_sub = ((vgs - vth) / (n_factor * vt)).exp();
                            let exp_vds = (-vds.max(0.0) / vt).exp();
                            let sub_factor = 1.0 - exp_vds;

                            let ids_val = i_sub0 * exp_sub * sub_factor * (1.0 + lambda * vds);
                            let gm_val = ids_val / (n_factor * vt);
                            let gds_val = i_sub0
                                * exp_sub
                                * ((exp_vds / vt) * (1.0 + lambda * vds) + sub_factor * lambda);

                            (ids_val, gm_val, gds_val.max(1e-9), 0.0, 1e-12)
                        } else if vds < vgs - vth {
                            // Región de Triodo con canal corto
                            let factor_early = 1.0 + lambda * vds;
                            let triode_curr = kn * (2.0 * (vgs - vth) * vds - vds * vds);

                            let ids_val = triode_curr * factor_early;
                            let gm_val = (2.0 * kn * vds) * factor_early;
                            let gds_val = (2.0 * kn * (vgs - vth - vds)) * factor_early
                                + triode_curr * lambda;

                            (ids_val, gm_val, gds_val.max(1e-9), 0.0, 1e-12)
                        } else {
                            // Región de Saturación con canal corto
                            let factor_early = 1.0 + lambda * vds;
                            let sat_curr = kn * (vgs - vth) * (vgs - vth);

                            let ids_val = sat_curr * factor_early;
                            let gm_val = (2.0 * kn * (vgs - vth)) * factor_early;
                            let gds_val = sat_curr * lambda;

                            (ids_val, gm_val, gds_val.max(1e-9), 0.0, 1e-12)
                        };

                        let ieq = ids - gm * vgs - gds * vds;
                        let ieq_g = igs - gg * vgs;

                        // Estampar capacidades parásitas (Fase 13)
                        let (c_gs, c_gd, c_ds) =
                            get_nmos_capacitances(vgs, vds, vth, comp.w, comp.l);
                        let g_eq_gs = c_gs / dt;
                        let g_eq_gd = c_gd / dt;
                        let g_eq_ds = c_ds / dt;

                        let v_gate_prev = if node_gate > 0 {
                            current_solution[node_gate - 1]
                        } else {
                            0.0
                        };
                        let v_drain_prev = if node_drain > 0 {
                            current_solution[node_drain - 1]
                        } else {
                            0.0
                        };
                        let v_source_prev = if node_source > 0 {
                            current_solution[node_source - 1]
                        } else {
                            0.0
                        };
                        let vgs_prev = v_gate_prev - v_source_prev;
                        let vgd_prev = v_gate_prev - v_drain_prev;
                        let vds_prev = v_drain_prev - v_source_prev;

                        let i_eq_gs = g_eq_gs * vgs_prev;
                        let i_eq_gd = g_eq_gd * vgd_prev;
                        let i_eq_ds = g_eq_ds * vds_prev;

                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_drain,
                            node_drain,
                            gds + g_eq_gd + g_eq_ds,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_source,
                            node_source,
                            gds + g_eq_gs + g_eq_ds + gg,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_drain,
                            node_source,
                            -gds - g_eq_ds,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_source,
                            node_drain,
                            -gds - g_eq_ds,
                        );

                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_gate,
                            node_gate,
                            g_eq_gs + g_eq_gd + gg,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_gate,
                            node_source,
                            -g_eq_gs - gg,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_source,
                            node_gate,
                            -g_eq_gs - gg,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_gate,
                            node_drain,
                            -g_eq_gd,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_drain,
                            node_gate,
                            -g_eq_gd,
                        );

                        if node_drain > 0 {
                            if node_gate > 0 {
                                matrix_a_iter[(node_drain - 1, node_gate - 1)] += gm;
                            }
                            if node_source > 0 {
                                matrix_a_iter[(node_drain - 1, node_source - 1)] -= gm;
                            }
                        }
                        if node_source > 0 {
                            if node_gate > 0 {
                                matrix_a_iter[(node_source - 1, node_gate - 1)] -= gm;
                            }
                            if node_source > 0 {
                                matrix_a_iter[(node_source - 1, node_source - 1)] += gm;
                            }
                        }

                        if node_drain > 0 {
                            vector_z_iter[node_drain - 1] -= ieq - i_eq_gd - i_eq_ds;
                        }
                        if node_source > 0 {
                            vector_z_iter[node_source - 1] += ieq + i_eq_gs + i_eq_ds + ieq_g;
                        }
                        if node_gate > 0 {
                            vector_z_iter[node_gate - 1] += i_eq_gs + i_eq_gd - ieq_g;
                        }
                    } else if comp.comp_type == "pmos"
                        || comp.comp_type == "bsim3pmos"
                        || comp.comp_type == "bsim4pmos"
                    {
                        let node_gate = comp.pins[0].parse::<usize>().unwrap();
                        let node_drain = comp.pins[1].parse::<usize>().unwrap();
                        let node_source = comp.pins[2].parse::<usize>().unwrap();
                        let node_bulk = if comp.pins.len() >= 4 {
                            comp.pins[3].parse::<usize>().unwrap_or(0)
                        } else {
                            0
                        };

                        let v_gate = if node_gate > 0 {
                            prev_v[node_gate]
                        } else {
                            0.0
                        };
                        let v_drain = if node_drain > 0 {
                            prev_v[node_drain]
                        } else {
                            0.0
                        };
                        let v_source = if node_source > 0 {
                            prev_v[node_source]
                        } else {
                            0.0
                        };
                        let v_bulk = if node_bulk > 0 {
                            prev_v[node_bulk]
                        } else {
                            0.0
                        };

                        let vsg = v_source - v_gate;
                        let vsd = (v_source - v_drain).max(0.0);
                        let vsb = v_source - v_bulk;
                        let lambda = 0.02;

                        // Self-Heating: Vth y Kp dependen de la temperatura de unión
                        let tj_p = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                        let vth_0 = if comp.value == 0.0 { -1.5 } else { comp.value };
                        let vth_abs = -(vth_0 + MOS_VTH_TC * (tj_p - PHYS_T));
                        let kp_0 = 0.02;
                        let kp = kp_0 * (tj_p / PHYS_T).powf(MOS_MOBILITY_EXPO);
                        let vt = (PHYS_KB * tj_p) / PHYS_Q;

                        let (isd, gm_sd, gds_cond, igs, gg) = if comp.comp_type == "bsim4pmos" {
                            evaluate_bsim4_pmos(vsg, vsd, vsb, comp.value, comp.w, comp.l)
                        } else if comp.comp_type == "bsim3pmos" {
                            let (isd_v, gm_v, gds_v) = evaluate_bsim3_pmos(
                                vsg,
                                vsd,
                                vsb,
                                comp.value,
                                comp.w,
                                comp.l,
                                None,
                                Some(comp),
                            );
                            (isd_v, gm_v, gds_v, 0.0, 1e-12)
                        } else if vsg <= vth_abs {
                            // Conducción débil subumbral (weak inversion) PMOS
                            let i_sub0 = 1e-7;
                            let n_factor = 1.5;
                            let exp_sub = ((vsg - vth_abs) / (n_factor * vt)).exp();
                            let exp_vsd = (-vsd.max(0.0) / vt).exp();
                            let sub_factor = 1.0 - exp_vsd;

                            let isd_val = i_sub0 * exp_sub * sub_factor * (1.0 + lambda * vsd);
                            let gm_sd_val = isd_val / (n_factor * vt);
                            let gds_cond_val = i_sub0
                                * exp_sub
                                * ((exp_vsd / vt) * (1.0 + lambda * vsd) + sub_factor * lambda);

                            (isd_val, gm_sd_val, gds_cond_val.max(1e-9), 0.0, 1e-12)
                        } else if vsd < vsg - vth_abs {
                            // Triodo PMOS con canal corto
                            let factor_early = 1.0 + lambda * vsd;
                            let triode_curr = kp * (2.0 * (vsg - vth_abs) * vsd - vsd * vsd);

                            let isd_val = triode_curr * factor_early;
                            let gm_sd_val = (2.0 * kp * vsd) * factor_early;
                            let gds_cond_val = (2.0 * kp * (vsg - vth_abs - vsd)) * factor_early
                                + triode_curr * lambda;

                            (isd_val, gm_sd_val, gds_cond_val.max(1e-9), 0.0, 1e-12)
                        } else {
                            // Saturación PMOS con canal corto
                            let factor_early = 1.0 + lambda * vsd;
                            let sat_curr = kp * (vsg - vth_abs) * (vsg - vth_abs);

                            let isd_val = sat_curr * factor_early;
                            let gm_sd_val = (2.0 * kp * (vsg - vth_abs)) * factor_early;
                            let gds_cond_val = sat_curr * lambda;

                            (isd_val, gm_sd_val, gds_cond_val.max(1e-9), 0.0, 1e-12)
                        };

                        let ieq_sd = isd - gm_sd * vsg - gds_cond * vsd;
                        let ieq_g = igs - gg * vsg;

                        // Estampar capacidades parásitas (Fase 13)
                        let (c_sg, c_sd, c_gd) =
                            get_pmos_capacitances(vsg, vsd, vth_abs, comp.w, comp.l);
                        let g_eq_sg = c_sg / dt;
                        let g_eq_sd = c_sd / dt;
                        let g_eq_gd = c_gd / dt;

                        let v_gate_prev = if node_gate > 0 {
                            current_solution[node_gate - 1]
                        } else {
                            0.0
                        };
                        let v_drain_prev = if node_drain > 0 {
                            current_solution[node_drain - 1]
                        } else {
                            0.0
                        };
                        let v_source_prev = if node_source > 0 {
                            current_solution[node_source - 1]
                        } else {
                            0.0
                        };
                        let vsg_prev = v_source_prev - v_gate_prev;
                        let vsd_prev = v_source_prev - v_drain_prev;
                        let vgd_prev = v_drain_prev - v_gate_prev;

                        let i_eq_sg = g_eq_sg * vsg_prev;
                        let i_eq_sd = g_eq_sd * vsd_prev;
                        let i_eq_gd = g_eq_gd * vgd_prev;

                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_source,
                            node_source,
                            gds_cond + g_eq_sg + g_eq_sd + gg,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_drain,
                            node_drain,
                            gds_cond + g_eq_gd + g_eq_sd,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_source,
                            node_drain,
                            -gds_cond - g_eq_sd,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_drain,
                            node_source,
                            -gds_cond - g_eq_sd,
                        );

                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_gate,
                            node_gate,
                            g_eq_sg + g_eq_gd + gg,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_gate,
                            node_source,
                            -g_eq_sg - gg,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_source,
                            node_gate,
                            -g_eq_sg - gg,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_gate,
                            node_drain,
                            -g_eq_gd,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_drain,
                            node_gate,
                            -g_eq_gd,
                        );

                        if node_drain > 0 {
                            if node_source > 0 {
                                matrix_a_iter[(node_drain - 1, node_source - 1)] -= gm_sd;
                            }
                            if node_gate > 0 {
                                matrix_a_iter[(node_drain - 1, node_gate - 1)] += gm_sd;
                            }
                        }
                        if node_source > 0 {
                            if node_source > 0 {
                                matrix_a_iter[(node_source - 1, node_source - 1)] += gm_sd;
                            }
                            if node_gate > 0 {
                                matrix_a_iter[(node_source - 1, node_gate - 1)] -= gm_sd;
                            }
                        }

                        if node_drain > 0 {
                            vector_z_iter[node_drain - 1] += ieq_sd + i_eq_gd + i_eq_sd;
                        }
                        if node_source > 0 {
                            vector_z_iter[node_source - 1] -= ieq_sd - i_eq_sg - i_eq_sd - ieq_g;
                        }
                        if node_gate > 0 {
                            vector_z_iter[node_gate - 1] += i_eq_sg + i_eq_gd + ieq_g;
                        }
                    } else if comp.comp_type == "npn" || comp.comp_type == "pnp" {
                        let is_npn = comp.comp_type == "npn";
                        let node_base = comp.pins[0].parse::<usize>().unwrap();
                        let node_collector = comp.pins[1].parse::<usize>().unwrap();
                        let node_emitter = comp.pins[2].parse::<usize>().unwrap();

                        // Self-Heating: Is, Vt y β dependen de la temperatura de unión
                        let tj_b = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                        let (vt_b, is_b) = get_thermal_parameters_junction(tj_b, comp.bjt_is);
                        let beta_scale = (tj_b / PHYS_T).powf(BJT_BETA_EXPO);

                        let v_base = if node_base > 0 {
                            prev_v[node_base]
                        } else {
                            0.0
                        };
                        let v_collector = if node_collector > 0 {
                            prev_v[node_collector]
                        } else {
                            0.0
                        };
                        let v_emitter = if node_emitter > 0 {
                            prev_v[node_emitter]
                        } else {
                            0.0
                        };

                        let (vbe_new_raw, vbc_new_raw) = if is_npn {
                            (v_base - v_emitter, v_base - v_collector)
                        } else {
                            (v_emitter - v_base, v_collector - v_base)
                        };

                        let v_base_old = if node_base > 0 {
                            prev_prev_v[node_base]
                        } else {
                            0.0
                        };
                        let v_collector_old = if node_collector > 0 {
                            prev_prev_v[node_collector]
                        } else {
                            0.0
                        };
                        let v_emitter_old = if node_emitter > 0 {
                            prev_prev_v[node_emitter]
                        } else {
                            0.0
                        };

                        let (vbe_old_raw, vbc_old_raw) = if is_npn {
                            (v_base_old - v_emitter_old, v_base_old - v_collector_old)
                        } else {
                            (v_emitter_old - v_base_old, v_collector_old - v_base_old)
                        };

                        let beta_f_base = comp.bjt_bf.unwrap_or(if comp.value <= 1.0 {
                            100.0
                        } else {
                            comp.value
                        });
                        let beta_f = beta_f_base * beta_scale;
                        let beta_r = 1.0;
                        let alpha_f = beta_f / (beta_f + 1.0);
                        let alpha_r = beta_r / (beta_r + 1.0);

                        // Estimar corrientes de base y colector de la iteración previa para calcular caídas óhmicas
                        // Damping preliminar de voltajes previos para cálculo seguro sin desbordamiento
                        let vbe_prev_safe = pnjlim(vbe_old_raw, vbe_old_raw, vt_b, 0.6).min(0.95);
                        let vbc_prev_safe = pnjlim(vbc_old_raw, vbc_old_raw, vt_b, 0.6).min(0.95);

                        let exp_be_old = (vbe_prev_safe / vt_b).exp();
                        let exp_bc_old = (vbc_prev_safe / vt_b).exp();
                        let ide_old = is_b * (exp_be_old - 1.0);
                        let idc_old = is_b * (exp_bc_old - 1.0);

                        // Clampear corrientes previas a rangos físicos seguros para evitar oscilación numérica salvaje
                        let ib_prev = (ide_old / (beta_f + 1.0) + idc_old / (beta_r + 1.0))
                            .clamp(-0.01, 0.01);
                        let ic_prev = (alpha_f * ide_old - idc_old).clamp(-0.1, 0.1);

                        let r_b = comp.bjt_rb.unwrap_or(10.0);
                        let r_c = comp.bjt_rc.unwrap_or(2.0);

                        let vbe_new = vbe_new_raw - ib_prev * r_b;
                        let vbc_new = vbc_new_raw - ic_prev * r_c;
                        let vbe_old = vbe_old_raw - ib_prev * r_b;
                        let vbc_old = vbc_old_raw - ic_prev * r_c;

                        // Damping logarítmico suave (pnjlim) (Upgrade 4)
                        let vbe = pnjlim(vbe_new, vbe_old, vt_b, 0.6);
                        let vbc = pnjlim(vbc_new, vbc_old, vt_b, 0.6);

                        // Multiplicador de Efecto Early directo en activo (Upgrade 3)
                        let vce = if is_npn {
                            v_collector - v_emitter
                        } else {
                            v_emitter - v_collector
                        };
                        let v_af = comp.bjt_vaf.unwrap_or(if is_npn { 100.0 } else { 50.0 });
                        let k_early = 1.0 + vce.max(0.0) / v_af;

                        let (ide_raw, gbe_raw, _ieq_be_raw) = evaluate_pn_junction(vbe, vt_b, is_b);
                        let ide = ide_raw * k_early;
                        let gbe = gbe_raw * k_early;
                        let ieq_be = ide - gbe * vbe;

                        let (idc_raw, gbc_raw, _ieq_bc_raw) = evaluate_pn_junction(vbc, vt_b, is_b);
                        let idc = idc_raw * k_early;
                        let gbc = gbc_raw * k_early;
                        let ieq_bc = idc - gbc * vbc;

                        let g_be_b = gbe / (beta_f + 1.0);
                        let g_bc_b = gbc / (beta_r + 1.0);
                        let ieq_b = ieq_be / (beta_f + 1.0) + ieq_bc / (beta_r + 1.0);

                        let ieq_c = alpha_f * ieq_be - ieq_bc;
                        let ieq_e = ieq_be - alpha_r * ieq_bc;

                        // Estampar capacidades parásitas dinámicas del BJT (Fase 16)
                        let c_be = get_bjt_be_capacitance(vbe, gbe, comp);
                        let c_bc = get_bjt_bc_capacitance(vbc, gbc, comp);
                        let g_eq_be = c_be / dt;
                        let g_eq_bc = c_bc / dt;

                        let v_base_prev = if node_base > 0 {
                            current_solution[node_base - 1]
                        } else {
                            0.0
                        };
                        let v_collector_prev = if node_collector > 0 {
                            current_solution[node_collector - 1]
                        } else {
                            0.0
                        };
                        let v_emitter_prev = if node_emitter > 0 {
                            current_solution[node_emitter - 1]
                        } else {
                            0.0
                        };

                        let vbe_prev = if is_npn {
                            v_base_prev - v_emitter_prev
                        } else {
                            v_emitter_prev - v_base_prev
                        };
                        let vbc_prev = if is_npn {
                            v_base_prev - v_collector_prev
                        } else {
                            v_collector_prev - v_base_prev
                        };

                        let i_eq_be = g_eq_be * vbe_prev;
                        let i_eq_bc = g_eq_bc * vbc_prev;

                        if is_npn {
                            stamp_companion_conductance(
                                &mut matrix_a_iter,
                                node_base,
                                node_base,
                                g_be_b + g_bc_b,
                            );
                            stamp_companion_conductance(
                                &mut matrix_a_iter,
                                node_base,
                                node_emitter,
                                -g_be_b,
                            );
                            stamp_companion_conductance(
                                &mut matrix_a_iter,
                                node_base,
                                node_collector,
                                -g_bc_b,
                            );
                            if node_base > 0 {
                                vector_z_iter[node_base - 1] -= ieq_b;
                            }

                            if node_collector > 0 {
                                if node_base > 0 {
                                    matrix_a_iter[(node_collector - 1, node_base - 1)] +=
                                        alpha_f * gbe - gbc;
                                }
                                if node_emitter > 0 {
                                    matrix_a_iter[(node_collector - 1, node_emitter - 1)] -=
                                        alpha_f * gbe;
                                }
                                matrix_a_iter[(node_collector - 1, node_collector - 1)] += gbc;
                                vector_z_iter[node_collector - 1] -= ieq_c;
                            }

                            if node_emitter > 0 {
                                if node_base > 0 {
                                    matrix_a_iter[(node_emitter - 1, node_base - 1)] -=
                                        gbe - alpha_r * gbc;
                                }
                                matrix_a_iter[(node_emitter - 1, node_emitter - 1)] += gbe;
                                if node_collector > 0 {
                                    matrix_a_iter[(node_emitter - 1, node_collector - 1)] -=
                                        alpha_r * gbc;
                                }
                                vector_z_iter[node_emitter - 1] += ieq_e;
                            }

                            // Estampado reactivo parásito BE y BC NPN
                            stamp_companion_conductance(
                                &mut matrix_a_iter,
                                node_base,
                                node_base,
                                g_eq_be + g_eq_bc,
                            );
                            stamp_companion_conductance(
                                &mut matrix_a_iter,
                                node_emitter,
                                node_emitter,
                                g_eq_be,
                            );
                            stamp_companion_conductance(
                                &mut matrix_a_iter,
                                node_collector,
                                node_collector,
                                g_eq_bc,
                            );
                            stamp_companion_conductance(
                                &mut matrix_a_iter,
                                node_base,
                                node_emitter,
                                -g_eq_be,
                            );
                            stamp_companion_conductance(
                                &mut matrix_a_iter,
                                node_emitter,
                                node_base,
                                -g_eq_be,
                            );
                            stamp_companion_conductance(
                                &mut matrix_a_iter,
                                node_base,
                                node_collector,
                                -g_eq_bc,
                            );
                            stamp_companion_conductance(
                                &mut matrix_a_iter,
                                node_collector,
                                node_base,
                                -g_eq_bc,
                            );

                            if node_base > 0 {
                                vector_z_iter[node_base - 1] += i_eq_be + i_eq_bc;
                            }
                            if node_emitter > 0 {
                                vector_z_iter[node_emitter - 1] -= i_eq_be;
                            }
                            if node_collector > 0 {
                                vector_z_iter[node_collector - 1] -= i_eq_bc;
                            }
                        } else {
                            stamp_companion_conductance(
                                &mut matrix_a_iter,
                                node_base,
                                node_base,
                                g_be_b + g_bc_b,
                            );
                            stamp_companion_conductance(
                                &mut matrix_a_iter,
                                node_base,
                                node_emitter,
                                -g_be_b,
                            );
                            stamp_companion_conductance(
                                &mut matrix_a_iter,
                                node_base,
                                node_collector,
                                -g_bc_b,
                            );
                            if node_base > 0 {
                                vector_z_iter[node_base - 1] += ieq_b;
                            }

                            if node_collector > 0 {
                                if node_base > 0 {
                                    matrix_a_iter[(node_collector - 1, node_base - 1)] +=
                                        alpha_f * gbe - gbc;
                                }
                                if node_emitter > 0 {
                                    matrix_a_iter[(node_collector - 1, node_emitter - 1)] -=
                                        alpha_f * gbe;
                                }
                                matrix_a_iter[(node_collector - 1, node_collector - 1)] += gbc;
                                vector_z_iter[node_collector - 1] += ieq_c;
                            }

                            if node_emitter > 0 {
                                if node_base > 0 {
                                    matrix_a_iter[(node_emitter - 1, node_base - 1)] -=
                                        gbe - alpha_r * gbc;
                                }
                                matrix_a_iter[(node_emitter - 1, node_emitter - 1)] += gbe;
                                if node_collector > 0 {
                                    matrix_a_iter[(node_emitter - 1, node_collector - 1)] -=
                                        alpha_r * gbc;
                                }
                                vector_z_iter[node_emitter - 1] += ieq_e;
                            }

                            // Estampado reactivo parásito BE y BC PNP
                            stamp_companion_conductance(
                                &mut matrix_a_iter,
                                node_base,
                                node_base,
                                g_eq_be + g_eq_bc,
                            );
                            stamp_companion_conductance(
                                &mut matrix_a_iter,
                                node_emitter,
                                node_emitter,
                                g_eq_be,
                            );
                            stamp_companion_conductance(
                                &mut matrix_a_iter,
                                node_collector,
                                node_collector,
                                g_eq_bc,
                            );
                            stamp_companion_conductance(
                                &mut matrix_a_iter,
                                node_base,
                                node_emitter,
                                -g_eq_be,
                            );
                            stamp_companion_conductance(
                                &mut matrix_a_iter,
                                node_emitter,
                                node_base,
                                -g_eq_be,
                            );
                            stamp_companion_conductance(
                                &mut matrix_a_iter,
                                node_base,
                                node_collector,
                                -g_eq_bc,
                            );
                            stamp_companion_conductance(
                                &mut matrix_a_iter,
                                node_collector,
                                node_base,
                                -g_eq_bc,
                            );

                            if node_base > 0 {
                                vector_z_iter[node_base - 1] -= i_eq_be + i_eq_bc;
                            }
                            if node_emitter > 0 {
                                vector_z_iter[node_emitter - 1] += i_eq_be;
                            }
                            if node_collector > 0 {
                                vector_z_iter[node_collector - 1] += i_eq_bc;
                            }
                        }
                    } else if comp.comp_type == "njf" || comp.comp_type == "pjf" {
                        let is_njf = comp.comp_type == "njf";
                        let node_drain = comp.pins[0].parse::<usize>().unwrap();
                        let node_gate = comp.pins[1].parse::<usize>().unwrap();
                        let node_source = comp.pins[2].parse::<usize>().unwrap();

                        let v_drain = if node_drain > 0 {
                            prev_v[node_drain]
                        } else {
                            0.0
                        };
                        let v_gate = if node_gate > 0 {
                            prev_v[node_gate]
                        } else {
                            0.0
                        };
                        let v_source = if node_source > 0 {
                            prev_v[node_source]
                        } else {
                            0.0
                        };

                        let vto = comp.jfet_vto.unwrap_or(if is_njf { -2.0 } else { 2.0 });
                        let beta = comp.jfet_beta.unwrap_or(1e-3);
                        let lambda = comp.jfet_lambda.unwrap_or(0.0);

                        let (vgs_raw, vds_raw, factor_pol) = if is_njf {
                            (v_gate - v_source, v_drain - v_source, 1.0)
                        } else {
                            (v_source - v_gate, v_source - v_drain, -1.0)
                        };

                        let mut vgs = vgs_raw;
                        let mut vds = vds_raw;
                        let mut swapped = false;
                        if vds < 0.0 {
                            vds = -vds;
                            vgs = if is_njf {
                                v_gate - v_drain
                            } else {
                                v_drain - v_gate
                            };
                            swapped = true;
                        }

                        let vgst = if is_njf { vgs - vto } else { vto - vgs };
                        let (ids, gm, gds) = if vgst <= 0.0 {
                            (0.0, 0.0, 1e-9)
                        } else if vds < vgst {
                            let ids_val = beta * vds * (2.0 * vgst - vds) * (1.0 + lambda * vds);
                            let gm_val = 2.0 * beta * vds * (1.0 + lambda * vds);
                            let gds_val = beta
                                * ((2.0 * vgst - 2.0 * vds) * (1.0 + lambda * vds)
                                    + vds * (2.0 * vgst - vds) * lambda);
                            (ids_val, gm_val, gds_val.max(1e-9))
                        } else {
                            let ids_val = beta * vgst * vgst * (1.0 + lambda * vds);
                            let gm_val = 2.0 * beta * vgst * (1.0 + lambda * vds);
                            let gds_val = beta * vgst * vgst * lambda;
                            (ids_val, gm_val, gds_val.max(1e-9))
                        };

                        let (ids_eff, gm_eff, gds_eff) = if swapped {
                            (-ids, -gm, gds)
                        } else {
                            (ids, gm, gds)
                        };

                        let ids_final = ids_eff * factor_pol;
                        let gm_final = gm_eff * factor_pol;
                        let gds_final = gds_eff;

                        let ieq = ids_final - gm_final * vgs_raw - gds_final * vds_raw;

                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_drain,
                            node_drain,
                            gds_final,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_source,
                            node_source,
                            gds_final,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_drain,
                            node_source,
                            -gds_final,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_source,
                            node_drain,
                            -gds_final,
                        );

                        if node_drain > 0 {
                            if node_gate > 0 {
                                matrix_a_iter[(node_drain - 1, node_gate - 1)] += gm_final;
                            }
                            if node_source > 0 {
                                matrix_a_iter[(node_drain - 1, node_source - 1)] -= gm_final;
                            }
                        }
                        if node_source > 0 {
                            if node_gate > 0 {
                                matrix_a_iter[(node_source - 1, node_gate - 1)] -= gm_final;
                            }
                            if node_source > 0 {
                                matrix_a_iter[(node_source - 1, node_source - 1)] += gm_final;
                            }
                        }

                        if node_drain > 0 {
                            vector_z_iter[node_drain - 1] -= ieq;
                        }
                        if node_source > 0 {
                            vector_z_iter[node_source - 1] += ieq;
                        }

                        // Estampar capacitancias dinámicas de puerta GS y GD
                        let vgd_raw = v_gate - v_drain;
                        let (c_gs, c_gd) = get_jfet_capacitances(vgs_raw, vgd_raw, comp);
                        let g_eq_gs = c_gs / dt;
                        let g_eq_gd = c_gd / dt;

                        let v_drain_prev = if node_drain > 0 {
                            current_solution[node_drain - 1]
                        } else {
                            0.0
                        };
                        let v_gate_prev = if node_gate > 0 {
                            current_solution[node_gate - 1]
                        } else {
                            0.0
                        };
                        let v_source_prev = if node_source > 0 {
                            current_solution[node_source - 1]
                        } else {
                            0.0
                        };

                        let vgs_prev = v_gate_prev - v_source_prev;
                        let vgd_prev = v_gate_prev - v_drain_prev;

                        let i_eq_gs = g_eq_gs * vgs_prev;
                        let i_eq_gd = g_eq_gd * vgd_prev;

                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_gate,
                            node_gate,
                            g_eq_gs + g_eq_gd,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_gate,
                            node_source,
                            -g_eq_gs,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_source,
                            node_gate,
                            -g_eq_gs,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_source,
                            node_source,
                            g_eq_gs,
                        );

                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_gate,
                            node_drain,
                            -g_eq_gd,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_drain,
                            node_gate,
                            -g_eq_gd,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_drain,
                            node_drain,
                            g_eq_gd,
                        );

                        if node_gate > 0 {
                            vector_z_iter[node_gate - 1] += i_eq_gs + i_eq_gd;
                        }
                        if node_source > 0 {
                            vector_z_iter[node_source - 1] -= i_eq_gs;
                        }
                        if node_drain > 0 {
                            vector_z_iter[node_drain - 1] -= i_eq_gd;
                        }

                        // Fuga de compuerta en transitorio (utilizando t_amb para calcular vt local)
                        let vt_local = (8.617333262e-5 * t_amb) / 1.0; // k_B * T / q
                        let gate_is = 1e-14;
                        let exp_gs = ((v_gate - v_source) / vt_local).exp();
                        let gg_gs = (gate_is / vt_local) * exp_gs;
                        let ieq_gs_d = gate_is * (exp_gs - 1.0) - gg_gs * (v_gate - v_source);

                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_gate,
                            node_gate,
                            gg_gs,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_source,
                            node_source,
                            gg_gs,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_gate,
                            node_source,
                            -gg_gs,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_source,
                            node_gate,
                            -gg_gs,
                        );
                        if node_gate > 0 {
                            vector_z_iter[node_gate - 1] -= ieq_gs_d;
                        }
                        if node_source > 0 {
                            vector_z_iter[node_source - 1] += ieq_gs_d;
                        }

                        let exp_gd = ((v_gate - v_drain) / vt_local).exp();
                        let gg_gd = (gate_is / vt_local) * exp_gd;
                        let ieq_gd_d = gate_is * (exp_gd - 1.0) - gg_gd * (v_gate - v_drain);

                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_gate,
                            node_gate,
                            gg_gd,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_drain,
                            node_drain,
                            gg_gd,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_gate,
                            node_drain,
                            -gg_gd,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            node_drain,
                            node_gate,
                            -gg_gd,
                        );
                        if node_gate > 0 {
                            vector_z_iter[node_gate - 1] -= ieq_gd_d;
                        }
                        if node_drain > 0 {
                            vector_z_iter[node_drain - 1] += ieq_gd_d;
                        }
                    } else if comp.comp_type == "opamp" {
                        let pin_in_pos = comp.pins[0].parse::<usize>().unwrap();
                        let pin_in_neg = comp.pins[1].parse::<usize>().unwrap();
                        let pin_vplus = comp.pins[2].parse::<usize>().unwrap();
                        let pin_vminus = comp.pins[3].parse::<usize>().unwrap();
                        let pin_out = comp.pins[4].parse::<usize>().unwrap();

                        let v_in_pos = if pin_in_pos > 0 {
                            prev_v[pin_in_pos]
                        } else {
                            0.0
                        };
                        let v_in_neg = if pin_in_neg > 0 {
                            prev_v[pin_in_neg]
                        } else {
                            0.0
                        };
                        let v_vplus = if pin_vplus > 0 {
                            prev_v[pin_vplus]
                        } else {
                            15.0
                        };
                        let v_vminus = if pin_vminus > 0 {
                            prev_v[pin_vminus]
                        } else {
                            -15.0
                        };

                        let v_diff = v_in_pos - v_in_neg;
                        let mut v_span = v_vplus - v_vminus;
                        let mut v_mid = 0.5 * (v_vplus + v_vminus);

                        if v_span.abs() < 1e-3 {
                            v_span = 30.0;
                            v_mid = 0.0;
                        }

                        let a_ol = 1e5;
                        let r_in = 1e7;
                        let r_out = 100.0;
                        let g_out = 1.0 / r_out;
                        let g_in = 1.0 / r_in;

                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            pin_in_pos,
                            pin_in_pos,
                            g_in,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            pin_in_neg,
                            pin_in_neg,
                            g_in,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            pin_in_pos,
                            pin_in_neg,
                            -g_in,
                        );
                        stamp_companion_conductance(
                            &mut matrix_a_iter,
                            pin_in_neg,
                            pin_in_pos,
                            -g_in,
                        );

                        let arg = (a_ol * v_diff) / v_span;
                        let tanh_val = arg.tanh();
                        let v_int_ctrl = v_mid + 0.5 * v_span * tanh_val;
                        let g_m_int = 0.5 * a_ol * (1.0 - tanh_val * tanh_val);
                        let g_m_opamp = g_out * g_m_int;
                        let ieq = g_out * v_int_ctrl - g_m_opamp * v_diff;

                        if pin_out > 0 {
                            matrix_a_iter[(pin_out - 1, pin_out - 1)] += g_out;
                            if pin_in_pos > 0 {
                                matrix_a_iter[(pin_out - 1, pin_in_pos - 1)] -= g_m_opamp;
                            }
                            if pin_in_neg > 0 {
                                matrix_a_iter[(pin_out - 1, pin_in_neg - 1)] += g_m_opamp;
                            }
                            vector_z_iter[pin_out - 1] += ieq;
                        }
                    } else if comp.comp_type.ends_with("_gate") {
                        let is_not = comp.comp_type == "not_gate";
                        let (_pin_in_a, _pin_in_b, pin_out) = if is_not {
                            let pa = comp.pins[0].parse::<usize>().unwrap_or(0);
                            let po = comp.pins[1].parse::<usize>().unwrap_or(0);
                            (pa, 0, po)
                        } else {
                            let pa = comp.pins[0].parse::<usize>().unwrap_or(0);
                            let pb = comp.pins[1].parse::<usize>().unwrap_or(0);
                            let po = comp.pins[2].parse::<usize>().unwrap_or(0);
                            (pa, pb, po)
                        };

                        let out_pin_idx = if is_not { 1 } else { 2 };
                        let state_out = ms_scheduler.get_state(&comp.id, out_pin_idx);
                        let v_oh = 5.0;
                        let v_out_ideal = if state_out { v_oh } else { 0.0 };

                        let r_out = 50.0;
                        let g_out = 1.0 / r_out;
                        let ieq = v_out_ideal / r_out;

                        if pin_out > 0 {
                            matrix_a_iter[(pin_out - 1, pin_out - 1)] += g_out;
                            vector_z_iter[pin_out - 1] += ieq;
                        }
                    } else if (comp.comp_type == "arduino_uno"
                        || comp.comp_type == "esp32"
                        || comp.comp_type == "raspberry_pi_pico")
                        && comp.pins.len() >= 6
                    {
                        let pin_in = comp.pins[0].parse::<usize>().unwrap_or(0);
                        let pin_out = comp.pins[1].parse::<usize>().unwrap_or(0);
                        let pin_adc = comp.pins[2].parse::<usize>().unwrap_or(0);
                        let pin_dac = comp.pins[3].parse::<usize>().unwrap_or(0);
                        let pin_vcc = comp.pins[4].parse::<usize>().unwrap_or(0);
                        let pin_gnd = comp.pins[5].parse::<usize>().unwrap_or(0);

                        let v_cc = match comp.comp_type.as_str() {
                            "arduino_uno" => 5.0,
                            "esp32" | "raspberry_pi_pico" => 3.3,
                            _ => 5.0,
                        };

                        let g_in = 1e-7;
                        let stamp_g = |matrix: &mut DMatrix<f64>, r: usize, c: usize, g: f64| {
                            if r > 0 && c > 0 {
                                matrix[(r - 1, c - 1)] += g;
                            }
                        };

                        stamp_g(&mut matrix_a_iter, pin_in, pin_in, g_in);
                        stamp_g(&mut matrix_a_iter, pin_gnd, pin_gnd, g_in);
                        stamp_g(&mut matrix_a_iter, pin_in, pin_gnd, -g_in);
                        stamp_g(&mut matrix_a_iter, pin_gnd, pin_in, -g_in);

                        stamp_g(&mut matrix_a_iter, pin_adc, pin_adc, g_in);
                        stamp_g(&mut matrix_a_iter, pin_gnd, pin_gnd, g_in);
                        stamp_g(&mut matrix_a_iter, pin_adc, pin_gnd, -g_in);
                        stamp_g(&mut matrix_a_iter, pin_gnd, pin_adc, -g_in);

                        let i_baseline = match comp.comp_type.as_str() {
                            "arduino_uno" => 0.015,
                            "esp32" => 0.060,
                            "raspberry_pi_pico" => 0.025,
                            _ => 0.015,
                        };
                        let g_vcc = 10.0;
                        let i_vcc_eq = g_vcc * v_cc - i_baseline;

                        stamp_g(&mut matrix_a_iter, pin_vcc, pin_vcc, g_vcc);
                        stamp_g(&mut matrix_a_iter, pin_gnd, pin_gnd, g_vcc);
                        stamp_g(&mut matrix_a_iter, pin_vcc, pin_gnd, -g_vcc);
                        stamp_g(&mut matrix_a_iter, pin_gnd, pin_vcc, -g_vcc);

                        if pin_vcc > 0 {
                            vector_z_iter[pin_vcc - 1] += i_vcc_eq;
                        }
                        if pin_gnd > 0 {
                            vector_z_iter[pin_gnd - 1] -= i_vcc_eq;
                        }

                        let v_dac_eff = *mcu_vdaceff.get(&comp.id).unwrap_or(&0.0);
                        let g_dac = 0.01;
                        let i_dac_eq = v_dac_eff * g_dac;

                        stamp_g(&mut matrix_a_iter, pin_dac, pin_dac, g_dac);
                        stamp_g(&mut matrix_a_iter, pin_gnd, pin_gnd, g_dac);
                        stamp_g(&mut matrix_a_iter, pin_dac, pin_gnd, -g_dac);
                        stamp_g(&mut matrix_a_iter, pin_gnd, pin_dac, -g_dac);

                        if pin_dac > 0 {
                            vector_z_iter[pin_dac - 1] += i_dac_eq;
                        }
                        if pin_gnd > 0 {
                            vector_z_iter[pin_gnd - 1] -= i_dac_eq;
                        }

                        let state_out = ms_scheduler.get_state(&comp.id, 1);
                        let v_target_out = if state_out { v_cc } else { 0.0 };
                        let g_out = 0.05;
                        let i_stamp_out = v_target_out * g_out;

                        stamp_g(&mut matrix_a_iter, pin_out, pin_out, g_out);
                        stamp_g(&mut matrix_a_iter, pin_gnd, pin_gnd, g_out);
                        stamp_g(&mut matrix_a_iter, pin_out, pin_gnd, -g_out);
                        stamp_g(&mut matrix_a_iter, pin_gnd, pin_out, -g_out);

                        if pin_out > 0 {
                            vector_z_iter[pin_out - 1] += i_stamp_out;
                        }
                        if pin_gnd > 0 {
                            vector_z_iter[pin_gnd - 1] -= i_stamp_out;
                        }
                    }
                }

                // B-Sources dinámicas en transitorio
                // B-Sources dinámicas en transitorio con diferenciación automática
                for comp_bs in &netlist.components {
                    if comp_bs.comp_type == "bvoltage" {
                        if let Some(ref expr_str) = comp_bs.expression {
                            let _node_pos_t = comp_bs.pins[0].parse::<usize>().unwrap_or(0);
                            let _node_neg_t = comp_bs.pins[1].parse::<usize>().unwrap_or(0);
                            let mut nv = HashMap::new();
                            nv.insert("0".to_string(), 0.0);
                            for i in 1..=n {
                                nv.insert(i.to_string(), prev_v[i]);
                            }
                            let mut bc = HashMap::new();
                            for (sid, &sidx) in vsource_map.iter() {
                                bc.insert(sid.clone(), solution_iter[n + sidx]);
                            }
                            if let Ok(ad) =
                                evaluate_expression_ad(expr_str, &nv, &bc, t, &mut ast_cache_t)
                            {
                                let vs_idx = *vsource_map.get(&comp_bs.id).unwrap();
                                let col = n + vs_idx;
                                let mut ieq = ad.value;
                                for (&node_idx, &dv_dvx) in &ad.grad {
                                    let v_k = if node_idx > 0 { prev_v[node_idx] } else { 0.0 };
                                    ieq -= dv_dvx * v_k;
                                    if col < size && node_idx > 0 {
                                        matrix_a_iter[(col, node_idx - 1)] += -dv_dvx;
                                    }
                                }
                                vector_z_iter[col] = ieq;
                            }
                        }
                    } else if comp_bs.comp_type == "bcurrent" {
                        if let Some(ref expr_str) = comp_bs.expression {
                            let node_pos = comp_bs.pins[0].parse::<usize>().unwrap_or(0);
                            let node_neg = comp_bs.pins[1].parse::<usize>().unwrap_or(0);
                            let mut nv = HashMap::new();
                            nv.insert("0".to_string(), 0.0);
                            for i in 1..=n {
                                nv.insert(i.to_string(), prev_v[i]);
                            }
                            let mut bc = HashMap::new();
                            for (sid, &sidx) in vsource_map.iter() {
                                bc.insert(sid.clone(), solution_iter[n + sidx]);
                            }
                            if let Ok(ad) =
                                evaluate_expression_ad(expr_str, &nv, &bc, t, &mut ast_cache_t)
                            {
                                let mut ieq = ad.value;
                                for (&node_idx, &di_dv) in &ad.grad {
                                    let v_k = if node_idx > 0 { prev_v[node_idx] } else { 0.0 };
                                    ieq -= di_dv * v_k;
                                    if node_idx > 0 {
                                        if node_pos > 0 {
                                            matrix_a_iter[(node_pos - 1, node_idx - 1)] += di_dv;
                                        }
                                        if node_neg > 0 {
                                            matrix_a_iter[(node_neg - 1, node_idx - 1)] += -di_dv;
                                        }
                                    }
                                }
                                if node_pos > 0 {
                                    vector_z_iter[node_pos - 1] -= ieq;
                                }
                                if node_neg > 0 {
                                    vector_z_iter[node_neg - 1] += ieq;
                                }
                            }
                        }
                    }
                }

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
            let mut lte_max = 0.0;
            let mut integrator_order = 1.0;

            if !is_fixed && steps_completed >= 2 {
                if integration_method == "trap" && steps_completed >= 3 {
                    integrator_order = 2.0;
                    // TRAP: LTE depende de la tercera derivada (requiere 4 puntos)
                    for i in 1..=n {
                        let v_n = step_solution[i - 1];
                        let v_n1 = sol_n[i - 1];
                        let v_n2 = sol_n1[i - 1];
                        let v_n3 = sol_n2[i - 1];

                        let d3_val = (v_n - 3.0 * v_n1 + 3.0 * v_n2 - v_n3) / (dt * dt * dt);
                        let lte_node = (1.0 / 12.0) * (dt * dt * dt) * d3_val.abs();

                        if lte_node > lte_max {
                            lte_max = lte_node;
                        }
                    }
                } else if integration_method == "gear2" && steps_completed >= 3 {
                    integrator_order = 2.0;
                    // GEAR-2: LTE depende de la tercera derivada
                    for i in 1..=n {
                        let v_n = step_solution[i - 1];
                        let v_n1 = sol_n[i - 1];
                        let v_n2 = sol_n1[i - 1];
                        let v_n3 = sol_n2[i - 1];

                        let d3_val = (v_n - 3.0 * v_n1 + 3.0 * v_n2 - v_n3) / (dt * dt * dt);
                        let lte_node = (2.0 / 9.0) * (dt * dt * dt) * d3_val.abs();

                        if lte_node > lte_max {
                            lte_max = lte_node;
                        }
                    }
                } else {
                    integrator_order = 1.0;
                    // Euler/Gear2 (inicial): LTE depende de la segunda derivada
                    for i in 1..=n {
                        let v_n = step_solution[i - 1];
                        let v_n1 = sol_n[i - 1];
                        let v_n2 = sol_n1[i - 1];
                        let d1 = (v_n - v_n1) / dt;
                        let d2 = (v_n1 - v_n2) / prev_dt;

                        let d2_val = 2.0 * (d1 - d2) / (dt + prev_dt);
                        let lte_node = 0.5 * dt * dt * d2_val.abs();

                        if lte_node > lte_max {
                            lte_max = lte_node;
                        }
                    }
                }
            }

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
                    for comp in &netlist.components {
                        if comp.comp_type == "capacitor" {
                            let node_pos = comp.pins[0].parse::<usize>().unwrap();
                            let node_neg = comp.pins[1].parse::<usize>().unwrap();
                            let v_pos = if node_pos > 0 {
                                step_solution[node_pos - 1]
                            } else {
                                0.0
                            };
                            let v_neg = if node_neg > 0 {
                                step_solution[node_neg - 1]
                            } else {
                                0.0
                            };
                            let prev_vc = *cap_states.get(&comp.id).unwrap_or(&0.0);
                            let v_c_new = v_pos - v_neg;
                            let prev_ic = *cap_currents.get(&comp.id).unwrap_or(&0.0);
                            let i_c = (2.0 * comp.value / dt) * (v_c_new - prev_vc) - prev_ic;
                            cap_currents.insert(comp.id.clone(), i_c);
                        } else if comp.comp_type == "inductor" {
                            let node_pos = comp.pins[0].parse::<usize>().unwrap();
                            let node_neg = comp.pins[1].parse::<usize>().unwrap();
                            let v_pos = if node_pos > 0 {
                                step_solution[node_pos - 1]
                            } else {
                                0.0
                            };
                            let v_neg = if node_neg > 0 {
                                step_solution[node_neg - 1]
                            } else {
                                0.0
                            };
                            let v_l = v_pos - v_neg;
                            let prev_il = *ind_states.get(&comp.id).unwrap();
                            let prev_vl = *ind_voltages.get(&comp.id).unwrap_or(&0.0);
                            let new_il = prev_il + (dt / (2.0 * comp.value)) * (v_l + prev_vl);
                            ind_states_prev.insert(comp.id.clone(), prev_il);
                            ind_states.insert(comp.id.clone(), new_il);
                            ind_voltages.insert(comp.id.clone(), v_l);
                        }
                    }
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

                // --- DETECCION DE CRUCE DE UMBRALES Y EVENTOS DIGITALES ---
                for comp in &netlist.components {
                    if comp.comp_type.ends_with("_gate") {
                        let is_not = comp.comp_type == "not_gate";
                        let (pin_in_a, pin_in_b, _) = if is_not {
                            let pa = comp.pins[0].parse::<usize>().unwrap_or(0);
                            (pa, 0, 0)
                        } else {
                            let pa = comp.pins[0].parse::<usize>().unwrap_or(0);
                            let pb = comp.pins[1].parse::<usize>().unwrap_or(0);
                            (pa, pb, 0)
                        };

                        let v_a_curr = if pin_in_a > 0 {
                            step_solution[pin_in_a - 1]
                        } else {
                            0.0
                        };
                        let v_b_curr = if pin_in_b > 0 {
                            step_solution[pin_in_b - 1]
                        } else {
                            0.0
                        };

                        let (v_a_prev, v_b_prev) =
                            if let Some(last_v) = ms_scheduler.last_analog_v.get(&comp.id) {
                                (
                                    *last_v.get(&0).unwrap_or(&0.0),
                                    *last_v.get(&1).unwrap_or(&0.0),
                                )
                            } else {
                                (0.0, 0.0)
                            };

                        let state_a_prev = ms_scheduler.get_state(&comp.id, 0);
                        let th_a = if state_a_prev {
                            comp.gate_vlow.unwrap_or(1.5)
                        } else {
                            comp.gate_vhigh.unwrap_or(1.5)
                        };

                        // Check input A crossing
                        let crossed_a = if state_a_prev {
                            v_a_curr < th_a
                        } else {
                            v_a_curr >= th_a
                        };

                        if crossed_a {
                            let t_cross = if (v_a_curr - v_a_prev).abs() > 1e-12 {
                                t + dt * ((th_a - v_a_prev) / (v_a_curr - v_a_prev))
                            } else {
                                t
                            };
                            let dir = !state_a_prev;
                            ms_scheduler.schedule_event(MixedSignalEvent {
                                time: t_cross,
                                component_id: comp.id.clone(),
                                event_type: MixedSignalEventType::LogicInputCrossing {
                                    pin_idx: 0,
                                    direction: dir,
                                },
                            });
                        }

                        // Check input B crossing
                        if !is_not {
                            let state_b_prev = ms_scheduler.get_state(&comp.id, 1);
                            let th_b = if state_b_prev {
                                comp.gate_vlow.unwrap_or(1.5)
                            } else {
                                comp.gate_vhigh.unwrap_or(1.5)
                            };
                            let crossed_b = if state_b_prev {
                                v_b_curr < th_b
                            } else {
                                v_b_curr >= th_b
                            };
                            if crossed_b {
                                let t_cross = if (v_b_curr - v_b_prev).abs() > 1e-12 {
                                    t + dt * ((th_b - v_b_prev) / (v_b_curr - v_b_prev))
                                } else {
                                    t
                                };
                                let dir = !state_b_prev;
                                ms_scheduler.schedule_event(MixedSignalEvent {
                                    time: t_cross,
                                    component_id: comp.id.clone(),
                                    event_type: MixedSignalEventType::LogicInputCrossing {
                                        pin_idx: 1,
                                        direction: dir,
                                    },
                                });
                            }
                        }

                        let last_v = ms_scheduler
                            .last_analog_v
                            .entry(comp.id.clone())
                            .or_default();
                        last_v.insert(0, v_a_curr);
                        if !is_not {
                            last_v.insert(1, v_b_curr);
                        }
                    } else if (comp.comp_type == "arduino_uno"
                        || comp.comp_type == "esp32"
                        || comp.comp_type == "raspberry_pi_pico")
                        && comp.pins.len() >= 6
                    {
                        let pin_adc = comp.pins[2].parse::<usize>().unwrap_or(0);
                        let pin_gnd = comp.pins[5].parse::<usize>().unwrap_or(0);
                        let v_gnd_val = if pin_gnd > 0 {
                            step_solution[pin_gnd - 1]
                        } else {
                            0.0
                        };
                        let v_adc_val = if pin_adc > 0 {
                            step_solution[pin_adc - 1]
                        } else {
                            0.0
                        };
                        let v_adc_diff = v_adc_val - v_gnd_val;

                        let v_adc_prev =
                            if let Some(last_v) = ms_scheduler.last_analog_v.get(&comp.id) {
                                *last_v.get(&2).unwrap_or(&0.0)
                            } else {
                                0.0
                            };

                        let v_cc = match comp.comp_type.as_str() {
                            "arduino_uno" => 5.0,
                            _ => 3.3,
                        };
                        let threshold = 0.5 * v_cc;

                        let crossed_adc = (v_adc_prev < threshold && v_adc_diff >= threshold)
                            || (v_adc_prev >= threshold && v_adc_diff < threshold);
                        if crossed_adc {
                            let t_cross = if (v_adc_diff - v_adc_prev).abs() > 1e-12 {
                                t + dt * ((threshold - v_adc_prev) / (v_adc_diff - v_adc_prev))
                            } else {
                                t
                            };
                            let dir = v_adc_diff >= threshold;
                            ms_scheduler.schedule_event(MixedSignalEvent {
                                time: t_cross,
                                component_id: comp.id.clone(),
                                event_type: MixedSignalEventType::LogicInputCrossing {
                                    pin_idx: 2,
                                    direction: dir,
                                },
                            });
                        }
                        ms_scheduler
                            .last_analog_v
                            .entry(comp.id.clone())
                            .or_default()
                            .insert(2, v_adc_diff);
                    }
                }

                // --- PROCESAR EVENTOS DE LA COLA QUE OCURRIERON HASTA EL MOMENTO t ACTUAL ---
                while let Some(next_t) = ms_scheduler.get_next_event_time() {
                    if next_t <= t + dt + 1e-9 {
                        let event = ms_scheduler.events.remove(0);
                        match event.event_type {
                            MixedSignalEventType::LogicInputCrossing { pin_idx, direction } => {
                                let comp = netlist
                                    .components
                                    .iter()
                                    .find(|c| c.id == event.component_id)
                                    .unwrap();
                                if comp.comp_type.ends_with("_gate") {
                                    let is_not = comp.comp_type == "not_gate";
                                    let out_pin_idx = if is_not { 1 } else { 2 };

                                    ms_scheduler.set_state(&comp.id, pin_idx, direction);

                                    let val_a = ms_scheduler.get_state(&comp.id, 0);
                                    let val_b = if is_not {
                                        false
                                    } else {
                                        ms_scheduler.get_state(&comp.id, 1)
                                    };

                                    let logic_out = match comp.comp_type.as_str() {
                                        "and_gate" => val_a && val_b,
                                        "or_gate" => val_a || val_b,
                                        "not_gate" => !val_a,
                                        "nand_gate" => !(val_a && val_b),
                                        "nor_gate" => !(val_a || val_b),
                                        "xor_gate" => val_a ^ val_b,
                                        _ => false,
                                    };

                                    let gate_delay = if logic_out {
                                        comp.rise_delay.or(comp.delay).unwrap_or(10e-9)
                                    } else {
                                        comp.fall_delay.or(comp.delay).unwrap_or(10e-9)
                                    };

                                    ms_scheduler.schedule_event(MixedSignalEvent {
                                        time: event.time + gate_delay,
                                        component_id: comp.id.clone(),
                                        event_type: MixedSignalEventType::LogicOutputTransition {
                                            pin_idx: out_pin_idx,
                                            new_state: logic_out,
                                        },
                                    });
                                } else if comp.comp_type == "arduino_uno"
                                    || comp.comp_type == "esp32"
                                    || comp.comp_type == "raspberry_pi_pico"
                                {
                                    let mode = comp.value as i32;
                                    if mode == 2 && pin_idx == 2 {
                                        ms_scheduler.schedule_event(MixedSignalEvent {
                                            time: event.time + 10e-9,
                                            component_id: comp.id.clone(),
                                            event_type:
                                                MixedSignalEventType::LogicOutputTransition {
                                                    pin_idx: 1,
                                                    new_state: direction,
                                                },
                                        });
                                    }
                                }
                            }
                            MixedSignalEventType::LogicOutputTransition { pin_idx, new_state } => {
                                ms_scheduler.set_state(&event.component_id, pin_idx, new_state);
                            }
                            MixedSignalEventType::McuPeriodicTick => {
                                let comp = netlist
                                    .components
                                    .iter()
                                    .find(|c| c.id == event.component_id)
                                    .unwrap();
                                let mode = comp.value as i32;
                                if mode == 1 {
                                    let state_out = (event.time % 1.0) < 0.5;
                                    ms_scheduler.schedule_event(MixedSignalEvent {
                                        time: event.time + 10e-9,
                                        component_id: comp.id.clone(),
                                        event_type: MixedSignalEventType::LogicOutputTransition {
                                            pin_idx: 1,
                                            new_state: state_out,
                                        },
                                    });
                                }

                                ms_scheduler.schedule_event(MixedSignalEvent {
                                    time: event.time + 100e-6,
                                    component_id: comp.id.clone(),
                                    event_type: MixedSignalEventType::McuPeriodicTick,
                                });
                            }
                        }
                    } else {
                        break;
                    }
                }

                // --- ACTUALIZAR DEFINITIVAMENTE LOS HISTÓRICOS DE ESTADO ---
                for comp in &netlist.components {
                    match comp.comp_type.as_str() {
                        "capacitor" => {
                            let node_pos = comp.pins[0].parse::<usize>().unwrap();
                            let node_neg = comp.pins[1].parse::<usize>().unwrap();

                            let v_pos = if node_pos > 0 {
                                step_solution[node_pos - 1]
                            } else {
                                0.0
                            };
                            let v_neg = if node_neg > 0 {
                                step_solution[node_neg - 1]
                            } else {
                                0.0
                            };

                            let new_vc = v_pos - v_neg;
                            let prev_vc = *cap_states.get(&comp.id).unwrap_or(&0.0);
                            cap_states_prev.insert(comp.id.clone(), prev_vc);
                            cap_states.insert(comp.id.clone(), new_vc);
                        }
                        "inductor" => {
                            let is_coupled = if let Some(ref mutuals) = netlist.mutual_inductances {
                                mutuals
                                    .iter()
                                    .any(|m| m.l1_id == comp.id || m.l2_id == comp.id)
                            } else {
                                false
                            };
                            if is_coupled {
                                continue;
                            }
                            if integration_method == "trap" {
                                continue; // Already updated in TRAP block above
                            }

                            let node_pos = comp.pins[0].parse::<usize>().unwrap();
                            let node_neg = comp.pins[1].parse::<usize>().unwrap();

                            let v_pos = if node_pos > 0 {
                                step_solution[node_pos - 1]
                            } else {
                                0.0
                            };
                            let v_neg = if node_neg > 0 {
                                step_solution[node_neg - 1]
                            } else {
                                0.0
                            };

                            let new_vl = v_pos - v_neg;
                            let prev_il = *ind_states.get(&comp.id).unwrap();
                            let prev_prev_il = *ind_states_prev.get(&comp.id).unwrap_or(&prev_il);

                            let new_il = if gear2_active_this_step {
                                let g_eq = 1.0 / (gear_a * comp.value);
                                let i_eq_val =
                                    -(gear_b / gear_a) * prev_il - (gear_c / gear_a) * prev_prev_il;
                                g_eq * new_vl + i_eq_val
                            } else {
                                (dt / comp.value) * new_vl + prev_il
                            };

                            ind_states_prev.insert(comp.id.clone(), prev_il);
                            ind_states.insert(comp.id.clone(), new_il);
                        }
                        "arduino_uno" | "esp32" | "raspberry_pi_pico" if comp.pins.len() >= 6 => {
                            let _pin_in = comp.pins[0].parse::<usize>().unwrap_or(0);
                            let pin_out = comp.pins[1].parse::<usize>().unwrap_or(0);
                            let pin_adc = comp.pins[2].parse::<usize>().unwrap_or(0);
                            let pin_dac = comp.pins[3].parse::<usize>().unwrap_or(0);
                            let pin_vcc = comp.pins[4].parse::<usize>().unwrap_or(0);
                            let pin_gnd = comp.pins[5].parse::<usize>().unwrap_or(0);

                            let v_cc = match comp.comp_type.as_str() {
                                "arduino_uno" => 5.0,
                                "esp32" | "raspberry_pi_pico" => 3.3,
                                _ => 5.0,
                            };

                            let mode = comp.value as i32;

                            // Leer voltajes del paso aceptado
                            let v_vcc_val = if pin_vcc > 0 {
                                step_solution[pin_vcc - 1]
                            } else {
                                0.0
                            };
                            let v_gnd_val = if pin_gnd > 0 {
                                step_solution[pin_gnd - 1]
                            } else {
                                0.0
                            };
                            let v_vcc_diff = v_vcc_val - v_gnd_val;

                            let v_adc_val = if pin_adc > 0 {
                                step_solution[pin_adc - 1]
                            } else {
                                0.0
                            };
                            let v_adc_diff = v_adc_val - v_gnd_val;

                            let v_out_val = if pin_out > 0 {
                                step_solution[pin_out - 1]
                            } else {
                                0.0
                            };
                            let v_out_diff = v_out_val - v_gnd_val;

                            let v_dac_val = if pin_dac > 0 {
                                step_solution[pin_dac - 1]
                            } else {
                                0.0
                            };
                            let v_dac_diff = v_dac_val - v_gnd_val;

                            // 1. Calcular corriente consumida por carril
                            let i_baseline = match comp.comp_type.as_str() {
                                "arduino_uno" => 0.015,
                                "esp32" => 0.060,
                                "raspberry_pi_pico" => 0.025,
                                _ => 0.015,
                            };
                            let c_eff = match comp.comp_type.as_str() {
                                "arduino_uno" => 150e-12,
                                "esp32" => 450e-12,
                                "raspberry_pi_pico" => 250e-12,
                                _ => 150e-12,
                            };
                            let f_clk = match comp.comp_type.as_str() {
                                "arduino_uno" => 16e6,
                                "esp32" => 240e6,
                                "raspberry_pi_pico" => 133e6,
                                _ => 16e6,
                            };

                            let t_chip_prev = *mcu_tchip.get(&comp.id).unwrap_or(&t_amb);
                            let i_leakage = 1e-6 * (0.03 * (t_chip_prev - 298.15)).exp();
                            let i_vcc_draw =
                                i_baseline + c_eff * v_vcc_diff.max(0.0) * f_clk + i_leakage;

                            // Calcular corrientes de IO para disipación
                            let g_out = 0.05;
                            let i_max = match comp.comp_type.as_str() {
                                "arduino_uno" => 0.040,
                                "esp32" | "raspberry_pi_pico" => 0.012,
                                _ => 0.040,
                            };

                            // Consigna de salida en t
                            let v_target_out = match mode {
                                1 => {
                                    if (t % 1.0) < 0.5 {
                                        v_cc
                                    } else {
                                        0.0
                                    }
                                }
                                2 => {
                                    let was_high = v_out_diff > 0.5 * v_cc;
                                    let threshold =
                                        if was_high { 0.45 * v_cc } else { 0.55 * v_cc };
                                    if v_adc_diff > threshold {
                                        v_cc
                                    } else {
                                        0.0
                                    }
                                }
                                _ => 0.0,
                            };
                            let i_eq_out = (g_out * v_target_out).clamp(-i_max, i_max);
                            let i_out_pkg = i_eq_out - g_out * v_out_diff;

                            // Consigna DAC
                            let v_target_dac = match mode {
                                0 => v_adc_diff.clamp(0.0, v_cc),
                                3 => {
                                    let period = 1e-4;
                                    let t_phase = t % period;
                                    let duty = (v_adc_diff / v_cc).clamp(0.0, 1.0);
                                    if t_phase < duty * period {
                                        v_cc
                                    } else {
                                        0.0
                                    }
                                }
                                _ => 0.0,
                            };
                            let v_dac_eff_prev = *mcu_vdaceff.get(&comp.id).unwrap_or(&0.0);
                            let sr_max = match comp.comp_type.as_str() {
                                "arduino_uno" => 2e6, // 2V/μs
                                _ => 10e6,            // 10V/μs
                            };
                            let tau_dac = 2e-6; // 2μs
                            let dac_diff = v_target_dac - v_dac_eff_prev;
                            let limit_step = sr_max * dt;
                            let dac_clamped = dac_diff.clamp(-limit_step, limit_step);
                            let v_dac_eff_new = (v_dac_eff_prev
                                + dac_clamped
                                + (dt / tau_dac) * (v_target_dac - (v_dac_eff_prev + dac_clamped)))
                                .clamp(0.0, v_cc);

                            let i_eq_dac = (g_out * v_dac_eff_new).clamp(-i_max, i_max);
                            let i_dac_pkg = i_eq_dac - g_out * v_dac_diff;

                            // Pérdidas en pines de IO
                            let p_out_loss = i_out_pkg.max(0.0) * (v_vcc_diff - v_out_diff)
                                + (-i_out_pkg).max(0.0) * v_out_diff;
                            let p_dac_loss = i_dac_pkg.max(0.0) * (v_vcc_diff - v_dac_diff)
                                + (-i_dac_pkg).max(0.0) * v_dac_diff;

                            let p_diss = i_vcc_draw * v_vcc_diff + p_out_loss + p_dac_loss;

                            // Actualizar Temperatura
                            let c_th = 0.5;
                            let theta_ja = 40.0;
                            let t_chip_new = (t_chip_prev
                                + (dt / c_th) * (p_diss + t_amb / theta_ja))
                                / (1.0 + dt / (c_th * theta_ja));
                            mcu_tchip.insert(comp.id.clone(), t_chip_new);

                            // Actualizar S&H Capacitor
                            let c_sample = 10e-12; // 10 pF
                            let r_sw = 5e3; // 5 kΩ
                            let t_mod = t % 1e-4;
                            let sampling_active = t_mod < 2e-6;
                            let v_sample_prev = *mcu_vsample.get(&comp.id).unwrap_or(&0.0);
                            let v_sample_new = if sampling_active {
                                let g_adc_dyn = 1.0 / (r_sw + dt / c_sample);
                                let i_cap = g_adc_dyn * (v_adc_diff - v_sample_prev);
                                v_sample_prev + (dt / c_sample) * i_cap
                            } else {
                                v_sample_prev
                            };
                            mcu_vsample.insert(comp.id.clone(), v_sample_new);
                            mcu_vdaceff.insert(comp.id.clone(), v_dac_eff_new);
                        }
                        _ => {}
                    }
                }

                // ACTUALIZAR ESTADOS DE INDUCTORES ACOPLADOS (Inductancia Mutua K)
                if let Some(ref mutuals) = netlist.mutual_inductances {
                    for k_comp in mutuals {
                        if let (Some(l1), Some(l2)) = (
                            netlist.components.iter().find(|c| c.id == k_comp.l1_id),
                            netlist.components.iter().find(|c| c.id == k_comp.l2_id),
                        ) {
                            let node_1pos = l1.pins[0].parse::<usize>().unwrap();
                            let node_1neg = l1.pins[1].parse::<usize>().unwrap();
                            let node_2pos = l2.pins[0].parse::<usize>().unwrap();
                            let node_2neg = l2.pins[1].parse::<usize>().unwrap();

                            let v_1pos = if node_1pos > 0 {
                                step_solution[node_1pos - 1]
                            } else {
                                0.0
                            };
                            let v_1neg = if node_1neg > 0 {
                                step_solution[node_1neg - 1]
                            } else {
                                0.0
                            };
                            let v_2pos = if node_2pos > 0 {
                                step_solution[node_2pos - 1]
                            } else {
                                0.0
                            };
                            let v_2neg = if node_2neg > 0 {
                                step_solution[node_2neg - 1]
                            } else {
                                0.0
                            };

                            let v1 = v_1pos - v_1neg;
                            let v2 = v_2pos - v_2neg;

                            let l1_val = l1.value;
                            let l2_val = l2.value;
                            let k = k_comp.k_coeff;

                            let m = k * (l1_val * l2_val).sqrt();
                            let delta = l1_val * l2_val - m * m;

                            if delta.abs() > 1e-30 {
                                let prev_il1 = *ind_states.get(&l1.id).unwrap_or(&0.0);
                                let prev_il2 = *ind_states.get(&l2.id).unwrap_or(&0.0);

                                let f_step = if gear2_active_this_step {
                                    1.0 / gear_a
                                } else {
                                    dt
                                };

                                let g11 = (f_step * l2_val) / delta;
                                let g22 = (f_step * l1_val) / delta;
                                let g12 = -(f_step * m) / delta;

                                let (i_eq1, i_eq2) = if gear2_active_this_step {
                                    let prev_prev_il1 =
                                        *ind_states_prev.get(&l1.id).unwrap_or(&prev_il1);
                                    let prev_prev_il2 =
                                        *ind_states_prev.get(&l2.id).unwrap_or(&prev_il2);
                                    (
                                        -(gear_b / gear_a) * prev_il1
                                            - (gear_c / gear_a) * prev_prev_il1,
                                        -(gear_b / gear_a) * prev_il2
                                            - (gear_c / gear_a) * prev_prev_il2,
                                    )
                                } else {
                                    (prev_il1, prev_il2)
                                };

                                let new_il1 = g11 * v1 + g12 * v2 + i_eq1;
                                let new_il2 = g12 * v1 + g22 * v2 + i_eq2;

                                ind_states_prev.insert(l1.id.clone(), prev_il1);
                                ind_states.insert(l1.id.clone(), new_il1);

                                ind_states_prev.insert(l2.id.clone(), prev_il2);
                                ind_states.insert(l2.id.clone(), new_il2);
                            }
                        }
                    }
                }

                // SELF-HEATING: Actualizar temperaturas de unión de dispositivos discretos
                for comp in &netlist.components {
                    let (rth, cth) = match comp.comp_type.as_str() {
                        "diode" | "led" => (
                            comp.rth.unwrap_or(DIODE_RTH_JA),
                            comp.cth.unwrap_or(DIODE_CTH),
                        ),
                        "opto" => (
                            comp.rth.unwrap_or(OPTO_RTH_JA),
                            comp.cth.unwrap_or(OPTO_CTH),
                        ),
                        "nmos" | "pmos" | "bsim3nmos" | "bsim3pmos" | "bsim4nmos" | "bsim4pmos" => {
                            (comp.rth.unwrap_or(MOS_RTH_JA), comp.cth.unwrap_or(MOS_CTH))
                        }
                        "npn" | "pnp" => {
                            (comp.rth.unwrap_or(BJT_RTH_JA), comp.cth.unwrap_or(BJT_CTH))
                        }
                        _ => continue,
                    };

                    // Calcular potencia disipada P = sum(V_terminal * I_terminal)
                    let p_diss = match comp.comp_type.as_str() {
                        "diode" | "led" => {
                            let na = comp.pins[0].parse::<usize>().unwrap_or(0);
                            let nc = comp.pins[1].parse::<usize>().unwrap_or(0);
                            let va = if na > 0 { step_solution[na - 1] } else { 0.0 };
                            let vc = if nc > 0 { step_solution[nc - 1] } else { 0.0 };
                            let vd = va - vc;
                            let tj = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                            let (_, id, _) = solve_diode_junction_voltage(vd, Some(tj), comp);
                            (vd * id).abs()
                        }
                        "opto" => {
                            if comp.pins.len() < 4 {
                                continue;
                            }
                            let na = comp.pins[0].parse::<usize>().unwrap_or(0);
                            let nk = comp.pins[1].parse::<usize>().unwrap_or(0);
                            let nc = comp.pins[2].parse::<usize>().unwrap_or(0);
                            let ne = comp.pins[3].parse::<usize>().unwrap_or(0);
                            let va = if na > 0 { step_solution[na - 1] } else { 0.0 };
                            let vk = if nk > 0 { step_solution[nk - 1] } else { 0.0 };
                            let vc = if nc > 0 { step_solution[nc - 1] } else { 0.0 };
                            let ve = if ne > 0 { step_solution[ne - 1] } else { 0.0 };
                            let vd = va - vk;
                            let v_ce = vc - ve;
                            let tj = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                            let (_, id_led, _) = solve_diode_junction_voltage(vd, Some(tj), comp);
                            let ctr = comp.opto_ctr.unwrap_or(OPTO_DEFAULT_CTR);
                            let vsat = comp.opto_vsat.unwrap_or(OPTO_DEFAULT_VSAT).max(1e-6);
                            let i_ce = ctr * id_led * (v_ce / vsat).tanh();
                            // Potencia total: LED + fototransistor
                            (vd * id_led).abs() + (v_ce * i_ce).abs()
                        }
                        "nmos" | "bsim3nmos" | "bsim4nmos" => {
                            let ng = comp.pins[0].parse::<usize>().unwrap_or(0);
                            let nd = comp.pins[1].parse::<usize>().unwrap_or(0);
                            let ns = comp.pins[2].parse::<usize>().unwrap_or(0);
                            let nb = if comp.pins.len() >= 4 {
                                comp.pins[3].parse::<usize>().unwrap_or(0)
                            } else {
                                0
                            };
                            let vg = if ng > 0 { step_solution[ng - 1] } else { 0.0 };
                            let vd_pin = if nd > 0 { step_solution[nd - 1] } else { 0.0 };
                            let vs = if ns > 0 { step_solution[ns - 1] } else { 0.0 };
                            let v_b = if nb > 0 { step_solution[nb - 1] } else { 0.0 };
                            let vgs = vg - vs;
                            let vds = (vd_pin - vs).max(0.0);
                            let vbs = v_b - vs;
                            let tj = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                            let vth = comp.value + MOS_VTH_TC * (tj - PHYS_T);
                            let kn = 0.02 * (tj / PHYS_T).powf(MOS_MOBILITY_EXPO);

                            let (ids, igs) = if comp.comp_type == "bsim4nmos" {
                                let (ids_val, _, _, igs_val, _) =
                                    evaluate_bsim4_nmos(vgs, vds, vbs, comp.value, comp.w, comp.l);
                                (ids_val, igs_val)
                            } else if comp.comp_type == "bsim3nmos" {
                                let (ids_val, _, _) = evaluate_bsim3_nmos(
                                    vgs,
                                    vds,
                                    vbs,
                                    comp.value,
                                    comp.w,
                                    comp.l,
                                    None,
                                    Some(comp),
                                );
                                (ids_val, 0.0)
                            } else {
                                let ids_val = if vgs <= vth {
                                    0.0
                                } else if vds < vgs - vth {
                                    kn * (2.0 * (vgs - vth) * vds - vds * vds)
                                } else {
                                    kn * (vgs - vth).powi(2)
                                };
                                (ids_val, 0.0)
                            };
                            (vds * ids).abs() + (vgs * igs).abs()
                        }
                        "pmos" | "bsim3pmos" | "bsim4pmos" => {
                            let ng = comp.pins[0].parse::<usize>().unwrap_or(0);
                            let nd = comp.pins[1].parse::<usize>().unwrap_or(0);
                            let ns = comp.pins[2].parse::<usize>().unwrap_or(0);
                            let nb = if comp.pins.len() >= 4 {
                                comp.pins[3].parse::<usize>().unwrap_or(0)
                            } else {
                                0
                            };
                            let vg = if ng > 0 { step_solution[ng - 1] } else { 0.0 };
                            let vd_pin = if nd > 0 { step_solution[nd - 1] } else { 0.0 };
                            let vs = if ns > 0 { step_solution[ns - 1] } else { 0.0 };
                            let v_b = if nb > 0 { step_solution[nb - 1] } else { 0.0 };
                            let vsg = vs - vg;
                            let vsd = (vs - vd_pin).max(0.0);
                            let vsb = vs - v_b;
                            let tj = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                            let vth_abs = comp.value.abs() + MOS_VTH_TC * (tj - PHYS_T);
                            let kp = 0.01 * (tj / PHYS_T).powf(MOS_MOBILITY_EXPO);

                            let (isd, igs) = if comp.comp_type == "bsim4pmos" {
                                let (isd_val, _, _, igs_val, _) =
                                    evaluate_bsim4_pmos(vsg, vsd, vsb, comp.value, comp.w, comp.l);
                                (isd_val, igs_val)
                            } else if comp.comp_type == "bsim3pmos" {
                                let (isd_val, _, _) = evaluate_bsim3_pmos(
                                    vsg,
                                    vsd,
                                    vsb,
                                    comp.value,
                                    comp.w,
                                    comp.l,
                                    None,
                                    Some(comp),
                                );
                                (isd_val, 0.0)
                            } else {
                                let ids_val = if vsg <= vth_abs {
                                    0.0
                                } else if vsd < vsg - vth_abs {
                                    kp * (2.0 * (vsg - vth_abs) * vsd - vsd * vsd)
                                } else {
                                    kp * (vsg - vth_abs).powi(2)
                                };
                                (ids_val, 0.0)
                            };
                            (vsd * isd).abs() + (vsg * igs).abs()
                        }
                        "npn" | "pnp" => {
                            // Aproximación: P_diss = Vce * Ic
                            let nb = comp.pins[0].parse::<usize>().unwrap_or(0);
                            let nc = comp.pins[1].parse::<usize>().unwrap_or(0);
                            let ne = comp.pins[2].parse::<usize>().unwrap_or(0);
                            let vb = if nb > 0 { step_solution[nb - 1] } else { 0.0 };
                            let vc_pin = if nc > 0 { step_solution[nc - 1] } else { 0.0 };
                            let ve = if ne > 0 { step_solution[ne - 1] } else { 0.0 };
                            let (vce, vbe) = if comp.comp_type == "npn" {
                                ((vc_pin - ve).abs(), vb - ve)
                            } else {
                                ((ve - vc_pin).abs(), ve - vb)
                            };
                            let tj = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                            let (vt_b, is_b) = get_thermal_parameters_junction(tj, None);
                            let ic = is_b * ((vbe / vt_b).exp() - 1.0) * comp.value.max(100.0);
                            (vce * ic.abs()).min(50.0) // Clampar a 50W para evitar divergencia
                        }
                        _ => 0.0,
                    };

                    // Red RC térmica de unión (Backward Euler implícito para estabilidad)
                    // T_j(n+1) = [T_j(n) + (dt/Cth) * (P_diss + T_amb/Rth)] / [1 + dt/(Cth*Rth)]
                    let tj_prev = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                    let tj_new =
                        (tj_prev + (dt / cth) * (p_diss + t_amb / rth)) / (1.0 + dt / (cth * rth));
                    // Clampar temperatura: no puede ser menor que ambiente ni mayor que 500K (227°C)
                    let tj_clamped = tj_new.clamp(t_amb, 500.0);
                    device_tjunc.insert(comp.id.clone(), tj_clamped);
                }

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
