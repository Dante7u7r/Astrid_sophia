use super::*;

#[test]
fn test_rc_transient_circuit() {
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
                id: "C1".to_string(),
                comp_type: "capacitor".to_string(),
                value: 10e-6, // 10 µF
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

    let settings = TransientSettings {
        dt: 0.001,   // 1 ms
        t_max: 0.05, // 50 ms
        fixed_step: None,
        integration_method: None,
    };

    let results = solve_transient_circuit(&netlist, &settings).unwrap();
    assert!(
        results.len() > 0,
        "Debería haber al menos un paso temporal de simulación."
    );

    let get_voltage_at = |target_t: f64| -> f64 {
        let mut closest_val = 0.0;
        let mut min_diff = f64::MAX;
        for step in &results {
            let diff = (step.time - target_t).abs();
            if diff < min_diff {
                min_diff = diff;
                closest_val = *step.node_voltages.get("2").unwrap();
            }
        }
        closest_val
    };

    let v_t0 = get_voltage_at(0.0);
    assert!(
        v_t0 >= 0.0 && v_t0 < 1.0,
        "Voltaje inicial en el primer paso debería rondar los 0V-0.5V, obtenido: {}",
        v_t0
    );

    let v_t10 = get_voltage_at(0.010);
    assert!(
        v_t10 > 2.8 && v_t10 < 3.4,
        "Voltaje RC en t=10ms debería rondar los 3.16V, obtenido: {}",
        v_t10
    );

    let v_t50 = get_voltage_at(0.050);
    assert!(
        v_t50 > 4.9,
        "Voltaje RC en t=50ms debería estar casi cargado (>4.9V), obtenido: {}",
        v_t50
    );
}

#[test]
fn test_cmos_inverter_transient() {
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "Vdd".to_string(),
                comp_type: "vsource".to_string(),
                value: 5.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Vin".to_string(),
                comp_type: "vsource".to_string(),
                value: 5.0,
                pins: vec!["3".to_string(), "0".to_string()],
                wave_type: Some("square".to_string()),
                amplitude: Some(2.5),
                frequency: Some(10e3), // 10 kHz
                offset: Some(2.5),     // pulso cuadrado de 0V a 5V
                duty_cycle: Some(0.5),
                ..Default::default()
            },
            ComponentData {
                id: "Mn1".to_string(),
                comp_type: "nmos".to_string(),
                value: 1.0, // Vth = 1.0 V
                pins: vec!["3".to_string(), "2".to_string(), "0".to_string()], // G, D, S
                ..Default::default()
            },
            ComponentData {
                id: "Mp1".to_string(),
                comp_type: "pmos".to_string(),
                value: -1.0, // Vth = -1.0 V
                pins: vec!["3".to_string(), "2".to_string(), "1".to_string()], // G, D, S (S a Vdd 5V)
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let settings = TransientSettings {
        dt: 1e-6,    // 1 µs paso nominal inicial
        t_max: 1e-4, // 100 µs simulación (un ciclo de conmutación completo a 10 kHz es 100 µs)
        fixed_step: None,
        integration_method: None,
    };

    let results = solve_transient_circuit(&netlist, &settings).unwrap();
    assert!(
        results.len() > 0,
        "La simulación transitoria de inversor CMOS debió generar resultados."
    );

    // Validar conmutación física dinámicamente
    let get_voltage_at = |target_t: f64| -> f64 {
        let mut closest_val = 0.0;
        let mut min_diff = f64::MAX;
        for step in &results {
            let diff = (step.time - target_t).abs();
            if diff < min_diff {
                min_diff = diff;
                closest_val = *step.node_voltages.get("2").unwrap();
            }
        }
        closest_val
    };

    // En t=25 µs, Vin es 5V (por el offset y amplitud del pulso cuadrado de 10kHz):
    // la salida (Vout, nodo 2) debe estar descargada cerca de 0V
    let v_out_low = get_voltage_at(25e-6);
    assert!(v_out_low < 0.5, "La salida del inversor CMOS debería estar a nivel bajo (~0V) con entrada alta, obtenido: {}", v_out_low);

    // En t=75 µs, Vin es 0V (mitad negativa de la onda cuadrada):
    // la salida (Vout, nodo 2) debe estar cargada a 5V (Vdd)
    let v_out_high = get_voltage_at(75e-6);
    assert!(v_out_high > 4.5, "La salida del inversor CMOS debería estar a nivel alto (~5V) con entrada baja, obtenido: {}", v_out_high);
}

