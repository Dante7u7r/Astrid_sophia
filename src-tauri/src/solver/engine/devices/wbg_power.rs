//! ==========================================================================
//! ASTRYD SOPHIA — WIDE-BANDGAP (WBG) POWER SEMICONDUCTORS (SiC & GaN)
//! ==========================================================================
//!
//! Modelos físicos avanzados para electrónica de potencia de alta frecuencia:
//! 1. SiC MOSFET (Silicon Carbide):
//!    - Conducción en 1er cuadrante con saturación de velocidad.
//!    - Conducción en 3er cuadrante (body diode intrínseco de alta banda prohibida ~3.2V + canal síncrono).
//!    - Capacitancias no lineales dependientes de tensión Cgd(Vds), Cds(Vds), Cgs.
//!    - Deriva electrotérmica (coeficiente positivo de Rds_on y negativo de Vth).
//! 2. GaN E-HEMT (Gallium Nitride Enhancement-Mode):
//!    - Canal 2DEG (Two-Dimensional Electron Gas) de alta movilidad.
//!    - Conducción en 3er cuadrante bidireccional sin diodo p-n intrínseco (Qrr = 0).
//!    - Caída de tensión inversa auto-polarizada Vdrop = Vth - Vgs cuando Vgs < Vth.
//!    - Capacitancias parásitas ultra-bajas con colapso de Miller.

/// Parámetros físicos para SiC MOSFET (ej: C3M0065090D, NVH4L020N120SC1)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SicMosfetParams {
    pub vth: f64,            // Tensión de umbral Vth (V) a T0 (~2.5 - 3.5 V)
    pub rds_on: f64,         // Resistencia ON nominal (Ω) (~0.02 - 0.08 Ω)
    pub lambda: f64,         // Modulación de longitud de canal (1/V) (~0.01)
    pub theta: f64,          // Coeficiente de saturación de velocidad (1/V) (~0.05)
    pub is_body: f64,        // Corriente de saturación del body diode (A) (~1e-16)
    pub n_body: f64,         // Factor de idealidad del body diode (~1.2 - 1.5)
    pub v_knee_body: f64,    // Tensión de codo del body diode SiC (~3.2 V)
    pub cgd0: f64,           // Capacidad Gate-Drain a Vds=0 (F) (~100 - 300 pF)
    pub cds0: f64,           // Capacidad Drain-Source a Vds=0 (F) (~500 - 1500 pF)
    pub cgs0: f64,           // Capacidad Gate-Source (F) (~1000 - 3000 pF)
    pub v0_gd: f64,          // Tensión de escala para colapso Cgd (V) (~10.0 V)
    pub v0_ds: f64,          // Tensión de escala para colapso Cds (V) (~25.0 V)
    pub m_gd: f64,           // Exponente de graduación Cgd (~0.5 - 0.8)
    pub m_ds: f64,           // Exponente de graduación Cds (~0.5)
    pub temp_coeff_r: f64,   // Coeficiente térmico de Rds_on (~2.3 para SiC)
    pub temp_coeff_vth: f64, // Coeficiente térmico de Vth (V/K) (~ -0.003)
}

impl Default for SicMosfetParams {
    fn default() -> Self {
        Self {
            vth: 3.0,
            rds_on: 0.065,
            lambda: 0.005,
            theta: 0.03,
            is_body: 1e-16,
            n_body: 1.3,
            v_knee_body: 3.2,
            cgd0: 150e-12,
            cds0: 800e-12,
            cgs0: 1200e-12,
            v0_gd: 8.0,
            v0_ds: 20.0,
            m_gd: 0.75,
            m_ds: 0.5,
            temp_coeff_r: 2.3,
            temp_coeff_vth: -0.0025,
        }
    }
}

