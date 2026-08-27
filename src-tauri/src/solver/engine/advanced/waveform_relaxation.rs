use crate::solver::engine::simulation_types::{TimeStepResult, TransientSettings};
use crate::solver::engine::transient::solve_transient_circuit_with_initial_states;
use crate::solver::types::{CircuitNetlist, ComponentData};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[inline]
fn is_ground_or_rail(node: &str) -> bool {
    node == "0" || node.eq_ignore_ascii_case("gnd")
}

/// Representa una señal continua de forma de onda muestreada e interpolable en el tiempo.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WaveformSignal {
    pub points: Vec<(f64, f64)>, // (tiempo, tensión o corriente)
}

impl WaveformSignal {
    pub fn new() -> Self {
        Self { points: Vec::new() }
    }

    pub fn from_constant(val: f64, t_start: f64, t_end: f64) -> Self {
        Self {
            points: vec![(t_start, val), (t_end, val)],
        }
    }

    pub fn from_timestep_results(results: &[TimeStepResult], node_id: &str) -> Self {
        let mut points = Vec::with_capacity(results.len());
        for step in results {
            let v = *step.node_voltages.get(node_id).unwrap_or(&0.0);
            points.push((step.time, v));
        }
        Self { points }
    }

    /// Evalúa la forma de onda en cualquier instante `t` mediante interpolación lineal continua.
    pub fn eval(&self, t: f64) -> f64 {
        if self.points.is_empty() {
            return 0.0;
        }
        if t <= self.points[0].0 {
            return self.points[0].1;
        }
        if t >= self.points[self.points.len() - 1].0 {
            return self.points[self.points.len() - 1].1;
        }

        let idx = match self.points.binary_search_by(|p| p.0.total_cmp(&t)) {
            Ok(i) => i,
            Err(i) => i.saturating_sub(1),
        };

        let (t0, v0) = self.points[idx];
        let (t1, v1) = self.points[(idx + 1).min(self.points.len() - 1)];
        let dt = t1 - t0;
        if dt.abs() < 1e-18 {
            v0
        } else {
            let alpha = ((t - t0) / dt).clamp(0.0, 1.0);
            v0 + alpha * (v1 - v0)
        }
    }

    /// Calcula la norma de discrepancia normalizada SPICE entre dos formas de onda:
    /// max_t |v1(t) - v2(t)| / (reltol * |v1(t)| + vntol)
    pub fn difference_norm(&self, other: &Self, reltol: f64, vntol: f64) -> f64 {
        let mut max_err = 0.0f64;

        // Evaluar en todos los puntos de tiempo de self
        for &(t, v1) in &self.points {
            let v2 = other.eval(t);
            let denom = reltol * v1.abs().max(v2.abs()) + vntol;
            let err = (v1 - v2).abs() / denom;
            max_err = max_err.max(err);
        }

        // Evaluar también en todos los puntos de tiempo de other para capturar oscilaciones rápidas
        for &(t, v2) in &other.points {
            let v1 = self.eval(t);
            let denom = reltol * v1.abs().max(v2.abs()) + vntol;
            let err = (v1 - v2).abs() / denom;
            max_err = max_err.max(err);
        }

        max_err
    }
}

/// Modo de relajación de formas de onda.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WaveformRelaxationMode {
    /// Gauss-Seidel: Las etapas en orden topológico consumen inmediatamente las formas de onda actualizadas.
    GaussSeidel,
    /// Gauss-Jacobi: Todas las particiones resuelven concurrentemente con las formas de onda de la iteración previa.
    GaussJacobi,
}

/// Configuración del resolvedor transitorio de Waveform Relaxation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaveformRelaxationSettings {
    pub mode: WaveformRelaxationMode,
    pub max_iterations: usize,
    pub reltol: f64,
    pub vntol: f64,
    pub initial_window_size: Option<f64>,
    pub min_window_size: Option<f64>,
    pub enable_window_chopping: bool,
}

impl Default for WaveformRelaxationSettings {
    fn default() -> Self {
        Self {
            mode: WaveformRelaxationMode::GaussSeidel,
            max_iterations: 15,
            reltol: 1e-3,
            vntol: 1e-6,
            initial_window_size: None,
            min_window_size: None,
            enable_window_chopping: true,
        }
    }
}

