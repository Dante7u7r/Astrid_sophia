use crate::solver::matrix::MixedSignalScheduler;
use crate::solver::types::{CircuitNetlist, ComponentData};
use nalgebra::DVector;
use std::collections::HashMap;

pub(crate) struct McuAcceptedStateMaps<'a> {
    pub tchip: &'a mut HashMap<String, f64>,
    pub vsample: &'a mut HashMap<String, f64>,
    pub vdaceff: &'a mut HashMap<String, f64>,
}

/// Gestor de ejecución de microcontroladores nativos cycle-accurate en Rust.
pub struct McuRuntimeManager {
    pub cores: HashMap<String, Box<dyn crate::mcu::McuCore>>,
    pub last_clock_time: HashMap<String, f64>,
}

impl McuRuntimeManager {
    pub fn new(netlist: &CircuitNetlist) -> Result<Self, String> {
        let mut cores: HashMap<String, Box<dyn crate::mcu::McuCore>> = HashMap::new();
        let mut last_clock_time = HashMap::new();

        for comp in &netlist.components {
            if is_mcu_component(comp) {
                if let Some(ref fw_str) = comp.firmware {
                    if !fw_str.trim().is_empty() {
                        let mut core: Box<dyn crate::mcu::McuCore> = match comp.comp_type.as_str() {
                            "mcu_8051" | "8051" => {
                                Box::new(crate::mcu::mcu8051::Mcu8051::default())
                            }
                            _ => Box::new(crate::mcu::atmega328p::Atmega328p::default()),
                        };
                        core.load_firmware(fw_str.as_bytes()).map_err(|e| {
                            format!("Error al cargar firmware en '{}': {}", comp.id, e)
                        })?;
                        cores.insert(comp.id.clone(), core);
                        last_clock_time.insert(comp.id.clone(), 0.0);
                    }
                }
            }
        }

        Ok(Self {
            cores,
            last_clock_time,
        })
    }

    pub fn step_native_mcus(
        &mut self,
        netlist: &CircuitNetlist,
        step_solution: &DVector<f64>,
        t: f64,
        dt: f64,
        scheduler: &mut MixedSignalScheduler,
    ) {
        for comp in &netlist.components {
            if is_mcu_component(comp) && comp.pins.len() >= 6 {
                if let Some(core) = self.cores.get_mut(&comp.id) {
                    let clock_freq = comp
                        .mcu_clock_freq
                        .unwrap_or_else(|| mcu_clock_frequency(&comp.comp_type));
                    let _last_t = *self.last_clock_time.get(&comp.id).unwrap_or(&0.0);
                    let next_t = t + dt;
                    let total_cycles_target = (next_t * clock_freq).floor() as u64;
                    let current_cycles = core.cycle_count();

                    let cycles_to_run = if total_cycles_target > current_cycles {
                        (total_cycles_target - current_cycles) as u32
                    } else {
                        1
                    };

                    let pin_in = comp.pins[0].parse::<usize>().unwrap_or(0);
                    let pin_adc = comp.pins[2].parse::<usize>().unwrap_or(0);
                    let pin_gnd = comp.pins[5].parse::<usize>().unwrap_or(0);
                    let v_gnd_val = node_voltage(step_solution, pin_gnd);
                    let v_adc_diff = (node_voltage(step_solution, pin_adc) - v_gnd_val).max(0.0);
                    let v_in_diff = (node_voltage(step_solution, pin_in) - v_gnd_val).max(0.0);
                    let v_cc = mcu_supply_voltage(&comp.comp_type);

                    let mut gpio_inputs = crate::mcu::GpioInputs::default();
                    gpio_inputs.adc_channels[0] = v_adc_diff;
                    if v_in_diff >= 0.5 * v_cc {
                        gpio_inputs.pin_d |= 0x04; // PD2 (INT0)
                        gpio_inputs.pin_b |= 0x01; // PB0
                        gpio_inputs.pin_c |= 0x01; // PC0
                    }

                    core.run_cycles(cycles_to_run, &gpio_inputs);
                    self.last_clock_time.insert(comp.id.clone(), next_t);

                    let outputs = core.get_gpio_outputs();
                    let out_state = match comp.comp_type.as_str() {
                        "mcu_8051" | "8051" => (outputs.port_b & 0x01) != 0, // P1.0
                        _ => (outputs.port_b & (1 << 5)) != 0 || (outputs.port_d & (1 << 1)) != 0, // PB5 (D13) o PD1
                    };
                    scheduler.set_state(&comp.id, 1, out_state);
                }
            }
        }
    }
}

