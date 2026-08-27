#[allow(unused_imports)]
use super::devices::*;
#[allow(unused_imports)]
use super::expressions::*;
#[allow(unused_imports)]
use super::lexer::*;
#[allow(unused_imports)]
use super::subcircuits::*;

#[cfg(test)]
mod parser_tests {
    use super::*;

    #[test]
    fn test_spice_value_parser() {
        assert_eq!(parse_spice_value("10k").unwrap(), 10000.0);
        assert_eq!(parse_spice_value("1.5Meg").unwrap(), 1.5e6);
        assert_eq!(parse_spice_value("2.2u").unwrap(), 2.2e-6);
        assert_eq!(parse_spice_value("100").unwrap(), 100.0);
        assert_eq!(parse_spice_value("10nF").unwrap(), 10e-9);
    }

    #[test]
    fn test_independent_source_dc_keyword() {
        let netlist_str = "
        V1 1 0 DC 5
        I1 2 0 dc=2m
        R1 1 0 1k
        ";

        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        let voltage = parsed.components.iter().find(|c| c.id == "V1").unwrap();
        let current = parsed.components.iter().find(|c| c.id == "I1").unwrap();

        assert_eq!(voltage.value, 5.0);
        assert!((current.value - 2e-3).abs() < 1e-15);
    }

    #[test]
    fn test_independent_source_dc_keyword_inside_subcircuit() {
        let netlist_str = "
        .subckt biased out gnd
        VBIAS out gnd DC 3.3
        .ends
        X1 1 0 biased
        ";

        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        let voltage = parsed
            .components
            .iter()
            .find(|c| c.id == "X1.VBIAS")
            .unwrap();

        assert_eq!(voltage.value, 3.3);
    }

    #[test]
    fn test_spice_netlist_flattening() {
        let netlist_str = "
        * Test circuit with subcircuit
        .subckt lowpass in out gnd
        R1 in out 1k tol=1%
        C1 out gnd 10u
        .ends
        
        V1 1 0 10
        X1 1 2 0 lowpass
        Rload 2 0 10k
        ";

        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        assert_eq!(parsed.components.len(), 4); // V1, Rload, X1.R1, X1.C1

        // Find X1.R1
        let r1 = parsed.components.iter().find(|c| c.id == "X1.R1").unwrap();
        assert_eq!(r1.comp_type, "resistor");
        assert_eq!(r1.value, 1000.0);
        assert_eq!(r1.pins, vec!["1".to_string(), "2".to_string()]);
        assert_eq!(r1.tolerance, Some(0.01));

        let c1 = parsed.components.iter().find(|c| c.id == "X1.C1").unwrap();
        assert_eq!(c1.comp_type, "capacitor");
        assert!(
            (c1.value - 10e-6).abs() < 1e-12,
            "El valor del capacitor debería ser aproximadamente 10u, obtenido: {}",
            c1.value
        );
        assert_eq!(c1.pins, vec!["2".to_string(), "0".to_string()]);
    }

    #[test]
    fn test_logic_gate_delay_parsing() {
        let netlist_str = "
        * Logic gates with configurable delays test netlist
        U1 1 2 3 and_gate delay=10n rise_delay=15n fall_delay=25n
        U2 3 4 not_gate td=5n trise=8n tfall=12n
        ";

        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        assert_eq!(parsed.components.len(), 2);

        let u1 = parsed.components.iter().find(|c| c.id == "U1").unwrap();
        assert_eq!(u1.comp_type, "and_gate");
        assert_eq!(
            u1.pins,
            vec!["1".to_string(), "2".to_string(), "3".to_string()]
        );
        assert!((u1.delay.unwrap() - 10e-9).abs() < 1e-15);
        assert!((u1.rise_delay.unwrap() - 15e-9).abs() < 1e-15);
        assert!((u1.fall_delay.unwrap() - 25e-9).abs() < 1e-15);

        let u2 = parsed.components.iter().find(|c| c.id == "U2").unwrap();
        assert_eq!(u2.comp_type, "not_gate");
        assert_eq!(u2.pins, vec!["3".to_string(), "4".to_string()]);
        assert!((u2.delay.unwrap() - 5e-9).abs() < 1e-15);
        assert!((u2.rise_delay.unwrap() - 8e-9).abs() < 1e-15);
        assert!((u2.fall_delay.unwrap() - 12e-9).abs() < 1e-15);
    }

