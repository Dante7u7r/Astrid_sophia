use super::*;

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
fn test_fft_sine_thd() {
    let f_fund = 1000.0;
    let t_max = 0.01; // 10 ms (10 ciclos completos de 1kHz)

    // Generar 2048 pasos uniformes de una senoide ideal
    let n_steps = 2048;
    let mut time_steps = Vec::with_capacity(n_steps);
    for i in 0..n_steps {
        let t = (i as f64) * (t_max / (n_steps - 1) as f64);
        let mut node_voltages = HashMap::new();
        // Senoide ideal de amplitud 5V, offset 0V
        let v_val = 5.0 * (2.0 * std::f64::consts::PI * f_fund * t).sin();
        node_voltages.insert("1".to_string(), v_val);

        time_steps.push(TimeStepResult {
            time: t,
            node_voltages,
            branch_currents: HashMap::new(),
        });
    }

    let fft_res = calculate_fft_and_thd(&time_steps, "1", f_fund).unwrap();

    // El espectro de frecuenciaNyquist debe ser de 1024 bins
    assert_eq!(fft_res.frequencies.len(), 1024);

    // Encontrar el bin correspondiente a 1000 Hz en fft_res.frequencies
    let mut fund_bin = 0;
    let mut min_diff = f64::MAX;
    for (idx, &f) in fft_res.frequencies.iter().enumerate() {
        let diff = (f - f_fund).abs();
        if diff < min_diff {
            min_diff = diff;
            fund_bin = idx;
        }
    }

    // La magnitud en dB de la fundamental a 1000Hz debería ser muy alta (aproximadamente 20*log10(5) = 13.97 dBV)
    let db_val = fft_res.magnitudes_db[fund_bin];
    assert!(
        (db_val - 13.97).abs() < 0.5,
        "La fundamental a 1kHz debería rondar los 14dBV (amplitud 5V), obtenido: {}",
        db_val
    );

    // Dado que la onda es una senoide perfectamente pura por diseño,
    // su THD debería ser sumamente baja (virtualmente cero, < 0.2% considerando la fuga espectral discreta de 2048 puntos)
    assert!(
        fft_res.thd < 0.2,
        "THD de senoide ideal debería ser muy cercano a 0%, obtenido: {}%",
        fft_res.thd
    );
}

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

#[test]
fn test_imd_two_tone_clipper() {
    let f1 = 900.0;
    let f2 = 1000.0;
    let t_max = 0.05; // 50 ms

    // Generar 2048 pasos uniformes de una señal de dos tonos con distorsión cúbica
    let n_steps = 2048;
    let mut time_steps = Vec::with_capacity(n_steps);
    for i in 0..n_steps {
        let t = (i as f64) * (t_max / (n_steps - 1) as f64);
        let mut node_voltages = HashMap::new();

        // Señal fundamental de dos tonos
        let v_fund = (2.0 * std::f64::consts::PI * f1 * t).sin()
            + (2.0 * std::f64::consts::PI * f2 * t).sin();
        // Agregar una distorsión no lineal cúbica que genera IM3
        let v_distorted = v_fund - 0.05 * v_fund.powi(3);

        node_voltages.insert("out".to_string(), v_distorted);

        time_steps.push(TimeStepResult {
            time: t,
            node_voltages,
            branch_currents: HashMap::new(),
        });
    }

    let imd_res = calculate_imd_analysis(&time_steps, "out", f1, f2).unwrap();

    println!(
        "Power Fund: {}, IM3: {}, IMD%: {}, IP3: {}",
        imd_res.fundamental_power_dbv,
        imd_res.im3_power_dbv,
        imd_res.imd_ratio_percent,
        imd_res.ip3_out_dbv
    );

    // Las fundamentales deben detectarse con buena potencia
    assert!(
        imd_res.fundamental_power_dbv > -10.0,
        "La potencia fundamental debería ser medible"
    );
    // El producto IM3 a 2f1 - f2 (800Hz) o 2f2 - f1 (1100Hz) debe ser detectable
    assert!(
        imd_res.im3_power_dbv > -60.0,
        "Los productos IM3 deberían ser detectables en el espectro"
    );
    // La tasa de IMD en porcentaje debe ser positiva y razonable
    assert!(
        imd_res.imd_ratio_percent > 0.1 && imd_res.imd_ratio_percent < 25.0,
        "IMD fuera de rango: {}%",
        imd_res.imd_ratio_percent
    );
    // IP3 extrapolado debe ser estable y mayor que la potencia fundamental
    assert!(
        imd_res.ip3_out_dbv > imd_res.fundamental_power_dbv,
        "IP3 de salida ({}) debe ser mayor que la fundamental ({})",
        imd_res.ip3_out_dbv,
        imd_res.fundamental_power_dbv
    );
}
