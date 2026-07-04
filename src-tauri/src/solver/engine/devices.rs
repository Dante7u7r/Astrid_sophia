use std::collections::HashMap;
use crate::ad_value::AdValue;
use crate::solver::types::*;

#[allow(unused_imports)]
use super::dc::*;
#[allow(unused_imports)]
use super::transient::*;
#[allow(unused_imports)]
use super::ac::*;
#[allow(unused_imports)]
use super::advanced::*;

// Constantes físicas universales
pub const PHYS_KB: f64 = 1.380649e-23;   // Constante de Boltzmann (J/K)
pub const PHYS_Q: f64 = 1.602176634e-19; // Carga del electrón (C)
pub const PHYS_T: f64 = 300.0;           // Temperatura estándar (300 K = 26.85 ºC)

// Constantes físicas para el modelo del Diodo PN (Shockley)
pub const DIODE_IS: f64 = 1e-12;       // Corriente de saturación inversa (1 pA)
pub const DIODE_VT: f64 = 0.025852;    // Voltaje térmico a 300K (25.85 mV)
pub const DIODE_N: f64 = 1.0;          // Coeficiente de emisión ideal

// Parámetros de capacidades dinámicas de diodos y transistores (Fase 13)
pub const DIODE_TT: f64 = 10e-9;      // Tiempo de tránsito de portadores de difusión (10 ns)
pub const DIODE_CJO: f64 = 2e-12;     // Capacidad de unión a cero voltios (2 pF)
pub const DIODE_VJ: f64 = 0.6;        // Potencial de contacto de unión (0.6 V)
pub const DIODE_M: f64 = 0.5;         // Coeficiente de graduación de unión (0.5)

pub fn get_thermal_parameters(temp_opt: Option<f64>, is_custom: Option<f64>) -> (f64, f64) {
    let temp = temp_opt.unwrap_or(PHYS_T);
    let vt = (1.380649e-23 * temp) / 1.602176634e-19; // k * T / q
    
    // Escalamiento SPICE de Is con la temperatura (Eg = 1.11 eV para silicio)
    let t0 = PHYS_T;
    let eg = 1.11;
    let q = 1.602176634e-19;
    let k = 1.380649e-23;
    
    let base_is = is_custom.unwrap_or(DIODE_IS);
    let is_temp = base_is * (temp / t0).powf(3.0) * (- (eg * q / k) * (1.0 / temp - 1.0 / t0)).exp();
    (vt, is_temp)

}

/// Parámetros térmicos a nivel de unión para self-heating de dispositivos discretos
pub fn get_thermal_parameters_junction(tjunc: f64, is_custom: Option<f64>) -> (f64, f64) {
    let vt = (PHYS_KB * tjunc) / PHYS_Q;
    let t0 = PHYS_T;
    let eg = 1.11;
    let base_is = is_custom.unwrap_or(DIODE_IS);
    let is_temp = base_is * (tjunc / t0).powf(3.0) * (-(eg * PHYS_Q / PHYS_KB) * (1.0 / tjunc - 1.0 / t0)).exp();
    (vt, is_temp)

}

// Constantes de Self-Heating para dispositivos discretos (Modelo RC térmico de unión)
// Resistencia térmica unión-ambiente (°C/W) — valores típicos para encapsulados TO-92/SOT-23
pub const DIODE_RTH_JA: f64 = 150.0;   // Diodo: 150 °C/W (encapsulado DO-41)
pub const BJT_RTH_JA: f64 = 200.0;     // BJT: 200 °C/W (encapsulado TO-92)
pub const MOS_RTH_JA: f64 = 62.5;      // MOSFET: 62.5 °C/W (encapsulado TO-220)

// Capacidad térmica (J/°C) — modela la inercia térmica del chip de silicio
pub const DIODE_CTH: f64 = 0.002;      // Diodo: 2 mJ/°C
pub const BJT_CTH: f64 = 0.005;        // BJT: 5 mJ/°C
pub const MOS_CTH: f64 = 0.010;        // MOSFET: 10 mJ/°C

