use super::super::*;

#[test]
fn test_rc_transient_circuit() {
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
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
                value: 1000.0,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C1".to_string(),
                comp_type: "capacitor".to_string(),
                value: 10e-6, // 10 µF
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let settings = TransientSettings {
        dt: 0.001,   // 1 ms
        t_max: 0.05, // 50 ms
        fixed_step: None,
        integration_method: None,
    };

    let results = solve_transient_circuit(&netlist, &settings).unwrap();
    assert!(
        !results.is_empty(),
        "Debería haber al menos un paso temporal de simulación."
    );

    let get_voltage_at = |target_t: f64| -> f64 {
        let mut closest_val = 0.0;
        let mut min_diff = f64::MAX;
        for step in &results {
            let diff = (step.time - target_t).abs();
            if diff < min_diff {
                min_diff = diff;
                closest_val = *step.node_voltages.get("2").unwrap();
            }
        }
        closest_val
    };

    let v_t0 = get_voltage_at(0.0);
    assert!(
        (0.0..1.0).contains(&v_t0),
        "Voltaje inicial en el primer paso debería rondar los 0V-0.5V, obtenido: {}",
        v_t0
    );

    let v_t10 = get_voltage_at(0.010);
    assert!(
        v_t10 > 2.8 && v_t10 < 3.4,
        "Voltaje RC en t=10ms debería rondar los 3.16V, obtenido: {}",
        v_t10
    );

    let v_t50 = get_voltage_at(0.050);
    assert!(
        v_t50 > 4.9,
        "Voltaje RC en t=50ms debería estar casi cargado (>4.9V), obtenido: {}",
        v_t50
    );
}

#[test]
fn test_transient_isource_waveform() {
    use crate::parser::parse_spice_netlist_to_native;
    let netlist_str = "
    * Transient dynamic current source
    I1 0 1 SIN(0 10m 1k)
    R1 1 0 100
    ";
    let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
    let settings = TransientSettings {
        dt: 1e-4,
        t_max: 1e-3,
        fixed_step: None,
        integration_method: None,
    };
    let res = solve_transient_circuit(&parsed, &settings).unwrap();
    assert!(!res.is_empty(), "Transitorio debe generar pasos de tiempo");
}

#[test]
fn test_ic_transient_initialization() {
    use crate::parser::parse_spice_netlist_to_native;
    let netlist_str = "
    * Test initial conditions .ic
    .ic V(1)=3.3 V(2)=1.5
    C1 1 2 1u
    R1 2 0 1k
    ";
    let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
    let settings = TransientSettings {
        dt: 1e-5,
        t_max: 1e-4,
        fixed_step: None,
        integration_method: None,
    };
    let res = solve_transient_circuit(&parsed, &settings).unwrap();
    assert!(!res.is_empty());
    let first_step = &res[0];
    let v1 = *first_step.node_voltages.get("1").unwrap();
    let v2 = *first_step.node_voltages.get("2").unwrap();
    assert!(
        (v1 - v2 - 1.8).abs() < 0.1,
        "La diferencia de potencial del capacitor debe iniciarse en 1.8V"
    );
}
