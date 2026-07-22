mod bipolar;
mod field_effect;
mod junctions;

use crate::solver::matrix::SparseMatrix;
use crate::solver::types::{CircuitNetlist, ComponentData};
use nalgebra::DVector;

pub(super) struct StampContext<'a> {
    pub(super) netlist: &'a CircuitNetlist,
    pub(super) vt: f64,
    pub(super) is_temp: f64,
    pub(super) prev_voltages: &'a Vec<f64>,
    pub(super) prev_prev_voltages: &'a Vec<f64>,
    pub(super) matrix_a: &'a mut SparseMatrix,
    pub(super) vector_z: &'a mut DVector<f64>,
}

pub(super) fn stamp_component(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    match comp.comp_type.as_str() {
        "diode" | "led" => junctions::stamp_diode(comp, ctx),
        "opto" => junctions::stamp_opto(comp, ctx),
        "nmos" | "bsim3nmos" | "bsim4nmos" => field_effect::stamp_nmos(comp, ctx),
        "pmos" | "bsim3pmos" | "bsim4pmos" => field_effect::stamp_pmos(comp, ctx),
        "jfet" | "njf" | "pjf" => field_effect::stamp_jfet(comp, ctx),
        "npn" | "pnp" => bipolar::stamp_bipolar(comp, ctx),
        _ => {}
    }
}
