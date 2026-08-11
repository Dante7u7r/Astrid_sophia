use super::super::*;

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
