use super::super::*;

#[test]
fn test_diode_dynamic_models() {
    use crate::parser::parse_spice_netlist_to_native;

    // Dos diodos en paralelo excitados por la misma corriente.
    // DSi es de silicio con is=1e-14, DSchottky es Schottky con is=1e-7.
    // Evaluamos el voltaje en sus ánodos.
    let netlist_str = "
    * Test dynamic Shockley diode models
    .model MySi D(is=1e-14 n=1.0)
    .model MySchottky D(is=1e-7 n=1.0)

    V1 1 0 5.0
    R1 1 2 1k
    R2 1 3 1k
    DSi 2 0 MySi
    DSchottky 3 0 MySchottky
    ";

    let netlist = parse_spice_netlist_to_native(netlist_str).unwrap();

    // Verificar que los parámetros del modelo se extrajeron correctamente
    let d_si = netlist.components.iter().find(|c| c.id == "DSi").unwrap();
    assert_eq!(d_si.diode_is, Some(1e-14));
    assert_eq!(d_si.diode_n, Some(1.0));

    let d_schottky = netlist
        .components
        .iter()
        .find(|c| c.id == "DSchottky")
        .unwrap();
    assert_eq!(d_schottky.diode_is, Some(1e-7));
    assert_eq!(d_schottky.diode_n, Some(1.0));

    // Resolver el punto de operación DC
    let result = solve_dc_circuit(&netlist).unwrap();
    let v_si = *result.node_voltages.get("2").unwrap();
    let v_schottky = *result.node_voltages.get("3").unwrap();

    // Un diodo de silicio nominal a 1-5 mA tiene una caída de ~0.7V
    // Un diodo Schottky nominal a 1-5 mA tiene una caída de ~0.3V
    assert!(
        v_si > 0.6 && v_si < 0.8,
        "El voltaje de silicio debería ser ~0.7V, obtenido: {}",
        v_si
    );
    assert!(
        v_schottky > 0.2 && v_schottky < 0.45,
        "El voltaje de Schottky debería ser ~0.3V, obtenido: {}",
        v_schottky
    );
    assert!(
        v_si - v_schottky > 0.25,
        "La diferencia de tensión debería ser > 0.25V, obtenido: {}",
        v_si - v_schottky
    );
}

#[test]
fn test_diode_rigorous_series_resistance() {
    use crate::parser::parse_spice_netlist_to_native;

    // Dos diodos en paralelo con idéntica fuente de tensión de 2.0V y resistencia limitadora muy baja (10 ohms)
    // DSi_no_rs tiene rs=0, DSi_rs tiene rs=5.0
    let netlist_str = "
    * Test diode series resistance
    .model DNoRs D(is=1e-14 rs=0.0)
    .model DWithRs D(is=1e-14 rs=5.0)

    V1 1 0 2.0
    R1 1 2 10.0
    R2 1 3 10.0
    D1 2 0 DNoRs
    D2 3 0 DWithRs
    ";

    let netlist = parse_spice_netlist_to_native(netlist_str).unwrap();

    // Verificar mapeo
    let d1 = netlist.components.iter().find(|c| c.id == "D1").unwrap();
    assert_eq!(d1.diode_rs, Some(0.0));

    let d2 = netlist.components.iter().find(|c| c.id == "D2").unwrap();
    assert_eq!(d2.diode_rs, Some(5.0));

    // Resolver
    let result = solve_dc_circuit(&netlist).unwrap();
    let v_d1_ext = *result.node_voltages.get("2").unwrap();
    let v_d2_ext = *result.node_voltages.get("3").unwrap();

    // El diodo sin resistencia de serie se clampa en su barrera ideal de silicio (~0.7V - 0.75V)
    // El diodo con resistencia de serie de 5 ohms experimenta una caída de tensión externa mucho mayor
    // ya que V_ext = V_junction + I * Rs
    println!("D1 ext: {} V, D2 ext: {} V", v_d1_ext, v_d2_ext);
    assert!(
        v_d1_ext > 0.65 && v_d1_ext < 0.85,
        "El diodo ideal debería estar clampado a ~0.7V-0.8V"
    );
    assert!(
        v_d2_ext > v_d1_ext + 0.15,
        "El diodo con Rs debería tener una tensión externa sustancialmente mayor"
    );
}

#[test]
fn test_zener_reverse_breakdown() {
    use crate::parser::parse_spice_netlist_to_native;

    // Diodo Zener polarizado inversamente excitado por rampa
    // BV = 5.1V, IBV = 1mA
    let netlist_str = "
    * Test Zener breakdown
    .model MyZener D(is=1e-14 bv=5.1 ibv=1m)

    V1 1 0 -10.0
    R1 1 2 1k
    D1 2 0 MyZener
    ";

    let netlist = parse_spice_netlist_to_native(netlist_str).unwrap();

    // Verificar mapeo
    let d1 = netlist.components.iter().find(|c| c.id == "D1").unwrap();
    assert_eq!(d1.diode_bv, Some(5.1));
    assert_eq!(d1.diode_ibv, Some(1e-3));

    // Resolver
    let result = solve_dc_circuit(&netlist).unwrap();
    let v_zener = *result.node_voltages.get("2").unwrap();

    println!("Voltaje Zener: {} V", v_zener);
    // Como la entrada es -10V, y el Zener regula a -5.1V, el nodo 2 debería estar clampado a aprox -5.1V
    assert!(
        v_zener < -4.8 && v_zener > -5.4,
        "El voltaje Zener regulado debería ser de aprox -5.1V, obtenido: {}",
        v_zener
    );
}
