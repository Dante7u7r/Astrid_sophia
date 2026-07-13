use super::super::*;

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
