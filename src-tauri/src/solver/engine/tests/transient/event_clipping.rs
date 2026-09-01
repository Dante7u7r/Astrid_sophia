use super::super::*;

#[test]
fn bdf_coefficients_follow_the_event_clipped_step() {
    const SLOPE_V_PER_SECOND: f64 = 1_000.0;
    const CAPACITANCE_F: f64 = 1e-6;
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "V_RAMP".to_string(),
                comp_type: "vsource".to_string(),
                value: 0.0,
                pins: vec!["1".to_string(), "0".to_string()],
                wave_type: Some("pwl".to_string()),
                pwl_points: Some(vec![(0.0, 0.0), (1.0, SLOPE_V_PER_SECOND)]),
                ..Default::default()
            },
            ComponentData {
                id: "C1".to_string(),
                comp_type: "capacitor".to_string(),
                value: CAPACITANCE_F,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            // Este modelo solo aporta el tick periódico de 100 us del scheduler.
            // IN y ADC están a GND; no hay firmware ni cruces analógicos de entrada.
            // OUT, DAC y VCC no se conectan al nodo de la rampa.
            ComponentData {
                id: "U_CLOCK".to_string(),
                comp_type: "arduino_uno".to_string(),
                value: 0.0,
                pins: ["0", "2", "0", "3", "4", "0"].map(str::to_string).to_vec(),
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    let results = solve_transient_circuit(
        &netlist,
        &TransientSettings {
            dt: 60e-6,
            t_max: 120e-6,
            fixed_step: Some(true),
            integration_method: Some("gear2".to_string()),
        },
    )
    .expect("El evento programado debe recortar el paso sin alterar la rampa analógica");

    // El evento de 100 us convierte el segundo paso nominal de 60 us en uno de 40 us.
    // Así se prueba el caller real que prepara los coeficientes, no solo su fórmula.
    let expected_times = [60e-6, 100e-6, 120e-6];
    assert_eq!(results.len(), expected_times.len());
    for (step, expected_time) in results.iter().zip(expected_times) {
        assert!(
            (step.time - expected_time).abs() < 1e-12,
            "Tiempo aceptado incorrecto: esperado {expected_time} s, obtenido {} s",
            step.time
        );
        let voltage = step.node_voltages["1"];
        assert!(
            (voltage - SLOPE_V_PER_SECOND * step.time).abs() < 1e-10,
            "La fuente ideal debe conservar V(t)=1000*t: V={voltage} V en t={} s",
            step.time
        );
        // I_C=C*dV/dt=+1 mA desde el nodo 1 hacia GND; I_V=-1 mA por KCL.
        let source_current = step.branch_currents["V_RAMP"];
        let kcl_residual = source_current + CAPACITANCE_F * SLOPE_V_PER_SECOND;
        assert!(
            kcl_residual.abs() < 1e-10,
            "El paso recortado debe satisfacer KCL: I_V={source_current} A, residuo={kcl_residual} A en t={} s",
            step.time
        );
    }
}
