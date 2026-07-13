use super::*;

#[test]
fn test_logic_gate_configurable_delays() {
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 0.0,
                pins: vec!["1".to_string(), "0".to_string()],
                wave_type: Some("pulse".to_string()),
                amplitude: Some(5.0),
                frequency: Some(500.0), // Periodo de 2 ms (1 ms en HIGH, 1 ms en LOW)
                offset: Some(0.0),
                duty_cycle: Some(0.5),
                ..Default::default()
            },
            ComponentData {
                id: "U1".to_string(),
                comp_type: "not_gate".to_string(),
                value: 0.0,
                pins: vec!["1".to_string(), "2".to_string()], // inversor
                delay: Some(10e-9),
                rise_delay: Some(15e-9),
                fall_delay: Some(25e-9),
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: Some(false),
        subcircuit_definitions: None,
        triggers: None,
    };

    let settings = TransientSettings {
        dt: 1e-6,
        t_max: 2e-3,
        integration_method: Some("euler".to_string()),
        fixed_step: Some(false),
    };

    let (results, _, _) = solve_transient_circuit_with_initial_states(
        &netlist,
        &settings,
        HashMap::new(),
        HashMap::new(),
    )
    .unwrap();
    assert!(results.len() > 20);

    let mut verified_fall_success = false;
    let mut verified_rise_success = false;

    for step in &results {
        let v2 = *step.node_voltages.get("2").unwrap();

        // Flanco de bajada (entrada sube a t=0.0, salida baja tras fall_delay=25ns)
        // A t=1us, el transitorio ya procesó la bajada a LOW (0V)
        if (step.time - 1e-6).abs() < 1e-9 {
            assert!(
                v2 < 0.5,
                "Salida U1 (inversor) en t=1us debería ser LOW (0V) tras fall_delay, obtenido: {}",
                v2
            );
            verified_fall_success = true;
        }

        // Flanco de subida (entrada baja a t=1.0ms, salida sube tras rise_delay=15ns)
        // A t=1.002ms (segundo paso tras bajada), la salida ya es HIGH (5V)
        if step.time > 1.002e-3 && step.time < 1.9e-3 {
            assert!(
                v2 > 4.5,
                "Salida U1 (inversor) en t={} debería ser HIGH (5V) tras rise_delay, obtenido: {}",
                step.time,
                v2
            );
            verified_rise_success = true;
        }
    }

    assert!(
        verified_fall_success,
        "No se pudo verificar el retardo de bajada"
    );
    assert!(
        verified_rise_success,
        "No se pudo verificar el retardo de subida"
    );
}

#[test]
fn test_mixed_signal_scheduler_event_sync() {
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 5.0,
                pins: vec!["1".to_string(), "0".to_string()],
                wave_type: Some("pulse".to_string()),
                amplitude: Some(5.0),
                frequency: Some(1e3),
                offset: Some(0.0),
                duty_cycle: Some(0.5),
                ..Default::default()
            },
            ComponentData {
                id: "U1".to_string(),
                comp_type: "not_gate".to_string(),
                value: 0.0,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: Some(false),
        subcircuit_definitions: None,
        triggers: None,
    };

    let settings = TransientSettings {
        dt: 1e-4,
        t_max: 2e-3,
        integration_method: Some("euler".to_string()),
        fixed_step: Some(false),
    };

    let (results, _, _) = solve_transient_circuit_with_initial_states(
        &netlist,
        &settings,
        HashMap::new(),
        HashMap::new(),
    )
    .unwrap();
    assert!(results.len() > 20);

    let mut checked_high = false;
    let mut checked_low = false;

    for step in &results {
        if step.time > 0.1e-3 && step.time < 0.4e-3 {
            let v2 = *step.node_voltages.get("2").unwrap();
            assert!(v2 < 0.5, "Salida de inversor LOW falló, obtenido: {}", v2);
            checked_low = true;
        }
        if step.time > 0.7e-3 && step.time < 0.9e-3 {
            let v2 = *step.node_voltages.get("2").unwrap();
            assert!(v2 > 4.0, "Salida de inversor HIGH falló, obtenido: {}", v2);
            checked_high = true;
        }
    }
    assert!(checked_high && checked_low);
}

#[test]
fn test_mcu_discrete_clock_blink() {
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![ComponentData {
            id: "MCU1".to_string(),
            comp_type: "arduino_uno".to_string(),
            value: 1.0,
            pins: vec![
                "1".to_string(),
                "2".to_string(),
                "3".to_string(),
                "4".to_string(),
                "5".to_string(),
                "0".to_string(),
            ],
            ..Default::default()
        }],
        wires: vec![],
        temperature: None,
        fixed_step: Some(false),
        subcircuit_definitions: None,
        triggers: None,
    };

    let settings = TransientSettings {
        dt: 1e-3,
        t_max: 1.2,
        integration_method: Some("euler".to_string()),
        fixed_step: Some(false),
    };

    let (results, _, _) = solve_transient_circuit_with_initial_states(
        &netlist,
        &settings,
        HashMap::new(),
        HashMap::new(),
    )
    .unwrap();

    let mut checked_high = false;
    let mut checked_low = false;

    for step in &results {
        if step.time > 0.1 && step.time < 0.4 {
            let v2 = *step.node_voltages.get("2").unwrap();
            assert!(v2 > 4.5, "Blink HIGH falló, obtenido: {}", v2);
            checked_high = true;
        }
        if step.time > 0.6 && step.time < 0.9 {
            let v2 = *step.node_voltages.get("2").unwrap();
            assert!(v2 < 0.5, "Blink LOW falló, obtenido: {}", v2);
            checked_low = true;
        }
    }
    assert!(checked_high && checked_low);
}
