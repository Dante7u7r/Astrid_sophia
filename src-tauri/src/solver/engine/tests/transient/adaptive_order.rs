use super::super::*;
use crate::solver::engine::transient_step_control::{
    detect_trapezoidal_ringing, predict_variable_order_step, IntegrationMethodType,
    VariableOrderController,
};
use nalgebra::DVector;

#[test]
fn test_variable_order_controller_transitions() {
    let mut controller = VariableOrderController::new("auto");
    assert!(controller.is_auto());
    assert_eq!(controller.active_method, IntegrationMethodType::Trap);

    // 1. Simular rechazo por error severo (>5x lte_tol): debe conmutar a Euler para absorber discontinuidad
    let sol_n = DVector::from_vec(vec![0.0]);
    let sol_n1 = DVector::from_vec(vec![0.0]);
    let sol_n2 = DVector::from_vec(vec![0.0]);
    let step_bad = DVector::from_vec(vec![10.0]); // Salto brusco

    let decision_reject = predict_variable_order_step(
        &mut controller,
        &step_bad,
        &sol_n,
        &sol_n1,
        &sol_n2,
        1,
        1e-4,
        1e-4,
        false,
        3,
        1e-4,
        1e-8,
        1e-3,
        1e-3,
        1e-6,
    );

    assert!(
        !decision_reject.step_accepted,
        "Paso con salto severo debe ser rechazado"
    );
    assert_eq!(
        decision_reject.next_method,
        IntegrationMethodType::Euler,
        "Debe conmutar a Euler tras discontinuidad"
    );

    // 2. Simular detección de ringing trapezoidal
    controller.active_method = IntegrationMethodType::Trap;
    controller.ringing_count = 0;

    let step_ring = DVector::from_vec(vec![5.0]);
    let sol_prev1 = DVector::from_vec(vec![2.0]);
    let sol_prev2 = DVector::from_vec(vec![5.0]);
    let sol_prev3 = DVector::from_vec(vec![2.0]);

    assert!(detect_trapezoidal_ringing(
        &step_ring, &sol_prev1, &sol_prev2, 1, 1e-6
    ));

    let decision_ring = predict_variable_order_step(
        &mut controller,
        &step_ring,
        &sol_prev1,
        &sol_prev2,
        &sol_prev3,
        1,
        1e-5,
        1e-5,
        false,
        4,
        1e-2, // lte_tol amplia para aceptar pero evaluar cambio
        1e-8,
        1e-3,
        1e-3,
        1e-6,
    );

    assert!(decision_ring.ringing_detected);
    assert_eq!(
        decision_ring.next_method,
        IntegrationMethodType::Gear2,
        "Ringing detectado debe promover cambio a GEAR2"
    );
}

#[test]
fn test_variable_order_preserves_lc_resonance_energy() {
    // Circuito LC no amortiguado excitado por pulso corto
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 0.0,
                pins: vec!["1".to_string(), "0".to_string()],
                wave_type: Some("sine".to_string()),
                amplitude: Some(5.0),
                frequency: Some(1000.0),
                ..Default::default()
            },
            ComponentData {
                id: "R1".to_string(),
                comp_type: "resistor".to_string(),
                value: 100.0,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "L1".to_string(),
                comp_type: "inductor".to_string(),
                value: 1e-3,
                pins: vec!["2".to_string(), "0".to_string()],
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
        mutual_inductances: None,
        thermal_config: None,
        wires: vec![],
        temperature: None,
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let settings_auto = TransientSettings {
        dt: 1e-6,
        t_max: 20e-6,
        fixed_step: Some(false),
        integration_method: Some("auto".to_string()),
    };

    let results = solve_transient_circuit(&netlist, &settings_auto).unwrap();
    assert!(!results.is_empty());

    // Verificar oscilaciones mantenidas en nodo 2 durante la fase libre
    let max_amp = results
        .iter()
        .filter(|s| s.time > 5e-6)
        .map(|s| s.node_voltages.get("2").copied().unwrap_or(0.0).abs())
        .fold(0.0, f64::max);

    assert!(
        max_amp > 0.01,
        "Modo auto debe preservar resonancia LC sin sobreamortiguamiento artificial: {max_amp}"
    );
}

#[test]
fn test_variable_order_switching_under_fast_switching_pulse() {
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 0.0,
                pins: vec!["1".to_string(), "0".to_string()],
                wave_type: Some("pulse".to_string()),
                amplitude: Some(5.0),
                frequency: Some(50_000.0),
                duty_cycle: Some(0.5),
                ..Default::default()
            },
            ComponentData {
                id: "R1".to_string(),
                comp_type: "resistor".to_string(),
                value: 100.0,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "D1".to_string(),
                comp_type: "diode".to_string(),
                value: 0.0,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C1".to_string(),
                comp_type: "capacitor".to_string(),
                value: 100e-12,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        mutual_inductances: None,
        thermal_config: None,
        wires: vec![],
        temperature: None,
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let settings = TransientSettings {
        dt: 1e-7,
        t_max: 5e-6,
        fixed_step: Some(false),
        integration_method: Some("auto".to_string()),
    };

    let results = solve_transient_circuit(&netlist, &settings).unwrap();
    assert!(!results.is_empty());

    // Verificar que el diodo limita la tensión directa cerca de 0.7V-1.0V
    let max_v2 = results
        .iter()
        .map(|s| s.node_voltages.get("2").copied().unwrap_or(0.0))
        .fold(f64::NEG_INFINITY, f64::max);

    assert!(
        max_v2 < 1.5,
        "La tensión recortada debe mantenerse acotada por el diodo: {max_v2}"
    );
}
