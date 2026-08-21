//! ==========================================================================
//! ASTRYD SOPHIA — RADIATION EFFECTS & HARDENING MODELS (TID & SEE)
//! ==========================================================================
//!
//! Modelado de efectos de radiación ionizante y partículas energéticas para
//! aplicaciones espaciales (LEO/GEO/Deep Space) y defensa:
//!
//! 1. TID (Total Ionizing Dose):
//!    - Carga atrapada en óxido Not (corrimiento negativo de Vth)
//!    - Trampas de interfaz Nit (degradación de pendiente subumbral)
//!    - Fuga parasitaria de borde STI (Shallow Trench Isolation leakage)
//! 2. SEE (Single-Event Effects):
//!    - SET (Single-Event Transient): Inyección de pulsos de corriente doble-exponenciales
//!      derivados de LET (Linear Energy Transfer) y longitud de colección de carga.
//!    - SEU (Single-Event Upset): Carga crítica Qcrit y probabilidad de inversión lógica.
//!    - SEL (Single-Event Latchup): Detección de disparo de tiristor parásito PNPN.
//! 3. Perfiles de Misión Espacial / Estándares Militares (MIL-STD-883).

use serde::{Deserialize, Serialize};

/// Factor de conversión de LET a carga depositada en silicio (pC por MeV·cm²/mg por µm)
/// ρ_Si = 2.33 g/cm³, 1 eV = 3.6 eV por par e-h en Si -> ~0.0103 pC/(MeV·cm²/mg·µm)
pub const LET_TO_CHARGE_PC_PER_UM: f64 = 0.01036;

/// Perfiles estándar de entorno de radiación
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SpaceMissionProfile {
    LeoLowAltitude,   // LEO 500 km (baja radiación, ~5-15 krad/5 años)
    LeoPolarSat,      // LEO Polar / Auroral (~20-50 krad)
    Geo15Year,        // Geoestacionario cinturón Van Allen (~100 krad con blindaje)
    DeepSpaceEuropa,  // Cinturón de radiación severo de Júpiter (>300 krad)
    MilStd883RadHard, // Calificación militar rad-hard (>1000 krad / 1 Mrad)
    CommercialCots,   // COTS sin blindaje (<5 krad)
}

/// Nivel de endurecimiento a radiación (Rad-Hard Design)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RadiationHardeningLevel {
    UnmitigatedCots,     // Comercial estándar
    EnclosedShielding,   // Blindaje mecánico Spot Shielding (Ta/Al)
    RadTolerant,         // Procesos con óxido fino y anillos de guarda (Guard Rings)
    RadHardByDesignRhbd, // RHBD (ELT - Enclosed Layout Transistors + Dual Interlocked Cells)
}

/// Parámetros tecnológicos de respuesta a TID
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TidTechnologyParameters {
    pub a_not: f64,           // Coeficiente de atrapamiento de huecos Not (V/krad^alpha)
    pub alpha_not: f64,       // Exponente de dosis de carga de óxido (~0.6 - 0.9)
    pub a_nit: f64,           // Coeficiente de generación de trampas de interfaz Nit
    pub alpha_nit: f64,       // Exponente de dosis de trampas de interfaz (~0.5 - 0.7)
    pub sti_leak_sat: f64,    // Corriente de fuga máxima por borde STI (A)
    pub d_crit_sti_krad: f64, // Dosis característica de activación de canal STI (krad)
    pub s_degradation_factor: f64, // Factor de ensanchamiento de pendiente subumbral (mV/dec/krad)
}

impl Default for TidTechnologyParameters {
    fn default() -> Self {
        Self::for_hardening(RadiationHardeningLevel::UnmitigatedCots)
    }
}