pub(crate) fn update_mcu_accepted_states(
    netlist: &CircuitNetlist,
    step_solution: &DVector<f64>,
    states: &mut McuAcceptedStateMaps<'_>,
    t: f64,
    dt: f64,
    t_amb: f64,
) {
    for comp in &netlist.components {
        if is_mcu_component(comp) && comp.pins.len() >= 6 {
            update_mcu_accepted_state(comp, step_solution, states, t, dt, t_amb);
        }
    }
}

fn update_mcu_accepted_state(
    comp: &ComponentData,
    step_solution: &DVector<f64>,
    states: &mut McuAcceptedStateMaps<'_>,
    t: f64,
    dt: f64,
    t_amb: f64,
) {
    let pin_out = comp.pins[1].parse::<usize>().unwrap_or(0);
    let pin_adc = comp.pins[2].parse::<usize>().unwrap_or(0);
    let pin_dac = comp.pins[3].parse::<usize>().unwrap_or(0);
    let pin_vcc = comp.pins[4].parse::<usize>().unwrap_or(0);
    let pin_gnd = comp.pins[5].parse::<usize>().unwrap_or(0);

    let v_cc = mcu_supply_voltage(&comp.comp_type);
    let mode = comp.value as i32;
    let v_gnd_val = node_voltage(step_solution, pin_gnd);
    let v_vcc_diff = node_voltage(step_solution, pin_vcc) - v_gnd_val;
    let v_adc_diff = node_voltage(step_solution, pin_adc) - v_gnd_val;
    let v_out_diff = node_voltage(step_solution, pin_out) - v_gnd_val;
    let v_dac_diff = node_voltage(step_solution, pin_dac) - v_gnd_val;

    let t_chip_prev = *states.tchip.get(&comp.id).unwrap_or(&t_amb);
    let i_leakage = 1e-6 * (0.03 * (t_chip_prev - 298.15)).exp();
    let i_vcc_draw = mcu_baseline_current(&comp.comp_type)
        + mcu_effective_capacitance(&comp.comp_type)
            * v_vcc_diff.max(0.0)
            * mcu_clock_frequency(&comp.comp_type)
        + i_leakage;

    let g_out = 0.05;
    let i_max = mcu_io_current_limit(&comp.comp_type);
    let v_target_out = target_output_voltage(mode, t, v_cc, v_adc_diff, v_out_diff);
    let i_eq_out = (g_out * v_target_out).clamp(-i_max, i_max);
    let i_out_pkg = i_eq_out - g_out * v_out_diff;

    let v_target_dac = target_dac_voltage(mode, t, v_cc, v_adc_diff);
    let v_dac_eff_prev = *states.vdaceff.get(&comp.id).unwrap_or(&0.0);
    let v_dac_eff_new = slew_limited_dac_voltage(&comp.comp_type, v_target_dac, v_dac_eff_prev, dt)
        .clamp(0.0, v_cc);
    let i_eq_dac = (g_out * v_dac_eff_new).clamp(-i_max, i_max);
    let i_dac_pkg = i_eq_dac - g_out * v_dac_diff;

    let p_out_loss =
        i_out_pkg.max(0.0) * (v_vcc_diff - v_out_diff) + (-i_out_pkg).max(0.0) * v_out_diff;
    let p_dac_loss =
        i_dac_pkg.max(0.0) * (v_vcc_diff - v_dac_diff) + (-i_dac_pkg).max(0.0) * v_dac_diff;
    let p_diss = i_vcc_draw * v_vcc_diff + p_out_loss + p_dac_loss;

    let c_th = 0.5;
    let theta_ja = 40.0;
    let t_chip_new =
        (t_chip_prev + (dt / c_th) * (p_diss + t_amb / theta_ja)) / (1.0 + dt / (c_th * theta_ja));
    states.tchip.insert(comp.id.clone(), t_chip_new);

    let v_sample_new = sample_hold_voltage(
        *states.vsample.get(&comp.id).unwrap_or(&0.0),
        v_adc_diff,
        t,
        dt,
    );
    states.vsample.insert(comp.id.clone(), v_sample_new);
    states.vdaceff.insert(comp.id.clone(), v_dac_eff_new);
}

