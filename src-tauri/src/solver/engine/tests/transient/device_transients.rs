use super::super::*;

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