impl TidTechnologyParameters {
    pub fn for_hardening(level: RadiationHardeningLevel) -> Self {
        match level {
            RadiationHardeningLevel::UnmitigatedCots => Self {
                a_not: 1.5e-3,
                alpha_not: 0.85,
                a_nit: 4.0e-4,
                alpha_nit: 0.65,
                sti_leak_sat: 1.0e-6, // 1 µA de fuga
                d_crit_sti_krad: 25.0,
                s_degradation_factor: 0.25,
            },
            RadiationHardeningLevel::EnclosedShielding => Self {
                a_not: 8.0e-4,
                alpha_not: 0.80,
                a_nit: 2.0e-4,
                alpha_nit: 0.60,
                sti_leak_sat: 2.0e-7,
                d_crit_sti_krad: 50.0,
                s_degradation_factor: 0.15,
            },
            RadiationHardeningLevel::RadTolerant => Self {
                a_not: 3.0e-4,
                alpha_not: 0.75,
                a_nit: 8.0e-5,
                alpha_nit: 0.55,
                sti_leak_sat: 1.0e-8,
                d_crit_sti_krad: 100.0,
                s_degradation_factor: 0.08,
            },
            RadiationHardeningLevel::RadHardByDesignRhbd => Self {
                a_not: 5.0e-5,
                alpha_not: 0.65,
                a_nit: 1.5e-5,
                alpha_nit: 0.50,
                sti_leak_sat: 1.0e-11, // Anillos de guarda eliminan camino parásito
                d_crit_sti_krad: 500.0,
                s_degradation_factor: 0.01,
            },
        }
    }
}

/// Parámetros de inyección de evento único transitorio (SET)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SingleEventTransientSpec {
    pub strike_time_s: f64,       // Instante de impacto de la partícula (s)
    pub let_mev_cm2_mg: f64,      // Transferencia lineal de energía LET (MeV·cm²/mg)
    pub collection_depth_um: f64, // Profundidad de colección / longitud de embudo (funneling depth, µm)
    pub tau_rise_s: f64,          // Tiempo de subida de la corriente de colección (s) (~5 - 20 ps)
    pub tau_fall_s: f64,          // Tiempo de bajada / difusión de portadores (s) (~100 - 500 ps)
}

impl Default for SingleEventTransientSpec {
    fn default() -> Self {
        Self {
            strike_time_s: 1.0e-6,
            let_mev_cm2_mg: 40.0, // Típico ion pesado galáctico (GCR)
            collection_depth_um: 2.0,
            tau_rise_s: 10.0e-12,  // 10 ps
            tau_fall_s: 200.0e-12, // 200 ps
        }
    }
}

/// Resultado de la degradación por dosis ionizante acumulada (TID)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TidDegradationResult {
    pub total_dose_krad: f64,
    pub delta_vth_nmos: f64,            // Corrimiento neto de Vth en nMOS (V)
    pub delta_vth_pmos: f64,            // Corrimiento neto de Vth en pMOS (V)
    pub delta_vth_not: f64,             // Contribución de carga de óxido (V)
    pub delta_vth_nit: f64,             // Contribución de trampas de interfaz (V)
    pub sti_leakage_current_a: f64,     // Fuga parasitaria de borde STI (A)
    pub subthreshold_swing_mv_dec: f64, // Pendiente subumbral degradada (mV/dec)
    pub functional_status_ok: bool,     // True si el dispositivo mantiene márgenes de ruido
}

/// Resultado del análisis de vulnerabilidad a Single-Event Upset (SEU)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeuVulnerabilityResult {
    pub critical_charge_fc: f64, // Carga crítica Qcrit para invertir el estado lógico (fC)
    pub collected_charge_fc: f64, // Carga total inyectada por el impacto Qcoll (fC)
    pub upset_occurred: bool,    // True si Qcoll >= Qcrit
    pub safety_margin: f64,      // Qcrit / Qcoll
}

