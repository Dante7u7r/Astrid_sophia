use crate::solver::types::{CircuitNetlist, SimulationResult};
use std::collections::HashMap;

use super::super::dc::solve_dc_circuit;
use super::super::devices::{
    evaluate_bsim3_nmos, evaluate_bsim3_pmos, solve_diode_junction_voltage, BJT_RTH_JA,
    DIODE_RTH_JA, MOS_RTH_JA, OPTO_RTH_JA, PHYS_KB, PHYS_Q, PHYS_T,
};

// ==================================================================================
// FASE 25: Modelos de Deriva y Dependencia Térmica
// ==================================================================================
// Inyecta los modelos físicos de variación de temperatura global (T) en:
// - Pasivos: Coeficientes TC1, TC2 de primer y segundo orden.
// - Unión PN (Diodo/BJT): Escalamiento de Is(T) con Varshni Eg(T).
// - MOSFETs: Degradación de movilidad T^-1.5 y corrimiento lineal de Vth.

/// Parámetros de banda prohibida de Silicio para el modelo de Varshni
#[allow(dead_code)]
pub const EG_SI_300: f64 = 1.12; // Banda prohibida del Si a 300K (eV)
#[allow(dead_code)]
const VARSHNI_ALPHA: f64 = 7.021e-4; // Parámetro α de Varshni para Si (eV/K)
#[allow(dead_code)]
const VARSHNI_BETA: f64 = 1108.0; // Parámetro β de Varshni para Si (K)

/// Calcula el potencial de banda prohibida del Silicio según Varshni:
///   Eg(T) = Eg(0) - α * T² / (T + β)
///   donde Eg(0) = Eg(300) + α * 300² / (300 + β)
#[allow(dead_code)]
pub fn bandgap_varshni(temp_k: f64) -> f64 {
    let eg0 = EG_SI_300 + VARSHNI_ALPHA * 300.0 * 300.0 / (300.0 + VARSHNI_BETA);
    eg0 - VARSHNI_ALPHA * temp_k * temp_k / (temp_k + VARSHNI_BETA)
}

/// Escalamiento térmico de la corriente de saturación inversa de la unión PN:
///   Is(T) = Is(T0) * (T/T0)^(XTI/N) * exp(-Eg/(kB*T) * (1 - T/T0))
///
/// Parámetros:
///   is_t0: Corriente de saturación a temperatura de referencia (A)
///   t0: Temperatura de referencia (K), típicamente 300
///   t: Temperatura actual (K)
///   xti: Exponente de temperatura de saturación (típicamente 3.0 para Si)
///   n: Coeficiente de emisión (idealidad)
#[allow(dead_code)]
pub fn thermal_is_pn(is_t0: f64, t0: f64, t: f64, xti: f64, n: f64) -> f64 {
    let eg_t0 = bandgap_varshni(t0);
    let eg_t = bandgap_varshni(t);
    let vt_t0 = PHYS_KB * t0 / PHYS_Q;
    let vt_t = PHYS_KB * t / PHYS_Q;

    // Modelo exacto SPICE: Is(T) = Is(T0) * (T/T0)^(XTI/N) * exp((Eg(T0)/Vt(T0) - Eg(T)/Vt(T)) / N)
    let ratio = (t / t0).powf(xti / n);
    let exp_term = ((eg_t0 / vt_t0 - eg_t / vt_t) / n).exp();
    is_t0 * ratio * exp_term
}

/// Voltaje térmico a temperatura T:
///   Vt(T) = kB * T / q
#[allow(dead_code)]
pub fn thermal_vt(temp_k: f64) -> f64 {
    PHYS_KB * temp_k / PHYS_Q
}

/// Escalamiento térmico de resistencia con coeficientes de primer y segundo orden:
///   R(T) = R0 * [1 + TC1*(T - T0) + TC2*(T - T0)²]
pub fn thermal_resistance(r0: f64, t0: f64, t: f64, tc1: f64, tc2: f64) -> f64 {
    let dt = t - t0;
    r0 * (1.0 + tc1 * dt + tc2 * dt * dt)
}

/// Degradación de movilidad de portadores en MOSFETs:
///   β(T) = β(T0) * (T/T0)^(-BEX)
/// donde BEX ≈ 1.5 para Si (empírico)
///
/// Parámetros:
///   beta_t0: Transconductancia o factor β a temperatura de referencia
///   t0: Temperatura de referencia (K)
///   t: Temperatura actual (K)
///   bex: Exponente de movilidad (típicamente 1.5)
#[allow(dead_code)]
pub fn thermal_mosfet_beta(beta_t0: f64, t0: f64, t: f64, bex: f64) -> f64 {
    beta_t0 * (t / t0).powf(-bex)
}

