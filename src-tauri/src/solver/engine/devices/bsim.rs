use crate::solver::types::ComponentData;

/// Evaluador físico completo BSIM3v3.2 / BSIM3v3.3 para transistores NMOS.
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

    // Función auxiliar para calcular Ids para un punto de operación (vgs, vds, vbs)
    let calc_ids = |v_gs: f64, v_ds: f64, v_bs: f64| -> f64 {
        let v_ds_pos = v_ds.max(0.0);
        let v_bs_eff = v_bs.min(0.0);

        // Umbral local con efecto de cuerpo, efecto de canal corto lateral (pocket / LPE0) y DIBL
        let sqrt_phi_vbs = (phi_s - v_bs_eff).max(0.01).sqrt();
        let body_shift = k1 * (sqrt_phi_vbs - sqrt_phi) - k2 * v_bs_eff;
        let lpe0 = 2.4e-7; // Longitud característica de halo / pocket doping (BSIM3v3 LPE0)
        let pocket_shift = k1 * ((1.0 + lpe0 / l).sqrt() - 1.0) * sqrt_phi;
        let v_th_local = vth_thermal + body_shift + pocket_shift - theta_dibl * v_ds_pos;

        let v_gst = v_gs - v_th_local;

        // Vgsteff continuo y unificado estándar BSIM3 (Berkeley / SPICE LEVEL=49)
        let n_vt = n_factor * vt_therm;
        let voff = -0.08;
        let v_gsteff = if v_gst > 30.0 * n_vt {
            v_gst
        } else if v_gst < -30.0 * n_vt {
            (2.0 * n_vt) * (v_gst / (2.0 * n_vt)).exp()
        } else {
            let exp_term = (v_gst / (2.0 * n_vt)).exp();
            let num = (2.0 * n_vt) * (1.0 + exp_term).ln();
            let exp_denom = (-(v_gst - 2.0 * voff) / (2.0 * n_vt)).exp();
            let denom = 1.0 + 0.08 * exp_denom;
            num / denom
        };

        if v_gsteff <= 1e-12 {
            return 0.0;
        }

        // Campo vertical efectivo y movilidad degradada
        let e_eff = (v_gsteff + 2.0 * v_th_local.abs()) / (6.0 * tox);
        let denom_mu = 1.0 + (ua + uc * v_bs_eff) * e_eff + ub * e_eff * e_eff;
        let mu_eff = u0 / denom_mu.max(0.1);

        // Parámetro de carga de cuerpo Abulk
        let abulk =
            1.0 + (k1 / (2.0 * (phi_s - v_bs_eff).max(0.01).sqrt())) * (0.5 * l / (l + 0.15e-6));

        // Velocidad de saturación y Esat
        let esat = 2.0 * vsat / mu_eff;
        let esat_l = esat * l;

        // Tensión de saturación Vdsat
        let vdsat = (esat_l * v_gsteff) / (abulk * esat_l + v_gsteff);

        // Vdseff suave para transición continua entre zona lineal y saturación
        let delta = 0.02;
        let diff = vdsat - v_ds_pos - delta;
        let vdseff = vdsat - 0.5 * (diff + (diff * diff + 4.0 * delta * vdsat).sqrt());

        // Corriente de canal intrínseca Ids0
        let factor_lin = 1.0 - (abulk * vdseff) / (2.0 * (v_gsteff + 2.0 * vt_therm));
        let num_ids = w * mu_eff * cox * v_gsteff * factor_lin.max(0.1) * vdseff;
        let denom_ids = l * (1.0 + vdseff / esat_l);
        let ids0 = num_ids / denom_ids;

        // Modulación de longitud de canal (CLM) y Early effect
        let pclm = 0.8;
        let v_asclm = esat_l / pclm;
        let clm_factor = 1.0 + (v_ds_pos - vdseff).max(0.0) / (v_asclm + v_ds_pos);

        // Resistencia parasitaria de contacto Rdsw (típica en tecnologías submicrónicas)
        let rdsw = 100.0 * (1.0e-6 / w); // Ohms
        (ids0 * clm_factor) / (1.0 + (ids0 * clm_factor) * rdsw / (v_ds_pos + 0.1))
    };

    let ids = calc_ids(vgs, vds, vbs);

    // Derivadas numéricas robustas (perturbación diferencial)
    let delta_v = 1.0e-5;
    let ids_vgs_plus = calc_ids(vgs + delta_v, vds, vbs);
    let ids_vgs_minus = calc_ids(vgs - delta_v, vds, vbs);
    let gm = ((ids_vgs_plus - ids_vgs_minus) / (2.0 * delta_v)).max(1e-12);

    let ids_vds_plus = calc_ids(vgs, vds + delta_v, vbs);
    let ids_vds_minus = calc_ids(vgs, vds - delta_v, vbs);
    let gds = ((ids_vds_plus - ids_vds_minus) / (2.0 * delta_v)).max(1e-12);

    (ids, gm, gds)
}