/// Evalúa la degradación de un dispositivo ante una dosis acumulada TID
pub fn evaluate_tid_degradation(
    dose_krad: f64,
    params: &TidTechnologyParameters,
    nominal_subthreshold_swing: f64,
) -> TidDegradationResult {
    if dose_krad <= 0.0 {
        return TidDegradationResult {
            total_dose_krad: 0.0,
            delta_vth_nmos: 0.0,
            delta_vth_pmos: 0.0,
            delta_vth_not: 0.0,
            delta_vth_nit: 0.0,
            sti_leakage_current_a: 0.0,
            subthreshold_swing_mv_dec: nominal_subthreshold_swing,
            functional_status_ok: true,
        };
    }

    // Corrimiento por carga atrapada en el óxido (huecos atrapados -> polaridad negativa)
    let delta_vth_not = -params.a_not * dose_krad.powf(params.alpha_not);

    // Corrimiento por trampas de interfaz (donores/aceptores cargados en Si-SiO2)
    let delta_vth_nit = params.a_nit * dose_krad.powf(params.alpha_nit);

    // En nMOS, Not disminuye Vth (rebote) mientras que Nit aumenta Vth
    let delta_vth_nmos = delta_vth_not + delta_vth_nit;

    // En pMOS, ambos corren |Vth| hacia valores más altos (más difícil de encender)
    let delta_vth_pmos = delta_vth_not - delta_vth_nit;

    // Fuga parásita por bordes de trinchera STI
    let sti_leakage = params.sti_leak_sat * (1.0 - (-dose_krad / params.d_crit_sti_krad).exp());

    // Degradación de la pendiente subumbral por incremento de Nit
    let subthreshold_swing = nominal_subthreshold_swing + params.s_degradation_factor * dose_krad;

    // Criterio de funcionalidad: pérdida de funcionalidad si |ΔVth| > 250 mV o fuga > 100 nA
    let functional_status_ok =
        delta_vth_nmos.abs() < 0.250 && delta_vth_pmos.abs() < 0.250 && sti_leakage < 1.0e-7;

    TidDegradationResult {
        total_dose_krad: dose_krad,
        delta_vth_nmos,
        delta_vth_pmos,
        delta_vth_not,
        delta_vth_nit,
        sti_leakage_current_a: sti_leakage,
        subthreshold_swing_mv_dec: subthreshold_swing,
        functional_status_ok,
    }
}

/// Calcula el valor instantáneo de la corriente del pulso SET (Messenger double-exponential)
pub fn calculate_set_current_instant(spec: &SingleEventTransientSpec, time_s: f64) -> f64 {
    if time_s < spec.strike_time_s {
        return 0.0;
    }

    let dt = time_s - spec.strike_time_s;

    // Carga total depositada Q = LET * L_collection * Factor (en Coulombs)
    let q_total_c =
        spec.let_mev_cm2_mg * spec.collection_depth_um * LET_TO_CHARGE_PC_PER_UM * 1.0e-12;

    // Amplitud pico I0 para satisfacer la integral Q = I0 * (tau_fall - tau_rise)
    let delta_tau = (spec.tau_fall_s - spec.tau_rise_s).max(1.0e-15);
    let i0 = q_total_c / delta_tau;

    let exp_fall = (-dt / spec.tau_fall_s).exp();
    let exp_rise = (-dt / spec.tau_rise_s).exp();

    (i0 * (exp_fall - exp_rise)).max(0.0)
}

/// Evalúa la carga total depositada y la vulnerabilidad a SEU para un nodo capacitivo
pub fn evaluate_seu_vulnerability(
    node_capacitance_f: f64,
    voltage_swing_v: f64,
    spec: &SingleEventTransientSpec,
) -> SeuVulnerabilityResult {
    // Carga crítica Qcrit = C_node * (V_swing / 2)
    let q_crit_c = node_capacitance_f * (voltage_swing_v * 0.5);
    let q_crit_fc = q_crit_c * 1.0e15;

    // Carga total inyectada
    let q_coll_c =
        spec.let_mev_cm2_mg * spec.collection_depth_um * LET_TO_CHARGE_PC_PER_UM * 1.0e-12;
    let q_coll_fc = q_coll_c * 1.0e15;

    let upset_occurred = q_coll_fc >= q_crit_fc;
    let safety_margin = if q_coll_fc > 0.0 {
        q_crit_fc / q_coll_fc
    } else {
        f64::INFINITY
    };

    SeuVulnerabilityResult {
        critical_charge_fc: q_crit_fc,
        collected_charge_fc: q_coll_fc,
        upset_occurred,
        safety_margin,
    }
}