// Constantes de Self-Heating para optoacopladores (encapsulado DIP-4)
pub const OPTO_RTH_JA: f64 = 200.0;    // Opto DIP-4: 200 °C/W
pub const OPTO_CTH: f64 = 1e-4;        // Opto DIP-4: 100 µJ/°C

// Parámetros por defecto del optoacoplador (lado receptor fototransistor)
pub const OPTO_DEFAULT_CTR: f64 = 0.5;   // Current Transfer Ratio: 50%
pub const OPTO_DEFAULT_VSAT: f64 = 0.2;

// Parámetros por defecto para tiristores (SCR/TRIAC)
pub const SCR_DEFAULT_VGT: f64 = 0.7;   // Voltaje de disparo de puerta (V)
pub const SCR_DEFAULT_IH: f64 = 5e-3;   // Corriente de mantenimiento (A)
pub const SCR_DEFAULT_IS: f64 = 1e-12;  // Corriente de saturación de los BJTs internos (A)
pub const SCR_MAX_BETA: f64 = 200.0;    // β máximo para evitar problemas de convergencia  // Tensión de saturación suave del transistor (V)

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
pub const MOS_VTH_TC: f64 = -2.3e-3;   // dVth/dT = -2.3 mV/°C (Vth disminuye con T)
pub const MOS_MOBILITY_EXPO: f64 = -1.5; // μ(T) = μ₀ * (T/T₀)^(-1.5) (movilidad baja con T)

// Coeficiente de temperatura para β de BJTs (SPICE)
pub const BJT_BETA_EXPO: f64 = 1.8;    // β(T) = β₀ * (T/T₀)^Xti


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

pub fn solve_diode_junction_voltage(v_ext: f64, temp: Option<f64>, comp: &ComponentData) -> (f64, f64, f64) {
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
pub fn evaluate_opto_receiver(vd: f64, gd_led: f64, id_led: f64, v_ce: f64, comp: &ComponentData) -> (f64, f64, f64, f64) {
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
pub const MOS_COX_WL: f64 = 15e-12;   // Capacidad total de óxido W * L * Cox (15 pF)
pub const MOS_CGSO: f64 = 5e-12;      // Capacidad de solapamiento puerta-fuente fija (5 pF)
pub const MOS_CGDO: f64 = 5e-12;      // Capacidad de solapamiento puerta-drenador fija (5 pF)
pub const MOS_CDSO: f64 = 2e-12;      // Capacidad fija drenador-fuente (2 pF)

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
    (c_gs * area_factor, c_gd * area_factor, MOS_CDSO * area_factor)

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
    (c_sg * area_factor, c_sd * area_factor, MOS_CDSO * area_factor)

}

// Parámetros de capacidades dinámicas de BJT (Fase 16)
pub const BJT_TF: f64 = 0.1e-9;      // Tiempo de tránsito directo (100 ps)
pub const BJT_TR: f64 = 10e-9;       // Tiempo de tránsito inverso (10 ns)
pub const BJT_CJE0: f64 = 2e-12;     // Capacidad BE a cero voltios (2 pF)
pub const BJT_CJC0: f64 = 1.5e-12;   // Capacidad BC a cero voltios (1.5 pF)
pub const BJT_VJE: f64 = 0.7;        // Potencial de unión BE (0.7 V)
pub const BJT_VJC: f64 = 0.6;        // Potencial de unión BC (0.6 V)
pub const BJT_M: f64 = 0.33;         // Coeficiente de graduación de unión (0.33)

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

// ============================================================================
// MOTOR DE EXPRESIONES MATEMÁTICAS SPICE (B-SOURCE EVALUATOR)
// Tokenizador + Pratt Parser (Precedence Climbing) + Evaluador
// Zero-dependency: no usa crates externos como meval o evalexpr
// ============================================================================

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    Number(f64),
    Ident(String),
    Plus,
    Minus,
    Star,
    Slash,
    Caret,
    LParen,
    RParen,
    Comma,

}

