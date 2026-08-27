mod bipolar;
mod jfet;
mod junctions;
mod mos;

use crate::solver::matrix::SparseMatrix;
use crate::solver::types::{CircuitNetlist, ComponentData};
use nalgebra::DVector;

pub(crate) struct StampContext<'a> {
    pub(crate) netlist: &'a CircuitNetlist,
    pub(crate) vt: f64,
    pub(crate) is_temp: f64,
    pub(crate) prev_voltages: &'a Vec<f64>,
    pub(crate) prev_prev_voltages: &'a Vec<f64>,
    pub(crate) matrix_a: &'a mut SparseMatrix,
    pub(crate) vector_z: &'a mut DVector<f64>,
}

pub(crate) fn stamp_component(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    match comp.comp_type.as_str() {
        "diode" | "led" => junctions::stamp_diode(comp, ctx),
        "opto" => junctions::stamp_opto(comp, ctx),
        "nmos" | "bsim3nmos" | "bsim4nmos" | "sic_mosfet" | "gan_hemt" | "igbt" => {
            mos::stamp_nmos(comp, ctx)
        }
        "pmos" | "bsim3pmos" | "bsim4pmos" => mos::stamp_pmos(comp, ctx),
        "jfet" | "njf" | "pjf" => jfet::stamp_jfet(comp, ctx),
        "npn" | "pnp" => bipolar::stamp_bipolar(comp, ctx),
        _ => {}
    }
}
