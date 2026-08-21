use super::super::*;
use crate::solver::engine::advanced::waveform_relaxation::{
    solve_waveform_relaxation_transient, WaveformRelaxationMode, WaveformRelaxationSettings,
};
use crate::solver::types::{CircuitNetlist, ComponentData};
use crate::solver::TransientSettings;

#[test]
fn test_wr_cascaded_cmos_inverter_chain() {
    // Cadena de 4 inversores CMOS en cascada alimentados a 3.3V
    // Señal de entrada: Pulso de 0V a 3.3V con periodo de 20ns
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            // Alimentación global VDD = 3.3V
            ComponentData {
                id: "VDD".to_string(),
                comp_type: "vsource".to_string(),
                value: 3.3,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            // Fuente de señal de entrada en nodo 2
            ComponentData {
                id: "VIN".to_string(),
                comp_type: "vsource".to_string(),
                value: 0.0,
                pins: vec!["2".to_string(), "0".to_string()],
                wave_type: Some("pulse".to_string()),
                amplitude: Some(3.3),
                frequency: Some(50.0e6), // 50 MHz (periodo 20ns)
                duty_cycle: Some(0.5),
                ..Default::default()
            },
            // Etapa 1: Inversor 1 (entrada 2, salida 3)
            ComponentData {
                id: "M1_P".to_string(),
                comp_type: "pmos".to_string(),
                value: 0.7,
                pins: vec!["2".to_string(), "3".to_string(), "1".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "M1_N".to_string(),
                comp_type: "nmos".to_string(),
                value: 0.7,
                pins: vec!["2".to_string(), "3".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C1".to_string(),
                comp_type: "capacitor".to_string(),
                value: 0.5e-12, // 0.5 pF
                pins: vec!["3".to_string(), "0".to_string()],
                ..Default::default()
            },
            // Etapa 2: Inversor 2 (entrada 3, salida 4)
            ComponentData {
                id: "M2_P".to_string(),
                comp_type: "pmos".to_string(),
                value: 0.7,
                pins: vec!["3".to_string(), "4".to_string(), "1".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "M2_N".to_string(),
                comp_type: "nmos".to_string(),
                value: 0.7,
                pins: vec!["3".to_string(), "4".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C2".to_string(),
                comp_type: "capacitor".to_string(),
                value: 0.5e-12,
                pins: vec!["4".to_string(), "0".to_string()],
                ..Default::default()
            },
            // Etapa 3: Inversor 3 (entrada 4, salida 5)
            ComponentData {
                id: "M3_P".to_string(),
                comp_type: "pmos".to_string(),
                value: 0.7,
                pins: vec!["4".to_string(), "5".to_string(), "1".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "M3_N".to_string(),
                comp_type: "nmos".to_string(),
                value: 0.7,
                pins: vec!["4".to_string(), "5".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C3".to_string(),
                comp_type: "capacitor".to_string(),
                value: 0.5e-12,
                pins: vec!["5".to_string(), "0".to_string()],
                ..Default::default()
            },
            // Etapa 4: Inversor 4 (entrada 5, salida 6)
            ComponentData {
                id: "M4_P".to_string(),
                comp_type: "pmos".to_string(),
                value: 0.7,
                pins: vec!["5".to_string(), "6".to_string(), "1".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "M4_N".to_string(),
                comp_type: "nmos".to_string(),
                value: 0.7,
                pins: vec!["5".to_string(), "6".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C4".to_string(),
                comp_type: "capacitor".to_string(),
                value: 0.5e-12,
                pins: vec!["6".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: Some(300.15),
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let settings = TransientSettings {
        dt: 1e-10,    // 100 ps
        t_max: 2e-8,  // 20 ns
        fixed_step: Some(true),
        integration_method: Some("trap".to_string()),
    };

    // 1. Simulación Monolítica de referencia
    let mono_results = solve_transient_circuit(&netlist, &settings)
        .expect("La simulación monolítica debe converger");
    assert!(!mono_results.is_empty());

    // 2. Simulación con Waveform Relaxation (Gauss-Seidel)
    let wr_settings_gs = WaveformRelaxationSettings {
        mode: WaveformRelaxationMode::GaussSeidel,
        max_iterations: 10,
        reltol: 1e-3,
        vntol: 1e-5,
        initial_window_size: Some(1e-8),
        min_window_size: Some(1e-10),
        enable_window_chopping: true,
    };

    let wr_res_gs = solve_waveform_relaxation_transient(&netlist, &settings, Some(&wr_settings_gs))
        .expect("Waveform Relaxation Gauss-Seidel debe converger");

    assert!(
        wr_res_gs.num_partitions >= 2,
        "La cadena CMOS debe particionarse en subcircuitos (obtenidas: {})",
        wr_res_gs.num_partitions
    );
    assert!(wr_res_gs.converged, "El resolvedor WR debe declarar convergencia");
    assert!(!wr_res_gs.results.is_empty());

    // 3. Comparar formas de onda de salida entre Monolítico y Waveform Relaxation
    // En t = 15ns (etapa alta del pulso), el nodo 6 (etapa par 4) debe haber conmutado a nivel alto (> 2.5V)
    let v6_mono = mono_results.iter()
        .min_by(|a, b| ((a.time - 1.5e-8).abs()).partial_cmp(&(b.time - 1.5e-8).abs()).unwrap())
        .map(|s| *s.node_voltages.get("6").unwrap_or(&0.0))
        .unwrap();

    let v6_wr = wr_res_gs.results.iter()
        .min_by(|a, b| ((a.time - 1.5e-8).abs()).partial_cmp(&(b.time - 1.5e-8).abs()).unwrap())
        .map(|s| *s.node_voltages.get("6").unwrap_or(&0.0))
        .unwrap();

    assert!(
        (v6_mono - v6_wr).abs() < 0.15,
        "La discrepancia de tensión en nodo 6 entre Monolítico ({:.3}V) y WR ({:.3}V) debe ser < 0.15V",
        v6_mono, v6_wr
    );

    // 4. Simulación con Waveform Relaxation (Gauss-Jacobi / Rayon paralelo)
    let wr_settings_gj = WaveformRelaxationSettings {
        mode: WaveformRelaxationMode::GaussJacobi,
        max_iterations: 15,
        reltol: 1e-3,
        vntol: 1e-5,
        initial_window_size: Some(1e-8),
        min_window_size: Some(1e-10),
        enable_window_chopping: true,
    };

    let wr_res_gj = solve_waveform_relaxation_transient(&netlist, &settings, Some(&wr_settings_gj))
        .expect("Waveform Relaxation Gauss-Jacobi (paralelo) debe converger");

    assert!(wr_res_gj.converged);
}

#[test]
fn test_wr_multistage_rc_buffer_network() {
    // Red RC de 2 etapas aisladas con buffer MOSFET
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "VDD".to_string(),
                comp_type: "vsource".to_string(),
                value: 5.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "VIN".to_string(),
                comp_type: "vsource".to_string(),
                value: 0.0,
                pins: vec!["2".to_string(), "0".to_string()],
                wave_type: Some("pulse".to_string()),
                amplitude: Some(5.0),
                frequency: Some(1.0e6),
                duty_cycle: Some(0.5),
                ..Default::default()
            },
            // Etapa 1: Inversor 1 (nodo 2 -> nodo 3)
            ComponentData {
                id: "M1_P".to_string(),
                comp_type: "pmos".to_string(),
                value: 1.0,
                pins: vec!["2".to_string(), "3".to_string(), "1".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "M1_N".to_string(),
                comp_type: "nmos".to_string(),
                value: 1.0,
                pins: vec!["2".to_string(), "3".to_string(), "0".to_string()],
                ..Default::default()
            },
            // Etapa 2: Inversor 2 (nodo 3 -> nodo 4)
            ComponentData {
                id: "M2_P".to_string(),
                comp_type: "pmos".to_string(),
                value: 1.0,
                pins: vec!["3".to_string(), "4".to_string(), "1".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "M2_N".to_string(),
                comp_type: "nmos".to_string(),
                value: 1.0,
                pins: vec!["3".to_string(), "4".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C_LOAD".to_string(),
                comp_type: "capacitor".to_string(),
                value: 10.0e-12, // 10 pF
                pins: vec!["4".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: Some(300.15),
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let settings = TransientSettings {
        dt: 1e-8,
        t_max: 1e-6,
        fixed_step: Some(true),
        integration_method: Some("trap".to_string()),
    };

    let res = solve_waveform_relaxation_transient(&netlist, &settings, None)
        .expect("WR en red multietapa debe converger");

    assert!(res.converged);
    assert!(!res.results.is_empty());
}

#[test]
fn test_wr_feedback_loop_adaptive_windowing() {
    // Circuito con lazo de realimentación (oscilador en anillo de 3 etapas)
    // Demuestra que el mecanismo de window chopping / fallback maneja lazos acoplados cerrados sin divergencia
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "VDD".to_string(),
                comp_type: "vsource".to_string(),
                value: 3.3,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            // Inversor 1: 4 -> 2
            ComponentData {
                id: "M1_P".to_string(),
                comp_type: "pmos".to_string(),
                value: 0.7,
                pins: vec!["4".to_string(), "2".to_string(), "1".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "M1_N".to_string(),
                comp_type: "nmos".to_string(),
                value: 0.7,
                pins: vec!["4".to_string(), "2".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C1".to_string(),
                comp_type: "capacitor".to_string(),
                value: 1.0e-12,
                pins: vec!["2".to_string(), "0".to_string()],
                ..Default::default()
            },
            // Inversor 2: 2 -> 3
            ComponentData {
                id: "M2_P".to_string(),
                comp_type: "pmos".to_string(),
                value: 0.7,
                pins: vec!["2".to_string(), "3".to_string(), "1".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "M2_N".to_string(),
                comp_type: "nmos".to_string(),
                value: 0.7,
                pins: vec!["2".to_string(), "3".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C2".to_string(),
                comp_type: "capacitor".to_string(),
                value: 1.0e-12,
                pins: vec!["3".to_string(), "0".to_string()],
                ..Default::default()
            },
            // Inversor 3: 3 -> 4
            ComponentData {
                id: "M3_P".to_string(),
                comp_type: "pmos".to_string(),
                value: 0.7,
                pins: vec!["3".to_string(), "4".to_string(), "1".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "M3_N".to_string(),
                comp_type: "nmos".to_string(),
                value: 0.7,
                pins: vec!["3".to_string(), "4".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C3".to_string(),
                comp_type: "capacitor".to_string(),
                value: 1.0e-12,
                pins: vec!["4".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: Some(300.15),
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let settings = TransientSettings {
        dt: 1e-10,
        t_max: 5e-9,
        fixed_step: Some(true),
        integration_method: Some("trap".to_string()),
    };

    let wr_settings = WaveformRelaxationSettings {
        mode: WaveformRelaxationMode::GaussSeidel,
        max_iterations: 8,
        reltol: 1e-3,
        vntol: 1e-5,
        initial_window_size: Some(1e-9),
        min_window_size: Some(1e-10),
        enable_window_chopping: true,
    };

    let res = solve_waveform_relaxation_transient(&netlist, &settings, Some(&wr_settings))
        .expect("El oscilador con realimentación en WR debe resolver con window chopping");

    assert!(res.converged);
    assert!(!res.results.is_empty());
}

#[test]
fn test_wr_vs_monolithic_dc_and_transient_exactness() {
    // Red de 3 inversores CMOS escalonados excitados por una señal senoidal suave
    let netlist = CircuitNetlist {
        mutual_inductances: None,
        thermal_config: None,
        components: vec![
            ComponentData {
                id: "VDD".to_string(),
                comp_type: "vsource".to_string(),
                value: 3.3,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "VIN".to_string(),
                comp_type: "vsource".to_string(),
                value: 1.65,
                pins: vec!["2".to_string(), "0".to_string()],
                wave_type: Some("sine".to_string()),
                amplitude: Some(1.0),
                frequency: Some(25.0e6), // 25 MHz
                offset: Some(1.65),
                ..Default::default()
            },
            // Etapa 1: Inversor 1 (2 -> 3)
            ComponentData {
                id: "M1_P".to_string(),
                comp_type: "pmos".to_string(),
                value: 0.7,
                pins: vec!["2".to_string(), "3".to_string(), "1".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "M1_N".to_string(),
                comp_type: "nmos".to_string(),
                value: 0.7,
                pins: vec!["2".to_string(), "3".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C1".to_string(),
                comp_type: "capacitor".to_string(),
                value: 0.2e-12,
                pins: vec!["3".to_string(), "0".to_string()],
                ..Default::default()
            },
            // Etapa 2: Inversor 2 (3 -> 4)
            ComponentData {
                id: "M2_P".to_string(),
                comp_type: "pmos".to_string(),
                value: 0.7,
                pins: vec!["3".to_string(), "4".to_string(), "1".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "M2_N".to_string(),
                comp_type: "nmos".to_string(),
                value: 0.7,
                pins: vec!["3".to_string(), "4".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C2".to_string(),
                comp_type: "capacitor".to_string(),
                value: 0.2e-12,
                pins: vec!["4".to_string(), "0".to_string()],
                ..Default::default()
            },
            // Etapa 3: Inversor 3 (4 -> 5)
            ComponentData {
                id: "M3_P".to_string(),
                comp_type: "pmos".to_string(),
                value: 0.7,
                pins: vec!["4".to_string(), "5".to_string(), "1".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "M3_N".to_string(),
                comp_type: "nmos".to_string(),
                value: 0.7,
                pins: vec!["4".to_string(), "5".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "C3".to_string(),
                comp_type: "capacitor".to_string(),
                value: 0.2e-12,
                pins: vec!["5".to_string(), "0".to_string()],
                ..Default::default()
            },
        ],
        wires: vec![],
        temperature: Some(300.15),
        fixed_step: None,
        subcircuit_definitions: None,
        triggers: None,
    };

    let settings = TransientSettings {
        dt: 5e-11,    // 50 ps
        t_max: 4e-8,  // 40 ns (1 ciclo completo a 25MHz)
        fixed_step: Some(true),
        integration_method: Some("trap".to_string()),
    };

    let wr_settings = WaveformRelaxationSettings {
        mode: WaveformRelaxationMode::GaussSeidel,
        max_iterations: 15,
        reltol: 1e-4,
        vntol: 1e-6,
        initial_window_size: Some(5e-9),
        min_window_size: Some(1e-10),
        enable_window_chopping: true,
    };

    let mono_results = solve_transient_circuit(&netlist, &settings).unwrap();
    let wr_results = solve_waveform_relaxation_transient(&netlist, &settings, Some(&wr_settings)).unwrap();

    assert!(wr_results.converged);
    assert!(wr_results.num_partitions >= 3);

    // 1. Verificar amplitud pico a pico y saturación de rieles en nodo 5
    let v5_max_mono = mono_results.iter().map(|s| *s.node_voltages.get("5").unwrap_or(&0.0)).fold(0.0f64, f64::max);
    let v5_min_mono = mono_results.iter().map(|s| *s.node_voltages.get("5").unwrap_or(&0.0)).fold(3.3f64, f64::min);

    let v5_max_wr = wr_results.results.iter().map(|s| *s.node_voltages.get("5").unwrap_or(&0.0)).fold(0.0f64, f64::max);
    let v5_min_wr = wr_results.results.iter().map(|s| *s.node_voltages.get("5").unwrap_or(&0.0)).fold(3.3f64, f64::min);

    assert!(v5_max_mono > 3.0 && v5_max_wr > 3.0, "El nivel alto en nodo 5 debe alcanzar > 3.0V");
    assert!(v5_min_mono < 0.3 && v5_min_wr < 0.3, "El nivel bajo en nodo 5 debe descender a < 0.3V");

    assert!(
        (v5_max_mono - v5_max_wr).abs() < 0.05,
        "La tensión máxima de cresta debe coincidir (<0.05V): Mono={:.3}V, WR={:.3}V",
        v5_max_mono, v5_max_wr
    );
    assert!(
        (v5_min_mono - v5_min_wr).abs() < 0.05,
        "La tensión mínima de valle debe coincidir (<0.05V): Mono={:.3}V, WR={:.3}V",
        v5_min_mono, v5_min_wr
    );

    // 2. Verificar estado final estacionario en t=40ns
    let v5_final_mono = *mono_results.last().unwrap().node_voltages.get("5").unwrap();
    let v5_final_wr = *wr_results.results.last().unwrap().node_voltages.get("5").unwrap();

    assert!(
        (v5_final_mono - v5_final_wr).abs() < 0.05,
        "La tensión final en t=40ns debe coincidir: Mono={:.3}V, WR={:.3}V",
        v5_final_mono, v5_final_wr
    );
}
