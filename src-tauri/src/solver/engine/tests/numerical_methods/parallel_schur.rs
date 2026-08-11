use super::super::*;

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
