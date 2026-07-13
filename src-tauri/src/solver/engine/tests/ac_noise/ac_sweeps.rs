use super::super::*;

#[test]
fn test_ac_frequency_response() {
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 1.0,
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
                value: 1.5915494309e-6, // 1.5915 µF
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

    let settings = AcSweepSettings {
        f_start: 10.0,
        f_end: 1000.0,
        points_per_decade: 10,
        op_guess: None,
    };

    let results = solve_ac_sweep(&netlist, &settings).unwrap();

    let idx_10hz = results
        .frequencies
        .iter()
        .position(|&f| (f - 10.0).abs() < 0.5)
        .unwrap();
    let idx_100hz = results
        .frequencies
        .iter()
        .position(|&f| (f - 100.0).abs() < 5.0)
        .unwrap();
    let idx_1000hz = results
        .frequencies
        .iter()
        .position(|&f| (f - 1000.0).abs() < 50.0)
        .unwrap();

    let amp_10hz = results.node_amplitudes.get("2").unwrap()[idx_10hz];
    let phase_10hz = results.node_phases.get("2").unwrap()[idx_10hz];

    let amp_100hz = results.node_amplitudes.get("2").unwrap()[idx_100hz];
    let phase_100hz = results.node_phases.get("2").unwrap()[idx_100hz];

    let amp_1000hz = results.node_amplitudes.get("2").unwrap()[idx_1000hz];
    let phase_1000hz = results.node_phases.get("2").unwrap()[idx_1000hz];

    assert!(
        amp_10hz > -0.2 && amp_10hz <= 0.0,
        "Amplitud a 10Hz debería ser ~0dB, obtenida: {}",
        amp_10hz
    );
    assert!(
        phase_10hz < 0.0 && phase_10hz > -10.0,
        "Fase a 10Hz debería ser ~ -5.7°, obtenida: {}",
        phase_10hz
    );

    assert!(
        (amp_100hz - -3.01).abs() < 0.1,
        "Amplitud a fc (100Hz) debería ser -3 dB, obtenida: {}",
        amp_100hz
    );
    assert!(
        (phase_100hz - -45.0).abs() < 1.0,
        "Fase a fc (100Hz) debería ser -45°, obtenida: {}",
        phase_100hz
    );

    assert!(
        (amp_1000hz - -20.0).abs() < 0.5,
        "Amplitud a 1kHz debería ser -20 dB, obtenida: {}",
        amp_1000hz
    );
    assert!(
        phase_1000hz < -80.0 && phase_1000hz > -90.0,
        "Fase a 1kHz debería aproximarse a -90°, obtenida: {}",
        phase_1000hz
    );
}

#[test]
fn test_ac_sweep_controlled_sources() {
    use crate::parser::parse_spice_netlist_to_native;
    let netlist_str = "
    * AC Sweep with VCVS and VCCS
    V1 1 0 AC 2
    E1 2 0 1 0 5
    R1 2 0 1k
    ";
    let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
    let settings = AcSweepSettings {
        f_start: 10.0,
        f_end: 10e3,
        points_per_decade: 5,
        op_guess: None,
    };
    let res = solve_ac_sweep(&parsed, &settings).unwrap();
    assert!(
        !res.frequencies.is_empty(),
        "AC sweep debe generar frecuencias"
    );
}

#[test]
fn test_ac_sweep_csc_performance() {
    // Validar la correctitud del barrido AC complejo
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 0.0,
                pins: vec!["1".to_string(), "0".to_string()],
                amplitude: Some(10.0),
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

    let settings = AcSweepSettings {
        f_start: 10.0,
        f_end: 10000.0,
        points_per_decade: 10,
        op_guess: None,
    };

    let results = solve_ac_sweep(&netlist, &settings).unwrap();
    assert_eq!(results.frequencies.len(), 31); // 3 décadas, 10 pts c/u + 1

    // En f = 1591.5 Hz (w = 10000 rad/s), Xc = 1 / (w * C) = 100 Ohm.
    // Impedancia total Z = R + jXc = 100 - j100.
    // Magnitud de voltaje en nodo 2 = |Vc| = |10 * (-j100) / (100 - j100)| = 10 / sqrt(2) = 7.07V -> ~17.0 dB
    let idx_near_1591 = results
        .frequencies
        .iter()
        .position(|&f| (f - 1591.5).abs() < 100.0)
        .unwrap();
    let amp_db = results.node_amplitudes.get("2").unwrap()[idx_near_1591];
    // 20 * log10(7.07) = 17.0 dB
    assert!(
        (amp_db - 17.0).abs() < 1.0,
        "AC Sweep falló en verificar el polo de atenuación, obtenido: {} dB",
        amp_db
    );
}
