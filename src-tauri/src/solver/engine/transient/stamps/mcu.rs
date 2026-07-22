use super::StampContext;
use crate::solver::types::ComponentData;
use nalgebra::DMatrix;

pub(super) fn stamp_mcu(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let mcu_vdaceff = ctx.mcu_vdaceff;
    let ms_scheduler = ctx.ms_scheduler;
    let mut matrix_a_iter = &mut *ctx.matrix_a_iter;
    let vector_z_iter = &mut *ctx.vector_z_iter;
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
