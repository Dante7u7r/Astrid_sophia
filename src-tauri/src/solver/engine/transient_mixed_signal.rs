use crate::solver::matrix::{MixedSignalEvent, MixedSignalEventType, MixedSignalScheduler};
use crate::solver::types::{CircuitNetlist, ComponentData};
use nalgebra::DVector;

pub(crate) fn initialize_mixed_signal_scheduler(netlist: &CircuitNetlist) -> MixedSignalScheduler {
    let mut scheduler = MixedSignalScheduler::new();
    for comp in &netlist.components {
        if comp.comp_type.ends_with("_gate") {
            let is_not = comp.comp_type == "not_gate";
            let output_pin = if is_not { 1 } else { 2 };
            scheduler.set_state(&comp.id, output_pin, false);
            scheduler
                .last_analog_v
                .entry(comp.id.clone())
                .or_default()
                .insert(0, 0.0);
            if !is_not {
                scheduler
                    .last_analog_v
                    .get_mut(&comp.id)
                    .unwrap()
                    .insert(1, 0.0);
            }
        } else if is_mcu_component_type(&comp.comp_type) {
            scheduler.set_state(&comp.id, 1, false);
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
    comp_type == "arduino_uno" || comp_type == "esp32" || comp_type == "raspberry_pi_pico"
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
            detect_mcu_adc_crossing(comp, scheduler, step_solution, t, dt);
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
                let comp = netlist
                    .components
                    .iter()
                    .find(|c| c.id == event.component_id)
                    .unwrap();
                if comp.comp_type.ends_with("_gate") {
                    process_gate_input_crossing(comp, scheduler, event.time, pin_idx, direction);
                } else if is_mcu_component_type(&comp.comp_type) {
                    process_mcu_input_crossing(comp, scheduler, event.time, pin_idx, direction);
                }
            }
            MixedSignalEventType::LogicOutputTransition { pin_idx, new_state } => {
                scheduler.set_state(&event.component_id, pin_idx, new_state);
            }
            MixedSignalEventType::McuPeriodicTick => {
                let comp = netlist
                    .components
                    .iter()
                    .find(|c| c.id == event.component_id)
                    .unwrap();
                process_mcu_periodic_tick(comp, scheduler, event.time);
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
}

fn detect_mcu_adc_crossing(
    comp: &ComponentData,
    scheduler: &mut MixedSignalScheduler,
    step_solution: &DVector<f64>,
    t: f64,
    dt: f64,
) {
    let pin_adc = comp.pins[2].parse::<usize>().unwrap_or(0);
    let pin_gnd = comp.pins[5].parse::<usize>().unwrap_or(0);
    let v_adc_diff = node_voltage(step_solution, pin_adc) - node_voltage(step_solution, pin_gnd);
    let v_adc_prev = scheduler
        .last_analog_v
        .get(&comp.id)
        .map(|last_v| *last_v.get(&2).unwrap_or(&0.0))
        .unwrap_or(0.0);

    let v_cc = match comp.comp_type.as_str() {
        "arduino_uno" => 5.0,
        _ => 3.3,
    };
    let threshold = 0.5 * v_cc;

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
    scheduler
        .last_analog_v
        .entry(comp.id.clone())
        .or_default()
        .insert(2, v_adc_diff);
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