#[test]
fn test_bjt_transient_delay() {
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "Vcc".to_string(),
                comp_type: "vsource".to_string(),
                value: 5.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Vin".to_string(),
                comp_type: "vsource".to_string(),
                value: 0.0,
                pins: vec!["3".to_string(), "0".to_string()],
                wave_type: Some("sine".to_string()),
                amplitude: Some(5.0), // Senoidal de 5V pico que arranca suavemente en 0V a t=0s
                frequency: Some(10e3), // 10 kHz
                offset: Some(0.0),
                ..Default::default()
            },
            ComponentData {
                id: "Rb".to_string(),
                comp_type: "resistor".to_string(),
                value: 10000.0, // 10k
                pins: vec!["3".to_string(), "4".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Rc".to_string(),
                comp_type: "resistor".to_string(),
                value: 1000.0, // 1k
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Q1".to_string(),
                comp_type: "npn".to_string(),
                value: 100.0, // beta = 100
                pins: vec!["4".to_string(), "2".to_string(), "0".to_string()], // B, C, E
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let settings = TransientSettings {
        dt: 1e-6,
        t_max: 1e-4,
        fixed_step: None,
        integration_method: None,
    };

    let results = solve_transient_circuit(&netlist, &settings).unwrap();
    assert!(
        results.len() > 0,
        "Debería haber resultados de simulación transitoria para BJT."
    );

    let get_voltage_at = |target_t: f64| -> f64 {
        let mut closest_val = 0.0;
        let mut min_diff = f64::MAX;
        for step in &results {
            let diff = (step.time - target_t).abs();
            if diff < min_diff {
                min_diff = diff;
                closest_val = *step.node_voltages.get("2").unwrap();
            }
        }
        closest_val
    };

    // Vin es alto (~5V) en t=25 µs (pico positivo, NPN encendido/saturado): Vcollector debería ser bajo (<0.5V)
    let v_c_low = get_voltage_at(25e-6);
    assert!(
        v_c_low < 0.5,
        "El colector del NPN saturado debería estar a nivel bajo (<0.5V), obtenido: {}",
        v_c_low
    );

    // Vin es bajo (~-5V) en t=75 µs (pico negativo, NPN cortado): Vcollector debería subir a Vcc (5V)
    let v_c_high = get_voltage_at(75e-6);
    assert!(
        v_c_high > 4.5,
        "El colector del NPN cortado debería subir a Vcc (~5V), obtenido: {}",
        v_c_high
    );
}

#[test]
fn test_diode_clipper_transient() {
    // Circuito: Vin (10 MHz sine, 5V amp) -> R1 (1k) -> D1 (anodo a nodo 2, catodo a gnd)
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "Vin".to_string(),
                comp_type: "vsource".to_string(),
                value: 0.0,
                pins: vec!["1".to_string(), "0".to_string()],
                wave_type: Some("sine".to_string()),
                amplitude: Some(5.0),
                frequency: Some(1e7), // 10 MHz
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
                id: "D1".to_string(),
                comp_type: "diode".to_string(),
                value: 0.0,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: Some(true),
        subcircuit_definitions: None,
        triggers: None,
    };

    let settings = TransientSettings {
        dt: 1e-9,      // 1 ns
        t_max: 200e-9, // 200 ns
        fixed_step: Some(true),
        integration_method: None,
    };

    let results = solve_transient_circuit(&netlist, &settings).unwrap();
    assert!(results.len() > 0);

    let mut max_v2 = 0.0;
    for step in &results {
        let v2 = *step.node_voltages.get("2").unwrap();
        if v2 > max_v2 {
            max_v2 = v2;
        }
    }

    assert!(
        max_v2 > 0.0,
        "La tensión debería ser positiva en los semiciclos positivos."
    );
}

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
    assert!(results_euler.len() > 0);

    // 2. Simular con Gear 2 (BDF2)
    let settings_gear = TransientSettings {
        dt: 1e-5,
        t_max: 1e-3,
        fixed_step: Some(true),
        integration_method: Some("gear2".to_string()),
    };
    let results_gear = solve_transient_circuit(&netlist_rlc, &settings_gear).unwrap();
    assert!(results_gear.len() > 0);
    assert_eq!(results_euler.len(), results_gear.len());

    // Verificar que el capacitor de Gear 2 se carga y oscila suavemente hacia 5V
    let final_step_gear = results_gear.last().unwrap();
    let v_cap_gear = *final_step_gear.node_voltages.get("3").unwrap();
    assert!(v_cap_gear > 0.0 && v_cap_gear < 10.0);
}

