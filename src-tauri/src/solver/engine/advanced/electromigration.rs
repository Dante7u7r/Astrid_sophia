//! ==========================================================================
//! ASTRYD SOPHIA — ELECTROMIGRATION (EM) & IR DROP ANALYSIS ENGINE
//! ==========================================================================
//!
//! Modelado físico de integridad de potencia (Power Integrity - PI) y fiabilidad
//! de interconexiones en circuitos integrados (IC) y placas de circuito impreso (PCB):
//!
//! 1. Caída de Tensión IR (IR Drop Mapping):
//!    - Resistencia de lámina Rsheet, resistencia geométrica de pista y vía.
//!    - Mapeo de caída de tensión estática (DC) y dinámica a lo largo de la red PDN.
//! 2. Densidad de Corriente (Current Density J):
//!    - J = I / (W * t) en MA/cm² o A/mm².
//! 3. Ecuación de Black para Electromigración (EM MTTF):
//!    - MTTF = (A / J^n) * exp(Ea / (kB * T))
//!    - Calentamiento Joule por corriente RMS: ΔT = θth * I²R.
//! 4. Efecto Blech (Blech Immortality Rule / Short-Length Effect):
//!    - Si (J * L) < (J * L)crit, el gradiente de tensión mecánica contrarresta
//!      el viento de electrones, haciendo la pista inmortal a la electromigración.

use serde::{Deserialize, Serialize};

use super::aging::KB_EV;

/// Material de la pista / interconexión
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InterconnectMaterial {
    CopperCu,     // Cobre con barrera TaN/TiN (Ea ≈ 0.90 eV, ρ ≈ 1.7e-8 Ω·m)
    AluminumAl,   // Aluminio / Al-Cu (Ea ≈ 0.65 eV, ρ ≈ 2.8e-8 Ω·m)
    TungstenW,    // Wolframio para vías y contactos (Ea ≈ 0.85 eV, ρ ≈ 5.6e-8 Ω·m)
    GoldAu,       // Oro para wirebonding (Ea ≈ 0.80 eV, ρ ≈ 2.4e-8 Ω·m)
    PcbCopper1Oz, // Cobre PCB 1 oz (35 µm de espesor, ρ ≈ 1.72e-8 Ω·m)
    PcbCopper2Oz, // Cobre PCB 2 oz (70 µm de espesor, ρ ≈ 1.72e-8 Ω·m)
}

impl InterconnectMaterial {
    /// Resistividad eléctrica a 300 K (Ω·m)
    pub fn resistivity_ohm_m(&self) -> f64 {
        match self {
            InterconnectMaterial::CopperCu => 1.72e-8,
            InterconnectMaterial::AluminumAl => 2.82e-8,
            InterconnectMaterial::TungstenW => 5.60e-8,
            InterconnectMaterial::GoldAu => 2.44e-8,
            InterconnectMaterial::PcbCopper1Oz => 1.72e-8,
            InterconnectMaterial::PcbCopper2Oz => 1.72e-8,
        }
    }

    /// Energía de activación para electromigración Ea (eV)
    pub fn activation_energy_ev(&self) -> f64 {
        match self {
            InterconnectMaterial::CopperCu => 0.90,
            InterconnectMaterial::AluminumAl => 0.65,
            InterconnectMaterial::TungstenW => 0.85,
            InterconnectMaterial::GoldAu => 0.80,
            InterconnectMaterial::PcbCopper1Oz => 0.95,
            InterconnectMaterial::PcbCopper2Oz => 0.95,
        }
    }

    /// Umbral de producto de Blech crítico (J * L)crit en A/cm
    pub fn blech_product_crit_a_per_cm(&self) -> f64 {
        match self {
            InterconnectMaterial::CopperCu => 2500.0,
            InterconnectMaterial::AluminumAl => 1500.0,
            InterconnectMaterial::TungstenW => 4000.0,
            InterconnectMaterial::GoldAu => 2000.0,
            InterconnectMaterial::PcbCopper1Oz => 50000.0, // En PCB las dimensiones son macroscópicas
            InterconnectMaterial::PcbCopper2Oz => 50000.0,
        }
    }

