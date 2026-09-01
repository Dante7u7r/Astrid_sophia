use super::super::*;

#[test]
fn test_pss_shooting_method_simple_rc() {
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 0.0,
                pins: vec!["1".to_string(), "0".to_string()],
                wave_type: Some("sine".to_string()),
                amplitude: Some(5.0),
                frequency: Some(1000.0), // 1 kHz
                offset: Some(0.0),
                ..Default::default()
            },
            ComponentData {
                id: "R1".to_string(),
                comp_type: "resistor".to_string(),
                value: 1000.0, // 1 kΩ
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C1".to_string(),
                comp_type: "capacitor".to_string(),
                value: 1e-6, // 1 µF
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

    let pss_settings = PssSettings {
        period: 1e-3, // 1 ms
        max_shooting_iters: 5,
        shooting_tolerance: 1e-4,
    };

    let results = solve_pss(&netlist, &pss_settings);
    assert!(
        results.is_ok(),
        "PSS Shooting Method debería converger sin problemas"
    );
    let step_results = results.unwrap();
    assert!(
        !step_results.is_empty(),
        "Los resultados de PSS no deben estar vacíos"
    );
}

#[test]
fn test_stability_analysis_rc_pole() {
    // Circuito RC: R=1k, C=1u => polo en s = -1/(RC) = -1000 rad/s
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "R1".to_string(),
                comp_type: "resistor".to_string(),
                value: 1000.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C1".to_string(),
                comp_type: "capacitor".to_string(),
                value: 1e-6,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let res = run_stability_analysis(&netlist);
    assert!(
        res.is_ok(),
        "El análisis de estabilidad debería ejecutarse con éxito"
    );
    let data = res.unwrap();
    assert!(
        data.is_stable,
        "El circuito RC pasivo simple debe ser estable"
    );
    assert_eq!(data.poles.len(), 1, "Debería haber exactamente 1 polo");

    let p = data.poles[0];
    let serialized = serde_json::to_value(&data).expect("el resultado debe serializarse");
    assert!(
        serialized["poles"][0]["re"].is_number() && serialized["poles"][0]["im"].is_number(),
        "Los polos IPC deben usar objetos explícitos {{re, im}}, no tuplas"
    );
    // El polo debe estar muy cercano a -1000 rad/s
    assert!(
        (p.re + 1000.0).abs() < 1.0,
        "El polo debería ser aproximadamente -1000, obtenido: {:?}",
        p
    );
}

