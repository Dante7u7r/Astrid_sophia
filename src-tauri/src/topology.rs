use crate::solver::CircuitNetlist;
use std::collections::{HashMap, HashSet, VecDeque};

pub const MAX_NETLIST_COMPONENTS: usize = 10_000;
pub const MAX_NETLIST_NODES: usize = 5_000;
const MAX_COMPONENT_ID_LEN: usize = 128;
const MAX_COMPONENT_PINS: usize = 64;

fn expected_pin_range(comp_type: &str) -> Option<(usize, usize)> {
    match comp_type {
        "ground" => Some((1, 1)),
        "resistor" | "capacitor" | "inductor" | "diode" | "led" | "vsource" | "isource"
        | "bvoltage" | "bcurrent" | "switch" | "cccs" | "ccvs" => Some((2, 2)),
        "nmos" | "pmos" | "bsim3nmos" | "bsim3pmos" | "bsim4nmos" | "bsim4pmos" => Some((3, 4)),
        "npn" | "pnp" | "njf" | "pjf" => Some((3, 3)),
        "vcvs" | "vccs" | "opto" => Some((4, 4)),
        "opamp" => Some((5, 5)),
        "opamp_ideal" => Some((3, 5)),
        "not_gate" => Some((2, 2)),
        "and_gate" | "or_gate" | "nand_gate" | "nor_gate" | "xor_gate" => Some((3, 3)),
        "arduino_uno" | "esp32" | "raspberry_pi_pico" => Some((6, 6)),
        "verilog_a" => Some((3, MAX_COMPONENT_PINS)),
        "ic_directive" | "nodeset_directive" => Some((1, MAX_COMPONENT_PINS)),
        _ => None,
    }
}

fn validate_component_contracts(netlist: &CircuitNetlist) -> Result<(), String> {
    if netlist.components.len() > MAX_NETLIST_COMPONENTS {
        return Err(format!(
            "El circuito excede el limite de {MAX_NETLIST_COMPONENTS} componentes."
        ));
    }

    let mut ids = HashSet::new();
    for comp in &netlist.components {
        if comp.id.trim().is_empty() || comp.id.len() > MAX_COMPONENT_ID_LEN {
            return Err(format!(
                "El componente de tipo '{}' tiene un identificador vacio o mayor de {MAX_COMPONENT_ID_LEN} caracteres.",
                comp.comp_type
            ));
        }
        if !ids.insert(comp.id.as_str()) {
            return Err(format!(
                "Identificador de componente duplicado: '{}'.",
                comp.id
            ));
        }

        let (min_pins, max_pins) = expected_pin_range(&comp.comp_type).ok_or_else(|| {
            if matches!(comp.comp_type.as_str(), "mcu_8051" | "mcu_avr") {
                format!(
                    "El componente '{}' usa el runtime MCU temporal, que no ejecuta firmware y no es aceptado por el solver Rust.",
                    comp.id
                )
            } else {
                format!(
                    "Tipo de componente no soportado por el solver Rust: '{}' en '{}'.",
                    comp.comp_type, comp.id
                )
            }
        })?;
        if comp.pins.len() < min_pins || comp.pins.len() > max_pins {
            return Err(format!(
                "El componente '{}' (tipo '{}') tiene {} pines; se esperaban entre {} y {}.",
                comp.id,
                comp.comp_type,
                comp.pins.len(),
                min_pins,
                max_pins
            ));
        }
        if !comp.value.is_finite() {
            return Err(format!(
                "El componente '{}' tiene un valor electrico no finito.",
                comp.id
            ));
        }
    }

    if let Some(temperature) = netlist.temperature {
        if !temperature.is_finite() || temperature <= 0.0 {
            return Err("La temperatura del netlist debe ser finita y mayor que 0 K.".to_string());
        }
    }
    Ok(())
}

/// Índice máximo de nodo activo (excluye Tierra "0").
pub fn max_node_index(netlist: &CircuitNetlist) -> usize {
    let mut max_node = 0usize;
    for comp in &netlist.components {
        for pin in &comp.pins {
            if let Ok(node_idx) = pin.parse::<usize>() {
                max_node = max_node.max(node_idx);
            }
        }
    }
    max_node
}

