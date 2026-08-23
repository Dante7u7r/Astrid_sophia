use super::super::*;

#[test]
fn test_fuzz_extreme_resistor_ratio_and_floating_nodes() {
    // Fuzz test con relaciones de impedancia de 10^18 (1 uOhm vs 1 TOhm)
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
                id: "R_TINY".to_string(),
                comp_type: "resistor".to_string(),
                value: 1e-6, // 1 microOhm
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "R_HUGE".to_string(),
                comp_type: "resistor".to_string(),
                value: 1e12, // 1 TeraOhm
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    let dc_res = solve_dc_circuit(&netlist).expect("Solver debe converger con relaciones de impedancia extremas");
    let v2 = dc_res.node_voltages.get("2").copied().unwrap_or(0.0);
    assert!(!v2.is_nan() && !v2.is_infinite(), "El voltaje no debe ser NaN ni Infinito");
    assert!((v2 - 5.0).abs() < 1e-4, "El divisor casi ideal debe dar 5.0V, obtenido: {}", v2);
}

#[test]
fn test_fuzz_transient_discontinuous_pulse_train() {
    // Tren de pulsos ultrarrápido (100 kHz, 100 ns rise/fall)
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "V_PULSE".to_string(),
                comp_type: "vsource".to_string(),
                value: 0.0,
                pins: vec!["1".to_string(), "0".to_string()],
                wave_type: Some("pulse".to_string()),
                frequency: Some(100_000.0), // 100 kHz (Periodo 10 us)
                amplitude: Some(5.0),
                offset: Some(0.0),
                duty_cycle: Some(0.2), // 2 us pulse width
                ..Default::default()
            },
            ComponentData {
                id: "R1".to_string(),
                comp_type: "resistor".to_string(),
                value: 50.0,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C1".to_string(),
                comp_type: "capacitor".to_string(),
                value: 1e-9, // 1 nF
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    let settings = TransientSettings {
        t_max: 0.00005, // 50 us (5 periodos completos de pulsos rápidos)
        dt: 1e-8,       // 10 ns
        fixed_step: None,
        integration_method: None,
    };

    let results = solve_transient_circuit(&netlist, &settings).expect("Simulación de tren de pulsos rápidos falló");

    assert!(!results.is_empty());
    for step in &results {
        for (node, v) in &step.node_voltages {
            assert!(!v.is_nan() && !v.is_infinite(), "Voltaje en nodo {} en t={} no debe ser NaN/Inf", node, step.time);
            assert!(*v >= -1.0 && *v <= 6.0, "Voltaje en nodo {} en t={} fuera de rango físico: {}", node, step.time, v);
        }
    }
}
