// ==========================================================================
// ASTRYD SOPHIA — WIDE-BANDGAP (SiC / GaN) POWER ELECTRONICS TESTS
// ==========================================================================

use crate::solver::engine::devices::wbg_power::{
    evaluate_gan_hemt, evaluate_sic_mosfet, GanHemtParams, SicMosfetParams,
};

#[test]
fn test_sic_mosfet_first_and_third_quadrant_exactness() {
    let params = SicMosfetParams {
        vth: 3.0,
        rds_on: 0.050, // 50 mΩ
        v_knee_body: 3.2,
        ..SicMosfetParams::default()
    };

    // 1er Cuadrante: Vgs=18V (> Vth), Vds=1.0V -> Ids = 13.4A (con saturación de velocidad theta=0.03)
    let fwd = evaluate_sic_mosfet(18.0, 1.0, 300.0, &params);
    assert!(fwd.ids > 12.0, "Ids directa debe ser > 12A con saturación de velocidad, obtenido: {}", fwd.ids);
    assert!(fwd.gm > 0.0);
    assert!(fwd.gds > 0.0);

    // 3er Cuadrante Síncrono: Vgs=18V, Vds=-0.5V -> Ids = -0.5V / 50mΩ = -10A
    let rev_sync = evaluate_sic_mosfet(18.0, -0.5, 300.0, &params);
    assert!(rev_sync.ids < 0.0);
    assert!(rev_sync.ids < -8.0, "Conducción síncrona en 3er cuadrante debe ser alta y negativa");

    // 3er Cuadrante Bloqueado: Vgs=0V (< Vth)
    // a) Vds = -2.0V (< Vknee = 3.2V) -> Body diode NO conduce significativamente
    let rev_sub_knee = evaluate_sic_mosfet(0.0, -2.0, 300.0, &params);
    assert!(rev_sub_knee.ids.abs() < 1e-3, "Por debajo de Vknee (3.2V) la corriente de body diode debe ser despreciable");

    // b) Vds = -4.0V (> Vknee = 3.2V) -> Body diode conduce con fuerte corriente
    let rev_body = evaluate_sic_mosfet(0.0, -4.0, 300.0, &params);
    assert!(rev_body.ids < -0.1, "Por encima de 3.2V el body diode SiC conduce fuertemente");
}

#[test]
fn test_sic_nonlinear_capacitance_miller_collapse() {
    let params = SicMosfetParams {
        cgd0: 200e-12,
        cds0: 1000e-12,
        cgs0: 1500e-12,
        v0_gd: 10.0,
        m_gd: 0.75,
        ..SicMosfetParams::default()
    };

    let cap_0v = evaluate_sic_mosfet(0.0, 0.0, 300.0, &params);
    let cap_50v = evaluate_sic_mosfet(0.0, 50.0, 300.0, &params);
    let cap_600v = evaluate_sic_mosfet(0.0, 600.0, 300.0, &params);

    // Cgs permanece constante
    assert_eq!(cap_0v.cgs, 1500e-12);
    assert_eq!(cap_600v.cgs, 1500e-12);

    // Cgd colapsa fuertemente con la tensión de drenador
    assert!(cap_50v.cgd < cap_0v.cgd * 0.35);
    assert!(cap_600v.cgd < cap_0v.cgd * 0.05, "Cgd a 600V debe ser < 5% del valor a 0V");
}

#[test]
fn test_gan_hemt_zero_qrr_and_bidirectional_2deg() {
    let params = GanHemtParams {
        vth: 1.5,
        rds_on: 0.025, // 25 mΩ
        beta: 30.0,
        ..GanHemtParams::default()
    };

    // 1er Cuadrante: Vgs=5V, Vds=0.5V
    let fwd = evaluate_gan_hemt(5.0, 0.5, 300.0, &params);
    assert!(fwd.ids > 10.0);

    // 3er Cuadrante Síncrono (Vgs=5V, Vds=-0.25V): Conducción simétrica por 2DEG
    let rev_sync = evaluate_gan_hemt(5.0, -0.25, 300.0, &params);
    assert!(rev_sync.ids < -5.0);

    // 3er Cuadrante Estado OFF (Vgs=0V):
    // a) Vds = -0.5V (Vgd = 0.5V < Vth = 1.5V) -> Bloqueado
    let rev_off_blocked = evaluate_gan_hemt(0.0, -0.5, 300.0, &params);
    assert!(rev_off_blocked.ids.abs() < 1e-6);

    // b) Vds = -2.5V (Vgd = 2.5V > Vth = 1.5V) -> Conduce por canal 2DEG con caída Vdrop = 1.5V
    let rev_off_conduction = evaluate_gan_hemt(0.0, -2.5, 300.0, &params);
    assert!(rev_off_conduction.ids < -1.0, "Canal GaN conduce en modo inverso cuando Vgd > Vth");
}

#[test]
fn test_thermal_coefficients_sic_and_gan() {
    let params_sic = SicMosfetParams::default();

    let sic_300k = evaluate_sic_mosfet(15.0, 1.0, 300.0, &params_sic);
    let sic_450k = evaluate_sic_mosfet(15.0, 1.0, 450.0, &params_sic);

    // A 150°C (450K), Rds_on aumenta debido a dispersión fonónica (menor corriente a igual Vds)
    assert!(sic_450k.ids < sic_300k.ids, "SiC Rds_on tiene coeficiente térmico positivo");
}
