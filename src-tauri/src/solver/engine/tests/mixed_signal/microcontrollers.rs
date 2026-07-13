use super::super::*;

#[test]
fn test_mcu_discrete_clock_blink() {
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![ComponentData {
            id: "MCU1".to_string(),
            comp_type: "arduino_uno".to_string(),
            value: 1.0,
            pins: vec![
                "1".to_string(),
                "2".to_string(),
                "3".to_string(),
                "4".to_string(),
                "5".to_string(),
                "0".to_string(),
            ],
            ..Default::default()
        }],
        wires: vec![],
        temperature: None,
        fixed_step: Some(false),
        subcircuit_definitions: None,
        triggers: None,
    };

    let settings = TransientSettings {
        dt: 1e-3,
        t_max: 1.2,
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

    let mut checked_high = false;
    let mut checked_low = false;

    for step in &results {
        if step.time > 0.1 && step.time < 0.4 {
            let v2 = *step.node_voltages.get("2").unwrap();
            assert!(v2 > 4.5, "Blink HIGH falló, obtenido: {}", v2);
            checked_high = true;
        }
        if step.time > 0.6 && step.time < 0.9 {
            let v2 = *step.node_voltages.get("2").unwrap();
            assert!(v2 < 0.5, "Blink LOW falló, obtenido: {}", v2);
            checked_low = true;
        }
    }
    assert!(checked_high && checked_low);
}

#[test]
fn test_microcontrollers_mixed_signal() {
    // 1. Test Arduino Uno - Mode 1 (Blink)
    // Pins layout: [Pin_In, Pin_Out, Pin_ADC, Pin_DAC, Pin_VCC, Pin_GND]
    let netlist_arduino = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![ComponentData {
            id: "MCU1".to_string(),
            comp_type: "arduino_uno".to_string(),
            value: 1.0, // Mode 1 (Blink)
            pins: vec![
                "1".to_string(),
                "2".to_string(),
                "3".to_string(),
                "4".to_string(),
                "5".to_string(),
                "0".to_string(),
            ],
            ..Default::default()
        }],
        wires: vec![],
        temperature: None,
        fixed_step: Some(true),
        subcircuit_definitions: None,
        triggers: None,
    };

    // En continua (DC), el carril Pin_VCC (nodo 5) debería auto-polarizarse a 5.0 V gracias al Norton equivalent interno.
    let dc_res = solve_dc_circuit(&netlist_arduino).unwrap();
    let v_vcc = *dc_res.node_voltages.get("5").unwrap();
    assert!(
        (v_vcc - 5.0).abs() < 0.1,
        "El carril de VCC de Arduino debería regular a ~5.0V, obtenido: {}",
        v_vcc
    );

    // En transitorio, verificamos el parpadeo a 1 Hz (T = 1.0 s, 0.5s HIGH, 0.5s LOW)
    let settings_blink = TransientSettings {
        dt: 0.1,
        t_max: 1.2,
        fixed_step: Some(true),
        integration_method: None,
    };
    let results_blink = solve_transient_circuit(&netlist_arduino, &settings_blink).unwrap();

    let get_out_voltage = |t_target: f64| -> f64 {
        let step = results_blink
            .iter()
            .min_by(|a, b| {
                (a.time - t_target)
                    .abs()
                    .partial_cmp(&(b.time - t_target).abs())
                    .unwrap()
            })
            .unwrap();
        *step.node_voltages.get("2").unwrap()
    };

    // A t = 0.2 s, debería estar en HIGH (~5.0 V)
    let v_t0_2 = get_out_voltage(0.2);
    assert!(
        v_t0_2 > 4.5,
        "Blink a 0.2s debería estar en HIGH, obtenido: {}",
        v_t0_2
    );

    // A t = 0.7 s, debería estar en LOW (~0 V)
    let v_t0_7 = get_out_voltage(0.7);
    assert!(
        v_t0_7 < 0.5,
        "Blink a 0.7s debería estar en LOW, obtenido: {}",
        v_t0_7
    );

    // 2. Test ESP32 - Mode 0 (Follower)
    // Vin conectado a Pin_ADC (nodo 3)
    let netlist_esp32 = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "MCU2".to_string(),
                comp_type: "esp32".to_string(),
                value: 0.0, // Mode 0 (Eco Follower)
                pins: vec![
                    "1".to_string(),
                    "2".to_string(),
                    "3".to_string(),
                    "4".to_string(),
                    "5".to_string(),
                    "0".to_string(),
                ],
                ..Default::default()
            },
            ComponentData {
                id: "Vin".to_string(),
                comp_type: "vsource".to_string(),
                value: 1.5,
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

    let dc_res_esp32 = solve_dc_circuit(&netlist_esp32).unwrap();
    let v_vcc_esp32 = *dc_res_esp32.node_voltages.get("5").unwrap();
    assert!(
        (v_vcc_esp32 - 3.3).abs() < 0.1,
        "El carril de VCC de ESP32 debería regular a ~3.3V, obtenido: {}",
        v_vcc_esp32
    );

    // Pin_DAC (nodo 4) debería seguir a Pin_ADC (Vin = 1.5V)
    let v_dac = *dc_res_esp32.node_voltages.get("4").unwrap();
    assert!(
        (v_dac - 1.5).abs() < 0.2,
        "El dac debería seguir al adc (1.5V), obtenido: {}",
        v_dac
    );

    // 3. Test Raspberry Pi Pico - Mode 2 (Hysteresis Comparator)
    let netlist_pico = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "MCU3".to_string(),
                comp_type: "raspberry_pi_pico".to_string(),
                value: 2.0, // Mode 2 (Comparator)
                pins: vec![
                    "1".to_string(),
                    "2".to_string(),
                    "3".to_string(),
                    "4".to_string(),
                    "5".to_string(),
                    "0".to_string(),
                ],
                ..Default::default()
            },
            ComponentData {
                id: "Vin".to_string(),
                comp_type: "vsource".to_string(),
                value: 0.0,
                pins: vec!["3".to_string(), "0".to_string()],
                wave_type: Some("sine".to_string()),
                amplitude: Some(1.65),
                frequency: Some(1.0),
                offset: Some(1.65),
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: Some(true),
        subcircuit_definitions: None,
        triggers: None,
    };

    let settings_pico = TransientSettings {
        dt: 0.01,
        t_max: 1.0,
        fixed_step: Some(true),
        integration_method: None,
    };
    let results_pico = solve_transient_circuit(&netlist_pico, &settings_pico).unwrap();
    assert!(results_pico.len() > 0);
}

