use super::super::*;

#[test]
fn test_opamp_amplifier() {
    // Circuito Amplificador Inversor con Op-Amp
    // Vin (nodo 1) = 1.0V
    // R1 = 1k entre nodo 1 y nodo 2 (V-)
    // Rf = 10k entre nodo 2 y nodo 3 (Vout)
    // Op-Amp: V+ = nodo 0 (tierra), V- = nodo 2, Vdd = nodo 4 (+15V), Vss = nodo 5 (-15V), Out = nodo 3
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "Vin".to_string(),
                comp_type: "vsource".to_string(),
                value: 1.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Vpos".to_string(),
                comp_type: "vsource".to_string(),
                value: 15.0,
                pins: vec!["4".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Vneg".to_string(),
                comp_type: "vsource".to_string(),
                value: -15.0,
                pins: vec!["5".to_string(), "0".to_string()],
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
                id: "Rf".to_string(),
                comp_type: "resistor".to_string(),
                value: 10000.0,
                pins: vec!["2".to_string(), "3".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "X1".to_string(),
                comp_type: "opamp".to_string(),
                value: 0.0,
                pins: vec![
                    "0".to_string(), // In+
                    "2".to_string(), // In-
                    "4".to_string(), // V+
                    "5".to_string(), // V-
                    "3".to_string(), // Out
                ],
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

    let v_out = *result.node_voltages.get("3").unwrap();
    let v_virtual_gnd = *result.node_voltages.get("2").unwrap();

    // Ganancia teórica Av = -Rf / R1 = -10. Con Vin = 1V, Vout debe ser -10V
    assert!((v_out - -10.0).abs() < 1e-2, "El voltaje de salida debería ser exactamente -10.0V (ganancia inversora de -10), obtenido: {}", v_out);
    assert!(
        v_virtual_gnd.abs() < 1e-3,
        "La tierra virtual (nodo inversor) debería estar muy cerca de 0V, obtenido: {}",
        v_virtual_gnd
    );
}

#[test]
fn test_opamp_dominant_pole() {
    // Circuito con Op-Amp en lazo abierto
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "Vin".to_string(),
                comp_type: "vsource".to_string(),
                value: 1e-4, // Tensión pequeña para evitar saturación en lazo abierto
                pins: vec!["1".to_string(), "0".to_string()],
                wave_type: Some("sine".to_string()),
                amplitude: Some(1e-4),
                frequency: Some(1e3),
                ..Default::default()
            },
            ComponentData {
                id: "X1".to_string(),
                comp_type: "opamp".to_string(),
                value: 1e5,
                pins: vec![
                    "1".to_string(),
                    "0".to_string(),
                    "0".to_string(),
                    "0".to_string(),
                    "2".to_string(),
                ], // IN+, IN-, V+ (GND), V- (GND), OUT
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    // Probar AC Sweep a 1 Hz y 1000 Hz
    let ac_settings_low = AcSweepSettings {
        f_start: 1.0,
        f_end: 1.0,
        points_per_decade: 1,
        op_guess: None,
    };
    let ac_res_low = solve_ac_sweep(&netlist, &ac_settings_low).unwrap();
    let amp_low = ac_res_low.node_amplitudes.get("2").unwrap()[0];

    let ac_settings_high = AcSweepSettings {
        f_start: 1000.0,
        f_end: 1000.0,
        points_per_decade: 1,
        op_guess: None,
    };
    let ac_res_high = solve_ac_sweep(&netlist, &ac_settings_high).unwrap();
    let amp_high = ac_res_high.node_amplitudes.get("2").unwrap()[0];

    // A 1 Hz: Ganancia open-loop alta (~93 dB), salida de 1e-4V * 4.48e4 = 4.48V (~13 dBV)
    // A 1000 Hz: Ganancia open-loop atenuada por 100x (-40 dB), salida de 44.8mV (~-27 dBV)
    assert!(
        amp_low > 5.0,
        "La ganancia en baja frecuencia debería ser alta, obtenido: {} dBV",
        amp_low
    );
    assert!(amp_high < -10.0, "La ganancia en alta frecuencia debería estar severamente atenuada por el polo, obtenido: {} dBV", amp_high);
}
