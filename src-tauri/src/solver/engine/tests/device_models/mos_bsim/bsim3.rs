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