    /// Límite de densidad de corriente DC admisible a 105 °C (MA/cm²)
    pub fn j_max_ref_ma_per_cm2(&self) -> f64 {
        match self {
            InterconnectMaterial::CopperCu => 1.5,      // 1.5 MA/cm²
            InterconnectMaterial::AluminumAl => 0.5,    // 0.5 MA/cm²
            InterconnectMaterial::TungstenW => 2.5,     // 2.5 MA/cm²
            InterconnectMaterial::GoldAu => 1.0,        // 1.0 MA/cm²
            InterconnectMaterial::PcbCopper1Oz => 0.05, // 0.05 MA/cm² (50 kA/cm² para IPC-2152)
            InterconnectMaterial::PcbCopper2Oz => 0.05,
        }
    }
}

/// Parámetros geométricos y térmicos de un segmento de interconexión
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterconnectSegmentSpec {
    pub segment_id: String,
    pub source_node: String,
    pub target_node: String,
    pub length_um: f64,    // Longitud del segmento (µm)
    pub width_um: f64,     // Ancho de la pista (µm)
    pub thickness_nm: f64, // Espesor de la capa de metal (nm)
    pub material: InterconnectMaterial,
    pub current_a: f64,     // Corriente que fluye por la pista (A)
    pub temperature_k: f64, // Temperatura del metal (K)
}

/// Resultado del análisis de Electromigración (EM) en un segmento
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentEmAnalysisResult {
    pub current_density_ma_per_cm2: f64, // Densidad de corriente J (MA/cm²)
    pub blech_product_a_per_cm: f64,     // Producto J * L (A/cm)
    pub is_blech_immortal: bool,         // True si (J * L) < (J * L)crit
    pub mttf_hours: f64,                 // Tiempo medio hasta el fallo MTTF (horas)
    pub mttf_years: f64,                 // MTTF en años
    pub em_violation: bool,              // True si supera J_max y no es inmortal
    pub max_allowed_density_ma_per_cm2: f64,
}

/// Resultado del análisis de Caída de Tensión IR (IR Drop) en un segmento
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentIrDropResult {
    pub resistance_ohms: f64, // Resistencia de la pista R = ρ * L / (W * t) (Ω)
    pub voltage_drop_v: f64,  // Caída de tensión ΔV = I * R (V)
    pub voltage_drop_percent: f64, // Caída porcentual respecto a V_nominal
    pub is_ir_drop_violation: bool, // True si ΔV% supera el presupuesto (ej. > 3%)
}

/// Resultado completo de integridad física para un segmento
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterconnectHealthResult {
    pub segment_id: String,
    pub em: SegmentEmAnalysisResult,
    pub ir: SegmentIrDropResult,
    pub has_any_violation: bool,
}

/// Evalúa la resistencia eléctrica de una pista rectangular
pub fn calculate_trace_resistance(
    length_um: f64,
    width_um: f64,
    thickness_nm: f64,
    material: InterconnectMaterial,
    temperature_k: f64,
) -> f64 {
    let l_m = length_um * 1.0e-6;
    let w_m = width_um * 1.0e-6;
    let t_m = thickness_nm * 1.0e-9;
    let area_m2 = (w_m * t_m).max(1.0e-20);

    // Coeficiente de temperatura del cobre/aluminio: α ≈ 0.00393 1/K
    let rho_300 = material.resistivity_ohm_m();
    let temp_coeff = 0.00393;
    let rho_t = rho_300 * (1.0 + temp_coeff * (temperature_k - 300.0)).max(0.1);

    rho_t * l_m / area_m2
}

