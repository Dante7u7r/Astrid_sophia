use crate::solver::matrix::SparseMatrix;
use crate::solver::types::ComponentData;

use super::StampContext;

pub(super) fn stamp_opamp(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let prev_voltages = ctx.prev_voltages;
    let matrix_a = &mut *ctx.matrix_a;
    let vector_z = &mut *ctx.vector_z;
    let pin_in_pos = comp.pins[0].parse::<usize>().unwrap();
    let pin_in_neg = comp.pins[1].parse::<usize>().unwrap();
    let pin_vplus = comp.pins[2].parse::<usize>().unwrap();
    let pin_vminus = comp.pins[3].parse::<usize>().unwrap();
    let pin_out = comp.pins[4].parse::<usize>().unwrap();

    // Obtener voltajes previos
    let v_in_pos = if pin_in_pos > 0 {
        prev_voltages[pin_in_pos]
    } else {
        0.0
    };
    let v_in_neg = if pin_in_neg > 0 {
        prev_voltages[pin_in_neg]
    } else {
        0.0
    };
    let v_vplus = if pin_vplus > 0 {
        prev_voltages[pin_vplus]
    } else {
        15.0
    };
    let v_vminus = if pin_vminus > 0 {
        prev_voltages[pin_vminus]
    } else {
        -15.0
    };

    let v_diff = v_in_pos - v_in_neg;
    let mut v_span = v_vplus - v_vminus;
    let mut v_mid = 0.5 * (v_vplus + v_vminus);

    // Prevenir división por cero si no hay alimentación conectada
    if v_span.abs() < 1e-3 {
        v_span = 30.0;
        v_mid = 0.0;
    }

    let a_ol = 1e5; // Ganancia de lazo abierto
    let r_in = 1e7; // 10 Mohm
    let r_out = 100.0; // 100 ohm
    let g_out = 1.0 / r_out;
    let g_in = 1.0 / r_in;

    // 1. Estampar conductancia de entrada diferencial R_in
    let mut stamp_conductance = |r: usize, c: usize, g: f64| {
        if r > 0 && c > 0 {
            matrix_a.add_element(r - 1, c - 1, g);
        }
    };
    stamp_conductance(pin_in_pos, pin_in_pos, g_in);
    stamp_conductance(pin_in_neg, pin_in_neg, g_in);
    stamp_conductance(pin_in_pos, pin_in_neg, -g_in);
    stamp_conductance(pin_in_neg, pin_in_pos, -g_in);

    // 2. Calcular V_int_ctrl no lineal con tanh
    let arg = (a_ol * v_diff) / v_span;
    let tanh_val = arg.tanh();
    let v_int_ctrl = v_mid + 0.5 * v_span * tanh_val;

    // Derivada de V_int_ctrl respecto a V_diff:
    // d(V_int)/d(V_diff) = 0.5 * A_ol * (1 - tanh^2)
    let g_m_int = 0.5 * a_ol * (1.0 - tanh_val * tanh_val);
    let g_m_opamp = g_out * g_m_int;

    // Corriente equivalente de Norton a inyectar en pin_out
    let ieq = g_out * v_int_ctrl - g_m_opamp * v_diff;

    // 3. Estampar en MNA
    // Conductancia de salida
    if pin_out > 0 {
        matrix_a.add_element(pin_out - 1, pin_out - 1, g_out);

        // Transconductancias gm controladas en la fila de pin_out
        if pin_in_pos > 0 {
            matrix_a.add_element(pin_out - 1, pin_in_pos - 1, -g_m_opamp);
        }
        if pin_in_neg > 0 {
            matrix_a.add_element(pin_out - 1, pin_in_neg - 1, g_m_opamp);
        }

        // Inyección de corriente equivalente en vector Z
        vector_z[pin_out - 1] += ieq;
    }
}

pub(super) fn stamp_logic_gate(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let alpha = ctx.alpha;
    let prev_voltages = ctx.prev_voltages;
    let matrix_a = &mut *ctx.matrix_a;
    let vector_z = &mut *ctx.vector_z;
    let is_not = comp.comp_type == "not_gate";

    let (pin_in_a, pin_in_b, pin_out) = if is_not {
        let pa = comp.pins[0].parse::<usize>().unwrap();
        let po = comp.pins[1].parse::<usize>().unwrap();
        (pa, 0, po)
    } else {
        let pa = comp.pins[0].parse::<usize>().unwrap();
        let pb = comp.pins[1].parse::<usize>().unwrap();
        let po = comp.pins[2].parse::<usize>().unwrap();
        (pa, pb, po)
    };

    let v_a = if pin_in_a > 0 {
        prev_voltages[pin_in_a]
    } else {
        0.0
    };
    let v_b = if pin_in_b > 0 {
        prev_voltages[pin_in_b]
    } else {
        0.0
    };

    let v_a_clamped = v_a.clamp(0.0, 5.0);
    let v_b_clamped = v_b.clamp(0.0, 5.0);

    let val_a = 1.0 / (1.0 + (-(v_a_clamped - 1.4) / 0.15).exp());
    let val_b = 1.0 / (1.0 + (-(v_b_clamped - 1.4) / 0.15).exp());

    let logic_out = match comp.comp_type.as_str() {
        "and_gate" => val_a * val_b,
        "or_gate" => val_a + val_b - val_a * val_b,
        "not_gate" => 1.0 - val_a,
        "nand_gate" => 1.0 - (val_a * val_b),
        "nor_gate" => (1.0 - val_a) * (1.0 - val_b),
        "xor_gate" => val_a * (1.0 - val_b) + val_b * (1.0 - val_a),
        _ => 0.0,
    };

    let v_oh = 5.0 * alpha;
    let v_out_ideal = logic_out * v_oh;

    let r_out = 50.0;
    let g_out = 1.0 / r_out;
    let ieq = v_out_ideal / r_out;

    if pin_out > 0 {
        matrix_a.add_element(pin_out - 1, pin_out - 1, g_out);
        vector_z[pin_out - 1] += ieq;
    }
}

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

pub(super) fn stamp_switch(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let switch_frozen_states = ctx.switch_frozen_states;
    let matrix_a = &mut *ctx.matrix_a;
    // Frozen-state stamping: state determined before NR loop from initial_guess
    let node_a = comp.pins[0].parse::<usize>().unwrap();
    let node_b = comp.pins[1].parse::<usize>().unwrap();
    let ron = comp.switch_ron.unwrap_or(0.01);
    let roff = comp.switch_roff.unwrap_or(1e9);
    let is_closed = switch_frozen_states.get(&comp.id).copied().unwrap_or(false);
    let conductance = 1.0 / if is_closed { ron } else { roff };

    let mut stamp_conductance = |r: usize, c: usize, g: f64| {
        if r > 0 && c > 0 {
            matrix_a.add_element(r - 1, c - 1, g);
        }
    };

    stamp_conductance(node_a, node_a, conductance);
    stamp_conductance(node_b, node_b, conductance);
    stamp_conductance(node_a, node_b, -conductance);
    stamp_conductance(node_b, node_a, -conductance);
}
