use crate::solver::matrix::SparseMatrix;
use crate::solver::types::ComponentData;

use super::StampContext;

pub(super) fn stamp_mcu(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let prev_voltages = ctx.prev_voltages;
    let mut matrix_a = &mut *ctx.matrix_a;
    let vector_z = &mut *ctx.vector_z;
    if comp.pins.len() >= 6 {
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

        let mode = comp.value as i32;

        // 1. Impedancia de entrada (Pin_In y Pin_ADC)
        let g_in = 1e-6; // 1 MΩ
        let g_adc = 1e-7; // 10 MΩ

        let stamp_g = |matrix: &mut SparseMatrix, r: usize, c: usize, g: f64| {
            if r > 0 && c > 0 {
                matrix.add_element(r - 1, c - 1, g);
            }
        };

        // Pin_In a GND
        stamp_g(&mut matrix_a, pin_in, pin_in, g_in);
        stamp_g(&mut matrix_a, pin_gnd, pin_gnd, g_in);
        stamp_g(&mut matrix_a, pin_in, pin_gnd, -g_in);
        stamp_g(&mut matrix_a, pin_gnd, pin_in, -g_in);

        // Pin_ADC a GND
        stamp_g(&mut matrix_a, pin_adc, pin_adc, g_adc);
        stamp_g(&mut matrix_a, pin_gnd, pin_gnd, g_adc);
        stamp_g(&mut matrix_a, pin_adc, pin_gnd, -g_adc);
        stamp_g(&mut matrix_a, pin_gnd, pin_adc, -g_adc);

        // 2. Alimentación Pin_VCC con consumo dinámico linealizado
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

        let g_vcc_draw = c_eff * f_clk;
        let i_leakage = 1e-6; // 1 uA baseline leakage
        let i_vcc_draw_static = i_baseline + i_leakage;

        let g_vcc = 10.0; // 0.1 Ω internal supply impedance
        let i_vcc_eq = g_vcc * v_cc - i_vcc_draw_static;

        // Estampar conductancia de carril y conductancia de carga dinámica
        let g_vcc_total = g_vcc + g_vcc_draw;
        stamp_g(&mut matrix_a, pin_vcc, pin_vcc, g_vcc_total);
        stamp_g(&mut matrix_a, pin_gnd, pin_gnd, g_vcc_total);
        stamp_g(&mut matrix_a, pin_vcc, pin_gnd, -g_vcc_total);
        stamp_g(&mut matrix_a, pin_gnd, pin_vcc, -g_vcc_total);

        if pin_vcc > 0 {
            vector_z[pin_vcc - 1] += i_vcc_eq;
        }
        if pin_gnd > 0 {
            vector_z[pin_gnd - 1] -= i_vcc_eq;
        }

        // 3. Drivers de Salida con protección activa de sobrecorriente por saturación
        let g_out = 0.05; // 20 Ω
        let i_max = match comp.comp_type.as_str() {
            "arduino_uno" => 0.040, // 40 mA
            _ => 0.012,             // 12 mA
        };

        let v_adc_val = if pin_adc > 0 {
            prev_voltages[pin_adc]
        } else {
            0.0
        };
        let v_gnd_val = if pin_gnd > 0 {
            prev_voltages[pin_gnd]
        } else {
            0.0
        };
        let v_adc_diff = v_adc_val - v_gnd_val;

        let v_out_val = if pin_out > 0 {
            prev_voltages[pin_out]
        } else {
            0.0
        };
        let v_out_diff = v_out_val - v_gnd_val;

        let v_target_out = match mode {
            1 => v_cc,
            2 => {
                let v_threshold = 0.5 * v_cc;
                if v_adc_diff > v_threshold {
                    v_cc
                } else {
                    0.0
                }
            }
            _ => 0.0,
        };

        let i_linear_out = g_out * (v_target_out - v_out_diff);

        let i_stamp_out = if i_linear_out > i_max {
            i_max + g_out * v_out_diff
        } else if i_linear_out < -i_max {
            -i_max + g_out * v_out_diff
        } else {
            g_out * v_target_out
        };

        // Stamp Pin_Out
        stamp_g(&mut matrix_a, pin_out, pin_out, g_out);
        stamp_g(&mut matrix_a, pin_gnd, pin_gnd, g_out);
        stamp_g(&mut matrix_a, pin_out, pin_gnd, -g_out);
        stamp_g(&mut matrix_a, pin_gnd, pin_out, -g_out);

        if pin_out > 0 {
            vector_z[pin_out - 1] += i_stamp_out;
        }
        if pin_gnd > 0 {
            vector_z[pin_gnd - 1] -= i_stamp_out;
        }

        // Stamp Pin_DAC
        let v_dac_val = if pin_dac > 0 {
            prev_voltages[pin_dac]
        } else {
            0.0
        };
        let v_dac_diff = v_dac_val - v_gnd_val;

        let v_target_dac = if mode == 0 || mode == 3 {
            v_adc_diff.clamp(0.0, v_cc)
        } else {
            0.0
        };

        let i_linear_dac = g_out * (v_target_dac - v_dac_diff);

        let (i_stamp_dac, g_transfer) = if i_linear_dac > i_max {
            (i_max + g_out * v_dac_diff, 0.0)
        } else if i_linear_dac < -i_max {
            (-i_max + g_out * v_dac_diff, 0.0)
        } else {
            let g_trans = if mode == 0 || mode == 3 { g_out } else { 0.0 };
            (g_out * v_target_dac, g_trans)
        };

        stamp_g(&mut matrix_a, pin_dac, pin_dac, g_out);
        stamp_g(&mut matrix_a, pin_gnd, pin_gnd, g_out);
        stamp_g(&mut matrix_a, pin_dac, pin_gnd, -g_out);
        stamp_g(&mut matrix_a, pin_gnd, pin_dac, -g_out);

        let i_eq_dac_residue = i_stamp_dac - g_transfer * v_adc_diff;

        if pin_dac > 0 && pin_adc > 0 {
            matrix_a.add_element(pin_dac - 1, pin_adc - 1, -g_transfer);
        }
        if pin_dac > 0 && pin_gnd > 0 {
            matrix_a.add_element(pin_dac - 1, pin_gnd - 1, g_transfer);
        }
        if pin_gnd > 0 && pin_adc > 0 {
            matrix_a.add_element(pin_gnd - 1, pin_adc - 1, g_transfer);
        }
        if pin_gnd > 0 {
            matrix_a.add_element(pin_gnd - 1, pin_gnd - 1, -g_transfer);
        }

        if pin_dac > 0 {
            vector_z[pin_dac - 1] += i_eq_dac_residue;
        }
        if pin_gnd > 0 {
            vector_z[pin_gnd - 1] -= i_eq_dac_residue;
        }
    }
    // B-Sources: Evaluar expresiones y actualizar vector de excitación
}