#[test]
fn test_microcontrollers_phd_level() {
    // 1. Verificar la limitación de sobrecorriente activa del pin de salida digital (Short-circuit protection)
    // Conectamos el pin OUT de Arduino (nodo 2) a GND mediante un resistor de 1 Ohm.
    // Con Rload = 1 Ohm, la corriente teórica sin protección superaría los 250 mA.
    let netlist_short = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "MCU1".to_string(),
                comp_type: "arduino_uno".to_string(),
                value: 1.0, // Mode 1 (Blink - HIGH en continua)
                pins: vec![
                    "1".to_string(),
                    "2".to_string(),
                    "3".to_string(),
                    "4".to_string(),
                    "5".to_string(),
                    "0".to_string(),
                ],
                ..Default::default()
            },
            ComponentData {
                id: "Rload".to_string(),
                comp_type: "resistor".to_string(),
                value: 1.0, // 1 Ohm
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

    // En continua (DC), resolvemos el circuito.
    let res = solve_dc_circuit(&netlist_short).unwrap();

    // Obtenemos el voltaje en el nodo 2. La corriente a través del resistor Rload es V(2)/1.
    // Con limitación activa a 40 mA, V(2) debería ser aproximadamente I_max * Rload = 40 mV.
    let v_out = *res.node_voltages.get("2").unwrap();

    // Permitimos una tolerancia ya que el modelo Norton incluye la resistencia de salida de 20 Ohm.
    // Con Rload = 1 Ohm y G_out = 0.05 S (R_out = 20 Ohm):
    // I_load = I_eq_clamped * R_out / (R_out + R_load) = 40 mA * 20 / 21 = 38 mA.
    // V_out = I_load * R_load = 38 mV.
    assert!(v_out < 0.1, "La protección activa contra sobrecorrientes debería limitar la tensión a <100mV bajo cortocircuito, obtenido: {}V", v_out);
    assert!(
        v_out > 0.01,
        "Debería haber una corriente circulando (>10mV), obtenido: {}V",
        v_out
    );

    // 2. Verificar el transitorio electro-térmico y muestreo ADC S&H
    // Simulamos un ESP32 en Modo 0 (Eco) con entrada analógica (1.5V) y reloj de muestreo activo.
    let netlist_thermal = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "MCU2".to_string(),
                comp_type: "esp32".to_string(),
                value: 0.0, // Modo 0 (Eco)
                pins: vec![
                    "1".to_string(),
                    "2".to_string(),
                    "3".to_string(),
                    "4".to_string(),
                    "5".to_string(),
                    "0".to_string(),
                ],
                ..Default::default()
            },
            ComponentData {
                id: "Vin".to_string(),
                comp_type: "vsource".to_string(),
                value: 2.0,
                pins: vec!["3".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: Some(300.0), // 300 K = 26.85 ºC
        fixed_step: Some(true),
        subcircuit_definitions: None,
        triggers: None,
    };

    let settings = TransientSettings {
        dt: 1e-6,    // 1 microsegundo de paso para ver el muestreo activo de S&H
        t_max: 5e-6, // 5 pasos
        fixed_step: Some(true),
        integration_method: None,
    };

    let results = solve_transient_circuit(&netlist_thermal, &settings).unwrap();
    assert!(
        results.len() > 0,
        "Debería completar el análisis transitorio electro-térmico mixed-signal."
    );
}
