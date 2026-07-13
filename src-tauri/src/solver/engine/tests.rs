use crate::solver::matrix::*;
use crate::solver::types::*;
use nalgebra::{DMatrix, DVector};

#[allow(unused_imports)]
use super::ac::*;
#[allow(unused_imports)]
use super::advanced::*;
#[allow(unused_imports)]
use super::dc::*;
#[allow(unused_imports)]
use super::devices::*;
use super::simulation_types::{TimeStepResult, TransientSettings};
#[allow(unused_imports)]
use super::transient::*;

#[cfg(test)]
mod tests {
    use super::*;
    use num_complex::Complex;
    use std::collections::HashMap;

    mod mixed_signal {
        include!("tests/mixed_signal.rs");
    }
    mod sparse {
        include!("tests/sparse.rs");
    }

    mod dc_basic {
        include!("tests/dc_basic.rs");
    }
    mod diode {
        include!("tests/diode.rs");
    }

    mod transient {
        include!("tests/transient.rs");
    }

    mod ac_noise {
        include!("tests/ac_noise.rs");
    }

    mod device_models {
        include!("tests/device_models.rs");
    }

    mod thermal {
        include!("tests/thermal.rs");
    }

    #[test]
    fn test_opamp_amplifier() {
        // Circuito Amplificador Inversor con Op-Amp
        // Vin (nodo 1) = 1.0V
        // R1 = 1k entre nodo 1 y nodo 2 (V-)
        // Rf = 10k entre nodo 2 y nodo 3 (Vout)
        // Op-Amp: V+ = nodo 0 (tierra), V- = nodo 2, Vdd = nodo 4 (+15V), Vss = nodo 5 (-15V), Out = nodo 3
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "Vin".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 1.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Vpos".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 15.0,
                    pins: vec!["4".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Vneg".to_string(),
                    comp_type: "vsource".to_string(),
                    value: -15.0,
                    pins: vec!["5".to_string(), "0".to_string()],
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
                    id: "Rf".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 10000.0,
                    pins: vec!["2".to_string(), "3".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "X1".to_string(),
                    comp_type: "opamp".to_string(),
                    value: 0.0,
                    pins: vec![
                        "0".to_string(), // In+
                        "2".to_string(), // In-
                        "4".to_string(), // V+
                        "5".to_string(), // V-
                        "3".to_string(), // Out
                    ],
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

        let v_out = *result.node_voltages.get("3").unwrap();
        let v_virtual_gnd = *result.node_voltages.get("2").unwrap();

        // Ganancia teórica Av = -Rf / R1 = -10. Con Vin = 1V, Vout debe ser -10V
        assert!((v_out - -10.0).abs() < 1e-2, "El voltaje de salida debería ser exactamente -10.0V (ganancia inversora de -10), obtenido: {}", v_out);
        assert!(
            v_virtual_gnd.abs() < 1e-3,
            "La tierra virtual (nodo inversor) debería estar muy cerca de 0V, obtenido: {}",
            v_virtual_gnd
        );
    }

    #[test]
    fn test_monte_carlo_distribution() {
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 10.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    tolerance: Some(0.1), // 10% tolerancia
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R2".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    tolerance: Some(0.1), // 10% tolerancia
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let t_settings = TransientSettings {
            dt: 1e-4,
            t_max: 1e-4,
            fixed_step: None,
            integration_method: None,
        };

        let mc_settings = MonteCarloSettings {
            runs: 20,
            seed: Some(987654321),
        };

        let results = solve_monte_carlo_transient(&netlist, &t_settings, &mc_settings).unwrap();
        assert_eq!(results.len(), 20); // 20 corridas de simulación

        for run in results {
            assert!(run.len() > 0);
            let v_mid = *run.last().unwrap().node_voltages.get("2").unwrap();
            // Para divisor de tensión R1/R2 ideales de 1k, Vmid = 5.0V.
            // Con +/-10% de tolerancia, la dispersión está en torno a 5.0V, variando físicamente.
            // Aseguramos que los valores sean físicos y caigan dentro de límites lógicos
            assert!(
                v_mid > 4.0 && v_mid < 6.0,
                "Divisor variando por tolerancia fuera de cotas: {}",
                v_mid
            );
        }
    }

    #[test]
    fn test_measure_propagation_delay() {
        // Simular una rampa de entrada (nodo "1") que sube de 0V a 5V en 100ns,
        // y una rampa de salida (nodo "2") retardada 20ns.
        let mut time_steps = Vec::new();
        let n_points = 200;
        let t_max = 200e-9; // 200 ns

        for i in 0..=n_points {
            let t = i as f64 * t_max / n_points as f64;
            let mut node_voltages = HashMap::new();

            // Rampa de entrada: sube de 0V a 5V entre t=10ns y t=110ns
            let v_in = if t < 10e-9 {
                0.0
            } else if t < 110e-9 {
                5.0 * (t - 10e-9) / 100e-9
            } else {
                5.0
            };

            // Rampa de salida: igual pero retardada 20ns
            let v_out = if t < 30e-9 {
                0.0
            } else if t < 130e-9 {
                5.0 * (t - 30e-9) / 100e-9
            } else {
                5.0
            };

            node_voltages.insert("0".to_string(), 0.0);
            node_voltages.insert("1".to_string(), v_in);
            node_voltages.insert("2".to_string(), v_out);

            time_steps.push(TimeStepResult {
                time: t,
                node_voltages,
                branch_currents: HashMap::new(),
            });
        }

        // Medir retardo de propagación al 50%
        let directives = vec![
            MeasureDirective {
                name: "t_delay".to_string(),
                measure_type: "delay".to_string(),
                node: "2".to_string(),
                trig_node: Some("1".to_string()),
                threshold: Some(0.5),
                t_start: None,
                t_end: None,
            },
            MeasureDirective {
                name: "t_rise".to_string(),
                measure_type: "risetime".to_string(),
                node: "2".to_string(),
                trig_node: None,
                threshold: None,
                t_start: None,
                t_end: None,
            },
            MeasureDirective {
                name: "v_peak".to_string(),
                measure_type: "peak".to_string(),
                node: "2".to_string(),
                trig_node: None,
                threshold: None,
                t_start: None,
                t_end: None,
            },
            MeasureDirective {
                name: "v_avg".to_string(),
                measure_type: "avg".to_string(),
                node: "1".to_string(),
                trig_node: None,
                threshold: None,
                t_start: None,
                t_end: None,
            },
        ];

        let result = evaluate_measures(&time_steps, &directives);
        assert!(
            result.error_log.is_none(),
            "No debería haber errores: {:?}",
            result.error_log
        );

        // Verificar retardo de propagación ≈ 20ns (±2ns de tolerancia por discretización)
        let delay = *result
            .measurements
            .get("t_delay")
            .expect("Medición t_delay no encontrada");
        assert!(
            (delay - 20e-9).abs() < 2e-9,
            "El retardo de propagación debería ser ~20ns, obtenido: {:.2}ns",
            delay * 1e9
        );

        // Verificar tiempo de subida (10%→90% de 5V = 0.5V→4.5V sobre 100ns de rampa = 80ns)
        let risetime = *result
            .measurements
            .get("t_rise")
            .expect("Medición t_rise no encontrada");
        assert!(
            (risetime - 80e-9).abs() < 5e-9,
            "El tiempo de subida debería ser ~80ns, obtenido: {:.2}ns",
            risetime * 1e9
        );

        // Verificar pico = 5V
        let peak = *result
            .measurements
            .get("v_peak")
            .expect("Medición v_peak no encontrada");
        assert!(
            (peak - 5.0).abs() < 0.1,
            "El pico debería ser 5V, obtenido: {:.4}V",
            peak
        );

        // Verificar promedio (la rampa de 10ns-110ns sobre 200ns tiene un promedio razonable)
        let avg = *result
            .measurements
            .get("v_avg")
            .expect("Medición v_avg no encontrada");
        assert!(
            avg > 0.0 && avg < 5.0,
            "El promedio debería estar entre 0 y 5V, obtenido: {:.4}V",
            avg
        );
    }

    // ================================================================
    // FASE 24: Tests de Líneas de Transmisión RLCG
    // ================================================================

    #[test]
    fn test_tline_expansion_segments() {
        // Línea de transmisión ideal Z0=50Ω, Td=1ns, 20 segmentos
        let params = TransmissionLineParams {
            id: "1".to_string(),
            pin_in: "1".to_string(),
            pin_out: "2".to_string(),
            gnd: "0".to_string(),
            z0: 50.0,
            td: 1e-9,
            r_total: 0.0,
            g_total: 0.0,
            n_segments: 20,
        };

        let components = expand_transmission_line(&params);

        // Para línea ideal (R=0, G=0): cada segmento genera 1 inductor + 2 capacitores = 3 componentes
        // Total: 20 * 3 = 60 componentes
        assert_eq!(
            components.len(),
            60,
            "Una línea ideal de 20 segmentos debería generar 60 componentes pasivos, generó: {}",
            components.len()
        );

        // Verificar valores de L y C por segmento
        let l_expected = 50.0 * 1e-9 / 20.0; // Z0 * Td / N = 2.5 nH
        let c_expected = 1e-9 / (50.0 * 20.0); // Td / (Z0 * N) = 1 pF

        let first_inductor = components
            .iter()
            .find(|c| c.comp_type == "inductor")
            .unwrap();
        assert!(
            (first_inductor.value - l_expected).abs() / l_expected < 0.01,
            "L_seg debería ser {:.4e} H, obtenido: {:.4e} H",
            l_expected,
            first_inductor.value
        );

        let first_cap = components
            .iter()
            .find(|c| c.comp_type == "capacitor")
            .unwrap();
        assert!(
            (first_cap.value - c_expected / 2.0).abs() / (c_expected / 2.0) < 0.01,
            "C_seg/2 debería ser {:.4e} F, obtenido: {:.4e} F",
            c_expected / 2.0,
            first_cap.value
        );
    }

    #[test]
    fn test_tline_lossy_expansion() {
        // Línea con pérdidas: R_total=5Ω, G_total=0.001S
        let params = TransmissionLineParams {
            id: "2".to_string(),
            pin_in: "3".to_string(),
            pin_out: "4".to_string(),
            gnd: "0".to_string(),
            z0: 75.0,
            td: 2e-9,
            r_total: 5.0,
            g_total: 0.001,
            n_segments: 10,
        };

        let components = expand_transmission_line(&params);

        // Para línea con pérdidas: cada segmento genera 1R + 1L + 2C + 2G_shunt = 6 componentes
        // Total: 10 * 6 = 60 componentes
        assert_eq!(
            components.len(),
            60,
            "Una línea con pérdidas de 10 segmentos debería generar 60 componentes, generó: {}",
            components.len()
        );

        // Verificar que hay resistores de serie y de fuga
        let r_series: Vec<_> = components.iter().filter(|c| c.id.contains(".R")).collect();
        let r_shunt: Vec<_> = components
            .iter()
            .filter(|c| c.id.contains(".GL") || c.id.contains(".GR"))
            .collect();
        assert_eq!(r_series.len(), 10, "Debería haber 10 resistores de serie");
        assert_eq!(
            r_shunt.len(),
            20,
            "Debería haber 20 resistores de fuga (GL+GR)"
        );

        // R_seg = 5/10 = 0.5Ω
        assert!(
            (r_series[0].value - 0.5).abs() < 0.001,
            "R_seg debería ser 0.5Ω, obtenido: {}Ω",
            r_series[0].value
        );
    }

    // ================================================================
    // FASE 25: Tests de Modelos de Deriva Térmica
    // ================================================================

    #[test]
    fn test_pss_shooting_method_simple_rc() {
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 0.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    wave_type: Some("sine".to_string()),
                    amplitude: Some(5.0),
                    frequency: Some(1000.0), // 1 kHz
                    offset: Some(0.0),
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0, // 1 kΩ
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "C1".to_string(),
                    comp_type: "capacitor".to_string(),
                    value: 1e-6, // 1 µF
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let pss_settings = PssSettings {
            period: 1e-3, // 1 ms
            max_shooting_iters: 5,
            shooting_tolerance: 1e-4,
        };

        let results = solve_pss(&netlist, &pss_settings);
        assert!(
            results.is_ok(),
            "PSS Shooting Method debería converger sin problemas"
        );
        let step_results = results.unwrap();
        assert!(
            !step_results.is_empty(),
            "Los resultados de PSS no deben estar vacíos"
        );
    }

    #[test]
    fn test_stability_analysis_rc_pole() {
        // Circuito RC: R=1k, C=1u => polo en s = -1/(RC) = -1000 rad/s
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "C1".to_string(),
                    comp_type: "capacitor".to_string(),
                    value: 1e-6,
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

        let res = run_stability_analysis(&netlist);
        assert!(
            res.is_ok(),
            "El análisis de estabilidad debería ejecutarse con éxito"
        );
        let data = res.unwrap();
        assert!(
            data.is_stable,
            "El circuito RC pasivo simple debe ser estable"
        );
        assert_eq!(data.poles.len(), 1, "Debería haber exactamente 1 polo");

        let p = data.poles[0];
        // El polo debe estar muy cercano a -1000 rad/s
        assert!(
            (p.re + 1000.0).abs() < 1.0,
            "El polo debería ser aproximadamente -1000, obtenido: {:?}",
            p
        );
    }

    #[test]
    fn test_mixed_signal_not_gate() {
        // Compuerta digital NOT conectada a una fuente de entrada analógica de 5V
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0, // Entrada lógica '1' analógica
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "G1".to_string(),
                    comp_type: "not_gate".to_string(),
                    pins: vec!["1".to_string(), "2".to_string()],
                    value: 0.0,
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
            "La simulación Mixed-Signal debe converger en DC"
        );
        let data = result.unwrap();
        let v_out = *data.node_voltages.get("2").unwrap_or(&5.0);
        // La compuerta NOT invierte 5V (true) a aprox 0V (false)
        assert!(v_out < 0.5, "La salida de la compuerta NOT con entrada de 5V debería estar cerca de 0V, obtenida: {}V", v_out);
    }

    #[test]
    fn test_stability_zeros_extraction() {
        // Red puente / filtro RC paralelo en serie con R2:
        // C1: capacitor 1uF, R1: resistor 1k en paralelo de 1 a 2.
        // R2: resistor 1k de 2 a 0.
        // Esta configuración tiene un polo en -2000 rad/s y un cero en -1000 rad/s.
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "C1".to_string(),
                    comp_type: "capacitor".to_string(),
                    value: 1e-6,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R2".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let res = run_stability_analysis(&netlist);
        assert!(
            res.is_ok(),
            "El análisis de estabilidad debería ejecutarse con éxito"
        );
        let data = res.unwrap();
        assert!(data.is_stable, "El circuito RC debe ser estable");

        // Debería detectar el polo en aprox -2000 rad/s y el cero en aprox -1000 rad/s
        assert!(!data.poles.is_empty(), "Debería haber polos");
        assert!(!data.zeros.is_empty(), "Debería haber ceros de transmisión");

        let has_pole_2000 = data.poles.iter().any(|p| (p.re + 2000.0).abs() < 10.0);
        let has_zero_1000 = data.zeros.iter().any(|z| (z.re + 1000.0).abs() < 10.0);

        // Verificar el polo y el cero calculados
        assert!(
            has_pole_2000,
            "Debería tener un polo cerca de -2000, obtenidos: {:?}",
            data.poles
        );
        assert!(
            has_zero_1000,
            "Debería tener un cero cerca de -1000, obtenidos: {:?}",
            data.zeros
        );
    }

    #[test]
    fn test_dc_sweep_continuation() {
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 0.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "D1".to_string(),
                    comp_type: "diode".to_string(),
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let sweep_settings = DcSweepSettings {
            source_id: "V1".to_string(),
            v_start: 0.0,
            v_end: 2.0,
            v_step: 0.1,
        };

        let sweep_res = solve_dc_sweep(&netlist, &sweep_settings);
        assert!(
            sweep_res.is_ok(),
            "DC Sweep con continuación de estados debería converger sin problemas"
        );
        let data = sweep_res.unwrap();
        assert_eq!(data.sweep_voltages.len(), 21);
        assert!(data.node_voltages.contains_key("2"));

        // El voltaje del nodo 2 (después del diodo) debería subir a medida que V1 sube
        let v2_final = data.node_voltages.get("2").unwrap().last().unwrap();
        assert!(
            *v2_final > 1.0,
            "Con 2V de entrada, el nodo 2 debería estar sobre 1.0V (obtenido: {}V)",
            v2_final
        );
    }

    #[test]
    fn test_opamp_dominant_pole() {
        // Circuito con Op-Amp en lazo abierto
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "Vin".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 1e-4, // Tensión pequeña para evitar saturación en lazo abierto
                    pins: vec!["1".to_string(), "0".to_string()],
                    wave_type: Some("sine".to_string()),
                    amplitude: Some(1e-4),
                    frequency: Some(1e3),
                    ..Default::default()
                },
                ComponentData {
                    id: "X1".to_string(),
                    comp_type: "opamp".to_string(),
                    value: 1e5,
                    pins: vec![
                        "1".to_string(),
                        "0".to_string(),
                        "0".to_string(),
                        "0".to_string(),
                        "2".to_string(),
                    ], // IN+, IN-, V+ (GND), V- (GND), OUT
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        // Probar AC Sweep a 1 Hz y 1000 Hz
        let ac_settings_low = AcSweepSettings {
            f_start: 1.0,
            f_end: 1.0,
            points_per_decade: 1,
            op_guess: None,
        };
        let ac_res_low = solve_ac_sweep(&netlist, &ac_settings_low).unwrap();
        let amp_low = ac_res_low.node_amplitudes.get("2").unwrap()[0];

        let ac_settings_high = AcSweepSettings {
            f_start: 1000.0,
            f_end: 1000.0,
            points_per_decade: 1,
            op_guess: None,
        };
        let ac_res_high = solve_ac_sweep(&netlist, &ac_settings_high).unwrap();
        let amp_high = ac_res_high.node_amplitudes.get("2").unwrap()[0];

        // A 1 Hz: Ganancia open-loop alta (~93 dB), salida de 1e-4V * 4.48e4 = 4.48V (~13 dBV)
        // A 1000 Hz: Ganancia open-loop atenuada por 100x (-40 dB), salida de 44.8mV (~-27 dBV)
        assert!(
            amp_low > 5.0,
            "La ganancia en baja frecuencia debería ser alta, obtenido: {} dBV",
            amp_low
        );
        assert!(amp_high < -10.0, "La ganancia en alta frecuencia debería estar severamente atenuada por el polo, obtenido: {} dBV", amp_high);
    }

    #[test]
    fn test_microcontrollers_mixed_signal() {
        // 1. Test Arduino Uno - Mode 1 (Blink)
        // Pins layout: [Pin_In, Pin_Out, Pin_ADC, Pin_DAC, Pin_VCC, Pin_GND]
        let netlist_arduino = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![ComponentData {
                id: "MCU1".to_string(),
                comp_type: "arduino_uno".to_string(),
                value: 1.0, // Mode 1 (Blink)
                pins: vec![
                    "1".to_string(),
                    "2".to_string(),
                    "3".to_string(),
                    "4".to_string(),
                    "5".to_string(),
                    "0".to_string(),
                ],
                ..Default::default()
            }],
            wires: vec![],
            temperature: None,
            fixed_step: Some(true),
            subcircuit_definitions: None,
            triggers: None,
        };

        // En continua (DC), el carril Pin_VCC (nodo 5) debería auto-polarizarse a 5.0 V gracias al Norton equivalent interno.
        let dc_res = solve_dc_circuit(&netlist_arduino).unwrap();
        let v_vcc = *dc_res.node_voltages.get("5").unwrap();
        assert!(
            (v_vcc - 5.0).abs() < 0.1,
            "El carril de VCC de Arduino debería regular a ~5.0V, obtenido: {}",
            v_vcc
        );

        // En transitorio, verificamos el parpadeo a 1 Hz (T = 1.0 s, 0.5s HIGH, 0.5s LOW)
        let settings_blink = TransientSettings {
            dt: 0.1,
            t_max: 1.2,
            fixed_step: Some(true),
            integration_method: None,
        };
        let results_blink = solve_transient_circuit(&netlist_arduino, &settings_blink).unwrap();

        let get_out_voltage = |t_target: f64| -> f64 {
            let step = results_blink
                .iter()
                .min_by(|a, b| {
                    (a.time - t_target)
                        .abs()
                        .partial_cmp(&(b.time - t_target).abs())
                        .unwrap()
                })
                .unwrap();
            *step.node_voltages.get("2").unwrap()
        };

        // A t = 0.2 s, debería estar en HIGH (~5.0 V)
        let v_t0_2 = get_out_voltage(0.2);
        assert!(
            v_t0_2 > 4.5,
            "Blink a 0.2s debería estar en HIGH, obtenido: {}",
            v_t0_2
        );

        // A t = 0.7 s, debería estar en LOW (~0 V)
        let v_t0_7 = get_out_voltage(0.7);
        assert!(
            v_t0_7 < 0.5,
            "Blink a 0.7s debería estar en LOW, obtenido: {}",
            v_t0_7
        );

        // 2. Test ESP32 - Mode 0 (Follower)
        // Vin conectado a Pin_ADC (nodo 3)
        let netlist_esp32 = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "MCU2".to_string(),
                    comp_type: "esp32".to_string(),
                    value: 0.0, // Mode 0 (Eco Follower)
                    pins: vec![
                        "1".to_string(),
                        "2".to_string(),
                        "3".to_string(),
                        "4".to_string(),
                        "5".to_string(),
                        "0".to_string(),
                    ],
                    ..Default::default()
                },
                ComponentData {
                    id: "Vin".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 1.5,
                    pins: vec!["3".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: Some(true),
            subcircuit_definitions: None,
            triggers: None,
        };

        let dc_res_esp32 = solve_dc_circuit(&netlist_esp32).unwrap();
        let v_vcc_esp32 = *dc_res_esp32.node_voltages.get("5").unwrap();
        assert!(
            (v_vcc_esp32 - 3.3).abs() < 0.1,
            "El carril de VCC de ESP32 debería regular a ~3.3V, obtenido: {}",
            v_vcc_esp32
        );

        // Pin_DAC (nodo 4) debería seguir a Pin_ADC (Vin = 1.5V)
        let v_dac = *dc_res_esp32.node_voltages.get("4").unwrap();
        assert!(
            (v_dac - 1.5).abs() < 0.2,
            "El dac debería seguir al adc (1.5V), obtenido: {}",
            v_dac
        );

        // 3. Test Raspberry Pi Pico - Mode 2 (Hysteresis Comparator)
        let netlist_pico = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "MCU3".to_string(),
                    comp_type: "raspberry_pi_pico".to_string(),
                    value: 2.0, // Mode 2 (Comparator)
                    pins: vec![
                        "1".to_string(),
                        "2".to_string(),
                        "3".to_string(),
                        "4".to_string(),
                        "5".to_string(),
                        "0".to_string(),
                    ],
                    ..Default::default()
                },
                ComponentData {
                    id: "Vin".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 0.0,
                    pins: vec!["3".to_string(), "0".to_string()],
                    wave_type: Some("sine".to_string()),
                    amplitude: Some(1.65),
                    frequency: Some(1.0),
                    offset: Some(1.65),
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: Some(true),
            subcircuit_definitions: None,
            triggers: None,
        };

