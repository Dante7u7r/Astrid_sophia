use crate::solver::matrix::{MixedSignalEvent, MixedSignalEventType, MixedSignalScheduler};
use crate::solver::types::{CircuitNetlist, ComponentData};
use crate::solver::engine::transient_mixed_signal::{
    initialize_mixed_signal_scheduler, process_mixed_signal_events,
};

#[test]
fn simultaneous_events_preserve_fifo_order() {
    let mut scheduler = MixedSignalScheduler::new();
    for (component_id, new_state) in [("first", false), ("second", true)] {
        scheduler.schedule_event(MixedSignalEvent {
            time: 1e-6,
            component_id: component_id.to_string(),
            event_type: MixedSignalEventType::LogicOutputTransition {
                pin_idx: 2,
                new_state,
            },
        });
    }

    assert_eq!(
        scheduler
            .events
            .iter()
            .map(|event| event.component_id.as_str())
            .collect::<Vec<_>>(),
        ["first", "second"],
        "los eventos con el mismo timestamp deben mantener el orden de inserción",
    );
}

#[test]
fn simultaneous_and_inputs_leave_the_output_high() {
    let gate = ComponentData {
        id: "U_AND".to_string(),
        comp_type: "and_gate".to_string(),
        value: 0.0,
        pins: vec!["1".to_string(), "1".to_string(), "2".to_string()],
        delay: Some(10e-9),
        ..Default::default()
    };
    let netlist = CircuitNetlist {
        components: vec![gate],
        ..Default::default()
    };
    let mut scheduler = initialize_mixed_signal_scheduler(&netlist);
    for pin_idx in [0, 1] {
        scheduler.schedule_event(MixedSignalEvent {
            time: 1e-6,
            component_id: "U_AND".to_string(),
            event_type: MixedSignalEventType::LogicInputCrossing {
                pin_idx,
                direction: true,
            },
        });
    }

    process_mixed_signal_events(&netlist, &mut scheduler, 2e-6);

    assert!(scheduler.get_state("U_AND", 0));
    assert!(scheduler.get_state("U_AND", 1));
    assert!(
        scheduler.get_state("U_AND", 2),
        "dos entradas HIGH simultáneas no deben dejar la salida AND en LOW",
    );
}