#[test]
fn test_stability_opto_with_algebraic_led_and_dynamic_collector() {
    // El lado LED no almacena energía: sus nodos son algebraicos. El colector sí es
    // dinámico por C_OUT. Para el modelo unilateral del opto, el polo de salida es:
    //   p = -(1 / R_C + g_o) / C_OUT  [rad/s]
    // donde g_o = CTR * I_LED * sech²(V_CE / V_SAT) / V_SAT [S].
    const V_SUPPLY: f64 = 5.0;
    const R_LED_OHM: f64 = 1_000.0;
    const R_COLLECTOR_OHM: f64 = 10_000.0;
    const C_OUT_F: f64 = 10.0e-9;
    const CTR: f64 = 0.5;
    const V_SAT_V: f64 = 0.2;

    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "V_LED".to_string(),
                comp_type: "vsource".to_string(),
                value: V_SUPPLY,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "R_LED".to_string(),
                comp_type: "resistor".to_string(),
                value: R_LED_OHM,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "V_CC".to_string(),
                comp_type: "vsource".to_string(),
                value: V_SUPPLY,
                pins: vec!["4".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "R_C".to_string(),
                comp_type: "resistor".to_string(),
                value: R_COLLECTOR_OHM,
                pins: vec!["4".to_string(), "3".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "O1".to_string(),
                comp_type: "opto".to_string(),
                value: 0.0,
                pins: vec![
                    "2".to_string(), // ánodo LED: algebraico
                    "0".to_string(), // cátodo LED
                    "3".to_string(), // colector: dinámico
                    "0".to_string(), // emisor
                ],
                opto_ctr: Some(CTR),
                opto_vsat: Some(V_SAT_V),
                diode_is: Some(1.0e-12),
                diode_n: Some(1.0),
                ..Default::default()
            },
            ComponentData {
                id: "C_OUT".to_string(),
                comp_type: "capacitor".to_string(),
                value: C_OUT_F,
                pins: vec!["3".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: Some(300.15),
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let op = solve_dc_circuit(&netlist).expect("el punto de operación del opto debe converger");
    let v_led = *op
        .node_voltages
        .get("2")
        .expect("el punto de operación debe incluir el ánodo LED");
    let v_ce = *op
        .node_voltages
        .get("3")
        .expect("el punto de operación debe incluir el colector");
    let i_led_a = (V_SUPPLY - v_led) / R_LED_OHM;
    let tanh_vce = (v_ce / V_SAT_V).tanh();
    let g_out_siemens = CTR * i_led_a * (1.0 - tanh_vce * tanh_vce) / V_SAT_V;
    let expected_pole_rad_s = -(1.0 / R_COLLECTOR_OHM + g_out_siemens) / C_OUT_F;

    let result = run_stability_analysis(&netlist)
        .expect("STB no debe entrar en pánico con el lado LED algebraico");
    assert!(
        result.is_stable,
        "la salida RC pasiva del opto debe ser estable"
    );
    assert_eq!(
        result.poles.len(),
        1,
        "un único capacitor independiente debe producir un polo"
    );

    let pole = result.poles[0];
    assert!(
        pole.re.is_finite() && pole.im.is_finite(),
        "el polo debe ser finito, obtenido: {pole:?}"
    );
    assert!(
        pole.im.abs() <= 1.0e-6,
        "la red de primer orden debe tener polo real; Im(p)={} rad/s",
        pole.im
    );
    let relative_error = (pole.re - expected_pole_rad_s).abs() / expected_pole_rad_s.abs();
    assert!(
        relative_error <= 0.02,
        "polo esperado {expected_pole_rad_s:.6e} rad/s, obtenido {:.6e} rad/s (error relativo {:.3}%)",
        pole.re,
        100.0 * relative_error
    );
}

#[test]
fn test_stability_zeros_extraction() {
    // Red puente / filtro RC paralelo en serie con R2:
    // C1: capacitor 1uF, R1: resistor 1k en paralelo de 1 a 2.
    // R2: resistor 1k de 2 a 0.
    // Esta configuración tiene un polo en -2000 rad/s y un cero en -1000 rad/s.
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
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

    let res = run_stability_analysis(&netlist);
    assert!(
        res.is_ok(),
        "El análisis de estabilidad debería ejecutarse con éxito"
    );
    let data = res.unwrap();
    assert!(data.is_stable, "El circuito RC debe ser estable");

    // Debería detectar el polo en aprox -2000 rad/s y el cero en aprox -1000 rad/s
    assert!(!data.poles.is_empty(), "Debería haber polos");
    assert!(!data.zeros.is_empty(), "Debería haber ceros de transmisión");

    let has_pole_2000 = data.poles.iter().any(|p| (p.re + 2000.0).abs() < 10.0);
    let has_zero_1000 = data.zeros.iter().any(|z| (z.re + 1000.0).abs() < 10.0);

    // Verificar el polo y el cero calculados
    assert!(
        has_pole_2000,
        "Debería tener un polo cerca de -2000, obtenidos: {:?}",
        data.poles
    );
    assert!(
        has_zero_1000,
        "Debería tener un cero cerca de -1000, obtenidos: {:?}",
        data.zeros
    );

    let expected_poles: Vec<(u64, u64)> = data
        .poles
        .iter()
        .map(|value| (value.re.to_bits(), value.im.to_bits()))
        .collect();
    let expected_zeros: Vec<(u64, u64)> = data
        .zeros
        .iter()
        .map(|value| (value.re.to_bits(), value.im.to_bits()))
        .collect();
    assert!(data.poles.windows(2).all(|pair| pair[0].re <= pair[1].re));
    assert!(data.zeros.windows(2).all(|pair| pair[0].re <= pair[1].re));

    for _ in 0..32 {
        let repeated = run_stability_analysis(&netlist).unwrap();
        assert_eq!(
            repeated
                .poles
                .iter()
                .map(|value| (value.re.to_bits(), value.im.to_bits()))
                .collect::<Vec<_>>(),
            expected_poles
        );
        assert_eq!(
            repeated
                .zeros
                .iter()
                .map(|value| (value.re.to_bits(), value.im.to_bits()))
                .collect::<Vec<_>>(),
            expected_zeros
        );
    }
}

#[test]
fn test_colpitts_oscillator_pss_and_phase_noise() {
    // Oscilador Colpitts LC:
    // L1 = 10 uH, C1 = 10 nF, C2 = 10 nF => Ceq = 5 nF
    // Frecuencia teórica f0 = 1 / (2*pi*sqrt(L*Ceq)) = 1 / (2*pi*sqrt(10e-6 * 5e-9)) = 711.76 kHz
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "VCC".to_string(),
                comp_type: "vsource".to_string(),
                value: 5.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "R_BIAS".to_string(),
                comp_type: "resistor".to_string(),
                value: 1000.0,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "L1".to_string(),
                comp_type: "inductor".to_string(),
                value: 10.0e-6,
                pins: vec!["2".to_string(), "3".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C1".to_string(),
                comp_type: "capacitor".to_string(),
                value: 10.0e-9,
                pins: vec!["3".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C2".to_string(),
                comp_type: "capacitor".to_string(),
                value: 10.0e-9,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "M1".to_string(),
                comp_type: "nmos".to_string(),
                value: 0.7,
                pins: vec!["3".to_string(), "2".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: Some(300.15),
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let result = solve_oscillator_pss_and_phase_noise(
        &netlist,
        Some(711.76e3),
        Some(vec![1.0e4, 1.0e5, 1.0e6]),
    );
    assert!(
        result.is_ok(),
        "El PSS del oscilador Colpitts debe converger exitosamente"
    );

    let pss_data = result.unwrap();
    assert!(
        pss_data.fundamental_frequency_hz > 100.0e3 && pss_data.fundamental_frequency_hz < 10.0e6,
        "La frecuencia fundamental de Colpitts debe estar en el rango de MHz/kHz, obtenido: {}",
        pss_data.fundamental_frequency_hz
    );
    assert!(
        !pss_data.pss_results.is_empty(),
        "El ciclo límite PSS debe contener puntos de solución temporal"
    );

    // Validar espectro de ruido de fase
    let pn = pss_data.phase_noise;
    assert_eq!(pn.points.len(), 3);
    let pn_10k = pn.points[0].phase_noise_dbc_per_hz;
    let pn_100k = pn.points[1].phase_noise_dbc_per_hz;
    let pn_1m = pn.points[2].phase_noise_dbc_per_hz;

    // A mayor offset, el ruido de fase debe disminuir (pendiente de Leeson ~ -20 dB/década)
    assert!(pn_100k < pn_10k, "L(100 kHz) debe ser menor que L(10 kHz)");
    assert!(pn_1m < pn_100k, "L(1 MHz) debe ser menor que L(100 kHz)");
    let slope = pn_10k - pn_100k;
    assert!(
        (slope - 20.0).abs() < 1.0,
        "La pendiente del ruido de fase térmico debe ser de ~20 dB/década (Leeson), obtenida: {:.2} dB",
        slope
    );
}

#[test]
fn test_ring_oscillator_cmos_pss() {
    // Oscilador en anillo CMOS (3 etapas de inversor en lazo cerrado)
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "VDD".to_string(),
                comp_type: "vsource".to_string(),
                value: 3.3,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            // Etapa 1: Inversor CMOS 1 (entrada en nodo 4, salida en nodo 2)
            ComponentData {
                id: "M1_P".to_string(),
                comp_type: "pmos".to_string(),
                value: 0.7,
                pins: vec!["4".to_string(), "2".to_string(), "1".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "M1_N".to_string(),
                comp_type: "nmos".to_string(),
                value: 0.7,
                pins: vec!["4".to_string(), "2".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C1".to_string(),
                comp_type: "capacitor".to_string(),
                value: 10.0e-12,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
            // Etapa 2: Inversor CMOS 2 (entrada en nodo 2, salida en nodo 3)
            ComponentData {
                id: "M2_P".to_string(),
                comp_type: "pmos".to_string(),
                value: 0.7,
                pins: vec!["2".to_string(), "3".to_string(), "1".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "M2_N".to_string(),
                comp_type: "nmos".to_string(),
                value: 0.7,
                pins: vec!["2".to_string(), "3".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C2".to_string(),
                comp_type: "capacitor".to_string(),
                value: 10.0e-12,
                pins: vec!["3".to_string(), "0".to_string()],
                ..Default::default()
            },
            // Etapa 3: Inversor CMOS 3 (entrada en nodo 3, salida en nodo 4)
            ComponentData {
                id: "M3_P".to_string(),
                comp_type: "pmos".to_string(),
                value: 0.7,
                pins: vec!["3".to_string(), "4".to_string(), "1".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "M3_N".to_string(),
                comp_type: "nmos".to_string(),
                value: 0.7,
                pins: vec!["3".to_string(), "4".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C3".to_string(),
                comp_type: "capacitor".to_string(),
                value: 10.0e-12,
                pins: vec!["4".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: Some(300.15),
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let osc_data = solve_oscillator_pss_and_phase_noise(&netlist, Some(10.0e6), None)
        .expect("El oscilador en anillo debe converger en PSS");
    assert!(
        osc_data.fundamental_frequency_hz > 10.0e3,
        "La frecuencia fundamental debe ser > 10 kHz"
    );
    assert!(
        osc_data.phase_noise.points.len() >= 4,
        "Debe contener puntos de ruido de fase"
    );
}

#[test]
fn test_vco_frequency_tuning() {
    // Oscilador con modulación por tensión (VCO)
    let build_vco_netlist = |v_ctrl: f64| -> CircuitNetlist {
        CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V_CTRL".to_string(),
                    comp_type: "vsource".to_string(),
                    value: v_ctrl,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R_CHG".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 2000.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "C_VAR".to_string(),
                    comp_type: "capacitor".to_string(),
                    value: 5.0e-9,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "L_TANK".to_string(),
                    comp_type: "inductor".to_string(),
                    value: 20.0e-6,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: Some(300.15),
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        }
    };

    let netlist_low = build_vco_netlist(2.5);
    let netlist_high = build_vco_netlist(5.0);

    let res_low = solve_oscillator_pss_and_phase_noise(&netlist_low, Some(500.0e3), None).unwrap();
    let res_high =
        solve_oscillator_pss_and_phase_noise(&netlist_high, Some(500.0e3), None).unwrap();

    assert!(res_low.fundamental_frequency_hz > 0.0);
    assert!(res_high.fundamental_frequency_hz > 0.0);
}

#[test]
fn test_middlebrook_loop_gain_opamp_feedback() {
    // Circuito con amplificador operacional y red de realimentación:
    // Rf = 9k, Rin = 1k => beta = 1k / (1k + 9k) = 0.1 (-20 dB)
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "V_POS".to_string(),
                comp_type: "vsource".to_string(),
                value: 15.0,
                pins: vec!["3".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "V_NEG".to_string(),
                comp_type: "vsource".to_string(),
                value: -15.0,
                pins: vec!["4".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "OP1".to_string(),
                comp_type: "opamp".to_string(),
                value: 100000.0,
                pins: vec![
                    "0".to_string(), // In+
                    "1".to_string(), // In-
                    "3".to_string(), // V+
                    "4".to_string(), // V-
                    "2".to_string(), // Out
                ],
                ..Default::default()
            },
            ComponentData {
                id: "R_IN".to_string(),
                comp_type: "resistor".to_string(),
                value: 1000.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "R_F".to_string(),
                comp_type: "resistor".to_string(),
                value: 9000.0,
                pins: vec!["2".to_string(), "1".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C_COMP".to_string(),
                comp_type: "capacitor".to_string(),
                value: 100.0e-12,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: Some(300.15),
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let stab = run_stability_analysis(&netlist)
        .expect("El análisis de estabilidad y Loop Gain debe ejecutarse con éxito");

    assert!(
        stab.is_stable,
        "El amplificador con realimentación negativa debe ser estable"
    );
    assert!(
        stab.loop_phase_margin_deg.is_some(),
        "Debe calcular el Margen de Fase"
    );
    assert!(
        stab.unity_gain_frequency_hz.is_some(),
        "Debe calcular la frecuencia de ganancia unitaria"
    );

    let pm = stab.loop_phase_margin_deg.unwrap();
    assert!(
        pm > 45.0 && pm <= 180.0,
        "El Margen de Fase debe ser adecuado (>45 deg), obtenido: {:.2} deg",
        pm
    );

    let fugc = stab.unity_gain_frequency_hz.unwrap();
    assert!(
        fugc > 1.0e3 && fugc < 10.0e6,
        "La frecuencia de ganancia unitaria debe estar en rango, obtenido: {:.2} Hz",
        fugc
    );
}

#[test]
fn test_middlebrook_loop_gain_direct_sweep() {
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "V_POS".to_string(),
                comp_type: "vsource".to_string(),
                value: 15.0,
                pins: vec!["3".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "V_NEG".to_string(),
                comp_type: "vsource".to_string(),
                value: -15.0,
                pins: vec!["4".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "OP1".to_string(),
                comp_type: "opamp".to_string(),
                value: 100000.0,
                pins: vec![
                    "0".to_string(), // In+
                    "1".to_string(), // In-
                    "3".to_string(), // V+
                    "4".to_string(), // V-
                    "2".to_string(), // Out
                ],
                ..Default::default()
            },
            ComponentData {
                id: "R1".to_string(),
                comp_type: "resistor".to_string(),
                value: 1000.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "R2".to_string(),
                comp_type: "resistor".to_string(),
                value: 10000.0,
                pins: vec!["2".to_string(), "1".to_string()],
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: Some(300.15),
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let loop_gain_res = calculate_middlebrook_loop_gain(&netlist, None, None);
    assert!(
        loop_gain_res.is_ok(),
        "El barrido de Middlebrook Loop Gain debe ejecutarse"
    );
    let lg = loop_gain_res.unwrap();

    assert!(lg.is_stable, "El lazo debe ser estable");
    assert!(
        !lg.sweep_points.is_empty(),
        "El barrido debe contener puntos de respuesta en frecuencia"
    );

    // A baja frecuencia la ganancia de lazo debe ser alta (~80 dB)
    let p_dc = &lg.sweep_points[0];
    assert!(
        p_dc.magnitude_db > 60.0,
        "La ganancia de lazo a baja frecuencia debe ser > 60 dB, obtenido: {:.2} dB",
        p_dc.magnitude_db
    );
}

#[test]
fn test_stability_tian_probe_explicit_buffer() {
    // Seguidor de tensión OpAmp con sonda stb_probe insertada explícitamente en el lazo
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "OP1".to_string(),
                comp_type: "opamp".to_string(),
                value: 100000.0, // Aol = 100 dB
                pins: vec![
                    "0".to_string(), // In+ = GND
                    "2".to_string(), // In- = retorno del lazo desde sonda
                    "3".to_string(), // V+
                    "4".to_string(), // V-
                    "1".to_string(), // Out = salida directa
                ],
                ..Default::default()
            },
            ComponentData {
                id: "V_POS".to_string(),
                comp_type: "vsource".to_string(),
                value: 15.0,
                pins: vec!["3".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "V_NEG".to_string(),
                comp_type: "vsource".to_string(),
                value: -15.0,
                pins: vec!["4".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "STB1".to_string(),
                comp_type: "stb_probe".to_string(),
                value: 0.0,
                pins: vec![
                    "1".to_string(), // Pin A (origen en OpAmp Out)
                    "2".to_string(), // Pin B (destino en OpAmp In-)
                ],
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: Some(300.15),
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let res = calculate_middlebrook_loop_gain(&netlist, Some("STB1"), None);
    assert!(
        res.is_ok(),
        "El análisis Tian con sonda STB1 debe ejecutarse"
    );
    let lg = res.unwrap();

    assert!(lg.is_stable, "El seguidor con OpAmp debe ser estable");
    assert!(
        lg.sweep_points.len() > 50,
        "Debe generar barrido denso de frecuencias"
    );

    // Margen de fase debe ser positivo y cercano a 90 grados para polo dominante único
    if let Some(pm) = lg.phase_margin_deg {
        assert!(
            pm > 45.0 && pm < 100.0,
            "Margen de fase esperado entre 45° y 100°, obtenido: {:.2}°",
            pm
        );
    }
}

#[test]
fn test_stability_tian_probe_feedback_divider() {
    // Amplificador con red de realimentación R1 = 1k, R2 = 9k (Ganancia en lazo cerrado = 10, beta = 0.1)
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "OP1".to_string(),
                comp_type: "opamp".to_string(),
                value: 100000.0,
                pins: vec![
                    "0".to_string(), // In+ = GND
                    "3".to_string(), // In- (nodo suma)
                    "4".to_string(), // V+
                    "5".to_string(), // V-
                    "1".to_string(), // Out
                ],
                ..Default::default()
            },
            ComponentData {
                id: "V_POS".to_string(),
                comp_type: "vsource".to_string(),
                value: 15.0,
                pins: vec!["4".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "V_NEG".to_string(),
                comp_type: "vsource".to_string(),
                value: -15.0,
                pins: vec!["5".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "STB1".to_string(),
                comp_type: "stb_probe".to_string(),
                value: 0.0,
                pins: vec!["1".to_string(), "2".to_string()], // Sonda entre salida (1) y red de realimentación (2)
                ..Default::default()
            },
            ComponentData {
                id: "R2".to_string(),
                comp_type: "resistor".to_string(),
                value: 9000.0,
                pins: vec!["2".to_string(), "3".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "R1".to_string(),
                comp_type: "resistor".to_string(),
                value: 1000.0,
                pins: vec!["3".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: Some(300.15),
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let res = calculate_middlebrook_loop_gain(&netlist, Some("STB1"), None);
    assert!(
        res.is_ok(),
        "El análisis Tian con sonda STB1 debe ejecutarse"
    );
    let lg = res.unwrap();

    assert!(
        lg.is_stable,
        "El amplificador con realimentación negativa debe ser estable"
    );
    // Ganancia DC de lazo esperada: Aol * beta = 100000 * (1/10) = 10000 (80 dB)
    let p_dc = &lg.sweep_points[0];
    assert!(
        p_dc.magnitude_db > 60.0,
        "La ganancia de lazo DC debe ser > 60 dB con beta=0.1, obtenido: {:.2} dB",
        p_dc.magnitude_db
    );
}
