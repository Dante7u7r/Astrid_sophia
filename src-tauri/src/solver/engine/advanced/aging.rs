//! ==========================================================================
//! ASTRYD SOPHIA — SEMICONDUCTOR AGING & RELIABILITY MODELS (NBTI, PBTI, HCI)
//! ==========================================================================
//!
//! Modelado de física de degradación y fiabilidad en semiconductores:
//! 1. NBTI (Negative Bias Temperature Instability) en pMOS:
//!    - Ruptura de enlaces Si-H e incremento de trampas de interfaz Nit.
//!    - Modelo Reaction-Diffusion con relajación / recuperación dinámica en AC.
//! 2. PBTI (Positive Bias Temperature Instability) en nMOS High-κ:
//!    - Atrapamiento de electrones en trampas volumétricas de HfO2.
//! 3. HCI (Hot Carrier Injection) en saturación:
//!    - Portadores calientes acelerados por campo eléctrico lateral que generan
//!      ionización por impacto y corrientes de sustrato Isub.
//! 4. Estimación de Vida Útil (Lifetime / Time-to-Failure - TTF) a 10 y 20 años.

use serde::{Deserialize, Serialize};

/// Constante de Boltzmann en eV/K
pub const KB_EV: f64 = 8.617333262145e-5;

/// Mecanismo de degradación física
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AgingMechanism {
    NBTI,
    PBTI,
    HCI,
    Combined,
}

/// Nodo tecnológico del proceso semiconductor
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProcessTechnologyNode {
    Node180nmPlanar,
    Node65nmBulk,
    Node28nmHkmg,
    Node16nmFinFet,
    Node7nmFinFet,
}

/// Parámetros físicos del modelo de envejecimiento
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgingModelParameters {
    // NBTI (pMOS)
    pub a_nbti: f64,     // Coeficiente pre-exponencial NBTI
    pub gamma_nbti: f64, // Exponente de aceleración por tensión de compuerta (~1.8 - 2.5)
    pub ea_nbti: f64,    // Energía de activación térmica (eV) (~0.12 - 0.20 eV)
    pub n_nbti: f64,     // Exponente temporal de difusión (~0.16 - 0.25)
    // PBTI (nMOS)
    pub a_pbti: f64,     // Coeficiente pre-exponencial PBTI
    pub gamma_pbti: f64, // Exponente de aceleración de tensión
    pub ea_pbti: f64,    // Energía de activación térmica (eV) (~0.08 - 0.15 eV)
    pub n_pbti: f64,     // Exponente temporal (~0.12 - 0.20)
    // HCI (nMOS / pMOS)
    pub a_hci: f64,     // Coeficiente pre-exponencial HCI
    pub gamma_hci: f64, // Exponente de tensión de drenador
    pub ea_hci: f64,    // Energía de activación HCI (eV) (~ -0.05 a 0.05 eV)
    pub n_hci: f64,     // Exponente temporal HCI (~0.45 - 0.55)
    // Óxido y Movilidad
    pub tox_nm: f64,       // Espesor de óxido de compuerta equivalente (nm)
    pub mu_deg_coeff: f64, // Factor de acoplamiento de degradación de movilidad
}

impl Default for AgingModelParameters {
    fn default() -> Self {
        Self::for_node(ProcessTechnologyNode::Node28nmHkmg)
    }
}

