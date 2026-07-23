use crate::solver::types::ComponentData;

#[allow(dead_code)]
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
    let u0_nom = comp.and_then(|c| c.bsim_u0).unwrap_or(0.045); // Movilidad nominal a Tnom
    let vsat = comp.and_then(|c| c.bsim_vmax).unwrap_or(8.0e4);
    let abulk = 1.2;
    // Degradación de movilidad por campo vertical (theta)
    let theta = comp.and_then(|c| c.bsim_theta).unwrap_or(0.0);
    let ua = 2.25e-9 + theta; // Aproximación
    let ub = 1.8e-15;
    let uc = -0.05;
    let theta_dibl = comp.and_then(|c| c.bsim_eta0).unwrap_or(0.08);
    let n_factor = 1.4;

    // --- Coeficientes de temperatura BSIM3 para NMOS ---
    let kt1 = -0.11; // Coeficiente de temperatura de Vth (V)
    let ute = -1.5; // Exponente de degradación de movilidad térmica

    // Derivación térmica del voltaje de umbral: Vth(T) = Vth0 + kt1 * (T - Tnom) / Tnom
    let vth0 = if vth_netlist != 0.0 { vth_netlist } else { 0.4 };
    let delta_t = t_actual - tnom;
    let vth_thermal = vth0 + kt1 * (delta_t / tnom);
    let vth = vth_thermal - theta_dibl * vds;

    // Voltaje térmico a la temperatura actual
    let vt_therm = 1.380649e-23 * t_actual / 1.602176634e-19;

    // Degradación de movilidad térmica: mu(T) = mu0 * (Tnom / T)^ute
    let u0 = u0_nom * (tnom / t_actual).powf(ute);

    let e_vert = (vgs + vth).abs() / tox;
    let mu_eff = u0 / (1.0 + (ua * e_vert + ub * e_vert * e_vert) * (1.0 + uc * vbs));
    let esat = 2.0 * vsat / mu_eff;

    let (ids, gm, gds) = if vgs <= vth {
        let i_off = 1e-7 * (w / l);
        let exp_sub = ((vgs - vth) / (n_factor * vt_therm)).exp();
        let exp_vds = (-vds.max(0.0) / vt_therm).exp();
        let ids_val = i_off * exp_sub * (1.0 - exp_vds);

        let gm_val = ids_val / (n_factor * vt_therm);
        let gds_val = i_off * exp_sub * (exp_vds / vt_therm);

        (ids_val, gm_val, gds_val.max(1e-9))
    } else {
        let vds_sat = (esat * l * (vgs - vth)) / (esat * l + abulk * (vgs - vth));

        if vds < vds_sat {
            let denom = 1.0 + vds / (esat * l);
            let num = w * mu_eff * cox * (vgs - vth - abulk * vds / 2.0) * vds;
            let ids_val = num / (denom * l);

            let gm_val = (w * mu_eff * cox * vds) / (denom * l);
            let gds_val = (w * mu_eff * cox * (vgs - vth - abulk * vds)) / (denom * l);

            (ids_val, gm_val, gds_val.max(1e-9))
        } else {
            let denom = 1.0 + vds_sat / (esat * l);
            let num = w * mu_eff * cox * (vgs - vth - abulk * vds_sat / 2.0) * vds_sat;
            let ids_val = num / (denom * l);

            let gm_val = (w * mu_eff * cox * vds_sat) / (denom * l);
            let gds_val = ids_val * 0.05 / (vds + 1e-3);

            (ids_val, gm_val, gds_val.max(1e-9))
        }
    };

    (ids, gm, gds)
}

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
    let u0_nom = comp.and_then(|c| c.bsim_u0).unwrap_or(0.015); // Movilidad nominal a Tnom (menor que NMOS)
    let vsat = comp.and_then(|c| c.bsim_vmax).unwrap_or(6.0e4);
    let abulk = 1.2;
    // Degradación de movilidad por campo vertical (theta)
    let theta = comp.and_then(|c| c.bsim_theta).unwrap_or(0.0);
    let ua = 2.25e-9 + theta; // Aproximación
    let ub = 1.8e-15;
    let uc = -0.05;
    let theta_dibl = comp.and_then(|c| c.bsim_eta0).unwrap_or(0.08);
    let n_factor = 1.4;

    // --- Coeficientes de temperatura BSIM3 para PMOS ---
    let kt1 = -0.12; // Coeficiente de temperatura de Vth para PMOS
    let ute = -1.2; // Exponente de degradación de movilidad térmica (PMOS)

    let vth0 = if vth_netlist != 0.0 {
        vth_netlist.abs()
    } else {
        0.4
    };
    let delta_t = t_actual - tnom;
    let vth_thermal = vth0 + kt1 * (delta_t / tnom);
    let vth = vth_thermal - theta_dibl * vsd;

    // Voltaje térmico a la temperatura actual
    let vt_therm = 1.380649e-23 * t_actual / 1.602176634e-19;

    // Degradación de movilidad térmica
    let u0 = u0_nom * (tnom / t_actual).powf(ute);

    let e_vert = (vsg + vth).abs() / tox;
    let mu_eff = u0 / (1.0 + (ua * e_vert + ub * e_vert * e_vert) * (1.0 + uc * vsb));
    let esat = 2.0 * vsat / mu_eff;

    let (isd, gm, gds) = if vsg <= vth {
        let i_off = 1e-7 * (w / l);
        let exp_sub = ((vsg - vth) / (n_factor * vt_therm)).exp();
        let exp_vsd = (-vsd.max(0.0) / vt_therm).exp();
        let ids_val = i_off * exp_sub * (1.0 - exp_vsd);

        let gm_val = ids_val / (n_factor * vt_therm);
        let gds_val = i_off * exp_sub * (exp_vsd / vt_therm);

        (ids_val, gm_val, gds_val.max(1e-9))
    } else {
        let vds_sat = (esat * l * (vsg - vth)) / (esat * l + abulk * (vsg - vth));

        if vsd < vds_sat {
            let denom = 1.0 + vsd / (esat * l);
            let num = w * mu_eff * cox * (vsg - vth - abulk * vsd / 2.0) * vsd;
            let ids_val = num / (denom * l);

            let gm_val = (w * mu_eff * cox * vsd) / (denom * l);
            let gds_val = (w * mu_eff * cox * (vsg - vth - abulk * vsd)) / (denom * l);

            (ids_val, gm_val, gds_val.max(1e-9))
        } else {
            let denom = 1.0 + vds_sat / (esat * l);
            let num = w * mu_eff * cox * (vsg - vth - abulk * vds_sat / 2.0) * vds_sat;
            let ids_val = num / (denom * l);

            let gm_val = (w * mu_eff * cox * vds_sat) / (denom * l);
            let gds_val = ids_val * 0.05 / (vsd + 1e-3);

            (ids_val, gm_val, gds_val.max(1e-9))
        }
    };

    (isd, gm, gds)
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
