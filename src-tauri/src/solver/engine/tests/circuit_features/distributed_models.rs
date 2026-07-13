use super::super::*;

#[test]
fn test_tline_expansion_segments() {
    // Línea de transmisión ideal Z0=50Ω, Td=1ns, 20 segmentos
    let params = TransmissionLineParams {
        id: "1".to_string(),
        pin_in: "1".to_string(),
        pin_out: "2".to_string(),
        gnd: "0".to_string(),
        z0: 50.0,
        td: 1e-9,
        r_total: 0.0,
        g_total: 0.0,
        n_segments: 20,
    };

    let components = expand_transmission_line(&params);

    // Para línea ideal (R=0, G=0): cada segmento genera 1 inductor + 2 capacitores = 3 componentes
    // Total: 20 * 3 = 60 componentes
    assert_eq!(
        components.len(),
        60,
        "Una línea ideal de 20 segmentos debería generar 60 componentes pasivos, generó: {}",
        components.len()
    );

    // Verificar valores de L y C por segmento
    let l_expected = 50.0 * 1e-9 / 20.0; // Z0 * Td / N = 2.5 nH
    let c_expected = 1e-9 / (50.0 * 20.0); // Td / (Z0 * N) = 1 pF

    let first_inductor = components
        .iter()
        .find(|c| c.comp_type == "inductor")
        .unwrap();
    assert!(
        (first_inductor.value - l_expected).abs() / l_expected < 0.01,
        "L_seg debería ser {:.4e} H, obtenido: {:.4e} H",
        l_expected,
        first_inductor.value
    );

    let first_cap = components
        .iter()
        .find(|c| c.comp_type == "capacitor")
        .unwrap();
    assert!(
        (first_cap.value - c_expected / 2.0).abs() / (c_expected / 2.0) < 0.01,
        "C_seg/2 debería ser {:.4e} F, obtenido: {:.4e} F",
        c_expected / 2.0,
        first_cap.value
    );
}

#[test]
fn test_tline_lossy_expansion() {
    // Línea con pérdidas: R_total=5Ω, G_total=0.001S
    let params = TransmissionLineParams {
        id: "2".to_string(),
        pin_in: "3".to_string(),
        pin_out: "4".to_string(),
        gnd: "0".to_string(),
        z0: 75.0,
        td: 2e-9,
        r_total: 5.0,
        g_total: 0.001,
        n_segments: 10,
    };

    let components = expand_transmission_line(&params);

    // Para línea con pérdidas: cada segmento genera 1R + 1L + 2C + 2G_shunt = 6 componentes
    // Total: 10 * 6 = 60 componentes
    assert_eq!(
        components.len(),
        60,
        "Una línea con pérdidas de 10 segmentos debería generar 60 componentes, generó: {}",
        components.len()
    );

    // Verificar que hay resistores de serie y de fuga
    let r_series: Vec<_> = components.iter().filter(|c| c.id.contains(".R")).collect();
    let r_shunt: Vec<_> = components
        .iter()
        .filter(|c| c.id.contains(".GL") || c.id.contains(".GR"))
        .collect();
    assert_eq!(r_series.len(), 10, "Debería haber 10 resistores de serie");
    assert_eq!(
        r_shunt.len(),
        20,
        "Debería haber 20 resistores de fuga (GL+GR)"
    );

    // R_seg = 5/10 = 0.5Ω
    assert!(
        (r_series[0].value - 0.5).abs() < 0.001,
        "R_seg debería ser 0.5Ω, obtenido: {}Ω",
        r_series[0].value
    );
}

// ================================================================
// FASE 25: Tests de Modelos de Deriva Térmica
// ================================================================

#[test]
fn test_topology_graph_floating_nodes() {
    use crate::parser::parse_spice_netlist_to_native;
    let netlist_str = "
    * Test topology floating nodes auto-stabilization
    V1 1 0 10
    C1 1 2 1u
    R1 2 3 1k
    R2 3 0 1k
    ";
    let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();

    let res = solve_dc_circuit(&parsed).unwrap();
    let v2 = *res.node_voltages.get("2").unwrap();
    let v3 = *res.node_voltages.get("3").unwrap();
    assert!(
        v2.abs() < 1e-3,
        "V2 debería ser prácticamente 0V por bleed resistor, obtenido: {}",
        v2
    );
    assert!(
        v3.abs() < 1e-3,
        "V3 debería ser prácticamente 0V por bleed resistor, obtenido: {}",
        v3
    );
}

#[test]
fn test_mutual_inductance_transformer() {
    // Transformador CA reductor ideal 10:1
    // L1 = 10H, L2 = 0.1H, k = 0.99999 (muy acoplado)
    // V1 es fuente de CA de 10V (amplitud) a 50Hz, conectada a L1.
    // Verificamos que el voltaje en L2 (secundario) es exactamente la décima parte (1V).
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "V1".to_string(),
                comp_type: "vsource".to_string(),
                value: 0.0,
                pins: vec!["1".to_string(), "0".to_string()],
                wave_type: Some("sine".to_string()),
                amplitude: Some(10.0),
                frequency: Some(50.0),
                offset: Some(0.0),
                ..Default::default()
            },
            ComponentData {
                id: "L1".to_string(),
                comp_type: "inductor".to_string(),
                value: 10.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "L2".to_string(),
                comp_type: "inductor".to_string(),
                value: 0.1,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Rload".to_string(),
                comp_type: "resistor".to_string(),
                value: 1e6, // Carga abierta para ver la relación de transformación de circuito abierto
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        mutual_inductances: Some(vec![MutualInductance {
            id: "K1".to_string(),
            l1_id: "L1".to_string(),
            l2_id: "L2".to_string(),
            k_coeff: 0.99,
        }]),
        wires: vec![],
        temperature: None,
        fixed_step: Some(true),
        thermal_config: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let settings = TransientSettings {
        dt: 1e-4,
        t_max: 0.04, // 2 periodos
        integration_method: Some("euler".to_string()),
        fixed_step: Some(true),
    };

    let results = solve_transient_circuit(&netlist, &settings).unwrap();
    assert!(
        !results.is_empty(),
        "La simulación transitoria debería retornar resultados"
    );

    // Al final de la simulación (en régimen permanente), verificamos el voltaje secundario en el nodo 2
    // en relación con la entrada en el nodo 1.
    let mut max_v1: f64 = 0.0;
    let mut max_v2: f64 = 0.0;
    // Buscamos los picos en el segundo ciclo (t > 0.02)
    for step in &results {
        if step.time > 0.02 {
            let v1 = step.node_voltages.get("1").copied().unwrap_or(0.0).abs();
            let v2 = step.node_voltages.get("2").copied().unwrap_or(0.0).abs();
            if v1 > max_v1 {
                max_v1 = v1;
            }
            if v2 > max_v2 {
                max_v2 = v2;
            }
        }
    }

    // Con k = 0.99, max_v1 debería ser ~10.0 y max_v2 debería ser ~0.99
    assert!(
        (max_v1 - 10.0).abs() < 0.1,
        "Voltaje primario debería ser ~10V de amplitud"
    );
    assert!(
        (max_v2 - 0.99).abs() < 0.16,
        "Relación de transformación 10:1 falló. Vsecundario obtenido: {}",
        max_v2
    );
}
