use super::super::*;

#[test]
fn test_oracle_01_amplificador_no_inversor() {
    // 01_amplificador_no_inversor: Vin = 5V DC, R1 = 1k, R2 = 2k -> Av = 1 + R2/R1 = 3.0 -> Vout = 15.0V
    // OpAmp pins: [0: NonInv (+), 1: Inv (-), 2: Vpos (+Vcc), 3: Vneg (-Vee), 4: Out]
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
                id: "R1".to_string(),
                comp_type: "resistor".to_string(),
                value: 1000.0,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "R2".to_string(),
                comp_type: "resistor".to_string(),
                value: 2000.0,
                pins: vec!["2".to_string(), "3".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Vpos".to_string(),
                comp_type: "vsource".to_string(),
                value: 20.0,
                pins: vec!["4".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Vneg".to_string(),
                comp_type: "vsource".to_string(),
                value: -20.0,
                pins: vec!["5".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "U1".to_string(),
                comp_type: "opamp".to_string(),
                value: 100_000.0,
                pins: vec![
                    "1".to_string(), // Non-inv (+) -> Node 1 (Vin)
                    "2".to_string(), // Inv (-) -> Node 2 (Divisor R1/R2)
                    "4".to_string(), // V+ -> Node 4 (+20V)
                    "5".to_string(), // V- -> Node 5 (-20V)
                    "3".to_string(), // Output -> Node 3
                ],
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    let dc_res = solve_dc_circuit(&netlist).expect("DC OpAmp solve falló");
    let v_out = dc_res.node_voltages.get("3").copied().unwrap_or(0.0);
    let v_inv = dc_res.node_voltages.get("2").copied().unwrap_or(0.0);

    // Cortocircuito virtual (V_inv ~= Vin = 5.0V)
    assert!(
        (v_inv - 5.0).abs() < 1e-3,
        "V_inv debe ser ~5.0V por cortocircuito virtual, obtenido: {:.6}V",
        v_inv
    );

    // Salida Vout = (1 + 2k/1k) * 5V = 15.0V
    assert!(
        (v_out - 15.0).abs() < 0.05,
        "Vout debe ser 15.0V, obtenido: {:.4}V",
        v_out
    );
}

#[test]
fn test_oracle_02_rectificador_filtro_c() {
    // Rectificador de media onda con C=100uF y R=100k
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 10.0,
                pins: vec!["1".to_string(), "0".to_string()],
                wave_type: Some("sine".to_string()),
                frequency: Some(100.0),
                amplitude: Some(10.0),
                ..Default::default()
            },
            ComponentData {
                id: "D1".to_string(),
                comp_type: "diode".to_string(),
                value: 0.0,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C1".to_string(),
                comp_type: "capacitor".to_string(),
                value: 1e-4, // 100 uF
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "R1".to_string(),
                comp_type: "resistor".to_string(),
                value: 100_000.0,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    let settings = TransientSettings {
        t_max: 0.02, // 20 ms (2 ciclos completos a 100Hz)
        dt: 1e-4,    // 0.1 ms
        fixed_step: Some(true),
        integration_method: Some("BE".to_string()),
    };

    let results = solve_transient_circuit(&netlist, &settings).expect("Simulación rectificador falló");
    assert!(!results.is_empty());

    // Al final del transitorio, V(2) debe mantener la tensión pico menos caída de diodo (~9.3V)
    let last_step = results.last().unwrap();
    let v_c = last_step.node_voltages.get("2").copied().unwrap_or(0.0);
    assert!(
        v_c > 8.5 && v_c < 10.0,
        "V_c filtrada debe ser ~9.3V, obtenido: {:.4}V",
        v_c
    );
}

#[test]
fn test_oracle_03_puente_wheatstone_desbalanceado() {
    // Puente Wheatstone: V_in = 30V, R1=10k, R2=10k, R3=20k, R4=10k
    // Rama izquierda: V(A) = 30 * 10k/(10k+10k) = 15V
    // Rama derecha: V(B) = 30 * 10k/(20k+10k) = 10V
    // Voltaje diferencial V(A) - V(B) = 5V
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 30.0,
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
                id: "R2".to_string(),
                comp_type: "resistor".to_string(),
                value: 10_000.0,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "R3".to_string(),
                comp_type: "resistor".to_string(),
                value: 20_000.0,
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

    let dc_res = solve_dc_circuit(&netlist).expect("DC Wheatstone solve falló");
    let v_a = dc_res.node_voltages.get("2").copied().unwrap_or(0.0);
    let v_b = dc_res.node_voltages.get("3").copied().unwrap_or(0.0);

    assert!(
        (v_a - 15.0).abs() < 1e-4,
        "V_A debe ser 15.0V, obtenido: {:.4}V",
        v_a
    );
    assert!(
        (v_b - 10.0).abs() < 1e-4,
        "V_B debe ser 10.0V, obtenido: {:.4}V",
        v_b
    );
    assert!(
        ((v_a - v_b) - 5.0).abs() < 1e-4,
        "V_diff debe ser 5.0V, obtenido: {:.4}V",
        v_a - v_b
    );
}

#[test]
fn test_oracle_04_detector_cruce_por_cero_basico() {
    // 04_detector_cruce_por_cero_basico:
    // Vin = 10V pk @ 60Hz, Vpos = +15V, Vneg = -15V, OpAmp como comparador a GND (0V), RL = 10k
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 10.0,
                pins: vec!["1".to_string(), "0".to_string()],
                wave_type: Some("sine".to_string()),
                frequency: Some(60.0),
                amplitude: Some(10.0),
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
                id: "U1".to_string(),
                comp_type: "opamp".to_string(),
                value: 100_000.0,
                pins: vec![
                    "1".to_string(), // In+ -> Node 1 (Vin)
                    "0".to_string(), // In- -> Node 0 (GND ref)
                    "4".to_string(), // V+ -> Node 4 (+15V)
                    "5".to_string(), // V- -> Node 5 (-15V)
                    "2".to_string(), // Out -> Node 2
                ],
                ..Default::default()
            },
            ComponentData {
                id: "RL1".to_string(),
                comp_type: "resistor".to_string(),
                value: 10_000.0,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    let settings = TransientSettings {
        t_max: 0.025, // 25 ms (1.5 ciclos de 60Hz: T = 16.67 ms)
        dt: 5e-5,     // 50 us
        fixed_step: Some(true),
        integration_method: Some("BE".to_string()),
    };

    let results = solve_transient_circuit(&netlist, &settings).expect("Simulación ZCD básico falló");
    assert!(!results.is_empty());

    // Semi-ciclo positivo (t ~ 4.17 ms): Vin > 0 -> Vout satura a Vmax = Vcc - Vdrop - Rout*I ~= +13.7V
    let pos_step = results.iter().find(|s| (s.time - 0.004167).abs() < 1e-4).expect("Paso positivo no encontrado");
    let v_out_pos = pos_step.node_voltages.get("2").copied().unwrap_or(0.0);
    assert!(
        v_out_pos > 13.0 && v_out_pos <= 14.2,
        "Vout en semiciclo positivo debe saturar a ~+13.7V, obtenido: {:.4}V",
        v_out_pos
    );

    // Semi-ciclo negativo (t ~ 12.5 ms): Vin < 0 -> Vout satura a Vmin = Vee + Vdrop + Rout*I ~= -13.7V
    let neg_step = results.iter().find(|s| (s.time - 0.0125).abs() < 1e-4).expect("Paso negativo no encontrado");
    let v_out_neg = neg_step.node_voltages.get("2").copied().unwrap_or(0.0);
    assert!(
        (-14.2..-13.0).contains(&v_out_neg),
        "Vout en semiciclo negativo debe saturar a ~-13.7V, obtenido: {:.4}V",
        v_out_neg
    );
}

#[test]
fn test_oracle_05_detector_cruce_por_cero_aislado() {
    // 05_detector_cruce_por_cero_aislado:
    // Vac = 24V pk @ 60Hz, Puente D1-D4, R1 = 2.2k, Optoacoplador, Pull-up R2 = 10k a +5V
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 24.0,
                pins: vec!["1".to_string(), "0".to_string()],
                wave_type: Some("sine".to_string()),
                frequency: Some(60.0),
                amplitude: Some(24.0),
                ..Default::default()
            },
            // Puente Rectificador
            ComponentData {
                id: "D1".to_string(),
                comp_type: "diode".to_string(),
                value: 0.0,
                pins: vec!["1".to_string(), "2".to_string()], // AC1 -> Rect+
                ..Default::default()
            },
            ComponentData {
                id: "D2".to_string(),
                comp_type: "diode".to_string(),
                value: 0.0,
                pins: vec!["3".to_string(), "1".to_string()], // Rect- -> AC1
                ..Default::default()
            },
            ComponentData {
                id: "D3".to_string(),
                comp_type: "diode".to_string(),
                value: 0.0,
                pins: vec!["0".to_string(), "2".to_string()], // AC2 (GND) -> Rect+
                ..Default::default()
            },
            ComponentData {
                id: "D4".to_string(),
                comp_type: "diode".to_string(),
                value: 0.0,
                pins: vec!["3".to_string(), "0".to_string()], // Rect- -> AC2 (GND)
                ..Default::default()
            },
            // Limitadora R1
            ComponentData {
                id: "R1".to_string(),
                comp_type: "resistor".to_string(),
                value: 2200.0,
                pins: vec!["2".to_string(), "4".to_string()],
                ..Default::default()
            },
            // Optoacoplador: pins [0: Anode, 1: Cathode, 2: Collector, 3: Emitter]
            ComponentData {
                id: "OK1".to_string(),
                comp_type: "opto".to_string(),
                value: 1.0,
                pins: vec![
                    "4".to_string(), // Anode (R1 salida)
                    "3".to_string(), // Cathode (Rect-)
                    "6".to_string(), // Collector (Salida pull-up)
                    "0".to_string(), // Emitter (GND secundario)
                ],
                ..Default::default()
            },
            // Alimentación secundaria +5V y pull-up R2
            ComponentData {
                id: "Vcc".to_string(),
                comp_type: "vsource".to_string(),
                value: 5.0,
                pins: vec!["5".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "R2".to_string(),
                comp_type: "resistor".to_string(),
                value: 10_000.0,
                pins: vec!["5".to_string(), "6".to_string()],
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    let settings = TransientSettings {
        t_max: 0.025, // 25 ms
        dt: 5e-5,     // 50 us
        fixed_step: Some(true),
        integration_method: Some("BE".to_string()),
    };

    let results = solve_transient_circuit(&netlist, &settings).expect("Simulación ZCD aislado falló");
    assert!(!results.is_empty());

    // En pico AC (t ~ 4.17 ms): LED conduce -> Colector satura a nivel BAJO (Vout < 1.0V)
    let peak_step = results.iter().find(|s| (s.time - 0.004167).abs() < 1e-4).expect("Paso pico no encontrado");
    let v_out_peak = peak_step.node_voltages.get("6").copied().unwrap_or(5.0);
    assert!(
        v_out_peak < 1.0,
        "Vout en pico AC debe ser LOW (< 1.0V), obtenido: {:.4}V",
        v_out_peak
    );

    // En cruce por cero (t ~ 8.33 ms): LED se apaga -> Colector sube a nivel ALTO (+5V)
    let zero_step = results.iter().find(|s| (s.time - 0.008333).abs() < 1e-4).expect("Paso cruce no encontrado");
    let v_out_zero = zero_step.node_voltages.get("6").copied().unwrap_or(0.0);
    assert!(
        v_out_zero > 4.0,
        "Vout en cruce por cero debe ser pulso HIGH (> 4.0V), obtenido: {:.4}V",
        v_out_zero
    );
}
