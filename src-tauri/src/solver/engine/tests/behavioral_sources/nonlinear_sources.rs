use super::super::*;

#[test]
fn test_b_source_nonlinear_voltage() {
    // Circuito: V1 (5V) -> nodo 1, R1 (1k) entre nodo 1 y nodo 2,
    // B1 (bvoltage) entre nodo 3 y GND con expresión "V(1) * 2" (debería dar 10V),
    // R2 (1k) entre nodo 3 y GND para cargar el nodo 3.
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
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
            ComponentData {
                id: "B1".to_string(),
                comp_type: "bvoltage".to_string(),
                value: 0.0,
                pins: vec!["3".to_string(), "0".to_string()],
                expression: Some("V(1) * 2".to_string()),
                ..Default::default()
            },
            ComponentData {
                id: "R3".to_string(),
                comp_type: "resistor".to_string(),
                value: 1000.0,
                pins: vec!["3".to_string(), "0".to_string()],
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

    // V(1) debería ser 5.0V
    let v1 = *result.node_voltages.get("1").unwrap();
    assert!(
        (v1 - 5.0).abs() < 0.01,
        "V(1) debería ser ~5.0V, obtenido: {}",
        v1
    );

    // V(3) debería ser V(1) * 2 = 10.0V (forzado por bvoltage B1)
    let v3 = *result.node_voltages.get("3").unwrap();
    assert!(
        (v3 - 10.0).abs() < 0.1,
        "V(3) debería ser ~10.0V (B1 = V(1)*2), obtenido: {}",
        v3
    );
}

#[test]
fn test_b_source_nonlinear_current() {
    // Circuito: V1 (5V) -> nodo 1 -> R1 (1k) -> nodo 2 -> GND
    // B_I1 (bcurrent) inyecta corriente V(1)/1000 desde nodo 2 a GND
    // Esto es equivalente a una resistencia paralela de 1k entre nodo 2 y GND
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
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
            ComponentData {
                id: "BI1".to_string(),
                comp_type: "bcurrent".to_string(),
                value: 0.0,
                pins: vec!["2".to_string(), "0".to_string()],
                expression: Some("V(2) / 1000".to_string()),
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

    // V(1) debería ser 5.0V
    let v1 = *result.node_voltages.get("1").unwrap();
    assert!(
        (v1 - 5.0).abs() < 0.01,
        "V(1) debería ser ~5.0V, obtenido: {}",
        v1
    );

    // V(2): R1 (1k) conecta V(1)=5V a nodo 2. En nodo 2 hay R2 (1k) a GND y
    // bcurrent que drena V(2)/1000 A extra. Sin bcurrent: V(2) = 2.5V.
    // Con bcurrent: la carga efectiva extra es como otra resistencia de 1k en paralelo con R2.
    // R_eq_load = R2 || 1k_equivalente_bcurrent, pero es no lineal.
    // Analíticamente: V(2) = V(1) * R_load/(R1 + R_load)
    // Corriente total de nodo 2: (V1-V2)/R1 = V2/R2 + V2/1000
    // (5-V2)/1000 = V2/1000 + V2/1000 = 2*V2/1000
    // 5 - V2 = 2*V2 -> V2 = 5/3 ≈ 1.667V
    let v2 = *result.node_voltages.get("2").unwrap();
    let expected_v2 = 5.0 / 3.0;
    assert!(
        (v2 - expected_v2).abs() < 0.1,
        "V(2) debería ser ~{:.3}V con bcurrent, obtenido: {}",
        expected_v2,
        v2
    );
}

// ======================================================================
// PRUEBAS UNITARIAS DEL MOTOR DE DIFERENCIACIÓN AUTOMÁTICA AD (B-SOURCE)
// ======================================================================
