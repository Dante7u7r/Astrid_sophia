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

