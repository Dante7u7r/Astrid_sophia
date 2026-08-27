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

#[test]
fn test_opamp_commercial_2pole_ac_frequency_response() {
    // Amplificador inversor con LM741: R1 = 1k, Rf = 10k (Ganancia nominal = 10 = 20 dB)
    // GBW = 1 MHz, Aol = 200k, f_p1 = 5 Hz, f_p2 = 2 MHz
    // Ancho de banda de lazo cerrado esperado: f_3dB = GBW / (1 + Rf/R1) = 1 MHz / 11 = ~90.9 kHz
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "Vin".to_string(),
                comp_type: "vsource".to_string(),
                value: 1.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ac_mag: Some(1.0),
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
                value: 200000.0,
                pins: vec![
                    "0".to_string(), // IN+ (GND)
                    "2".to_string(), // IN-
                    "4".to_string(), // V+
                    "5".to_string(), // V-
                    "3".to_string(), // OUT
                ],
                opamp_aol: Some(200000.0),
                opamp_gbw: Some(1.0e6), // 1 MHz GBW (LM741)
                opamp_rin: Some(2.0e6),
                opamp_rout: Some(75.0),
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    // 1. En baja frecuencia (100 Hz): debe tener ganancia plena de ~20 dB (10 V/V)
    let ac_settings_passband = AcSweepSettings {
        f_start: 100.0,
        f_end: 100.0,
        points_per_decade: 1,
        op_guess: None,
    };
    let res_passband = solve_ac_sweep(&netlist, &ac_settings_passband).unwrap();
    let gain_100hz = res_passband.node_amplitudes.get("3").unwrap()[0];

    assert!(
        (gain_100hz - 20.0).abs() < 0.5,
        "La ganancia en banda pasante a 100 Hz debe ser ~20 dB, obtenido: {:.2} dB",
        gain_100hz
    );

    // 2. A 10 MHz (muy por encima del ancho de banda cerrado de 90 kHz y de f_p2 a 2 MHz):
    // Debe exhibir atenuación severa de 2 polos (-40 dB/década)
    let ac_settings_stopband = AcSweepSettings {
        f_start: 10.0e6,
        f_end: 10.0e6,
        points_per_decade: 1,
        op_guess: None,
    };
    let res_stopband = solve_ac_sweep(&netlist, &ac_settings_stopband).unwrap();
    let gain_10mhz = res_stopband.node_amplitudes.get("3").unwrap()[0];

    assert!(
        gain_10mhz < -20.0,
        "A 10 MHz la salida debe estar atenuada por la respuesta de 2 polos: {:.2} dB",
        gain_10mhz
    );
}