pub fn tokenize_expression(input: &str) -> Result<Vec<Token>, String> {
    let mut tokens = Vec::new();
    let chars: Vec<char> = input.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        let ch = chars[i];
        match ch {
            ' ' | '\t' | '\n' | '\r' => { i += 1; }
            '+' => { tokens.push(Token::Plus); i += 1; }
            '-' => { tokens.push(Token::Minus); i += 1; }
            '*' => { tokens.push(Token::Star); i += 1; }
            '/' => { tokens.push(Token::Slash); i += 1; }
            '^' => { tokens.push(Token::Caret); i += 1; }
            '(' => { tokens.push(Token::LParen); i += 1; }
            ')' => { tokens.push(Token::RParen); i += 1; }
            ',' => { tokens.push(Token::Comma); i += 1; }
            '0'..='9' | '.' => {
                let start = i;
                while i < len && (chars[i].is_ascii_digit() || chars[i] == '.' || chars[i] == 'e' || chars[i] == 'E'
                    || ((chars[i] == '+' || chars[i] == '-') && i > start && (chars[i-1] == 'e' || chars[i-1] == 'E'))) {
                    i += 1;
                }
                let num_str: String = chars[start..i].iter().collect();
                let val = num_str.parse::<f64>().map_err(|_| format!("Número inválido en expresión B-Source: '{}'", num_str))?;
                tokens.push(Token::Number(val));
            }
            c if c.is_ascii_alphabetic() || c == '_' => {
                let start = i;
                while i < len && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                    i += 1;
                }
                let ident: String = chars[start..i].iter().collect();
                tokens.push(Token::Ident(ident));
            }
            _ => {
                return Err(format!("Carácter inesperado '{}' en expresión B-Source", ch));
            }
        }
    }
    Ok(tokens)

}

#[derive(Debug, Clone)]
pub enum ExprAST {
    Num(f64),
    Var(String),
    UnaryMinus(Box<ExprAST>),
    BinOp { op: char, left: Box<ExprAST>, right: Box<ExprAST> },
    FuncCall { name: String, args: Vec<ExprAST> },
    VoltageRef(String, Option<String>), // V(node) o V(n1, n2)
    CurrentRef(String),                 // I(vsource_id)

}

struct ExprParser {
    tokens: Vec<Token>,
    pos: usize,

}

