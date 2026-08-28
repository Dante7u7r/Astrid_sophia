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
            ComponentData {
                id: "ic1".to_string(),
                comp_type: "ic_directive".to_string(),
                pins: vec!["2".to_string()],
                value: 0.0,
                ..Default::default()
            },
        ],
        ..Default::default()
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

#[test]
fn test_rc_step_parametric_against_closed_form() {
    let cases = [
        (100.0, 1e-6, 1.0),
        (1_000.0, 10e-6, 5.0),
        (47_000.0, 100e-9, 12.0),
        (330_000.0, 22e-9, 3.3),
    ];

    for (resistance, capacitance, source) in cases {
        let tau = resistance * capacitance;
        let netlist = CircuitNetlist {
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: source,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: resistance,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "C1".to_string(),
                    comp_type: "capacitor".to_string(),
                    value: capacitance,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "ic1".to_string(),
                    comp_type: "ic_directive".to_string(),
                    pins: vec!["2".to_string()],
                    value: 0.0,
                    ..Default::default()
                },
            ],
            fixed_step: Some(true),
            ..Default::default()
        };
        let result = solve_transient_circuit(
            &netlist,
            &TransientSettings {
                dt: tau / 100.0,
                t_max: tau * 5.0,
                fixed_step: Some(true),
                integration_method: Some("BE".to_string()),
            },
        )
        .unwrap();

        for tau_multiple in [0.25, 0.5, 1.0, 2.0, 5.0] {
            let target_time = tau * tau_multiple;
            let sample = result
                .iter()
                .min_by(|left, right| {
                    (left.time - target_time)
                        .abs()
                        .total_cmp(&(right.time - target_time).abs())
                })
                .unwrap();
            let actual = sample.node_voltages["2"];
            let expected = source * (1.0 - (-sample.time / tau).exp());
            let tolerance = source.abs() * 0.012 + 1e-6;
            assert!(
                (actual - expected).abs() <= tolerance,
                "R={resistance}, C={capacitance}, t={}: esperado {expected}, obtenido {actual}",
                sample.time
            );
        }
    }
}

#[test]
fn test_transient_reactive_companions_are_not_polluted_by_dc_stamps() {
    let dt = 5e-6;
    let rl_netlist = CircuitNetlist {
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
                value: 100.0,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "L1".to_string(),
                comp_type: "inductor".to_string(),
                value: 0.1,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "ic1".to_string(),
                comp_type: "ic_directive".to_string(),
                pins: vec!["2".to_string()],
                value: 0.0,
                ..Default::default()
            },
        ],
        fixed_step: Some(true),
        ..Default::default()
    };
    let settings = TransientSettings {
        dt,
        t_max: 2.0 * dt,
        fixed_step: Some(true),
        integration_method: Some("BE".to_string()),
    };
    let rl_result = solve_transient_circuit(&rl_netlist, &settings).unwrap();
    let actual_first_current = rl_result[0].branch_currents["V1"];
    let expected_first_current = -5.0 / (100.0 + 0.1 / dt);
    assert!(
        (actual_first_current - expected_first_current).abs() < 1e-9,
        "El primer paso RL contiene una conductancia DC parásita: esperado {expected_first_current}, obtenido {actual_first_current}"
    );

    let rc_netlist = CircuitNetlist {
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
                id: "C1".to_string(),
                comp_type: "capacitor".to_string(),
                value: 1e-6,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        fixed_step: Some(true),
        ..Default::default()
    };
    let rc_result = solve_transient_circuit(&rc_netlist, &settings).unwrap();
    let current = &rc_result[1];
    let previous = &rc_result[0];
    let resistor_current = (current.node_voltages["2"] - current.node_voltages["1"]) / 1_000.0;
    let capacitor_current =
        1e-6 * (current.node_voltages["2"] - previous.node_voltages["2"]) / dt;
    let kcl_residual = (resistor_current + capacitor_current).abs();
    assert!(
        kcl_residual < 1e-10,
        "El companion RC conserva una conductancia DC parásita: residuo KCL {kcl_residual}"
    );
}

