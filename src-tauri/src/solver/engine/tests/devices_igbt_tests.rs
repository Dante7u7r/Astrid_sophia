// ==========================================================================
// ASTRYD SOPHIA — HEFNER PHYSICAL IGBT TESTS
// ==========================================================================

use crate::solver::engine::devices::igbt::{evaluate_igbt, IgbtParams};
use crate::solver::engine::{solve_dc_circuit, solve_transient_circuit};
use crate::solver::types::{CircuitNetlist, ComponentData};
use crate::solver::TransientSettings;

#[test]
fn test_igbt_forward_conduction_and_saturation() {
    let params = IgbtParams {
        vth: 5.0,
        kp: 15.0,
        alpha_pnp: 0.55,
        ..IgbtParams::default()
    };

    // 1. Corte: Vge = 0V (< Vth) -> Ic = 0 (fuga < 1 nA)
    let off = evaluate_igbt(0.0, 100.0, &params, None, None, None);
    assert!(off.ic < 1e-6, "En corte Ic debe ser despreciable, obtenido: {}", off.ic);
    assert_eq!(off.gm, 0.0);

    // 2. Conducción directa en saturación: Vge = 15V (> Vth = 5V), Vce = 10V
    let on_sat = evaluate_igbt(15.0, 10.0, &params, None, None, None);
    // Vov = 10V, Imos ~ 0.5 * 15 * 100 = 750, Ic ~ 750 / (1 - 0.55) ~ 1666 A (o escalado)
    assert!(on_sat.ic > 10.0, "En conducción saturada Ic debe ser alta, obtenido: {}", on_sat.ic);
    assert!(on_sat.gm > 0.0, "gm debe ser positiva");
    assert!(on_sat.go > 0.0, "go de salida debe ser positiva");
}

#[test]
fn test_igbt_miller_capacitance_voltage_dependence() {
    let params = IgbtParams {
        cge: 2.5e-9,
        cgc0: 200e-12,
        cce0: 400e-12,
        v0_gc: 10.0,
        m_gc: 0.7,
        ..IgbtParams::default()
    };

    let cap_0v = evaluate_igbt(0.0, 0.0, &params, None, None, None);
    let cap_50v = evaluate_igbt(0.0, 50.0, &params, None, None, None);
    let cap_600v = evaluate_igbt(0.0, 600.0, &params, None, None, None);

    // Cge es fija
    assert_eq!(cap_0v.cge, 2.5e-9);

    // Cgc Miller decae fuertemente con la tensión Vce
    assert!(cap_50v.cgc < cap_0v.cgc * 0.4);
    assert!(cap_600v.cgc < cap_0v.cgc * 0.06, "Cgc a 600V debe colapsar a < 6%");
}

#[test]
fn test_igbt_stored_charge_and_tail_current_turn_off() {
    let params = IgbtParams {
        vth: 5.0,
        kp: 10.0,
        alpha_pnp: 0.6,
        tau_hl: 2.0e-6, // 2 µs
        ..IgbtParams::default()
    };

    // Estado ON estacionario con Vge=15V, Vce=5V
    let on_state = evaluate_igbt(15.0, 5.0, &params, None, None, None);
    let q_b_initial = on_state.q_b;
    assert!(q_b_initial > 0.0, "La carga almacenada en ON debe ser positiva");

    // Flanco de apagado inmediato (Vge = 0V) a t = 0+ tras dt = 100 ns
    let dt = 100e-9;
    let turn_off_step1 = evaluate_igbt(0.0, 300.0, &params, None, Some(q_b_initial), Some(dt));

    // La corriente de cola (Tail current) debe ser finita y positiva a pesar de Vge = 0V
    assert!(
        turn_off_step1.ic > 0.1,
        "La corriente de cola debe mantener conducción al apagar el canal MOS, obtenido: {}",
        turn_off_step1.ic
    );
    assert!(
        turn_off_step1.q_b < q_b_initial,
        "La carga almacenada debe descargarse progresivamente"
    );

    // Tras 5 constantes de tiempo tau_HL (10 µs), la carga y la corriente de cola decaen casi a cero
    let long_dt = 10e-6;
    let turn_off_final = evaluate_igbt(0.0, 300.0, &params, None, Some(turn_off_step1.q_b), Some(long_dt));
    assert!(
        turn_off_final.ic < turn_off_step1.ic * 0.05,
        "Tras 5 tau_HL la corriente de cola debe extinguirse"
    );
}

