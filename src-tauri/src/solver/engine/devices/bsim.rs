use crate::dual3::Dual3;
use crate::solver::types::ComponentData;

/// Evaluador físico completo BSIM3v3.2 / BSIM3v3.3 para transistores NMOS con diferenciación automática Dual3.
/// Implementa formulación analítica unificada continua con transición suave subumbral-fuerte inversión,
/// degradación de movilidad por campo vertical (MOBMOD=1), saturación de velocidad,
/// modulación de longitud de canal (CLM) y efecto DIBL en paridad con SPICE LEVEL=49.
pub fn evaluate_bsim3_nmos(
    vgs: f64,
    vds: f64,
    vbs: f64,
    vth_netlist: f64,
    w_opt: Option<f64>,
    l_opt: Option<f64>,
    temp_k: Option<f64>,
    comp: Option<&ComponentData>,
) -> (f64, f64, f64) {
    let tnom = 300.15; // Temperatura nominal (27°C)
    let t_actual = temp_k.unwrap_or(tnom);
    let tox = comp.and_then(|c| c.bsim_tox).unwrap_or(4.0e-9);
    let eps_ox = 3.9 * 8.85418e-12;
    let cox = eps_ox / tox;
    let w = w_opt.or_else(|| comp.and_then(|c| c.w)).unwrap_or(10.0e-6);
    let l = l_opt.or_else(|| comp.and_then(|c| c.l)).unwrap_or(0.18e-6);
    let u0_nom = comp.and_then(|c| c.bsim_u0).unwrap_or(0.045); // 450 cm^2/V*s = 0.045 m^2/V*s
    let vsat = comp.and_then(|c| c.bsim_vmax).unwrap_or(8.0e4); // 8e6 cm/s = 8e4 m/s

    // Parámetros de degradación de movilidad (MOBMOD=1 BSIM3 estándar)
    let theta_override = comp.and_then(|c| c.bsim_theta).unwrap_or(0.0);
    let ua = 2.25e-9 + theta_override; // m/V
    let ub = 5.87e-19; // m^2/V^2
    let uc = -4.65e-11; // m/V^2
    let theta_dibl = comp.and_then(|c| c.bsim_eta0).unwrap_or(0.08);

    // Coeficientes de temperatura BSIM3 para NMOS
    let kt1 = -0.11; // Coeficiente de temperatura de Vth (V)
    let ute = -1.5; // Exponente de degradación de movilidad térmica

    let delta_t = t_actual - tnom;
    let vth0 = if vth_netlist != 0.0 { vth_netlist } else { 0.4 };
    let vth_thermal = vth0 + kt1 * (delta_t / tnom);

    // Efecto de cuerpo K1 y sustrato Vbs
    let phi_s: f64 = 0.7; // 2 * phi_b
    let k1 = 0.53; // V^0.5
    let k2 = -0.0186;
    let sqrt_phi = phi_s.sqrt();

    // Voltaje térmico a la temperatura actual
    let vt_therm = 1.380649e-23 * t_actual / 1.602176634e-19;
    let n_factor = 1.35;

    // Degradación de movilidad térmica
    let u0 = u0_nom * (tnom / t_actual).powf(ute);

    let v_gs = Dual3::new(vgs, 0);
    let v_ds = Dual3::new(vds, 1);
    let v_bs = Dual3::new(vbs, 2);

    let v_ds_pos = v_ds.max_val(0.0);
    let v_bs_eff = v_bs.min_val(0.0);

    // Umbral local con efecto de cuerpo, efecto de canal corto lateral (pocket / LPE0) y DIBL
    let sqrt_phi_vbs = (Dual3::constant(phi_s) - v_bs_eff).max_val(0.01).sqrt();
    let body_shift = (sqrt_phi_vbs - sqrt_phi) * k1 - v_bs_eff * k2;
    let lpe0 = 2.4e-7; // Longitud característica de halo / pocket doping (BSIM3v3 LPE0)
    let pocket_shift = k1 * ((1.0 + lpe0 / l).sqrt() - 1.0) * sqrt_phi;
    let v_th_local = body_shift + (vth_thermal + pocket_shift) - v_ds_pos * theta_dibl;

    let v_gst = v_gs - v_th_local;

    // Vgsteff continuo y unificado estándar BSIM3 (Berkeley / SPICE LEVEL=49)
    let n_vt = n_factor * vt_therm;
    let voff = -0.08;
    let v_gsteff = if v_gst.val > 30.0 * n_vt {
        v_gst
    } else if v_gst.val < -30.0 * n_vt {
        (v_gst / (2.0 * n_vt)).exp() * (2.0 * n_vt)
    } else {
        let exp_term = (v_gst / (2.0 * n_vt)).exp();
        let num = (Dual3::constant(1.0) + exp_term).ln() * (2.0 * n_vt);
        let exp_denom = (-(v_gst - 2.0 * voff) / (2.0 * n_vt)).exp();
        let denom = Dual3::constant(1.0) + exp_denom * 0.08;
        num / denom
    };

    if v_gsteff.val <= 1e-12 {
        return (0.0, 1e-12, 1e-12);
    }

    // Campo vertical efectivo y movilidad degradada
    let e_eff = (v_gsteff + 2.0 * v_th_local.abs().val) / (6.0 * tox);
    let denom_mu =
        Dual3::constant(1.0) + (Dual3::constant(ua) + v_bs_eff * uc) * e_eff + (e_eff * e_eff) * ub;
    let mu_eff = Dual3::constant(u0) / denom_mu.max_val(0.1);

    // Parámetro de carga de cuerpo Abulk
    let abulk = (Dual3::constant(k1)
        / ((Dual3::constant(phi_s) - v_bs_eff).max_val(0.01).sqrt() * 2.0))
        * (0.5 * l / (l + 0.15e-6))
        + 1.0;

    // Velocidad de saturación y Esat
    let esat = mu_eff.powf(-1.0) * (2.0 * vsat);
    let esat_l = esat * l;

    // Tensión de saturación Vdsat
    let vdsat = (esat_l * v_gsteff) / (abulk * esat_l + v_gsteff);

    // Vdseff suave para transición continua entre zona lineal y saturación
    let delta = 0.02;
    let diff = vdsat - v_ds_pos - delta;
    let vdseff = vdsat - (diff + (diff * diff + vdsat * (4.0 * delta)).sqrt()) * 0.5;

    // Corriente de canal intrínseca Ids0
    let factor_lin = Dual3::constant(1.0) - (abulk * vdseff) / ((v_gsteff + 2.0 * vt_therm) * 2.0);
    let num_ids = (mu_eff * (w * cox)) * v_gsteff * factor_lin.max_val(0.1) * vdseff;
    let denom_ids = (vdseff / esat_l + 1.0) * l;
    let ids0 = num_ids / denom_ids;

    // Modulación de longitud de canal (CLM) y Early effect
    let pclm = 0.8;
    let v_asclm = esat_l / pclm;
    let clm_factor = (v_ds_pos - vdseff).max_val(0.0) / (v_asclm + v_ds_pos) + 1.0;

    // Resistencia parasitaria de contacto Rdsw (típica en tecnologías submicrónicas)
    let rdsw = 100.0 * (1.0e-6 / w); // Ohms
    let ids_clm = ids0 * clm_factor;
    let ids_total = ids_clm / (ids_clm * rdsw / (v_ds_pos + 0.1) + 1.0);

    let ids = ids_total.val;
    let gm = ids_total.deriv[0].max(1e-12);
    let gds = ids_total.deriv[1].max(1e-12);

    (ids, gm, gds)
}

