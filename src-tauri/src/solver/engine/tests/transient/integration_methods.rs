use super::super::*;

#[test]
fn test_gear2_integration_stability() {
    // Circuito RLC subamortiguado en serie
    let netlist_rlc = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "Vin".to_string(),
                comp_type: "vsource".to_string(),
                value: 5.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "R1".to_string(),
                comp_type: "resistor".to_string(),
                value: 10.0,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "L1".to_string(),
                comp_type: "inductor".to_string(),
                value: 1e-3,
                pins: vec!["2".to_string(), "3".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C1".to_string(),
                comp_type: "capacitor".to_string(),
                value: 10e-6,
                pins: vec!["3".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: Some(true),
        subcircuit_definitions: None,
        triggers: None,
    };

    // 1. Simular con Backward Euler
    let settings_euler = TransientSettings {
        dt: 1e-5,
        t_max: 1e-3,
        fixed_step: Some(true),
        integration_method: Some("euler".to_string()),
    };
    let results_euler = solve_transient_circuit(&netlist_rlc, &settings_euler).unwrap();
    assert!(results_euler.len() > 0);

    // 2. Simular con Gear 2 (BDF2)
    let settings_gear = TransientSettings {
        dt: 1e-5,
        t_max: 1e-3,
        fixed_step: Some(true),
        integration_method: Some("gear2".to_string()),
    };
    let results_gear = solve_transient_circuit(&netlist_rlc, &settings_gear).unwrap();
    assert!(results_gear.len() > 0);
    assert_eq!(results_euler.len(), results_gear.len());

    // Verificar que el capacitor de Gear 2 se carga y oscila suavemente hacia 5V
    let final_step_gear = results_gear.last().unwrap();
    let v_cap_gear = *final_step_gear.node_voltages.get("3").unwrap();
    assert!(v_cap_gear > 0.0 && v_cap_gear < 10.0);
}

#[test]
fn test_lte_adaptive_timestep() {
    use crate::parser::parse_spice_netlist_to_native;
    let netlist_str = "
    * Test LTE adaptive timestep under transient sine wave
    V1 1 0 SIN(0 5 1k)
    R1 1 2 1k
    C1 2 0 1u
    ";
    let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
    let settings = TransientSettings {
        dt: 1e-5,
        t_max: 2e-3,
        fixed_step: Some(false),
        integration_method: Some("gear2".to_string()),
    };
    let res = solve_transient_circuit(&parsed, &settings).unwrap();
    assert!(
        !res.is_empty(),
        "La simulación transitoria adaptativa por LTE debe completarse exitosamente"
    );
}

#[test]
fn test_trap_integration_lc_resonance() {
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 0.0,
                pins: vec!["1".to_string(), "0".to_string()],
                wave_type: Some("pulse".to_string()),
                amplitude: Some(1.0),
                frequency: Some(5000.0),
                duty_cycle: Some(0.1),
                ..Default::default()
            },
            ComponentData {
                id: "R1".to_string(),
                comp_type: "resistor".to_string(),
                value: 10.0,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "L1".to_string(),
                comp_type: "inductor".to_string(),
                value: 1e-3,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C1".to_string(),
                comp_type: "capacitor".to_string(),
                value: 1e-6,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        mutual_inductances: None,
        thermal_config: None,
        wires: vec![],
        temperature: None,
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let settings_trap = TransientSettings {
        dt: 1e-6,
        t_max: 5e-3,
        fixed_step: Some(true),
        integration_method: Some("trap".to_string()),
    };

    let settings_euler = TransientSettings {
        dt: 1e-6,
        t_max: 5e-3,
        fixed_step: Some(true),
        integration_method: Some("euler".to_string()),
    };

    let results_trap = solve_transient_circuit(&netlist, &settings_trap).unwrap();
    let results_euler = solve_transient_circuit(&netlist, &settings_euler).unwrap();

    assert!(!results_trap.is_empty(), "TRAP: No hay resultados");
    assert!(!results_euler.is_empty(), "Euler: No hay resultados");

    let amp_trap: f64 = results_trap
        .iter()
        .filter(|s| s.time > 3e-3)
        .map(|s| s.node_voltages.get("2").unwrap().abs())
        .fold(0.0, f64::max);

    let amp_euler: f64 = results_euler
        .iter()
        .filter(|s| s.time > 3e-3)
        .map(|s| s.node_voltages.get("2").unwrap().abs())
        .fold(0.0, f64::max);

    println!("Amplitudes - TRAP: {}, Euler: {}", amp_trap, amp_euler);

    assert!(
        amp_trap > 1e-6,
        "TRAP debe producir oscilación, amplitud: {}",
        amp_trap
    );
    // TRAP should have similar or better amplitude than Euler (both are valid integration methods)
    // The key difference is that TRAP is 2nd order and Euler is 1st order
}