    #[test]
    fn test_recursive_library_include() {
        use std::env;
        use std::fs;

        let temp_dir = env::temp_dir();

        // Crear un archivo de modelo en sub_model.lib
        let mut model_path = temp_dir.clone();
        model_path.push("sub_model.lib");
        let model_content = "
        * Infineon Diode Model
        .model DInfineon D(IS=1e-14 RS=0.1 N=1.0)
        ";
        fs::write(&model_path, model_content).unwrap();

        // Crear una librería intermedia diode_lib.include que incluya a sub_model.lib
        let mut lib_path = temp_dir.clone();
        lib_path.push("diode_lib.include");
        let lib_content = format!(
            "
        * Library including the other model
        .include \"{}\"
        .subckt my_diode_sub anode cathode
        D1 anode cathode DInfineon
        .ends
        ",
            model_path.to_str().unwrap()
        );
        fs::write(&lib_path, lib_content).unwrap();

        // Netlist raíz que incluye a diode_lib.include
        let netlist_str = format!(
            "
        * Root circuit
        .include \"{}\"
        V1 1 0 5.0
        X1 1 0 my_diode_sub
        ",
            lib_path.to_str().unwrap()
        );

        let parsed = parse_spice_netlist_to_native(&netlist_str).unwrap();

        // Limpiar archivos temporales
        let _ = fs::remove_file(model_path);
        let _ = fs::remove_file(lib_path);

        // Validaciones del aplanamiento jerárquico
        // Debe tener V1 y X1.D1
        assert_eq!(parsed.components.len(), 2);
        let d1 = parsed.components.iter().find(|c| c.id == "X1.D1").unwrap();
        assert_eq!(d1.comp_type, "diode");
        assert_eq!(d1.pins, vec!["1".to_string(), "0".to_string()]);
    }

    #[test]
    fn test_foundry_pdk_selective_lib_include() {
        use std::env;
        use std::fs;

        let temp_dir = env::temp_dir();
        let mut pdk_path = temp_dir.clone();
        pdk_path.push("mock_pdk.lib");

        let pdk_content = "
        * Mock PDK Commercial File
        .lib tt
        .protected
        * Encriptacion y firmas de fundicion que deben ser omitidas
        .unprotected
        .model my_diode D(IS=2e-14 RS=0.5 N=1.0)
        .endl

        .lib ss
        .model my_diode D(IS=1e-15 RS=1.2 N=1.1)
        .endl
        ";

        fs::write(&pdk_path, pdk_content).unwrap();

        // 1. Probar la inclusion de la seccion 'tt'
        let netlist_tt = format!(
            "
        * Root Circuit with TT corner
        .lib \"{}\" tt
        D1 1 0 my_diode
        ",
            pdk_path.to_str().unwrap()
        );

        let parsed_tt = parse_spice_netlist_to_native(&netlist_tt).unwrap();
        assert_eq!(parsed_tt.components.len(), 1);
        let d1_tt = parsed_tt.components.iter().find(|c| c.id == "D1").unwrap();
        assert_eq!(d1_tt.comp_type, "diode");
        assert_eq!(d1_tt.diode_is, Some(2e-14));
        assert_eq!(d1_tt.diode_rs, Some(0.5));

        // 2. Probar la inclusion de la seccion 'ss'
        let netlist_ss = format!(
            "
        * Root Circuit with SS corner
        .lib \"{}\" ss
        D1 1 0 my_diode
        ",
            pdk_path.to_str().unwrap()
        );

        let parsed_ss = parse_spice_netlist_to_native(&netlist_ss).unwrap();
        assert_eq!(parsed_ss.components.len(), 1);
        let d1_ss = parsed_ss.components.iter().find(|c| c.id == "D1").unwrap();
        assert_eq!(d1_ss.comp_type, "diode");
        assert_eq!(d1_ss.diode_is, Some(1e-15));
        assert_eq!(d1_ss.diode_rs, Some(1.2));

        // Limpieza
        let _ = fs::remove_file(pdk_path);
    }

