use crate::solver::matrix::{MixedSignalEvent, MixedSignalEventType, MixedSignalScheduler};
use crate::solver::types::CircuitNetlist;

pub(crate) fn initialize_mixed_signal_scheduler(netlist: &CircuitNetlist) -> MixedSignalScheduler {
    let mut scheduler = MixedSignalScheduler::new();
    for comp in &netlist.components {
        if comp.comp_type.ends_with("_gate") {
            let is_not = comp.comp_type == "not_gate";
            let output_pin = if is_not { 1 } else { 2 };
            scheduler.set_state(&comp.id, output_pin, false);
            scheduler
                .last_analog_v
                .entry(comp.id.clone())
                .or_default()
                .insert(0, 0.0);
            if !is_not {
                scheduler
                    .last_analog_v
                    .get_mut(&comp.id)
                    .unwrap()
                    .insert(1, 0.0);
            }
        } else if is_mcu_component_type(&comp.comp_type) {
            scheduler.set_state(&comp.id, 1, false);
            scheduler.schedule_event(MixedSignalEvent {
                time: 0.0,
                component_id: comp.id.clone(),
                event_type: MixedSignalEventType::McuPeriodicTick,
            });
        }
    }
    scheduler
}

fn is_mcu_component_type(comp_type: &str) -> bool {
    comp_type == "arduino_uno" || comp_type == "esp32" || comp_type == "raspberry_pi_pico"
}