#[test]
fn test_opamp_kcl_supply_rails_and_quiescent_current() {
    // Circuito Inversor con Op-Amp de 5 pines alimentado a +15V / -15V
    // Vin = 1.0V, R1 = 1k, Rf = 10k -> Vout = -10V
    // RL = 1k conectada en la salida -> I_load = -10V / 1k = -10 mA (absorbida por el opamp)
    // Corriente de reposo Iq = 2 mA
    // KCL: El riel positivo entrega Iq = 2mA
    // El riel negativo absorbe Iq + |I_load| + |I_Rf| = 2mA + 10mA + 1mA = 13mA
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
                id: "RL".to_string(),
                comp_type: "resistor".to_string(),
                value: 1000.0,
                pins: vec!["3".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "X1".to_string(),
                comp_type: "opamp".to_string(),
                value: 200000.0,
                pins: vec![
                    "0".to_string(), // In+
                    "2".to_string(), // In-
                    "4".to_string(), // V+
                    "5".to_string(), // V-
                    "3".to_string(), // Out
                ],
                opamp_aol: Some(200000.0),
                opamp_iq: Some(0.002), // 2 mA
                opamp_rin: Some(1e7),
                opamp_rout: Some(10.0),
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
    assert!((v_out - -10.0).abs() < 0.1, "Vout debe ser ~ -10V, obtenido: {}", v_out);

    let i_vpos = result.branch_currents.get("Vpos").copied().unwrap_or(0.0);
    let i_vneg = result.branch_currents.get("Vneg").copied().unwrap_or(0.0);

    // Vpos suministra ~2mA (Iq)
    assert!(
        (i_vpos.abs() - 0.002).abs() < 0.001,
        "La corriente extraída de Vpos debe ser ~2 mA (Iq), obtenido: {} A",
        i_vpos
    );

    // Vneg absorbe ~13mA (Iq + 10mA de carga + 1mA de Rf)
    assert!(
        (i_vneg.abs() - 0.013).abs() < 0.0015,
        "La corriente que entra a Vneg debe ser ~13 mA (Iq + I_load), obtenido: {} A",
        i_vneg
    );
}

#[test]
fn test_opamp_short_circuit_current_limit() {
    // Op-Amp con salida en cortocircuito directo a tierra mediante resistencia de sensado de 0.01 Ohm
    // Forzamos salida positiva máxima (Vin = +1V en lazo abierto)
    // Con Isc = 25 mA, la corriente no debe exceder 25 mA ± 10%
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
                id: "Rshort".to_string(),
                comp_type: "resistor".to_string(),
                value: 0.01,
                pins: vec!["3".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "X1".to_string(),
                comp_type: "opamp".to_string(),
                value: 100000.0,
                pins: vec![
                    "1".to_string(), // In+ = 1V
                    "0".to_string(), // In- = 0V
                    "4".to_string(), // V+
                    "5".to_string(), // V-
                    "3".to_string(), // Out
                ],
                opamp_isc: Some(0.025), // 25 mA corriente de cortocircuito
                opamp_rout: Some(50.0),
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
    let v_short = *result.node_voltages.get("3").unwrap();
    let i_short = v_short / 0.01;

    assert!(
        (i_short - 0.025).abs() < 0.005,
        "La corriente de cortocircuito debe estar limitada a ~25 mA por Isc, obtenido: {:.4} A",
        i_short
    );
}

#[test]
fn test_opamp_rail_to_rail_vs_standard_saturation() {
    // Op-Amp con alimentación simple +5V / 0V (GND)
    // Con Vdrop = 0.025V (MCP6002 Rail-to-Rail)
    // Vin = 2.0V en comparador lazo abierto -> Vout debe alcanzar > 4.95V
    let netlist_rrio = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "Vin".to_string(),
                comp_type: "vsource".to_string(),
                value: 2.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Vdd".to_string(),
                comp_type: "vsource".to_string(),
                value: 5.0,
                pins: vec!["4".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "X1".to_string(),
                comp_type: "opamp".to_string(),
                value: 100000.0,
                pins: vec![
                    "1".to_string(), // In+ = 2V
                    "0".to_string(), // In- = 0V
                    "4".to_string(), // V+ = 5V
                    "0".to_string(), // V- = 0V
                    "3".to_string(), // Out
                ],
                opamp_vdrop: Some(0.025), // Rail-to-Rail (25 mV drop)
                opamp_rout: Some(30.0),
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let result_rrio = solve_dc_circuit(&netlist_rrio).unwrap();
    let v_out_rrio = *result_rrio.node_voltages.get("3").unwrap();

    assert!(
        v_out_rrio > 4.90,
        "Un Op-Amp Rail-to-Rail (RRIO) debe saturar a > 4.90V con Vdd=5V, obtenido: {:.3} V",
        v_out_rrio
    );
}

#[test]
fn test_opamp_input_offset_current_ios() {
    // Seguidor de tensión con resistencias de fuente elevadas (100k)
    // I_b = 100 nA, I_os = 50 nA -> I_b+ = 125 nA, I_b- = 75 nA
    // Caída en entrada In+: V_in+ = 0 - (100k * 125nA) = -12.5 mV
    // Salida seguidora = -12.5 mV
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
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
                id: "Rsource".to_string(),
                comp_type: "resistor".to_string(),
                value: 100000.0,
                pins: vec!["0".to_string(), "1".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Rfeedback".to_string(),
                comp_type: "resistor".to_string(),
                value: 1.0,
                pins: vec!["2".to_string(), "3".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "X1".to_string(),
                comp_type: "opamp".to_string(),
                value: 200000.0,
                pins: vec![
                    "1".to_string(), // In+ a través de 100k a GND
                    "2".to_string(), // In- a la salida (seguidor)
                    "4".to_string(), // V+
                    "5".to_string(), // V-
                    "3".to_string(), // Out
                ],
                opamp_ib: Some(100e-9),  // 100 nA
                opamp_ios: Some(50e-9),  // 50 nA offset
                opamp_rin: Some(1e9),
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

    // V_out teórico = -(100k * (100nA + 25nA)) = -12.5 mV
    assert!(
        (v_out - -0.0125).abs() < 0.001,
        "La tensión inducida por I_b + 0.5*I_os en 100k debe ser ~ -12.5 mV, obtenido: {:.4} V",
        v_out
    );
}

#[test]
fn test_opamp_ac_noise_spectral_density() {
    // Amplificador inversor de bajo ruido con NE5532 (en = 5 nV/sqrt(Hz), fc = 100 Hz)
    // R1 = 1k, Rf = 10k (Ganancia = 10)
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "Vin".to_string(),
                comp_type: "vsource".to_string(),
                value: 0.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ac_mag: Some(1.0),
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
                value: 100000.0,
                pins: vec![
                    "0".to_string(), // In+ (GND)
                    "2".to_string(), // In-
                    "0".to_string(), // V+
                    "0".to_string(), // V-
                    "3".to_string(), // Out
                ],
                opamp_en: Some(5.0e-9), // 5 nV/sqrt(Hz)
                opamp_fc: Some(100.0),  // 100 Hz esquina 1/f
                opamp_rin: Some(1e7),
                opamp_rout: Some(0.3),
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: Some(300.15),
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let settings = NoiseSweepSettings {
        output_node: "3".to_string(),
        reference_node: "0".to_string(),
        ac_settings: AcSweepSettings {
            f_start: 1.0,
            f_end: 10000.0,
            points_per_decade: 5,
            op_guess: None,
        },
    };

    let noise_result = solve_noise_sweep(&netlist, &settings).unwrap();
    let onoise = &noise_result.output_noise_density;

    // El ruido en 1 Hz (con 1/f) debe ser significativamente mayor que en 10 kHz (ruido blanco)
    let noise_1hz = onoise[0];
    let noise_10khz = *onoise.last().unwrap();

    assert!(
        noise_1hz > noise_10khz * 1.5,
        "El ruido en 1 Hz ({:.2e}) debe ser notablemente mayor al de 10 kHz ({:.2e}) por el efecto flicker 1/f",
        noise_1hz,
        noise_10khz
    );
}