impl AgingModelParameters {
    pub fn for_node(node: ProcessTechnologyNode) -> Self {
        match node {
            ProcessTechnologyNode::Node180nmPlanar => Self {
                a_nbti: 8.0e-5,
                gamma_nbti: 1.8,
                ea_nbti: 0.18,
                n_nbti: 0.25,
                a_pbti: 1.0e-6, // PBTI despreciable en SiO2 puro
                gamma_pbti: 1.5,
                ea_pbti: 0.10,
                n_pbti: 0.15,
                a_hci: 8.0e-7,
                gamma_hci: 2.2,
                ea_hci: -0.04, // Peor a baja temperatura
                n_hci: 0.50,
                tox_nm: 4.0,
                mu_deg_coeff: 0.65,
            },
            ProcessTechnologyNode::Node65nmBulk => Self {
                a_nbti: 1.2e-4,
                gamma_nbti: 2.0,
                ea_nbti: 0.15,
                n_nbti: 0.22,
                a_pbti: 1.5e-5,
                gamma_pbti: 1.6,
                ea_pbti: 0.10,
                n_pbti: 0.16,
                a_hci: 1.2e-6,
                gamma_hci: 2.4,
                ea_hci: -0.03,
                n_hci: 0.50,
                tox_nm: 1.8,
                mu_deg_coeff: 0.80,
            },
            ProcessTechnologyNode::Node28nmHkmg => Self {
                a_nbti: 1.8e-4,
                gamma_nbti: 2.2,
                ea_nbti: 0.14,
                n_nbti: 0.19,
                a_pbti: 6.0e-5, // Alto en High-κ Metal Gate
                gamma_pbti: 2.0,
                ea_pbti: 0.12,
                n_pbti: 0.18,
                a_hci: 1.6e-6,
                gamma_hci: 2.6,
                ea_hci: -0.02,
                n_hci: 0.52,
                tox_nm: 1.2,
                mu_deg_coeff: 1.00,
            },
            ProcessTechnologyNode::Node16nmFinFet => Self {
                a_nbti: 2.4e-4,
                gamma_nbti: 2.4,
                ea_nbti: 0.13,
                n_nbti: 0.18,
                a_pbti: 1.0e-4,
                gamma_pbti: 2.2,
                ea_pbti: 0.11,
                n_pbti: 0.17,
                a_hci: 2.2e-6,
                gamma_hci: 2.8,
                ea_hci: -0.01,
                n_hci: 0.54,
                tox_nm: 1.0,
                mu_deg_coeff: 1.20,
            },
            ProcessTechnologyNode::Node7nmFinFet => Self {
                a_nbti: 3.2e-4,
                gamma_nbti: 2.5,
                ea_nbti: 0.12,
                n_nbti: 0.17,
                a_pbti: 1.5e-4,
                gamma_pbti: 2.4,
                ea_pbti: 0.10,
                n_pbti: 0.16,
                a_hci: 3.0e-6,
                gamma_hci: 3.0,
                ea_hci: -0.01,
                n_hci: 0.55,
                tox_nm: 0.85,
                mu_deg_coeff: 1.40,
            },
        }
    }
}

/// Perfil de estrés electrotérmico aplicado al dispositivo
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgingStressProfile {
    pub vgs_stress: f64,    // Tensión compuerta-fuente de estrés (V)
    pub vds_stress: f64,    // Tensión drenador-fuente de estrés (V)
    pub temperature_k: f64, // Temperatura de unión durante el estrés (K)
    pub duty_cycle: f64,    // Ciclo de trabajo AC α (0.0 = OFF, 1.0 = DC continuo)
    pub is_pmos: bool, // True si es pMOS (predomina NBTI), False si es nMOS (predominan PBTI / HCI)
}

/// Resultado de la evaluación de envejecimiento
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgingDegradationResult {
    pub time_seconds: f64,
    pub time_years: f64,
    pub delta_vth_nbti: f64,    // Corrimiento Vth por NBTI (V)
    pub delta_vth_pbti: f64,    // Corrimiento Vth por PBTI (V)
    pub delta_vth_hci: f64,     // Corrimiento Vth por HCI (V)
    pub delta_vth_total: f64,   // Corrimiento Vth total (V)
    pub delta_ids_percent: f64, // Reducción de corriente de drenador (%)
    pub delta_gm_percent: f64,  // Reducción de transconductancia (%)
}

/// Resultado de la estimación de tiempo de vida útil (Lifetime)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LifetimeEstimationResult {
    pub time_to_failure_seconds: f64,
    pub time_to_failure_years: f64,
    pub dominant_mechanism: AgingMechanism,
    pub passed_10_year_target: bool,
    pub degradation_at_10_years: AgingDegradationResult,
}

/// Evalúa el corrimiento de Vth por NBTI (pMOS)
pub fn evaluate_nbti(
    stress: &AgingStressProfile,
    params: &AgingModelParameters,
    time_s: f64,
) -> f64 {
    if time_s <= 0.0 || !stress.is_pmos {
        return 0.0;
    }
    let v_eff = stress.vgs_stress.abs();
    let e_field = v_eff / (params.tox_nm * 0.1); // MV/cm
    let thermal_factor = (-params.ea_nbti / (KB_EV * stress.temperature_k)).exp();
    let ac_recovery_factor = stress.duty_cycle.max(0.01).powf(params.n_nbti);

    let delta_vth_dc = params.a_nbti
        * e_field.powf(params.gamma_nbti)
        * thermal_factor
        * time_s.powf(params.n_nbti);
    delta_vth_dc * ac_recovery_factor
}

/// Evalúa el corrimiento de Vth por PBTI (nMOS High-κ)
pub fn evaluate_pbti(
    stress: &AgingStressProfile,
    params: &AgingModelParameters,
    time_s: f64,
) -> f64 {
    if time_s <= 0.0 || stress.is_pmos {
        return 0.0;
    }
    let v_eff = stress.vgs_stress.abs();
    let e_field = v_eff / (params.tox_nm * 0.1); // MV/cm
    let thermal_factor = (-params.ea_pbti / (KB_EV * stress.temperature_k)).exp();
    let ac_recovery_factor = stress.duty_cycle.max(0.01).powf(params.n_pbti);

    let delta_vth_dc = params.a_pbti
        * e_field.powf(params.gamma_pbti)
        * thermal_factor
        * time_s.powf(params.n_pbti);
    delta_vth_dc * ac_recovery_factor
}

