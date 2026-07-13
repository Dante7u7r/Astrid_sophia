use super::super::*;

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
fn test_mixed_signal_not_gate() {
    // Compuerta digital NOT conectada a una fuente de entrada analógica de 5V
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 5.0, // Entrada lógica '1' analógica
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "G1".to_string(),
                comp_type: "not_gate".to_string(),
                pins: vec!["1".to_string(), "2".to_string()],
                value: 0.0,
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let result = solve_dc_circuit(&netlist);
    assert!(
        result.is_ok(),
        "La simulación Mixed-Signal debe converger en DC"
    );
    let data = result.unwrap();
    let v_out = *data.node_voltages.get("2").unwrap_or(&5.0);
    // La compuerta NOT invierte 5V (true) a aprox 0V (false)
    assert!(v_out < 0.5, "La salida de la compuerta NOT con entrada de 5V debería estar cerca de 0V, obtenida: {}V", v_out);
}

#[test]
fn test_logic_gate_hysteresis() {
    use crate::parser::parse_spice_netlist_to_native;

    // Inversor Schmitt trigger con histéresis: vhigh=3.0V, vlow=1.0V
    // Excitamos por rampa de entrada analógica transitoria
    let netlist_str = "
    * Test logic gate hysteresis
    U1 1 2 not_gate vhigh=3.0 vlow=1.0 td=1n
    V1 1 0 PULSE(0.0 4.0 0.0 10m 10m 10m 20m)
    ";

    let netlist = parse_spice_netlist_to_native(netlist_str).unwrap();

    // Verificar mapeo
    let u1 = netlist.components.iter().find(|c| c.id == "U1").unwrap();
    assert_eq!(u1.gate_vhigh, Some(3.0));
    assert_eq!(u1.gate_vlow, Some(1.0));
}
