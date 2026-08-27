use crate::solver::matrix::{MixedSignalEvent, MixedSignalEventType, MixedSignalScheduler};
use crate::solver::types::{CircuitNetlist, ComponentData};
use nalgebra::DVector;

fn initial_source_voltages(netlist: &CircuitNetlist) -> std::collections::HashMap<usize, f64> {
    let mut node_v = std::collections::HashMap::new();
    for comp in &netlist.components {
        if comp.comp_type == "vsource" && comp.pins.len() >= 2 {
            if let (Ok(p_pos), Ok(p_neg)) =
                (comp.pins[0].parse::<usize>(), comp.pins[1].parse::<usize>())
            {
                let v = if let Some(ref wave) = comp.wave_type {
                    let amp = comp.amplitude.unwrap_or(0.0);
                    let offset = comp.offset.unwrap_or(0.0);
                    let phase = comp.phase.unwrap_or(0.0).to_radians();
                    let duty = comp.duty_cycle.unwrap_or(0.5);
                    match wave.as_str() {
                        "sine" => offset + amp * phase.sin(),
                        "pulse" | "square" => {
                            if 0.0 < duty {
                                offset + amp
                            } else {
                                offset
                            }
                        }
                        _ => comp.value,
                    }
                } else {
                    comp.value
                };
                if p_neg == 0 {
                    node_v.insert(p_pos, v);
                }
            }
        }
    }
    node_v
}

pub(crate) fn initialize_mixed_signal_scheduler(netlist: &CircuitNetlist) -> MixedSignalScheduler {
    let mut scheduler = MixedSignalScheduler::new();
    let init_v = initial_source_voltages(netlist);

    for comp in &netlist.components {
        if comp.comp_type.ends_with("_gate") || comp.comp_type == "buffer" {
            let is_not = comp.comp_type == "not_gate";
            let is_buf = comp.comp_type == "buffer";
            let output_pin = if is_not || is_buf { 1 } else { 2 };
            let v_th_h = comp.gate_vhigh.unwrap_or(1.5);

            let p0 = comp
                .pins
                .first()
                .and_then(|p| p.parse::<usize>().ok())
                .unwrap_or(0);
            let p1 = comp
                .pins
                .get(1)
                .and_then(|p| p.parse::<usize>().ok())
                .unwrap_or(0);
            let v_in_a = *init_v.get(&p0).unwrap_or(&0.0);
            let v_in_b = *init_v.get(&p1).unwrap_or(&0.0);

            let state_a = v_in_a >= v_th_h;
            let state_b = v_in_b >= v_th_h;

            scheduler.set_state(&comp.id, 0, state_a);
            if !is_not && !is_buf {
                scheduler.set_state(&comp.id, 1, state_b);
            }

            let init_out = match comp.comp_type.as_str() {
                "not_gate" => !state_a,
                "buffer" => state_a,
                "and_gate" => state_a && state_b,
                "or_gate" => state_a || state_b,
                "nand_gate" => !(state_a && state_b),
                "nor_gate" => !(state_a || state_b),
                "xor_gate" => state_a ^ state_b,
                "xnor_gate" => !(state_a ^ state_b),
                _ => false,
            };
            scheduler.set_state(&comp.id, output_pin, init_out);

            let entry = scheduler.last_analog_v.entry(comp.id.clone()).or_default();
            entry.insert(0, v_in_a);
            if !is_not && !is_buf {
                entry.insert(1, v_in_b);
            }
            entry.insert(output_pin, if init_out { 5.0 } else { 0.0 });
        } else if is_mcu_component_type(&comp.comp_type) {
            scheduler.set_state(&comp.id, 1, comp.value as i32 == 1);
            scheduler.schedule_event(MixedSignalEvent {
                time: 0.0,
                component_id: comp.id.clone(),
                event_type: MixedSignalEventType::McuPeriodicTick,
            });
        }
    }
    scheduler
}

fn is_mcu_component_type(comp_type: &str) -> bool {
    comp_type == "arduino_uno"
        || comp_type == "esp32"
        || comp_type == "raspberry_pi_pico"
        || comp_type == "mcu_8051"
        || comp_type == "8051"
        || comp_type == "mcu_avr"
        || comp_type == "atmega328p"
}

pub(crate) fn detect_mixed_signal_crossings(
    netlist: &CircuitNetlist,
    scheduler: &mut MixedSignalScheduler,
    step_solution: &DVector<f64>,
    t: f64,
    dt: f64,
) {
    for comp in &netlist.components {
        if comp.comp_type.ends_with("_gate") {
            detect_gate_crossings(comp, scheduler, step_solution, t, dt);
        } else if is_mcu_component_type(&comp.comp_type) && comp.pins.len() >= 6 {
            detect_mcu_crossings(comp, scheduler, step_solution, t, dt);
        }
    }
}

