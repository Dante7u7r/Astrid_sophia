// ==========================================================================
// ASTRYD SOPHIA — CIRCUIT OPTIMIZER & AUTO-TUNING TESTS
// ==========================================================================

use crate::solver::engine::advanced::optimizer::{
    solve_circuit_optimization, OptimizableParam, OptimizationSettings, OptimizationTarget,
};
use crate::solver::types::{CircuitNetlist, ComponentData};
use std::f64::consts::PI;

#[test]
fn test_optimizer_dc_voltage_divider_auto_tuning() {
    // Divisor de tensión: Vin = 10V, R1 = 1000 Ohm, R2 = ?
    // Objetivo: V(out) = 3.3333 V -> R2 teórico = 500 Ohm
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "Vin".to_string(),
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
                id: "R2".to_string(),
                comp_type: "resistor".to_string(),
                value: 100.0, // Valor inicial descalibrado
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        temperature: Some(300.0),
        ..Default::default()
    };

    let params = vec![OptimizableParam {
        component_id: "R2".to_string(),
        property: "value".to_string(),
        min_val: 10.0,
        max_val: 10000.0,
        initial_val: 100.0,
    }];

    let targets = vec![OptimizationTarget::DcNodeVoltage {
        node: "2".to_string(),
        target_voltage: 3.333333,
        weight: 1.0,
    }];

    let settings = OptimizationSettings {
        max_iterations: 25,
        tolerance: 1e-5,
        initial_mu: 1e-3,
    };

    let result = solve_circuit_optimization(&netlist, &params, &targets, &settings)
        .expect("Optimizador debe converger");

    assert!(result.converged, "Optimizador debe converger al mínimo");
    let r2_optimal = result
        .optimal_parameters
        .get("R2.value")
        .copied()
        .expect("R2.value debe estar en resultados");

    assert!(
        (r2_optimal - 500.0).abs() < 1.0,
        "R2 optimizado debe ser cercano a 500 Ohm (obtenido: {:.2} Ohm)",
        r2_optimal
    );
    assert!(
        result.final_cost < 1e-6,
        "Costo final debe ser prácticamente nulo (obtenido: {:.2e})",
        result.final_cost
    );
}

#[test]
fn test_optimizer_ac_rc_lowpass_cutoff_frequency_tuning() {
    // Filtro pasa-bajos RC: Vin -> R1 (1000 Ohm) -> C1 (?) -> Tierra
    // Objetivo: Frecuencia de corte fc = 10 kHz (-3dB)
    // C teórico = 1 / (2 * pi * R * fc) = 1 / (2 * pi * 1000 * 10000) = 15.9155 nF
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "Vin".to_string(),
                comp_type: "vsource".to_string(),
                value: 1.0, // 1V AC
                amplitude: Some(1.0),
                frequency: Some(10000.0),
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
                id: "C1".to_string(),
                comp_type: "capacitor".to_string(),
                value: 100e-9, // Inicialmente 100 nF (descalibrado)
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        temperature: Some(300.0),
        ..Default::default()
    };

    let params = vec![OptimizableParam {
        component_id: "C1".to_string(),
        property: "value".to_string(),
        min_val: 1e-12,
        max_val: 1e-6,
        initial_val: 100e-9,
    }];

    let targets = vec![OptimizationTarget::AcCutoffFreq {
        node: "2".to_string(),
        ref_freq: 10.0,            // 10 Hz como referencia DC/baja frecuencia
        target_cutoff_freq: 10000.0, // 10 kHz
        weight: 1.0,
    }];

    let settings = OptimizationSettings {
        max_iterations: 30,
        tolerance: 1e-4,
        initial_mu: 1e-2,
    };

    let result = solve_circuit_optimization(&netlist, &params, &targets, &settings)
        .expect("Optimizador de filtro AC debe converger");

    assert!(result.converged, "Optimizador AC debe converger");
    let c1_optimal = result
        .optimal_parameters
        .get("C1.value")
        .copied()
        .expect("C1.value debe estar en resultados");

    let c_theoretical = 1.0 / (2.0 * PI * 1000.0 * 10000.0);
    assert!(
        (c1_optimal - c_theoretical).abs() / c_theoretical < 0.05,
        "Capacitancia optimizada debe coincidir con la teórica (obtenido: {:.4e} F, teórico: {:.4e} F)",
        c1_optimal,
        c_theoretical
    );
}

