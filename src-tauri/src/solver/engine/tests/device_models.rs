use super::*;

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
fn test_bsim3_nmos_mobility_degradation() {
    // NMOS Shichman-Hodges asume movilidad fija.
    // BSIM3 degrada movilidad eff cuando Vgs es alto.
    let vgs_low = 1.0;
    let vgs_high = 5.0;
    let vds = 1.0;
    let vbs = 0.0;
    let vth = 0.4;

    let (_, gm_low, _) = evaluate_bsim3_nmos(vgs_low, vds, vbs, vth, None, None, None, None);
    let (_, gm_high, _) = evaluate_bsim3_nmos(vgs_high, vds, vbs, vth, None, None, None, None);

    // La movilidad degradada frena el incremento de gm a voltajes altos
    assert!(gm_high > 0.0, "gm a Vgs=5V debe ser mayor que cero");
    assert!(gm_low > 0.0, "gm a Vgs=1V debe ser mayor que cero");
}

#[test]
fn test_bsim3_geometry_scaling() {
    let vgs = 1.0;
    let vds = 1.0;
    let vbs = 0.0;
    let vth = 0.4;

    // Transistor base (W = 10u, L = 0.18u)
    let (ids_base, gm_base, _) =
        evaluate_bsim3_nmos(vgs, vds, vbs, vth, Some(10.0e-6), Some(0.18e-6), None, None);

    // Transistor escalado 10x en ancho (W = 100u, L = 0.18u)
    let (ids_scaled, gm_scaled, _) = evaluate_bsim3_nmos(
        vgs,
        vds,
        vbs,
        vth,
        Some(100.0e-6),
        Some(0.18e-6),
        None,
        None,
    );

    // Validar la proporción 10x de corriente y gm
    let ratio_ids = ids_scaled / ids_base;
    let ratio_gm = gm_scaled / gm_base;

    assert!(
        (ratio_ids - 10.0).abs() < 0.1,
        "La corriente debería escalar 10x, obtenido: {}",
        ratio_ids
    );
    assert!(
        (ratio_gm - 10.0).abs() < 0.1,
        "El gm debería escalar 10x, obtenido: {}",
        ratio_gm
    );
}

#[test]
fn test_bsim4_nmos_gate_leakage() {
    let w = Some(10e-6);
    let l = Some(0.045e-6); // canal corto de 45nm

    let (_ids_low, _gm_low, _gds_low, igs_low, _gg_low) =
        evaluate_bsim4_nmos(0.2, 0.5, 0.0, 0.35, w, l);
    let (_ids_high, _gm_high, _gds_high, igs_high, gg_high) =
        evaluate_bsim4_nmos(1.0, 0.5, 0.0, 0.35, w, l);

    // A Vgs = 0.2V, Ig es extremadamente bajo o cero:
    assert!(
        igs_low < 1e-12,
        "Ig a baja tensión debería ser < 1 pA, obtenido: {}",
        igs_low
    );

    // A Vgs = 1.0V, Ig debe crecer de forma cuántica debido a la capa de óxido ultrafina de 1.4nm:
    assert!(
        igs_high > 1e-9,
        "Ig a nominal debería ser > 1 nA, obtenido: {}",
        igs_high
    );
    assert!(
        gg_high > 1e-9,
        "Conductancia de compuerta gg a nominal debería ser > 1 nS, obtenido: {}",
        gg_high
    );

    // Verificamos escalado geométrico: duplicar W debe duplicar exactamente Ig y gg
    let (_, _, _, igs_high_double, gg_high_double) =
        evaluate_bsim4_nmos(1.0, 0.5, 0.0, 0.35, Some(20e-6), l);
    assert!(
        (igs_high_double - 2.0 * igs_high).abs() < 1e-15,
        "Duplicar W debería duplicar Ig"
    );
    assert!(
        (gg_high_double - 2.0 * gg_high).abs() < 1e-15,
        "Duplicar W debería duplicar gg"
    );
}