pub(crate) fn is_mcu_component(comp: &ComponentData) -> bool {
    comp.comp_type == "arduino_uno"
        || comp.comp_type == "esp32"
        || comp.comp_type == "raspberry_pi_pico"
        || comp.comp_type == "mcu_8051"
        || comp.comp_type == "8051"
        || comp.comp_type == "mcu_avr"
        || comp.comp_type == "atmega328p"
}

pub(crate) fn mcu_supply_voltage(comp_type: &str) -> f64 {
    match comp_type {
        "arduino_uno" | "mcu_8051" | "8051" | "mcu_avr" | "atmega328p" => 5.0,
        "esp32" | "raspberry_pi_pico" => 3.3,
        _ => 5.0,
    }
}

pub(crate) fn mcu_baseline_current(comp_type: &str) -> f64 {
    match comp_type {
        "arduino_uno" | "mcu_avr" | "atmega328p" => 0.015,
        "mcu_8051" | "8051" => 0.020,
        "esp32" => 0.060,
        "raspberry_pi_pico" => 0.025,
        _ => 0.015,
    }
}

pub(crate) fn mcu_effective_capacitance(comp_type: &str) -> f64 {
    match comp_type {
        "arduino_uno" => 150e-12,
        "esp32" => 450e-12,
        "raspberry_pi_pico" => 250e-12,
        _ => 150e-12,
    }
}

pub(crate) fn mcu_clock_frequency(comp_type: &str) -> f64 {
    match comp_type {
        "arduino_uno" | "mcu_avr" | "atmega328p" => 16e6,
        "mcu_8051" | "8051" => 12e6,
        "esp32" => 240e6,
        "raspberry_pi_pico" => 133e6,
        _ => 16e6,
    }
}

pub(crate) fn mcu_io_current_limit(comp_type: &str) -> f64 {
    match comp_type {
        "arduino_uno" => 0.040,
        "esp32" | "raspberry_pi_pico" => 0.012,
        _ => 0.040,
    }
}

fn target_output_voltage(mode: i32, t: f64, v_cc: f64, v_adc_diff: f64, v_out_diff: f64) -> f64 {
    match mode {
        1 => {
            if (t % 1.0) < 0.5 {
                v_cc
            } else {
                0.0
            }
        }
        2 => {
            let was_high = v_out_diff > 0.5 * v_cc;
            let threshold = if was_high { 0.45 * v_cc } else { 0.55 * v_cc };
            if v_adc_diff > threshold {
                v_cc
            } else {
                0.0
            }
        }
        _ => 0.0,
    }
}

fn target_dac_voltage(mode: i32, t: f64, v_cc: f64, v_adc_diff: f64) -> f64 {
    match mode {
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
    }
}

fn slew_limited_dac_voltage(
    comp_type: &str,
    v_target_dac: f64,
    v_dac_eff_prev: f64,
    dt: f64,
) -> f64 {
    let sr_max = match comp_type {
        "arduino_uno" => 2e6,
        _ => 10e6,
    };
    let tau_dac = 2e-6;
    let dac_diff = v_target_dac - v_dac_eff_prev;
    let limit_step = sr_max * dt;
    let dac_clamped = dac_diff.clamp(-limit_step, limit_step);
    v_dac_eff_prev + dac_clamped + (dt / tau_dac) * (v_target_dac - (v_dac_eff_prev + dac_clamped))
}

fn sample_hold_voltage(v_sample_prev: f64, v_adc_diff: f64, t: f64, dt: f64) -> f64 {
    let t_mod = t % 1e-4;
    if t_mod >= 2e-6 {
        return v_sample_prev;
    }

    let c_sample = 10e-12;
    let r_sw = 5e3;
    let g_adc_dyn = 1.0 / (r_sw + dt / c_sample);
    let i_cap = g_adc_dyn * (v_adc_diff - v_sample_prev);
    v_sample_prev + (dt / c_sample) * i_cap
}

fn node_voltage(solution: &DVector<f64>, node: usize) -> f64 {
    if node > 0 {
        solution[node - 1]
    } else {
        0.0
    }
}