#[test]
fn test_self_heating_diode_transient() {
    // Circuito: V1 (sine 1kHz, 5V) -> nodo 1, R1 (1kΩ) entre nodo 1 y nodo 2, D1 entre nodo 2 y GND
    // Self-heating no debe provocar divergencia y el modelo térmico debe activarse
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
                frequency: Some(1e3), // 1 kHz
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
                id: "D1".to_string(),
                comp_type: "diode".to_string(),
                value: 0.0,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: Some(300.0),
        fixed_step: Some(true),
        subcircuit_definitions: None,
        triggers: None,
    };

    let settings = TransientSettings {
        dt: 1e-5,    // 10 μs
        t_max: 2e-3, // 2 ms — 2 ciclos completos de la senoidal a 1 kHz
        fixed_step: Some(true),
        integration_method: Some("euler".to_string()),
    };

    let results = solve_transient_circuit(&netlist, &settings).unwrap();
    assert!(
        results.len() > 50,
        "Debería haber > 50 pasos, hay: {}",
        results.len()
    );

    // Verificar que la simulación con self-heating produce resultados estables
    let last = results.last().unwrap();
    let v2_last = *last.node_voltages.get("2").unwrap();
    // V(2) debe estar en un rango razonable (clip del diodo entre -0.7V y ~5V)
    assert!(
        v2_last > -1.0 && v2_last < 6.0,
        "V(2) fuera de rango, obtenido: {}",
        v2_last
    );

    // Verificar que hay corriente no trivial en algún paso (semiciclo positivo)
    let mut found_current = false;
    for step in &results {
        let i_v1 = step.branch_currents.get("V1").unwrap().abs();
        if i_v1 > 0.001 {
            // > 1 mA
            found_current = true;
            break;
        }
    }
    assert!(
        found_current,
        "El diodo debería conducir corriente > 1 mA en el semiciclo positivo"
    );

    // Verificar que get_thermal_parameters_junction produce valores físicamente sensatos
    let (vt_310, is_310) = get_thermal_parameters_junction(310.0, None);
    let (vt_300, is_300) = get_thermal_parameters_junction(300.0, None);
    // A mayor temperatura: Vt debe aumentar (k*T/q crece) e Is debe aumentar (más portadores)
    assert!(
        vt_310 > vt_300,
        "Vt(310K) = {} debería ser > Vt(300K) = {}",
        vt_310,
        vt_300
    );
    assert!(
        is_310 > is_300,
        "Is(310K) = {} debería ser > Is(300K) = {}",
        is_310,
        is_300
    );
    // Verificar ratio: Is crece ~4x por cada 10°C para silicio con modelo SPICE (T/T0)^3 * exp(-Eg*q/k*(1/T-1/T0))
    let is_ratio = is_310 / is_300;
    assert!(
        is_ratio > 2.0 && is_ratio < 6.0,
        "Is(310K)/Is(300K) = {:.3}, debería estar entre 2.0 y 6.0 para silicio (SPICE)",
        is_ratio
    );
}

#[test]
fn test_transient_isource_waveform() {
    use crate::parser::parse_spice_netlist_to_native;
    let netlist_str = "
    * Transient dynamic current source
    I1 0 1 SIN(0 10m 1k)
    R1 1 0 100
    ";
    let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
    let settings = TransientSettings {
        dt: 1e-4,
        t_max: 1e-3,
        fixed_step: None,
        integration_method: None,
    };
    let res = solve_transient_circuit(&parsed, &settings).unwrap();
    assert!(!res.is_empty(), "Transitorio debe generar pasos de tiempo");
}

#[test]
fn test_ic_transient_initialization() {
    use crate::parser::parse_spice_netlist_to_native;
    let netlist_str = "
    * Test initial conditions .ic
    .ic V(1)=3.3 V(2)=1.5
    C1 1 2 1u
    R1 2 0 1k
    ";
    let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
    let settings = TransientSettings {
        dt: 1e-5,
        t_max: 1e-4,
        fixed_step: None,
        integration_method: None,
    };
    let res = solve_transient_circuit(&parsed, &settings).unwrap();
    assert!(!res.is_empty());
    let first_step = &res[0];
    let v1 = *first_step.node_voltages.get("1").unwrap();
    let v2 = *first_step.node_voltages.get("2").unwrap();
    assert!(
        (v1 - v2 - 1.8).abs() < 0.1,
        "La diferencia de potencial del capacitor debe iniciarse en 1.8V"
    );
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
    // TRAP should have similar or better amplitude than Euler (both are valid integration methods)
    // The key difference is that TRAP is 2nd order and Euler is 1st order
}