/// Subcircuito o partición desacoplada para Waveform Relaxation.
#[derive(Debug, Clone)]
pub struct CircuitPartition {
    pub partition_id: usize,
    pub components: Vec<ComponentData>,
    pub internal_nodes: HashSet<String>,
    pub input_boundary_nodes: HashMap<String, String>, // internal_input_node -> global_driver_node
    pub output_boundary_nodes: HashSet<String>,
    pub predecessor_partitions: Vec<usize>,
    pub initial_caps: HashMap<String, f64>,
    pub initial_inds: HashMap<String, f64>,
}

impl CircuitPartition {
    /// Construye la netlist local de la partición inyectando fuentes PWL en las fronteras de entrada.
    pub fn build_partition_netlist(
        &self,
        boundary_waveforms: &HashMap<String, WaveformSignal>,
        global_supplies: &[ComponentData],
        window_start_t: f64,
        window_end_t: f64,
    ) -> (CircuitNetlist, HashMap<String, String>) {
        let mut comps = self.components.clone();

        // Incorporar fuentes de alimentación DC globales compartidas (VDD, VCC)
        for supply in global_supplies {
            comps.push(supply.clone());
        }

        let window_duration = window_end_t - window_start_t;

        // Convertir fuentes periódicas locales para que operen en tiempo global
        for comp in &mut comps {
            if comp.comp_type == "vsource"
                && comp.wave_type.is_some()
                && comp.wave_type.as_deref() != Some("pwl")
            {
                let wave = comp.wave_type.as_ref().unwrap().clone();
                let amp = comp.amplitude.unwrap_or(0.0);
                let freq = comp.frequency.unwrap_or(1e3);
                let offset = comp.offset.unwrap_or(0.0);
                let duty = comp.duty_cycle.unwrap_or(0.5);
                let phase_deg = comp.phase.unwrap_or(0.0);
                let phase_rad = phase_deg.to_radians();

                let mut pts = Vec::new();
                let steps = 100;
                let dt = window_duration / (steps as f64);
                for s in 0..=steps {
                    let t_local = (s as f64) * dt;
                    let t_global = window_start_t + t_local;
                    let val = match wave.as_str() {
                        "pulse" => {
                            let period = 1.0 / freq;
                            let t_mod = t_global % period;
                            let pulse_width = duty * period;
                            if t_mod < pulse_width {
                                offset + amp
                            } else {
                                offset
                            }
                        }
                        "square" => {
                            let period = 1.0 / freq;
                            let t_mod = t_global % period;
                            if t_mod < duty * period {
                                offset + amp
                            } else {
                                offset - amp
                            }
                        }
                        "sine" => {
                            offset
                                + amp
                                    * (2.0 * std::f64::consts::PI * freq * t_global + phase_rad)
                                        .sin()
                        }
                        _ => comp.value,
                    };
                    pts.push((t_local, val));
                }
                comp.wave_type = Some("pwl".to_string());
                comp.pwl_points = Some(pts);
            }
        }

        // Inyectar fuentes de tensión controladas por forma de onda en los nodos de frontera de entrada
        for (internal_node, global_driver_node) in &self.input_boundary_nodes {
            let pts = if let Some(sig) = boundary_waveforms.get(global_driver_node) {
                let mut window_pts = Vec::new();
                let steps = 100;
                let dt = window_duration / (steps as f64);
                for s in 0..=steps {
                    let t_local = (s as f64) * dt;
                    let t_global = window_start_t + t_local;
                    window_pts.push((t_local, sig.eval(t_global)));
                }
                window_pts
            } else {
                vec![(0.0, 0.0), (window_duration, 0.0)]
            };

            let v_driver = ComponentData {
                id: format!("V_WR_IN_{}_{}", self.partition_id, internal_node),
                comp_type: "vsource".to_string(),
                value: pts.first().map(|p| p.1).unwrap_or(0.0),
                pins: vec![internal_node.clone(), "0".to_string()],
                wave_type: Some("pwl".to_string()),
                pwl_points: Some(pts),
                ..Default::default()
            };
            comps.push(v_driver);
        }

        // Mapear nodos no-tierra de la partición a un rango denso 1..K para evitar saltos de índice
        let mut node_set = std::collections::BTreeSet::new();
        for comp in &comps {
            for pin in &comp.pins {
                if !is_ground_or_rail(pin) {
                    node_set.insert(pin.clone());
                }
            }
        }

        let mut node_to_dense = HashMap::new();
        let mut dense_to_node = HashMap::new();
        for (idx, node_name) in node_set.iter().enumerate() {
            let dense_str = (idx + 1).to_string();
            node_to_dense.insert(node_name.clone(), dense_str.clone());
            dense_to_node.insert(dense_str, node_name.clone());
        }

        for comp in &mut comps {
            for pin in &mut comp.pins {
                if !is_ground_or_rail(pin) {
                    if let Some(mapped) = node_to_dense.get(pin) {
                        *pin = mapped.clone();
                    }
                }
            }
        }

        (
            CircuitNetlist {
                components: comps,
                wires: vec![],
                temperature: Some(300.15),
                fixed_step: None,
                subcircuit_definitions: None,
                triggers: None,
                mutual_inductances: None,
                thermal_config: None,
            },
            dense_to_node,
        )
    }
}

