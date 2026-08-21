// ==========================================================================
// ASTRYD SOPHIA — SEMICONDUCTOR AGING (NBTI, PBTI, HCI) & LIFETIME TESTS
// ==========================================================================

use crate::solver::engine::advanced::aging::{
    calculate_cumulative_aging, estimate_device_lifetime, evaluate_hci, evaluate_nbti, evaluate_pbti,
    AgingMechanism, AgingModelParameters, AgingStressProfile, ProcessTechnologyNode,
};

#[test]
fn test_nbti_pmos_voltage_and_temperature_acceleration() {
    let params = AgingModelParameters::for_node(ProcessTechnologyNode::Node28nmHkmg);

    // Estrés NBTI a 300K vs 398K (125 °C)
    let stress_300k = AgingStressProfile {
        vgs_stress: -1.2,
        vds_stress: 0.0,
        temperature_k: 300.0,
        duty_cycle: 1.0, // DC continuo
        is_pmos: true,
    };

    let stress_125c = AgingStressProfile {
        vgs_stress: -1.2,
        vds_stress: 0.0,
        temperature_k: 398.15,
        duty_cycle: 1.0,
        is_pmos: true,
    };

    let time_1_year = 365.25 * 86400.0;
    let delta_vth_300k = evaluate_nbti(&stress_300k, &params, time_1_year);
    let delta_vth_125c = evaluate_nbti(&stress_125c, &params, time_1_year);

    assert!(delta_vth_300k > 0.0);
    assert!(
        delta_vth_125c > delta_vth_300k * 1.5,
        "A 125 °C el corrimiento de Vth por NBTI debe ser sustancialmente mayor que a 300K"
    );
}

#[test]
fn test_pbti_nmos_hkmg_technology() {
    let params_planar = AgingModelParameters::for_node(ProcessTechnologyNode::Node180nmPlanar);
    let params_hkmg = AgingModelParameters::for_node(ProcessTechnologyNode::Node28nmHkmg);

    let stress_nmos = AgingStressProfile {
        vgs_stress: 1.0,
        vds_stress: 0.0,
        temperature_k: 350.0,
        duty_cycle: 1.0,
        is_pmos: false,
    };

    let time_10y = 10.0 * 365.25 * 86400.0;
    let pbti_planar = evaluate_pbti(&stress_nmos, &params_planar, time_10y);
    let pbti_hkmg = evaluate_pbti(&stress_nmos, &params_hkmg, time_10y);

    assert!(
        pbti_hkmg > pbti_planar * 5.0,
        "PBTI en High-κ Metal Gate debe ser significativamente mayor que en óxido planar SiO2"
    );
}

#[test]
fn test_hci_saturation_stress() {
    let params = AgingModelParameters::for_node(ProcessTechnologyNode::Node65nmBulk);

    let stress_hci = AgingStressProfile {
        vgs_stress: 0.9, // Vgs ≈ Vds / 2 para máximo impacto de portadores calientes
        vds_stress: 1.8,
        temperature_k: 300.0,
        duty_cycle: 0.5, // Conmutación AC al 50%
        is_pmos: false,
    };

    let time_5y = 5.0 * 365.25 * 86400.0;
    let delta_vth_hci = evaluate_hci(&stress_hci, &params, time_5y);

    assert!(delta_vth_hci > 0.010, "Corrimiento por HCI a 5 años debe superar 10 mV");
}

#[test]
fn test_cumulative_aging_and_10_year_lifetime() {
    let params = AgingModelParameters::for_node(ProcessTechnologyNode::Node28nmHkmg);

    let stress_nominal = AgingStressProfile {
        vgs_stress: -0.9,
        vds_stress: -0.9,
        temperature_k: 340.0, // 67 °C
        duty_cycle: 0.5,
        is_pmos: true,
    };

    let cum = calculate_cumulative_aging(&stress_nominal, &params, 10.0 * 365.25 * 86400.0);
    assert!(cum.delta_vth_total > 0.0);
    assert!(cum.delta_ids_percent > 0.0);

    // Vida útil para criterio estándar: ΔVth <= 50 mV o ΔIds <= 10%
    let lifetime = estimate_device_lifetime(&stress_nominal, &params, 0.050, 10.0);

    assert!(lifetime.time_to_failure_years > 5.0);
    assert_eq!(lifetime.dominant_mechanism, AgingMechanism::NBTI);
    assert!(lifetime.degradation_at_10_years.delta_vth_total > 0.0);
    assert!(lifetime.degradation_at_10_years.delta_ids_percent > 0.0);
}
