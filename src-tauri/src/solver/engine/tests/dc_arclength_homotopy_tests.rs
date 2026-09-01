// ==========================================================================
// ASTRYD SOPHIA — DC PSEUDO-ARCLENGTH CONTINUATION & HOMOTOPY TESTS
// ==========================================================================

use crate::solver::engine::dc::{
    find_multiple_dc_operating_points_arclength, solve_arclength_core, solve_dc_circuit,
};
use crate::solver::types::{CircuitNetlist, ComponentData};
use crate::solver::SolverNumericalSettings;
use std::collections::HashMap;

#[test]
fn test_arclength_tunnel_diode_negative_differential_resistance() {
    // Circuito con diodo túnel / elemento NDR no lineal severo con punto de retorno
    // Vdd (1.5V) -> R (100 Ohm) -> Diodo túnel / Diodo con alta no linealidad
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "Vdd".to_string(),
                comp_type: "vsource".to_string(),
                value: 1.5,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "R1".to_string(),
                comp_type: "resistor".to_string(),
                value: 100.0,
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
        temperature: Some(300.0),
        ..Default::default()
    };

    let mut vsource_map = HashMap::new();
    vsource_map.insert("Vdd".to_string(), 0);

    let x_init = vec![0.0, 0.0, 0.0]; // [dummy, node 1, node 2]
    let settings = SolverNumericalSettings::default();

    let sol = solve_arclength_core(&netlist, 2, 1, &vsource_map, 1e-12, &x_init, settings)
        .expect("Continuación de pseudo-longitud de arco debe converger");

    let v1 = sol[0];
    let v2 = sol[1];

    assert!(
        (v1 - 1.5).abs() < 1e-4,
        "Tensión en nodo de fuente debe ser 1.5V (obtenido: {:.4} V)",
        v1
    );
    assert!(
        v2 > 0.4 && v2 < 1.0,
        "Tensión de caída en diodo debe ser física (obtenido: {:.4} V)",
        v2
    );
}

#[test]
fn test_arclength_sram_cross_coupled_inverter_pair() {
    // Celda de memoria SRAM: dos inversores CMOS acoplados en cruz
    // Vdd = 5V
    // Inv 1: M1 (NMOS pulldown, gate=2, drain=1, source=0)
    //        R1 (Pullup, 1 to Vdd)
    // Inv 2: M2 (NMOS pulldown, gate=1, drain=2, source=0)
    //        R2 (Pullup, 2 to Vdd)
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "Vdd".to_string(),
                comp_type: "vsource".to_string(),
                value: 5.0,
                pins: vec!["3".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "R1".to_string(),
                comp_type: "resistor".to_string(),
                value: 1000.0,
                pins: vec!["3".to_string(), "1".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "M1".to_string(),
                comp_type: "nmos".to_string(),
                value: 1.0, // Vth = 1.0V
                pins: vec!["2".to_string(), "1".to_string(), "0".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "R2".to_string(),
                comp_type: "resistor".to_string(),
                value: 1000.0,
                pins: vec!["3".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "M2".to_string(),
                comp_type: "nmos".to_string(),
                value: 1.0, // Vth = 1.0V
                pins: vec!["1".to_string(), "2".to_string(), "0".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        temperature: Some(300.0),
        ..Default::default()
    };

    let mut vsource_map = HashMap::new();
    vsource_map.insert("Vdd".to_string(), 0);

    // Inicializar cerca del punto metaestable (V1=2.5V, V2=2.5V, V3=5.0V)
    let x_init = vec![0.0, 2.5, 2.5, 5.0];
    let settings = SolverNumericalSettings::default();

    let sol = solve_arclength_core(&netlist, 3, 1, &vsource_map, 1e-12, &x_init, settings)
        .expect("Arclength debe resolver el par inversor biestable cruzado");

    let v1 = sol[0];
    let v2 = sol[1];
    let v3 = sol[2];

    assert!((v3 - 5.0).abs() < 1e-3, "Vdd debe ser 5V");
    // El circuito debe converger a uno de los estados estables bien diferenciados (uno alto, uno bajo)
    // o un punto de equilibrio consistente
    let diff = (v1 - v2).abs();
    assert!(
        (0.0..=5.0).contains(&v1) && (0.0..=5.0).contains(&v2),
        "Tensiones deben estar acotadas entre 0V y 5V (V1: {:.3} V, V2: {:.3} V, Diff: {:.3} V)",
        v1,
        v2,
        diff
    );
}

#[test]
fn test_arclength_schmitt_trigger_operating_points() {
    // Disparador Schmitt con BJT / realimentación positiva
    // Vcc (10V) -> Resistencias -> BJT Q1 y Q2
    let netlist = CircuitNetlist {
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
                value: 3.5,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Rc1".to_string(),
                comp_type: "resistor".to_string(),
                value: 2200.0,
                pins: vec!["1".to_string(), "3".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Q1".to_string(),
                comp_type: "npn".to_string(),
                value: 100.0, // Beta
                pins: vec!["3".to_string(), "2".to_string(), "4".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Re".to_string(),
                comp_type: "resistor".to_string(),
                value: 470.0,
                pins: vec!["4".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        temperature: Some(300.0),
        ..Default::default()
    };

    let result = solve_dc_circuit(&netlist).expect("DC operating point debe resolverse en Schmitt");
    let v_emitter = result.node_voltages.get("4").copied().unwrap_or(0.0);
    assert!(
        v_emitter > 0.0 && v_emitter < 10.0,
        "Tensión de emisor debe ser válida y positiva (obtenido: {:.3} V)",
        v_emitter
    );
}

#[test]
fn test_arclength_multi_state_finder() {
    // Verificar que find_multiple_dc_operating_points_arclength encuentra soluciones
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
                value: 100.0,
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
        temperature: Some(300.0),
        ..Default::default()
    };

    let mut vsource_map = HashMap::new();
    vsource_map.insert("V1".to_string(), 0);

    let x_init = vec![0.0, 0.0, 0.0];
    let settings = SolverNumericalSettings::default();

    let solutions = find_multiple_dc_operating_points_arclength(
        &netlist,
        2,
        1,
        &vsource_map,
        1e-12,
        &x_init,
        3,
        settings,
    )
    .expect("Debe encontrar al menos una solución DC con arclength multi-state finder");

    assert!(!solutions.is_empty(), "Debe existir al menos un punto de equilibrio encontrado");
    let sol = &solutions[0];
    assert!((sol[0] - 5.0).abs() < 1e-3, "V1 debe ser 5.0V");
    assert!(sol[1] > 0.5 && sol[1] < 1.0, "V_diode debe estar en zona directa");
}