    #[test]
    fn test_foundry_model_parameter_expressions() {
        // Test de evaluacion dinamica de expresiones en parametros de modelos
        let netlist_str = "
        * Circuit with expression in model parameters
        .param dvto = 0.1
        .param double_rs = 2.0
        
        .model my_jfet NJF(VTO={-1.5 + dvto} beta=1.0e-3 rs={0.5 * double_rs})
        
        J1 1 2 0 my_jfet
        ";

        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        assert_eq!(parsed.components.len(), 1);

        let j1 = parsed.components.iter().find(|c| c.id == "J1").unwrap();
        assert_eq!(j1.comp_type, "njf");

        // VTO = -1.5 + 0.1 = -1.4
        assert!(
            (j1.jfet_vto.unwrap() - (-1.4)).abs() < 1e-12,
            "VTO incorrecto, obtenido: {}",
            j1.jfet_vto.unwrap()
        );

        let netlist_diode = "
        * Diode parameter expressions
        .param my_is = 5e-14
        .param rs_factor = 3.0
        .model fast_diode D(IS={my_is} RS={0.2 * rs_factor})
        D2 1 0 fast_diode
        ";
        let parsed_diode = parse_spice_netlist_to_native(netlist_diode).unwrap();
        let d2 = parsed_diode
            .components
            .iter()
            .find(|c| c.id == "D2")
            .unwrap();
        assert_eq!(d2.diode_is, Some(5e-14));
        assert!((d2.diode_rs.unwrap() - 0.6).abs() < 1e-12);
    }

    #[test]
    fn test_verilog_a_dual_number_ad() {
        use crate::dual3::Dual3;

        // f(x, y) = exp(x * y)
        // en x=2.0, y=3.0
        let x = Dual3::new(2.0, 0);
        let y = Dual3::new(3.0, 1);

        let f = (x * y).exp();

        assert!((f.val - 403.4287934927351).abs() < 1e-9);
        // df/dx = y * exp(x * y) = 3 * exp(6) = 1210.2863804782054
        assert!((f.deriv[0] - 1210.2863804782054).abs() < 1e-9);
        // df/dy = x * exp(x * y) = 2 * exp(6) = 806.8575869854702
        assert!((f.deriv[1] - 806.8575869854702).abs() < 1e-9);
        assert_eq!(f.deriv[2], 0.0);
    }

    #[test]
    fn test_verilog_a_dynamic_nmos_device() {
        let netlist_str = "
        * Circuit with dynamic Verilog-A NMOS
        .model my_va verilog_a (ports=d,g,s params=vth0=0.35,beta=0.02 equation=I(d,s)<+beta*pow(vgs-vth0,2))
        
        Vg 1 0 1.0
        Vd 2 0 2.0
        Y1 2 1 0 my_va
        ";

        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        assert_eq!(parsed.components.len(), 3);

        let y1 = parsed.components.iter().find(|c| c.id == "Y1").unwrap();
        assert_eq!(y1.comp_type, "verilog_a");
        assert_eq!(y1.va_model_name, Some("my_va".to_string()));

        let res = crate::solver::solve_dc_circuit(&parsed).unwrap();

        // La corriente fluye a través de la rama de Vd
        // I(Vd) = -Ids = -8.45 mA = -0.00845 A
        let i_vd = res.branch_currents.get("Vd").unwrap();
        assert!(
            (i_vd + 0.00845).abs() < 1e-5,
            "Corriente de Vd incorrecta, obtenida: {}",
            i_vd
        );
    }

