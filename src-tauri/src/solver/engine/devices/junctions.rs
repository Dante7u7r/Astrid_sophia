use crate::solver::types::*;

// Constantes físicas universales
pub const PHYS_KB: f64 = 1.380649e-23; // Constante de Boltzmann (J/K)
pub const PHYS_Q: f64 = 1.602176634e-19; // Carga del electrón (C)
pub const PHYS_T: f64 = 300.0; // Temperatura estándar (300 K = 26.85 ºC)

// Constantes físicas para el modelo del Diodo PN (Shockley)
pub const DIODE_IS: f64 = 1e-12; // Corriente de saturación inversa (1 pA)
pub const DIODE_VT: f64 = 0.025852; // Voltaje térmico a 300K (25.85 mV)
pub const DIODE_N: f64 = 1.0; // Coeficiente de emisión ideal

// Parámetros de capacidades dinámicas de diodos y transistores (Fase 13)
pub const DIODE_TT: f64 = 10e-9; // Tiempo de tránsito de portadores de difusión (10 ns)
pub const DIODE_CJO: f64 = 2e-12; // Capacidad de unión a cero voltios (2 pF)
pub const DIODE_VJ: f64 = 0.6; // Potencial de contacto de unión (0.6 V)
pub const DIODE_M: f64 = 0.5; // Coeficiente de graduación de unión (0.5)

pub fn get_thermal_parameters(temp_opt: Option<f64>, is_custom: Option<f64>) -> (f64, f64) {
    let temp = temp_opt.unwrap_or(PHYS_T);
    let vt = (1.380649e-23 * temp) / 1.602176634e-19; // k * T / q

    // Escalamiento SPICE de Is con la temperatura (Eg = 1.11 eV para silicio)
    let t0 = PHYS_T;
    let eg = 1.11;
    let q = 1.602176634e-19;
    let k = 1.380649e-23;

    let base_is = is_custom.unwrap_or(DIODE_IS);
    let is_temp = base_is * (temp / t0).powf(3.0) * (-(eg * q / k) * (1.0 / temp - 1.0 / t0)).exp();
    (vt, is_temp)
}

/// Parámetros térmicos a nivel de unión para self-heating de dispositivos discretos
pub fn get_thermal_parameters_junction(tjunc: f64, is_custom: Option<f64>) -> (f64, f64) {
    let vt = (PHYS_KB * tjunc) / PHYS_Q;
    let t0 = PHYS_T;
    let eg = 1.11;
    let base_is = is_custom.unwrap_or(DIODE_IS);
    let is_temp = base_is
        * (tjunc / t0).powf(3.0)
        * (-(eg * PHYS_Q / PHYS_KB) * (1.0 / tjunc - 1.0 / t0)).exp();
    (vt, is_temp)
}

// Constantes de Self-Heating para dispositivos discretos (Modelo RC térmico de unión)
// Resistencia térmica unión-ambiente (°C/W) — valores típicos para encapsulados TO-92/SOT-23
pub const DIODE_RTH_JA: f64 = 150.0; // Diodo: 150 °C/W (encapsulado DO-41)
pub const BJT_RTH_JA: f64 = 200.0; // BJT: 200 °C/W (encapsulado TO-92)
pub const MOS_RTH_JA: f64 = 62.5; // MOSFET: 62.5 °C/W (encapsulado TO-220)

// Capacidad térmica (J/°C) — modela la inercia térmica del chip de silicio
pub const DIODE_CTH: f64 = 0.002; // Diodo: 2 mJ/°C
pub const BJT_CTH: f64 = 0.005; // BJT: 5 mJ/°C
pub const MOS_CTH: f64 = 0.010; // MOSFET: 10 mJ/°C

// Constantes de Self-Heating para optoacopladores (encapsulado DIP-4)
pub const OPTO_RTH_JA: f64 = 200.0; // Opto DIP-4: 200 °C/W
pub const OPTO_CTH: f64 = 1e-4; // Opto DIP-4: 100 µJ/°C

// Parámetros por defecto del optoacoplador (lado receptor fototransistor)
pub const OPTO_DEFAULT_CTR: f64 = 0.5; // Current Transfer Ratio: 50%
pub const OPTO_DEFAULT_VSAT: f64 = 0.2;

// Parámetros por defecto para tiristores (SCR/TRIAC)
pub const SCR_DEFAULT_VGT: f64 = 0.7; // Voltaje de disparo de puerta (V)
pub const SCR_DEFAULT_IH: f64 = 5e-3; // Corriente de mantenimiento (A)
pub const SCR_DEFAULT_IS: f64 = 1e-12; // Corriente de saturación de los BJTs internos (A)
pub const SCR_MAX_BETA: f64 = 200.0; // β máximo para evitar problemas de convergencia  // Tensión de saturación suave del transistor (V)