/// Validación topológica previa a simulación (mensajes accionables en español).
/// `strict_floating`: si es true, rechaza nodos sin ruta DC a Tierra.
pub fn validate_netlist_topology(
    netlist: &CircuitNetlist,
    strict_floating: bool,
) -> Result<usize, String> {
    validate_component_contracts(netlist)?;

    // 1. Validar que todos los pines de todos los componentes sean enteros válidos
    for comp in &netlist.components {
        for (i, pin) in comp.pins.iter().enumerate() {
            let node_idx = pin.parse::<usize>().map_err(|_| {
                format!(
                    "El componente '{}' (tipo '{}') tiene un pin invalido en la posicion {} ('{}'). Todos los pines deben estar conectados a nodos numericos validos.",
                    comp.id, comp.comp_type, i, pin
                )
            })?;
            if node_idx > MAX_NETLIST_NODES {
                return Err(format!(
                    "El componente '{}' referencia el nodo {}, por encima del limite de {} nodos.",
                    comp.id, node_idx, MAX_NETLIST_NODES
                ));
            }
        }
        if comp.comp_type == "ground" && comp.pins[0] != "0" {
            return Err(format!(
                "El componente de Tierra '{}' debe estar conectado al nodo 0.",
                comp.id
            ));
        }
    }

    let n = max_node_index(netlist);

    if netlist.components.is_empty() {
        return Err("El circuito no contiene componentes.".to_string());
    }

    let has_gnd = netlist.components.iter().any(|c| c.comp_type == "ground")
        || netlist
            .components
            .iter()
            .flat_map(|c| c.pins.iter())
            .any(|p| p == "0");
    if !has_gnd {
        return Err(
            "Referencia a Tierra ausente (GND): agregue al menos un componente GND al esquema."
                .to_string(),
        );
    }

    detect_ideal_voltage_loops(netlist, n)?;

    if strict_floating {
        let floating = find_floating_nodes(netlist, n);
        if !floating.is_empty() {
            let nodes: Vec<String> = floating.iter().map(|i| i.to_string()).collect();
            return Err(format!(
                "Nodos flotantes (sin ruta DC a Tierra): {}. Conecte cada subred a GND o revise cables sueltos.",
                nodes.join(", ")
            ));
        }
    }

    Ok(n)
}

/// Diagnóstica la red mediante teoría de grafos para identificar nodos
/// que carecen de una ruta DC hacia la referencia de Tierra (nodos flotantes).
/// Omitimos capacitores ya que actúan como circuitos abiertos en DC.
pub fn find_floating_nodes(netlist: &CircuitNetlist, n: usize) -> HashSet<usize> {
    let mut adjacency = vec![HashSet::new(); n + 1];

    for comp in &netlist.components {
        for (pin_a, pin_b) in dc_conduction_pin_pairs(comp.comp_type.as_str(), comp.pins.len()) {
            let Some(u) = comp
                .pins
                .get(pin_a)
                .and_then(|pin| pin.parse::<usize>().ok())
            else {
                continue;
            };
            let v = if pin_b == usize::MAX {
                0
            } else {
                let Some(node) = comp
                    .pins
                    .get(pin_b)
                    .and_then(|pin| pin.parse::<usize>().ok())
                else {
                    continue;
                };
                node
            };
            if u <= n && v <= n {
                adjacency[u].insert(v);
                adjacency[v].insert(u);
            }
        }
    }

    // BFS partiendo de Tierra (nodo 0) para encontrar la componente conexa principal
    let mut visited = HashSet::new();
    let mut queue = VecDeque::new();

    visited.insert(0);
    queue.push_back(0);

    while let Some(u) = queue.pop_front() {
        for &v in &adjacency[u] {
            if !visited.contains(&v) {
                visited.insert(v);
                queue.push_back(v);
            }
        }
    }

    // Coleccionar todos los nodos activos de 1 a n que no fueron visitados (flotantes)
    let mut floating = HashSet::new();
    for i in 1..=n {
        if !visited.contains(&i) {
            // Verificar si el nodo tiene al menos una conexión resistiva o de componente.
            // Si el nodo está en el netlist pero está completamente huérfano, también es flotante.
            floating.insert(i);
        }
    }

    floating
}

