use super::super::*;

#[test]
fn test_isource_dc_analysis() {
    use crate::parser::parse_spice_netlist_to_native;
    let netlist_str = "
    * Test independent current source
    I1 0 1 10m
    R1 1 0 1k
    ";
    let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
    let res = solve_dc_circuit(&parsed).unwrap();
    let v1 = *res.node_voltages.get("1").unwrap();
    assert!(
        (v1 - 10.0).abs() < 1e-4,
        "Nodo 1 debería estar a 10.0V, obtenido: {}",
        v1
    );
}

#[test]
fn test_vcvs_and_vccs_dc() {
    use crate::parser::parse_spice_netlist_to_native;
    let netlist_str = "
    * Test VCVS and VCCS
    V1 1 0 2
    E1 2 0 1 0 10
    R1 2 0 1k
    G1 0 3 1 0 2m
    R2 3 0 1k
    ";
    let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
    let res = solve_dc_circuit(&parsed).unwrap();
    let v2 = *res.node_voltages.get("2").unwrap();
    let v3 = *res.node_voltages.get("3").unwrap();
    assert!(
        (v2 - 20.0).abs() < 1e-4,
        "VCVS (E1): Nodo 2 debería estar a 20V, obtenido: {}",
        v2
    );
    assert!(
        (v3 - 4.0).abs() < 1e-4,
        "VCCS (G1): Nodo 3 debería estar a 4V, obtenido: {}",
        v3
    );
}

#[test]
fn test_cccs_and_ccvs_dc() {
    use crate::parser::parse_spice_netlist_to_native;
    let netlist_str = "
    * Test CCCS and CCVS with consecutive nodes (1, 2, 3)
    Vctrl 1 0 5
    Rctrl 1 0 1k
    F1 0 2 Vctrl 5
    Rload1 2 0 100
    H1 3 0 Vctrl 100
    Rload2 3 0 1k
    ";
    let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
    let res = solve_dc_circuit(&parsed).unwrap();
    let v2 = *res.node_voltages.get("2").unwrap();
    let v3 = *res.node_voltages.get("3").unwrap();
    assert!(
        (v2.abs() - 2.5).abs() < 1e-4,
        "CCCS: Nodo 2 absoluto debería ser 2.5V, obtenido: {}",
        v2
    );
    assert!(
        (v3.abs() - 0.5).abs() < 1e-4,
        "CCVS: Nodo 3 absoluto debería ser 0.5V, obtenido: {}",
        v3
    );
}

#[test]
fn test_subcircuit_controlled_sources() {
    use crate::parser::parse_spice_netlist_to_native;
    let netlist_str = "
    * Subcircuit with CCCS and CCVS using only interface nodes (no raw non-integer internal nodes)
    .subckt MyBlock 1 2 3
    Vlocal 1 3 2
    Rlocal 3 2 1k
    Flocal 0 2 Vlocal 10
    .ends
    
    X1 1 2 3 MyBlock
    Rload 2 0 100
    Vmain 1 0 5
    ";
    let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();

    // Verificar que Flocal ha sido aplanada a X1.Flocal y que su controlador es X1.Vlocal
    let flocal = parsed
        .components
        .iter()
        .find(|c| c.id == "X1.Flocal")
        .unwrap();
    assert_eq!(flocal.comp_type, "cccs");
    assert_eq!(flocal.controlling_source, Some("X1.Vlocal".to_string()));

    let res = solve_dc_circuit(&parsed).unwrap();
    let v2 = *res.node_voltages.get("2").unwrap();
    assert!(
        v2.abs() > 0.0,
        "La salida del subcircuito con CCCS debe simular correctamente"
    );
}
