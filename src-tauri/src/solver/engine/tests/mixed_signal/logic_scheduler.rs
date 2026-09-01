use super::super::*;

#[test]
fn test_logic_gate_configurable_delays() {
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 0.0,
                pins: vec!["1".to_string(), "0".to_string()],
                wave_type: Some("pulse".to_string()),
                amplitude: Some(5.0),
                frequency: Some(500.0), // Periodo de 2 ms (1 ms en HIGH, 1 ms en LOW)
                offset: Some(0.0),
                duty_cycle: Some(0.5),
                ..Default::default()
            },
            ComponentData {
                id: "U1".to_string(),
                comp_type: "not_gate".to_string(),
                value: 0.0,
                pins: vec!["1".to_string(), "2".to_string()], // inversor
                delay: Some(10e-9),
                rise_delay: Some(15e-9),
                fall_delay: Some(25e-9),
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: Some(false),
        subcircuit_definitions: None,
        triggers: None,
    };

    let settings = TransientSettings {
        dt: 1e-6,
        t_max: 2e-3,
        integration_method: Some("euler".to_string()),
        fixed_step: Some(false),
    };

    let (results, _, _) = solve_transient_circuit_with_initial_states(
        &netlist,
        &settings,
        HashMap::new(),
        HashMap::new(),
    )
    .unwrap();
    assert!(results.len() > 20);

    let mut verified_fall_success = false;
    let mut verified_rise_success = false;

    for step in &results {
        let v2 = *step.node_voltages.get("2").unwrap();

        // Flanco de bajada (entrada sube a t=0.0, salida baja tras fall_delay=25ns)
        // A t=1us, el transitorio ya procesó la bajada a LOW (0V)
        if (step.time - 1e-6).abs() < 1e-9 {
            assert!(
                v2 < 0.5,
                "Salida U1 (inversor) en t=1us debería ser LOW (0V) tras fall_delay, obtenido: {}",
                v2
            );
            verified_fall_success = true;
        }

        // Flanco de subida (entrada baja a t=1.0ms, salida sube tras rise_delay=15ns)
        // A t=1.002ms (segundo paso tras bajada), la salida ya es HIGH (5V)
        if step.time > 1.002e-3 && step.time < 1.9e-3 {
            assert!(
                v2 > 4.5,
                "Salida U1 (inversor) en t={} debería ser HIGH (5V) tras rise_delay, obtenido: {}",
                step.time,
                v2
            );
            verified_rise_success = true;
        }
    }

    assert!(
        verified_fall_success,
        "No se pudo verificar el retardo de bajada"
    );
    assert!(
        verified_rise_success,
        "No se pudo verificar el retardo de subida"
    );
}

#[test]
fn test_mixed_signal_scheduler_event_sync() {
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 5.0,
                pins: vec!["1".to_string(), "0".to_string()],
                wave_type: Some("pulse".to_string()),
                amplitude: Some(5.0),
                frequency: Some(1e3),
                offset: Some(0.0),
                duty_cycle: Some(0.5),
                ..Default::default()
            },
            ComponentData {
                id: "U1".to_string(),
                comp_type: "not_gate".to_string(),
                value: 0.0,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: Some(false),
        subcircuit_definitions: None,
        triggers: None,
    };

    let settings = TransientSettings {
        dt: 1e-4,
        t_max: 2e-3,
        integration_method: Some("euler".to_string()),
        fixed_step: Some(false),
    };

    let (results, _, _) = solve_transient_circuit_with_initial_states(
        &netlist,
        &settings,
        HashMap::new(),
        HashMap::new(),
    )
    .unwrap();
    assert!(results.len() > 20);

    let mut checked_high = false;
    let mut checked_low = false;

    for step in &results {
        if step.time > 0.1e-3 && step.time < 0.4e-3 {
            let v2 = *step.node_voltages.get("2").unwrap();
            assert!(v2 < 0.5, "Salida de inversor LOW falló, obtenido: {}", v2);
            checked_low = true;
        }
        if step.time > 0.7e-3 && step.time < 0.9e-3 {
            let v2 = *step.node_voltages.get("2").unwrap();
            assert!(v2 > 4.0, "Salida de inversor HIGH falló, obtenido: {}", v2);
            checked_high = true;
        }
    }
    assert!(checked_high && checked_low);
}

