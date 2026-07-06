use crate::{parser, solver, SimulationError};
use num_complex::Complex;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::Ordering;

const PVT_MAX_TIME_STEPS: f64 = 2_000.0;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PvtConfig {
    pub corner: String,
    pub temperature_c: f64,
    pub voltage_scaling: f64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PvtRunResult {
    pub config: PvtConfig,
    pub transient: Vec<solver::TimeStepResult>,
    pub converged: bool,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PortDefinition {
    pub name: String,
    pub positive_node: String,
    pub negative_node: String,
    pub reference_impedance: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SParameterSettings {
    pub ports: Vec<PortDefinition>,
    pub f_start: f64,
    pub f_end: f64,
    pub points_per_decade: usize,
    pub output_format: String,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct ComplexSample {
    pub re: f64,
    pub im: f64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SParameterResult {
    pub frequencies: Vec<f64>,
    pub s_matrices: Vec<Vec<Vec<ComplexSample>>>,
    pub format: String,
    pub reference_impedance: f64,
    pub converged: bool,
    pub error: Option<String>,
}

fn validate_pvt_config(config: &PvtConfig) -> Result<(), String> {
    if !matches!(config.corner.as_str(), "tt" | "ff" | "ss" | "fs" | "sf") {
        return Err(format!(
            "Esquina de proceso no soportada: {}",
            config.corner
        ));
    }
    if !config.temperature_c.is_finite() || config.temperature_c < -273.15 {
        return Err("La temperatura PVT no es valida.".to_string());
    }
    if !config.voltage_scaling.is_finite() || config.voltage_scaling <= 0.0 {
        return Err("El escalado de alimentacion PVT debe ser positivo.".to_string());
    }
    Ok(())
}

fn process_speed(corner: &str, comp_type: &str) -> f64 {
    let is_n_type = matches!(comp_type, "nmos" | "npn");
    let is_p_type = matches!(comp_type, "pmos" | "pnp");
    match corner {
        "ff" => 1.1,
        "ss" => 0.9,
        "fs" if is_n_type => 1.1,
        "fs" if is_p_type => 0.9,
        "sf" if is_n_type => 0.9,
        "sf" if is_p_type => 1.1,
        _ => 1.0,
    }
}

fn apply_pvt_config(
    netlist: &solver::CircuitNetlist,
    config: &PvtConfig,
) -> solver::CircuitNetlist {
    let mut adjusted = netlist.clone();
    adjusted.temperature = Some(config.temperature_c + 273.15);

    for component in &mut adjusted.components {
        if component.comp_type == "vsource" {
            component.value *= config.voltage_scaling;
            component.amplitude = component
                .amplitude
                .map(|value| value * config.voltage_scaling);
            component.offset = component.offset.map(|value| value * config.voltage_scaling);
        }

        let speed = process_speed(&config.corner, &component.comp_type);
        if speed == 1.0 {
            continue;
        }

        if matches!(component.comp_type.as_str(), "nmos" | "pmos") {
            component.value /= speed;
            component.bsim_u0 = component.bsim_u0.map(|value| value * speed);
            component.bsim_vmax = component.bsim_vmax.map(|value| value * speed);
        } else if matches!(component.comp_type.as_str(), "npn" | "pnp") {
            component.bjt_bf = component.bjt_bf.map(|value| value * speed);
            component.bjt_is = component.bjt_is.map(|value| value * speed);
        }
    }
    adjusted
}

fn filter_monitored_nodes(steps: &mut [solver::TimeStepResult], monitored_nodes: &HashSet<String>) {
    if monitored_nodes.is_empty() {
        return;
    }
    for step in steps {
        step.node_voltages
            .retain(|node, _| node == "0" || monitored_nodes.contains(node));
    }
}

fn bounded_pvt_settings(mut settings: solver::TransientSettings) -> solver::TransientSettings {
    settings.dt = settings.dt.max(settings.t_max / PVT_MAX_TIME_STEPS);
    settings.fixed_step = Some(true);
    settings
}

#[tauri::command]
pub async fn run_pvt_matrix_analysis(
    state: tauri::State<'_, crate::SimulationControlState>,
    netlist: solver::CircuitNetlist,
    transient_settings: solver::TransientSettings,
    pvt_configs: Vec<PvtConfig>,
    monitored_nodes: Vec<String>,
) -> Result<Vec<PvtRunResult>, SimulationError> {
    if pvt_configs.is_empty() || pvt_configs.len() > 32 {
        return Err(SimulationError::from(
            "La matriz PVT debe contener entre 1 y 32 configuraciones.".to_string(),
        ));
    }
    if transient_settings.dt <= 0.0
        || transient_settings.t_max <= 0.0
        || transient_settings.dt > transient_settings.t_max
    {
        return Err(SimulationError::from(
            "Los ajustes transitorios PVT no son validos.".to_string(),
        ));
    }
    for config in &pvt_configs {
        validate_pvt_config(config).map_err(SimulationError::from)?;
    }

    let expanded = parser::expand_netlist_subcircuits(&netlist).map_err(SimulationError::from)?;
    let transient_settings = bounded_pvt_settings(transient_settings);
    let monitored: HashSet<String> = monitored_nodes.into_iter().collect();
    state.is_running.store(true, Ordering::SeqCst);
    let is_running = state.is_running.clone();
    let worker_running = is_running.clone();

    let worker = tauri::async_runtime::spawn_blocking(move || {
        pvt_configs
            .into_par_iter()
            .map(|config| {
                let adjusted = apply_pvt_config(&expanded, &config);
                let corner_running = worker_running.clone();
                match solver::solve_transient_circuit_inner(
                    &adjusted,
                    &transient_settings,
                    HashMap::new(),
                    HashMap::new(),
                    None,
                    None,
                    Some(move |_: &solver::TimeStepResult| corner_running.load(Ordering::SeqCst)),
                ) {
                    Ok((mut transient, _, _)) => {
                        filter_monitored_nodes(&mut transient, &monitored);
                        PvtRunResult {
                            config,
                            transient,
                            converged: true,
                            error: None,
                        }
                    }
                    Err(error) => PvtRunResult {
                        config,
                        transient: Vec::new(),
                        converged: false,
                        error: Some(error),
                    },
                }
            })
            .collect::<Vec<_>>()
    });

    let worker_result = worker.await;
    let was_cancelled = !is_running.load(Ordering::SeqCst);
    is_running.store(false, Ordering::SeqCst);
    let results = worker_result
        .map_err(|error| SimulationError::from(format!("El worker PVT fallo: {error}")))?;
    if was_cancelled {
        return Err(SimulationError::from(
            "Analisis PVT cancelado por el usuario.".to_string(),
        ));
    }
    Ok(results)
}

fn validate_sparameter_settings(settings: &SParameterSettings) -> Result<(), String> {
    if settings.ports.is_empty() || settings.ports.len() > 16 {
        return Err("Se requieren entre 1 y 16 puertos RF.".to_string());
    }
    if !settings.f_start.is_finite()
        || !settings.f_end.is_finite()
        || settings.f_start <= 0.0
        || settings.f_end <= settings.f_start
        || settings.points_per_decade == 0
        || settings.points_per_decade > 10_000
    {
        return Err("El rango de frecuencias S no es valido.".to_string());
    }
    if settings.output_format != "ma" && settings.output_format != "ri" {
        return Err("El formato S debe ser 'ma' o 'ri'.".to_string());
    }

    let reference = settings.ports[0].reference_impedance;
    if !reference.is_finite() || reference <= 0.0 {
        return Err("La impedancia de referencia debe ser positiva.".to_string());
    }
    let mut port_pairs = HashSet::new();
    for port in &settings.ports {
        if !port.reference_impedance.is_finite() || port.reference_impedance <= 0.0 {
            return Err(format!("Impedancia invalida en el puerto [{}].", port.name));
        }
        if (port.reference_impedance - reference).abs() > 1e-9 {
            return Err(
                "Touchstone requiere la misma impedancia de referencia en todos los puertos."
                    .to_string(),
            );
        }
        if port.positive_node == port.negative_node {
            return Err(format!(
                "El puerto [{}] tiene sus terminales unidos.",
                port.name
            ));
        }
        let pair = format!("{}:{}", port.positive_node, port.negative_node);
        if !port_pairs.insert(pair) {
            return Err(format!("El puerto [{}] esta duplicado.", port.name));
        }
    }
    Ok(())
}

fn db_phase_to_complex(db: f64, phase_deg: f64) -> Complex<f64> {
    if db <= -239.0 {
        return Complex::new(0.0, 0.0);
    }
    let magnitude = 10_f64.powf(db / 20.0);
    Complex::from_polar(magnitude, phase_deg.to_radians())
}

fn node_value(
    result: &solver::AcSweepResult,
    node: &str,
    frequency_index: usize,
) -> Result<Complex<f64>, String> {
    if node == "0" {
        return Ok(Complex::new(0.0, 0.0));
    }
    let db = result
        .node_amplitudes
        .get(node)
        .and_then(|values| values.get(frequency_index))
        .ok_or_else(|| format!("El nodo RF [{}] no existe en el resultado AC.", node))?;
    let phase = result
        .node_phases
        .get(node)
        .and_then(|values| values.get(frequency_index))
        .ok_or_else(|| format!("Fase no disponible para el nodo RF [{}].", node))?;
    Ok(db_phase_to_complex(*db, *phase))
}

fn build_port_excitation(
    netlist: &solver::CircuitNetlist,
    settings: &SParameterSettings,
    driven_port: usize,
) -> solver::CircuitNetlist {
    let mut excited = netlist.clone();
    for component in &mut excited.components {
        if matches!(component.comp_type.as_str(), "vsource" | "isource") {
            component.amplitude = Some(0.0);
        }
    }

    for (index, port) in settings.ports.iter().enumerate() {
        excited.components.push(solver::ComponentData {
            id: format!("__SP_TERM_{}", index + 1),
            comp_type: "resistor".to_string(),
            value: port.reference_impedance,
            pins: vec![port.positive_node.clone(), port.negative_node.clone()],
            ..Default::default()
        });
    }

    let port = &settings.ports[driven_port];
    excited.components.push(solver::ComponentData {
        id: format!("__SP_EXCITE_{}", driven_port + 1),
        comp_type: "isource".to_string(),
        value: 0.0,
        pins: vec![port.positive_node.clone(), port.negative_node.clone()],
        wave_type: Some("ac".to_string()),
        amplitude: Some(-2.0 / port.reference_impedance.sqrt()),
        ..Default::default()
    });
    excited
}

fn extract_sparameters(
    netlist: &solver::CircuitNetlist,
    settings: &SParameterSettings,
) -> Result<SParameterResult, String> {
    validate_sparameter_settings(settings)?;
    let ac_settings = solver::AcSweepSettings {
        f_start: settings.f_start,
        f_end: settings.f_end,
        points_per_decade: settings.points_per_decade,
        op_guess: None,
    };

    let sweeps = (0..settings.ports.len())
        .into_par_iter()
        .map(|driven_port| {
            let excited = build_port_excitation(netlist, settings, driven_port);
            solver::solve_ac_sweep(&excited, &ac_settings)
        })
        .collect::<Result<Vec<_>, _>>()?;

    let frequencies = sweeps[0].frequencies.clone();
    let port_count = settings.ports.len();
    let mut matrices =
        vec![vec![vec![ComplexSample::default(); port_count]; port_count]; frequencies.len()];

    for (driven_port, sweep) in sweeps.iter().enumerate() {
        if sweep.frequencies != frequencies {
            return Err("Los barridos AC de los puertos no comparten frecuencias.".to_string());
        }
        for (frequency_index, _) in frequencies.iter().enumerate() {
            for (measured_port, port) in settings.ports.iter().enumerate() {
                let positive = node_value(sweep, &port.positive_node, frequency_index)?;
                let negative = node_value(sweep, &port.negative_node, frequency_index)?;
                let mut wave = (positive - negative) / port.reference_impedance.sqrt();
                if measured_port == driven_port {
                    wave -= Complex::new(1.0, 0.0);
                }
                matrices[frequency_index][measured_port][driven_port] = ComplexSample {
                    re: wave.re,
                    im: wave.im,
                };
            }
        }
    }

    Ok(SParameterResult {
        frequencies,
        s_matrices: matrices,
        format: settings.output_format.clone(),
        reference_impedance: settings.ports[0].reference_impedance,
        converged: true,
        error: None,
    })
}

#[tauri::command]
pub async fn extract_sparameter(
    netlist: solver::CircuitNetlist,
    settings: SParameterSettings,
) -> Result<SParameterResult, SimulationError> {
    let expanded = parser::expand_netlist_subcircuits(&netlist).map_err(SimulationError::from)?;
    extract_sparameters(&expanded, &settings).map_err(SimulationError::from)
}

#[tauri::command]
pub async fn export_touchstone_file(content: String, n_ports: usize) -> Result<String, String> {
    if !(1..=16).contains(&n_ports) {
        return Err("La cantidad de puertos Touchstone debe estar entre 1 y 16.".to_string());
    }
    if content.is_empty() || content.len() > 100 * 1024 * 1024 {
        return Err("El contenido Touchstone esta vacio o excede 100 MB.".to_string());
    }

    let extension = format!("s{n_ports}p");
    let filter_extensions = [extension.as_str()];
    let file_path = rfd::AsyncFileDialog::new()
        .add_filter("Touchstone", &filter_extensions)
        .set_file_name(format!("astryd_export.{extension}"))
        .set_title("Exportar parametros S")
        .save_file()
        .await;

    if let Some(file_handle) = file_path {
        let path = file_handle.path();
        crate::write_file_atomically(path, &content)?;
        Ok(path.to_string_lossy().to_string())
    } else {
        Err("Operacion cancelada por el usuario".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn one_port_netlist(load_ohms: Option<f64>) -> solver::CircuitNetlist {
        let mut components = Vec::new();
        if let Some(value) = load_ohms {
            components.push(solver::ComponentData {
                id: "RLOAD".to_string(),
                comp_type: "resistor".to_string(),
                value,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            });
        }
        solver::CircuitNetlist {
            components,
            wires: Vec::new(),
            ..Default::default()
        }
    }

    fn one_port_settings() -> SParameterSettings {
        SParameterSettings {
            ports: vec![PortDefinition {
                name: "P1".to_string(),
                positive_node: "1".to_string(),
                negative_node: "0".to_string(),
                reference_impedance: 50.0,
            }],
            f_start: 1_000.0,
            f_end: 10_000.0,
            points_per_decade: 2,
            output_format: "ri".to_string(),
        }
    }

    #[test]
    fn matched_load_has_near_zero_reflection() {
        let result =
            extract_sparameters(&one_port_netlist(Some(50.0)), &one_port_settings()).unwrap();
        let s11 = &result.s_matrices[0][0][0];
        assert!(s11.re.abs() < 1e-9, "S11 real = {}", s11.re);
        assert!(s11.im.abs() < 1e-9, "S11 imag = {}", s11.im);
    }

    #[test]
    fn open_load_has_unit_reflection() {
        let result = extract_sparameters(&one_port_netlist(None), &one_port_settings()).unwrap();
        let s11 = &result.s_matrices[0][0][0];
        assert!((s11.re - 1.0).abs() < 1e-9, "S11 real = {}", s11.re);
        assert!(s11.im.abs() < 1e-9, "S11 imag = {}", s11.im);
    }

    #[test]
    fn pvt_adjusts_temperature_supply_and_process() {
        let netlist = solver::CircuitNetlist {
            components: vec![
                solver::ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    amplitude: Some(1.0),
                    ..Default::default()
                },
                solver::ComponentData {
                    id: "M1".to_string(),
                    comp_type: "nmos".to_string(),
                    value: 1.0,
                    pins: vec!["1".to_string(), "2".to_string(), "0".to_string()],
                    bsim_u0: Some(0.05),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let adjusted = apply_pvt_config(
            &netlist,
            &PvtConfig {
                corner: "ff".to_string(),
                temperature_c: 125.0,
                voltage_scaling: 1.1,
            },
        );

        assert!((adjusted.temperature.unwrap() - 398.15).abs() < 1e-9);
        assert!((adjusted.components[0].value - 5.5).abs() < 1e-9);
        assert!(adjusted.components[1].value < 1.0);
        assert!(adjusted.components[1].bsim_u0.unwrap() > 0.05);
    }

    #[test]
    fn pvt_settings_are_fixed_and_bounded() {
        let settings = bounded_pvt_settings(solver::TransientSettings {
            dt: 1e-9,
            t_max: 0.05,
            fixed_step: None,
            integration_method: None,
        });

        assert_eq!(settings.fixed_step, Some(true));
        assert!((settings.dt - 0.000_025).abs() < 1e-12);
        assert!(settings.t_max / settings.dt <= PVT_MAX_TIME_STEPS);
    }
}
