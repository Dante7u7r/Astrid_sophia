use super::super::super::*;

#[test]
fn test_bsim4_nmos_gate_leakage() {
    let w = Some(10e-6);
    let l = Some(0.045e-6); // canal corto de 45nm

    let (_ids_low, _gm_low, _gds_low, _gmb_low, igs_low, _gg_low) =
        evaluate_bsim4_nmos(0.2, 0.5, 0.0, 0.35, w, l, None, None);
    let (_ids_high, _gm_high, _gds_high, _gmb_high, igs_high, gg_high) =
        evaluate_bsim4_nmos(1.0, 0.5, 0.0, 0.35, w, l, None, None);

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
    let (_, _, _, _, igs_high_double, gg_high_double) =
        evaluate_bsim4_nmos(1.0, 0.5, 0.0, 0.35, Some(20e-6), l, None, None);
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
    let (isd_lin, _, _gds_lin, _, _, _) = evaluate_bsim4_pmos(1.0, 0.2, 0.0, 0.35, w, l, None, None);
    let (isd_sat, _, gds_sat, _, _, _) = evaluate_bsim4_pmos(1.0, 1.0, 0.0, 0.35, w, l, None, None);

    // La corriente de saturación debe ser mayor que la corriente lineal:
    assert!(
        isd_sat > isd_lin,
        "Corriente en saturación {} debe ser mayor que en triodo {}",
        isd_sat,
        isd_lin
    );

    // Gracias a CLM (pclm = 0.8), la conductancia de salida gds en saturación no es cero:
    assert!(
        gds_sat > 1e-9,
        "Gds en saturación debe ser mayor a 1 nS debido a CLM, obtenido: {}",
        gds_sat
    );
}

#[test]
fn test_bsim4_capacitances_and_model_extraction() {
    use crate::parser::parse_spice_netlist_to_native;

    let spice = r#"
* Inversor CMOS BSIM4 45nm con parámetros Level=54
.model NMOS_45 NMOS (LEVEL=54 TOXE=1.2e-9 VTH0=0.32 U0=0.035 VMAX=1.1e5 RDSW=80.0 CGSO=2.5e-10 CGDO=2.5e-10)
.model PMOS_45 PMOS (LEVEL=54 TOXE=1.2e-9 VTH0=-0.32 U0=0.012 VMAX=7.5e4 RDSW=120.0 CGSO=2.5e-10 CGDO=2.5e-10)

Vdd 1 0 1.0
Vin 2 0 1.0

M1 3 2 0 0 NMOS_45 W=2u L=45n
M2 3 2 1 1 PMOS_45 W=4u L=45n
"#;

    let netlist = parse_spice_netlist_to_native(spice).expect("Netlist parse falló");

    // Verificar clasificación automática por level=54
    let m1 = netlist.components.iter().find(|c| c.id == "M1").expect("M1 no encontrado");
    let m2 = netlist.components.iter().find(|c| c.id == "M2").expect("M2 no encontrado");

    assert_eq!(m1.comp_type, "bsim4nmos");
    assert_eq!(m2.comp_type, "bsim4pmos");
    assert!((m1.w.unwrap() - 2e-6).abs() < 1e-12);
    assert!((m1.l.unwrap() - 45e-9).abs() < 1e-15);
    assert!((m1.bsim_toxe.unwrap() - 1.2e-9).abs() < 1e-15);
    assert!((m1.bsim_vth0.unwrap() - 0.32).abs() < 1e-12);
    assert!((m1.bsim_u0.unwrap() - 0.035).abs() < 1e-12);
    assert!((m1.bsim_rdsw.unwrap() - 80.0).abs() < 1e-12);

    // Verificar cálculo de capacitancias dinámicas
    let (cgs, cgd, cgb) = evaluate_bsim4_capacitances(
        1.0,
        0.1,
        0.0,
        m1.bsim_vth0.unwrap(),
        m1.w.unwrap(),
        m1.l.unwrap(),
        m1.bsim_toxe.unwrap(),
        Some(m1),
    );

    assert!(cgs > 0.0, "Cgs debe ser positiva");
    assert!(cgd > 0.0, "Cgd debe ser positiva");
    assert!(cgb > 0.0, "Cgb debe ser positiva");
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
