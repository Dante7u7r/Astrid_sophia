//! ==========================================================================
//! ASTRYD SOPHIA — HEFNER PHYSICAL IGBT MODEL (NIST / IEEE Trans. Power Electronics)
//! ==========================================================================
//!
//! Modelo físico analítico no lineal para transistores bipolares de puerta aislada (IGBT):
//! 1. Sección de entrada MOSFET de canal N con saturación y modulación de canal.
//! 2. Transistor PNP de base ancha con modulación de anchura de base (W_B(Vce)).
//! 3. Dinámica de almacenamiento de portadores minoritarios en la base de deriva (Q_B(t))
//!    para reproducir con exactitud la corriente de cola (Tail Current) en el apagado.
//! 4. Capacitancias no lineales dependientes de tensión (Cies, Cres, Coes / Miller).
//! 5. Dependencia térmica en Vth, Kp, y tiempo de vida tau_HL.

use serde::{Deserialize, Serialize};

/// Parámetros físicos para el modelo de IGBT (ej: IKW40N120H3, FGA25N120ANTD)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IgbtParams {
    pub vth: f64,          // Tensión de umbral de compuerta Vth (V) (~4.0 - 6.0 V)
    pub kp: f64,           // Parámetro de transconductancia MOS Kp (A/V^2) (~5.0 - 25.0)
    pub lambda: f64,       // Modulación de canal Early (1/V) (~0.002)
    pub alpha_pnp: f64,    // Factor de ganancia base ancha PNP alfa_0 (~0.4 - 0.7)
    pub tau_hl: f64,       // Tiempo de recombinación a alto nivel de inyección (s) (~1.0 - 4.0 µs)
    pub wb0: f64,          // Anchura de base de deriva a Vce=0 (m) (~80e-6 m)
    pub bv_ces: f64,       // Tensión de ruptura Colector-Emisor (V) (~1200 V)
    pub is_pnp: f64,       // Corriente de saturación de la unión emisor-base PNP (A) (~1e-12 A)
    pub v_eb0: f64,        // Tensión de codo de la unión emisor-base (V) (~0.7 V)
    pub cge: f64,          // Capacidad Gate-Emitter (F) (~1.5 - 4.0 nF)
    pub cgc0: f64,         // Capacidad Gate-Collector a Vce=0 (F) (~100 - 400 pF)
    pub cce0: f64,         // Capacidad Collector-Emitter a Vce=0 (F) (~200 - 800 pF)
    pub v0_gc: f64,        // Tensión de escala para Miller Cgc (V) (~10.0 V)
    pub m_gc: f64,         // Exponente de variación de capacidad Miller (~0.6)
    pub temp_coeff_vth: f64, // Coeficiente térmico de Vth (V/K) (~ -0.004)
    pub temp_coeff_kp: f64,  // Exponente térmico de Kp (~ -1.5)
}

impl Default for IgbtParams {
    fn default() -> Self {
        Self {
            vth: 5.0,
            kp: 12.0,
            lambda: 0.002,
            alpha_pnp: 0.55,
            tau_hl: 1.8e-6, // 1.8 µs
            wb0: 90e-6,
            bv_ces: 1200.0,
            is_pnp: 1e-12,
            v_eb0: 0.72,
            cge: 2.2e-9,    // 2.2 nF
            cgc0: 180e-12,  // 180 pF
            cce0: 350e-12,  // 350 pF
            v0_gc: 12.0,
            m_gc: 0.65,
            temp_coeff_vth: -0.004,
            temp_coeff_kp: -1.5,
        }
    }
}

/// Resultado de la evaluación física no lineal del IGBT
#[derive(Debug, Clone, Copy)]
pub struct IgbtEvaluationResult {
    pub ic: f64,       // Corriente total de colector (A)
    pub ie: f64,       // Corriente de emisor (A)
    pub gm: f64,       // Transconductancia d(Ic)/d(Vge) (S)
    pub go: f64,       // Conductancia de salida d(Ic)/d(Vce) (S)
    pub cge: f64,      // Capacidad dinámica Cge (F)
    pub cgc: f64,      // Capacidad dinámica Cgc (Miller) (F)
    pub cce: f64,      // Capacidad dinámica Cce (F)
    pub q_b: f64,      // Carga almacenada de portadores minoritarios en base de deriva (C)
}