#[test]
fn test_mixed_signal_not_gate() {
    // Compuerta digital NOT conectada a una fuente de entrada analógica de 5V
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 5.0, // Entrada lógica '1' analógica
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "G1".to_string(),
                comp_type: "not_gate".to_string(),
                pins: vec!["1".to_string(), "2".to_string()],
                value: 0.0,
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let result = solve_dc_circuit(&netlist);
    assert!(
        result.is_ok(),
        "La simulación Mixed-Signal debe converger en DC"
    );
    let data = result.unwrap();
    let v_out = *data.node_voltages.get("2").unwrap_or(&5.0);
    // La compuerta NOT invierte 5V (true) a aprox 0V (false)
    assert!(
        v_out < 0.5,
        "La salida de la compuerta NOT con entrada de 5V debería estar cerca de 0V, obtenida: {}V",
        v_out
    );
}

#[test]
fn test_logic_gate_hysteresis() {
    use crate::parser::parse_spice_netlist_to_native;

    // Inversor Schmitt trigger con histéresis: vhigh=3.0V, vlow=1.0V
    // Excitamos por rampa de entrada analógica transitoria
    let netlist_str = "
    * Test logic gate hysteresis
    U1 1 2 not_gate vhigh=3.0 vlow=1.0 td=1n
    V1 1 0 PULSE(0.0 4.0 0.0 10m 10m 10m 20m)
    ";

    let netlist = parse_spice_netlist_to_native(netlist_str).unwrap();

    // Verificar mapeo
    let u1 = netlist.components.iter().find(|c| c.id == "U1").unwrap();
    assert_eq!(u1.gate_vhigh, Some(3.0));
    assert_eq!(u1.gate_vlow, Some(1.0));
}

#[test]
fn test_logic_gate_analog_rise_fall_ramp() {
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 0.0,
                pins: vec!["1".to_string(), "0".to_string()],
                wave_type: Some("pulse".to_string()),
                amplitude: Some(5.0),
                frequency: Some(500e3), // Periodo 2 µs: 1 µs en 5V, 1 µs en 0V
                offset: Some(0.0),
                duty_cycle: Some(0.5),
                ..Default::default()
            },
            ComponentData {
                id: "U1".to_string(),
                comp_type: "not_gate".to_string(),
                value: 0.0,
                pins: vec!["1".to_string(), "2".to_string()],
                delay: Some(0.0),
                gate_trise: Some(100e-9), // 100 ns tiempo de subida analógico
                gate_tfall: Some(100e-9), // 100 ns tiempo de bajada analógico
                gate_vhigh: Some(2.0),    // Umbral de entrada alto
                gate_vlow: Some(0.8),     // Umbral de entrada bajo
                gate_rout: Some(50.0),
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
        dt: 10e-9,     // 10 ns
        t_max: 1.5e-6, // 1.5 µs
        integration_method: Some("BE".to_string()),
        fixed_step: Some(true),
    };

    let (results, _, _) = solve_transient_circuit_with_initial_states(
        &netlist,
        &settings,
        HashMap::new(),
        HashMap::new(),
    )
    .unwrap();

    let v_50ns_into_rise = results
        .iter()
        .min_by(|a, b| {
            ((a.time - 1.05e-6).abs())
                .partial_cmp(&(b.time - 1.05e-6).abs())
                .unwrap()
        })
        .map(|s| *s.node_voltages.get("2").unwrap())
        .unwrap();

    // A t = 1.2 µs (200 ns tras el flanco), la salida debe haber alcanzado 5V
    let v_completed_rise = results
        .iter()
        .min_by(|a, b| {
            ((a.time - 1.2e-6).abs())
                .partial_cmp(&(b.time - 1.2e-6).abs())
                .unwrap()
        })
        .map(|s| *s.node_voltages.get("2").unwrap())
        .unwrap();

    assert!(
        v_50ns_into_rise > 0.5 && v_50ns_into_rise < 4.5,
        "La salida debe mostrar una rampa analógica continua a mitad del tiempo de subida: V(1.05µs)={:.2}V",
        v_50ns_into_rise
    );
    assert!(
        v_completed_rise > 4.5,
        "La salida debe alcanzar el estado alto al finalizar t_rise: V(1.2µs)={:.2}V",
        v_completed_rise
    );
}

