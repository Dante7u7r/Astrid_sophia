use super::StampContext;
use crate::solver::types::ComponentData;

pub(super) fn stamp_logic(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    let ms_scheduler = ctx.ms_scheduler;
    let matrix_a_iter = &mut *ctx.matrix_a_iter;
    let vector_z_iter = &mut *ctx.vector_z_iter;
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
}
