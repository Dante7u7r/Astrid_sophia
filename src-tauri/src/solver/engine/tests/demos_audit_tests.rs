use super::super::*;

#[test]
fn test_oracle_01_filtro_rc_transient_exactness() {
    // 01_filtro_rc: V1 (Square 5V, 100Hz, offset 0), R1 = 1000 Ohm, C1 = 1uF
    // Tau = 1.0 ms.
    // En t=0 (DC Operating Point), Vc(0) = +5.0V (estado estacionario inicial).
    // En t=5ms (50% duty), V1 conmuta a -5V.
    // En t=6ms (1 tau después del escalón descendente): Vc(6ms) = -5 + 10*e^(-1) = -1.3212 V.
    // En t=10ms, V1 conmuta a +5V.
    // En t=11ms (1 tau después del escalón ascendente): Vc(11ms) = +5 - 10*e^(-1) = +1.3212 V.
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 5.0,
                pins: vec!["1".to_string(), "0".to_string()],
                wave_type: Some("square".to_string()),
                frequency: Some(100.0),
                amplitude: Some(5.0),
                offset: Some(0.0),
                duty_cycle: Some(0.5),
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
                value: 1e-6,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    let settings = TransientSettings {
        t_max: 0.02, // 20 ms (2 ciclos completos)
        dt: 1e-5,    // 10 us
        fixed_step: None,
        integration_method: None,
    };

    let results = solve_transient_circuit(&netlist, &settings).expect("Simulación 01_filtro_rc falló");
    assert!(!results.is_empty(), "El resultado transitorio no debe estar vacío");

    // Verificar en t = 6ms (1 tau tras flanco de bajada): Vc(6ms) = -1.32V
    let step_6ms = results
        .iter()
        .min_by(|a, b| ((a.time - 0.006).abs()).partial_cmp(&(b.time - 0.006).abs()).unwrap())
        .expect("No se encontró muestra cerca de 6ms");
    let vc_6ms = step_6ms.node_voltages.get("2").copied().unwrap_or(0.0);
    assert!(
        (vc_6ms - (-1.3212)).abs() < 0.15,
        "Vc a 6ms debe ser ~ -1.32V (1 tau tras flanco de bajada), obtenido: {:.4}V",
        vc_6ms
    );

    // Verificar en t = 11ms (1 tau tras flanco de subida): Vc(11ms) = +1.32V
    let step_11ms = results
        .iter()
        .min_by(|a, b| ((a.time - 0.011).abs()).partial_cmp(&(b.time - 0.011).abs()).unwrap())
        .expect("No se encontró muestra cerca de 11ms");
    let vc_11ms = step_11ms.node_voltages.get("2").copied().unwrap_or(0.0);
    assert!(
        (vc_11ms - 1.3212).abs() < 0.15,
        "Vc a 11ms debe ser ~ +1.32V (1 tau tras flanco de subida), obtenido: {:.4}V",
        vc_11ms
    );
}

#[test]
fn test_oracle_05_amplificador_opamp_inverting_gain() {
    // Inverting OpAmp: Vin = 0.5V DC, Rin = 10k, Rf = 100k, Vpos = +15V, Vneg = -15V -> Vout = -5.0V
    // Pines OpAmp: [0: NonInv (+), 1: Inv (-), 2: Vpos (+Vcc), 3: Vneg (-Vee), 4: Out]
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "Vin".to_string(),
                comp_type: "vsource".to_string(),
                value: 0.5,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Rin".to_string(),
                comp_type: "resistor".to_string(),
                value: 10_000.0,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Rf".to_string(),
                comp_type: "resistor".to_string(),
                value: 100_000.0,
                pins: vec!["2".to_string(), "3".to_string()],
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
                value: 100_000.0, // Open loop gain
                pins: vec![
                    "0".to_string(), // Non-inverting (+) -> GND
                    "2".to_string(), // Inverting (-) -> Node 2
                    "4".to_string(), // V+ -> Node 4 (+15V)
                    "5".to_string(), // V- -> Node 5 (-15V)
                    "3".to_string(), // Output -> Node 3
                ],
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    let dc_res = solve_dc_circuit(&netlist).expect("DC OpAmp solve falló");
    let v_inv = dc_res.node_voltages.get("2").copied().unwrap_or(0.0);
    let v_out = dc_res.node_voltages.get("3").copied().unwrap_or(0.0);

    // Tierra virtual en nodo inversor (|V-| <= 1 mV)
    assert!(
        v_inv.abs() < 1e-3,
        "Tierra virtual del OpAmp debe ser ~0V, obtenido: {:.6}V",
        v_inv
    );

    // Ganancia Av = -Rf/Rin = -10 -> Vout = -5.0V
    assert!(
        (v_out - (-5.0)).abs() < 0.05,
        "Vout debe ser -5.0V, obtenido: {:.4}V",
        v_out
    );
}

#[test]
fn test_oracle_07_rlc_resonante_transient_oscillation() {
    // RLC: R = 10 Ohm, L = 1 mH, C = 100 nF -> f0 = 15.915 kHz, Periodo T0 = 62.83 us
    // Escalón de voltaje mediante fuente de pulsos: Vinitial=0V, Vplateau=10V con delay de 10us
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 10.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "ic1".to_string(),
                comp_type: "ic_directive".to_string(),
                pins: vec!["3".to_string()],
                value: 0.0, // V(C1) inicial = 0V
                ..Default::default()
            },
            ComponentData {
                id: "R1".to_string(),
                comp_type: "resistor".to_string(),
                value: 10.0,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "L1".to_string(),
                comp_type: "inductor".to_string(),
                value: 1e-3,
                pins: vec!["2".to_string(), "3".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C1".to_string(),
                comp_type: "capacitor".to_string(),
                value: 100e-9,
                pins: vec!["3".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    let settings = TransientSettings {
        t_max: 0.0002, // 200 us (~3 ciclos completos de oscilación)
        dt: 1e-7,      // 100 ns
        fixed_step: None,
        integration_method: None,
    };

    let results = solve_transient_circuit(&netlist, &settings).expect("Simulación RLC resonante falló");
    assert!(!results.is_empty());

    // Primer sobrepico resonante a t = T0/2 (~31.4 us)
    let step_peak = results
        .iter()
        .min_by(|a, b| ((a.time - 0.0000314).abs()).partial_cmp(&(b.time - 0.0000314).abs()).unwrap())
        .expect("Muestra de sobrepico no encontrada");
    let vc_peak = step_peak.node_voltages.get("3").copied().unwrap_or(0.0);
    assert!(
        vc_peak > 15.0 && vc_peak < 20.0,
        "Sobrepico resonante en t=31.4us debe estar entre 15V y 20V, obtenido: {:.4}V",
        vc_peak
    );
}