fn dc_conduction_pin_pairs(comp_type: &str, pin_count: usize) -> Vec<(usize, usize)> {
    match comp_type {
        "resistor" | "inductor" | "diode" | "led" | "vsource" | "bvoltage" | "switch" | "ccvs"
        | "vcvs" => vec![(0, 1)],
        "nmos" | "pmos" | "bsim3nmos" | "bsim3pmos" | "bsim4nmos" | "bsim4pmos" | "verilog_a" => {
            vec![(1, 2)]
        }
        "npn" | "pnp" | "njf" | "pjf" => vec![(0, 1), (0, 2), (1, 2)],
        "opto" => vec![(0, 1), (2, 3)],
        "opamp" | "opamp_ideal" => {
            if pin_count == 3 {
                vec![(0, 1), (2, usize::MAX)]
            } else {
                vec![(0, 1), (4, usize::MAX)]
            }
        }
        "not_gate" => vec![(1, usize::MAX)],
        "and_gate" | "or_gate" | "nand_gate" | "nor_gate" | "xor_gate" => {
            vec![(2, usize::MAX)]
        }
        "arduino_uno" | "esp32" | "raspberry_pi_pico" => (0..pin_count.saturating_sub(1))
            .map(|pin| (pin, pin_count - 1))
            .collect(),
        _ => Vec::new(),
    }
}