/// Evalúa el modelo de Hefner para el IGBT en un punto de operación (Vge, Vce, T, q_b_prev)
pub fn evaluate_igbt(
    vge: f64,
    vce: f64,
    params: &IgbtParams,
    temp_celsius: Option<f64>,
    q_b_prev: Option<f64>,
    dt: Option<f64>,
) -> IgbtEvaluationResult {
    let t_c = temp_celsius.unwrap_or(25.0);
    let t_k = t_c + 273.15;
    let t_nom = 298.15; // 25 °C

    // Deriva térmica de parámetros físicos
    let temp_diff = t_k - t_nom;
    let vth_eff = (params.vth + params.temp_coeff_vth * temp_diff).max(1.0);
    let kp_eff = params.kp * (t_k / t_nom).powf(params.temp_coeff_kp);
    let tau_eff = params.tau_hl * (t_k / t_nom).powf(1.2);

    // 1. Tensión de codo de la unión emisor-base PNP
    let v_eb = if vce > 0.1 {
        params.v_eb0.min(vce * 0.8)
    } else {
        (vce * 0.5).max(0.0)
    };

    // Tensión interna aplicada a la sección MOSFET (Vds,mos = Vce - V_eb)
    let vds_mos = (vce - v_eb).max(0.0);

    // 2. Modulación de base de deriva W_B(Vce)
    let base_mod = (1.0 - (vce / params.bv_ces).clamp(0.0, 0.95)).sqrt().max(0.05);
    let alpha_eff = (params.alpha_pnp / base_mod.max(0.2)).clamp(0.1, 0.85);

    // 3. Corriente de la sección MOSFET (Imos) y sus derivadas
    let vov = vge - vth_eff;
    let (i_mos, gm_mos, gds_mos) = if vov <= 0.0 || vds_mos <= 0.0 {
        // Corte (OFF)
        let gmin_leak = 1e-12;
        (vce * gmin_leak, 0.0, gmin_leak)
    } else if vds_mos < vov {
        // Región lineal (Triodo)
        let imos_base = kp_eff * (vov * vds_mos - 0.5 * vds_mos * vds_mos);
        let early = 1.0 + params.lambda * vce;
        let imos = imos_base * early;
        let gm = kp_eff * vds_mos * early;
        let gds = (kp_eff * (vov - vds_mos) * early) + (imos_base * params.lambda);
        (imos, gm, gds)
    } else {
        // Región de saturación
        let imos_base = 0.5 * kp_eff * vov * vov;
        let early = 1.0 + params.lambda * vce;
        let imos = imos_base * early;
        let gm = kp_eff * vov * early;
        let gds = imos_base * params.lambda;
        (imos, gm, gds)
    };

    // 4. Ganancia bipolar y corriente de colector continua
    let denom = (1.0 - alpha_eff).max(0.05);
    let ic_steady = i_mos / denom;
    let gm_total = gm_mos / denom;
    let go_total = gds_mos / denom;

    // 5. Dinámica de almacenamiento de carga Q_B y cola de corriente (Tail Current)
    let q_b_target = ic_steady * tau_eff * alpha_eff;
    let (q_b_now, i_tail) = if let (Some(qb_old), Some(step_dt)) = (q_b_prev, dt) {
        if step_dt > 1e-15 {
            // Integración exponencial analítica exacta: d(Q_B)/dt = (Q_target - Q_B) / tau_eff
            let decay = (-step_dt / tau_eff.max(1e-12)).exp();
            let qb_updated = q_b_target + (qb_old - q_b_target) * decay;
            let tail = (qb_updated / tau_eff.max(1e-12)) * (alpha_eff / denom);
            (qb_updated, tail)
        } else {
            (q_b_target, 0.0)
        }
    } else {
        (q_b_target, 0.0)
    };

    // Si el MOSFET está apagado pero hay carga residual, la corriente de cola mantiene la conducción
    let ic_total = if vov <= 0.0 {
        i_tail.max(vce * 1e-12)
    } else {
        ic_steady
    };

    // 6. Capacitancias no lineales dependientes de Vce (Miller Cgc)
    let cgc = params.cgc0 / (1.0 + vce.abs() / params.v0_gc).powf(params.m_gc);
    let cce = params.cce0 / (1.0 + vce.abs() / (params.v0_gc * 2.0)).powf(0.5);
    let cge = params.cge;

    IgbtEvaluationResult {
        ic: ic_total,
        ie: ic_total, // Corriente de emisor despreciando fugas de compuerta
        gm: gm_total,
        go: go_total,
        cge,
        cgc,
        cce,
        q_b: q_b_now,
    }
}
