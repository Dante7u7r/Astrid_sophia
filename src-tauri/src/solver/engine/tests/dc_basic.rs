use super::*;

    #[test]
    fn test_voltage_divider() {
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 10.0,
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
                    id: "R2".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
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

        let result = solve_dc_circuit(&netlist).unwrap();
        assert_eq!(*result.node_voltages.get("0").unwrap(), 0.0);
        assert_eq!(*result.node_voltages.get("1").unwrap(), 10.0);
        let v_node2 = *result.node_voltages.get("2").unwrap();
        assert!(
            (v_node2 - 5.0).abs() < 1e-5,
            "Voltaje en Nodo 2 debería ser 5.0V, obtenido: {}",
            v_node2
        );
    }

    #[test]
    fn test_dc_sensitivity_voltage_divider() {
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 10.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    tolerance: Some(0.0), // Fuente con 0% tolerancia
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    tolerance: Some(0.05), // 5% tolerancia
                    ..Default::default()
                },
                ComponentData {
                    id: "R2".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    tolerance: Some(0.05), // 5% tolerancia
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let result = solve_dc_sensitivity(&netlist).unwrap();

        // 1. Verificar voltajes nominales
        let v_node2 = *result.nominal_voltages.get("2").unwrap();
        assert!(
            (v_node2 - 5.0).abs() < 1e-5,
            "Voltaje nominal en Nodo 2 debería ser 5.0V"
        );

        // 2. Verificar sensibilidades absolutas y normalizadas
        // dV(2)/dR1 = -Vsrc * R2 / (R1 + R2)^2 = -10 * 1000 / 2000^2 = -0.0025 V/Ohm
        // dV(2)/dR2 = Vsrc * R1 / (R1 + R2)^2 = 10 * 1000 / 2000^2 = 0.0025 V/Ohm
        let sens_r1 = result
            .sensitivities
            .iter()
            .find(|s| s.component_id == "R1")
            .unwrap();
        let abs_sens_r1 = *sens_r1.absolute_sensitivities.get("2").unwrap();
        let norm_sens_r1 = *sens_r1.normalized_sensitivities.get("2").unwrap();

        assert!(
            (abs_sens_r1 - (-0.0025)).abs() < 1e-6,
            "Sensibilidad absoluta dV(2)/dR1 errónea: {}",
            abs_sens_r1
        );
        // (dV/dR) * (R/V) = -0.0025 * 1000 / 5 = -0.5 (-50%)
        assert!(
            (norm_sens_r1 - (-0.5)).abs() < 1e-5,
            "Sensibilidad normalizada dV(2)/dR1 errónea: {}",
            norm_sens_r1
        );

        let sens_r2 = result
            .sensitivities
            .iter()
            .find(|s| s.component_id == "R2")
            .unwrap();
        let abs_sens_r2 = *sens_r2.absolute_sensitivities.get("2").unwrap();
        let norm_sens_r2 = *sens_r2.normalized_sensitivities.get("2").unwrap();

        assert!(
            (abs_sens_r2 - 0.0025).abs() < 1e-6,
            "Sensibilidad absoluta dV(2)/dR2 errónea: {}",
            abs_sens_r2
        );
        assert!(
            (norm_sens_r2 - 0.5).abs() < 1e-5,
            "Sensibilidad normalizada dV(2)/dR2 errónea: {}",
            norm_sens_r2
        );

        // 3. Verificar peor caso (Worst Case)
        // delta_V2 = |dV(2)/dR1| * (R1 * tol1) + |dV(2)/dR2| * (R2 * tol2)
        // delta_V2 = 0.0025 * (1000 * 0.05) + 0.0025 * (1000 * 0.05) = 0.125 + 0.125 = 0.25 V
        let wc_limits = result.worst_case_limits.get("2").unwrap();
        assert!(
            (wc_limits.max_deviation - 0.25).abs() < 1e-5,
            "Desviación del peor caso errónea: {}",
            wc_limits.max_deviation
        );
        assert!(
            (wc_limits.worst_case_high - 5.25).abs() < 1e-5,
            "Límite superior del peor caso erróneo: {}",
            wc_limits.worst_case_high
        );
        assert!(
            (wc_limits.worst_case_low - 4.75).abs() < 1e-5,
            "Límite inferior del peor caso erróneo: {}",
            wc_limits.worst_case_low
        );
    }

    #[test]
    fn test_voltage_divider_parametric_reference_matrix() {
        let source_values = [-24.0, -3.3, 0.25, 1.0, 5.0, 48.0];
        let resistor_values = [0.1, 1.0, 47.0, 1_000.0, 330_000.0, 10_000_000.0];

        for &source in &source_values {
            for (case_index, &r1) in resistor_values.iter().enumerate() {
                for &r2 in &resistor_values {
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
                                value: r1,
                                pins: vec!["1".to_string(), "2".to_string()],
                                ..Default::default()
                            },
                            ComponentData {
                                id: "R2".to_string(),
                                comp_type: "resistor".to_string(),
                                value: r2,
                                pins: vec!["2".to_string(), "0".to_string()],
                                ..Default::default()
                            },
                        ],
                        ..Default::default()
                    };

                    let result = solve_dc_circuit(&netlist).unwrap_or_else(|error| {
                        panic!(
                            "Caso {case_index} no convergio: Vs={source}, R1={r1}, R2={r2}: {error}"
                        )
                    });
                    let actual = result.node_voltages["2"];
                    let expected = source * r2 / (r1 + r2);
                    let tolerance = 1e-7_f64.max(expected.abs() * 1e-7);
                    assert!(
                        (actual - expected).abs() <= tolerance,
                        "Vs={source}, R1={r1}, R2={r2}: esperado {expected}, obtenido {actual}"
                    );
                    assert!(actual.is_finite());
                }
            }
        }
    }

    #[test]
    fn test_resistive_superposition_and_balanced_bridge_references() {
        let superposition = CircuitNetlist {
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 12.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "V2".to_string(),
                    comp_type: "vsource".to_string(),
                    value: -4.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 2_000.0,
                    pins: vec!["1".to_string(), "3".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R2".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 4_000.0,
                    pins: vec!["2".to_string(), "3".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R3".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 8_000.0,
                    pins: vec!["3".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let result = solve_dc_circuit(&superposition).unwrap();
        let expected = (12.0 / 2_000.0 + -4.0 / 4_000.0)
            / (1.0 / 2_000.0 + 1.0 / 4_000.0 + 1.0 / 8_000.0);
        assert!((result.node_voltages["3"] - expected).abs() < 1e-8);

        let bridge = CircuitNetlist {
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 10.0,
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
                    value: 2_000.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R3".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 5_000.0,
                    pins: vec!["1".to_string(), "3".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R4".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 10_000.0,
                    pins: vec!["3".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let result = solve_dc_circuit(&bridge).unwrap();
        let differential = result.node_voltages["2"] - result.node_voltages["3"];
        assert!(
            differential.abs() < 1e-8,
            "Un puente balanceado debe tener salida diferencial nula: {differential}"
        );
    }