pub fn evaluate_pn_junction(vj: f64, vt: f64, is_val: f64) -> (f64, f64, f64) {
    let v_limit = 0.70; // Voltaje límite de linealización
    if vj <= v_limit {
        let exp_val = (vj / vt).exp();
        let i = is_val * (exp_val - 1.0);
        let g = (is_val / vt) * exp_val;
        let ieq = i - g * vj;
        (i, g, ieq)
    } else {
        let exp_limit = (v_limit / vt).exp();
        let i_limit = is_val * (exp_limit - 1.0);
        let g_limit = (is_val / vt) * exp_limit;
        let i = i_limit + g_limit * (vj - v_limit);
        let g = g_limit;
        let ieq = i_limit - g_limit * v_limit;
        (i, g, ieq)
    }
}

// Coeficientes de temperatura para MOSFETs (SPICE Level 1 / Level 3)
pub const MOS_VTH_TC: f64 = -2.3e-3; // dVth/dT = -2.3 mV/°C (Vth disminuye con T)
pub const MOS_MOBILITY_EXPO: f64 = -1.5; // μ(T) = μ₀ * (T/T₀)^(-1.5) (movilidad baja con T)

// Coeficiente de temperatura para β de BJTs (SPICE)
pub const BJT_BETA_EXPO: f64 = 1.8; // β(T) = β₀ * (T/T₀)^Xti

pub fn pnjlim(v_new: f64, v_old: f64, vt: f64, v_crit: f64) -> f64 {
    if v_new > v_crit && (v_new - v_old) > 2.0 * vt {
        let delta = v_new - v_old;
        let val = v_old + vt * (1.0 + delta / vt).ln();
        val.min(v_new)
    } else {
        v_new
    }
}

#[allow(dead_code)]
pub fn get_diode_capacitance(vd: f64, gd: f64) -> f64 {
    let c_dif = DIODE_TT * gd;
    let c_dep = if vd < 0.0 {
        DIODE_CJO / (1.0 - vd / DIODE_VJ).powf(DIODE_M)
    } else {
        DIODE_CJO * (1.0 + DIODE_M * vd / DIODE_VJ)
    };
    c_dif + c_dep
}

pub fn get_diode_capacitance_param(vd: f64, gd: f64, comp: &ComponentData) -> f64 {
    let tt = comp.diode_tt.unwrap_or(DIODE_TT);
    let cjo = comp.diode_cjo.unwrap_or(DIODE_CJO);
    let vj = comp.diode_vj.unwrap_or(DIODE_VJ);
    let m = comp.diode_m.unwrap_or(DIODE_M);

    let c_dif = tt * gd;
    let c_dep = if vd < 0.0 {
        cjo / (1.0 - vd / vj).powf(m)
    } else {
        cjo * (1.0 + m * vd / vj)
    };
    c_dif + c_dep
}

