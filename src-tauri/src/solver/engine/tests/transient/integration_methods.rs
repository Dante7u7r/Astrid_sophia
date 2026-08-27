use super::super::*;

#[test]
fn test_gear2_integration_stability() {
    // Circuito RLC subamortiguado en serie
    let netlist_rlc = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
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
                value: 10.0,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "L1".to_string(),
                comp_type: "inductor".to_string(),
                value: 1e-3,
                pins: vec!["2".to_string(), "3".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C1".to_string(),
                comp_type: "capacitor".to_string(),
                value: 10e-6,
                pins: vec!["3".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: Some(true),
        subcircuit_definitions: None,
        triggers: None,
    };

    // 1. Simular con Backward Euler
    let settings_euler = TransientSettings {
        dt: 1e-5,
        t_max: 1e-3,
        fixed_step: Some(true),
        integration_method: Some("euler".to_string()),
    };
    let results_euler = solve_transient_circuit(&netlist_rlc, &settings_euler).unwrap();
    assert!(!results_euler.is_empty());

    // 2. Simular con Gear 2 (BDF2)
    let settings_gear = TransientSettings {
        dt: 1e-5,
        t_max: 1e-3,
        fixed_step: Some(true),
        integration_method: Some("gear2".to_string()),
    };
    let results_gear = solve_transient_circuit(&netlist_rlc, &settings_gear).unwrap();
    assert!(!results_gear.is_empty());
    assert_eq!(results_euler.len(), results_gear.len());

    // Verificar que el capacitor de Gear 2 se carga y oscila suavemente hacia 5V
    let final_step_gear = results_gear.last().unwrap();
    let v_cap_gear = *final_step_gear.node_voltages.get("3").unwrap();
    assert!(v_cap_gear > 0.0 && v_cap_gear < 10.0);
}

#[test]
fn test_lte_adaptive_timestep() {
    use crate::parser::parse_spice_netlist_to_native;
    let netlist_str = "
    * Test LTE adaptive timestep under transient sine wave
    V1 1 0 SIN(0 5 1k)
    R1 1 2 1k
    C1 2 0 1u
    ";
    let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
    let settings = TransientSettings {
        dt: 1e-5,
        t_max: 2e-3,
        fixed_step: Some(false),
        integration_method: Some("gear2".to_string()),
    };
    let res = solve_transient_circuit(&parsed, &settings).unwrap();
    assert!(
        !res.is_empty(),
        "La simulación transitoria adaptativa por LTE debe completarse exitosamente"
    );
}

#[test]
fn test_trap_integration_lc_resonance() {
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 0.0,
                pins: vec!["1".to_string(), "0".to_string()],
                wave_type: Some("pulse".to_string()),
                amplitude: Some(1.0),
                frequency: Some(5000.0),
                duty_cycle: Some(0.1),
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

    let settings_trap = TransientSettings {
        dt: 1e-6,
        t_max: 5e-3,
        fixed_step: Some(true),
        integration_method: Some("trap".to_string()),
    };

    let settings_euler = TransientSettings {
        dt: 1e-6,
        t_max: 5e-3,
        fixed_step: Some(true),
        integration_method: Some("euler".to_string()),
    };

    let results_trap = solve_transient_circuit(&netlist, &settings_trap).unwrap();
    let results_euler = solve_transient_circuit(&netlist, &settings_euler).unwrap();

    assert!(!results_trap.is_empty(), "TRAP: No hay resultados");
    assert!(!results_euler.is_empty(), "Euler: No hay resultados");

    let amp_trap: f64 = results_trap
        .iter()
        .filter(|s| s.time > 3e-3)
        .map(|s| s.node_voltages.get("2").unwrap().abs())
        .fold(0.0, f64::max);

    let amp_euler: f64 = results_euler
        .iter()
        .filter(|s| s.time > 3e-3)
        .map(|s| s.node_voltages.get("2").unwrap().abs())
        .fold(0.0, f64::max);

    println!("Amplitudes - TRAP: {}, Euler: {}", amp_trap, amp_euler);

    assert!(
        amp_trap > 1e-6,
        "TRAP debe producir oscilación, amplitud: {}",
        amp_trap
    );
}

#[test]
fn test_gear3_to_gear6_rc_step_exactness() {
    // Circuito RC clásico con escalón DC de 5V: V(t) = 5 * (1 - exp(-t / (R*C)))
    // R = 1k, C = 1uF -> tau = 1 ms
    let netlist_rc = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
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
                value: 1000.0,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C1".to_string(),
                comp_type: "capacitor".to_string(),
                value: 1e-6,
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
        wires: vec![],
        temperature: None,
        fixed_step: Some(true),
        subcircuit_definitions: None,
        triggers: None,
    };

    let _tau = 1e-3;
    let t_eval = 1e-3; // t = 1 tau -> V_exact = 5.0 * (1 - exp(-1)) = 3.1606027941427883 V
    let v_exact = 5.0 * (1.0 - (-1.0_f64).exp());

    let methods = vec!["gear2", "gear3", "gear4", "gear5", "gear6"];
    for method in methods {
        let settings = TransientSettings {
            dt: 1e-5,
            t_max: 2e-3,
            fixed_step: Some(true),
            integration_method: Some(method.to_string()),
        };
        let results = solve_transient_circuit(&netlist_rc, &settings)
            .unwrap_or_else(|e| panic!("Fallo al simular con {}: {}", method, e));

        assert!(!results.is_empty());

        // Encontrar el paso más cercano a t = tau
        let sample = results
            .iter()
            .min_by(|a, b| {
                (a.time - t_eval)
                    .abs()
                    .partial_cmp(&(b.time - t_eval).abs())
                    .unwrap()
            })
            .unwrap();

        let v_c = *sample.node_voltages.get("2").unwrap();
        let error = (v_c - v_exact).abs();
        assert!(
            error < 0.02,
            "Método {} excede la tolerancia en t=tau: obtenido={}, exacto={}, error={}",
            method,
            v_c,
            v_exact,
            error
        );
    }
}
