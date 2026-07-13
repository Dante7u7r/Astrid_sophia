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
    };

    let results = solve_monte_carlo_transient(&netlist, &t_settings, &mc_settings).unwrap();
    assert_eq!(results.len(), 20); // 20 corridas de simulación

    for run in results {
        assert!(run.len() > 0);
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

        time_steps.push(TimeStepResult {
            time: t,
            node_voltages,
            branch_currents: HashMap::new(),
        });
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

// ================================================================
// FASE 24: Tests de Líneas de Transmisión RLCG
// ================================================================