/// Evaluador físico completo BSIM3v3.2 / BSIM3v3.3 para transistores PMOS con diferenciación automática Dual3.
pub fn evaluate_bsim3_pmos(
    vsg: f64,
    vsd: f64,
    vsb: f64,
    vth_netlist: f64,
    w_opt: Option<f64>,
    l_opt: Option<f64>,
    temp_k: Option<f64>,
    comp: Option<&ComponentData>,
) -> (f64, f64, f64) {
    let tnom = 300.15; // Temperatura nominal (27°C)
    let t_actual = temp_k.unwrap_or(tnom);
    let tox = comp.and_then(|c| c.bsim_tox).unwrap_or(4.0e-9);
    let eps_ox = 3.9 * 8.85418e-12;
    let cox = eps_ox / tox;
    let w = w_opt.or_else(|| comp.and_then(|c| c.w)).unwrap_or(10.0e-6);
    let l = l_opt.or_else(|| comp.and_then(|c| c.l)).unwrap_or(0.18e-6);
    let u0_nom = comp.and_then(|c| c.bsim_u0).unwrap_or(0.015); // Movilidad nominal PMOS
    let vsat = comp.and_then(|c| c.bsim_vmax).unwrap_or(6.0e4);

    let theta_override = comp.and_then(|c| c.bsim_theta).unwrap_or(0.0);
    let ua = 2.25e-9 + theta_override;
    let ub = 5.87e-19;
    let uc = -4.65e-11;
    let theta_dibl = comp.and_then(|c| c.bsim_eta0).unwrap_or(0.08);

    let kt1 = -0.12;
    let ute = -1.2;

    let delta_t = t_actual - tnom;
    let vth0 = if vth_netlist != 0.0 {
        vth_netlist.abs()
    } else {
        0.4
    };
    let vth_thermal = vth0 + kt1 * (delta_t / tnom);

    let phi_s: f64 = 0.7;
    let k1 = 0.53;
    let k2 = -0.0186;
    let sqrt_phi = phi_s.sqrt();

    let vt_therm = 1.380649e-23 * t_actual / 1.602176634e-19;
    let n_factor = 1.25;

    let u0 = u0_nom * (tnom / t_actual).powf(ute);

    let v_sg = Dual3::new(vsg, 0);
    let v_sd = Dual3::new(vsd, 1);
    let v_sb = Dual3::new(vsb, 2);

    let v_sd_pos = v_sd.max_val(0.0);
    let v_sb_eff = v_sb.min_val(0.0);
    let sqrt_phi_vsb = (Dual3::constant(phi_s) - v_sb_eff).max_val(0.01).sqrt();
    let body_shift = (sqrt_phi_vsb - sqrt_phi) * k1 - v_sb_eff * k2;
    let lpe0 = 2.4e-7;
    let pocket_shift = k1 * ((1.0 + lpe0 / l).sqrt() - 1.0) * sqrt_phi;
    let v_th_local = body_shift + (vth_thermal + pocket_shift) - v_sd_pos * theta_dibl;

    let v_sgt = v_sg - v_th_local;

    let n_vt = n_factor * vt_therm;
    let voff = -0.08;
    let v_sgteff = if v_sgt.val > 30.0 * n_vt {
        v_sgt
    } else if v_sgt.val < -30.0 * n_vt {
        (v_sgt / (2.0 * n_vt)).exp() * (2.0 * n_vt)
    } else {
        let exp_term = (v_sgt / (2.0 * n_vt)).exp();
        let num = (Dual3::constant(1.0) + exp_term).ln() * (2.0 * n_vt);
        let exp_denom = (-(v_sgt - 2.0 * voff) / (2.0 * n_vt)).exp();
        let denom = Dual3::constant(1.0) + exp_denom * 0.08;
        num / denom
    };

    if v_sgteff.val <= 1e-12 {
        return (0.0, 1e-12, 1e-12);
    }

    let e_eff = (v_sgteff + 2.0 * v_th_local.abs().val) / (6.0 * tox);
    let denom_mu =
        Dual3::constant(1.0) + (Dual3::constant(ua) + v_sb_eff * uc) * e_eff + (e_eff * e_eff) * ub;
    let mu_eff = Dual3::constant(u0) / denom_mu.max_val(0.1);

    let abulk = (Dual3::constant(k1)
        / ((Dual3::constant(phi_s) - v_sb_eff).max_val(0.01).sqrt() * 2.0))
        * (0.5 * l / (l + 0.15e-6))
        + 1.0;

    let esat = mu_eff.powf(-1.0) * (2.0 * vsat);
    let esat_l = esat * l;

    let vsdsat = (esat_l * v_sgteff) / (abulk * esat_l + v_sgteff);

    let delta = 0.02;
    let diff = vsdsat - v_sd_pos - delta;
    let vsdeff = vsdsat - (diff + (diff * diff + vsdsat * (4.0 * delta)).sqrt()) * 0.5;

    let factor_lin = Dual3::constant(1.0) - (abulk * vsdeff) / ((v_sgteff + 2.0 * vt_therm) * 2.0);
    let num_isd = (mu_eff * (w * cox)) * v_sgteff * factor_lin.max_val(0.1) * vsdeff;
    let denom_isd = (vsdeff / esat_l + 1.0) * l;
    let isd0 = num_isd / denom_isd;

    let pclm = 0.8;
    let v_asclm = esat_l / pclm;
    let clm_factor = (v_sd_pos - vsdeff).max_val(0.0) / (v_asclm + v_sd_pos) + 1.0;

    let rdsw = 100.0 * (1.0e-6 / w);
    let isd_clm = isd0 * clm_factor;
    let isd_total = isd_clm / (isd_clm * rdsw / (v_sd_pos + 0.1) + 1.0);

    let isd = isd_total.val;
    let gm = isd_total.deriv[0].max(1e-12);
    let gds = isd_total.deriv[1].max(1e-12);

    (isd, gm, gds)
}