/// Parámetros físicos para GaN E-HEMT (ej: GS66508T, EPC2001C)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GanHemtParams {
    pub vth: f64,          // Tensión de umbral Vth (V) (~1.3 - 1.7 V)
    pub rds_on: f64,       // Resistencia ON nominal (Ω) (~0.015 - 0.050 Ω)
    pub beta: f64,         // Parámetro de transconductancia 2DEG (A/V^2) (~15.0)
    pub lambda: f64,       // Modulación de canal (1/V) (~0.008)
    pub cgd0: f64,         // Capacidad Gate-Drain ultra-baja (F) (~10 - 30 pF)
    pub cds0: f64,         // Capacidad Drain-Source (F) (~100 - 300 pF)
    pub cgs0: f64,         // Capacidad Gate-Source (F) (~200 - 500 pF)
    pub v0_gd: f64,        // Tensión de colapso Cgd (V) (~5.0 V)
    pub v0_ds: f64,        // Tensión de colapso Cds (V) (~15.0 V)
    pub m_gd: f64,         // Exponente Cgd (~0.85)
    pub m_ds: f64,         // Exponente Cds (~0.6)
    pub temp_coeff_r: f64, // Coeficiente térmico de Rds_on (~1.8 para GaN)
}

impl Default for GanHemtParams {
    fn default() -> Self {
        Self {
            vth: 1.5,
            rds_on: 0.035,
            beta: 25.0,
            lambda: 0.005,
            cgd0: 15e-12,
            cds0: 180e-12,
            cgs0: 350e-12,
            v0_gd: 4.0,
            v0_ds: 12.0,
            m_gd: 0.85,
            m_ds: 0.6,
            temp_coeff_r: 1.8,
        }
    }
}

/// Resultado de la evaluación física de SiC / GaN
#[derive(Debug, Clone, Copy)]
pub struct WbgEvaluationResult {
    pub ids: f64, // Corriente total Drain-Source (A)
    pub gm: f64,  // Transconductancia dIds/dVgs (S)
    pub gds: f64, // Conductancia de salida dIds/dVds (S)
    pub cgs: f64, // Capacidad instantánea Gate-Source (F)
    pub cgd: f64, // Capacidad instantánea Gate-Drain no lineal (F)
    pub cds: f64, // Capacidad instantánea Drain-Source no lineal (F)
}

use crate::dual3::Dual3;