impl ExprParser {
    fn new(tokens: Vec<Token>) -> Self {
        ExprParser { tokens, pos: 0 }
    }

    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.pos)
    }

    fn next_token(&mut self) -> Option<Token> {
        if self.pos < self.tokens.len() {
            let t = self.tokens[self.pos].clone();
            self.pos += 1;
            Some(t)
        } else {
            None
        }
    }

    fn expect_rparen(&mut self) -> Result<(), String> {
        match self.next_token() {
            Some(Token::RParen) => Ok(()),
            other => Err(format!("Se esperaba ')' en expresión B-Source, encontrado: {:?}", other)),
        }
    }

    fn parse_expression(&mut self) -> Result<ExprAST, String> {
        self.parse_additive()
    }

    fn parse_additive(&mut self) -> Result<ExprAST, String> {
        let mut left = self.parse_multiplicative()?;
        loop {
            match self.peek() {
                Some(Token::Plus) => {
                    self.next_token();
                    let right = self.parse_multiplicative()?;
                    left = ExprAST::BinOp { op: '+', left: Box::new(left), right: Box::new(right) };
                }
                Some(Token::Minus) => {
                    self.next_token();
                    let right = self.parse_multiplicative()?;
                    left = ExprAST::BinOp { op: '-', left: Box::new(left), right: Box::new(right) };
                }
                _ => break,
            }
        }
        Ok(left)
    }

    fn parse_multiplicative(&mut self) -> Result<ExprAST, String> {
        let mut left = self.parse_power()?;
        loop {
            match self.peek() {
                Some(Token::Star) => {
                    self.next_token();
                    let right = self.parse_power()?;
                    left = ExprAST::BinOp { op: '*', left: Box::new(left), right: Box::new(right) };
                }
                Some(Token::Slash) => {
                    self.next_token();
                    let right = self.parse_power()?;
                    left = ExprAST::BinOp { op: '/', left: Box::new(left), right: Box::new(right) };
                }
                _ => break,
            }
        }
        Ok(left)
    }

    fn parse_power(&mut self) -> Result<ExprAST, String> {
        let base = self.parse_unary()?;
        if let Some(Token::Caret) = self.peek() {
            self.next_token();
            let exp = self.parse_unary()?;
            Ok(ExprAST::BinOp { op: '^', left: Box::new(base), right: Box::new(exp) })
        } else {
            Ok(base)
        }
    }

    fn parse_unary(&mut self) -> Result<ExprAST, String> {
        if let Some(Token::Minus) = self.peek() {
            self.next_token();
            let operand = self.parse_primary()?;
            Ok(ExprAST::UnaryMinus(Box::new(operand)))
        } else if let Some(Token::Plus) = self.peek() {
            self.next_token();
            self.parse_primary()
        } else {
            self.parse_primary()
        }
    }

    fn parse_primary(&mut self) -> Result<ExprAST, String> {
        match self.next_token() {
            Some(Token::Number(val)) => Ok(ExprAST::Num(val)),
            Some(Token::LParen) => {
                let expr = self.parse_expression()?;
                self.expect_rparen()?;
                Ok(expr)
            }
            Some(Token::Ident(name)) => {
                let name_lower = name.to_lowercase();
                // Constantes
                if name_lower == "pi" {
                    return Ok(ExprAST::Num(std::f64::consts::PI));
                }
                if name_lower == "e" {
                    return Ok(ExprAST::Num(std::f64::consts::E));
                }
                // Variable de tiempo transitorio
                if name_lower == "t" || name_lower == "time" {
                    return Ok(ExprAST::Var("t".to_string()));
                }

                // V(node) / V(n1, n2) referencia de voltaje
                if name_lower == "v" {
                    if let Some(Token::LParen) = self.peek() {
                        self.next_token(); // consume '('
                        let node1 = match self.next_token() {
                            Some(Token::Ident(s)) => s,
                            Some(Token::Number(n)) => format!("{}", n as i64),
                            other => return Err(format!("Se esperaba un nodo en V(), encontrado: {:?}", other)),
                        };
                        if let Some(Token::Comma) = self.peek() {
                            self.next_token(); // consume ','
                            let node2 = match self.next_token() {
                                Some(Token::Ident(s)) => s,
                                Some(Token::Number(n)) => format!("{}", n as i64),
                                other => return Err(format!("Se esperaba segundo nodo en V(n1,n2), encontrado: {:?}", other)),
                            };
                            self.expect_rparen()?;
                            return Ok(ExprAST::VoltageRef(node1, Some(node2)));
                        }
                        self.expect_rparen()?;
                        return Ok(ExprAST::VoltageRef(node1, None));
                    }
                    return Ok(ExprAST::Var("v".to_string()));
                }

                // I(vsource_id) referencia de corriente de rama
                if name_lower == "i" {
                    if let Some(Token::LParen) = self.peek() {
                        self.next_token(); // consume '('
                        let src_id = match self.next_token() {
                            Some(Token::Ident(s)) => s,
                            Some(Token::Number(n)) => format!("{}", n as i64),
                            other => return Err(format!("Se esperaba un ID de fuente en I(), encontrado: {:?}", other)),
                        };
                        self.expect_rparen()?;
                        return Ok(ExprAST::CurrentRef(src_id));
                    }
                    return Ok(ExprAST::Var("i".to_string()));
                }

                // Funciones matemáticas: sin, cos, tan, exp, ln, log, sqrt, abs
                if let Some(Token::LParen) = self.peek() {
                    self.next_token(); // consume '('
                    let mut args = Vec::new();
                    if self.peek() != Some(&Token::RParen) {
                        args.push(self.parse_expression()?);
                        while let Some(Token::Comma) = self.peek() {
                            self.next_token();
                            args.push(self.parse_expression()?);
                        }
                    }
                    self.expect_rparen()?;
                    return Ok(ExprAST::FuncCall { name: name_lower, args });
                }

                // Variable genérica
                Ok(ExprAST::Var(name))
            }
            other => Err(format!("Token inesperado en expresión B-Source: {:?}", other)),
        }
    }

}