pub(crate) fn process_mixed_signal_events(
    netlist: &CircuitNetlist,
    scheduler: &mut MixedSignalScheduler,
    t_end: f64,
) {
    while let Some(next_t) = scheduler.get_next_event_time() {
        if next_t > t_end + 1e-9 {
            break;
        }

        let event = scheduler.events.remove(0);
        match event.event_type {
            MixedSignalEventType::LogicInputCrossing { pin_idx, direction } => {
                if let Some(comp) = netlist
                    .components
                    .iter()
                    .find(|c| c.id == event.component_id)
                {
                    if comp.comp_type.ends_with("_gate") {
                        process_gate_input_crossing(
                            comp, scheduler, event.time, pin_idx, direction,
                        );
                    } else if is_mcu_component_type(&comp.comp_type) {
                        process_mcu_input_crossing(comp, scheduler, event.time, pin_idx, direction);
                    }
                }
            }
            MixedSignalEventType::LogicOutputTransition { pin_idx, new_state } => {
                scheduler.set_state(&event.component_id, pin_idx, new_state);
            }
            MixedSignalEventType::McuPeriodicTick => {
                if let Some(comp) = netlist
                    .components
                    .iter()
                    .find(|c| c.id == event.component_id)
                {
                    process_mcu_periodic_tick(comp, scheduler, event.time);
                }
            }
        }
    }
}

fn detect_gate_crossings(
    comp: &ComponentData,
    scheduler: &mut MixedSignalScheduler,
    step_solution: &DVector<f64>,
    t: f64,
    dt: f64,
) {
    let is_not = comp.comp_type == "not_gate";
    let pin_in_a = comp.pins[0].parse::<usize>().unwrap_or(0);
    let pin_in_b = if is_not {
        0
    } else {
        comp.pins[1].parse::<usize>().unwrap_or(0)
    };

    let v_a_curr = node_voltage(step_solution, pin_in_a);
    let v_b_curr = node_voltage(step_solution, pin_in_b);
    let (v_a_prev, v_b_prev) = scheduler
        .last_analog_v
        .get(&comp.id)
        .map(|last_v| {
            (
                *last_v.get(&0).unwrap_or(&0.0),
                *last_v.get(&1).unwrap_or(&0.0),
            )
        })
        .unwrap_or((0.0, 0.0));

    schedule_logic_crossing_if_needed(comp, scheduler, t, dt, 0, v_a_prev, v_a_curr);
    if !is_not {
        schedule_logic_crossing_if_needed(comp, scheduler, t, dt, 1, v_b_prev, v_b_curr);
    }

    let last_v = scheduler.last_analog_v.entry(comp.id.clone()).or_default();
    last_v.insert(0, v_a_curr);
    if !is_not {
        last_v.insert(1, v_b_curr);
    }
    let out_pin_idx = if is_not { 1 } else { 2 };
    if let Some(p_str) = comp.pins.get(out_pin_idx) {
        if let Ok(node_out) = p_str.parse::<usize>() {
            let v_out_curr = node_voltage(step_solution, node_out);
            last_v.insert(out_pin_idx, v_out_curr);
        }
    }
}

fn detect_mcu_crossings(
    comp: &ComponentData,
    scheduler: &mut MixedSignalScheduler,
    step_solution: &DVector<f64>,
    t: f64,
    dt: f64,
) {
    let pin_in = comp.pins[0].parse::<usize>().unwrap_or(0);
    let pin_adc = comp.pins[2].parse::<usize>().unwrap_or(0);
    let pin_gnd = comp.pins[5].parse::<usize>().unwrap_or(0);
    let v_gnd = node_voltage(step_solution, pin_gnd);

    let v_cc = match comp.comp_type.as_str() {
        "arduino_uno" | "mcu_8051" | "8051" | "mcu_avr" | "atmega328p" => 5.0,
        _ => 3.3,
    };
    let threshold = 0.5 * v_cc;

    // 1. Cruce en pin digital de entrada (Pin 0 / INT0)
    let v_in_diff = node_voltage(step_solution, pin_in) - v_gnd;
    let v_in_prev = scheduler
        .last_analog_v
        .get(&comp.id)
        .map(|last_v| *last_v.get(&0).unwrap_or(&0.0))
        .unwrap_or(0.0);
    let crossed_in = (v_in_prev < threshold && v_in_diff >= threshold)
        || (v_in_prev >= threshold && v_in_diff < threshold);
    if crossed_in {
        let t_cross = crossing_time(t, dt, threshold, v_in_prev, v_in_diff);
        scheduler.schedule_event(MixedSignalEvent {
            time: t_cross,
            component_id: comp.id.clone(),
            event_type: MixedSignalEventType::LogicInputCrossing {
                pin_idx: 0,
                direction: v_in_diff >= threshold,
            },
        });
    }

    // 2. Cruce en pin analógico ADC (Pin 2)
    let v_adc_diff = node_voltage(step_solution, pin_adc) - v_gnd;
    let v_adc_prev = scheduler
        .last_analog_v
        .get(&comp.id)
        .map(|last_v| *last_v.get(&2).unwrap_or(&0.0))
        .unwrap_or(0.0);
    let crossed_adc = (v_adc_prev < threshold && v_adc_diff >= threshold)
        || (v_adc_prev >= threshold && v_adc_diff < threshold);
    if crossed_adc {
        let t_cross = crossing_time(t, dt, threshold, v_adc_prev, v_adc_diff);
        scheduler.schedule_event(MixedSignalEvent {
            time: t_cross,
            component_id: comp.id.clone(),
            event_type: MixedSignalEventType::LogicInputCrossing {
                pin_idx: 2,
                direction: v_adc_diff >= threshold,
            },
        });
    }

    let entry = scheduler.last_analog_v.entry(comp.id.clone()).or_default();
    entry.insert(0, v_in_diff);
    entry.insert(2, v_adc_diff);
}

