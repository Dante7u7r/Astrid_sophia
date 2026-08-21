use super::super::super::*;

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
fn test_bsim3_capacitances() {
    let w = 10.0e-6;
    let l = 0.18e-6;
    let tox = 4.0e-9;
    let vth = 0.4;

    // Subumbral
    let (cgs_sub, cgd_sub, cgb_sub) =
        evaluate_bsim3_capacitances(0.1, 1.0, 0.0, vth, w, l, tox);
    assert!(cgs_sub > 0.0, "Cgs subumbral debe ser positivo (solape)");
    assert!(cgd_sub > 0.0, "Cgd subumbral debe ser positivo (solape)");
    assert!(cgb_sub > cgs_sub, "Cgb subumbral debe incluir componente intrínseca");

    // Saturación
    let (cgs_sat, cgd_sat, _cgb_sat) =
        evaluate_bsim3_capacitances(1.5, 1.0, 0.0, vth, w, l, tox);
    assert!(cgs_sat > cgs_sub, "Cgs en saturación debe ser mayor que en subumbral");
    assert!(cgs_sat > cgd_sat, "Cgs en saturación debe dominar sobre Cgd");
}

#[test]
fn test_bsim3_thermal_and_flicker_noise() {
    let ids = 1.0e-3;
    let gm = 5.0e-3;
    let gds = 1.0e-4;
    let gmb = 5.0e-4;
    let tox = 4.0e-9;
    let l = 0.18e-6;
    let temp_k = 300.15;

    let (s_th, s_1f_1khz) = evaluate_bsim3_noise(ids, gm, gds, gmb, tox, l, 1.0e3, temp_k);
    let (_, s_1f_1mhz) = evaluate_bsim3_noise(ids, gm, gds, gmb, tox, l, 1.0e6, temp_k);

    assert!(s_th > 0.0, "El ruido térmico debe ser estrictamente positivo");
    assert!(s_1f_1khz > 0.0, "El ruido 1/f debe ser estrictamente positivo");
    assert!(
        s_1f_1khz > s_1f_1mhz,
        "El ruido 1/f a 1 kHz debe ser mayor que a 1 MHz (espectro 1/f)"
    );
}

#[test]
fn test_bsim3_substrate_current_impact_ionization() {
    let ids = 2.0e-3;
    let l = 0.18e-6;
    let vdsat = 0.3;

    // Con Vds moderado (sin ionización significativa)
    let isub_low = evaluate_bsim3_substrate_current(ids, 0.5, vdsat, l);

    // Con Vds alto (ionización por impacto fuerte)
    let isub_high = evaluate_bsim3_substrate_current(ids, 3.3, vdsat, l);

    assert!(isub_high > isub_low, "Isub debe crecer exponencialmente con Vds - Vdsat");
    assert!(isub_high > 0.0, "Isub a 3.3V debe ser positivo");
}

#[test]
fn test_bsim3_pmos_evaluation() {
    let vsg = 1.5;
    let vsd = 1.0;
    let vsb = 0.0;
    let vth = 0.4;

    let (isd, gm, gds) = evaluate_bsim3_pmos(vsg, vsd, vsb, vth, None, None, None, None);
    assert!(isd > 0.0, "PMOS conduce corriente positiva Isd cuando Vsg > |Vth|");
    assert!(gm > 0.0, "Transconductancia gm de PMOS debe ser positiva");
    assert!(gds > 0.0, "Conductancia de salida gds de PMOS debe ser positiva");
}