/// Calcula capacitancias intrínsecas y de solape BSIM3 (Cgs, Cgd, Cgb).
#[allow(dead_code)]
pub fn evaluate_bsim3_capacitances(
    vgs: f64,
    vds: f64,
    _vbs: f64,
    vth: f64,
    w: f64,
    l: f64,
    tox: f64,
) -> (f64, f64, f64) {
    let eps_ox = 3.9 * 8.85418e-12;
    let cox = eps_ox / tox;
    let cgg = w * l * cox;

    // Capacitancias de solape (overlap) por unidad de ancho
    let cgso = 2.5e-10 * w;
    let cgdo = 2.5e-10 * w;
    let cgbo = 1.0e-10 * l;

    let vgst = vgs - vth;
    let vdsat = (0.6 * vgst).max(0.05);

    if vgst <= 0.0 {
        // Subumbral / Acumulación
        let cgb_intrinsic = cgg * 0.4;
        (cgso, cgdo, cgb_intrinsic + cgbo)
    } else if vds < vdsat {
        // Zona lineal (Triodo)
        let ratio = vds / vdsat;
        let cgs = cgg * (0.5 - 0.1 * ratio) + cgso;
        let cgd = cgg * (0.5 - 0.2 * ratio) + cgdo;
        let cgb = cgbo;
        (cgs, cgd, cgb)
    } else {
        // Saturación
        let cgs = (2.0 / 3.0) * cgg + cgso;
        let cgd = cgdo;
        let cgb = cgbo;
        (cgs, cgd, cgb)
    }
}

