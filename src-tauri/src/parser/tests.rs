#[allow(unused_imports)]
use super::devices::*;
#[allow(unused_imports)]
use super::expressions::*;
#[allow(unused_imports)]
use super::lexer::*;
#[allow(unused_imports)]
use super::subcircuits::*;

#[cfg(test)]
mod tests {
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
}