/// Evalúa el modelo de SiC MOSFET con conducción de 3er cuadrante y body diode mediante diferenciación automática Dual3.
pub fn evaluate_sic_mosfet(
    vgs: f64,
    vds: f64,
    temp_k: f64,
    params: &SicMosfetParams,
) -> WbgEvaluationResult {
    let t0 = 300.0;
    let temp_ratio = (temp_k / t0).max(0.5);

    // Ajuste térmico de Vth y Rds_on
    let vth = params.vth + params.temp_coeff_vth * (temp_k - t0);
    let rds_on = params.rds_on * temp_ratio.powf(params.temp_coeff_r);
    let g_on = 1.0 / rds_on.max(1e-6);

    let vt = (1.380649e-23 * temp_k) / 1.602176634e-19; // kT/q

    let v_gs = Dual3::new(vgs, 0);
    let v_ds = Dual3::new(vds, 1);

    let ids_dual = if vds >= 0.0 {
        // ====================================================================
        // 1ER CUADRANTE: CONDUCCIÓN DIRECTA
        // ====================================================================
        let vov = v_gs - vth; // Tensión de sobremarcha

        if vov.val <= 0.0 {
            // Sub-umbral (corriente de fuga)
            let vov_norm = (vov / (1.5 * vt)).max_val(-40.0);
            Dual3::constant(1e-12) * vov_norm.exp() * (Dual3::constant(1.0) - (-v_ds / vt).exp())
        } else if v_ds.val < vov.val {
            // Región lineal / Óhmica
            let denom = Dual3::constant(1.0) + params.theta * vov;
            let ids_lin_core = (vov * v_ds - v_ds * v_ds * 0.5) / (vov * denom) * g_on;
            ids_lin_core * (Dual3::constant(1.0) + params.lambda * v_ds)
        } else {
            // Región de saturación
            let denom = Dual3::constant(1.0) + params.theta * vov;
            let ids_sat_core = vov * (0.5 * g_on) / denom;
            ids_sat_core * (Dual3::constant(1.0) + params.lambda * v_ds)
        }
    } else {
        // ====================================================================
        // 3ER CUADRANTE: CONDUCCIÓN INVERSA (BODY DIODE + CANAL SÍNCRONO)
        // ====================================================================
        // 1. Body Diode de SiC con rodilla alta (~3.2V) y resistencia de cuerpo
        let v_diode = -v_ds; // Tensión directa del diodo interno
        let n_vt = params.n_body * vt;
        let v_over = v_diode - params.v_knee_body;

        let i_body = if v_over.val > 0.0 {
            let r_body = params.rds_on * 1.5;
            let g_b = 1.0 / r_body;
            v_over * g_b + Dual3::constant(0.001) * (v_over / n_vt).min_val(10.0).exp()
        } else if v_over.val > -0.5 {
            Dual3::constant(0.001) * (v_over / n_vt).max_val(-20.0).exp()
        } else {
            Dual3::constant(0.0)
        };

        // 2. Conducción por canal si Vgs > Vth (Rectificación Síncrona)
        let i_channel = if vgs > vth {
            v_ds * g_on // Corriente negativa
        } else {
            Dual3::constant(0.0)
        };

        i_channel - i_body // Fluye de Source a Drain (negativa)
    };

    let ids = ids_dual.val;
    let gm = ids_dual.deriv[0].abs().max(1e-12);
    let gds = ids_dual.deriv[1].abs().max(1e-12);

    // ========================================================================
    // CAPACITANCIAS NO LINEALES DEPENDIENTES DE TENSIÓN
    // ========================================================================
    let vds_pos = vds.max(0.0);
    let cgd = params.cgd0 / (1.0 + vds_pos / params.v0_gd).powf(params.m_gd);
    let cds = params.cds0 / (1.0 + vds_pos / params.v0_ds).powf(params.m_ds);
    let cgs = params.cgs0;

    WbgEvaluationResult {
        ids,
        gm,
        gds,
        cgs,
        cgd,
        cds,
    }
}

