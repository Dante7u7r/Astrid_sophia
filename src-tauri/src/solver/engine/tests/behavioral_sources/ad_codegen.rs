use super::super::*;

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