fn schedule_logic_crossing_if_needed(
    comp: &ComponentData,
    scheduler: &mut MixedSignalScheduler,
    t: f64,
    dt: f64,
    pin_idx: usize,
    v_prev: f64,
    v_curr: f64,
) {
    let state_prev = scheduler.get_state(&comp.id, pin_idx);
    let threshold = if state_prev {
        comp.gate_vlow.unwrap_or(1.5)
    } else {
        comp.gate_vhigh.unwrap_or(1.5)
    };
    let crossed = if state_prev {
        v_curr < threshold
    } else {
        v_curr >= threshold
    };

    if crossed {
        scheduler.schedule_event(MixedSignalEvent {
            time: crossing_time(t, dt, threshold, v_prev, v_curr),
            component_id: comp.id.clone(),
            event_type: MixedSignalEventType::LogicInputCrossing {
                pin_idx,
                direction: !state_prev,
            },
        });
    }
}

fn process_gate_input_crossing(
    comp: &ComponentData,
    scheduler: &mut MixedSignalScheduler,
    event_time: f64,
    pin_idx: usize,
    direction: bool,
) {
    let is_not = comp.comp_type == "not_gate";
    let out_pin_idx = if is_not { 1 } else { 2 };

    scheduler.set_state(&comp.id, pin_idx, direction);

    let val_a = scheduler.get_state(&comp.id, 0);
    let val_b = if is_not {
        false
    } else {
        scheduler.get_state(&comp.id, 1)
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

    scheduler.schedule_event(MixedSignalEvent {
        time: event_time + gate_delay,
        component_id: comp.id.clone(),
        event_type: MixedSignalEventType::LogicOutputTransition {
            pin_idx: out_pin_idx,
            new_state: logic_out,
        },
    });
}

fn process_mcu_input_crossing(
    comp: &ComponentData,
    scheduler: &mut MixedSignalScheduler,
    event_time: f64,
    pin_idx: usize,
    direction: bool,
) {
    let mode = comp.value as i32;
    if mode == 2 && pin_idx == 2 {
        scheduler.schedule_event(MixedSignalEvent {
            time: event_time + 10e-9,
            component_id: comp.id.clone(),
            event_type: MixedSignalEventType::LogicOutputTransition {
                pin_idx: 1,
                new_state: direction,
            },
        });
    }
}

fn process_mcu_periodic_tick(
    comp: &ComponentData,
    scheduler: &mut MixedSignalScheduler,
    event_time: f64,
) {
    let mode = comp.value as i32;
    if mode == 1 {
        let state_out = (event_time % 1.0) < 0.5;
        scheduler.schedule_event(MixedSignalEvent {
            time: event_time + 10e-9,
            component_id: comp.id.clone(),
            event_type: MixedSignalEventType::LogicOutputTransition {
                pin_idx: 1,
                new_state: state_out,
            },
        });
    }

    scheduler.schedule_event(MixedSignalEvent {
        time: event_time + 100e-6,
        component_id: comp.id.clone(),
        event_type: MixedSignalEventType::McuPeriodicTick,
    });
}

fn node_voltage(solution: &DVector<f64>, node: usize) -> f64 {
    if node > 0 {
        solution[node - 1]
    } else {
        0.0
    }
}

fn crossing_time(t: f64, dt: f64, threshold: f64, v_prev: f64, v_curr: f64) -> f64 {
    if (v_curr - v_prev).abs() > 1e-12 {
        t + dt * ((threshold - v_prev) / (v_curr - v_prev))
    } else {
        t
    }
}