#[test]
fn test_transient_time_axis_uses_accepted_steps_and_exact_tmax() {
    let frequency = 100.0;
    let t_max = 950e-6;
    let netlist = CircuitNetlist {
        components: vec![ComponentData {
            id: "V1".to_string(),
            comp_type: "vsource".to_string(),
            value: 0.0,
            pins: vec!["1".to_string(), "0".to_string()],
            wave_type: Some("sine".to_string()),
            amplitude: Some(1.0),
            frequency: Some(frequency),
            offset: Some(0.0),
            ..Default::default()
        }],
        ..Default::default()
    };

    for fixed_step in [true, false] {
        let results = solve_transient_circuit(
            &netlist,
            &TransientSettings {
                dt: 100e-6,
                t_max,
                fixed_step: Some(fixed_step),
                integration_method: Some("BE".to_string()),
            },
        )
        .unwrap();

        assert!(!results.is_empty());
        assert!(
            results[0].time > 0.0,
            "La primera solución integrada no debe etiquetarse como t=0."
        );
        assert!(
            (results.last().unwrap().time - t_max).abs() < 1e-12,
            "El último tiempo debe coincidir exactamente con tMax."
        );
        for pair in results.windows(2) {
            assert!(
                pair[1].time > pair[0].time,
                "Los tiempos aceptados deben ser estrictamente crecientes."
            );
        }
        for step in &results {
            assert!(step.time <= t_max + 1e-12);
            let expected = (2.0 * std::f64::consts::PI * frequency * step.time).sin();
            assert!(
                (step.node_voltages["1"] - expected).abs() < 1e-10,
                "La fuente se evaluó en un tiempo distinto al publicado: t={}, esperado {expected}, obtenido {}",
                step.time,
                step.node_voltages["1"]
            );
        }
    }
}

#[test]
fn test_transient_dc_operating_point_steady_state() {
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 12.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "R1".to_string(),
                comp_type: "resistor".to_string(),
                value: 10_000.0,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C1".to_string(),
                comp_type: "capacitor".to_string(),
                value: 10e-6,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    // Sin UIC: el circuito debe arrancar en estado estacionario a 12V desde t = dt
    let settings_no_uic = TransientSettings {
        dt: 1e-3,
        t_max: 10e-3,
        fixed_step: Some(true),
        integration_method: Some("BE".to_string()),
    };

    let results = solve_transient_circuit(&netlist, &settings_no_uic).unwrap();
    assert!(!results.is_empty());
    for step in &results {
        let v2 = step.node_voltages["2"];
        assert!(
            (v2 - 12.0).abs() < 1e-3,
            "En estado estacionario sin UIC, V(2) debe permanecer en 12.0V, obtenido: {v2}"
        );
    }
}

#[test]
fn test_continuous_interactive_transient_does_not_reject_large_tmax() {
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
        ],
        ..Default::default()
    };

    let settings = TransientSettings {
        dt: 1e-4,
        t_max: 1e12, // Modo continuo indefinido
        fixed_step: Some(true),
        integration_method: Some("BE".to_string()),
    };

    let mut step_count = 0;
    let res = solve_transient_circuit_inner(
        &netlist,
        &settings,
        HashMap::new(),
        HashMap::new(),
        crate::solver::SolverNumericalSettings::default(),
        None,
        Some(100), // live_run_id = Some(100)
        Some(|_step: &TimeStepResult| -> bool {
            step_count += 1;
            step_count < 10 // Detener tras 10 pasos
        }),
    );

    assert!(res.is_ok(), "El modo interactivo en vivo no debe ser rechazado: {:?}", res.err());
    assert_eq!(step_count, 10);
}

#[test]
fn test_comparator_ideal_dc_saturation() {
    // Comparador Ideal con In+ = 2.0V, In- = 0V -> Debe saturar positivo (> 13V)
    let netlist_high = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 2.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "COMP1".to_string(),
                comp_type: "comparator_ideal".to_string(),
                value: 1e6,
                pins: vec!["1".to_string(), "0".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Rload".to_string(),
                comp_type: "resistor".to_string(),
                value: 10_000.0,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    let dc_res_high = solve_dc_circuit(&netlist_high).expect("DC Comparador solve falló");
    let v_out_high = dc_res_high.node_voltages.get("2").copied().unwrap_or(0.0);
    assert!(
        v_out_high > 13.0,
        "Vout debe saturar positivo cuando In+ > In-, obtenido: {:.4}V",
        v_out_high
    );

    // Comparador Ideal con In+ = -2.0V, In- = 0V -> Debe saturar negativo (< -13V)
    let netlist_low = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: -2.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "COMP1".to_string(),
                comp_type: "comparator_ideal".to_string(),
                value: 1e6,
                pins: vec!["1".to_string(), "0".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Rload".to_string(),
                comp_type: "resistor".to_string(),
                value: 10_000.0,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    let dc_res_low = solve_dc_circuit(&netlist_low).expect("DC Comparador solve falló");
    let v_out_low = dc_res_low.node_voltages.get("2").copied().unwrap_or(0.0);
    assert!(
        v_out_low < -13.0,
        "Vout debe saturar negativo cuando In+ < In-, obtenido: {:.4}V",
        v_out_low
    );
}


