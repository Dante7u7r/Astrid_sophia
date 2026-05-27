// Example: Highly optimized, reference MNA Solver in Rust using `nalgebra`
// Location: C:\Users\maruc\Desktop\Astryd_Sophia_Skills\rust-math-performance\examples\mna_solver.rs

use nalgebra::{DMatrix, DVector};
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub enum Component {
    Resistor { id: String, node_a: usize, node_b: usize, resistance: f64 },
    VoltageSource { id: String, node_pos: usize, node_neg: usize, voltage: f64 },
}

pub struct Netlist {
    pub num_nodes: usize, // Excludes Ground (node 0)
    pub components: Vec<Component>,
}

pub struct SimulationResult {
    pub node_voltages: Vec<f64>,        // Index matches node number (0 is ground, always 0.0V)
    pub source_currents: HashMap<String, f64>, // Current flowing through voltage sources
}

pub fn solve_dc_circuit(netlist: &Netlist) -> Result<SimulationResult, String> {
    // 1. Identify dimensions of the MNA system:
    // N: number of active nodes (excluding Node 0 - Ground)
    // M: number of independent voltage sources
    let n = netlist.num_nodes;
    let mut m = 0;
    let mut vsource_map = HashMap::new();

    for comp in &netlist.components {
        if let Component::VoltageSource { id, .. } = comp {
            vsource_map.insert(id.clone(), m);
            m += 1;
        }
    }

    let size = n + m;
    if size == 0 {
        return Err("Circuit has no nodes or components to solve".to_string());
    }

    // 2. Initialize matrix A (size x size) and vector z (size) with zeros
    // A represents conductance and connections, z represents independent sources
    let mut matrix_a = DMatrix::<f64>::zeros(size, size);
    let mut vector_z = DVector::<f64>::zeros(size);

    // Helper closure to stamp conductance between two nodes
    // Nodes are 1-indexed. Node 0 is Ground, and it is excluded from matrix equations.
    let mut stamp_conductance = |row_node: usize, col_node: usize, conductance: f64| {
        if row_node > 0 && col_node > 0 {
            matrix_a[(row_node - 1, col_node - 1)] += conductance;
        }
    };

    // Helper closure to stamp voltage source connections
    let mut stamp_voltage_branch = |vsource_idx: usize, node_pos: usize, node_neg: usize, voltage: f64| {
        let col = n + vsource_idx;
        // Positive node connection (+1 stamp on positive row, +1 on voltage column)
        if node_pos > 0 {
            matrix_a[(node_pos - 1, col)] += 1.0;
            matrix_a[(col, node_pos - 1)] += 1.0;
        }
        // Negative node connection (-1 stamp on negative row, -1 on voltage column)
        if node_neg > 0 {
            matrix_a[(node_neg - 1, col)] -= 1.0;
            matrix_a[(col, node_neg - 1)] -= 1.0;
        }
        // Set the voltage value in independent source vector z
        vector_z[col] = voltage;
    };

    // 3. Stamp all components into the MNA structures
    for comp in &netlist.components {
        match comp {
            Component::Resistor { node_a, node_b, resistance, .. } => {
                if *resistance <= 1e-12 {
                    return Err("Resistance cannot be zero or near-zero".to_string());
                }
                let conductance = 1.0 / *resistance;
                // Diagonal stamps (mutual node self-conductance)
                stamp_conductance(*node_a, *node_a, conductance);
                stamp_conductance(*node_b, *node_b, conductance);
                // Off-diagonal stamps (cross-conductance between nodes)
                stamp_conductance(*node_a, *node_b, -conductance);
                stamp_conductance(*node_b, *node_a, -conductance);
            }
            Component::VoltageSource { id, node_pos, node_neg, voltage } => {
                let vsource_idx = *vsource_map.get(id).unwrap();
                stamp_voltage_branch(vsource_idx, *node_pos, *node_neg, *voltage);
            }
        }
    }

    // 4. Solve the linear system A * x = z
    // Check if the matrix is singular (determinant = 0 or non-invertible)
    let decomp = matrix_a.clone().lu();
    let solution_vector = decomp.solve(&vector_z)
        .ok_or_else(|| "Failed to solve circuit. Matrix A is singular. Check for floating nodes or shorted loops.".to_string())?;

    // 5. Unpack the results
    // Node voltages (1-indexed nodes correspond to elements [0..n-1] in solution)
    let mut node_voltages = vec![0.0; n + 1]; // Node 0 is Ground, index 0 remains 0.0V
    for i in 1..=n {
        node_voltages[i] = solution_vector[i - 1];
    }

    // Independent voltage source currents (flow from POSITIVE to NEGATIVE terminal internally)
    let mut source_currents = HashMap::new();
    for (id, &idx) in &vsource_map {
        let current = solution_vector[n + idx];
        source_currents.insert(id.clone(), current);
    }

    Ok(SimulationResult {
        node_voltages,
        source_currents,
    })
}
