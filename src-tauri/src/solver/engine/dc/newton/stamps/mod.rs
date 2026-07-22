mod behavioral;
mod bipolar;
mod jfet;
mod junctions;
mod logic;
mod mcu;
mod mos;
mod opamp;
mod switches;

use crate::solver::matrix::SparseMatrix;
use crate::solver::types::{CircuitNetlist, ComponentData};
use nalgebra::DVector;
use std::collections::HashMap;

use super::super::super::devices::ExprAST;

pub(super) struct StampContext<'a> {
    pub(super) netlist: &'a CircuitNetlist,
    pub(super) n: usize,
    pub(super) size: usize,
    pub(super) vsource_map: &'a HashMap<String, usize>,
    pub(super) vt: f64,
    pub(super) is_temp: f64,
    pub(super) alpha: f64,
    pub(super) prev_voltages: &'a Vec<f64>,
    pub(super) prev_prev_voltages: &'a Vec<f64>,
    pub(super) solution: &'a DVector<f64>,
    pub(super) switch_frozen_states: &'a HashMap<String, bool>,
    pub(super) ast_cache: &'a mut HashMap<String, ExprAST>,
    pub(super) matrix_a: &'a mut SparseMatrix,
    pub(super) vector_z: &'a mut DVector<f64>,
}

pub(super) fn stamp_component(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    match comp.comp_type.as_str() {
        "diode" | "led" => junctions::stamp_diode(comp, ctx),
        "opto" => junctions::stamp_opto(comp, ctx),
        "verilog_a" => behavioral::stamp_verilog_a(comp, ctx),
        "nmos" | "bsim3nmos" | "bsim4nmos" => mos::stamp_nmos(comp, ctx),
        "pmos" | "bsim3pmos" | "bsim4pmos" => mos::stamp_pmos(comp, ctx),
        "npn" | "pnp" => bipolar::stamp_bipolar(comp, ctx),
        "njf" | "pjf" => jfet::stamp_jfet(comp, ctx),
        "opamp" => opamp::stamp_opamp(comp, ctx),
        kind if kind.ends_with("_gate") => logic::stamp_logic_gate(comp, ctx),
        "arduino_uno" | "esp32" | "raspberry_pi_pico" => mcu::stamp_mcu(comp, ctx),
        "switch" => switches::stamp_switch(comp, ctx),
        "bvoltage" => behavioral::stamp_bvoltage(comp, ctx),
        "bcurrent" => behavioral::stamp_bcurrent(comp, ctx),
        _ => {}
    }
}