pub fn solve_diode_junction_voltage(
    v_ext: f64,
    temp: Option<f64>,
    comp: &ComponentData,
) -> (f64, f64, f64) {
    let rs = comp.diode_rs.unwrap_or(0.0);
    let comp_n = comp.diode_n.unwrap_or(DIODE_N);
    let (vt, is_val) = get_thermal_parameters(temp, comp.diode_is);

    if rs <= 1e-9 {
        // Sin resistencia serie, comportamiento convencional
        let exp_factor = (v_ext / (comp_n * vt)).exp();
        let mut id = is_val * (exp_factor - 1.0);
        let mut geq = (is_val / (comp_n * vt)) * exp_factor;

        if let Some(bv) = comp.diode_bv {
            let ibv = comp.diode_ibv.unwrap_or(1e-3);
            let v_rev = v_ext + bv;
            if v_rev < 0.0 {
                let exp_rev = (-v_rev / vt).exp();
                id += -ibv * (exp_rev - 1.0);
                geq += (ibv / vt) * exp_rev;
            }
        }
        return (v_ext, id, geq);
    }

    // Resolver con resistencia de serie mediante Newton-Raphson local 1D
    let mut vd_j = if v_ext > 0.6 { 0.6 } else { v_ext };
    let max_local_iter = 50;
    let tol = 1e-12;

    for _ in 0..max_local_iter {
        let exp_f = (vd_j / (comp_n * vt)).exp();
        let mut id_ideal = is_val * (exp_f - 1.0);
        let mut gd_ideal = (is_val / (comp_n * vt)) * exp_f;

        if let Some(bv) = comp.diode_bv {
            let ibv = comp.diode_ibv.unwrap_or(1e-3);
            let v_rev = vd_j + bv;
            if v_rev < 0.0 {
                let exp_rev = (-v_rev / vt).exp();
                id_ideal += -ibv * (exp_rev - 1.0);
                gd_ideal += (ibv / vt) * exp_rev;
            }
        }

        let f = vd_j + id_ideal * rs - v_ext;
        let df = 1.0 + gd_ideal * rs;

        let delta = f / df;
        let next_vd = vd_j - delta;

        // Damping seguro
        vd_j = next_vd.clamp(v_ext - 1.0, v_ext.max(0.8));

        if delta.abs() < tol {
            break;
        }
    }

    // Calcular valores finales
    let exp_f = (vd_j / (comp_n * vt)).exp();
    let mut gd_ideal = (is_val / (comp_n * vt)) * exp_f;
    let mut id_ideal = is_val * (exp_f - 1.0);

    if let Some(bv) = comp.diode_bv {
        let ibv = comp.diode_ibv.unwrap_or(1e-3);
        let v_rev = vd_j + bv;
        if v_rev < 0.0 {
            let exp_rev = (-v_rev / vt).exp();
            id_ideal += -ibv * (exp_rev - 1.0);
            gd_ideal += (ibv / vt) * exp_rev;
        }
    }

    // Conductancia efectiva externa
    let geq_eff = gd_ideal / (1.0 + gd_ideal * rs);
    (vd_j, id_ideal, geq_eff)
}

// Helper para el lado receptor (fototransistor) del optoacoplador.
// Devuelve (I_ce, g_md, g_o, I_ce_eq) donde:
//   I_ce    = CTR * I_d(V_d) * tanh(V_ce / V_sat)
//   g_md    = dI_ce/dV_d  = CTR * g_d(V_d) * tanh(V_ce / V_sat)
//   g_o     = dI_ce/dV_ce = CTR * I_d(V_d) * (1 - tanh^2) / V_sat
//   I_ce_eq = I_ce - g_md * V_d - g_o * V_ce   (fuente equivalente para MNA)
// Protección contra V_sat == 0 mediante floor en 1e-6 V.
pub fn evaluate_opto_receiver(
    vd: f64,
    gd_led: f64,
    id_led: f64,
    v_ce: f64,
    comp: &ComponentData,
) -> (f64, f64, f64, f64) {
    let ctr = comp.opto_ctr.unwrap_or(OPTO_DEFAULT_CTR);
    let vsat = comp.opto_vsat.unwrap_or(OPTO_DEFAULT_VSAT).max(1e-6);
    let t_vce = (v_ce / vsat).tanh();
    let i_ce = ctr * id_led * t_vce;
    let g_md = ctr * gd_led * t_vce;
    let g_o = ctr * id_led * (1.0 - t_vce * t_vce) / vsat;
    let i_ce_eq = i_ce - g_md * vd - g_o * v_ce;
    (i_ce, g_md, g_o, i_ce_eq)
}

pub fn get_jfet_capacitances(vgs: f64, vgd: f64, comp: &ComponentData) -> (f64, f64) {
    let cgs0 = comp.jfet_cgs.unwrap_or(2.0e-12);
    let cgd0 = comp.jfet_cgd.unwrap_or(1.5e-12);
    let v_d = 0.6;
    let fc = 0.5;

    let c_gs = if vgs < fc * v_d {
        cgs0 / (1.0 - vgs / v_d).sqrt()
    } else {
        let factor = (1.0 - fc).sqrt();
        let slope = 0.5 / (v_d * (1.0 - fc).powf(1.5));
        cgs0 * (1.0 / factor + slope * (vgs - fc * v_d))
    };

    let c_gd = if vgd < fc * v_d {
        cgd0 / (1.0 - vgd / v_d).sqrt()
    } else {
        let factor = (1.0 - fc).sqrt();
        let slope = 0.5 / (v_d * (1.0 - fc).powf(1.5));
        cgd0 * (1.0 / factor + slope * (vgd - fc * v_d))
    };

    (c_gs, c_gd)
}