#[test]
fn test_igbt_circuit_dc_operating_point() {
    // Circuito DC: Vcc = 100V, Rload = 10 Ohm, Vgate = 15V, IGBT (G: nodo 1, C: nodo 2, E: nodo 0)
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "Vcc".to_string(),
                comp_type: "vsource".to_string(),
                value: 100.0,
                pins: vec!["3".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Rload".to_string(),
                comp_type: "resistor".to_string(),
                value: 10.0,
                pins: vec!["3".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Vgate".to_string(),
                comp_type: "vsource".to_string(),
                value: 15.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Q1".to_string(),
                comp_type: "igbt".to_string(),
                value: 5.0, // Vth = 5.0V
                pins: vec!["1".to_string(), "2".to_string(), "0".to_string()],
                igbt_kp: Some(15.0),
                igbt_alpha: Some(0.55),
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    let dc_sol = solve_dc_circuit(&netlist).expect("Resolución DC de IGBT falló");
    let v_ce = dc_sol.node_voltages.get("2").copied().unwrap_or(100.0);

    // Con Vgate = 15V y Rload = 10 Ohm, el IGBT conduce y satura con Vce baja (< 15V)
    assert!(
        v_ce < 15.0,
        "Vce en conducción ON debe caer fuertemente por debajo de Vcc (100V), obtenido: {:.2}V",
        v_ce
    );
    let ic = (100.0 - v_ce) / 10.0;
    assert!(ic > 8.0, "Ic debe ser ~ 9A, obtenido: {:.2}A", ic);
}

#[test]
fn test_igbt_circuit_transient_switching() {
    // Circuito transitorio con pulso de compuerta
    let netlist = CircuitNetlist {
        components: vec![
            ComponentData {
                id: "Vcc".to_string(),
                comp_type: "vsource".to_string(),
                value: 50.0,
                pins: vec!["3".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Rload".to_string(),
                comp_type: "resistor".to_string(),
                value: 20.0,
                pins: vec!["3".to_string(), "2".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Vgate".to_string(),
                comp_type: "vsource".to_string(),
                value: 15.0,
                wave_type: Some("pulse".to_string()),
                amplitude: Some(15.0),
                frequency: Some(10_000.0), // 10 kHz
                duty_cycle: Some(0.5),
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            },
            ComponentData {
                id: "Q1".to_string(),
                comp_type: "igbt".to_string(),
                value: 5.0,
                pins: vec!["1".to_string(), "2".to_string(), "0".to_string()],
                igbt_kp: Some(10.0),
                igbt_alpha: Some(0.55),
                igbt_tau: Some(1.5e-6),
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    let settings = TransientSettings {
        t_max: 0.0001, // 100 µs (1 ciclo completo a 10 kHz)
        dt: 1e-7,      // 100 ns
        fixed_step: None,
        integration_method: None,
    };

    let results = solve_transient_circuit(&netlist, &settings).expect("Transitorio de IGBT falló");
    assert!(!results.is_empty(), "Resultados transitorios no deben estar vacíos");

    // Verificar estado ON (t ~ 25 µs)
    let step_on = results
        .iter()
        .min_by(|a, b| ((a.time - 0.000025).abs()).partial_cmp(&(b.time - 0.000025).abs()).unwrap())
        .expect("Punto ON no encontrado");
    let v_ce_on = step_on.node_voltages.get("2").copied().unwrap_or(50.0);
    assert!(v_ce_on < 10.0, "Vce en estado ON debe ser baja, obtenido: {:.2}V", v_ce_on);

    // Verificar estado OFF (t ~ 75 µs)
    let step_off = results
        .iter()
        .min_by(|a, b| ((a.time - 0.000075).abs()).partial_cmp(&(b.time - 0.000075).abs()).unwrap())
        .expect("Punto OFF no encontrado");
    let v_ce_off = step_off.node_voltages.get("2").copied().unwrap_or(0.0);
    assert!(v_ce_off > 40.0, "Vce en estado OFF debe subir hacia Vcc (50V), obtenido: {:.2}V", v_ce_off);
}
