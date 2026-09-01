use super::super::*;
use crate::solver::engine::transient_setup::{drain_live_overrides, ComponentOverrideMap};
use std::sync::{Arc, Mutex};

fn resistor_mutation(run_id: u64, value: f64) -> crate::ComponentMutation {
    crate::ComponentMutation {
        component_id: "R2".to_string(),
        field: "value".to_string(),
        value,
        run_id,
    }
}

#[test]
fn live_override_drain_reports_only_changes_for_the_active_run() {
    let pending = Arc::new(Mutex::new(vec![
        resistor_mutation(10, 4_000.0),
        resistor_mutation(11, 2_000.0),
        resistor_mutation(12, 8_000.0),
    ]));
    let queue = Some(Arc::clone(&pending));
    let mut current_overrides = ComponentOverrideMap::new();

    assert!(drain_live_overrides(
        &mut current_overrides,
        &queue,
        Some(11)
    ));
    assert_eq!(current_overrides["R2"]["value"], 2_000.0);
    assert!(!drain_live_overrides(
        &mut current_overrides,
        &queue,
        Some(11)
    ));

    // Reenviar el mismo valor no invalida una factorización que sigue siendo válida.
    pending.lock().unwrap().push(resistor_mutation(11, 2_000.0));
    assert!(!drain_live_overrides(
        &mut current_overrides,
        &queue,
        Some(11)
    ));
    pending.lock().unwrap().push(resistor_mutation(11, 3_000.0));
    assert!(drain_live_overrides(
        &mut current_overrides,
        &queue,
        Some(11)
    ));
    assert_eq!(current_overrides["R2"]["value"], 3_000.0);

    // La corrida actual no aplica ni descarta los mensajes de otras corridas.
    let mut future_overrides = ComponentOverrideMap::new();
    assert!(drain_live_overrides(
        &mut future_overrides,
        &queue,
        Some(12)
    ));
    assert_eq!(future_overrides["R2"]["value"], 8_000.0);
    assert_eq!(current_overrides["R2"]["value"], 3_000.0);
    let remaining = pending.lock().unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!((remaining[0].run_id, remaining[0].value), (10, 4_000.0));
}

#[test]
fn live_resistor_update_invalidates_fixed_step_factorization() {
    // Divisor ideal referido a GND: V2 = 5 R2 / (R1 + R2).
    // R1 = 1 kohm, R2 = 1 kohm hasta t=3 ms y 2 kohm desde t=4 ms.
    // Sin reactivos: cada paso debe satisfacer KCL, sin error de integración.
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 5.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "R1".to_string(),
                comp_type: "resistor".to_string(),
                value: 1_000.0,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "R2".to_string(),
                comp_type: "resistor".to_string(),
                value: 1_000.0,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        ..Default::default()
    };
    let pending = Arc::new(Mutex::new(vec![
        resistor_mutation(10, 4_000.0),
        resistor_mutation(12, 8_000.0),
    ]));
    let callback_pending = Arc::clone(&pending);
    let mut samples = Vec::new();

    solve_transient_circuit_inner(
        &netlist,
        &TransientSettings {
            dt: 1e-3,
            t_max: 8e-3,
            fixed_step: Some(true),
            integration_method: Some("BE".to_string()),
        },
        HashMap::new(),
        HashMap::new(),
        crate::solver::SolverNumericalSettings::default(),
        Some(Arc::clone(&pending)),
        Some(11),
        Some(|step: &TimeStepResult| {
            samples.push(step.clone());
            if samples.len() == 3 {
                callback_pending
                    .lock()
                    .unwrap()
                    .push(resistor_mutation(11, 2_000.0));
            }
            true
        }),
    )
    .expect("La mutación resistiva debe permitir completar el transitorio");

    assert_eq!(samples.len(), 8);
    for (index, sample) in samples.iter().enumerate() {
        let r2 = if index < 3 { 1_000.0 } else { 2_000.0 };
        let expected_voltage = 5.0 * r2 / (1_000.0 + r2);
        let v1 = sample.node_voltages["1"];
        let v2 = sample.node_voltages["2"];
        assert!(
            (sample.time - (index + 1) as f64 * 1e-3).abs() < 1e-12,
            "La mutación no debe reiniciar ni alterar el tiempo físico"
        );
        assert!(
            (v2 - expected_voltage).abs() < 1e-8,
            "Paso {} en t={} s: R2={r2} ohm exige {expected_voltage} V, obtenido {v2} V",
            index + 1,
            sample.time
        );
        let kcl_residual = (v1 - v2) / 1_000.0 - v2 / r2;
        assert!(
            kcl_residual.abs() < 1e-11,
            "La mutación debe conservar KCL: residuo={kcl_residual} A en t={} s",
            sample.time
        );
    }

    let remaining = pending.lock().unwrap();
    assert_eq!(remaining.len(), 2);
    assert_eq!((remaining[0].run_id, remaining[0].value), (10, 4_000.0));
    assert_eq!((remaining[1].run_id, remaining[1].value), (12, 8_000.0));
}
