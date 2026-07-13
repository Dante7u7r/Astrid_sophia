use super::super::*;

#[test]
fn test_subcircuit_expression_interpolation() {
    use crate::parser::parse_spice_netlist_to_native;

    // Subcircuito con PARAMS: por defecto y expresiones {} en valores de componentes
    let netlist_str = "
    * Test subcircuit with parameters and expression interpolation
    .subckt MyOpamp 1 2 3 PARAMS: gain=100k r_val=10
    R1 1 2 {gain*2}
    R2 2 3 {r_val*5}
    .ends

    V1 4 0 10
    X1 4 5 0 MyOpamp PARAMS: gain=50k r_val=20
    ";

    let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();

    // Verificar que X1.R1 tiene valor = gain * 2 = 50000 * 2 = 100000
    let r1 = parsed.components.iter().find(|c| c.id == "X1.R1").unwrap();
    assert_eq!(r1.comp_type, "resistor");
    assert!(
        (r1.value - 100000.0).abs() < 1.0,
        "X1.R1 debería tener valor 100000 (gain*2 = 50k*2), obtenido: {}",
        r1.value
    );

    // Verificar que X1.R2 tiene valor = r_val * 5 = 20 * 5 = 100
    let r2 = parsed.components.iter().find(|c| c.id == "X1.R2").unwrap();
    assert_eq!(r2.comp_type, "resistor");
    assert!(
        (r2.value - 100.0).abs() < 0.1,
        "X1.R2 debería tener valor 100 (r_val*5 = 20*5), obtenido: {}",
        r2.value
    );
}

#[test]
fn test_global_param_interpolation() {
    use crate::parser::parse_spice_netlist_to_native;
    let netlist_str = "
    * Test global param interpolation
    .param Vdd=10 Rval=2k
    V1 1 0 {Vdd}
    R1 1 0 {Rval}
    ";
    let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();

    let r1 = parsed.components.iter().find(|c| c.id == "R1").unwrap();
    assert_eq!(r1.comp_type, "resistor");
    assert_eq!(r1.value, 2000.0);

    let res = solve_dc_circuit(&parsed).unwrap();
    let v1 = *res.node_voltages.get("1").unwrap();
    assert!(
        (v1 - 10.0).abs() < 1e-4,
        "V1 debe tener el valor parametrizado globalmente a 10V, obtenido: {}",
        v1
    );
}

#[test]
fn test_global_temp_setting() {
    use crate::parser::parse_spice_netlist_to_native;
    let netlist_str = "
    * Test global temperature setting
    .temp 125
    V1 1 0 5
    ";
    let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
    assert_eq!(
        parsed.temperature,
        Some(125.0),
        "La temperatura global debe ser 125.0"
    );
}
