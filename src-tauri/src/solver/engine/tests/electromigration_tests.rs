// ==========================================================================
// ASTRYD SOPHIA — ELECTROMIGRATION & IR DROP TESTS
// ==========================================================================

use crate::solver::engine::advanced::electromigration::{
    analyze_interconnect_segment, calculate_trace_resistance, evaluate_segment_em,
    evaluate_segment_ir_drop, InterconnectMaterial, InterconnectSegmentSpec,
};

#[test]
fn test_trace_resistance_and_ir_drop() {
    // Pista de cobre en capa intermedia M3: L = 100 µm, W = 0.2 µm, t = 200 nm
    let r_300k = calculate_trace_resistance(100.0, 0.2, 200.0, InterconnectMaterial::CopperCu, 300.0);
    let r_373k = calculate_trace_resistance(100.0, 0.2, 200.0, InterconnectMaterial::CopperCu, 373.15);

    assert!(r_300k > 30.0 && r_300k < 60.0, "Resistencia calculada a 300K: {}", r_300k);
    assert!(r_373k > r_300k, "La resistencia debe aumentar con la temperatura");

    let spec = InterconnectSegmentSpec {
        segment_id: "M3_PWR_01".to_string(),
        source_node: "VDD_CORE".to_string(),
        target_node: "MAC_UNIT_VDD".to_string(),
        length_um: 100.0,
        width_um: 0.2,
        thickness_nm: 200.0,
        material: InterconnectMaterial::CopperCu,
        current_a: 0.5e-3, // 500 µA
        temperature_k: 350.0,
    };

    let ir_result = evaluate_segment_ir_drop(&spec, 0.9, 3.0); // 0.9V nominal, 3% budget
    assert!(ir_result.voltage_drop_v > 0.015 && ir_result.voltage_drop_v < 0.035);
    assert!(ir_result.voltage_drop_percent < 4.0);
}

#[test]
fn test_blech_immortality_short_length_effect() {
    // Pista corta L = 10 µm a alta densidad de corriente J = 1.0 MA/cm² -> J*L = 1000 A/cm < 2500 A/cm (Blech crit)
    let spec_short = InterconnectSegmentSpec {
        segment_id: "M1_LOCAL_SHORT".to_string(),
        source_node: "INV_OUT".to_string(),
        target_node: "NAND_IN".to_string(),
        length_um: 10.0,
        width_um: 0.1,
        thickness_nm: 100.0, // Área = 0.01 µm² = 1e-10 cm²
        material: InterconnectMaterial::CopperCu,
        current_a: 0.1e-3, // 100 µA -> J = 1.0 MA/cm²
        temperature_k: 378.15,
    };

    let em_short = evaluate_segment_em(&spec_short, 1.0e14);
    assert!(em_short.is_blech_immortal, "Pista de 10 µm debe ser inmortal a electromigración por efecto Blech");
    assert!(!em_short.em_violation);
    assert!(em_short.mttf_hours.is_infinite());

    // Pista larga L = 500 µm con la misma densidad J = 1.0 MA/cm² -> J*L = 50000 A/cm > 2500 A/cm
    let spec_long = InterconnectSegmentSpec {
        segment_id: "M1_GLOBAL_LONG".to_string(),
        source_node: "PLL_VDD".to_string(),
        target_node: "SRAM_VDD".to_string(),
        length_um: 500.0,
        width_um: 0.1,
        thickness_nm: 100.0,
        material: InterconnectMaterial::CopperCu,
        current_a: 0.1e-3,
        temperature_k: 378.15,
    };

    let em_long = evaluate_segment_em(&spec_long, 1.0e14);
    assert!(!em_long.is_blech_immortal, "Pista de 500 µm no debe ser inmortal");
    assert!(em_long.mttf_years.is_finite());
}

#[test]
fn test_black_equation_mttf_temperature_acceleration() {
    let spec_low_temp = InterconnectSegmentSpec {
        segment_id: "M2_BUS_01".to_string(),
        source_node: "N1".to_string(),
        target_node: "N2".to_string(),
        length_um: 200.0,
        width_um: 0.2,
        thickness_nm: 200.0,
        material: InterconnectMaterial::CopperCu,
        current_a: 0.8e-3, // 800 µA -> J = 2.0 MA/cm²
        temperature_k: 300.0, // 27 °C
    };

    let spec_high_temp = InterconnectSegmentSpec {
        temperature_k: 398.15, // 125 °C
        ..spec_low_temp.clone()
    };

    let em_300k = evaluate_segment_em(&spec_low_temp, 5.0e5);
    let em_398k = evaluate_segment_em(&spec_high_temp, 5.0e5);

    assert!(em_300k.mttf_years > em_398k.mttf_years * 50.0, "La aceleración térmica según Black debe reducir drásticamente el MTTF a 125 °C");
}

#[test]
fn test_interconnect_health_violation_detection() {
    // Pista con corriente excesiva que viola tanto EM como caída IR
    let spec_stressed = InterconnectSegmentSpec {
        segment_id: "VDD_HOTSPOT_01".to_string(),
        source_node: "PAD_VDD".to_string(),
        target_node: "CORE_LOAD".to_string(),
        length_um: 300.0,
        width_um: 0.1,
        thickness_nm: 100.0,
        material: InterconnectMaterial::AluminumAl, // Aluminio con menor J_max
        current_a: 1.0e-3, // 1 mA en sección muy delgada (J = 10 MA/cm²)
        temperature_k: 380.0,
    };

    let health = analyze_interconnect_segment(&spec_stressed, 0.9, 3.0, 5.0e5);
    assert!(health.has_any_violation);
    assert!(health.em.em_violation);
    assert!(health.ir.is_ir_drop_violation);
}
