use crate::solver::types::ComponentData;

use super::StampContext;

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