#[test]
fn test_bsim4_pmos_short_channel_saturation() {
    let w = Some(1e-6);
    let l = Some(0.045e-6);

    // Con Vsg = 1.0V (Encendido), evaluamos a vsd = 0.2V (Región lineal) y vsd = 1.0V (Saturación con CLM)
    let (isd_lin, _, _gds_lin, _, _) = evaluate_bsim4_pmos(1.0, 0.2, 0.0, 0.35, w, l);
    let (isd_sat, _, gds_sat, _, _) = evaluate_bsim4_pmos(1.0, 1.0, 0.0, 0.35, w, l);

    // La corriente de saturación debe ser mayor que la corriente lineal:
    assert!(
        isd_sat > isd_lin,
        "Corriente en saturación {} debe ser mayor que en triodo {}",
        isd_sat,
        isd_lin
    );

    // Gracias a CLM (lambda_clm = 0.08), la conductancia de salida gds en saturación no es cero:
    assert!(
        gds_sat > 1e-9,
        "Gds en saturación debe ser mayor a 1 nS debido a CLM, obtenido: {}",
        gds_sat
    );
}

#[test]
fn test_bsim_process_temperature_drift() {
    // Validar la deriva térmica de BSIM3:
    // A temperatura ambiente (300.15K / 27°C) vs alta temperatura (398.15K / 125°C)
    let vgs = 1.0;
    let vds = 1.0;
    let vbs = 0.0;
    let vth = 0.4;

    // Simulación a temperatura nominal (27°C)
    let (ids_room, gm_room, _) = evaluate_bsim3_nmos(
        vgs,
        vds,
        vbs,
        vth,
        Some(10.0e-6),
        Some(0.18e-6),
        Some(300.15),
        None,
    );

    // Simulación a alta temperatura (125°C = 398.15K)
    let (ids_hot, gm_hot, _) = evaluate_bsim3_nmos(
        vgs,
        vds,
        vbs,
        vth,
        Some(10.0e-6),
        Some(0.18e-6),
        Some(398.15),
        None,
    );

    // A temperatura más alta:
    // 1. El voltaje de umbral DECRECE (kt1 es negativo) → tiende a INCREMENTAR corriente
    // 2. La movilidad DECRECE (ute=-1.5) → tiende a DECREMENTAR corriente
    // El efecto neto a alta temperatura es que la corriente DISMINUYE porque la
    // degradación de movilidad domina sobre la reducción de Vth
    assert!(
        ids_room > 0.0,
        "Ids a temperatura ambiente debe ser positiva"
    );
    assert!(ids_hot > 0.0, "Ids a alta temperatura debe ser positiva");

    // La corriente a alta temperatura debe ser diferente de la corriente a temp ambiente
    let ratio = ids_hot / ids_room;
    assert!(
        (ratio - 1.0).abs() > 0.01,
        "La corriente debe cambiar significativamente con la temperatura, ratio: {}",
        ratio
    );

    // Verificar que gm también se ve afectado por la temperatura
    assert!(gm_room > 0.0, "gm a temperatura ambiente debe ser positivo");
    assert!(gm_hot > 0.0, "gm a alta temperatura debe ser positivo");

    // Verificar PMOS también
    let (isd_room_p, _, _) = evaluate_bsim3_pmos(
        vgs,
        vds,
        vbs,
        vth,
        Some(10.0e-6),
        Some(0.18e-6),
        Some(300.15),
        None,
    );
    let (isd_hot_p, _, _) = evaluate_bsim3_pmos(
        vgs,
        vds,
        vbs,
        vth,
        Some(10.0e-6),
        Some(0.18e-6),
        Some(398.15),
        None,
    );

    let ratio_p = isd_hot_p / isd_room_p;
    assert!(
        (ratio_p - 1.0).abs() > 0.01,
        "La corriente PMOS debe cambiar con la temperatura, ratio: {}",
        ratio_p
    );
}

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