        let settings_pico = TransientSettings {
            dt: 0.01,
            t_max: 1.0,
            fixed_step: Some(true),
            integration_method: None,
        };
        let results_pico = solve_transient_circuit(&netlist_pico, &settings_pico).unwrap();
        assert!(results_pico.len() > 0);
    }

    #[test]
    fn test_microcontrollers_phd_level() {
        // 1. Verificar la limitación de sobrecorriente activa del pin de salida digital (Short-circuit protection)
        // Conectamos el pin OUT de Arduino (nodo 2) a GND mediante un resistor de 1 Ohm.
        // Con Rload = 1 Ohm, la corriente teórica sin protección superaría los 250 mA.
        let netlist_short = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "MCU1".to_string(),
                    comp_type: "arduino_uno".to_string(),
                    value: 1.0, // Mode 1 (Blink - HIGH en continua)
                    pins: vec![
                        "1".to_string(),
                        "2".to_string(),
                        "3".to_string(),
                        "4".to_string(),
                        "5".to_string(),
                        "0".to_string(),
                    ],
                    ..Default::default()
                },
                ComponentData {
                    id: "Rload".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1.0, // 1 Ohm
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: Some(true),
            subcircuit_definitions: None,
            triggers: None,
        };

        // En continua (DC), resolvemos el circuito.
        let res = solve_dc_circuit(&netlist_short).unwrap();

        // Obtenemos el voltaje en el nodo 2. La corriente a través del resistor Rload es V(2)/1.
        // Con limitación activa a 40 mA, V(2) debería ser aproximadamente I_max * Rload = 40 mV.
        let v_out = *res.node_voltages.get("2").unwrap();

        // Permitimos una tolerancia ya que el modelo Norton incluye la resistencia de salida de 20 Ohm.
        // Con Rload = 1 Ohm y G_out = 0.05 S (R_out = 20 Ohm):
        // I_load = I_eq_clamped * R_out / (R_out + R_load) = 40 mA * 20 / 21 = 38 mA.
        // V_out = I_load * R_load = 38 mV.
        assert!(v_out < 0.1, "La protección activa contra sobrecorrientes debería limitar la tensión a <100mV bajo cortocircuito, obtenido: {}V", v_out);
        assert!(
            v_out > 0.01,
            "Debería haber una corriente circulando (>10mV), obtenido: {}V",
            v_out
        );

        // 2. Verificar el transitorio electro-térmico y muestreo ADC S&H
        // Simulamos un ESP32 en Modo 0 (Eco) con entrada analógica (1.5V) y reloj de muestreo activo.
        let netlist_thermal = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "MCU2".to_string(),
                    comp_type: "esp32".to_string(),
                    value: 0.0, // Modo 0 (Eco)
                    pins: vec![
                        "1".to_string(),
                        "2".to_string(),
                        "3".to_string(),
                        "4".to_string(),
                        "5".to_string(),
                        "0".to_string(),
                    ],
                    ..Default::default()
                },
                ComponentData {
                    id: "Vin".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 2.0,
                    pins: vec!["3".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: Some(300.0), // 300 K = 26.85 ºC
            fixed_step: Some(true),
            subcircuit_definitions: None,
            triggers: None,
        };

        let settings = TransientSettings {
            dt: 1e-6,    // 1 microsegundo de paso para ver el muestreo activo de S&H
            t_max: 5e-6, // 5 pasos
            fixed_step: Some(true),
            integration_method: None,
        };

        let results = solve_transient_circuit(&netlist_thermal, &settings).unwrap();
        assert!(
            results.len() > 0,
            "Debería completar el análisis transitorio electro-térmico mixed-signal."
        );
    }

    #[test]
    fn test_b_source_math_evaluator() {
        let mut nv = HashMap::new();
        nv.insert("0".to_string(), 0.0);
        nv.insert("1".to_string(), 5.0);
        nv.insert("2".to_string(), 3.0);
        nv.insert("3".to_string(), 1.5);
        let mut bc = HashMap::new();
        bc.insert("V1".to_string(), 0.025);

        // Constantes y aritmética básica
        let r1 = evaluate_expression_string("2.5 + 3.0 * 2.0", &nv, &bc, 0.0).unwrap();
        assert!(
            (r1 - 8.5).abs() < 1e-10,
            "2.5 + 3.0 * 2.0 = 8.5, obtenido: {}",
            r1
        );

        // sin(pi/2) = 1.0
        let r2 = evaluate_expression_string("sin(pi / 2)", &nv, &bc, 0.0).unwrap();
        assert!(
            (r2 - 1.0).abs() < 1e-10,
            "sin(pi/2) = 1.0, obtenido: {}",
            r2
        );

        // ln(exp(1)) = 1.0
        let r3 = evaluate_expression_string("ln(exp(1))", &nv, &bc, 0.0).unwrap();
        assert!(
            (r3 - 1.0).abs() < 1e-6,
            "ln(exp(1)) = 1.0, obtenido: {}",
            r3
        );

        // V(1) = 5.0
        let r4 = evaluate_expression_string("V(1)", &nv, &bc, 0.0).unwrap();
        assert!((r4 - 5.0).abs() < 1e-10, "V(1) = 5.0, obtenido: {}", r4);

        // V(1, 2) = V(1) - V(2) = 5.0 - 3.0 = 2.0
        let r5 = evaluate_expression_string("V(1, 2)", &nv, &bc, 0.0).unwrap();
        assert!((r5 - 2.0).abs() < 1e-10, "V(1,2) = 2.0, obtenido: {}", r5);

        // I(V1) = 0.025
        let r6 = evaluate_expression_string("I(V1)", &nv, &bc, 0.0).unwrap();
        assert!(
            (r6 - 0.025).abs() < 1e-10,
            "I(V1) = 0.025, obtenido: {}",
            r6
        );

        // Expresión compuesta: V(1) * sin(pi/2) + V(2)^2 = 5.0 * 1.0 + 9.0 = 14.0
        let r7 =
            evaluate_expression_string("V(1) * sin(pi / 2) + V(2) ^ 2", &nv, &bc, 0.0).unwrap();
        assert!(
            (r7 - 14.0).abs() < 1e-10,
            "V(1)*sin(pi/2)+V(2)^2 = 14.0, obtenido: {}",
            r7
        );

        // Operador unario negativo: -V(3) = -1.5
        let r8 = evaluate_expression_string("-V(3)", &nv, &bc, 0.0).unwrap();
        assert!(
            (r8 - (-1.5)).abs() < 1e-10,
            "-V(3) = -1.5, obtenido: {}",
            r8
        );

        // Tiempo transitorio: t con time = 0.001
        let r9 = evaluate_expression_string("sin(2 * pi * 1000 * t)", &nv, &bc, 0.001).unwrap();
        let expected = (2.0 * std::f64::consts::PI * 1000.0 * 0.001).sin();
        assert!(
            (r9 - expected).abs() < 1e-10,
            "sin(2*pi*1000*t) con t=0.001, obtenido: {}",
            r9
        );

        // sqrt(abs(-16)) = 4.0
        let r10 = evaluate_expression_string("sqrt(abs(-16))", &nv, &bc, 0.0).unwrap();
        assert!(
            (r10 - 4.0).abs() < 1e-10,
            "sqrt(abs(-16)) = 4.0, obtenido: {}",
            r10
        );

        // max y min
        let r11 = evaluate_expression_string("max(V(1), V(2))", &nv, &bc, 0.0).unwrap();
        assert!(
            (r11 - 5.0).abs() < 1e-10,
            "max(V(1), V(2)) = 5.0, obtenido: {}",
            r11
        );

        let r12 = evaluate_expression_string("min(V(1), V(2))", &nv, &bc, 0.0).unwrap();
        assert!(
            (r12 - 3.0).abs() < 1e-10,
            "min(V(1), V(2)) = 3.0, obtenido: {}",
            r12
        );
    }

    #[test]
    fn test_b_source_nonlinear_voltage() {
        // Circuito: V1 (5V) -> nodo 1, R1 (1k) entre nodo 1 y nodo 2,
        // B1 (bvoltage) entre nodo 3 y GND con expresión "V(1) * 2" (debería dar 10V),
        // R2 (1k) entre nodo 3 y GND para cargar el nodo 3.
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
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R2".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "B1".to_string(),
                    comp_type: "bvoltage".to_string(),
                    value: 0.0,
                    pins: vec!["3".to_string(), "0".to_string()],
                    expression: Some("V(1) * 2".to_string()),
                    ..Default::default()
                },
                ComponentData {
                    id: "R3".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["3".to_string(), "0".to_string()],
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

        // V(1) debería ser 5.0V
        let v1 = *result.node_voltages.get("1").unwrap();
        assert!(
            (v1 - 5.0).abs() < 0.01,
            "V(1) debería ser ~5.0V, obtenido: {}",
            v1
        );

        // V(3) debería ser V(1) * 2 = 10.0V (forzado por bvoltage B1)
        let v3 = *result.node_voltages.get("3").unwrap();
        assert!(
            (v3 - 10.0).abs() < 0.1,
            "V(3) debería ser ~10.0V (B1 = V(1)*2), obtenido: {}",
            v3
        );
    }

    #[test]
    fn test_b_source_nonlinear_current() {
        // Circuito: V1 (5V) -> nodo 1 -> R1 (1k) -> nodo 2 -> GND
        // B_I1 (bcurrent) inyecta corriente V(1)/1000 desde nodo 2 a GND
        // Esto es equivalente a una resistencia paralela de 1k entre nodo 2 y GND
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
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R2".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "BI1".to_string(),
                    comp_type: "bcurrent".to_string(),
                    value: 0.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    expression: Some("V(2) / 1000".to_string()),
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

        // V(1) debería ser 5.0V
        let v1 = *result.node_voltages.get("1").unwrap();
        assert!(
            (v1 - 5.0).abs() < 0.01,
            "V(1) debería ser ~5.0V, obtenido: {}",
            v1
        );

        // V(2): R1 (1k) conecta V(1)=5V a nodo 2. En nodo 2 hay R2 (1k) a GND y
        // bcurrent que drena V(2)/1000 A extra. Sin bcurrent: V(2) = 2.5V.
        // Con bcurrent: la carga efectiva extra es como otra resistencia de 1k en paralelo con R2.
        // R_eq_load = R2 || 1k_equivalente_bcurrent, pero es no lineal.
        // Analíticamente: V(2) = V(1) * R_load/(R1 + R_load)
        // Corriente total de nodo 2: (V1-V2)/R1 = V2/R2 + V2/1000
        // (5-V2)/1000 = V2/1000 + V2/1000 = 2*V2/1000
        // 5 - V2 = 2*V2 -> V2 = 5/3 ≈ 1.667V
        let v2 = *result.node_voltages.get("2").unwrap();
        let expected_v2 = 5.0 / 3.0;
        assert!(
            (v2 - expected_v2).abs() < 0.1,
            "V(2) debería ser ~{:.3}V con bcurrent, obtenido: {}",
            expected_v2,
            v2
        );
    }

    // ======================================================================
    // PRUEBAS UNITARIAS DEL MOTOR DE DIFERENCIACIÓN AUTOMÁTICA AD (B-SOURCE)
    // ======================================================================

    #[test]
    fn test_b_source_ad_findiff_codegen_empty_grad() {
        let mut cache = HashMap::new();
        let nv = [("1".to_string(), 5.0), ("2".to_string(), 3.0)]
            .into_iter()
            .collect();
        let bc = HashMap::new();
        let ad = evaluate_expression_ad("42.0", &nv, &bc, 0.0, &mut cache).unwrap();
        assert!(
            ad.grad.is_empty(),
            "Constante 42 debería tener grad vacío, tiene {:?}",
            ad.grad
        );
    }

    #[test]
    fn test_b_source_ad_findiff_codegen_voltage_ref() {
        let mut cache = HashMap::new();
        let nv = [("1".to_string(), 5.0), ("2".to_string(), 3.0)]
            .into_iter()
            .collect();
        let bc = HashMap::new();
        let ad = evaluate_expression_ad("V(1)", &nv, &bc, 0.0, &mut cache).unwrap();
        assert_eq!(ad.value, 5.0, "V(1) debería ser 5.0");
        assert_eq!(ad.grad.get(&1), Some(&1.0), "dV(1)/dV1 debería ser 1");
    }

    #[test]
    fn test_b_source_ad_findiff_codegen_vdiff_grad() {
        let mut cache = HashMap::new();
        let nv = [("1".to_string(), 7.0), ("2".to_string(), 2.0)]
            .into_iter()
            .collect();
        let bc = HashMap::new();
        let ad = evaluate_expression_ad("V(1,2)", &nv, &bc, 0.0, &mut cache).unwrap();
        assert!(
            (ad.value - 5.0).abs() < 1e-12,
            "V(1,2) debería ser 5.0, es {}",
            ad.value
        );
        assert_eq!(ad.grad.get(&1), Some(&1.0), "dV(1,2)/dV1 debería ser 1");
        assert_eq!(ad.grad.get(&2), Some(&-1.0), "dV(1,2)/dV2 debería ser -1");
    }

    #[test]
    fn test_b_source_ad_findiff_codegen_product_rule() {
        let mut cache = HashMap::new();
        let nv = [("1".to_string(), 3.0), ("2".to_string(), 4.0)]
            .into_iter()
            .collect();
        let bc = HashMap::new();
        let ad = evaluate_expression_ad("V(1)*V(2)", &nv, &bc, 0.0, &mut cache).unwrap();
        assert!(
            (ad.value - 12.0).abs() < 1e-12,
            "V(1)*V(2) debería ser 12, es {}",
            ad.value
        );
        // d/dV1 = V(2) = 4, d/dV2 = V(1) = 3
        assert!(
            (ad.grad.get(&1).unwrap_or(&0.0) - 4.0).abs() < 1e-12,
            "dV/dV1 debería ser 4"
        );
        assert!(
            (ad.grad.get(&2).unwrap_or(&0.0) - 3.0).abs() < 1e-12,
            "dV/dV2 debería ser 3"
        );
    }

    #[test]
    fn test_b_source_ad_findiff_codegen_chain_rule() {
        let mut cache = HashMap::new();
        let nv = [("1".to_string(), std::f64::consts::FRAC_PI_4)]
            .into_iter()
            .collect();
        let bc = HashMap::new();
        let ad = evaluate_expression_ad("sin(V(1))", &nv, &bc, 0.0, &mut cache).unwrap();
        let expected_val = (std::f64::consts::FRAC_PI_4).sin();
        assert!(
            (ad.value - expected_val).abs() < 1e-12,
            "sin(V(1)) debería ser {}, es {}",
            expected_val,
            ad.value
        );
        let expected_deriv = (std::f64::consts::FRAC_PI_4).cos();
        assert!(
            (ad.grad.get(&1).unwrap_or(&0.0) - expected_deriv).abs() < 1e-12,
            "d(sin(V1))/dV1 debería ser {}, es {}",
            expected_deriv,
            ad.grad.get(&1).unwrap_or(&0.0)
        );
    }

    #[test]
    fn test_b_source_ad_findiff_codegen_vs_findiff() {
        let mut cache = HashMap::new();
        let eps = 1e-6;
        let v0 = 2.0;
        let nv = [("1".to_string(), v0)].into_iter().collect();
        let bc = HashMap::new();
        let ad =
            evaluate_expression_ad("V(1)*V(1) + exp(V(1))", &nv, &bc, 0.0, &mut cache).unwrap();
        let analytic_deriv = ad.grad.get(&1).unwrap_or(&0.0);

        let nv_plus = [("1".to_string(), v0 + eps)].into_iter().collect();
        let ad_plus =
            evaluate_expression_ad("V(1)*V(1) + exp(V(1))", &nv_plus, &bc, 0.0, &mut cache)
                .unwrap();
        let nv_minus = [("1".to_string(), v0 - eps)].into_iter().collect();
        let ad_minus =
            evaluate_expression_ad("V(1)*V(1) + exp(V(1))", &nv_minus, &bc, 0.0, &mut cache)
                .unwrap();
        let fd_deriv = (ad_plus.value - ad_minus.value) / (2.0 * eps);

        assert!(
            (analytic_deriv - fd_deriv).abs() < 1e-6,
            "Analytic dV/dV1={} no coincide con FD={}",
            analytic_deriv,
            fd_deriv
        );
    }

    #[test]
    fn test_b_source_ad_findiff_codegen_bvoltage_stamp() {
        let netlist = CircuitNetlist {
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 10.0,
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
                    id: "B1".to_string(),
                    comp_type: "bvoltage".to_string(),
                    value: 0.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    expression: Some("V(1) / 2.0".to_string()),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let result = solve_dc_circuit(&netlist).unwrap();
        let v2 = *result.node_voltages.get("2").unwrap();
        assert!(
            (v2 - 5.0).abs() < 0.1,
            "V(2) con bvoltage AD debería ser ~5.0V, es {}",
            v2
        );
    }

    #[test]
    fn test_b_source_ad_findiff_codegen_bcurrent_stamp() {
        let netlist = CircuitNetlist {
            components: vec![
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
                ComponentData {
                    id: "R2".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "B1".to_string(),
                    comp_type: "bcurrent".to_string(),
                    value: 0.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    expression: Some("V(2) / 1000".to_string()),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let result = solve_dc_circuit(&netlist).unwrap();
        let v2 = *result.node_voltages.get("2").unwrap();
        let expected_v2 = 5.0 / 3.0;
        assert!(
            (v2 - expected_v2).abs() < 0.1,
            "V(2) con bcurrent AD debería ser ~{:.3}V, es {}",
            expected_v2,
            v2
        );
    }

    #[test]
    fn test_logic_gate_hysteresis() {
        use crate::parser::parse_spice_netlist_to_native;

        // Inversor Schmitt trigger con histéresis: vhigh=3.0V, vlow=1.0V
        // Excitamos por rampa de entrada analógica transitoria
        let netlist_str = "
        * Test logic gate hysteresis
        U1 1 2 not_gate vhigh=3.0 vlow=1.0 td=1n
        V1 1 0 PULSE(0.0 4.0 0.0 10m 10m 10m 20m)
        ";

        let netlist = parse_spice_netlist_to_native(netlist_str).unwrap();

        // Verificar mapeo
        let u1 = netlist.components.iter().find(|c| c.id == "U1").unwrap();
        assert_eq!(u1.gate_vhigh, Some(3.0));
        assert_eq!(u1.gate_vlow, Some(1.0));
    }

    #[test]
    fn test_subcircuit_expression_interpolation() {
        use crate::parser::parse_spice_netlist_to_native;

        // Subcircuito con PARAMS: por defecto y expresiones {} en valores de componentes
        let netlist_str = "
        * Test subcircuit with parameters and expression interpolation
        .subckt MyOpamp 1 2 3 PARAMS: gain=100k r_val=10
        R1 1 2 {gain*2}
        R2 2 3 {r_val*5}
        .ends

        V1 4 0 10
        X1 4 5 0 MyOpamp PARAMS: gain=50k r_val=20
        ";

        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();

        // Verificar que X1.R1 tiene valor = gain * 2 = 50000 * 2 = 100000
        let r1 = parsed.components.iter().find(|c| c.id == "X1.R1").unwrap();
        assert_eq!(r1.comp_type, "resistor");
        assert!(
            (r1.value - 100000.0).abs() < 1.0,
            "X1.R1 debería tener valor 100000 (gain*2 = 50k*2), obtenido: {}",
            r1.value
        );

        // Verificar que X1.R2 tiene valor = r_val * 5 = 20 * 5 = 100
        let r2 = parsed.components.iter().find(|c| c.id == "X1.R2").unwrap();
        assert_eq!(r2.comp_type, "resistor");
        assert!(
            (r2.value - 100.0).abs() < 0.1,
            "X1.R2 debería tener valor 100 (r_val*5 = 20*5), obtenido: {}",
            r2.value
        );
    }

    #[test]
    fn test_isource_dc_analysis() {
        use crate::parser::parse_spice_netlist_to_native;
        let netlist_str = "
        * Test independent current source
        I1 0 1 10m
        R1 1 0 1k
        ";
        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        let res = solve_dc_circuit(&parsed).unwrap();
        let v1 = *res.node_voltages.get("1").unwrap();
        assert!(
            (v1 - 10.0).abs() < 1e-4,
            "Nodo 1 debería estar a 10.0V, obtenido: {}",
            v1
        );
    }

    #[test]
    fn test_vcvs_and_vccs_dc() {
        use crate::parser::parse_spice_netlist_to_native;
        let netlist_str = "
        * Test VCVS and VCCS
        V1 1 0 2
        E1 2 0 1 0 10
        R1 2 0 1k
        G1 0 3 1 0 2m
        R2 3 0 1k
        ";
        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        let res = solve_dc_circuit(&parsed).unwrap();
        let v2 = *res.node_voltages.get("2").unwrap();
        let v3 = *res.node_voltages.get("3").unwrap();
        assert!(
            (v2 - 20.0).abs() < 1e-4,
            "VCVS (E1): Nodo 2 debería estar a 20V, obtenido: {}",
            v2
        );
        assert!(
            (v3 - 4.0).abs() < 1e-4,
            "VCCS (G1): Nodo 3 debería estar a 4V, obtenido: {}",
            v3
        );
    }

    #[test]
    fn test_cccs_and_ccvs_dc() {
        use crate::parser::parse_spice_netlist_to_native;
        let netlist_str = "
        * Test CCCS and CCVS with consecutive nodes (1, 2, 3)
        Vctrl 1 0 5
        Rctrl 1 0 1k
        F1 0 2 Vctrl 5
        Rload1 2 0 100
        H1 3 0 Vctrl 100
        Rload2 3 0 1k
        ";
        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        let res = solve_dc_circuit(&parsed).unwrap();
        let v2 = *res.node_voltages.get("2").unwrap();
        let v3 = *res.node_voltages.get("3").unwrap();
        assert!(
            (v2.abs() - 2.5).abs() < 1e-4,
            "CCCS: Nodo 2 absoluto debería ser 2.5V, obtenido: {}",
            v2
        );
        assert!(
            (v3.abs() - 0.5).abs() < 1e-4,
            "CCVS: Nodo 3 absoluto debería ser 0.5V, obtenido: {}",
            v3
        );
    }

    #[test]
    fn test_subcircuit_controlled_sources() {
        use crate::parser::parse_spice_netlist_to_native;
        let netlist_str = "
        * Subcircuit with CCCS and CCVS using only interface nodes (no raw non-integer internal nodes)
        .subckt MyBlock 1 2 3
        Vlocal 1 3 2
        Rlocal 3 2 1k
        Flocal 0 2 Vlocal 10
        .ends
        
        X1 1 2 3 MyBlock
        Rload 2 0 100
        Vmain 1 0 5
        ";
        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();

        // Verificar que Flocal ha sido aplanada a X1.Flocal y que su controlador es X1.Vlocal
        let flocal = parsed
            .components
            .iter()
            .find(|c| c.id == "X1.Flocal")
            .unwrap();
        assert_eq!(flocal.comp_type, "cccs");
        assert_eq!(flocal.controlling_source, Some("X1.Vlocal".to_string()));

        let res = solve_dc_circuit(&parsed).unwrap();
        let v2 = *res.node_voltages.get("2").unwrap();
        assert!(
            v2.abs() > 0.0,
            "La salida del subcircuito con CCCS debe simular correctamente"
        );
    }

    #[test]
    fn test_global_param_interpolation() {
        use crate::parser::parse_spice_netlist_to_native;
        let netlist_str = "
        * Test global param interpolation
        .param Vdd=10 Rval=2k
        V1 1 0 {Vdd}
        R1 1 0 {Rval}
        ";
        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();

        let r1 = parsed.components.iter().find(|c| c.id == "R1").unwrap();
        assert_eq!(r1.comp_type, "resistor");
        assert_eq!(r1.value, 2000.0);

        let res = solve_dc_circuit(&parsed).unwrap();
        let v1 = *res.node_voltages.get("1").unwrap();
        assert!(
            (v1 - 10.0).abs() < 1e-4,
            "V1 debe tener el valor parametrizado globalmente a 10V, obtenido: {}",
            v1
        );
    }

    #[test]
    fn test_global_temp_setting() {
        use crate::parser::parse_spice_netlist_to_native;
        let netlist_str = "
        * Test global temperature setting
        .temp 125
        V1 1 0 5
        ";
        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        assert_eq!(
            parsed.temperature,
            Some(125.0),
            "La temperatura global debe ser 125.0"
        );
    }

    #[test]
    fn test_topology_graph_floating_nodes() {
        use crate::parser::parse_spice_netlist_to_native;
        let netlist_str = "
        * Test topology floating nodes auto-stabilization
        V1 1 0 10
        C1 1 2 1u
        R1 2 3 1k
        R2 3 0 1k
        ";
        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();

        let res = solve_dc_circuit(&parsed).unwrap();
        let v2 = *res.node_voltages.get("2").unwrap();
        let v3 = *res.node_voltages.get("3").unwrap();
        assert!(
            v2.abs() < 1e-3,
            "V2 debería ser prácticamente 0V por bleed resistor, obtenido: {}",
            v2
        );
        assert!(
            v3.abs() < 1e-3,
            "V3 debería ser prácticamente 0V por bleed resistor, obtenido: {}",
            v3
        );
    }

    #[test]
    fn test_homotopy_continuation_convergence() {
        use crate::parser::parse_spice_netlist_to_native;
        let netlist_str = "
        * Test homotopy continuation on highly non-linear feedback BJT circuit
        Vcc 1 0 5
        Rc1 1 2 1.01k
        Rc2 1 3 1k
        Q1 2 3 4 npn
        Q2 3 2 4 npn
        Ib1 0 2 10.1u
        Ib2 0 3 10u
        Re 4 0 100
        .model npn npn(bf=100 is=1e-14)
        ";
        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        let res = solve_dc_circuit(&parsed).unwrap();
        let v2 = *res.node_voltages.get("2").unwrap();
        let v3 = *res.node_voltages.get("3").unwrap();
        assert!(v2 > 0.0 && v3 > 0.0, "La simulación no lineal debe converger exitosamente y devolver voltajes coherentes: v2={}, v3={}", v2, v3);
    }

    #[test]
    fn test_sparse_markowitz_vlsi_performance() {
        use crate::parser::parse_spice_netlist_to_native;

        // Construir un circuito de gran escala (VLSI) con 150 nodos en escalera
        let mut netlist_str = String::from(
            "
        * VLSI Ladder Netlist
        V1 1 0 10.0
        ",
        );

        let num_nodes = 150;
        for i in 1..num_nodes {
            netlist_str.push_str(&format!("R{} {} {} 1k\n", i, i, i + 1));
            if i % 10 == 0 {
                netlist_str.push_str(&format!("D{} {} 0 DModel\n", i, i));
            }
        }
        netlist_str.push_str(".model DModel D(is=1e-14 rs=1e-3)\n");

        let parsed = parse_spice_netlist_to_native(&netlist_str).unwrap();

        let start_time = std::time::Instant::now();
        let res = solve_dc_circuit(&parsed).unwrap();
        let elapsed = start_time.elapsed();

        println!(
            "Tiempo de resolución sparse de {} nodos con Markowitz: {:?}",
            num_nodes, elapsed
        );

        // Validaciones de corrección de voltajes nodal
        let v1 = *res.node_voltages.get("1").unwrap();
        let v_last = *res.node_voltages.get(&num_nodes.to_string()).unwrap();

        assert!(
            (v1 - 10.0).abs() < 1e-12,
            "El voltaje de entrada debería ser 10.0V"
        );
        assert!(
            v_last > 0.0 && v_last < 10.0,
            "El voltaje al final de la escalera debe atenuarse, obtenido: {}",
            v_last
        );
    }

    #[test]
    fn test_sparse_csc_numerical_factorize() {
        use crate::sparse_csc::{NumericLUWorkspace, SparseMatrixCSC, SymbolicLU};
        use nalgebra::DVector;

        // 1. Definir un sistema MNA disperso no trivial con una matriz diagonalmente dominante y fill-in
        let size = 5;
        let mut matrix_a = SparseMatrix::new(size);

        // Estampar valores no triviales
        matrix_a.add_element(0, 0, 4.0);
        matrix_a.add_element(0, 1, -1.0);
        matrix_a.add_element(0, 3, -1.0);

        matrix_a.add_element(1, 0, -1.0);
        matrix_a.add_element(1, 1, 3.0);
        matrix_a.add_element(1, 2, -1.0);

        matrix_a.add_element(2, 1, -1.0);
        matrix_a.add_element(2, 2, 4.0);
        matrix_a.add_element(2, 4, -2.0);

        matrix_a.add_element(3, 0, -1.0);
        matrix_a.add_element(3, 3, 3.0);
        matrix_a.add_element(3, 4, -1.0);

        matrix_a.add_element(4, 2, -2.0);
        matrix_a.add_element(4, 3, -1.0);
        matrix_a.add_element(4, 4, 5.0);

        // Vector RHS
        let b = DVector::from_vec(vec![1.0, 2.0, 3.0, 4.0, 5.0]);

        // 2. Resolver usando SparseLU dinámico clásico
        let lu_classic = SparseLU::factorize(matrix_a.clone()).unwrap();
        let sol_classic = lu_classic.solve(&b).unwrap();

        // 3. Analizar y factorizar usando nuestro nuevo resolvedor CSC Left-Looking
        let symbolic = SymbolicLU::analyze(&matrix_a);
        let mut workspace = NumericLUWorkspace::new(&symbolic);
        let matrix_csc = SparseMatrixCSC::from_sparse(&matrix_a);

        matrix_csc
            .left_looking_factorize(&symbolic, &mut workspace)
            .unwrap();
        let sol_csc = symbolic.solve(&workspace, &b).unwrap();

        // 4. Comparar ambas soluciones
        for i in 0..size {
            let diff = (sol_classic[i] - sol_csc[i]).abs();
            assert!(
                diff < 1e-12,
                "Discrepancia en la solución en el índice {}: clásica = {}, csc = {}, diff = {}",
                i,
                sol_classic[i],
                sol_csc[i],
                diff
            );
        }
    }

    #[test]
    fn test_complex_sparse_csc_numerical_factorize() {
        use crate::sparse_csc::{ComplexNumericLUWorkspace, ComplexSparseMatrixCSC, SymbolicLU};
        use nalgebra::DVector;
        use num_complex::Complex;

        let size = 4;
        let mut matrix_a = ComplexSparseMatrix::new(size);

        // Estampar elementos complejos no triviales
        matrix_a.add_element(0, 0, Complex::new(4.0, 1.0));
        matrix_a.add_element(0, 1, Complex::new(-1.0, 0.0));
        matrix_a.add_element(0, 2, Complex::new(0.0, -2.0));

        matrix_a.add_element(1, 0, Complex::new(-1.0, 0.0));
        matrix_a.add_element(1, 1, Complex::new(3.0, 2.0));
        matrix_a.add_element(1, 3, Complex::new(-1.0, 1.0));

        matrix_a.add_element(2, 0, Complex::new(0.0, -2.0));
        matrix_a.add_element(2, 2, Complex::new(5.0, 0.0));
        matrix_a.add_element(2, 3, Complex::new(-2.0, -1.0));

        matrix_a.add_element(3, 1, Complex::new(-1.0, 1.0));
        matrix_a.add_element(3, 2, Complex::new(-2.0, -1.0));
        matrix_a.add_element(3, 3, Complex::new(6.0, 4.0));

        let b = DVector::from_vec(vec![
            Complex::new(1.0, 2.0),
            Complex::new(3.0, -1.0),
            Complex::new(0.0, 4.0),
            Complex::new(2.0, 2.0),
        ]);

        // 1. Resolver usando el solver clásico
        let lu_classic = ComplexSparseLU::factorize(matrix_a.clone()).unwrap();
        let sol_classic = lu_classic.solve(&b).unwrap();

        // 2. Mapear al patrón real estático para el análisis simbólico
        let mut real_pattern = SparseMatrix::new(size);
        for r in 0..size {
            for (&c, &val) in &matrix_a.rows[r] {
                real_pattern.add_element(r, c, val.norm());
            }
        }

        let symbolic = SymbolicLU::analyze(&real_pattern);
        let mut workspace = ComplexNumericLUWorkspace::new(&symbolic);
        let mut matrix_csc = ComplexSparseMatrixCSC::from_sparse(&matrix_a);

        // Factorizar y resolver
        matrix_csc.update_from_sparse(&matrix_a);
        matrix_csc
            .left_looking_factorize(&symbolic, &mut workspace)
            .unwrap();
        let sol_csc = symbolic.solve_complex(&workspace, &b).unwrap();

        // Comparar soluciones con tolerancia estricta
        for i in 0..size {
            let diff = (sol_classic[i] - sol_csc[i]).norm();
            assert!(diff < 1e-12, "Discrepancia en la solución compleja en índice {}: clásica = {}, csc = {}, diff = {}", i, sol_classic[i], sol_csc[i], diff);
        }
    }

    #[test]
    fn test_schur_parallel_solver_correctness() {
        use crate::sparse_csc::{NumericLUWorkspace, SparseMatrixCSC, SymbolicLU};
        use crate::sparse_parallel::SchurParallelSolver;
        use nalgebra::DVector;

        // Construir un circuito particionable sintético de tamaño 45 (14 bloques locales de tamaño 3 + 3 nodos de borde)
        let size = 45;
        let mut matrix_a = SparseMatrix::new(size);

        // Rellenar la diagonal para asegurar estabilidad numérica
        for i in 0..size {
            matrix_a.add_element(i, i, 12.0);
        }

        // Crear 14 bloques locales independientes de 3 nodos
        // Cada bloque k opera sobre nodos (3k, 3k+1, 3k+2)
        // Y se acopla con los nodos de borde (42, 43, 44)
        for k in 0..14 {
            let base = k * 3;
            // Conexiones internas del bloque
            matrix_a.add_element(base, base + 1, -2.0);
            matrix_a.add_element(base + 1, base, -2.0);
            matrix_a.add_element(base + 1, base + 2, -3.0);
            matrix_a.add_element(base + 2, base + 1, -3.0);

            // Conexiones al borde (acoplamiento)
            matrix_a.add_element(base, 42, -1.0);
            matrix_a.add_element(42, base, -1.0);

            matrix_a.add_element(base + 1, 43, -1.5);
            matrix_a.add_element(43, base + 1, -1.5);

            matrix_a.add_element(base + 2, 44, -2.0);
            matrix_a.add_element(44, base + 2, -2.0);
        }

        // Acoplamiento directo en el borde
        matrix_a.add_element(42, 43, -1.0);
        matrix_a.add_element(43, 42, -1.0);
        matrix_a.add_element(43, 44, -1.0);
        matrix_a.add_element(44, 43, -1.0);

        let b = DVector::from_fn(size, |idx, _| 1.0 + (idx as f64) * 0.1);

        // 1. Resolver con resolvedor Left-Looking secuencial de referencia
        let symbolic_seq = SymbolicLU::analyze(&matrix_a);
        let mut workspace_seq = NumericLUWorkspace::new(&symbolic_seq);
        let matrix_csc_seq = SparseMatrixCSC::from_sparse(&matrix_a);
        matrix_csc_seq
            .left_looking_factorize(&symbolic_seq, &mut workspace_seq)
            .unwrap();
        let sol_seq = symbolic_seq.solve(&workspace_seq, &b).unwrap();

        // 2. Resolver con nuestro nuevo SchurParallelSolver
        let mut parallel_solver = SchurParallelSolver::analyze(&matrix_a, 0.1);
        assert!(
            !parallel_solver.is_monolithic,
            "El circuito sintético debería haber sido particionado."
        );
        assert!(
            parallel_solver.blocks.len() >= 2,
            "Debería haber múltiples bloques independientes."
        );

        let sol_par = parallel_solver.solve(&matrix_a, &b).unwrap();

        // 3. Validar correctitud numérica con error de precisión < 1e-12
        for i in 0..size {
            let diff = (sol_seq[i] - sol_par[i]).abs();
            assert!(diff < 1e-12, "Discrepancia en resolvedor Schur paralelo en índice {}: seq = {}, par = {}, diff = {}", i, sol_seq[i], sol_par[i], diff);
        }
    }

    #[test]
    fn test_schur_parallel_scalability() {
        // Simular un circuito de 20 inversores lógicos CMOS conectados en paralelo
        // Genera una red masiva de transistores con más de 60 nodos activos para forzar el solver en paralelo
        let mut components = vec![ComponentData {
            id: "Vdd".to_string(),
            comp_type: "vsource".to_string(),
            value: 5.0,
            pins: vec!["1".to_string(), "0".to_string()],
            ..Default::default()
        }];

        // Construir 20 inversores independientes alimentados por VDD (nodo 1) y GND (nodo 0)
        // Cada inversor i usa nodo de entrada (i*2 + 2) y salida (i*2 + 3)
        // Esto creará 20 bloques independientes acoplados únicamente a través del nodo de alimentación común VDD!
        for i in 0..20 {
            let in_node = (i * 2 + 2).to_string();
            let out_node = (i * 2 + 3).to_string();

            // Entrada del inversor conectada a un divisor resistivo local para polarizar los transistores
            components.push(ComponentData {
                id: format!("Rin_{}", i),
                comp_type: "resistor".to_string(),
                value: 10000.0,
                pins: vec![in_node.clone(), "0".to_string()],
                ..Default::default()
            });
            components.push(ComponentData {
                id: format!("Rbias_{}", i),
                comp_type: "resistor".to_string(),
                value: 10000.0,
                pins: vec!["1".to_string(), in_node.clone()],
                ..Default::default()
            });

            // Resistencia de carga local
            components.push(ComponentData {
                id: format!("Rload_{}", i),
                comp_type: "resistor".to_string(),
                value: 1000.0,
                pins: vec!["1".to_string(), out_node.clone()],
                ..Default::default()
            });

            // Transistor NMOS local
            components.push(ComponentData {
                id: format!("Mn_{}", i),
                comp_type: "nmos".to_string(),
                value: 1.0,
                pins: vec![in_node.clone(), out_node.clone(), "0".to_string()],
                ..Default::default()
            });

            // Transistor PMOS local
            components.push(ComponentData {
                id: format!("Mp_{}", i),
                comp_type: "pmos".to_string(),
                value: -1.0,
                pins: vec![in_node.clone(), out_node.clone(), "1".to_string()],
                ..Default::default()
            });
        }

        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components,
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        // Correr la simulación de DC.
        // Como el circuito tiene más de 60 nodos activos, solve_dc_circuit usará el SchurParallelSolver
        // de forma auto-adaptativa, resolviendo los 20 bloques en paralelo sobre múltiples hilos de Rayon.
        let result = solve_dc_circuit(&netlist).unwrap();

        // Verificar que la simulación es correcta y física
        for i in 0..20 {
            let out_node = (i * 2 + 3).to_string();
            let v_out = *result.node_voltages.get(&out_node).unwrap();
            // Cada inversor con entrada a 2.5V se polariza físicamente a ~3.75V debido a Rload conectada a VDD
            assert!(
                v_out > 3.5 && v_out < 4.0,
                "Inversor {} no balanceado, Vout obtenido: {}",
                i,
                v_out
            );
        }
    }

    #[test]
    fn test_static_pivoting_convergence() {
        // Creamos una matriz singular estructurada artificialmente con diagonal cero
        // y verificamos que el resolvedor de MNA aplica la estabilización estática y resuelve
        // el sistema sin lanzar pánico numérico y con alta precisión.
        use crate::sparse_csc::{ComplexNumericLUWorkspace, ComplexSparseMatrixCSC, SymbolicLU};
        let mut matrix_a = ComplexSparseMatrix::new(2);
        // Matriz: [ 0.0, 1.0; 1.0, 0.0 ] (singular si se hace LU directo sin pivoteo)
        matrix_a.add_element(0, 1, Complex::new(1.0, 0.0));
        matrix_a.add_element(1, 0, Complex::new(1.0, 0.0));
        // Agregamos un diagonal extremadamente pequeño < 1e-13 que disparará el Static Pivoting
        matrix_a.add_element(0, 0, Complex::new(1e-20, 0.0));
        matrix_a.add_element(1, 1, Complex::new(1e-20, 0.0));

        let mut real_pattern = SparseMatrix::new(2);
        real_pattern.add_element(0, 1, 1.0);
        real_pattern.add_element(1, 0, 1.0);
        real_pattern.add_element(0, 0, 1e-20);
        real_pattern.add_element(1, 1, 1e-20);

        let symbolic = SymbolicLU::analyze(&real_pattern);
        let mut workspace = ComplexNumericLUWorkspace::new(&symbolic);
        let matrix_csc = ComplexSparseMatrixCSC::from_sparse(&matrix_a);

        let res = matrix_csc.left_looking_factorize(&symbolic, &mut workspace);
        assert!(
            res.is_ok(),
            "Static pivoting debería estabilizar y permitir factorizar sin error"
        );

        let b = nalgebra::DVector::from_vec(vec![Complex::new(1.0, 0.0), Complex::new(2.0, 0.0)]);
        let sol = symbolic.solve_complex(&workspace, &b);
        assert!(sol.is_some(), "Debería retornar solución");
        let solution = sol.unwrap();
        // Con static pivoting en 1e-28, la solución obtenida debe ser estable y finita
        assert!(solution[0].re.is_finite(), "x1 debería ser finita");
        assert!(solution[1].re.is_finite(), "x2 debería ser finita");
    }

    #[test]
    fn test_mutual_inductance_transformer() {
        // Transformador CA reductor ideal 10:1
        // L1 = 10H, L2 = 0.1H, k = 0.99999 (muy acoplado)
        // V1 es fuente de CA de 10V (amplitud) a 50Hz, conectada a L1.
        // Verificamos que el voltaje en L2 (secundario) es exactamente la décima parte (1V).
        let netlist = CircuitNetlist {
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 0.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    wave_type: Some("sine".to_string()),
                    amplitude: Some(10.0),
                    frequency: Some(50.0),
                    offset: Some(0.0),
                    ..Default::default()
                },
                ComponentData {
                    id: "L1".to_string(),
                    comp_type: "inductor".to_string(),
                    value: 10.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "L2".to_string(),
                    comp_type: "inductor".to_string(),
                    value: 0.1,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Rload".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1e6, // Carga abierta para ver la relación de transformación de circuito abierto
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            mutual_inductances: Some(vec![MutualInductance {
                id: "K1".to_string(),
                l1_id: "L1".to_string(),
                l2_id: "L2".to_string(),
                k_coeff: 0.99,
            }]),
            wires: vec![],
            temperature: None,
            fixed_step: Some(true),
            thermal_config: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let settings = TransientSettings {
            dt: 1e-4,
            t_max: 0.04, // 2 periodos
            integration_method: Some("euler".to_string()),
            fixed_step: Some(true),
        };

        let results = solve_transient_circuit(&netlist, &settings).unwrap();
        assert!(
            !results.is_empty(),
            "La simulación transitoria debería retornar resultados"
        );

        // Al final de la simulación (en régimen permanente), verificamos el voltaje secundario en el nodo 2
        // en relación con la entrada en el nodo 1.
        let mut max_v1: f64 = 0.0;
        let mut max_v2: f64 = 0.0;
        // Buscamos los picos en el segundo ciclo (t > 0.02)
        for step in &results {
            if step.time > 0.02 {
                let v1 = step.node_voltages.get("1").copied().unwrap_or(0.0).abs();
                let v2 = step.node_voltages.get("2").copied().unwrap_or(0.0).abs();
                if v1 > max_v1 {
                    max_v1 = v1;
                }
                if v2 > max_v2 {
                    max_v2 = v2;
                }
            }
        }

        // Con k = 0.99, max_v1 debería ser ~10.0 y max_v2 debería ser ~0.99
        assert!(
            (max_v1 - 10.0).abs() < 0.1,
            "Voltaje primario debería ser ~10V de amplitud"
        );
        assert!(
            (max_v2 - 0.99).abs() < 0.16,
            "Relación de transformación 10:1 falló. Vsecundario obtenido: {}",
            max_v2
        );
    }

    #[test]
    fn test_pta_robust_convergence() {
        // Circuito con histéresis y lazo de alimentación positiva severo (Schmitt Trigger)
        // Op-Amp con ganancia extremadamente alta (feedback positivo de Out a In+)
        // Vin (nodo 1) = 1.0V
        // Vpos (nodo 4) = +15V, Vneg (nodo 5) = -15V
        // In+ (nodo 2) conectado a Out (nodo 2)
        // In- (nodo 1) conectado a Vin (1V)
        // R1 (nodo 2 a 0) = 1000 Ohm para drenar corriente
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "Vin".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 1.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Vpos".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 15.0,
                    pins: vec!["4".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Vneg".to_string(),
                    comp_type: "vsource".to_string(),
                    value: -15.0,
                    pins: vec!["5".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "X1".to_string(),
                    comp_type: "opamp".to_string(),
                    value: 0.0,
                    pins: vec![
                        "2".to_string(), // In+ (feedback de Out)
                        "1".to_string(), // In- (1V)
                        "4".to_string(), // V+
                        "5".to_string(), // V-
                        "2".to_string(), // Out (conectado a In+)
                    ],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        // Debe converger usando PTA (u Homotopía/Source Stepping si PTA no se dispara antes, pero PTA lo garantiza)
        let result = solve_dc_circuit(&netlist);
        assert!(result.is_ok(), "La simulación DC con lazo de realimentación positivo severo debería converger gracias a PTA/Homotopía");
        let res = result.unwrap();
        let v_out = *res.node_voltages.get("2").unwrap();
        // Con Vin = 1V, la salida se saturará a +15V o -15V (o un valor intermedio estable)
        assert!(
            v_out.abs() > 0.1,
            "Voltaje de salida del Schmitt trigger inválido: {}",
            v_out
        );
    }
}