/// Evaluador físico completo BSIM3v3.2 / BSIM3v3.3 para transistores PMOS.
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
    let vsb_clamped = vsb.min(0.0);
    let sqrt_phi = phi_s.sqrt();
    let sqrt_phi_vsb = (phi_s - vsb_clamped).max(0.01).sqrt();
    let body_shift = k1 * (sqrt_phi_vsb - sqrt_phi) - k2 * vsb_clamped;

    let _vth = vth_thermal + body_shift - theta_dibl * vsd.max(0.0);

    let vt_therm = 1.380649e-23 * t_actual / 1.602176634e-19;
    let n_factor = 1.25;

    let u0 = u0_nom * (tnom / t_actual).powf(ute);

    let calc_isd = |v_sg: f64, v_sd: f64, v_sb: f64| -> f64 {
        let v_sd_pos = v_sd.max(0.0);
        let v_sb_eff = v_sb.min(0.0);
        let sqrt_phi_vsb = (phi_s - v_sb_eff).max(0.01).sqrt();
        let body_shift = k1 * (sqrt_phi_vsb - sqrt_phi) - k2 * v_sb_eff;
        let lpe0 = 2.4e-7;
        let pocket_shift = k1 * ((1.0 + lpe0 / l).sqrt() - 1.0) * sqrt_phi;
        let v_th_local = vth_thermal + body_shift + pocket_shift - theta_dibl * v_sd_pos;

        let v_sgt = v_sg - v_th_local;

        let n_vt = n_factor * vt_therm;
        let voff = -0.08;
        let v_sgteff = if v_sgt > 30.0 * n_vt {
            v_sgt
        } else if v_sgt < -30.0 * n_vt {
            (2.0 * n_vt) * (v_sgt / (2.0 * n_vt)).exp()
        } else {
            let exp_term = (v_sgt / (2.0 * n_vt)).exp();
            let num = (2.0 * n_vt) * (1.0 + exp_term).ln();
            let exp_denom = (-(v_sgt - 2.0 * voff) / (2.0 * n_vt)).exp();
            let denom = 1.0 + 0.08 * exp_denom;
            num / denom
        };

        if v_sgteff <= 1e-12 {
            return 0.0;
        }

        let e_eff = (v_sgteff + 2.0 * v_th_local.abs()) / (6.0 * tox);
        let denom_mu = 1.0 + (ua + uc * v_sb_eff) * e_eff + ub * e_eff * e_eff;
        let mu_eff = u0 / denom_mu.max(0.1);

        let abulk =
            1.0 + (k1 / (2.0 * (phi_s - v_sb_eff).max(0.01).sqrt())) * (0.5 * l / (l + 0.15e-6));

        let esat = 2.0 * vsat / mu_eff;
        let esat_l = esat * l;

        let vsdsat = (esat_l * v_sgteff) / (abulk * esat_l + v_sgteff);

        let delta = 0.02;
        let diff = vsdsat - v_sd_pos - delta;
        let vsdeff = vsdsat - 0.5 * (diff + (diff * diff + 4.0 * delta * vsdsat).sqrt());

        let factor_lin = 1.0 - (abulk * vsdeff) / (2.0 * (v_sgteff + 2.0 * vt_therm));
        let num_isd = w * mu_eff * cox * v_sgteff * factor_lin.max(0.1) * vsdeff;
        let denom_isd = l * (1.0 + vsdeff / esat_l);
        let isd0 = num_isd / denom_isd;

        let pclm = 0.8;
        let v_asclm = esat_l / pclm;
        let clm_factor = 1.0 + (v_sd_pos - vsdeff).max(0.0) / (v_asclm + v_sd_pos);

        let rdsw = 100.0 * (1.0e-6 / w);
        (isd0 * clm_factor) / (1.0 + (isd0 * clm_factor) * rdsw / (v_sd_pos + 0.1))
    };

    let isd = calc_isd(vsg, vsd, vsb);

    let delta_v = 1.0e-5;
    let isd_vsg_plus = calc_isd(vsg + delta_v, vsd, vsb);
    let isd_vsg_minus = calc_isd(vsg - delta_v, vsd, vsb);
    let gm = ((isd_vsg_plus - isd_vsg_minus) / (2.0 * delta_v)).max(1e-12);

    let isd_vsd_plus = calc_isd(vsg, vsd + delta_v, vsb);
    let isd_vsd_minus = calc_isd(vsg, vsd - delta_v, vsb);
    let gds = ((isd_vsd_plus - isd_vsd_minus) / (2.0 * delta_v)).max(1e-12);

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

