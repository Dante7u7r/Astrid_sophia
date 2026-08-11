use super::super::super::*;

#[test]
fn test_nmos_transistor() {
    let netlist_off = CircuitNetlist {
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
                id: "Vgate".to_string(),
                comp_type: "vsource".to_string(),
                value: 0.0,
                pins: vec!["3".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Rload".to_string(),
                comp_type: "resistor".to_string(),
                value: 1000.0,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "M1".to_string(),
                comp_type: "nmos".to_string(),
                value: 1.5,
                pins: vec!["3".to_string(), "2".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let result_off = solve_dc_circuit(&netlist_off).unwrap();
    let v_drain_off = *result_off.node_voltages.get("2").unwrap();
    assert!(
        (v_drain_off - 5.0).abs() < 1e-3,
        "Con Vgate=0V, Vdrain debería ser 5.0V, obtenido: {}",
        v_drain_off
    );

    let netlist_on = CircuitNetlist {
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
                id: "Vgate".to_string(),
                comp_type: "vsource".to_string(),
                value: 5.0,
                pins: vec!["3".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Rload".to_string(),
                comp_type: "resistor".to_string(),
                value: 1000.0,
                pins: vec!["1".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "M1".to_string(),
                comp_type: "nmos".to_string(),
                value: 1.5,
                pins: vec!["3".to_string(), "2".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let result_on = solve_dc_circuit(&netlist_on).unwrap();
    let v_drain_on = *result_on.node_voltages.get("2").unwrap();
    assert!(
        v_drain_on < 0.5,
        "Con Vgate=5V, Vdrain debería bajar, obtenido: {}",
        v_drain_on
    );
}

#[test]
fn test_pmos_transistor() {
    let netlist_off = CircuitNetlist {
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
                id: "Vgate".to_string(),
                comp_type: "vsource".to_string(),
                value: 5.0,
                pins: vec!["3".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Rload".to_string(),
                comp_type: "resistor".to_string(),
                value: 1000.0,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "M1".to_string(),
                comp_type: "pmos".to_string(),
                value: -1.5,
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

    let result_off = solve_dc_circuit(&netlist_off).unwrap();
    let v_drain_off = *result_off.node_voltages.get("2").unwrap();
    assert!(
        v_drain_off.abs() < 1e-3,
        "Con Vgate=5V, PMOS apagado, Vdrain debería ser 0V, obtenido: {}",
        v_drain_off
    );

    let netlist_on = CircuitNetlist {
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
                id: "Vgate".to_string(),
                comp_type: "vsource".to_string(),
                value: 0.0,
                pins: vec!["3".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Rload".to_string(),
                comp_type: "resistor".to_string(),
                value: 1000.0,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "M1".to_string(),
                comp_type: "pmos".to_string(),
                value: -1.5,
                pins: vec!["3".to_string(), "2".to_string(), "1".to_string()], // G, D, S
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: None,
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let result_on = solve_dc_circuit(&netlist_on).unwrap();
    let v_drain_on = *result_on.node_voltages.get("2").unwrap();
    assert!(
        v_drain_on > 4.0,
        "Con Vgate=0V, PMOS encendido, Vdrain debería subir cerca de 5V, obtenido: {}",
        v_drain_on
    );
}