    #[test]
    fn malformed_spice_corpus_never_panics() {
        let malformed = [
            "X1 PARAMS: foo=1",
            "X1 1 PARAMS:",
            "X1 1 2 PARAMS: foo=1",
            ".subckt",
            ".ends orphan",
            ".model",
            "R",
            "V1 1",
            "K1",
            "\0\0\0",
            "X1 1 2 missing PARAMS: broken={",
        ];

        for netlist in malformed {
            let result = std::panic::catch_unwind(|| parse_spice_netlist_to_native(netlist));
            assert!(result.is_ok(), "El parser entró en pánico con: {netlist:?}");
        }

        let invalid_params = parse_spice_netlist_to_native("X1 PARAMS: foo=1");
        assert!(
            invalid_params
                .unwrap_err()
                .contains("Instancia de subcircuito inválida"),
            "La instancia malformada debe producir un error accionable"
        );
    }

    #[test]
    fn test_subcircuit_numeric_internal_node_isolation() {
        // Circuito con nodo raíz '1' y 2 subcircuitos idénticos que contienen internamente el nodo '1' y '2'.
        // Deben aislarse completamente sin colisionar ni puentearse.
        let spice_text = "
        * Test de aislamiento de nodos internos numéricos
        .subckt voltage_divider in out
        R1 in 1 10k
        R2 1 out 10k
        .ends voltage_divider

        V1 1 0 10.0
        X1 1 2 voltage_divider
        X2 1 3 voltage_divider
        R_load1 2 0 10k
        R_load2 3 0 20k
        ";

        let parsed = parse_spice_netlist_to_native(spice_text).unwrap();
        assert_eq!(parsed.components.len(), 7); // V1, R_load1, R_load2, + (R1, R2)*2 = 7 comps

        let res = crate::solver::solve_dc_circuit(&parsed).unwrap();
        // Verificar que out1 y out2 tienen sus respectivos voltajes divisores independientes
        let v_out1 = *res.node_voltages.get("2").unwrap();
        let v_out2 = *res.node_voltages.get("3").unwrap();

        // X1: nodo 2 conectado a R_load1 (10k) en serie con R1(10k)+R2(10k) = 10V * (10k / 30k) = 3.333V
        assert!(
            (v_out1 - 3.333333).abs() < 1e-4,
            "v_out1 incorrecto: {}",
            v_out1
        );
        // X2: nodo 3 conectado a R_load2 (20k) en serie con R1(10k)+R2(10k) = 10V * (20k / 40k) = 5.0V
        assert!((v_out2 - 5.0).abs() < 1e-4, "v_out2 incorrecto: {}", v_out2);
    }

    #[test]
    fn test_commercial_opamp_macromodel_with_bsource_and_params() {
        // Macromodelo SPICE tipo fabricante (B-Source diferencial + etapa de ganancia parametrizada)
        let spice_text = "
        * Macromodelo de OpAmp Comercial
        .subckt OpAmp_Pro in_p in_n out PARAMS: Avol=100000 Rout=50
        B_diff mid 0 V=tanh(V(in_p, in_n) * 1000) * {Avol}
        R_out mid out {Rout}
        .ends OpAmp_Pro

        V_sig 1 0 0.001
        X_opamp 1 0 2 OpAmp_Pro PARAMS: Avol=100 Rout=10
        R_load 2 0 100
        ";

        let parsed = parse_spice_netlist_to_native(spice_text).unwrap();
        let res = crate::solver::solve_dc_circuit(&parsed).unwrap();

        // V(1)=1mV -> V(in_p, in_n)=1mV -> tanh(0.001*1000)*100 = tanh(1)*100 = 76.1594V
        // Divisor de salida: 76.1594 * (100 / (100 + 10)) = 69.2358V
        let v2 = *res.node_voltages.get("2").unwrap();
        let expected = (1.0f64.tanh() * 100.0) * (100.0 / 110.0);
        assert!(
            (v2 - expected).abs() < 0.1,
            "Tensión V(2) esperada ~{:.3}V, obtenida: {:.3}V",
            expected,
            v2
        );
    }

