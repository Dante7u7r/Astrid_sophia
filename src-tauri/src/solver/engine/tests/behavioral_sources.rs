use super::*;

#[test]
fn test_b_source_math_evaluator() {
    let mut nv = HashMap::new();
    nv.insert("0".to_string(), 0.0);
    nv.insert("1".to_string(), 5.0);
    nv.insert("2".to_string(), 3.0);
    nv.insert("3".to_string(), 1.5);
    let mut bc = HashMap::new();
    bc.insert("V1".to_string(), 0.025);

    // Constantes y aritmética básica
    let r1 = evaluate_expression_string("2.5 + 3.0 * 2.0", &nv, &bc, 0.0).unwrap();
    assert!(
        (r1 - 8.5).abs() < 1e-10,
        "2.5 + 3.0 * 2.0 = 8.5, obtenido: {}",
        r1
    );

    // sin(pi/2) = 1.0
    let r2 = evaluate_expression_string("sin(pi / 2)", &nv, &bc, 0.0).unwrap();
    assert!(
        (r2 - 1.0).abs() < 1e-10,
        "sin(pi/2) = 1.0, obtenido: {}",
        r2
    );

    // ln(exp(1)) = 1.0
    let r3 = evaluate_expression_string("ln(exp(1))", &nv, &bc, 0.0).unwrap();
    assert!(
        (r3 - 1.0).abs() < 1e-6,
        "ln(exp(1)) = 1.0, obtenido: {}",
        r3
    );

    // V(1) = 5.0
    let r4 = evaluate_expression_string("V(1)", &nv, &bc, 0.0).unwrap();
    assert!((r4 - 5.0).abs() < 1e-10, "V(1) = 5.0, obtenido: {}", r4);

    // V(1, 2) = V(1) - V(2) = 5.0 - 3.0 = 2.0
    let r5 = evaluate_expression_string("V(1, 2)", &nv, &bc, 0.0).unwrap();
    assert!((r5 - 2.0).abs() < 1e-10, "V(1,2) = 2.0, obtenido: {}", r5);

    // I(V1) = 0.025
    let r6 = evaluate_expression_string("I(V1)", &nv, &bc, 0.0).unwrap();
    assert!(
        (r6 - 0.025).abs() < 1e-10,
        "I(V1) = 0.025, obtenido: {}",
        r6
    );

    // Expresión compuesta: V(1) * sin(pi/2) + V(2)^2 = 5.0 * 1.0 + 9.0 = 14.0
    let r7 =
        evaluate_expression_string("V(1) * sin(pi / 2) + V(2) ^ 2", &nv, &bc, 0.0).unwrap();
    assert!(
        (r7 - 14.0).abs() < 1e-10,
        "V(1)*sin(pi/2)+V(2)^2 = 14.0, obtenido: {}",
        r7
    );

    // Operador unario negativo: -V(3) = -1.5
    let r8 = evaluate_expression_string("-V(3)", &nv, &bc, 0.0).unwrap();
    assert!(
        (r8 - (-1.5)).abs() < 1e-10,
        "-V(3) = -1.5, obtenido: {}",
        r8
    );

    // Tiempo transitorio: t con time = 0.001
    let r9 = evaluate_expression_string("sin(2 * pi * 1000 * t)", &nv, &bc, 0.001).unwrap();
    let expected = (2.0 * std::f64::consts::PI * 1000.0 * 0.001).sin();
    assert!(
        (r9 - expected).abs() < 1e-10,
        "sin(2*pi*1000*t) con t=0.001, obtenido: {}",
        r9
    );

    // sqrt(abs(-16)) = 4.0
    let r10 = evaluate_expression_string("sqrt(abs(-16))", &nv, &bc, 0.0).unwrap();
    assert!(
        (r10 - 4.0).abs() < 1e-10,
        "sqrt(abs(-16)) = 4.0, obtenido: {}",
        r10
    );

    // max y min
    let r11 = evaluate_expression_string("max(V(1), V(2))", &nv, &bc, 0.0).unwrap();
    assert!(
        (r11 - 5.0).abs() < 1e-10,
        "max(V(1), V(2)) = 5.0, obtenido: {}",
        r11
    );

    let r12 = evaluate_expression_string("min(V(1), V(2))", &nv, &bc, 0.0).unwrap();
    assert!(
        (r12 - 3.0).abs() < 1e-10,
        "min(V(1), V(2)) = 3.0, obtenido: {}",
        r12
    );
}

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

#[test]
fn test_b_source_ad_findiff_codegen_empty_grad() {
    let mut cache = HashMap::new();
    let nv = [("1".to_string(), 5.0), ("2".to_string(), 3.0)]
        .into_iter()
        .collect();
    let bc = HashMap::new();
    let ad = evaluate_expression_ad("42.0", &nv, &bc, 0.0, &mut cache).unwrap();
    assert!(
        ad.grad.is_empty(),
        "Constante 42 debería tener grad vacío, tiene {:?}",
        ad.grad
    );
}

#[test]
fn test_b_source_ad_findiff_codegen_voltage_ref() {
    let mut cache = HashMap::new();
    let nv = [("1".to_string(), 5.0), ("2".to_string(), 3.0)]
        .into_iter()
        .collect();
    let bc = HashMap::new();
    let ad = evaluate_expression_ad("V(1)", &nv, &bc, 0.0, &mut cache).unwrap();
    assert_eq!(ad.value, 5.0, "V(1) debería ser 5.0");
    assert_eq!(ad.grad.get(&1), Some(&1.0), "dV(1)/dV1 debería ser 1");
}