/// Detecta ciclos (lazos) cerrados formados exclusivamente por fuentes de voltaje ideales
/// (vsource, vcvs, ccvs), lo cual generaría una matriz MNA singular debido a
/// restricciones incompatibles según la Ley de Voltajes de Kirchhoff.
pub fn detect_ideal_voltage_loops(netlist: &CircuitNetlist, n: usize) -> Result<(), String> {
    let mut adjacency = vec![HashSet::new(); n + 1];
    let mut edge_sources = HashMap::new();

    // Coleccionar aristas que sean fuentes de voltaje ideales
    for comp in &netlist.components {
        let ty = comp.comp_type.as_str();
        if (ty == "vsource" || ty == "vcvs" || ty == "ccvs") && comp.pins.len() >= 2 {
            if let (Ok(u), Ok(v)) = (comp.pins[0].parse::<usize>(), comp.pins[1].parse::<usize>()) {
                let u_node = if u > n { 0 } else { u };
                let v_node = if v > n { 0 } else { v };
                let edge = if u_node < v_node {
                    (u_node, v_node)
                } else {
                    (v_node, u_node)
                };
                if let Some(previous) = edge_sources.get(&edge) {
                    return Err(format!(
                        "Fuentes de voltaje ideales en paralelo detectadas: '{}' y '{}'. La matriz MNA es singular.",
                        previous, comp.id
                    ));
                }
                adjacency[u_node].insert(v_node);
                adjacency[v_node].insert(u_node);

                edge_sources.insert(edge, comp.id.clone());
            }
        }
    }

    // Buscar ciclos simples en el grafo de fuentes usando búsqueda con retroceso (DFS)
    let mut visited = HashSet::new();
    let mut parent = HashMap::new();

    for start_node in 0..=n {
        if visited.contains(&start_node) {
            continue;
        }

        let mut stack = VecDeque::new();
        stack.push_back((start_node, None));

        while let Some((curr, prev)) = stack.pop_back() {
            visited.insert(curr);
            if let Some(p) = prev {
                parent.insert(curr, p);
            }

            for &neighbor in &adjacency[curr] {
                if Some(neighbor) == prev {
                    continue;
                }
                if visited.contains(&neighbor) {
                    // Detectado un ciclo de fuentes!
                    // Reconstruir la ruta del lazo para el diagnóstico
                    let mut loop_sources = Vec::new();
                    let mut temp = curr;
                    while temp != neighbor {
                        if let Some(&p) = parent.get(&temp) {
                            let edge = if p < temp { (p, temp) } else { (temp, p) };
                            if let Some(src_id) = edge_sources.get(&edge) {
                                loop_sources.push(src_id.clone());
                            }
                            temp = p;
                        } else {
                            break;
                        }
                    }
                    let final_edge = if temp < neighbor {
                        (temp, neighbor)
                    } else {
                        (neighbor, temp)
                    };
                    if let Some(src_id) = edge_sources.get(&final_edge) {
                        loop_sources.push(src_id.clone());
                    }

                    return Err(format!(
                        "Lazo ideal de fuentes detectado: {}. Esto viola la Ley de Voltajes de Kirchhoff (KVL) y genera una matriz singular.",
                        loop_sources.join(" // ")
                    ));
                } else {
                    stack.push_back((neighbor, Some(curr)));
                }
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::solver::{CircuitNetlist, ComponentData};

    fn component(id: &str, comp_type: &str, pins: &[&str]) -> ComponentData {
        ComponentData {
            id: id.to_string(),
            comp_type: comp_type.to_string(),
            value: 1.0,
            pins: pins.iter().map(|pin| pin.to_string()).collect(),
            ..Default::default()
        }
    }

    #[test]
    fn rejects_unknown_types_and_invalid_pin_counts_before_stamping() {
        let unknown = CircuitNetlist {
            components: vec![component("X1", "mystery", &["1", "0"])],
            ..Default::default()
        };
        assert!(validate_netlist_topology(&unknown, false)
            .unwrap_err()
            .contains("no soportado"));

        let malformed = CircuitNetlist {
            components: vec![component("R1", "resistor", &["0"])],
            ..Default::default()
        };
        assert!(validate_netlist_topology(&malformed, false)
            .unwrap_err()
            .contains("se esperaban"));
    }

    #[test]
    fn current_source_does_not_create_a_dc_path_to_ground() {
        let netlist = CircuitNetlist {
            components: vec![
                component("I1", "isource", &["1", "0"]),
                component("GND", "ground", &["0"]),
            ],
            ..Default::default()
        };
        assert_eq!(find_floating_nodes(&netlist, 1), HashSet::from([1]));
    }

    #[test]
    fn mos_gate_is_not_shortened_topologically_to_channel() {
        let netlist = CircuitNetlist {
            components: vec![
                component("M1", "nmos", &["1", "2", "0"]),
                component("R1", "resistor", &["2", "0"]),
                component("GND", "ground", &["0"]),
            ],
            ..Default::default()
        };
        assert_eq!(find_floating_nodes(&netlist, 2), HashSet::from([1]));
    }

    #[test]
    fn parallel_voltage_sources_are_rejected() {
        let netlist = CircuitNetlist {
            components: vec![
                component("V1", "vsource", &["1", "0"]),
                component("V2", "vsource", &["1", "0"]),
            ],
            ..Default::default()
        };
        let error = detect_ideal_voltage_loops(&netlist, 1).unwrap_err();
        assert!(error.contains("paralelo"));
    }

    #[test]
    fn public_analysis_entrypoints_reject_malformed_nodes_without_panicking() {
        let malformed = CircuitNetlist {
            components: vec![
                component("R1", "resistor", &["no-es-un-nodo", "0"]),
                component("GND", "ground", &["0"]),
            ],
            ..Default::default()
        };

        let dc = std::panic::catch_unwind(|| crate::solver::solve_dc_circuit(&malformed));
        assert!(dc.is_ok() && dc.unwrap().is_err());

        let ac = std::panic::catch_unwind(|| {
            crate::solver::solve_ac_sweep(
                &malformed,
                &crate::solver::AcSweepSettings {
                    f_start: 10.0,
                    f_end: 1_000.0,
                    points_per_decade: 10,
                    op_guess: None,
                },
            )
        });
        assert!(ac.is_ok() && ac.unwrap().is_err());

        let transient = std::panic::catch_unwind(|| {
            crate::solver::solve_transient_circuit(
                &malformed,
                &crate::solver::TransientSettings {
                    dt: 1e-6,
                    t_max: 1e-3,
                    fixed_step: Some(true),
                    integration_method: Some("euler".to_string()),
                },
            )
        });
        assert!(transient.is_ok() && transient.unwrap().is_err());

        let pss = std::panic::catch_unwind(|| {
            crate::solver::solve_pss(
                &malformed,
                &crate::solver::PssSettings {
                    period: 1e-3,
                    max_shooting_iters: 5,
                    shooting_tolerance: 1e-4,
                },
            )
        });
        assert!(pss.is_ok() && pss.unwrap().is_err());

        let stability =
            std::panic::catch_unwind(|| crate::solver::run_stability_analysis(&malformed));
        assert!(stability.is_ok() && stability.unwrap().is_err());
    }
}