#[test]
fn test_sub_microsecond_zero_crossing_event_localization() {
    // Señal senoidal analógica V(t) = 5 * sin(2*pi*1000*t) conectada a inversor NOT.
    // Umbral Vth = 2.5V -> 5*sin(2*pi*1000*t) = 2.5 -> sin = 0.5 -> 2*pi*1000*t = pi/6 -> t_teorico = 83.3333 µs.
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "V_sine".to_string(),
                comp_type: "vsource".to_string(),
                value: 0.0,
                pins: vec!["1".to_string(), "0".to_string()],
                wave_type: Some("sine".to_string()),
                amplitude: Some(5.0),
                frequency: Some(1000.0),
                offset: Some(0.0),
                ..Default::default()
            },
            ComponentData {
                id: "U_not".to_string(),
                comp_type: "not_gate".to_string(),
                value: 0.0,
                pins: vec!["1".to_string(), "2".to_string()],
                gate_vhigh: Some(2.5),
                gate_vlow: Some(2.5),
                delay: Some(20e-9), // 20 ns
                gate_rout: Some(30.0),
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: Some(false),
        subcircuit_definitions: None,
        triggers: None,
    };

    let settings = TransientSettings {
        dt: 25e-6,     // 25 µs (paso grande para probar la localización de cruce por cero)
        t_max: 500e-6, // Incluye el cruce descendente en 416.6667 µs.
        integration_method: Some("trap".to_string()),
        fixed_step: Some(false),
    };

    let (results, _, _) = solve_transient_circuit_with_initial_states(
        &netlist,
        &settings,
        HashMap::new(),
        HashMap::new(),
    )
    .unwrap();

    // Buscar el instante exacto de conmutación de la salida (donde V(2) cae por debajo de 2.5V)
    let transition_step = results.windows(2).find(|w| {
        let v_prev = *w[0].node_voltages.get("2").unwrap_or(&5.0);
        let v_curr = *w[1].node_voltages.get("2").unwrap_or(&0.0);
        v_prev >= 2.5 && v_curr < 2.5
    });

    assert!(
        transition_step.is_some(),
        "Debe haber ocurrido una transición de la compuerta"
    );
    let (s_prev, s_curr) = (
        transition_step.unwrap()[0].time,
        transition_step.unwrap()[1].time,
    );
    let t_expected = (1.0 / 12.0) * 1e-3 + 20e-9; // 83.3333 µs + 20 ns = 83.3533 µs

    // El cruce debe haber sido detectado en el intervalo esperado con exactitud sub-microsegundo
    assert!(
        s_prev <= t_expected + 1e-9 && s_curr >= t_expected - 1e-9,
        "La transición ocurrió en [{:.3}µs, {:.3}µs], esperado: {:.3}µs",
        s_prev * 1e6,
        s_curr * 1e6,
        t_expected * 1e6
    );
    assert!(
        s_curr - s_prev <= 1e-6,
        "El intervalo localizado no debe superar 1 µs"
    );

    // En el flanco descendente la secante puede quedar antes del cruce: la
    // localización debe resolver un extremo que realmente cambió de estado.
    let rising_output = results
        .windows(2)
        .find(|window| window[0].node_voltages["2"] < 2.5 && window[1].node_voltages["2"] >= 2.5)
        .expect("Debe existir la transición ascendente de la salida NOT");
    let lower = rising_output[0].time;
    let upper = rising_output[1].time;
    let expected = (5.0 / 12.0) * 1e-3 + 20e-9;
    assert!(
        lower <= expected + 1e-9 && upper >= expected - 1e-9,
        "Cruce descendente: salida en [{lower:.12}, {upper:.12}] s, esperado {expected:.12} s"
    );
    assert!(
        upper - lower <= 1e-6,
        "El intervalo localizado no debe superar 1 µs"
    );
}
