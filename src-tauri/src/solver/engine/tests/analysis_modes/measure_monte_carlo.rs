use super::super::*;

#[test]
fn test_monte_carlo_distribution() {
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
                tolerance: Some(0.1), // 10% tolerancia
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "R2".to_string(),
                comp_type: "resistor".to_string(),
                value: 1000.0,
                tolerance: Some(0.1), // 10% tolerancia
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

    let t_settings = TransientSettings {
        dt: 1e-4,
        t_max: 1e-4,
        fixed_step: None,
        integration_method: None,
    };

    let mc_settings = MonteCarloSettings {
        runs: 20,
        seed: Some(987654321),
        ..Default::default()
    };

    let results = solve_monte_carlo_transient(&netlist, &t_settings, &mc_settings).unwrap();
    assert_eq!(results.len(), 20); // 20 corridas de simulación

    for run in results {
        assert!(!run.is_empty());
        let v_mid = *run.last().unwrap().node_voltages.get("2").unwrap();
        // Para divisor de tensión R1/R2 ideales de 1k, Vmid = 5.0V.
        // Con +/-10% de tolerancia, la dispersión está en torno a 5.0V, variando físicamente.
        // Aseguramos que los valores sean físicos y caigan dentro de límites lógicos
        assert!(
            v_mid > 4.0 && v_mid < 6.0,
            "Divisor variando por tolerancia fuera de cotas: {}",
            v_mid
        );
    }
}

#[test]
fn test_measure_propagation_delay() {
    // Simular una rampa de entrada (nodo "1") que sube de 0V a 5V en 100ns,
    // y una rampa de salida (nodo "2") retardada 20ns.
    let mut time_steps = Vec::new();
    let n_points = 200;
    let t_max = 200e-9; // 200 ns

    for i in 0..=n_points {
        let t = i as f64 * t_max / n_points as f64;
        let mut node_voltages = HashMap::new();

        // Rampa de entrada: sube de 0V a 5V entre t=10ns y t=110ns
        let v_in = if t < 10e-9 {
            0.0
        } else if t < 110e-9 {
            5.0 * (t - 10e-9) / 100e-9
        } else {
            5.0
        };

        // Rampa de salida: igual pero retardada 20ns
        let v_out = if t < 30e-9 {
            0.0
        } else if t < 130e-9 {
            5.0 * (t - 30e-9) / 100e-9
        } else {
            5.0
        };

        node_voltages.insert("0".to_string(), 0.0);
        node_voltages.insert("1".to_string(), v_in);
        node_voltages.insert("2".to_string(), v_out);

        time_steps.push(TimeStepResult::new(t, node_voltages, HashMap::new()));
    }

    // Medir retardo de propagación al 50%
    let directives = vec![
        MeasureDirective {
            name: "t_delay".to_string(),
            measure_type: "delay".to_string(),
            node: "2".to_string(),
            trig_node: Some("1".to_string()),
            threshold: Some(0.5),
            t_start: None,
            t_end: None,
        },
        MeasureDirective {
            name: "t_rise".to_string(),
            measure_type: "risetime".to_string(),
            node: "2".to_string(),
            trig_node: None,
            threshold: None,
            t_start: None,
            t_end: None,
        },
        MeasureDirective {
            name: "v_peak".to_string(),
            measure_type: "peak".to_string(),
            node: "2".to_string(),
            trig_node: None,
            threshold: None,
            t_start: None,
            t_end: None,
        },
        MeasureDirective {
            name: "v_avg".to_string(),
            measure_type: "avg".to_string(),
            node: "1".to_string(),
            trig_node: None,
            threshold: None,
            t_start: None,
            t_end: None,
        },
    ];

    let result = evaluate_measures(&time_steps, &directives);
    assert!(
        result.error_log.is_none(),
        "No debería haber errores: {:?}",
        result.error_log
    );

    // Verificar retardo de propagación ≈ 20ns (±2ns de tolerancia por discretización)
    let delay = *result
        .measurements
        .get("t_delay")
        .expect("Medición t_delay no encontrada");
    assert!(
        (delay - 20e-9).abs() < 2e-9,
        "El retardo de propagación debería ser ~20ns, obtenido: {:.2}ns",
        delay * 1e9
    );

    // Verificar tiempo de subida (10%→90% de 5V = 0.5V→4.5V sobre 100ns de rampa = 80ns)
    let risetime = *result
        .measurements
        .get("t_rise")
        .expect("Medición t_rise no encontrada");
    assert!(
        (risetime - 80e-9).abs() < 5e-9,
        "El tiempo de subida debería ser ~80ns, obtenido: {:.2}ns",
        risetime * 1e9
    );

    // Verificar pico = 5V
    let peak = *result
        .measurements
        .get("v_peak")
        .expect("Medición v_peak no encontrada");
    assert!(
        (peak - 5.0).abs() < 0.1,
        "El pico debería ser 5V, obtenido: {:.4}V",
        peak
    );

    // Verificar promedio (la rampa de 10ns-110ns sobre 200ns tiene un promedio razonable)
    let avg = *result
        .measurements
        .get("v_avg")
        .expect("Medición v_avg no encontrada");
    assert!(
        avg > 0.0 && avg < 5.0,
        "El promedio debería estar entre 0 y 5V, obtenido: {:.4}V",
        avg
    );
}

