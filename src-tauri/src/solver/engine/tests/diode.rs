use super::*;

    #[test]
    fn test_diode_circuit() {
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
                    id: "D1".to_string(),
                    comp_type: "diode".to_string(),
                    value: 0.0,
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
        let v_anode = *result.node_voltages.get("2").unwrap();
        assert!(
            v_anode > 0.5 && v_anode < 0.8,
            "El voltaje del diodo polarizado directo debería rondar los 0.6V-0.7V, obtenido: {}",
            v_anode
        );
    }


    #[test]
    fn test_dc_sweep_diode_curve() {
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 0.0, // Tensión a barrer
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
                    id: "D1".to_string(),
                    comp_type: "diode".to_string(),
                    value: 0.0,
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

        let settings = DcSweepSettings {
            source_id: "V1".to_string(),
            v_start: 0.0,
            v_end: 3.0,
            v_step: 0.1,
        };

        let result = solve_dc_sweep(&netlist, &settings).unwrap();

        // Debería generar exactamente 31 puntos de barrido (0.0 a 3.0 inclusive, paso 0.1)
        assert_eq!(result.sweep_voltages.len(), 31);

        // A 0V en la entrada, la tensión del ánodo (nodo 2) es 0V
        assert!((result.node_voltages.get("2").unwrap()[0] - 0.0).abs() < 1e-6);

        // A 3V en la entrada, el diodo está fuertemente polarizado directo, por lo que su voltaje
        // de ánodo se auto-limita físicamente al rededor de 0.6V - 0.75V
        let v_anode_3v = result.node_voltages.get("2").unwrap()[30];
        assert!(v_anode_3v > 0.55 && v_anode_3v < 0.75, "El voltaje del ánodo del diodo a 3V de entrada debería auto-limitarse por Shockley, obtenido: {}", v_anode_3v);
    }