#[test]
fn test_b_source_ad_findiff_codegen_vdiff_grad() {
    let mut cache = HashMap::new();
    let nv = [("1".to_string(), 7.0), ("2".to_string(), 2.0)]
        .into_iter()
        .collect();
    let bc = HashMap::new();
    let ad = evaluate_expression_ad("V(1,2)", &nv, &bc, 0.0, &mut cache).unwrap();
    assert!(
        (ad.value - 5.0).abs() < 1e-12,
        "V(1,2) debería ser 5.0, es {}",
        ad.value
    );
    assert_eq!(ad.grad.get(&1), Some(&1.0), "dV(1,2)/dV1 debería ser 1");
    assert_eq!(ad.grad.get(&2), Some(&-1.0), "dV(1,2)/dV2 debería ser -1");
}

#[test]
fn test_b_source_ad_findiff_codegen_product_rule() {
    let mut cache = HashMap::new();
    let nv = [("1".to_string(), 3.0), ("2".to_string(), 4.0)]
        .into_iter()
        .collect();
    let bc = HashMap::new();
    let ad = evaluate_expression_ad("V(1)*V(2)", &nv, &bc, 0.0, &mut cache).unwrap();
    assert!(
        (ad.value - 12.0).abs() < 1e-12,
        "V(1)*V(2) debería ser 12, es {}",
        ad.value
    );
    // d/dV1 = V(2) = 4, d/dV2 = V(1) = 3
    assert!(
        (ad.grad.get(&1).unwrap_or(&0.0) - 4.0).abs() < 1e-12,
        "dV/dV1 debería ser 4"
    );
    assert!(
        (ad.grad.get(&2).unwrap_or(&0.0) - 3.0).abs() < 1e-12,
        "dV/dV2 debería ser 3"
    );
}

#[test]
fn test_b_source_ad_findiff_codegen_chain_rule() {
    let mut cache = HashMap::new();
    let nv = [("1".to_string(), std::f64::consts::FRAC_PI_4)]
        .into_iter()
        .collect();
    let bc = HashMap::new();
    let ad = evaluate_expression_ad("sin(V(1))", &nv, &bc, 0.0, &mut cache).unwrap();
    let expected_val = (std::f64::consts::FRAC_PI_4).sin();
    assert!(
        (ad.value - expected_val).abs() < 1e-12,
        "sin(V(1)) debería ser {}, es {}",
        expected_val,
        ad.value
    );
    let expected_deriv = (std::f64::consts::FRAC_PI_4).cos();
    assert!(
        (ad.grad.get(&1).unwrap_or(&0.0) - expected_deriv).abs() < 1e-12,
        "d(sin(V1))/dV1 debería ser {}, es {}",
        expected_deriv,
        ad.grad.get(&1).unwrap_or(&0.0)
    );
}

#[test]
fn test_b_source_ad_findiff_codegen_vs_findiff() {
    let mut cache = HashMap::new();
    let eps = 1e-6;
    let v0 = 2.0;
    let nv = [("1".to_string(), v0)].into_iter().collect();
    let bc = HashMap::new();
    let ad =
        evaluate_expression_ad("V(1)*V(1) + exp(V(1))", &nv, &bc, 0.0, &mut cache).unwrap();
    let analytic_deriv = ad.grad.get(&1).unwrap_or(&0.0);

    let nv_plus = [("1".to_string(), v0 + eps)].into_iter().collect();
    let ad_plus =
        evaluate_expression_ad("V(1)*V(1) + exp(V(1))", &nv_plus, &bc, 0.0, &mut cache)
            .unwrap();
    let nv_minus = [("1".to_string(), v0 - eps)].into_iter().collect();
    let ad_minus =
        evaluate_expression_ad("V(1)*V(1) + exp(V(1))", &nv_minus, &bc, 0.0, &mut cache)
            .unwrap();
    let fd_deriv = (ad_plus.value - ad_minus.value) / (2.0 * eps);

    assert!(
        (analytic_deriv - fd_deriv).abs() < 1e-6,
        "Analytic dV/dV1={} no coincide con FD={}",
        analytic_deriv,
        fd_deriv
    );
}

#[test]
fn test_b_source_ad_findiff_codegen_bvoltage_stamp() {
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
                id: "R1".to_string(),
                comp_type: "resistor".to_string(),
                value: 1000.0,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "B1".to_string(),
                comp_type: "bvoltage".to_string(),
                value: 0.0,
                pins: vec!["2".to_string(), "0".to_string()],
                expression: Some("V(1) / 2.0".to_string()),
                ..Default::default()
            },
        ],
        ..Default::default()
    };
    let result = solve_dc_circuit(&netlist).unwrap();
    let v2 = *result.node_voltages.get("2").unwrap();
    assert!(
        (v2 - 5.0).abs() < 0.1,
        "V(2) con bvoltage AD debería ser ~5.0V, es {}",
        v2
    );
}

#[test]
fn test_b_source_ad_findiff_codegen_bcurrent_stamp() {
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
                comp_type: "bcurrent".to_string(),
                value: 0.0,
                pins: vec!["2".to_string(), "0".to_string()],
                expression: Some("V(2) / 1000".to_string()),
                ..Default::default()
            },
        ],
        ..Default::default()
    };
    let result = solve_dc_circuit(&netlist).unwrap();
    let v2 = *result.node_voltages.get("2").unwrap();
    let expected_v2 = 5.0 / 3.0;
    assert!(
        (v2 - expected_v2).abs() < 0.1,
        "V(2) con bcurrent AD debería ser ~{:.3}V, es {}",
        expected_v2,
        v2
    );
}