/// Corrimiento térmico de la tensión de umbral de MOSFETs:
///   Vth(T) = Vth(T0) - TCV * (T - T0)
/// donde TCV ≈ 2 mV/K para MOSFETs de Si
pub fn thermal_mosfet_vth(vth_t0: f64, t0: f64, t: f64, tcv: f64) -> f64 {
    vth_t0 - tcv * (t - t0)
}

/// Aplica correcciones térmicas completas a un netlist, devolviendo un netlist
/// modificado con los valores ajustados a la temperatura `temp_k`.
///
/// Se aplican los siguientes modelos físicos:
///   - Resistores: R(T) = R0 * [1 + TC1*(T-T0) + TC2*(T-T0)²]
///   - Capacitores: C(T) = C0 * [1 + TC1*(T-T0)]
///   - Inductores: L(T) = L0 * [1 + TC1*(T-T0)]
///   - Diodos: Is(T) escalado con Varshni, Vt(T) actualizado
///   - MOSFETs: β(T) degradada, Vth(T) desplazada
///   - BJTs: Is(T) escalado con Varshni
pub fn apply_thermal_drift(netlist: &CircuitNetlist, temp_k: f64) -> CircuitNetlist {
    let t0 = PHYS_T; // 300K referencia

    let mut adjusted = netlist.clone();

    for comp in &mut adjusted.components {
        match comp.comp_type.as_str() {
            "resistor" => {
                // TC1 = 3900 ppm/K típico para metales, TC2 = 0 por defecto
                let tc1 = 3.9e-3; // 3900 ppm/K
                let tc2 = 0.0;
                comp.value = thermal_resistance(comp.value, t0, temp_k, tc1, tc2);
            }
            "capacitor" => {
                // Coeficiente de temperatura para cerámicos X7R: ~±15% sobre rango
                let tc1 = 30e-6; // 30 ppm/K (conservador)
                comp.value *= 1.0 + tc1 * (temp_k - t0);
            }
            "inductor" => {
                // Coeficiente de temperatura del inductor: ~50 ppm/K
                let tc1 = 50e-6;
                comp.value *= 1.0 + tc1 * (temp_k - t0);
            }
            "diode" | "led" => {
                // El campo `value` de diodos a menudo es nominal; pero internamente
                // la corriente Is se escala en el solver. Aquí ajustamos un factor
                // de escala que el solver DC puede usar directamente.
                // Nota: el solver usa DIODE_IS global, así que aquí no modificamos
                // comp.value. El escalamiento real se aplica en solve_dc_circuit_thermal.
            }
            "opto" => {
                // El opto sigue la misma lógica del diodo: Is se escala en el solver
                // mediante get_thermal_parameters, no se modifica comp.value aquí.
            }
            "nmos" | "pmos" => {
                // Vth se almacena en comp.value para MOSFETs
                let vth_t0 = comp.value;
                let tcv = 2.0e-3; // 2 mV/K
                comp.value = thermal_mosfet_vth(vth_t0, t0, temp_k, tcv);
            }
            _ => {}
        }
    }

    adjusted
}

/// Resolvedor DC con temperatura global inyectada.
/// Aplica el modelo de deriva térmica completo al netlist y resuelve.
pub fn solve_dc_circuit_thermal(
    netlist: &CircuitNetlist,
    temp_k: f64,
) -> Result<SimulationResult, String> {
    let mut adjusted_netlist = apply_thermal_drift(netlist, temp_k);
    adjusted_netlist.temperature = Some(temp_k);
    solve_dc_circuit(&adjusted_netlist)
}