/// Contexto de evaluación de expresiones: voltajes de nodos, corrientes de ramas y tiempo actual
pub struct EvalContext<'a> {
    node_voltages: &'a HashMap<String, f64>,
    branch_currents: &'a HashMap<String, f64>,
    time: f64,

}

#[allow(dead_code)]
/// Evalúa una cadena de expresión B-Source y devuelve el valor numérico
pub fn evaluate_expression_string(
    expr_str: &str,
    node_voltages: &HashMap<String, f64>,
    branch_currents: &HashMap<String, f64>,
    time: f64,
) -> Result<f64, String> {
    let tokens = tokenize_expression(expr_str)?;
    let mut parser = ExprParser::new(tokens);
    let ast = parser.parse_expression()?;
    let ctx = EvalContext { node_voltages, branch_currents, time };
    evaluate_ast(&ast, &ctx)

}

// ==========================================================================
// EVALUACIÓN AD (AUTOMATIC DIFFERENTIATION) DE EXPRESIONES B-SOURCE
// ==========================================================================
pub fn evaluate_ast_ad(ast: &ExprAST, ctx: &EvalContext) -> Result<AdValue, String> {
    match ast {
        ExprAST::Num(val) => Ok(AdValue::constant(*val)),
        ExprAST::Var(name) => {
            if name == "t" {
                Ok(AdValue::constant(ctx.time))
            } else if name == "pi" {
                Ok(AdValue::constant(std::f64::consts::PI))
            } else if name == "e" {
                Ok(AdValue::constant(std::f64::consts::E))
            } else {
                let v = *ctx.node_voltages.get(name).unwrap_or(&0.0);
                let mut result = AdValue::constant(v);
                if let Ok(node_idx) = name.parse::<usize>() {
                    result.grad.insert(node_idx, 1.0);
                }
                Ok(result)
            }
        }
        ExprAST::UnaryMinus(inner) => {
            let v = evaluate_ast_ad(inner, ctx)?;
            Ok(AdValue::neg(&v))
        }
        ExprAST::BinOp { op, left, right } => {
            let l = evaluate_ast_ad(left, ctx)?;
            let r = evaluate_ast_ad(right, ctx)?;
            match op {
                '+' => Ok(AdValue::add(&l, &r)),
                '-' => Ok(AdValue::sub(&l, &r)),
                '*' => Ok(AdValue::mul(&l, &r)),
                '/' => Ok(AdValue::div(&l, &r)),
                '^' => Ok(AdValue::pow(&l, r.value)),
                _ => Err(format!("Operador desconocido: '{}'", op)),
            }
        }
        ExprAST::FuncCall { name, args } => {
            if args.is_empty() {
                return Err(format!("La función '{}' requiere al menos un argumento", name));
            }
            let evaled: Vec<AdValue> = args.iter()
                .map(|a| evaluate_ast_ad(a, ctx))
                .collect::<Result<Vec<_>, _>>()?;
            match name.as_str() {
                "sin" => Ok(AdValue::sin(&evaled[0])),
                "cos" => Ok(AdValue::cos(&evaled[0])),
                "tan" => Ok(AdValue::tan(&evaled[0])),
                "exp" => Ok(AdValue::exp(&evaled[0])),
                "ln"  => Ok(AdValue::ln(&evaled[0])),
                "log" => {
                    let ln_val = AdValue::ln(&evaled[0]);
                    let ln10 = AdValue::constant(std::f64::consts::LN_10);
                    Ok(AdValue::div(&ln_val, &ln10))
                }
                "sqrt" => Ok(AdValue::sqrt(&evaled[0])),
                "abs" => Ok(AdValue::abs(&evaled[0])),
                "max" => {
                    if args.len() < 2 {
                        return Err("max() requiere 2 argumentos".to_string());
                    }
                    Ok(AdValue::max(&evaled[0], &evaled[1]))
                }
                "min" => {
                    if args.len() < 2 {
                        return Err("min() requiere 2 argumentos".to_string());
                    }
                    Ok(AdValue::min(&evaled[0], &evaled[1]))
                }
                _ => Err(format!("Función desconocida: '{}'", name)),
            }
        }
        ExprAST::VoltageRef(node_a, node_b_opt) => {
            let v_a = *ctx.node_voltages.get(node_a).unwrap_or(&0.0);
            let (v_b, _is_gnd_b) = match node_b_opt {
                Some(nb) => {
                    let vb = *ctx.node_voltages.get(nb).unwrap_or(&0.0);
                    (vb, nb == "0")
                }
                None => (0.0, true),
            };
            let mut result = AdValue::constant(v_a - v_b);
            if let Ok(idx) = node_a.parse::<usize>() {
                if idx > 0 {
                    result.grad.insert(idx, 1.0);
                }
            }
            if let Some(nb) = node_b_opt {
                if nb != "0" {
                    if let Ok(idx) = nb.parse::<usize>() {
                        if idx > 0 {
                            result.grad.insert(idx, -1.0);
                        }
                    }
                }
            }
            Ok(result)
        }
        ExprAST::CurrentRef(src_id) => {
            let i = *ctx.branch_currents.get(src_id).unwrap_or(&0.0);
            Ok(AdValue::constant(i))
        }
    }
}