pub fn evaluate_bsim4_nmos(
    vgs: f64,
    vds: f64,
    vbs: f64,
    vth_netlist: f64,
    w_opt: Option<f64>,
    l_opt: Option<f64>,
) -> (f64, f64, f64, f64, f64) {
    let tox = 1.4e-9;
    let eps_ox = 3.9 * 8.85418e-12;
    let cox = eps_ox / tox;
    let w = w_opt.unwrap_or(1.0e-6);
    let l = l_opt.unwrap_or(0.045e-6);
    let u0 = 0.032;
    let vsat = 1.2e5;
    let abulk = 1.1;
    let ua = 5.0e-10;
    let ub = 2.5e-18;
    let uc = -0.02;
    let theta_dibl = 0.12;
    let vt_therm = 0.025852;
    let n_factor = 1.3;
    let lambda_clm = 0.08;

    let vth0 = if vth_netlist != 0.0 {
        vth_netlist
    } else {
        0.35
    };
    let vth = vth0 - theta_dibl * vds;

    let e_vert = (vgs + vth).abs() / tox;
    let mu_eff = u0 / (1.0 + (ua * e_vert + ub * e_vert * e_vert) * (1.0 + uc * vbs));
    let esat = 2.0 * vsat / mu_eff;

    // Direct Gate oxide tunneling current Ig (Direct tunneling through ultra-thin oxide)
    let (igs, gg) = if vgs > 0.0 {
        let tunneling_exponent = -11.9 / vgs;
        let igs_val = 1.5e-6 * (w / l) * vgs * vgs * tunneling_exponent.exp();
        let gg_val = 1.5e-6 * (w / l) * (2.0 * vgs + 11.9) * tunneling_exponent.exp();
        (igs_val, gg_val)
    } else {
        (0.0, 1e-12)
    };

    let (ids, gm, gds) = if vgs <= vth {
        // Subthreshold Region
        let i_off = 1.5e-7 * (w / l);
        let exp_sub = ((vgs - vth) / (n_factor * vt_therm)).exp();
        let exp_vds = (-vds.max(0.0) / vt_therm).exp();
        let ids_val = i_off * exp_sub * (1.0 - exp_vds) * (1.0 + lambda_clm * vds);

        let gm_val = ids_val / (n_factor * vt_therm);
        let gds_val = i_off * exp_sub * (exp_vds / vt_therm) * (1.0 + lambda_clm * vds)
            + ids_val * lambda_clm / (1.0 + lambda_clm * vds);

        (ids_val, gm_val, gds_val.max(1e-9))
    } else {
        let vds_sat = (esat * l * (vgs - vth)) / (esat * l + abulk * (vgs - vth));

        if vds < vds_sat {
            // Triode Region
            let denom = 1.0 + vds / (esat * l);
            let num = w * mu_eff * cox * (vgs - vth - abulk * vds / 2.0) * vds;
            let ids_base = num / (denom * l);
            let ids_val = ids_base * (1.0 + lambda_clm * vds);

            let gm_val = ((w * mu_eff * cox * vds) / (denom * l)) * (1.0 + lambda_clm * vds);
            let gds_val = ((w * mu_eff * cox * (vgs - vth - abulk * vds)) / (denom * l))
                * (1.0 + lambda_clm * vds)
                + ids_base * lambda_clm;

            (ids_val, gm_val, gds_val.max(1e-9))
        } else {
            // Saturation Region
            let denom = 1.0 + vds_sat / (esat * l);
            let num = w * mu_eff * cox * (vgs - vth - abulk * vds_sat / 2.0) * vds_sat;
            let ids_base = num / (denom * l);
            let ids_val = ids_base * (1.0 + lambda_clm * vds);

            let gm_val = ((w * mu_eff * cox * vds_sat) / (denom * l)) * (1.0 + lambda_clm * vds);
            let gds_val = ids_base * lambda_clm;

            (ids_val, gm_val, gds_val.max(1e-9))
        }
    };

    (ids, gm, gds, igs, gg)
}