/// Evalúa el modelo de GaN E-HEMT (2DEG, 3er cuadrante sin body diode Qrr=0) mediante Dual3.
pub fn evaluate_gan_hemt(
    vgs: f64,
    vds: f64,
    temp_k: f64,
    params: &GanHemtParams,
) -> WbgEvaluationResult {
    let t0 = 300.0;
    let temp_ratio = (temp_k / t0).max(0.5);
    let rds_on = params.rds_on * temp_ratio.powf(params.temp_coeff_r);
    let g_on = 1.0 / rds_on.max(1e-6);

    let v_gs = Dual3::new(vgs, 0);
    let v_ds = Dual3::new(vds, 1);

    let ids_dual = if vds >= 0.0 {
        // ====================================================================
        // 1ER CUADRANTE: CANAL 2DEG DIRECTO
        // ====================================================================
        let vov = v_gs - params.vth;

        if vov.val <= 0.0 {
            Dual3::constant(1e-12) * v_ds
        } else if v_ds.val < vov.val {
            // Región lineal
            let ids_lin_core = (vov * v_ds - v_ds * v_ds * 0.5) * params.beta;
            ids_lin_core * (Dual3::constant(1.0) + params.lambda * v_ds)
        } else {
            // Región de saturación
            let ids_sat_core = (vov * vov * 0.5) * params.beta;
            ids_sat_core * (Dual3::constant(1.0) + params.lambda * v_ds)
        }
    } else {
        // ====================================================================
        // 3ER CUADRANTE: CONDUCCIÓN INVERSA BIDIRECCIONAL 2DEG (SIN DIODO, Qrr=0)
        // ====================================================================
        let vgd = v_gs - v_ds;

        if vgs >= params.vth {
            // Canal completamente abierto en modo síncrono
            v_ds * g_on
        } else if vgd.val > params.vth {
            // Conducción inversa en estado OFF con caída intrínseca Vdrop = Vth - Vgs
            let vov_rev = vgd - params.vth;
            Dual3::constant(-0.5 * params.beta) * vov_rev * vov_rev
        } else {
            // Bloqueo total
            Dual3::constant(1e-12) * v_ds
        }
    };

    let ids = ids_dual.val;
    let gm = ids_dual.deriv[0].abs().max(1e-12);
    let gds = ids_dual.deriv[1].abs().max(1e-12);

    // Capacitancias no lineales ultra-bajas GaN
    let vds_pos = vds.max(0.0);
    let cgd = params.cgd0 / (1.0 + vds_pos / params.v0_gd).powf(params.m_gd);
    let cds = params.cds0 / (1.0 + vds_pos / params.v0_ds).powf(params.m_ds);
    let cgs = params.cgs0;

    WbgEvaluationResult {
        ids,
        gm,
        gds,
        cgs,
        cgd,
        cds,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sic_mosfet_forward_and_3rd_quadrant() {
        let params = SicMosfetParams::default();

        // 1. Primer cuadrante: Vgs=15V, Vds=5V -> Conducción ON
        let fwd = evaluate_sic_mosfet(15.0, 5.0, 300.0, &params);
        assert!(
            fwd.ids > 10.0,
            "Corriente directa debe ser alta (>10A), obtenido: {}",
            fwd.ids
        );
        assert!(fwd.gds > 0.0);

        // 2. Tercer cuadrante con canal abierto (Vgs=15V, Vds=-1V)
        let rev_on = evaluate_sic_mosfet(15.0, -1.0, 300.0, &params);
        assert!(
            rev_on.ids < 0.0,
            "Corriente de 3er cuadrante debe ser negativa"
        );
        assert!(
            rev_on.ids < -10.0,
            "En modo síncrono Rds_on conduce alta corriente negativa"
        );

        // 3. Tercer cuadrante con canal cerrado (Vgs=0V, Vds=-4.0V) -> Body diode conduce
        let rev_body = evaluate_sic_mosfet(0.0, -4.0, 300.0, &params);
        assert!(
            rev_body.ids < 0.0,
            "Body diode debe conducir a Vds=-4V (por encima de Vknee=3.2V)"
        );
    }

    #[test]
    fn test_sic_nonlinear_capacitances() {
        let params = SicMosfetParams::default();

        let at_0v = evaluate_sic_mosfet(0.0, 0.0, 300.0, &params);
        let at_100v = evaluate_sic_mosfet(0.0, 100.0, 300.0, &params);

        // Colapso de capacitancia Miller Cgd a alta tensión
        assert!(
            at_100v.cgd < at_0v.cgd * 0.2,
            "Cgd debe colapsar a 100V, 0V: {}, 100V: {}",
            at_0v.cgd,
            at_100v.cgd
        );
        assert!(at_100v.cds < at_0v.cds * 0.5, "Cds debe decrecer con Vds");
    }

    #[test]
    fn test_gan_hemt_3rd_quadrant_2deg_behavior() {
        let params = GanHemtParams::default();

        // 1. Canal directo: Vgs=5V, Vds=2V
        let fwd = evaluate_gan_hemt(5.0, 2.0, 300.0, &params);
        assert!(fwd.ids > 10.0);

        // 2. Tercer cuadrante OFF (Vgs=0V, Vds=-2.5V): Conducción 2DEG inversa con Vdrop
        let rev_off = evaluate_gan_hemt(0.0, -2.5, 300.0, &params);
        assert!(
            rev_off.ids < 0.0,
            "GaN debe conducir en 3er cuadrante cuando Vgd > Vth"
        );

        // 3. Capacitancias ultra-bajas GaN
        let cap_gan = evaluate_gan_hemt(0.0, 50.0, 300.0, &params);
        assert!(
            cap_gan.cgd < 5e-12,
            "Capacidad Miller GaN debe ser inferior a 5 pF a 50V"
        );
    }
}