/// Evalúa el corrimiento de Vth por Hot Carrier Injection (HCI)
pub fn evaluate_hci(
    stress: &AgingStressProfile,
    params: &AgingModelParameters,
    time_s: f64,
) -> f64 {
    if time_s <= 0.0 {
        return 0.0;
    }
    let vds_eff = stress.vds_stress.abs();
    let vgs_eff = stress.vgs_stress.abs();

    // HCI máximo ocurre típicamente cerca de Vgs ≈ Vds / 2 o Vgs = Vds
    let vgs_factor = if vds_eff > 0.0 {
        (vgs_eff / vds_eff).clamp(0.2, 1.0)
    } else {
        0.0
    };

    // Los huecos en pMOS tienen una tasa de ionización por impacto ~10x menor que los electrones en nMOS
    let pmos_factor = if stress.is_pmos { 0.1 } else { 1.0 };

    let thermal_factor = (-params.ea_hci / (KB_EV * stress.temperature_k)).exp();
    let duty_factor = stress.duty_cycle.max(0.01).powf(params.n_hci);

    params.a_hci
        * pmos_factor
        * (vds_eff * vgs_factor).powf(params.gamma_hci)
        * thermal_factor
        * duty_factor
        * time_s.powf(params.n_hci)
}

/// Calcula la degradación electrotérmica acumulada total a un tiempo determinado
pub fn calculate_cumulative_aging(
    stress: &AgingStressProfile,
    params: &AgingModelParameters,
    time_s: f64,
) -> AgingDegradationResult {
    let delta_vth_nbti = evaluate_nbti(stress, params, time_s);
    let delta_vth_pbti = evaluate_pbti(stress, params, time_s);
    let delta_vth_hci = evaluate_hci(stress, params, time_s);

    let delta_vth_total = delta_vth_nbti + delta_vth_pbti + delta_vth_hci;

    // Reducción porcentual de Ids y gm basada en corrimiento de Vth y dispersión de movilidad
    let vgs_overdrive = (stress.vgs_stress.abs() - 0.4).max(0.1);
    let vth_impact_ratio = delta_vth_total / vgs_overdrive;
    let mobility_factor = 1.0 + 0.3 * params.mu_deg_coeff;

    let delta_ids_percent = ((vth_impact_ratio * mobility_factor) * 100.0).min(90.0);
    let delta_gm_percent =
        ((vth_impact_ratio * (0.8 + 0.2 * params.mu_deg_coeff)) * 100.0).min(90.0);

    AgingDegradationResult {
        time_seconds: time_s,
        time_years: time_s / (365.25 * 86400.0),
        delta_vth_nbti,
        delta_vth_pbti,
        delta_vth_hci,
        delta_vth_total,
        delta_ids_percent,
        delta_gm_percent,
    }
}

/// Estima la vida útil (Time-to-Failure) para un criterio de fallo (por defecto ΔVth >= 50 mV o ΔIds >= 10%)
pub fn estimate_device_lifetime(
    stress: &AgingStressProfile,
    params: &AgingModelParameters,
    max_delta_vth: f64,
    max_delta_ids_pct: f64,
) -> LifetimeEstimationResult {
    let ten_years_s = 10.0 * 365.25 * 86400.0;
    let deg_10y = calculate_cumulative_aging(stress, params, ten_years_s);

    // Bisección temporal / Newton para encontrar TTF exacto
    let mut t_low: f64 = 1.0;
    let mut t_high: f64 = 100.0 * 365.25 * 86400.0; // 100 años

    for _ in 0..40 {
        let t_mid: f64 = (t_low * t_high).sqrt(); // Bisección logarítmica
        let res = calculate_cumulative_aging(stress, params, t_mid);

        if res.delta_vth_total >= max_delta_vth || res.delta_ids_percent >= max_delta_ids_pct {
            t_high = t_mid;
        } else {
            t_low = t_mid;
        }
    }

    let ttf_s = (t_low * t_high).sqrt();
    let ttf_years = ttf_s / (365.25 * 86400.0);

    let dominant_mechanism = if deg_10y.delta_vth_nbti > deg_10y.delta_vth_pbti
        && deg_10y.delta_vth_nbti > deg_10y.delta_vth_hci
    {
        AgingMechanism::NBTI
    } else if deg_10y.delta_vth_pbti > deg_10y.delta_vth_hci {
        AgingMechanism::PBTI
    } else {
        AgingMechanism::HCI
    };

    LifetimeEstimationResult {
        time_to_failure_seconds: ttf_s,
        time_to_failure_years: ttf_years,
        dominant_mechanism,
        passed_10_year_target: ttf_years >= 10.0,
        degradation_at_10_years: deg_10y,
    }
}