pub fn evaluate_expression_ad(
    expr_str: &str,
    node_voltages: &HashMap<String, f64>,
    branch_currents: &HashMap<String, f64>,
    time: f64,
    ast_cache: &mut HashMap<String, ExprAST>,
) -> Result<AdValue, String> {
    let ast = match ast_cache.get(expr_str) {
        Some(cached) => cached,
        None => {
            let tokens = tokenize_expression(expr_str)?;
            let mut parser = ExprParser::new(tokens);
            let parsed_ast = parser.parse_expression()?;
            ast_cache.entry(expr_str.to_string()).or_insert(parsed_ast)
        }
    };
    let ctx = EvalContext { node_voltages, branch_currents, time };
    evaluate_ast_ad(ast, &ctx)
}

#[allow(dead_code)]
pub fn evaluate_ast(ast: &ExprAST, ctx: &EvalContext) -> Result<f64, String> {
    match ast {
        ExprAST::Num(val) => Ok(*val),
        ExprAST::Var(name) => {
            if name == "t" {
                Ok(ctx.time)
            } else if name == "pi" {
                Ok(std::f64::consts::PI)
            } else if name == "e" {
                Ok(std::f64::consts::E)
            } else {
                Ok(*ctx.node_voltages.get(name).unwrap_or(&0.0))
            }
        }
        ExprAST::UnaryMinus(inner) => {
            let v = evaluate_ast(inner, ctx)?;
            Ok(-v)
        }
        ExprAST::BinOp { op, left, right } => {
            let l = evaluate_ast(left, ctx)?;
            let r = evaluate_ast(right, ctx)?;
            match op {
                '+' => Ok(l + r),
                '-' => Ok(l - r),
                '*' => Ok(l * r),
                '/' => {
                    if r.abs() < 1e-15 {
                        Err("División por cero en expresión B-Source".to_string())
                    } else {
                        Ok(l / r)
                    }
                }
                '^' => Ok(l.powf(r)),
                _ => Err(format!("Operador desconocido: '{}'", op)),
            }
        }
        ExprAST::FuncCall { name, args } => {
            if args.is_empty() {
                return Err(format!("La función '{}' requiere al menos un argumento", name));
            }
            let evaled: Vec<f64> = args.iter()
                .map(|a| evaluate_ast(a, ctx))
                .collect::<Result<Vec<_>, _>>()?;
            match name.as_str() {
                "sin" => Ok(evaled[0].sin()),
                "cos" => Ok(evaled[0].cos()),
                "tan" => Ok(evaled[0].tan()),
                "exp" => Ok(evaled[0].exp()),
                "ln"  => {
                    if evaled[0] <= 0.0 { Err("ln(x) requiere x > 0".to_string()) }
                    else { Ok(evaled[0].ln()) }
                }
                "log" => {
                    if evaled[0] <= 0.0 { Err("log(x) requiere x > 0".to_string()) }
                    else { Ok(evaled[0].log10()) }
                }
                "sqrt" => {
                    if evaled[0] < 0.0 { Err("sqrt(x) requiere x >= 0".to_string()) }
                    else { Ok(evaled[0].sqrt()) }
                }
                "abs" => Ok(evaled[0].abs()),
                "max" => {
                    if args.len() < 2 { return Err("max() requiere 2 argumentos".to_string()); }
                    Ok(evaled[0].max(evaled[1]))
                }
                "min" => {
                    if args.len() < 2 { return Err("min() requiere 2 argumentos".to_string()); }
                    Ok(evaled[0].min(evaled[1]))
                }
                _ => Err(format!("Función desconocida: '{}'", name)),
            }
        }
        ExprAST::VoltageRef(node_a, node_b_opt) => {
            let v_a = *ctx.node_voltages.get(node_a).unwrap_or(&0.0);
            let v_b = match node_b_opt {
                Some(nb) => *ctx.node_voltages.get(nb).unwrap_or(&0.0),
                None => 0.0,
            };
            Ok(v_a - v_b)
        }
        ExprAST::CurrentRef(src_id) => {
            Ok(*ctx.branch_currents.get(src_id).unwrap_or(&0.0))
        }
    }
}

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
    let ute = -1.5;   // Exponente de degradación de movilidad térmica

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
    let ute = -1.2;   // Exponente de degradación de movilidad térmica (PMOS)

    let vth0 = if vth_netlist != 0.0 { vth_netlist.abs() } else { 0.4 };
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

    let vth0 = if vth_netlist != 0.0 { vth_netlist } else { 0.35 };
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
        let gds_val = i_off * exp_sub * (exp_vds / vt_therm) * (1.0 + lambda_clm * vds) + ids_val * lambda_clm / (1.0 + lambda_clm * vds);
        
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
            let gds_val = ((w * mu_eff * cox * (vgs - vth - abulk * vds)) / (denom * l)) * (1.0 + lambda_clm * vds) + ids_base * lambda_clm;
            
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

    let vth0 = if vth_netlist != 0.0 { vth_netlist.abs() } else { 0.35 };
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
        let gds_val = i_off * exp_sub * (exp_vsd / vt_therm) * (1.0 + lambda_clm * vsd) + ids_val * lambda_clm / (1.0 + lambda_clm * vsd);
        
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
            let gds_val = ((w * mu_eff * cox * (vsg - vth - abulk * vsd)) / (denom * l)) * (1.0 + lambda_clm * vsd) + ids_base * lambda_clm;
            
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



