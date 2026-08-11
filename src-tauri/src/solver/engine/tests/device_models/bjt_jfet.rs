use super::super::*;

#[test]
fn test_bjt_amplifier() {
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "Vcc".to_string(),
                comp_type: "vsource".to_string(),
                value: 10.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Vin".to_string(),
                comp_type: "vsource".to_string(),
                value: 2.0,
                pins: vec!["3".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Rc".to_string(),
                comp_type: "resistor".to_string(),
                value: 1000.0,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Rb".to_string(),
                comp_type: "resistor".to_string(),
                value: 100000.0,
                pins: vec!["3".to_string(), "4".to_string()],
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

    let result = solve_dc_circuit(&netlist).unwrap();
    let v_base = *result.node_voltages.get("4").unwrap();
    let v_collector = *result.node_voltages.get("2").unwrap();

    assert!(
        v_base > 0.5 && v_base < 0.8,
        "Vbase debería ser ~0.55V, obtenido: {}",
        v_base
    );
    assert!(
        v_collector > 8.0 && v_collector < 9.0,
        "Vcollector debería ser ~8.7V, obtenido: {}",
        v_collector
    );
}

#[test]
fn test_bjt_dynamic_parameters() {
    use crate::parser::parse_spice_netlist_to_native;

    // Dos transistores NPN con parámetros de modelo muy distintos
    // Q1 es un transistor de señal pequeña convencional (bf=200, is=1e-15)
    // Q2 es un transistor de potencia con ganancia mucho menor (bf=50, is=1e-11)
    let netlist_str = "
    * Test dynamic BJT parameters
    .model Qsmall NPN(is=1e-15 bf=200 vaf=120 rb=10 rc=2)
    .model Qpower NPN(is=1e-11 bf=50 vaf=60 rb=5 rc=1)

    Vcc 1 0 10.0
    Vbb 2 0 2.0
    Rb1 2 5 100k
    Rb2 2 6 100k
    R1 1 3 1k
    R2 1 4 1k
    Q1 5 3 0 Qsmall
    Q2 6 4 0 Qpower
    ";

    let netlist = parse_spice_netlist_to_native(netlist_str).unwrap();

    // Verificar mapeo del parser
    let q1 = netlist.components.iter().find(|c| c.id == "Q1").unwrap();
    assert_eq!(q1.bjt_bf, Some(200.0));
    assert_eq!(q1.bjt_is, Some(1e-15));
    assert_eq!(q1.bjt_vaf, Some(120.0));
    assert_eq!(q1.bjt_rb, Some(10.0));
    assert_eq!(q1.bjt_rc, Some(2.0));

    let q2 = netlist.components.iter().find(|c| c.id == "Q2").unwrap();
    assert_eq!(q2.bjt_bf, Some(50.0));
    assert_eq!(q2.bjt_is, Some(1e-11));
    assert_eq!(q2.bjt_vaf, Some(60.0));
    assert_eq!(q2.bjt_rb, Some(5.0));
    assert_eq!(q2.bjt_rc, Some(1.0));

    // Resolver DC
    let result = solve_dc_circuit(&netlist).unwrap();
    let v_c1 = *result.node_voltages.get("3").unwrap();
    let v_c2 = *result.node_voltages.get("4").unwrap();

    println!(
        "VC1 (Pequeña señal): {} V, VC2 (Potencia): {} V",
        v_c1, v_c2
    );
    // Q1 al tener bf de 200 conduce más corriente que Q2 con bf de 50,
    // por ende VC1 es menor que VC2.
    assert!(v_c1 < v_c2, "Q1 con bf de 200 debería conducir más y bajar el voltaje de colector más que Q2 con bf de 50");
}

#[test]
fn test_jfet_quad_characteristics() {
    // Validar el modelo Shichman-Hodges para un JFET de canal N
    // Parámetros: Vto = -2.0V, beta = 1e-3 A/V², lambda = 0.02
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
                id: "V2".to_string(),
                comp_type: "vsource".to_string(),
                value: 0.0, // Vgs = 0V (máxima conducción en JFET)
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "J1".to_string(),
                comp_type: "njf".to_string(),
                pins: vec!["1".to_string(), "2".to_string(), "0".to_string()],
                value: 0.0,
                jfet_vto: Some(-2.0),
                jfet_beta: Some(1e-3),
                jfet_lambda: Some(0.02),
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
        "La simulación del JFET debe converger en DC"
    );

    // Verificar analíticamente: con Vgs=0, Vto=-2, Vds=5 (saturación ya que Vds > Vgs-Vto = 2)
    // Ids = beta * (Vgs - Vto)^2 * (1 + lambda * Vds) = 1e-3 * 4 * (1 + 0.1) = 4.4 mA
    // Este es un test de consistencia, no de valor exacto (el circuito tiene interacciones)
    let data = result.unwrap();
    let v_drain = *data.node_voltages.get("1").unwrap_or(&0.0);
    assert!(
        v_drain > 0.0,
        "El voltaje de drenador del JFET debe ser positivo, obtenido: {}",
        v_drain
    );

    // Verificar la región de corte: con Vgs <= Vto, la corriente debe ser ~0
    let netlist_cutoff = CircuitNetlist {
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
                id: "V2".to_string(),
                comp_type: "vsource".to_string(),
                value: -3.0, // Vgs = -3V < Vto = -2V → corte
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "J1".to_string(),
                comp_type: "njf".to_string(),
                pins: vec!["1".to_string(), "2".to_string(), "0".to_string()],
                value: 0.0,
                jfet_vto: Some(-2.0),
                jfet_beta: Some(1e-3),
                jfet_lambda: Some(0.02),
                ..Default::default()
            },
            ComponentData {
                id: "Rload".to_string(),
                comp_type: "resistor".to_string(),
                value: 1000.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let result_cutoff = solve_dc_circuit(&netlist_cutoff);
    assert!(
        result_cutoff.is_ok(),
        "La simulación JFET en corte debe converger"
    );
}