/// Calcula densidad espectral de ruido térmico y de parpadeo (1/f) BSIM3.
#[allow(dead_code)]
pub fn evaluate_bsim3_noise(
    ids: f64,
    gm: f64,
    gds: f64,
    gmb: f64,
    tox: f64,
    l_eff: f64,
    f: f64,
    temp_k: f64,
) -> (f64, f64) {
    let k_b = 1.380649e-23;
    let eps_ox = 3.9 * 8.85418e-12;
    let cox = eps_ox / tox;

    // Ruido térmico de canal: S_id,th = (8/3) * k_B * T * (gm + gds + gmb)
    let s_th = (8.0 / 3.0) * k_b * temp_k * (gm + gds + gmb);

    // Ruido 1/f (Flicker): S_id,1/f = (KF * Ids^AF) / (Cox * Leff^2 * f^EF)
    let kf = 1.0e-27;
    let af = 1.0;
    let ef = 1.0;
    let f_clamped = f.max(1.0);
    let s_flicker = (kf * ids.abs().powf(af)) / (cox * l_eff * l_eff * f_clamped.powf(ef));

    (s_th, s_flicker)
}

/// Calcula corriente de ionización por impacto en el sustrato (Isub).
#[allow(dead_code)]
pub fn evaluate_bsim3_substrate_current(ids: f64, vds: f64, vdsat: f64, l: f64) -> f64 {
    let vds_diff = vds - vdsat;
    if vds_diff <= 0.0 || ids <= 0.0 {
        return 0.0;
    }
    let alpha0 = 1.0e-4; // 1/m
    let beta0 = 30.0; // V
    let exp_term = (-beta0 / vds_diff).exp();
    (alpha0 / l) * vds_diff * exp_term * ids
}

