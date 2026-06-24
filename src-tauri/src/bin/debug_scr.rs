use astryd_sophia_lib::parser::parse_spice_netlist_to_native;
use astryd_sophia_lib::solver::{solve_transient_circuit, TransientSettings};

fn main() {
    let netlist_str = "
    * SCR Phase Control Test
    .model myscr scr (vgt=0.7 ih=5m)
    V_ac 1 0 sine (0 10 50)
    Bgate 3 2 V={min(5.0, max(0.0, (t - 0.0025) * 100000.0)) - min(5.0, max(0.0, (t - 0.0035) * 100000.0))}
    Rg 3 4 1k
    S1 1 2 4 myscr
    R_load 2 0 100
    ";

    println!("Parseando netlist...");
    let netlist = parse_spice_netlist_to_native(netlist_str).unwrap();
    println!("Netlist parseada con éxito. Componentes:");
    for comp in &netlist.components {
        println!("  - ID: {}, Tipo: {}, Pines: {:?}", comp.id, comp.comp_type, comp.pins);
    }

    let settings = TransientSettings {
        dt: 0.0001,   // 0.1 ms
        t_max: 0.020, // 20 ms
        fixed_step: Some(true),
        integration_method: None,
    };

    println!("Iniciando simulación transitoria...");
    let _results = solve_transient_circuit(&netlist, &settings).unwrap();
    println!("Simulación completada!");
}
