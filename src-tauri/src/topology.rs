use crate::solver::CircuitNetlist;
use std::collections::{HashMap, HashSet, VecDeque};

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
    // 1. Validar que todos los pines de todos los componentes sean enteros válidos
    for comp in &netlist.components {
        for (i, pin) in comp.pins.iter().enumerate() {
            if pin.parse::<usize>().is_err() {
                return Err(format!(
                    "El componente '{}' (tipo '{}') tiene un pin inválido en la posición {} ('{}'). Todos los pines deben estar conectados a nodos numéricos válidos.",
                    comp.id, comp.comp_type, i, pin
                ));
            }
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
        let ty = comp.comp_type.as_str();
        // Omitimos capacitores y directivas virtuales de inicialización
        if ty == "capacitor" || ty == "ic_directive" || ty == "nodeset_directive" {
            continue;
        }

        // Obtener los pines activos que representan conexiones físicas
        let mut active_nodes = Vec::new();
        for pin in &comp.pins {
            if let Ok(node_idx) = pin.parse::<usize>() {
                if node_idx <= n {
                    active_nodes.push(node_idx);
                }
            }
        }

        // Añadir aristas entre todos los terminales conectados de este componente en DC
        for i in 0..active_nodes.len() {
            for j in i + 1..active_nodes.len() {
                let u = active_nodes[i];
                let v = active_nodes[j];
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
                adjacency[u_node].insert(v_node);
                adjacency[v_node].insert(u_node);

                let edge = if u_node < v_node {
                    (u_node, v_node)
                } else {
                    (v_node, u_node)
                };
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