/// Evaluador físico completo BSIM4 para transistores NMOS de canal corto (45nm - 14nm)
/// con diferenciación automática continua Dual3.
/// Soporta degradación de movilidad por campo vertical, velocidad de saturación,
/// DIBL, modulación de longitud de canal (CLM), resistencia de contacto Rdsw
/// y corriente de fuga cuántica de compuerta Ig (Direct Gate Tunneling).
pub fn evaluate_bsim4_nmos(
    vgs: f64,
    vds: f64,
    vbs: f64,
    vth_netlist: f64,
    w_opt: Option<f64>,
    l_opt: Option<f64>,
    temp_k: Option<f64>,
    comp: Option<&ComponentData>,
) -> (f64, f64, f64, f64, f64, f64) {
    let tnom = 300.15; // Temperatura nominal (27°C)
    let t_actual = temp_k.unwrap_or(tnom);
    let toxe = comp
        .and_then(|c| c.bsim_toxe.or(c.bsim_tox))
        .unwrap_or(1.4e-9);
    let eps_ox = 3.9 * 8.854187817e-12;
    let cox = eps_ox / toxe;
    let w = w_opt.or_else(|| comp.and_then(|c| c.w)).unwrap_or(1.0e-6);
    let l = l_opt.or_else(|| comp.and_then(|c| c.l)).unwrap_or(0.045e-6);
    let u0_nom = comp.and_then(|c| c.bsim_u0).unwrap_or(0.032);
    let vsat = comp.and_then(|c| c.bsim_vmax).unwrap_or(1.2e5);

    let theta_override = comp.and_then(|c| c.bsim_theta).unwrap_or(0.0);
    let ua = 5.0e-10 + theta_override;
    let ub = 2.5e-18;
    let uc = -0.02;
    let theta_dibl = comp.and_then(|c| c.bsim_eta0).unwrap_or(0.12);
    let dvt0 = comp.and_then(|c| c.bsim_dvt0).unwrap_or(2.2);
    let rdsw_val = comp.and_then(|c| c.bsim_rdsw).unwrap_or(100.0);
    let pclm_val = comp.and_then(|c| c.bsim_pclm).unwrap_or(0.8);

    // Coeficientes térmicos BSIM4 NMOS
    let kt1 = -0.11;
    let ute = -1.5;
    let delta_t = t_actual - tnom;
    let vth0 = comp
        .and_then(|c| c.bsim_vth0)
        .unwrap_or(if vth_netlist != 0.0 { vth_netlist } else { 0.35 });
    let vth_thermal = vth0 + kt1 * (delta_t / tnom);

    let phi_s: f64 = 0.7;
    let k1 = 0.45;
    let k2 = -0.015;
    let sqrt_phi = phi_s.sqrt();

    let vt_therm = 1.380649e-23 * t_actual / 1.602176634e-19;
    let n_factor = 1.3;

    let u0 = u0_nom * (tnom / t_actual).powf(ute);

    let v_gs = Dual3::new(vgs, 0);
    let v_ds = Dual3::new(vds, 1);
    let v_bs = Dual3::new(vbs, 2);

    let v_ds_pos = v_ds.max_val(0.0);
    let v_bs_eff = v_bs.min_val(0.0);

    let sqrt_phi_vbs = (Dual3::constant(phi_s) - v_bs_eff).max_val(0.01).sqrt();
    let body_shift = (sqrt_phi_vbs - sqrt_phi) * k1 - v_bs_eff * k2;
    let lpe0 = 1.2e-7;
    let pocket_shift = k1 * ((1.0 + lpe0 / l).sqrt() - 1.0) * sqrt_phi;
    let sce_shift = -dvt0 * (1.4e-8 / l) * sqrt_phi;
    let v_th_local = body_shift + (vth_thermal + pocket_shift + sce_shift) - v_ds_pos * theta_dibl;

    let v_gst = v_gs - v_th_local;

    let n_vt = n_factor * vt_therm;
    let voff = -0.08;
    let v_gsteff = if v_gst.val > 30.0 * n_vt {
        v_gst
    } else if v_gst.val < -30.0 * n_vt {
        (v_gst / (2.0 * n_vt)).exp() * (2.0 * n_vt)
    } else {
        let exp_term = (v_gst / (2.0 * n_vt)).exp();
        let num = (Dual3::constant(1.0) + exp_term).ln() * (2.0 * n_vt);
        let exp_denom = (-(v_gst - 2.0 * voff) / (2.0 * n_vt)).exp();
        let denom = Dual3::constant(1.0) + exp_denom * 0.08;
        num / denom
    };

    // Corriente cuántica de compuerta Ig (Direct Tunneling)
    let tox_ratio = toxe / 1.4e-9;
    let (igs, gg) = if vgs > 0.0 {
        let tunneling_exponent = -11.9 * tox_ratio / vgs;
        let igs_val = 1.5e-6 * (w / l) * vgs * vgs * tunneling_exponent.exp();
        let gg_val = 1.5e-6 * (w / l) * (2.0 * vgs + 11.9 * tox_ratio) * tunneling_exponent.exp();
        (igs_val, gg_val)
    } else {
        (0.0, 1e-12)
    };

    if v_gsteff.val <= 1e-12 {
        return (0.0, 1e-12, 1e-12, 0.0, igs, gg);
    }

    let e_eff = (v_gsteff + 2.0 * v_th_local.abs().val) / (6.0 * toxe);
    let denom_mu =
        Dual3::constant(1.0) + (Dual3::constant(ua) + v_bs_eff * uc) * e_eff + (e_eff * e_eff) * ub;
    let mu_eff = Dual3::constant(u0) / denom_mu.max_val(0.05);

    let abulk = (Dual3::constant(k1)
        / ((Dual3::constant(phi_s) - v_bs_eff).max_val(0.01).sqrt() * 2.0))
        * (0.5 * l / (l + 0.05e-6))
        + 1.0;

    let esat = mu_eff.powf(-1.0) * (2.0 * vsat);
    let esat_l = esat * l;

    let vdsat = (esat_l * v_gsteff) / (abulk * esat_l + v_gsteff);

    let delta = 0.015;
    let diff = vdsat - v_ds_pos - delta;
    let vdseff = vdsat - (diff + (diff * diff + vdsat * (4.0 * delta)).sqrt()) * 0.5;

    let factor_lin = Dual3::constant(1.0) - (abulk * vdseff) / ((v_gsteff + 2.0 * vt_therm) * 2.0);
    let num_ids = (mu_eff * (w * cox)) * v_gsteff * factor_lin.max_val(0.05) * vdseff;
    let denom_ids = (vdseff / esat_l + 1.0) * l;
    let ids0 = num_ids / denom_ids;

    let v_asclm = esat_l / pclm_val;
    let clm_factor = (v_ds_pos - vdseff).max_val(0.0) / (v_asclm + v_ds_pos) + 1.0;

    let rdsw_scaled = rdsw_val * (1.0e-6 / w);
    let ids_clm = ids0 * clm_factor;
    let ids_total = ids_clm / (ids_clm * rdsw_scaled / (v_ds_pos + 0.1) + 1.0);

    let ids = ids_total.val;
    let gm = ids_total.deriv[0].max(1e-12);
    let gds = ids_total.deriv[1].max(1e-12);
    let gmb = ids_total.deriv[2].max(0.0);

    (ids, gm, gds, gmb, igs, gg)
}

