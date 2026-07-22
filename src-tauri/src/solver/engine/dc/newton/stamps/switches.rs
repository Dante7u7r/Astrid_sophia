use crate::solver::types::ComponentData;

use super::StampContext;

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
