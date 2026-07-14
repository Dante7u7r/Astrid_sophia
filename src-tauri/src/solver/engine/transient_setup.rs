use crate::solver::types::{CircuitNetlist, ComponentData};
use std::collections::HashMap;

pub(crate) struct EnergyStorageState {
    pub cap_states: HashMap<String, f64>,
    pub ind_states: HashMap<String, f64>,
    pub cap_states_prev: HashMap<String, f64>,
    pub ind_states_prev: HashMap<String, f64>,
    pub cap_currents: HashMap<String, f64>,
    pub ind_voltages: HashMap<String, f64>,
    pub switch_states: HashMap<String, bool>,
}

pub(crate) struct McuTransientState {
    pub mcu_tchip: HashMap<String, f64>,
    pub mcu_vsample: HashMap<String, f64>,
    pub mcu_vdaceff: HashMap<String, f64>,
}

pub(crate) fn initialize_energy_storage_states(
    netlist: &CircuitNetlist,
    cap_init: &HashMap<String, f64>,
    ind_init: &HashMap<String, f64>,
) -> EnergyStorageState {
    let mut cap_states = HashMap::new();
    let mut ind_states = HashMap::new();
    let mut cap_states_prev = HashMap::new();
    let mut ind_states_prev = HashMap::new();
    let mut cap_currents = HashMap::new();
    let mut ind_voltages = HashMap::new();
    let mut switch_states = HashMap::new();

    let ic_map = initial_condition_map(netlist);
    let has_ic = !ic_map.is_empty();

    for comp in &netlist.components {
        if comp.comp_type == "capacitor" {
            let val = if has_ic {
                capacitor_initial_voltage(comp, &ic_map)
            } else {
                *cap_init.get(&comp.id).unwrap_or(&0.0)
            };
            cap_states.insert(comp.id.clone(), val);
            cap_states_prev.insert(comp.id.clone(), val);
            cap_currents.insert(comp.id.clone(), 0.0);
        } else if comp.comp_type == "inductor" {
            let val = *ind_init.get(&comp.id).unwrap_or(&0.0);
            ind_states.insert(comp.id.clone(), val);
            ind_states_prev.insert(comp.id.clone(), val);
            ind_voltages.insert(comp.id.clone(), 0.0);
        } else if comp.comp_type == "switch" {
            switch_states.insert(comp.id.clone(), comp.switch_state.unwrap_or(false));
        }
    }

    EnergyStorageState {
        cap_states,
        ind_states,
        cap_states_prev,
        ind_states_prev,
        cap_currents,
        ind_voltages,
        switch_states,
    }
}

pub(crate) fn has_transient_nonlinearity(netlist: &CircuitNetlist) -> bool {
    netlist.components.iter().any(|c| {
        c.comp_type == "diode"
            || c.comp_type == "led"
            || c.comp_type == "opto"
            || c.comp_type == "nmos"
            || c.comp_type == "pmos"
            || c.comp_type == "npn"
            || c.comp_type == "pnp"
            || c.comp_type == "opamp"
            || c.comp_type == "bsim3nmos"
            || c.comp_type == "bsim3pmos"
            || c.comp_type == "bsim4nmos"
            || c.comp_type == "bsim4pmos"
            || c.comp_type.ends_with("_gate")
            || is_mcu_component(c)
            || c.comp_type == "bvoltage"
            || c.comp_type == "bcurrent"
            || c.comp_type == "njf"
            || c.comp_type == "pjf"
            || c.comp_type == "switch"
    })
}

pub(crate) fn initialize_mcu_transient_state(
    netlist: &CircuitNetlist,
    t_amb: f64,
) -> McuTransientState {
    let mut mcu_tchip = HashMap::new();
    let mut mcu_vsample = HashMap::new();
    let mut mcu_vdaceff = HashMap::new();

    for comp in &netlist.components {
        if is_mcu_component(comp) {
            mcu_tchip.insert(comp.id.clone(), t_amb);
            mcu_vsample.insert(comp.id.clone(), 0.0);
            mcu_vdaceff.insert(comp.id.clone(), 0.0);
        }
    }

    McuTransientState {
        mcu_tchip,
        mcu_vsample,
        mcu_vdaceff,
    }
}

pub(crate) fn initialize_device_junction_temperatures(
    netlist: &CircuitNetlist,
    t_amb: f64,
) -> HashMap<String, f64> {
    let mut device_tjunc = HashMap::new();
    for comp in &netlist.components {
        if uses_self_heating(comp) {
            device_tjunc.insert(comp.id.clone(), t_amb);
        }
    }
    device_tjunc
}

fn initial_condition_map(netlist: &CircuitNetlist) -> HashMap<String, f64> {
    let mut ic_map = HashMap::new();
    for comp in &netlist.components {
        if comp.comp_type == "ic_directive" {
            if let Some(node) = comp.pins.first() {
                ic_map.insert(node.clone(), comp.value);
            }
        }
    }
    ic_map
}

fn capacitor_initial_voltage(comp: &ComponentData, ic_map: &HashMap<String, f64>) -> f64 {
    let pin_a = &comp.pins[0];
    let pin_b = &comp.pins[1];
    let v_a = if pin_a == "0" {
        0.0
    } else {
        *ic_map.get(pin_a).unwrap_or(&0.0)
    };
    let v_b = if pin_b == "0" {
        0.0
    } else {
        *ic_map.get(pin_b).unwrap_or(&0.0)
    };
    v_a - v_b
}

fn is_mcu_component(comp: &ComponentData) -> bool {
    comp.comp_type == "arduino_uno"
        || comp.comp_type == "esp32"
        || comp.comp_type == "raspberry_pi_pico"
}

fn uses_self_heating(comp: &ComponentData) -> bool {
    comp.comp_type == "diode"
        || comp.comp_type == "led"
        || comp.comp_type == "nmos"
        || comp.comp_type == "pmos"
        || comp.comp_type == "npn"
        || comp.comp_type == "pnp"
        || comp.comp_type == "bsim3nmos"
        || comp.comp_type == "bsim3pmos"
        || comp.comp_type == "bsim4nmos"
        || comp.comp_type == "bsim4pmos"
        || comp.comp_type == "njf"
        || comp.comp_type == "pjf"
        || comp.comp_type == "opto"
}