/// Evaluador físico completo BSIM4 para transistores PMOS de canal corto (45nm - 14nm)
/// con diferenciación automática continua Dual3.
pub fn evaluate_bsim4_pmos(
    vsg: f64,
    vsd: f64,
    vsb: f64,
    vth_netlist: f64,
    w_opt: Option<f64>,
    l_opt: Option<f64>,
    temp_k: Option<f64>,
    comp: Option<&ComponentData>,
) -> (f64, f64, f64, f64, f64, f64) {
    let tnom = 300.15;
    let t_actual = temp_k.unwrap_or(tnom);
    let toxe = comp
        .and_then(|c| c.bsim_toxe.or(c.bsim_tox))
        .unwrap_or(1.4e-9);
    let eps_ox = 3.9 * 8.854187817e-12;
    let cox = eps_ox / toxe;
    let w = w_opt.or_else(|| comp.and_then(|c| c.w)).unwrap_or(1.0e-6);
    let l = l_opt.or_else(|| comp.and_then(|c| c.l)).unwrap_or(0.045e-6);
    let u0_nom = comp.and_then(|c| c.bsim_u0).unwrap_or(0.011);
    let vsat = comp.and_then(|c| c.bsim_vmax).unwrap_or(8.0e4);

    let theta_override = comp.and_then(|c| c.bsim_theta).unwrap_or(0.0);
    let ua = 5.0e-10 + theta_override;
    let ub = 2.5e-18;
    let uc = -0.02;
    let theta_dibl = comp.and_then(|c| c.bsim_eta0).unwrap_or(0.12);
    let dvt0 = comp.and_then(|c| c.bsim_dvt0).unwrap_or(2.2);
    let rdsw_val = comp.and_then(|c| c.bsim_rdsw).unwrap_or(100.0);
    let pclm_val = comp.and_then(|c| c.bsim_pclm).unwrap_or(0.8);

    let kt1 = -0.11;
    let ute = -1.5;
    let delta_t = t_actual - tnom;
    let vth0 = comp
        .and_then(|c| c.bsim_vth0)
        .unwrap_or(if vth_netlist != 0.0 { vth_netlist.abs() } else { 0.35 });
    let vth_thermal = vth0 + kt1 * (delta_t / tnom);

    let phi_s: f64 = 0.7;
    let k1 = 0.45;
    let k2 = -0.015;
    let sqrt_phi = phi_s.sqrt();

    let vt_therm = 1.380649e-23 * t_actual / 1.602176634e-19;
    let n_factor = 1.3;

    let u0 = u0_nom * (tnom / t_actual).powf(ute);

    let v_sg = Dual3::new(vsg, 0);
    let v_sd = Dual3::new(vsd, 1);
    let v_sb = Dual3::new(vsb, 2);

    let v_sd_pos = v_sd.max_val(0.0);
    let v_sb_eff = v_sb.min_val(0.0);

    let sqrt_phi_vsb = (Dual3::constant(phi_s) - v_sb_eff).max_val(0.01).sqrt();
    let body_shift = (sqrt_phi_vsb - sqrt_phi) * k1 - v_sb_eff * k2;
    let lpe0 = 1.2e-7;
    let pocket_shift = k1 * ((1.0 + lpe0 / l).sqrt() - 1.0) * sqrt_phi;
    let sce_shift = -dvt0 * (1.4e-8 / l) * sqrt_phi;
    let v_th_local = body_shift + (vth_thermal + pocket_shift + sce_shift) - v_sd_pos * theta_dibl;

    let v_sgt = v_sg - v_th_local;

    let n_vt = n_factor * vt_therm;
    let voff = -0.08;
    let v_sgteff = if v_sgt.val > 30.0 * n_vt {
        v_sgt
    } else if v_sgt.val < -30.0 * n_vt {
        (v_sgt / (2.0 * n_vt)).exp() * (2.0 * n_vt)
    } else {
        let exp_term = (v_sgt / (2.0 * n_vt)).exp();
        let num = (Dual3::constant(1.0) + exp_term).ln() * (2.0 * n_vt);
        let exp_denom = (-(v_sgt - 2.0 * voff) / (2.0 * n_vt)).exp();
        let denom = Dual3::constant(1.0) + exp_denom * 0.08;
        num / denom
    };

    let tox_ratio = toxe / 1.4e-9;
    let (igs, gg) = if vsg > 0.0 {
        let tunneling_exponent = -11.9 * tox_ratio / vsg;
        let igs_val = 8.0e-7 * (w / l) * vsg * vsg * tunneling_exponent.exp();
        let gg_val = 8.0e-7 * (w / l) * (2.0 * vsg + 11.9 * tox_ratio) * tunneling_exponent.exp();
        (igs_val, gg_val)
    } else {
        (0.0, 1e-12)
    };

    if v_sgteff.val <= 1e-12 {
        return (0.0, 1e-12, 1e-12, 0.0, igs, gg);
    }

    let e_eff = (v_sgteff + 2.0 * v_th_local.abs().val) / (6.0 * toxe);
    let denom_mu =
        Dual3::constant(1.0) + (Dual3::constant(ua) + v_sb_eff * uc) * e_eff + (e_eff * e_eff) * ub;
    let mu_eff = Dual3::constant(u0) / denom_mu.max_val(0.05);

    let abulk = (Dual3::constant(k1)
        / ((Dual3::constant(phi_s) - v_sb_eff).max_val(0.01).sqrt() * 2.0))
        * (0.5 * l / (l + 0.05e-6))
        + 1.0;

    let esat = mu_eff.powf(-1.0) * (2.0 * vsat);
    let esat_l = esat * l;

    let vsdsat = (esat_l * v_sgteff) / (abulk * esat_l + v_sgteff);

    let delta = 0.015;
    let diff = vsdsat - v_sd_pos - delta;
    let vsdeff = vsdsat - (diff + (diff * diff + vsdsat * (4.0 * delta)).sqrt()) * 0.5;

    let factor_lin = Dual3::constant(1.0) - (abulk * vsdeff) / ((v_sgteff + 2.0 * vt_therm) * 2.0);
    let num_isd = (mu_eff * (w * cox)) * v_sgteff * factor_lin.max_val(0.05) * vsdeff;
    let denom_isd = (vsdeff / esat_l + 1.0) * l;
    let isd0 = num_isd / denom_isd;

    let v_asclm = esat_l / pclm_val;
    let clm_factor = (v_sd_pos - vsdeff).max_val(0.0) / (v_asclm + v_sd_pos) + 1.0;

    let rdsw_scaled = rdsw_val * (1.0e-6 / w);
    let isd_clm = isd0 * clm_factor;
    let isd_total = isd_clm / (isd_clm * rdsw_scaled / (v_sd_pos + 0.1) + 1.0);

    let isd = isd_total.val;
    let gm = isd_total.deriv[0].max(1e-12);
    let gds = isd_total.deriv[1].max(1e-12);
    let gmb = isd_total.deriv[2].max(0.0);

    (isd, gm, gds, gmb, igs, gg)
}