    #[test]
    fn test_bsource_extended_math_functions() {
        // B-sources con funciones matemáticas industriales: smooth_max, table, if, hypot
        let spice_text = "
        * Test de B-Sources con funciones extendidas
        V1 1 0 3.0
        B_hypot 2 0 V=hypot(V(1), 4.0)
        B_smax 3 0 V=smooth_max(V(1), 5.0, 0.1)
        B_tbl 4 0 V=table(V(1), 0, 0, 2, 10, 4, 20)
        B_if 5 0 V=if(V(1) - 2.0, 15.0, -15.0)
        ";

        let parsed = parse_spice_netlist_to_native(spice_text).unwrap();
        let res = crate::solver::solve_dc_circuit(&parsed).unwrap();

        // 1. hypot(3, 4) = 5.0
        let v_h = *res.node_voltages.get("2").unwrap();
        assert!(
            (v_h - 5.0).abs() < 1e-4,
            "hypot esperado 5.0V, obtenido: {}",
            v_h
        );

        // 2. smooth_max(3, 5, 0.1) ≈ 5.001
        let v_m = *res.node_voltages.get("3").unwrap();
        assert!(
            (v_m - 5.0).abs() < 0.05,
            "smooth_max esperado ~5.0V, obtenido: {}",
            v_m
        );

        // 3. table(3, [0->0, 2->10, 4->20]) -> 3 está en [2,4], interpolación lineal = 15.0
        let v_t = *res.node_voltages.get("4").unwrap();
        assert!(
            (v_t - 15.0).abs() < 1e-4,
            "table esperado 15.0V, obtenido: {}",
            v_t
        );

        // 4. if(3 - 2 > 0, 15, -15) = 15.0
        let v_if = *res.node_voltages.get("5").unwrap();
        assert!(
            (v_if - 15.0).abs() < 1e-4,
            "if esperado 15.0V, obtenido: {}",
            v_if
        );
    }

    #[test]
    fn test_evaluate_expression_nested_parentheses_and_units() {
        use std::collections::HashMap;
        let mut env = HashMap::new();
        env.insert("r1".to_string(), 1000.0);
        env.insert("r2".to_string(), 4000.0);
        env.insert("mult".to_string(), 2.5);

        // Aritmética con unidades SPICE y paréntesis
        let val1 = evaluate_expression("((r1 + r2) * mult) / 2", &env).unwrap();
        assert_eq!(val1, 6250.0);

        let val2 = evaluate_expression("{10k * (2 + 3)}", &env).unwrap();
        assert_eq!(val2, 50000.0);

        let val3 = evaluate_expression("1 / (2 * pi * 1k * 10n)", &env).unwrap();
        assert!((val3 - 15915.4943).abs() < 1e-3);
    }

    #[test]
    fn test_evaluate_expression_functions_and_constants() {
        use std::collections::HashMap;
        let env = HashMap::new();

        let val_sqrt = evaluate_expression("sqrt(100) + pow(2, 3)", &env).unwrap();
        assert_eq!(val_sqrt, 18.0);

        let val_trig = evaluate_expression("sin(pi / 2) + cos(0)", &env).unwrap();
        assert!((val_trig - 2.0).abs() < 1e-12);

        let val_exp = evaluate_expression("ln(exp(4))", &env).unwrap();
        assert!((val_exp - 4.0).abs() < 1e-12);

        let val_minmax = evaluate_expression("max(min(10, 20), 5)", &env).unwrap();
        assert_eq!(val_minmax, 10.0);
    }

    #[test]
    fn test_evaluate_expression_in_subcircuit_flattening() {
        let netlist_str = "
        * Subcircuit with arithmetic parameters in braces
        .subckt divider in out gnd params: R_TOP=1k FACTOR=4
        R1 in out {R_TOP * (FACTOR + 1)}
        R2 out gnd {R_TOP}
        .ends

        V1 1 0 10
        X1 1 2 0 divider R_TOP=2k FACTOR=3
        ";

        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        let r1 = parsed.components.iter().find(|c| c.id == "X1.R1").unwrap();
        let r2 = parsed.components.iter().find(|c| c.id == "X1.R2").unwrap();

        // R1 = 2k * (3 + 1) = 8000
        assert_eq!(r1.value, 8000.0);
        // R2 = 2k = 2000
        assert_eq!(r2.value, 2000.0);
    }
}
