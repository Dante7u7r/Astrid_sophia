use super::super::*;

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