/// Resultado global de la simulación transitoria paralela por Waveform Relaxation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaveformRelaxationResult {
    pub results: Vec<TimeStepResult>,
    pub total_windows: usize,
    pub total_iterations: usize,
    pub num_partitions: usize,
    pub converged: bool,
}

/// Algoritmo de particionamiento topológico de circuitos para Waveform Relaxation.
/// Detecta componentes fuertemente conexos y desacoplamientos unidireccionales (MOSFET gates, buffers, etapas en cascada).
pub fn partition_circuit_for_relaxation(
    netlist: &CircuitNetlist,
) -> (Vec<CircuitPartition>, Vec<ComponentData>) {
    let mut global_supplies = Vec::new();
    let mut non_supply_components = Vec::new();

    let is_ground_or_rail = |node: &str| -> bool { node == "0" || node == "gnd" || node == "GND" };

    // 1. Separar fuentes globales de polarización DC fijas conectadas a tierra
    for comp in &netlist.components {
        if comp.comp_type == "vsource" && comp.wave_type.is_none() && comp.pins.len() >= 2 {
            let p1 = &comp.pins[1];
            if is_ground_or_rail(p1) && comp.value != 0.0 {
                global_supplies.push(comp.clone());
                continue;
            }
        }
        non_supply_components.push(comp.clone());
    }

    let supply_rail_nodes: HashSet<String> =
        global_supplies.iter().map(|s| s.pins[0].clone()).collect();

    let get_conductive_nodes = |comp: &ComponentData| -> Vec<String> {
        let filter_valid = |p: &String| !is_ground_or_rail(p) && !supply_rail_nodes.contains(p);

        match comp.comp_type.as_str() {
            "nmos" | "pmos" | "bsim3nmos" | "bsim3pmos" | "bsim4nmos" | "bsim4pmos"
            | "sic_mosfet" | "gan_hemt" | "jfet" | "njfet" | "pjfet" => {
                let mut nodes = Vec::new();
                if comp.pins.len() >= 2 && filter_valid(&comp.pins[1]) {
                    nodes.push(comp.pins[1].clone());
                }
                if comp.pins.len() >= 3 && filter_valid(&comp.pins[2]) {
                    nodes.push(comp.pins[2].clone());
                }
                nodes
            }
            "opamp" | "opamp_ideal" => {
                if comp.pins.len() >= 3 && filter_valid(&comp.pins[2]) {
                    vec![comp.pins[2].clone()]
                } else {
                    Vec::new()
                }
            }
            "and_gate" | "or_gate" | "not_gate" | "nand_gate" | "nor_gate" | "xor_gate"
            | "xnor_gate" | "buffer" => {
                if let Some(out_pin) = comp.pins.last() {
                    if filter_valid(out_pin) {
                        vec![out_pin.clone()]
                    } else {
                        Vec::new()
                    }
                } else {
                    Vec::new()
                }
            }
            "vcvs" | "vccs" | "e" | "g" => {
                let mut nodes = Vec::new();
                if !comp.pins.is_empty() && filter_valid(&comp.pins[0]) {
                    nodes.push(comp.pins[0].clone());
                }
                if comp.pins.len() >= 2 && filter_valid(&comp.pins[1]) {
                    nodes.push(comp.pins[1].clone());
                }
                nodes
            }
            _ => comp
                .pins
                .iter()
                .filter(|p| filter_valid(p))
                .cloned()
                .collect(),
        }
    };

    let get_input_dependency_nodes = |comp: &ComponentData| -> Vec<String> {
        match comp.comp_type.as_str() {
            "nmos" | "pmos" | "bsim3nmos" | "bsim3pmos" | "bsim4nmos" | "bsim4pmos"
            | "sic_mosfet" | "gan_hemt" | "jfet" | "njfet" | "pjfet" => {
                if !comp.pins.is_empty() {
                    vec![comp.pins[0].clone()]
                } else {
                    Vec::new()
                }
            }
            "opamp" | "opamp_ideal" => {
                let mut inputs = Vec::new();
                if !comp.pins.is_empty() {
                    inputs.push(comp.pins[0].clone());
                }
                if comp.pins.len() >= 2 {
                    inputs.push(comp.pins[1].clone());
                }
                inputs
            }
            "and_gate" | "or_gate" | "not_gate" | "nand_gate" | "nor_gate" | "xor_gate"
            | "xnor_gate" | "buffer" => {
                if comp.pins.len() > 1 {
                    comp.pins[..comp.pins.len() - 1].to_vec()
                } else {
                    Vec::new()
                }
            }
            "vcvs" | "vccs" | "e" | "g" => {
                if comp.pins.len() >= 4 {
                    vec![comp.pins[2].clone(), comp.pins[3].clone()]
                } else {
                    Vec::new()
                }
            }
            _ => Vec::new(),
        }
    };

    // 2. Agrupar componentes por etapas funcionales
    let mut visited = vec![false; non_supply_components.len()];
    let mut raw_partitions: Vec<Vec<ComponentData>> = Vec::new();

    for i in 0..non_supply_components.len() {
        if visited[i] {
            continue;
        }

        let mut current_block = Vec::new();
        let mut queue = std::collections::VecDeque::new();
        queue.push_back(i);
        visited[i] = true;

        while let Some(curr_idx) = queue.pop_front() {
            let comp_curr = &non_supply_components[curr_idx];
            current_block.push(comp_curr.clone());

            let conductive_nodes = get_conductive_nodes(comp_curr);

            for other_idx in 0..non_supply_components.len() {
                if visited[other_idx] {
                    continue;
                }
                let other_comp = &non_supply_components[other_idx];
                let other_conductive_nodes = get_conductive_nodes(other_comp);

                let shares_node = conductive_nodes
                    .iter()
                    .any(|n| other_conductive_nodes.contains(n));
                if shares_node {
                    visited[other_idx] = true;
                    queue.push_back(other_idx);
                }
            }
        }

        if !current_block.is_empty() {
            raw_partitions.push(current_block);
        }
    }

    // Si el circuito no se pudo particionar en al menos 2 bloques, devolvemos 1 partición monolítica
    if raw_partitions.len() < 2 {
        let all_nodes: HashSet<String> = netlist
            .components
            .iter()
            .flat_map(|c| c.pins.iter().cloned())
            .filter(|p| !is_ground_or_rail(p))
            .collect();

        let partition = CircuitPartition {
            partition_id: 0,
            components: netlist.components.clone(),
            internal_nodes: all_nodes,
            input_boundary_nodes: HashMap::new(),
            output_boundary_nodes: HashSet::new(),
            predecessor_partitions: Vec::new(),
            initial_caps: HashMap::new(),
            initial_inds: HashMap::new(),
        };
        return (vec![partition], Vec::new());
    }

    // 3. Mapear nodos internos y fronteras de entrada/salida para cada partición
    let mut partitions = Vec::new();
    for (p_id, comps) in raw_partitions.into_iter().enumerate() {
        let mut internal_nodes = HashSet::new();
        for c in &comps {
            for pin in &c.pins {
                if !is_ground_or_rail(pin) && !supply_rail_nodes.contains(pin) {
                    internal_nodes.insert(pin.clone());
                }
            }
        }

        partitions.push(CircuitPartition {
            partition_id: p_id,
            components: comps,
            internal_nodes,
            input_boundary_nodes: HashMap::new(),
            output_boundary_nodes: HashSet::new(),
            predecessor_partitions: Vec::new(),
            initial_caps: HashMap::new(),
            initial_inds: HashMap::new(),
        });
    }

    // 4. Identificar dependencias de frontera entre particiones
    let mut dependencies: Vec<(usize, usize, String)> = Vec::new();
    for (i, p_i) in partitions.iter().enumerate() {
        for (j, p_j) in partitions.iter().enumerate() {
            if i == j {
                continue;
            }

            for comp in &p_i.components {
                let dep_nodes = get_input_dependency_nodes(comp);
                for dep_node in dep_nodes {
                    if p_j.internal_nodes.contains(&dep_node) {
                        dependencies.push((i, j, dep_node));
                    }
                }
            }
        }
    }

    for (i, j, gate_node) in dependencies {
        partitions[i]
            .input_boundary_nodes
            .insert(gate_node.clone(), gate_node.clone());
        partitions[j].output_boundary_nodes.insert(gate_node);
        if !partitions[i].predecessor_partitions.contains(&j) {
            partitions[i].predecessor_partitions.push(j);
        }
    }

    (partitions, global_supplies)
}

