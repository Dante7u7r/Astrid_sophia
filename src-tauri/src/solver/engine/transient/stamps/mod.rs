mod behavioral;
mod bipolar;
mod jfet;
mod junctions;
mod logic;
mod mcu;
mod mos;
mod opamp;

use crate::solver::matrix::MixedSignalScheduler;
use crate::solver::types::{CircuitNetlist, ComponentData};
use nalgebra::{DMatrix, DVector};
use std::collections::HashMap;

use super::super::devices::ExprAST;
use super::super::transient_workspace::{BjtBypassState, DiodeBypassState, MosBypassState};

pub(super) struct StampContext<'a> {
    pub(super) netlist: &'a CircuitNetlist,
    pub(super) n: usize,
    pub(super) size: usize,
    pub(super) vsource_map: &'a HashMap<String, usize>,
    pub(super) t: f64,
    pub(super) dt: f64,
    pub(super) t_amb: f64,
    pub(super) prev_v: &'a Vec<f64>,
    pub(super) prev_prev_v: &'a Vec<f64>,
    pub(super) current_solution: &'a DVector<f64>,
    pub(super) solution_iter: &'a DVector<f64>,
    pub(super) device_tjunc: &'a HashMap<String, f64>,
    pub(super) mcu_vdaceff: &'a HashMap<String, f64>,
    pub(super) ms_scheduler: &'a MixedSignalScheduler,
    pub(super) ast_cache_t: &'a mut HashMap<String, ExprAST>,
    pub(super) matrix_a_iter: &'a mut DMatrix<f64>,
    pub(super) vector_z_iter: &'a mut DVector<f64>,
    pub(super) diode_bypass: &'a mut HashMap<String, DiodeBypassState>,
    pub(super) bjt_bypass: &'a mut HashMap<String, BjtBypassState>,
    pub(super) mos_bypass: &'a mut HashMap<String, MosBypassState>,
    pub(super) iter: usize,
}

pub(super) fn stamp_component(comp: &ComponentData, ctx: &mut StampContext<'_>) {
    match comp.comp_type.as_str() {
        "diode" | "led" => junctions::stamp_diode(comp, ctx),
        "opto" => junctions::stamp_opto(comp, ctx),
        "nmos" | "bsim3nmos" | "bsim4nmos" | "sic_mosfet" | "gan_hemt" | "igbt" => {
            mos::stamp_nmos(comp, ctx)
        }
        "pmos" | "bsim3pmos" | "bsim4pmos" => mos::stamp_pmos(comp, ctx),
        "npn" | "pnp" => bipolar::stamp_bipolar(comp, ctx),
        "njf" | "pjf" => jfet::stamp_jfet(comp, ctx),
        "opamp" | "opamp_ideal" | "comparator_ideal" => opamp::stamp_opamp(comp, ctx),
        kind if kind.ends_with("_gate") => logic::stamp_logic(comp, ctx),
        "arduino_uno" | "esp32" | "raspberry_pi_pico" | "atmega328p" | "mcu_avr" | "mcu_8051"
        | "8051"
            if comp.pins.len() >= 6 =>
        {
            mcu::stamp_mcu(comp, ctx)
        }
        _ => {}
    }
}

pub(super) fn stamp_behavioral_sources(ctx: &mut StampContext<'_>) {
    behavioral::stamp_behavioral_sources(ctx);
}
