// ==========================================================================
// ASTRYD SOPHIA — MULTI-NODE THERMAL RC NETWORK TESTS (FOSTER & CAUER)
// ==========================================================================

use crate::solver::engine::advanced::thermal_network::{
    create_to220_3stage_foster, create_to247_4stage_foster, MultiNodeThermalModel, ThermalStage,
};

#[test]
fn test_foster_steady_state_temperature_rise() {
    let mut model = create_to247_4stage_foster(300.0);
    let rth_total = model.rth_total();
    assert_eq!(rth_total, 0.50, "Rth total de TO-247 debe ser 0.50 K/W");

    // Aplicar 100W de disipación durante 10 segundos (tiempo >> constante térmica más lenta de 100ms)
    let p_diss = 100.0;
    let dt = 0.01;
    let steps = 1000;
    let mut tj = 300.0;

    for _ in 0..steps {
        tj = model.step(p_diss, dt, 300.0);
    }

    let expected_tj = 300.0 + p_diss * rth_total; // 300 + 100 * 0.5 = 350 K (76.85 °C)
    assert!(
        (tj - expected_tj).abs() < 0.1,
        "Tj en régimen permanente debe converger a 350K, obtenido: {}",
        tj
    );
}

#[test]
fn test_cauer_ladder_network_transient_heat_propagation() {
    let stages = vec![
        ThermalStage::new(0.1, 0.001), // Die (rápido)
        ThermalStage::new(0.2, 0.010), // Solder
        ThermalStage::new(0.3, 0.100), // DBC
        ThermalStage::new(0.4, 1.000), // Heat sink (lento)
    ]; // Rth_total = 1.0 K/W
    let mut cauer = MultiNodeThermalModel::new_cauer(stages, 300.0);

    // Pulso corto de potencia de 50W durante 1 ms (solo calienta el Die)
    let tj_1ms = cauer.step(50.0, 0.001, 300.0);
    assert!(
        tj_1ms > 300.0,
        "La temperatura del die debe subir inmediatamente tras 1ms"
    );

    // Las capas externas aún deben estar cerca de la temperatura ambiente
    let t_heatsink = cauer.nodal_temperatures[3];
    assert!(
        (t_heatsink - 300.0) < (tj_1ms - 300.0) * 0.1,
        "El disipador de calor no debe calentarse en 1ms debido a la inercia térmica"
    );
}

#[test]
fn test_foster_to_cauer_conversion_preserves_rth() {
    let foster = create_to220_3stage_foster(300.0);
    let cauer = foster.to_cauer().expect("Conversión Foster a Cauer exitosa");

    assert_eq!(
        foster.rth_total(),
        cauer.rth_total(),
        "Rth total debe preservarse idéntica entre Foster y Cauer"
    );
}

#[test]
fn test_transient_thermal_impedance_zth_curve() {
    let foster = create_to247_4stage_foster(300.0);

    let zth_100us = foster.calculate_zth(100e-6);
    let zth_10ms = foster.calculate_zth(10e-3);
    let zth_10s = foster.calculate_zth(10.0);

    assert!(zth_100us > 0.0);
    assert!(zth_10ms > zth_100us, "Zth(t) debe ser monótonamente creciente");
    assert!(
        (zth_10s - foster.rth_total()).abs() < 1e-3,
        "Zth(t) a t grande debe tender a Rth_total (0.50 K/W)"
    );
}