/// Resolvedor DC con acoplamiento electro-térmico completo (Relaxation Loop).
/// Alterna entre:
///   1. Resolver el circuito eléctrico con temperaturas fijas → obtener corrientes/voltajes
///   2. Calcular potencia disipada por dispositivo → resolver red térmica → actualizar T_j
/// Converge cuando max(|ΔT_j|) < thermal_tol.
pub fn solve_dc_electrothermal(
    netlist: &CircuitNetlist,
) -> Result<(SimulationResult, HashMap<String, f64>), String> {
    let config = netlist
        .thermal_config
        .as_ref()
        .ok_or("Se requiere .THERMAL en el netlist para simulación electro-térmica".to_string())?;

    let t_amb = config.t_amb;
    let max_iters = config.max_thermal_iters;
    let tol = config.thermal_tol;

    // Identificar dispositivos térmicamente activos y sus índices
    let thermal_devices: Vec<(usize, String)> = netlist
        .components
        .iter()
        .enumerate()
        .filter_map(|(i, c)| match c.comp_type.as_str() {
            "diode" | "led" | "nmos" | "pmos" | "bsim3nmos" | "bsim3pmos" | "bsim4nmos"
            | "bsim4pmos" | "npn" | "pnp" | "opto" => Some((i, c.id.clone())),
            _ => None,
        })
        .collect();

    let n_dev = thermal_devices.len();
    if n_dev == 0 {
        // Sin dispositivos térmicos, resolver normalmente
        let result = solve_dc_circuit(netlist)?;
        return Ok((result, HashMap::new()));
    }

    // Inicializar temperaturas de unión a T_amb
    let mut device_temps: HashMap<String, f64> = HashMap::new();
    for (_, id) in &thermal_devices {
        device_temps.insert(id.clone(), t_amb);
    }

    let mut last_result: Option<SimulationResult> = None;

    for _iter in 0..max_iters {
        // --- Paso 1: Resolver circuito eléctrico con temperaturas actuales ---
        let mut adjusted_netlist = netlist.clone();
        // Inyectar temperatura promedio como temperatura global del circuito
        let avg_temp = if device_temps.is_empty() {
            t_amb
        } else {
            device_temps.values().sum::<f64>() / device_temps.len() as f64
        };
        adjusted_netlist = apply_thermal_drift(&adjusted_netlist, avg_temp);
        adjusted_netlist.temperature = Some(avg_temp);

        let result = solve_dc_circuit(&adjusted_netlist)?;

        // --- Paso 2: Calcular potencia disipada por dispositivo ---
        let mut power_diss: HashMap<String, f64> = HashMap::new();

        for (comp_idx, comp_id) in &thermal_devices {
            let comp = &netlist.components[*comp_idx];
            let p = match comp.comp_type.as_str() {
                "diode" | "led" => {
                    let na = comp.pins[0].parse::<usize>().unwrap_or(0);
                    let nc = comp.pins[1].parse::<usize>().unwrap_or(0);
                    let va = *result.node_voltages.get(&na.to_string()).unwrap_or(&0.0);
                    let vc = *result.node_voltages.get(&nc.to_string()).unwrap_or(&0.0);
                    let vd = va - vc;
                    let tj = *device_temps.get(comp_id).unwrap_or(&t_amb);
                    let (_, id_val, _) = solve_diode_junction_voltage(vd, Some(tj), comp);
                    (vd * id_val).abs()
                }
                "nmos" | "bsim3nmos" | "bsim4nmos" => {
                    if comp.pins.len() < 3 {
                        0.0
                    } else {
                        let ng = comp.pins[0].parse::<usize>().unwrap_or(0);
                        let nd = comp.pins[1].parse::<usize>().unwrap_or(0);
                        let ns = comp.pins[2].parse::<usize>().unwrap_or(0);
                        let vg = *result.node_voltages.get(&ng.to_string()).unwrap_or(&0.0);
                        let vd_pin = *result.node_voltages.get(&nd.to_string()).unwrap_or(&0.0);
                        let vs = *result.node_voltages.get(&ns.to_string()).unwrap_or(&0.0);
                        let vds = vd_pin - vs;
                        let vgs = vg - vs;
                        let vbs = if comp.pins.len() > 3 {
                            let nb = comp.pins[3].parse::<usize>().unwrap_or(0);
                            let vb = *result.node_voltages.get(&nb.to_string()).unwrap_or(&0.0);
                            vb - vs
                        } else {
                            0.0
                        };
                        let (ids, _, _) = evaluate_bsim3_nmos(
                            vgs,
                            vds,
                            vbs,
                            comp.value,
                            comp.w,
                            comp.l,
                            Some(avg_temp),
                            Some(comp),
                        );
                        (vds * ids).abs()
                    }
                }
                "pmos" | "bsim3pmos" | "bsim4pmos" => {
                    if comp.pins.len() < 3 {
                        0.0
                    } else {
                        let ng = comp.pins[0].parse::<usize>().unwrap_or(0);
                        let nd = comp.pins[1].parse::<usize>().unwrap_or(0);
                        let ns = comp.pins[2].parse::<usize>().unwrap_or(0);
                        let vg = *result.node_voltages.get(&ng.to_string()).unwrap_or(&0.0);
                        let vd_pin = *result.node_voltages.get(&nd.to_string()).unwrap_or(&0.0);
                        let vs = *result.node_voltages.get(&ns.to_string()).unwrap_or(&0.0);
                        let vsd = vs - vd_pin;
                        let vsg = vs - vg;
                        let vsb = if comp.pins.len() > 3 {
                            let nb = comp.pins[3].parse::<usize>().unwrap_or(0);
                            let vb = *result.node_voltages.get(&nb.to_string()).unwrap_or(&0.0);
                            vs - vb
                        } else {
                            0.0
                        };
                        let (isd, _, _) = evaluate_bsim3_pmos(
                            vsg,
                            vsd,
                            vsb,
                            comp.value,
                            comp.w,
                            comp.l,
                            Some(avg_temp),
                            Some(comp),
                        );
                        (vsd * isd).abs()
                    }
                }
                "npn" | "pnp" => {
                    if comp.pins.len() < 3 {
                        0.0
                    } else {
                        let nb = comp.pins[0].parse::<usize>().unwrap_or(0);
                        let nc = comp.pins[1].parse::<usize>().unwrap_or(0);
                        let ne = comp.pins[2].parse::<usize>().unwrap_or(0);
                        let _vb = *result.node_voltages.get(&nb.to_string()).unwrap_or(&0.0);
                        let vc_pin = *result.node_voltages.get(&nc.to_string()).unwrap_or(&0.0);
                        let ve = *result.node_voltages.get(&ne.to_string()).unwrap_or(&0.0);
                        let vce = if comp.comp_type == "npn" {
                            vc_pin - ve
                        } else {
                            ve - vc_pin
                        };
                        // Corriente de colector simplificada
                        let ic_branch = result.branch_currents.get(comp_id).copied().unwrap_or(0.0);
                        (vce.abs() * ic_branch.abs()).min(50.0)
                    }
                }
                _ => 0.0,
            };
            power_diss.insert(comp_id.clone(), p);
        }

        // --- Paso 3: Construir y resolver la red térmica Gth ---
        // Para cada dispositivo i: Tj_i = T_amb + Rth_i * P_i + Σ_j(Rth_ij * P_j)
        let mut new_temps: HashMap<String, f64> = HashMap::new();

        for (comp_idx, comp_id) in &thermal_devices {
            let comp = &netlist.components[*comp_idx];

            // Rth propio: desde comp.rth > constante por defecto
            let rth_self = comp.rth.unwrap_or_else(|| match comp.comp_type.as_str() {
                "diode" | "led" => DIODE_RTH_JA,
                "opto" => OPTO_RTH_JA,
                "nmos" | "pmos" | "bsim3nmos" | "bsim3pmos" | "bsim4nmos" | "bsim4pmos" => {
                    MOS_RTH_JA
                }
                "npn" | "pnp" => BJT_RTH_JA,
                _ => 100.0,
            });

            let p_self = *power_diss.get(comp_id).unwrap_or(&0.0);

            // Contribución propia
            let mut tj = t_amb + rth_self * p_self;

            // Contribución de acoplamiento térmico mutuo
            for (id1, id2, rth_mutual) in &config.thermal_coupling {
                if id1 == comp_id {
                    let p_other = *power_diss.get(id2).unwrap_or(&0.0);
                    tj += rth_mutual * p_other;
                } else if id2 == comp_id {
                    let p_other = *power_diss.get(id1).unwrap_or(&0.0);
                    tj += rth_mutual * p_other;
                }
            }

            // Clampar temperatura: no puede ser menor que ambiente ni mayor que 500K
            let tj_clamped = tj.clamp(t_amb, 500.0);
            new_temps.insert(comp_id.clone(), tj_clamped);
        }

        // --- Paso 4: Verificar convergencia ---
        let max_delta_t = thermal_devices
            .iter()
            .map(|(_, id)| {
                let t_old = *device_temps.get(id).unwrap_or(&t_amb);
                let t_new = *new_temps.get(id).unwrap_or(&t_amb);
                (t_new - t_old).abs()
            })
            .fold(0.0_f64, f64::max);

        device_temps = new_temps;
        last_result = Some(result);

        if max_delta_t < tol {
            break;
        }
    }

    let final_result = last_result.unwrap_or_else(|| SimulationResult {
        node_voltages: HashMap::new(),
        branch_currents: HashMap::new(),
        convergence_iterations: 0,
        error_log: Some("Simulación electro-térmica no convergió".to_string()),
    });

    Ok((final_result, device_temps))
}
