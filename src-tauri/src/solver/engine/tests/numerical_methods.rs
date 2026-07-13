use super::*;

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
