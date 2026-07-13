use super::super::*;

#[test]
fn test_opto_isolation() {
    // Test de aislamiento galvánico del optoacoplador:
    //   Lado emisor:  V1 (5V) -> R1 (1k) -> LED (A-K)
    //   Lado receptor: V2 (5V) -> Rc (10k) -> Colector -> Emisor -> GND
    //   CTR = 0.5, V_sat = 0.2, Is = 1e-12, N = 1
    // Se espera:
    //   - Con V1 = 5V: I_led ~ (5 - 0.7)/1k ~ 4.3 mA, V_C cae por I_ce = CTR*I_led
    //   - Aislamiento: nodos del lado LED (2) NO conectados eléctricamente al receptor (3)
    //   - I_ce == CTR * I_led (transferencia óptica, no inyección galvánica)
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            // Lado emisor: V1=5V, R1=1k, LED A-K
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
            // Lado receptor: V2=5V, Rc=10k, colector-emisor del opto
            ComponentData {
                id: "V2".to_string(),
                comp_type: "vsource".to_string(),
                value: 5.0,
                pins: vec!["4".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Rc".to_string(),
                comp_type: "resistor".to_string(),
                value: 10000.0,
                pins: vec!["4".to_string(), "3".to_string()],
                ..Default::default()
            },
            // Optoacoplador: A=2, K=0, C=3, E=0
            ComponentData {
                id: "O1".to_string(),
                comp_type: "opto".to_string(),
                value: 0.0,
                pins: vec![
                    "2".to_string(), // anode
                    "0".to_string(), // cathode
                    "3".to_string(), // collector
                    "0".to_string(), // emitter
                ],
                opto_ctr: Some(0.5),
                opto_is: Some(1e-12),
                opto_n: Some(1.0),
                opto_vsat: Some(0.2),
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let result = solve_dc_circuit(&netlist).unwrap();

    // Voltaje del ánodo del LED (nodo 2): debe rondar 0.6-0.8V (caída del LED)
    let v_anode = *result.node_voltages.get("2").unwrap();
    assert!(
        v_anode > 0.5 && v_anode < 0.9,
        "Voltaje del ánodo del LED (nodo 2) fuera de rango esperado [0.5, 0.9] V, obtenido: {}",
        v_anode
    );

    // Voltaje del colector (nodo 3): debe caer de 5V según I_ce = CTR * I_led
    // I_led ~ (5 - v_anode)/1k, I_ce = 0.5 * I_led, V_C = 5 - 10k * I_ce
    // Aprox: I_led ~ 4.3 mA, I_ce ~ 2.15 mA, V_C ~ 5 - 21.5 ~ -16.5 V
    // Pero V_ce se satura suavemente en ~0.2V vía tanh, así que V_C cae pero se limita.
    let v_collector = *result.node_voltages.get("3").unwrap();
    // El colector debe estar por debajo de V2=5V (hay corriente circulando)
    assert!(v_collector < 4.9,
            "Voltaje del colector (nodo 3) debe caer de 5V indicando que el fototransistor conduce, obtenido: {}", v_collector);

    // Aislamiento galvánico: verificar que no hay corriente directa del nodo LED (2) al receptor (3/4).
    // La única conexión entre los dos lados es óptica (CTR). Comprobamos que la corriente que
    // sale del cátodo del LED (nodo 0) NO se transmite al colector: la rama V2/Rc es independiente.
    // Forma práctica: sin V1 (sólo V2), no debe haber corriente en el LED ni V_C debe caer.
    let netlist_off = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 0.0, // LED apagado
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
                id: "V2".to_string(),
                comp_type: "vsource".to_string(),
                value: 5.0,
                pins: vec!["4".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Rc".to_string(),
                comp_type: "resistor".to_string(),
                value: 10000.0,
                pins: vec!["4".to_string(), "3".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "O1".to_string(),
                comp_type: "opto".to_string(),
                value: 0.0,
                pins: vec![
                    "2".to_string(),
                    "0".to_string(),
                    "3".to_string(),
                    "0".to_string(),
                ],
                opto_ctr: Some(0.5),
                opto_is: Some(1e-12),
                opto_n: Some(1.0),
                opto_vsat: Some(0.2),
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let res_off = solve_dc_circuit(&netlist_off).unwrap();
    let v_collector_off = *res_off.node_voltages.get("3").unwrap();
    // Con LED apagado: I_led = 0 => I_ce = 0 => no caída en Rc => V_C = 5V (aislamiento perfecto)
    assert!(
        (v_collector_off - 5.0).abs() < 1e-3,
        "Con LED apagado, V_C debe ser 5V (aislamiento galvánico perfecto), obtenido: {}",
        v_collector_off
    );

    // Y el ánodo del LED también debe ser ~0V (sin excitación)
    let v_anode_off = *res_off.node_voltages.get("2").unwrap();
    assert!(
        v_anode_off.abs() < 0.1,
        "Con V1=0V, el ánodo del LED debe estar en ~0V, obtenido: {}",
        v_anode_off
    );

    // Diferencia entre ON y OFF: el cambio en V_C confirma la transferencia óptica
    let delta_vc = v_collector_off - v_collector;
    assert!(delta_vc > 0.1,
            "La variación de V_C entre LED ON y OFF debe ser significativa (>0.1V) indicando acoplamiento óptico, delta: {}", delta_vc);
}

#[test]
fn test_scr_phase_control() {
    let netlist_str = "
    * SCR Phase Control Test
    .model myscr scr (vgt=0.7 ih=5m)
    V_ac 1 0 sine (0 10 50)
    Bgate 3 2 V={min(5.0, max(0.0, (t - 0.0025) * 100000.0)) - min(5.0, max(0.0, (t - 0.0035) * 100000.0))}
    Rg 3 4 1k
    S1 1 2 4 myscr
    R_load 2 0 100
    ";

    let netlist = crate::parser::parse_spice_netlist_to_native(netlist_str).unwrap();

    let settings = TransientSettings {
        dt: 0.0015,   // 1.5 ms, alineado con los puntos de fase verificados
        t_max: 0.015, // Finaliza tras verificar el bloqueo en el semiciclo negativo
        fixed_step: Some(true),
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
                closest_val = *step.node_voltages.get("2").unwrap_or(&0.0);
            }
        }
        assert!(
            min_diff < 1e-9,
            "No existe una muestra para t={target_t}s; distancia mínima: {min_diff}s"
        );
        closest_val
    };

    // 1. Antes del disparo (t = 1.5 ms): el SCR está apagado, V_load ~ 0V
    let v_t1_5 = get_voltage_at(0.0015);
    assert!(
        v_t1_5.abs() < 0.15,
        "Antes de disparar (1.5ms), la carga debería estar apagada (0V), obtenido: {}",
        v_t1_5
    );

    // 2. Después del disparo y cerca del pico positivo (t = 4.5 ms): el SCR conduce
    let v_t4_5 = get_voltage_at(0.0045);
    assert!(
        v_t4_5 > 7.2 && v_t4_5 < 9.5,
        "Después de disparar (4.5ms), el SCR debería conducir, obtenido: {}",
        v_t4_5
    );

    // 3. En el ciclo negativo (t = 15 ms): el SCR se apagó en el cruce por cero y permanece bloqueado
    let v_t15 = get_voltage_at(0.015);
    assert!(
        v_t15.abs() < 0.15,
        "En el semiciclo negativo (15ms), la carga debería estar bloqueada (0V), obtenido: {}",
        v_t15
    );
}