/// Evalúa el análisis de Electromigración (EM) mediante Black y Blech
pub fn evaluate_segment_em(
    spec: &InterconnectSegmentSpec,
    a_em_constant: f64, // Constante de proceso A_EM (típicamente 1e12 a 1e16)
) -> SegmentEmAnalysisResult {
    let w_cm = spec.width_um * 1.0e-4;
    let t_cm = (spec.thickness_nm * 1.0e-9) * 1.0e2; // nm a cm
    let area_cm2 = (w_cm * t_cm).max(1.0e-15);

    let current_abs_a = spec.current_a.abs();
    let j_a_per_cm2 = current_abs_a / area_cm2;
    let j_ma_per_cm2 = j_a_per_cm2 * 1.0e-6;

    // Producto de Blech: J (A/cm²) * L (cm) = A/cm
    let l_cm = spec.length_um * 1.0e-4;
    let blech_product_a_per_cm = j_a_per_cm2 * l_cm;
    let blech_crit = spec.material.blech_product_crit_a_per_cm();
    let is_blech_immortal = blech_product_a_per_cm < blech_crit;

    // Límite térmico ajustado de densidad máxima
    let t_ref_k = 378.15; // 105 °C
    let ea = spec.material.activation_energy_ev();
    let temp_ratio = (-ea / KB_EV * (1.0 / spec.temperature_k - 1.0 / t_ref_k)).exp();
    let max_allowed_density_ma_per_cm2 = spec.material.j_max_ref_ma_per_cm2() * temp_ratio;

    // Ecuación de Black para MTTF: MTTF = (A / J²) * exp(Ea / (kB * T))
    let n_exponent = 2.0;
    let mttf_hours = if j_a_per_cm2 > 0.0 {
        if is_blech_immortal {
            f64::INFINITY // Pista mecánicamente inmortal por gradiente de tensión
        } else {
            let thermal_factor = (ea / (KB_EV * spec.temperature_k)).exp();
            let black_term = a_em_constant / j_a_per_cm2.powf(n_exponent);
            (black_term * thermal_factor).min(1.0e12)
        }
    } else {
        f64::INFINITY
    };

    let mttf_years = mttf_hours / 8766.0;
    let em_violation =
        !is_blech_immortal && (j_ma_per_cm2 > max_allowed_density_ma_per_cm2 || mttf_years < 10.0);

    SegmentEmAnalysisResult {
        current_density_ma_per_cm2: j_ma_per_cm2,
        blech_product_a_per_cm,
        is_blech_immortal,
        mttf_hours,
        mttf_years,
        em_violation,
        max_allowed_density_ma_per_cm2,
    }
}

/// Evalúa la caída de tensión IR en el segmento
pub fn evaluate_segment_ir_drop(
    spec: &InterconnectSegmentSpec,
    v_nominal: f64,
    max_drop_budget_percent: f64,
) -> SegmentIrDropResult {
    let r_ohms = calculate_trace_resistance(
        spec.length_um,
        spec.width_um,
        spec.thickness_nm,
        spec.material,
        spec.temperature_k,
    );

    let v_drop = spec.current_a.abs() * r_ohms;
    let v_drop_pct = if v_nominal > 0.0 {
        (v_drop / v_nominal) * 100.0
    } else {
        0.0
    };

    let is_ir_drop_violation = v_drop_pct > max_drop_budget_percent;

    SegmentIrDropResult {
        resistance_ohms: r_ohms,
        voltage_drop_v: v_drop,
        voltage_drop_percent: v_drop_pct,
        is_ir_drop_violation,
    }
}

/// Analiza la salud completa (EM e IR Drop) de un segmento
pub fn analyze_interconnect_segment(
    spec: &InterconnectSegmentSpec,
    v_nominal: f64,
    max_drop_budget_percent: f64,
    a_em_constant: f64,
) -> InterconnectHealthResult {
    let em = evaluate_segment_em(spec, a_em_constant);
    let ir = evaluate_segment_ir_drop(spec, v_nominal, max_drop_budget_percent);
    let has_any_violation = em.em_violation || ir.is_ir_drop_violation;

    InterconnectHealthResult {
        segment_id: spec.segment_id.clone(),
        em,
        ir,
        has_any_violation,
    }
}