#[test]
fn test_correlated_monte_carlo_pellet_matching_vs_unmatched() {
    let t_settings = TransientSettings {
        dt: 1e-4,
        t_max: 1e-4,
        fixed_step: None,
        integration_method: None,
    };

    // 1. Circuito con Pellet Matching (Parapareado en layout en el mismo silicio)
    let netlist_matched = CircuitNetlist {
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
                tolerance: Some(0.10), // 10% tolerancia absoluta de proceso
                matching_group: Some("DIV_PAIR".to_string()),
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "R2".to_string(),
                comp_type: "resistor".to_string(),
                value: 1000.0,
                tolerance: Some(0.10), // 10% tolerancia absoluta de proceso
                matching_group: Some("DIV_PAIR".to_string()),
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

    // 2. Circuito sin Matching (resistores discretos independientes)
    let netlist_unmatched = CircuitNetlist {
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
                tolerance: Some(0.10),
                matching_group: None,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "R2".to_string(),
                comp_type: "resistor".to_string(),
                value: 1000.0,
                tolerance: Some(0.10),
                matching_group: None,
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

    let mc_matched_settings = MonteCarloSettings {
        runs: 50,
        seed: Some(55555),
        lot_correlation: Some(0.0),
        matching_correlation: Some(0.99), // 99% de correlación de matching
        yield_spec: Some(YieldSpec {
            node: "2".to_string(),
            min_voltage: Some(4.95),
            max_voltage: Some(5.05),
            target_time: None,
        }),
    };

    let mc_unmatched_settings = MonteCarloSettings {
        runs: 50,
        seed: Some(55555),
        lot_correlation: Some(0.0),
        matching_correlation: None,
        yield_spec: Some(YieldSpec {
            node: "2".to_string(),
            min_voltage: Some(4.95),
            max_voltage: Some(5.05),
            target_time: None,
        }),
    };

    let runs_matched = solve_monte_carlo_transient(&netlist_matched, &t_settings, &mc_matched_settings).unwrap();
    let runs_unmatched = solve_monte_carlo_transient(&netlist_unmatched, &t_settings, &mc_unmatched_settings).unwrap();

    let yield_matched = evaluate_monte_carlo_yield(&runs_matched, mc_matched_settings.yield_spec.as_ref().unwrap());
    let yield_unmatched = evaluate_monte_carlo_yield(&runs_unmatched, mc_unmatched_settings.yield_spec.as_ref().unwrap());

    // La desviación estándar del divisor pareado debe ser drásticamente menor que sin parear
    assert!(
        yield_matched.std_dev < yield_unmatched.std_dev * 0.3,
        "La dispersión con pellet matching ({:.4}V) debe ser significativamente menor que sin parear ({:.4}V)",
        yield_matched.std_dev,
        yield_unmatched.std_dev
    );

    // El yield en ventana ±1% (4.95V a 5.05V) para componentes pareados debe ser superior al 90%
    assert!(
        yield_matched.yield_percentage > 90.0,
        "El yield con matching debería ser > 90%, obtenido: {:.1}%",
        yield_matched.yield_percentage
    );

    // Sin matching, con ±10% de tolerancia el yield en ventana ±1% es bajo (< 50%)
    assert!(
        yield_unmatched.yield_percentage < 50.0,
        "El yield sin matching en ventana estrecha debe ser bajo (<50%), obtenido: {:.1}%",
        yield_unmatched.yield_percentage
    );
}

#[test]
fn test_monte_carlo_lot_to_lot_correlation() {
    let t_settings = TransientSettings {
        dt: 1e-4,
        t_max: 1e-4,
        fixed_step: None,
        integration_method: None,
    };

    // Dos ramas idénticas compartiendo el mismo lote de oblea
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
                tolerance: Some(0.15),
                lot_id: Some("FAB_LOT_A".to_string()),
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "R2".to_string(),
                comp_type: "resistor".to_string(),
                value: 1000.0,
                tolerance: Some(0.15),
                lot_id: Some("FAB_LOT_A".to_string()),
                pins: vec!["1".to_string(), "3".to_string()],
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let mc_settings = MonteCarloSettings {
        runs: 30,
        seed: Some(12345),
        lot_correlation: Some(0.95), // 95% correlación de lote
        matching_correlation: None,
        yield_spec: None,
    };

    let runs = solve_monte_carlo_transient(&netlist, &t_settings, &mc_settings).unwrap();
    assert_eq!(runs.len(), 30);

    let mut r1_currents = Vec::new();
    let mut r2_currents = Vec::new();

    for run in runs {
        let v2 = *run.last().unwrap().node_voltages.get("2").unwrap_or(&0.0);
        let v3 = *run.last().unwrap().node_voltages.get("3").unwrap_or(&0.0);
        r1_currents.push(v2);
        r2_currents.push(v3);
    }

    // Ambas ramas deben tener un seguimiento mutuo consistente en todas las corridas
    for i in 0..30 {
        let diff = (r1_currents[i] - r2_currents[i]).abs();
        assert!(
            diff < 0.5,
            "En la corrida {} las ramas de lote común difieren demasiado: {:.4} vs {:.4}",
            i,
            r1_currents[i],
            r2_currents[i]
        );
    }
}

// ================================================================
// FASE 24: Tests de Líneas de Transmisión RLCG
// ================================================================