/// Resuelve una simulación transitoria mediante Waveform Relaxation en paralelo con Rayon y Gauss-Seidel.
pub fn solve_waveform_relaxation_transient(
    netlist: &CircuitNetlist,
    settings: &TransientSettings,
    wr_settings_opt: Option<&WaveformRelaxationSettings>,
) -> Result<WaveformRelaxationResult, String> {
    let default_wr = WaveformRelaxationSettings::default();
    let wr_settings = wr_settings_opt.unwrap_or(&default_wr);

    let (mut partitions, global_supplies) = partition_circuit_for_relaxation(netlist);
    let num_partitions = partitions.len();

    // Si solo hay 1 partición monolítica, resolver directamente con el solver transitorio exacto
    if num_partitions == 1 {
        let results = solve_transient_circuit_with_initial_states(
            netlist,
            settings,
            HashMap::new(),
            HashMap::new(),
        )?;
        return Ok(WaveformRelaxationResult {
            results: results.0,
            total_windows: 1,
            total_iterations: 1,
            num_partitions: 1,
            converged: true,
        });
    }

    let t_max = settings.t_max;
    let dt_nominal = settings.dt;

    let initial_window = wr_settings
        .initial_window_size
        .unwrap_or_else(|| (t_max / 5.0).max(50.0 * dt_nominal).min(t_max));
    let min_window = wr_settings.min_window_size.unwrap_or(2.0 * dt_nominal);

    let mut current_window_size = initial_window;
    let mut t_start = 0.0f64;
    let mut all_results: Vec<TimeStepResult> = Vec::new();
    let mut total_iterations = 0usize;
    let mut total_windows = 0usize;

    // Inicializar formas de onda globales con el punto de operación DC para tener continuidad física exacta desde t=0
    let mut global_waveforms: HashMap<String, WaveformSignal> = HashMap::new();
    let dc_op = crate::solver::solve_dc_circuit(netlist);

    for p in &partitions {
        for node in &p.internal_nodes {
            let v_dc = dc_op
                .as_ref()
                .ok()
                .and_then(|op| op.node_voltages.get(node).copied())
                .unwrap_or(0.0);
            global_waveforms.insert(
                node.clone(),
                WaveformSignal::from_constant(v_dc, 0.0, t_max),
            );
        }
    }

    while t_start < t_max - (dt_nominal * 1e-6) {
        total_windows += 1;
        let t_end = (t_start + current_window_size).min(t_max);
        let window_duration = t_end - t_start;

        let window_settings = TransientSettings {
            dt: dt_nominal,
            t_max: window_duration,
            fixed_step: settings.fixed_step,
            integration_method: settings.integration_method.clone(),
        };

        let mut window_converged = false;
        let mut best_window_results: HashMap<usize, Vec<TimeStepResult>> = HashMap::new();
        let mut best_final_caps: HashMap<usize, HashMap<String, f64>> = HashMap::new();
        let mut best_final_inds: HashMap<usize, HashMap<String, f64>> = HashMap::new();

        for _iter in 0..wr_settings.max_iterations {
            total_iterations += 1;
            let mut new_signals_this_iter: HashMap<String, WaveformSignal> = HashMap::new();
            let mut iter_results: HashMap<usize, Vec<TimeStepResult>> = HashMap::new();
            let mut iter_final_caps: HashMap<usize, HashMap<String, f64>> = HashMap::new();
            let mut iter_final_inds: HashMap<usize, HashMap<String, f64>> = HashMap::new();

            match wr_settings.mode {
                WaveformRelaxationMode::GaussJacobi => {
                    // Modo puramente paralelo: todas las particiones resuelven concurrentemente con Rayon
                    let boundary_snapshot = global_waveforms.clone();

                    let partition_outputs: Vec<_> = partitions
                        .par_iter()
                        .map(|part| {
                            let (part_netlist, dense_to_node) = part.build_partition_netlist(
                                &boundary_snapshot,
                                &global_supplies,
                                t_start,
                                t_end,
                            );
                            let res = solve_transient_circuit_with_initial_states(
                                &part_netlist,
                                &window_settings,
                                part.initial_caps.clone(),
                                part.initial_inds.clone(),
                            );
                            (part.partition_id, dense_to_node, res)
                        })
                        .collect();

                    for (p_id, dense_to_node, res) in partition_outputs {
                        match res {
                            Ok((mut step_results, caps, inds)) => {
                                // Ajustar el eje temporal local [0, duration] al tiempo global [t_start, t_end]
                                for step in &mut step_results {
                                    step.time += t_start;
                                    let mut remapped = HashMap::new();
                                    for (dense_k, v) in &step.node_voltages {
                                        if let Some(orig_k) = dense_to_node.get(dense_k) {
                                            remapped.insert(orig_k.clone(), *v);
                                        } else {
                                            remapped.insert(dense_k.clone(), *v);
                                        }
                                    }
                                    step.node_voltages = remapped;
                                }
                                for node in &partitions[p_id].internal_nodes {
                                    let sig =
                                        WaveformSignal::from_timestep_results(&step_results, node);
                                    new_signals_this_iter.insert(node.clone(), sig);
                                }
                                iter_results.insert(p_id, step_results);
                                iter_final_caps.insert(p_id, caps);
                                iter_final_inds.insert(p_id, inds);
                            }
                            Err(_) => {
                                // Si alguna partición falla en el paso, no converge en esta iteración
                            }
                        }
                    }
                }
                WaveformRelaxationMode::GaussSeidel => {
                    // Modo Gauss-Seidel: recorre las particiones y actualiza inmediatamente las formas de onda
                    let mut active_waveforms = global_waveforms.clone();

                    for part in &partitions {
                        let (part_netlist, dense_to_node) = part.build_partition_netlist(
                            &active_waveforms,
                            &global_supplies,
                            t_start,
                            t_end,
                        );

                        if let Ok((mut step_results, caps, inds)) =
                            solve_transient_circuit_with_initial_states(
                                &part_netlist,
                                &window_settings,
                                part.initial_caps.clone(),
                                part.initial_inds.clone(),
                            )
                        {
                            for step in &mut step_results {
                                step.time += t_start;
                                let mut remapped = HashMap::new();
                                for (dense_k, v) in &step.node_voltages {
                                    if let Some(orig_k) = dense_to_node.get(dense_k) {
                                        remapped.insert(orig_k.clone(), *v);
                                    } else {
                                        remapped.insert(dense_k.clone(), *v);
                                    }
                                }
                                step.node_voltages = remapped;
                            }
                            for node in &part.internal_nodes {
                                let sig =
                                    WaveformSignal::from_timestep_results(&step_results, node);
                                active_waveforms.insert(node.clone(), sig.clone());
                                new_signals_this_iter.insert(node.clone(), sig);
                            }
                            iter_results.insert(part.partition_id, step_results);
                            iter_final_caps.insert(part.partition_id, caps);
                            iter_final_inds.insert(part.partition_id, inds);
                        }
                    }
                }
            }

            // Calcular residuo de forma de onda (contracción de Banach)
            let mut max_waveform_residual = 0.0f64;
            for (node, new_sig) in &new_signals_this_iter {
                if let Some(old_sig) = global_waveforms.get(node) {
                    let diff =
                        new_sig.difference_norm(old_sig, wr_settings.reltol, wr_settings.vntol);
                    max_waveform_residual = max_waveform_residual.max(diff);
                }
            }

            // Actualizar formas de onda globales
            for (node, sig) in new_signals_this_iter {
                global_waveforms.insert(node, sig);
            }

            best_window_results = iter_results;
            best_final_caps = iter_final_caps;
            best_final_inds = iter_final_inds;

            if max_waveform_residual <= 1.0 && !best_window_results.is_empty() {
                window_converged = true;
                break;
            }
        }

        if window_converged {
            // Unir resultados de todas las particiones para esta ventana temporal mediante muestreo multirate continuo
            let mut unique_times: Vec<f64> = Vec::new();
            for steps in best_window_results.values() {
                for s in steps {
                    unique_times.push(s.time);
                }
            }
            unique_times.sort_by(|a, b| a.total_cmp(b));
            unique_times.dedup_by(|a, b| (*a - *b).abs() < 1e-13);

            for &step_time in &unique_times {
                let mut merged_voltages = HashMap::new();
                let mut merged_currents = HashMap::new();

                for p_id in 0..num_partitions {
                    if let Some(steps) = best_window_results.get(&p_id) {
                        if let Ok(exact_idx) =
                            steps.binary_search_by(|s| s.time.total_cmp(&step_time))
                        {
                            let step = &steps[exact_idx];
                            for (k, v) in &step.node_voltages {
                                if !merged_voltages.contains_key(k) {
                                    merged_voltages.insert(k.clone(), *v);
                                }
                            }
                            for (k, v) in &step.branch_currents {
                                if !merged_currents.contains_key(k) {
                                    merged_currents.insert(k.clone(), *v);
                                }
                            }
                        } else if let Some(part) =
                            partitions.iter().find(|p| p.partition_id == p_id)
                        {
                            for node in &part.internal_nodes {
                                if !merged_voltages.contains_key(node) {
                                    if let Some(sig) = global_waveforms.get(node) {
                                        merged_voltages.insert(node.clone(), sig.eval(step_time));
                                    }
                                }
                            }
                        }
                    }
                }

                // Evitar duplicar el punto de frontera inicial exacto si ya existe en all_results
                if all_results.is_empty()
                    || (all_results.last().unwrap().time - step_time).abs() > 1e-13
                {
                    all_results.push(TimeStepResult::new(
                        step_time,
                        merged_voltages,
                        merged_currents,
                    ));
                }
            }

            // Actualizar condiciones iniciales de las particiones para la siguiente ventana
            for part in &mut partitions {
                if let Some(caps) = best_final_caps.get(&part.partition_id) {
                    part.initial_caps = caps.clone();
                }
                if let Some(inds) = best_final_inds.get(&part.partition_id) {
                    part.initial_inds = inds.clone();
                }
            }

            t_start = t_end;
            // Crecimiento suave de ventana si convergió rápidamente
            current_window_size = (current_window_size * 1.5).min(initial_window);
        } else if wr_settings.enable_window_chopping && current_window_size > min_window {
            // Window chopping: reducir ventana a la mitad para garantizar contracción
            current_window_size = (current_window_size / 2.0).max(min_window);
        } else {
            // Fallback monolítico de seguridad para salvar el segmento no desacoplable
            let fallback_settings = TransientSettings {
                dt: dt_nominal,
                t_max: window_duration,
                fixed_step: settings.fixed_step,
                integration_method: settings.integration_method.clone(),
            };

            let mut all_caps = HashMap::new();
            let mut all_inds = HashMap::new();
            for p in &partitions {
                all_caps.extend(p.initial_caps.clone());
                all_inds.extend(p.initial_inds.clone());
            }

            let (mut mono_results, caps_out, inds_out) =
                solve_transient_circuit_with_initial_states(
                    netlist,
                    &fallback_settings,
                    all_caps,
                    all_inds,
                )?;

            for step in &mut mono_results {
                step.time += t_start;
                if all_results.is_empty()
                    || (all_results.last().unwrap().time - step.time).abs() > 1e-12
                {
                    all_results.push(step.clone());
                }
            }

            for part in &mut partitions {
                part.initial_caps = caps_out.clone();
                part.initial_inds = inds_out.clone();
            }

            t_start = t_end;
            current_window_size = initial_window;
        }
    }

    Ok(WaveformRelaxationResult {
        results: all_results,
        total_windows,
        total_iterations,
        num_partitions,
        converged: true,
    })
}