#[test]
fn test_optimizer_multi_variable_bjt_bias_and_gain_tuning() {
    // Amplificador emisor común BJT: Vcc = 12V
    // Ajustar Rb para fijar Vc = 6V (zona activa lineal)
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "Vcc".to_string(),
                comp_type: "vsource".to_string(),
                value: 12.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Rb".to_string(),
                comp_type: "resistor".to_string(),
                value: 200_000.0,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Rc".to_string(),
                comp_type: "resistor".to_string(),
                value: 2000.0, // 2k
                pins: vec!["1".to_string(), "3".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Q1".to_string(),
                comp_type: "npn".to_string(),
                value: 100.0, // Beta = 100
                pins: vec!["2".to_string(), "3".to_string(), "0".to_string()], // Base=2, Collector=3, Emitter=0
                ..Default::default()
            },
        ],
        temperature: Some(300.0),
        ..Default::default()
    };

    let params = vec![
        OptimizableParam {
            component_id: "Rb".to_string(),
            property: "value".to_string(),
            min_val: 10_000.0,
            max_val: 2_000_000.0,
            initial_val: 200_000.0,
        },
    ];

    let targets = vec![OptimizationTarget::DcNodeVoltage {
        node: "3".to_string(), // Colector
        target_voltage: 6.0,
        weight: 1.0,
    }];

    let settings = OptimizationSettings {
        max_iterations: 35,
        tolerance: 1e-4,
        initial_mu: 1e-2,
    };

    let result = solve_circuit_optimization(&netlist, &params, &targets, &settings)
        .expect("Optimizador multivariable BJT debe converger");

    assert!(result.converged, "Optimizador debe converger al punto Q");
    let v_collector_achieved = result
        .achieved_targets
        .get("target_0_DcNodeVoltage_3")
        .copied()
        .unwrap_or(0.0);

    assert!(
        (v_collector_achieved - 6.0).abs() < 0.05,
        "Tensión de colector debe ser 6.0V (obtenido: {:.3} V)",
        v_collector_achieved
    );
}

#[test]
fn test_optimizer_transient_settling_voltage_tuning() {
    // Circuito RC cargado por fuente de escalón DC
    // Ajustar R1 para que la tensión en el condensador a t = 1ms alcance exactamente 4.0V
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "Vin".to_string(),
                comp_type: "vsource".to_string(),
                value: 5.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "R1".to_string(),
                comp_type: "resistor".to_string(),
                value: 5000.0,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C1".to_string(),
                comp_type: "capacitor".to_string(),
                value: 1e-6, // 1 uF
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "ic1".to_string(),
                comp_type: "ic_directive".to_string(),
                pins: vec!["2".to_string()],
                value: 0.0,
                ..Default::default()
            },
        ],
        temperature: Some(300.0),
        ..Default::default()
    };

    let params = vec![OptimizableParam {
        component_id: "R1".to_string(),
        property: "value".to_string(),
        min_val: 100.0,
        max_val: 20000.0,
        initial_val: 5000.0,
    }];

    let targets = vec![OptimizationTarget::TransientSettleVoltage {
        node: "2".to_string(),
        target_voltage: 4.0,
        t_max: 0.001, // 1 ms
        weight: 1.0,
    }];

    let settings = OptimizationSettings {
        max_iterations: 30,
        tolerance: 1e-3,
        initial_mu: 1e-2,
    };

    let result = solve_circuit_optimization(&netlist, &params, &targets, &settings)
        .expect("Optimizador transitorio debe converger");

    assert!(result.converged, "Optimizador transitorio debe converger");
    let achieved_v = result
        .achieved_targets
        .get("target_0_TransientSettleVoltage_2")
        .copied()
        .unwrap_or(0.0);

    assert!(
        (achieved_v - 4.0).abs() < 0.05,
        "Tensión transitoria a 1ms debe ser 4.0V (obtenido: {:.3} V)",
        achieved_v
    );
}