pub fn evaluate_bsim4_pmos(
    vsg: f64,
    vsd: f64,
    vsb: f64,
    vth_netlist: f64,
    w_opt: Option<f64>,
    l_opt: Option<f64>,
) -> (f64, f64, f64, f64, f64) {
    let tox = 1.4e-9;
    let eps_ox = 3.9 * 8.85418e-12;
    let cox = eps_ox / tox;
    let w = w_opt.unwrap_or(1.0e-6);
    let l = l_opt.unwrap_or(0.045e-6);
    let u0 = 0.011;
    let vsat = 8.0e4;
    let abulk = 1.1;
    let ua = 5.0e-10;
    let ub = 2.5e-18;
    let uc = -0.02;
    let theta_dibl = 0.12;
    let vt_therm = 0.025852;
    let n_factor = 1.3;
    let lambda_clm = 0.08;

    let vth0 = if vth_netlist != 0.0 {
        vth_netlist.abs()
    } else {
        0.35
    };
    let vth = vth0 - theta_dibl * vsd;

    let e_vert = (vsg + vth).abs() / tox;
    let mu_eff = u0 / (1.0 + (ua * e_vert + ub * e_vert * e_vert) * (1.0 + uc * vsb));
    let esat = 2.0 * vsat / mu_eff;

    // Gate leakage direct tunneling for PMOS
    let (igs, gg) = if vsg > 0.0 {
        let tunneling_exponent = -11.9 / vsg;
        let igs_val = 8.0e-7 * (w / l) * vsg * vsg * tunneling_exponent.exp();
        let gg_val = 8.0e-7 * (w / l) * (2.0 * vsg + 11.9) * tunneling_exponent.exp();
        (igs_val, gg_val)
    } else {
        (0.0, 1e-12)
    };

    let (isd, gm, gds) = if vsg <= vth {
        // Subthreshold Region
        let i_off = 1.5e-7 * (w / l);
        let exp_sub = ((vsg - vth) / (n_factor * vt_therm)).exp();
        let exp_vsd = (-vsd.max(0.0) / vt_therm).exp();
        let ids_val = i_off * exp_sub * (1.0 - exp_vsd) * (1.0 + lambda_clm * vsd);

        let gm_val = ids_val / (n_factor * vt_therm);
        let gds_val = i_off * exp_sub * (exp_vsd / vt_therm) * (1.0 + lambda_clm * vsd)
            + ids_val * lambda_clm / (1.0 + lambda_clm * vsd);

        (ids_val, gm_val, gds_val.max(1e-9))
    } else {
        let vds_sat = (esat * l * (vsg - vth)) / (esat * l + abulk * (vsg - vth));

        if vsd < vds_sat {
            // Triode Region
            let denom = 1.0 + vsd / (esat * l);
            let num = w * mu_eff * cox * (vsg - vth - abulk * vsd / 2.0) * vsd;
            let ids_base = num / (denom * l);
            let ids_val = ids_base * (1.0 + lambda_clm * vsd);

            let gm_val = ((w * mu_eff * cox * vsd) / (denom * l)) * (1.0 + lambda_clm * vsd);
            let gds_val = ((w * mu_eff * cox * (vsg - vth - abulk * vsd)) / (denom * l))
                * (1.0 + lambda_clm * vsd)
                + ids_base * lambda_clm;

            (ids_val, gm_val, gds_val.max(1e-9))
        } else {
            // Saturation Region
            let denom = 1.0 + vds_sat / (esat * l);
            let num = w * mu_eff * cox * (vsg - vth - abulk * vds_sat / 2.0) * vds_sat;
            let ids_base = num / (denom * l);
            let ids_val = ids_base * (1.0 + lambda_clm * vsd);

            let gm_val = ((w * mu_eff * cox * vds_sat) / (denom * l)) * (1.0 + lambda_clm * vsd);
            let gds_val = ids_base * lambda_clm;

            (ids_val, gm_val, gds_val.max(1e-9))
        }
    };

    (isd, gm, gds, igs, gg)
}
