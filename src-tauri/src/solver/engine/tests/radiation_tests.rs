// ==========================================================================
// ASTRYD SOPHIA — RADIATION EFFECTS (TID / SEE / SET / SEU) TESTS
// ==========================================================================

use crate::solver::engine::advanced::radiation::{
    calculate_set_current_instant, evaluate_seu_vulnerability, evaluate_tid_degradation,
    RadiationHardeningLevel, SingleEventTransientSpec, TidTechnologyParameters,
    LET_TO_CHARGE_PC_PER_UM,
};

#[test]
fn test_tid_accumulation_and_threshold_shifts() {
    let params = TidTechnologyParameters::for_hardening(RadiationHardeningLevel::UnmitigatedCots);

    let dose_10k = evaluate_tid_degradation(10.0, &params, 70.0);
    let dose_100k = evaluate_tid_degradation(100.0, &params, 70.0);

    // Carga atrapada en óxido Not genera corrimiento negativo
    assert!(dose_10k.delta_vth_not < 0.0);
    assert!(dose_100k.delta_vth_not < dose_10k.delta_vth_not);

    // Fuga parasitaria de borde STI se incrementa con la dosis
    assert!(dose_100k.sti_leakage_current_a > dose_10k.sti_leakage_current_a);
    assert!(dose_100k.subthreshold_swing_mv_dec > 70.0);
}

#[test]
fn test_tid_rad_hard_rhbd_immunity() {
    let params_cots = TidTechnologyParameters::for_hardening(RadiationHardeningLevel::UnmitigatedCots);
    let params_rhbd = TidTechnologyParameters::for_hardening(RadiationHardeningLevel::RadHardByDesignRhbd);

    let dose_100k_cots = evaluate_tid_degradation(100.0, &params_cots, 70.0);
    let dose_100k_rhbd = evaluate_tid_degradation(100.0, &params_rhbd, 70.0);

    // RHBD debe tener sustancialmente menor corrimiento y fuga STI casi nula (anillos de guarda)
    assert!(dose_100k_rhbd.delta_vth_nmos.abs() < dose_100k_cots.delta_vth_nmos.abs() * 0.1);
    assert!(dose_100k_rhbd.sti_leakage_current_a < 1.0e-10);
    assert!(dose_100k_rhbd.functional_status_ok);
}

#[test]
fn test_set_double_exponential_current_pulse() {
    let spec = SingleEventTransientSpec {
        strike_time_s: 1.0e-9,  // 1 ns
        let_mev_cm2_mg: 60.0,   // 60 MeV·cm²/mg
        collection_depth_um: 2.5,
        tau_rise_s: 15.0e-12,   // 15 ps
        tau_fall_s: 250.0e-12,  // 250 ps
    };

    // Antes del impacto la corriente debe ser 0
    let i_before = calculate_set_current_instant(&spec, 0.5e-9);
    assert_eq!(i_before, 0.0);

    // En el pico del impacto (cerca de strike + 30 ps)
    let i_peak = calculate_set_current_instant(&spec, 1.03e-9);
    assert!(i_peak > 0.001, "La corriente pico de SET para LET 60 debe superar 1 mA");

    // Integración numérica simple de Riemann para verificar que la integral coincide con Q = LET * L * K
    let q_expected_c = spec.let_mev_cm2_mg * spec.collection_depth_um * LET_TO_CHARGE_PC_PER_UM * 1.0e-12;
    let dt = 1.0e-13; // 0.1 ps
    let mut q_num_c = 0.0;
    let mut t = spec.strike_time_s;
    while t < spec.strike_time_s + 3.0e-9 {
        let current = calculate_set_current_instant(&spec, t);
        q_num_c += current * dt;
        t += dt;
    }

    let rel_err = (q_num_c - q_expected_c).abs() / q_expected_c;
    assert!(rel_err < 0.05, "La carga total integrada numéricamente debe coincidir con Q_coll");
}

#[test]
fn test_seu_vulnerability_and_critical_charge() {
    let spec_proton = SingleEventTransientSpec {
        strike_time_s: 0.0,
        let_mev_cm2_mg: 1.0, // Protón / ión ligero (1 MeV·cm²/mg)
        collection_depth_um: 2.0,
        tau_rise_s: 10.0e-12,
        tau_fall_s: 200.0e-12,
    };

    // Nodo sensible de baja capacitancia (SRAM 28nm: C = 1.5 fF, VDD = 0.9V -> Qcrit = 0.675 fC)
    let vuln_cots = evaluate_seu_vulnerability(1.5e-15, 0.9, &spec_proton);
    assert!(vuln_cots.upset_occurred, "Para C=1.5fF debe haber upset (SEU) ante protón incidente");
    assert!(vuln_cots.safety_margin < 1.0);

    // Celda robustecida (C = 60 fF -> Qcrit = 27 fC > Qcoll = 20.7 fC)
    let vuln_hardened = evaluate_seu_vulnerability(60.0e-15, 0.9, &spec_proton);
    assert!(!vuln_hardened.upset_occurred, "Para C=60fF la celda debe resistir el upset ante protón");
    assert!(vuln_hardened.safety_margin > 1.0);
}
