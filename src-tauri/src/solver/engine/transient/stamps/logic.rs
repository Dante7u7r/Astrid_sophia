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
    let v_ol = 0.0;
    let v_target = if state_out { v_oh } else { v_ol };

    let r_out = comp.gate_rout.or(comp.dcr).unwrap_or(50.0).max(0.1);
    let g_out = 1.0 / r_out;

    let v_out_continuous = if comp.gate_trise.is_some() || comp.gate_tfall.is_some() {
        let v_prev = if pin_out > 0 && pin_out <= ctx.current_solution.len() {
            ctx.current_solution[pin_out - 1]
        } else {
            v_target
        };

        let trise = comp.gate_trise.unwrap_or(5e-9).max(1e-15);
        let tfall = comp.gate_tfall.unwrap_or(5e-9).max(1e-15);
        let dt = ctx.dt.max(1e-18);

        let max_dv = if v_target > v_prev {
            ((v_oh - v_ol).abs() / trise) * dt
        } else {
            ((v_oh - v_ol).abs() / tfall) * dt
        };

        let delta_v = v_target - v_prev;
        if max_dv > 1e-15 {
            v_prev + max_dv * (delta_v / max_dv).tanh()
        } else {
            v_target
        }
    } else {
        v_target
    };

    let ieq = v_out_continuous / r_out;

    if pin_out > 0 {
        matrix_a_iter[(pin_out - 1, pin_out - 1)] += g_out;
        vector_z_iter[pin_out - 1] += ieq;
    }
}
