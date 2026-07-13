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
    // El polo debe estar muy cercano a -1000 rad/s
    assert!(
        (p.re + 1000.0).abs() < 1.0,
        "El polo debería ser aproximadamente -1000, obtenido: {:?}",
        p
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
}
