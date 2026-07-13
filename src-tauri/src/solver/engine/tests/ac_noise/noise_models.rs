use super::super::*;

#[test]
fn test_resistor_thermal_noise() {
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 0.0, // Fuente silenciosa
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "R1".to_string(),
                comp_type: "resistor".to_string(),
                value: 10000.0, // 10k
                pins: vec!["2".to_string(), "1".to_string()],
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let settings = NoiseSweepSettings {
        output_node: "1".to_string(),
        reference_node: "0".to_string(),
        ac_settings: AcSweepSettings {
            f_start: 10.0,
            f_end: 1000.0,
            points_per_decade: 10,
            op_guess: None,
        },
    };

    let result = solve_noise_sweep(&netlist, &settings).unwrap();

    // Densidad teórica del ruido de Johnson-Nyquist para R=10k a 300K:
    // v_noise = sqrt(4 * k_B * T * R) = sqrt(4 * 1.380649e-23 * 300 * 10000) = 1.287159e-8 V/sqrt(Hz) (12.87 nV/rHz)
    let expected_noise = 1.287159e-8;

    for &noise_val in &result.output_noise_density {
        let error_pct = (noise_val - expected_noise).abs() / expected_noise;
        assert!(error_pct < 0.01, "El ruido térmico del resistor debería ser exactamente 12.87 nV/rHz, obtenido: {} V/rHz", noise_val);
    }
}

// ================================================================
// FASE 23: Tests de Evaluador de Mediciones (.measure)
// ================================================================

#[test]
fn test_ac_and_noise_sweep_bsim3() {
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 1.0,
                pins: vec!["1".to_string(), "0".to_string()],
                amplitude: Some(1.0),
                frequency: Some(1e3),
                ..Default::default()
            },
            ComponentData {
                id: "M1".to_string(),
                comp_type: "bsim3nmos".to_string(),
                value: 0.4, // Vth0 = 0.4 V
                pins: vec!["1".to_string(), "2".to_string(), "0".to_string()],
                w: Some(10e-6),
                l: Some(0.18e-6),
                ..Default::default()
            },
            ComponentData {
                id: "RL".to_string(),
                comp_type: "resistor".to_string(),
                value: 1000.0,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: Some(300.0),
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    // 1. Probar AC Sweep
    let ac_settings = AcSweepSettings {
        f_start: 10.0,
        f_end: 1000.0,
        points_per_decade: 5,
        op_guess: None,
    };
    let ac_res = solve_ac_sweep(&netlist, &ac_settings);
    assert!(
        ac_res.is_ok(),
        "AC Sweep con BSIM3nmos debería converger y ejecutarse con éxito"
    );
    let ac_data = ac_res.unwrap();
    assert!(!ac_data.frequencies.is_empty());
    assert!(ac_data.node_amplitudes.contains_key("2"));

    // 2. Probar Noise Sweep
    let noise_settings = NoiseSweepSettings {
        output_node: "2".to_string(),
        reference_node: "0".to_string(),
        ac_settings,
    };
    let noise_res = solve_noise_sweep(&netlist, &noise_settings);
    assert!(
        noise_res.is_ok(),
        "Noise Sweep con BSIM3nmos debería converger y ejecutarse con éxito"
    );
    let noise_data = noise_res.unwrap();
    assert!(!noise_data.output_noise_density.is_empty());
}

#[test]
fn test_mos_flicker_noise_geometry() {
    // Netlist con un NMOS estándar
    let netlist_w10 = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "Vdd".to_string(),
                comp_type: "vsource".to_string(),
                value: 5.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Vg".to_string(),
                comp_type: "vsource".to_string(),
                value: 2.0,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Rd".to_string(),
                comp_type: "resistor".to_string(),
                value: 100.0,
                pins: vec!["1".to_string(), "3".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "M1".to_string(),
                comp_type: "nmos".to_string(),
                value: 0.0,
                pins: vec!["2".to_string(), "3".to_string(), "0".to_string()],
                w: Some(10.0e-6),
                l: Some(0.18e-6),
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    // NMOS con W = 50 um (5x más ancho, debería tener 5x menos ruido 1/f)
    let netlist_w50 = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "Vdd".to_string(),
                comp_type: "vsource".to_string(),
                value: 5.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Vg".to_string(),
                comp_type: "vsource".to_string(),
                value: 2.0,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Rd".to_string(),
                comp_type: "resistor".to_string(),
                value: 100.0,
                pins: vec!["1".to_string(), "3".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "M1".to_string(),
                comp_type: "nmos".to_string(),
                value: 0.0,
                pins: vec!["2".to_string(), "3".to_string(), "0".to_string()],
                w: Some(50.0e-6),
                l: Some(0.18e-6),
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let noise_settings = NoiseSweepSettings {
        output_node: "3".to_string(),
        reference_node: "0".to_string(),
        ac_settings: AcSweepSettings {
            f_start: 1.0,
            f_end: 1.0,
            points_per_decade: 1,
            op_guess: None,
        },
    };

    let res_w10 = solve_noise_sweep(&netlist_w10, &noise_settings).unwrap();
    let res_w50 = solve_noise_sweep(&netlist_w50, &noise_settings).unwrap();

    let noise_w10 = res_w10.output_noise_density[0];
    let noise_w50 = res_w50.output_noise_density[0];

    // El ruido a W=50um debería ser menor que a W=10um gracias a la dependencia geométrica 1 / (W*L)
    assert!(
        noise_w50 < noise_w10,
        "El ruido 1/f con MOSFET más ancho debería estar suprimido (W50: {} < W10: {})",
        noise_w50,
        noise_w10
    );
}