// Parámetros de capacidades dinámicas de MOSFET (Fase 13)
pub const MOS_COX_WL: f64 = 15e-12; // Capacidad total de óxido W * L * Cox (15 pF)
pub const MOS_CGSO: f64 = 5e-12; // Capacidad de solapamiento puerta-fuente fija (5 pF)
pub const MOS_CGDO: f64 = 5e-12; // Capacidad de solapamiento puerta-drenador fija (5 pF)
pub const MOS_CDSO: f64 = 2e-12; // Capacidad fija drenador-fuente (2 pF)

pub fn get_nmos_capacitances(
    vgs: f64,
    vds: f64,
    vth: f64,
    w_opt: Option<f64>,
    l_opt: Option<f64>,
) -> (f64, f64, f64) {
    let w = w_opt.unwrap_or(10.0e-6);
    let l = l_opt.unwrap_or(0.18e-6);
    let area_factor = (w * l) / (10.0e-6 * 0.18e-6);
    let (c_gs, c_gd) = if vgs <= vth {
        (MOS_CGSO, MOS_CGDO)
    } else if vds < vgs - vth {
        (MOS_CGSO + 0.5 * MOS_COX_WL, MOS_CGDO + 0.5 * MOS_COX_WL)
    } else {
        (MOS_CGSO + (2.0 / 3.0) * MOS_COX_WL, MOS_CGDO)
    };
    (
        c_gs * area_factor,
        c_gd * area_factor,
        MOS_CDSO * area_factor,
    )
}

pub fn get_pmos_capacitances(
    vsg: f64,
    vsd: f64,
    vth_abs: f64,
    w_opt: Option<f64>,
    l_opt: Option<f64>,
) -> (f64, f64, f64) {
    let w = w_opt.unwrap_or(10.0e-6);
    let l = l_opt.unwrap_or(0.18e-6);
    let area_factor = (w * l) / (10.0e-6 * 0.18e-6);
    let (c_sg, c_sd) = if vsg <= vth_abs {
        (MOS_CGSO, MOS_CGDO)
    } else if vsd < vsg - vth_abs {
        (MOS_CGSO + 0.5 * MOS_COX_WL, MOS_CGDO + 0.5 * MOS_COX_WL)
    } else {
        (MOS_CGSO + (2.0 / 3.0) * MOS_COX_WL, MOS_CGDO)
    };
    (
        c_sg * area_factor,
        c_sd * area_factor,
        MOS_CDSO * area_factor,
    )
}

// Parámetros de capacidades dinámicas de BJT (Fase 16)
pub const BJT_TF: f64 = 0.1e-9; // Tiempo de tránsito directo (100 ps)
pub const BJT_TR: f64 = 10e-9; // Tiempo de tránsito inverso (10 ns)
pub const BJT_CJE0: f64 = 2e-12; // Capacidad BE a cero voltios (2 pF)
pub const BJT_CJC0: f64 = 1.5e-12; // Capacidad BC a cero voltios (1.5 pF)
pub const BJT_VJE: f64 = 0.7; // Potencial de unión BE (0.7 V)
pub const BJT_VJC: f64 = 0.6; // Potencial de unión BC (0.6 V)
pub const BJT_M: f64 = 0.33; // Coeficiente de graduación de unión (0.33)

pub fn get_bjt_be_capacitance(vbe: f64, gbe: f64, comp: &ComponentData) -> f64 {
    let tf = comp.bjt_tf.unwrap_or(BJT_TF);
    let cje = comp.bjt_cje.unwrap_or(BJT_CJE0);
    let c_dif = tf * gbe;
    let fc = 0.8;
    let c_dep = if vbe < fc * BJT_VJE {
        cje / (1.0 - vbe / BJT_VJE).powf(BJT_M)
    } else {
        let denom_fc = (1.0 - fc).powf(BJT_M);
        let factor = 1.0 + (BJT_M / (1.0 - fc)) * (vbe / BJT_VJE - fc);
        (cje / denom_fc) * factor
    };
    c_dif + c_dep
}

pub fn get_bjt_bc_capacitance(vbc: f64, gbc: f64, comp: &ComponentData) -> f64 {
    let tr = comp.bjt_tr.unwrap_or(BJT_TR);
    let cjc = comp.bjt_cjc.unwrap_or(BJT_CJC0);
    let c_dif = tr * gbc;
    let fc = 0.8;
    let c_dep = if vbc < fc * BJT_VJC {
        cjc / (1.0 - vbc / BJT_VJC).powf(BJT_M)
    } else {
        let denom_fc = (1.0 - fc).powf(BJT_M);
        let factor = 1.0 + (BJT_M / (1.0 - fc)) * (vbc / BJT_VJC - fc);
        (cjc / denom_fc) * factor
    };
    c_dif + c_dep
}