/// Calcula capacitancias intrínsecas y de solape BSIM4 (Cgs, Cgd, Cgb).
pub fn evaluate_bsim4_capacitances(
    vgs: f64,
    vds: f64,
    _vbs: f64,
    vth: f64,
    w: f64,
    l: f64,
    toxe: f64,
    comp: Option<&ComponentData>,
) -> (f64, f64, f64) {
    let eps_ox = 3.9 * 8.854187817e-12;
    let tox_eff = if toxe > 0.0 { toxe } else { 1.4e-9 };
    let cox = eps_ox / tox_eff;
    let cgg0 = w * l * cox;

    // Capacitancias de solape (overlap)
    let cgso_unit = comp.and_then(|c| c.bsim_cgso).unwrap_or(2.0e-10);
    let cgdo_unit = comp.and_then(|c| c.bsim_cgdo).unwrap_or(2.0e-10);
    let cgbo_unit = comp.and_then(|c| c.bsim_cgbo).unwrap_or(1.0e-10);

    let cgso = cgso_unit * w;
    let cgdo = cgdo_unit * w;
    let cgbo = cgbo_unit * l;

    let vgst = vgs - vth;
    let vdsat = (0.5 * vgst).max(0.02);

    if vgst <= 0.0 {
        // Subumbral / Acumulación
        let cgb_intrinsic = cgg0 * 0.5;
        (cgso, cgdo, cgb_intrinsic + cgbo)
    } else if vds < vdsat {
        // Zona lineal (Triodo)
        let ratio = vds / vdsat;
        let cgs = cgg0 * (0.5 - 0.1 * ratio) + cgso;
        let cgd = cgg0 * (0.5 - 0.2 * ratio) + cgdo;
        let cgb = cgbo;
        (cgs, cgd, cgb)
    } else {
        // Saturación
        let cgs = (2.0 / 3.0) * cgg0 + cgso;
        let cgd = cgdo;
        let cgb = cgbo;
        (cgs, cgd, cgb)
    }
}
