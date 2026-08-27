// ==========================================================================
// ASTRYD SOPHIA — REAL-TIME TRANSIENT ELECTROTHERMAL CO-SIMULATION TESTS
// ==========================================================================

use crate::solver::engine::transient::solve_transient_circuit;
use crate::solver::simulation_types::TransientSettings;
use crate::solver::types::{CircuitNetlist, ComponentData, ThermalConfig};

#[test]
fn test_transient_thermal_igbt_switching_self_heating() {
    // Circuito: Fuente DC (V1 = 100V) -> Carga R1 (10 Ohm) -> IGBT (Q1) -> Tierra
    // Fuente de pulso de puerta Vg (0 a 15V) en nodo 3
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "Vcc".to_string(),
                comp_type: "vsource".to_string(),
                value: 100.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Rload".to_string(),
                comp_type: "resistor".to_string(),
                value: 10.0,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Vg".to_string(),
                comp_type: "vsource".to_string(),
                value: 15.0,
                wave_type: Some("pulse".to_string()),
                amplitude: Some(15.0),
                frequency: Some(1000.0),
                duty_cycle: Some(0.5),
                offset: Some(0.0),
                pins: vec!["3".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Q1".to_string(),
                comp_type: "igbt".to_string(),
                value: 5.0, // Vth
                pins: vec!["3".to_string(), "2".to_string(), "0".to_string()],
                rth: Some(10.0), // 10 K/W
                cth: Some(0.001), // 1 ms constante térmica
                ..Default::default()
            },
        ],
        temperature: Some(300.0),
        ..Default::default()
    };

    let settings = TransientSettings {
        t_max: 2e-3,
        dt: 10e-6,
        fixed_step: None,
        integration_method: Some("trapezoidal".to_string()),
    };

    let results = solve_transient_circuit(&netlist, &settings)
        .expect("Simulación transitoria electrotérmica de IGBT debe converger");

    assert!(!results.is_empty(), "Deben generarse pasos transitorios");

    // Verificar que los pasos contienen telemetría de temperaturas
    let mut max_q1_temp = 300.0;
    for step in &results {
        if let Some(ref temps) = step.device_temperatures {
            if let Some(&t_q1) = temps.get("Q1") {
                if t_q1 > max_q1_temp {
                    max_q1_temp = t_q1;
                }
            }
        }
    }

    assert!(
        max_q1_temp > 300.0,
        "La temperatura de unión del IGBT debe elevarse sobre los 300 K debido a la disipación (obtenido: {:.2} K)",
        max_q1_temp
    );
}

#[test]
fn test_transient_mutual_thermal_coupling_heatsink() {
    // Dos transistores MOSFET (M1 y M2) en el mismo heatsink.
    // M1 conduce corriente continua alta y disipa potencia.
    // M2 está apagado (Vgs = 0V) pero debe calentarse por acoplamiento térmico mutuo.
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "Vdd".to_string(),
                comp_type: "vsource".to_string(),
                value: 20.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "R1".to_string(),
                comp_type: "resistor".to_string(),
                value: 10.0,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Vgate1".to_string(),
                comp_type: "vsource".to_string(),
                value: 10.0, // M1 completamente encendido
                pins: vec!["3".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "M1".to_string(),
                comp_type: "nmos".to_string(),
                value: 2.0, // Vth
                pins: vec!["3".to_string(), "2".to_string(), "0".to_string(), "0".to_string()],
                rth: Some(20.0),
                cth: Some(0.005),
                ..Default::default()
            },
            // M2 apagado en nodo separado
            ComponentData {
                id: "M2".to_string(),
                comp_type: "nmos".to_string(),
                value: 2.0,
                pins: vec!["0".to_string(), "4".to_string(), "0".to_string(), "0".to_string()],
                rth: Some(20.0),
                cth: Some(0.005),
                ..Default::default()
            },
        ],
        temperature: Some(300.0),
        thermal_config: Some(ThermalConfig {
            t_amb: 300.0,
            max_thermal_iters: 20,
            thermal_tol: 0.1,
            thermal_coupling: vec![("M1".to_string(), "M2".to_string(), 8.0)], // 8 K/W acoplamiento mutuo
        }),
        ..Default::default()
    };

    let settings = TransientSettings {
        t_max: 5e-3,
        dt: 50e-6,
        fixed_step: Some(true),
        integration_method: Some("trapezoidal".to_string()),
    };

    let results = solve_transient_circuit(&netlist, &settings)
        .expect("Simulación de acoplamiento térmico mutuo debe converger");

    let last_step = results.last().expect("Debe existir último paso");
    let temps = last_step
        .device_temperatures
        .as_ref()
        .expect("Debe incluir mapa de temperaturas");

    let t_m1 = temps.get("M1").copied().unwrap_or(300.0);
    let t_m2 = temps.get("M2").copied().unwrap_or(300.0);

    assert!(
        t_m1 > 305.0,
        "M1 debe auto-calentarse significativamente (obtenido: {:.2} K)",
        t_m1
    );
    assert!(
        t_m2 > 300.0,
        "M2 debe calentarse por conducción térmica a través del heatsink compartido (obtenido: {:.2} K)",
        t_m2
    );
}

#[test]
fn test_transient_thermal_feedback_diode() {
    // Circuito: Fuente DC (V1 = 5V) -> R (100 Ohm) -> Diodo (D1) -> Tierra
    // Conforme D1 disipa calor (Vd * Id), su temperatura Tj(t) sube,
    // reduciendo la caída de tensión directa Vd (coeficiente térmico negativo de ~ -2mV/K).
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
                value: 50.0,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "D1".to_string(),
                comp_type: "diode".to_string(),
                value: 0.0,
                pins: vec!["2".to_string(), "0".to_string()],
                rth: Some(150.0), // 150 K/W
                cth: Some(0.0001), // tau = 15 ms
                ..Default::default()
            },
        ],
        temperature: Some(300.0),
        ..Default::default()
    };

    let settings = TransientSettings {
        t_max: 10e-3,
        dt: 100e-6,
        fixed_step: Some(true),
        integration_method: Some("trapezoidal".to_string()),
    };

    let results = solve_transient_circuit(&netlist, &settings)
        .expect("Simulación electrotérmica de diodo debe converger");

    let first_vd = results.first().unwrap().node_voltages.get("2").copied().unwrap();
    let last_vd = results.last().unwrap().node_voltages.get("2").copied().unwrap();

    let last_temp = results
        .last()
        .unwrap()
        .device_temperatures
        .as_ref()
        .and_then(|t| t.get("D1"))
        .copied()
        .unwrap_or(300.0);

    assert!(
        last_temp > 300.5,
        "La temperatura del diodo debe aumentar con la disipación de potencia (T_final: {:.2} K)",
        last_temp
    );
    assert!(
        last_vd < first_vd,
        "La tensión de unión directa Vd debe reducirse al calentarse el diodo (Vd_ini: {:.4} V, Vd_fin: {:.4} V)",
        first_vd,
        last_vd
    );
}
