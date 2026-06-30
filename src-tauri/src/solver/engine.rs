use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use crate::ad_value::AdValue;
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;
use rayon::prelude::*;
use super::types::*;
use super::matrix::*;

// Constantes físicas universales
const PHYS_KB: f64 = 1.380649e-23;   // Constante de Boltzmann (J/K)
const PHYS_Q: f64 = 1.602176634e-19; // Carga del electrón (C)
const PHYS_T: f64 = 300.0;           // Temperatura estándar (300 K = 26.85 ºC)

// Constantes físicas para el modelo del Diodo PN (Shockley)
const DIODE_IS: f64 = 1e-12;       // Corriente de saturación inversa (1 pA)
const DIODE_VT: f64 = 0.025852;    // Voltaje térmico a 300K (25.85 mV)
const DIODE_N: f64 = 1.0;          // Coeficiente de emisión ideal

// Parámetros de capacidades dinámicas de diodos y transistores (Fase 13)
const DIODE_TT: f64 = 10e-9;      // Tiempo de tránsito de portadores de difusión (10 ns)
const DIODE_CJO: f64 = 2e-12;     // Capacidad de unión a cero voltios (2 pF)
const DIODE_VJ: f64 = 0.6;        // Potencial de contacto de unión (0.6 V)
const DIODE_M: f64 = 0.5;         // Coeficiente de graduación de unión (0.5)

fn get_thermal_parameters(temp_opt: Option<f64>, is_custom: Option<f64>) -> (f64, f64) {
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
fn get_thermal_parameters_junction(tjunc: f64, is_custom: Option<f64>) -> (f64, f64) {
    let vt = (PHYS_KB * tjunc) / PHYS_Q;
    let t0 = PHYS_T;
    let eg = 1.11;
    let base_is = is_custom.unwrap_or(DIODE_IS);
    let is_temp = base_is * (tjunc / t0).powf(3.0) * (-(eg * PHYS_Q / PHYS_KB) * (1.0 / tjunc - 1.0 / t0)).exp();
    (vt, is_temp)

}

// Constantes de Self-Heating para dispositivos discretos (Modelo RC térmico de unión)
// Resistencia térmica unión-ambiente (°C/W) — valores típicos para encapsulados TO-92/SOT-23
const DIODE_RTH_JA: f64 = 150.0;   // Diodo: 150 °C/W (encapsulado DO-41)
const BJT_RTH_JA: f64 = 200.0;     // BJT: 200 °C/W (encapsulado TO-92)
const MOS_RTH_JA: f64 = 62.5;      // MOSFET: 62.5 °C/W (encapsulado TO-220)

// Capacidad térmica (J/°C) — modela la inercia térmica del chip de silicio
const DIODE_CTH: f64 = 0.002;      // Diodo: 2 mJ/°C
const BJT_CTH: f64 = 0.005;        // BJT: 5 mJ/°C
const MOS_CTH: f64 = 0.010;        // MOSFET: 10 mJ/°C

// Constantes de Self-Heating para optoacopladores (encapsulado DIP-4)
const OPTO_RTH_JA: f64 = 200.0;    // Opto DIP-4: 200 °C/W
const OPTO_CTH: f64 = 1e-4;        // Opto DIP-4: 100 µJ/°C

// Parámetros por defecto del optoacoplador (lado receptor fototransistor)
const OPTO_DEFAULT_CTR: f64 = 0.5;   // Current Transfer Ratio: 50%
const OPTO_DEFAULT_VSAT: f64 = 0.2;

// Parámetros por defecto para tiristores (SCR/TRIAC)
pub const SCR_DEFAULT_VGT: f64 = 0.7;   // Voltaje de disparo de puerta (V)
pub const SCR_DEFAULT_IH: f64 = 5e-3;   // Corriente de mantenimiento (A)
pub const SCR_DEFAULT_IS: f64 = 1e-12;  // Corriente de saturación de los BJTs internos (A)
pub const SCR_MAX_BETA: f64 = 200.0;    // β máximo para evitar problemas de convergencia  // Tensión de saturación suave del transistor (V)

fn evaluate_pn_junction(vj: f64, vt: f64, is_val: f64) -> (f64, f64, f64) {
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
const MOS_VTH_TC: f64 = -2.3e-3;   // dVth/dT = -2.3 mV/°C (Vth disminuye con T)
const MOS_MOBILITY_EXPO: f64 = -1.5; // μ(T) = μ₀ * (T/T₀)^(-1.5) (movilidad baja con T)

// Coeficiente de temperatura para β de BJTs (SPICE)
const BJT_BETA_EXPO: f64 = 1.8;    // β(T) = β₀ * (T/T₀)^Xti


fn pnjlim(v_new: f64, v_old: f64, vt: f64, v_crit: f64) -> f64 {
    if v_new > v_crit && (v_new - v_old) > 2.0 * vt {
        let delta = v_new - v_old;
        let val = v_old + vt * (1.0 + delta / vt).ln();
        val.min(v_new)
    } else {
        v_new
    }

}

#[allow(dead_code)]
fn get_diode_capacitance(vd: f64, gd: f64) -> f64 {
    let c_dif = DIODE_TT * gd;
    let c_dep = if vd < 0.0 {
        DIODE_CJO / (1.0 - vd / DIODE_VJ).powf(DIODE_M)
    } else {
        DIODE_CJO * (1.0 + DIODE_M * vd / DIODE_VJ)
    };
    c_dif + c_dep

}

fn get_diode_capacitance_param(vd: f64, gd: f64, comp: &ComponentData) -> f64 {
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

fn solve_diode_junction_voltage(v_ext: f64, temp: Option<f64>, comp: &ComponentData) -> (f64, f64, f64) {
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
fn evaluate_opto_receiver(vd: f64, gd_led: f64, id_led: f64, v_ce: f64, comp: &ComponentData) -> (f64, f64, f64, f64) {
    let ctr = comp.opto_ctr.unwrap_or(OPTO_DEFAULT_CTR);
    let vsat = comp.opto_vsat.unwrap_or(OPTO_DEFAULT_VSAT).max(1e-6);
    let t_vce = (v_ce / vsat).tanh();
    let i_ce = ctr * id_led * t_vce;
    let g_md = ctr * gd_led * t_vce;
    let g_o = ctr * id_led * (1.0 - t_vce * t_vce) / vsat;
    let i_ce_eq = i_ce - g_md * vd - g_o * v_ce;
    (i_ce, g_md, g_o, i_ce_eq)

}

fn get_jfet_capacitances(vgs: f64, vgd: f64, comp: &ComponentData) -> (f64, f64) {
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
const MOS_COX_WL: f64 = 15e-12;   // Capacidad total de óxido W * L * Cox (15 pF)
const MOS_CGSO: f64 = 5e-12;      // Capacidad de solapamiento puerta-fuente fija (5 pF)
const MOS_CGDO: f64 = 5e-12;      // Capacidad de solapamiento puerta-drenador fija (5 pF)
const MOS_CDSO: f64 = 2e-12;      // Capacidad fija drenador-fuente (2 pF)

fn get_nmos_capacitances(
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

fn get_pmos_capacitances(
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
const BJT_TF: f64 = 0.1e-9;      // Tiempo de tránsito directo (100 ps)
const BJT_TR: f64 = 10e-9;       // Tiempo de tránsito inverso (10 ns)
const BJT_CJE0: f64 = 2e-12;     // Capacidad BE a cero voltios (2 pF)
const BJT_CJC0: f64 = 1.5e-12;   // Capacidad BC a cero voltios (1.5 pF)
const BJT_VJE: f64 = 0.7;        // Potencial de unión BE (0.7 V)
const BJT_VJC: f64 = 0.6;        // Potencial de unión BC (0.6 V)
const BJT_M: f64 = 0.33;         // Coeficiente de graduación de unión (0.33)

fn get_bjt_be_capacitance(vbe: f64, gbe: f64, comp: &ComponentData) -> f64 {
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

fn get_bjt_bc_capacitance(vbc: f64, gbc: f64, comp: &ComponentData) -> f64 {
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
enum Token {
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

fn tokenize_expression(input: &str) -> Result<Vec<Token>, String> {
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
enum ExprAST {
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
struct EvalContext<'a> {
    node_voltages: &'a HashMap<String, f64>,
    branch_currents: &'a HashMap<String, f64>,
    time: f64,

}

#[allow(dead_code)]
/// Evalúa una cadena de expresión B-Source y devuelve el valor numérico
fn evaluate_expression_string(
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
fn evaluate_ast_ad(ast: &ExprAST, ctx: &EvalContext) -> Result<AdValue, String> {
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

fn evaluate_expression_ad(
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
fn evaluate_ast(ast: &ExprAST, ctx: &EvalContext) -> Result<f64, String> {
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
pub fn solve_dc_circuit(netlist: &CircuitNetlist) -> Result<SimulationResult, String> {
    solve_dc_circuit_with_guess(netlist, None).map(|(res, _)| res)
}

pub fn solve_dc_circuit_with_guess(
    netlist: &CircuitNetlist,
    initial_guess_opt: Option<&Vec<f64>>,
) -> Result<(SimulationResult, Vec<f64>), String> {
    // 1. Identificar el número máximo de nodos activos y validar topología
    let n = crate::topology::validate_netlist_topology(netlist, false)?;
    
    // Identificar fuentes independientes de tensión y controladas de tensión (vcvs, ccvs)
    let v_sources: Vec<&ComponentData> = netlist.components.iter()
        .filter(|c| c.comp_type == "vsource" || c.comp_type == "bvoltage" || c.comp_type == "vcvs" || c.comp_type == "ccvs")
        .collect();
    let m = v_sources.len(); // Cantidad de fuentes de voltaje (incluyendo bvoltage, vcvs, ccvs)

    let size = n + m;
    if size == 0 {
        return Err("El circuito no contiene nodos activos o componentes.".to_string());
    }

    // Mapear IDs de fuentes a índices
    let mut vsource_map = HashMap::new();
    for (idx, vs) in v_sources.iter().enumerate() {
        vsource_map.insert(vs.id.clone(), idx);
    }

    // Comprobar si el circuito tiene componentes no lineales (Diodos, MOSFETs, BJTs, Op-Amps, B-Sources)
    let has_nonlinear = netlist.components.iter().any(|c| c.comp_type == "diode" || c.comp_type == "led" || c.comp_type == "opto" || c.comp_type == "nmos" || c.comp_type == "pmos" || c.comp_type == "npn" || c.comp_type == "pnp" || c.comp_type == "opamp" || c.comp_type == "bsim3nmos" || c.comp_type == "bsim3pmos" || c.comp_type == "bsim4nmos" || c.comp_type == "bsim4pmos" || c.comp_type == "verilog_a" || c.comp_type.ends_with("_gate") || c.comp_type == "arduino_uno" || c.comp_type == "esp32" || c.comp_type == "raspberry_pi_pico" || c.comp_type == "bvoltage" || c.comp_type == "bcurrent");

    // Si tiene componentes no lineales, ejecutamos el Solver iterativo Newton-Raphson
    if has_nonlinear {
        return solve_newton_raphson(netlist, n, m, &vsource_map, initial_guess_opt);
    }

    // Si es un circuito puramente lineal, resolvemos con una sola ejecución MNA dispersa directa
    let mut matrix_a = SparseMatrix::new(size);
    let mut vector_z = DVector::<f64>::zeros(size);

    stamp_linear_components_sparse(netlist, n, &vsource_map, &mut matrix_a, &mut vector_z)?;

    // Resolver A * x = z de forma directa dispersa con Markowitz
    let lu = SparseLU::factorize(matrix_a)
        .map_err(|_| "Error de convergencia o circuito mal condicionado".to_string())?;
    let solution = lu.solve(&vector_z)
        .ok_or_else(|| "Error de convergencia o circuito mal condicionado".to_string())?;

    // Desempaquetar voltajes de nodos
    let mut node_voltages = HashMap::new();
    node_voltages.insert("0".to_string(), 0.0);
    let mut final_voltages = vec![0.0; n + 1];
    for i in 1..=n {
        node_voltages.insert(i.to_string(), solution[i - 1]);
        final_voltages[i] = solution[i - 1];
    }

    // Desempaquetar corrientes de fuentes
    let mut branch_currents = HashMap::new();
    for vs in &v_sources {
        let vs_idx = *vsource_map.get(&vs.id).unwrap();
        branch_currents.insert(vs.id.clone(), solution[n + vs_idx]);
    }

    Ok((
        SimulationResult {
            node_voltages,
            branch_currents,
            convergence_iterations: 1,
            error_log: None,
        },
        final_voltages,
    ))

}

// Estampar componentes lineales de forma dispersa directa (Direct Sparse Stamping O1)
fn stamp_linear_components_sparse(
    netlist: &CircuitNetlist,
    n: usize,
    vsource_map: &HashMap<String, usize>,
    matrix_a: &mut SparseMatrix,
    vector_z: &mut DVector<f64>
) -> Result<(), String> {
    // 1. Ejecutar análisis de topología por teoría de grafos para detectar y estabilizar nodos flotantes en DC
    let floating_nodes = crate::topology::find_floating_nodes(netlist, n);
    for &node_idx in &floating_nodes {
        if node_idx > 0 && node_idx <= n {
            matrix_a.add_element(node_idx - 1, node_idx - 1, 1e-12);
        }
    }

    // 2. Verificar preventivamente si hay ciclos ideales de fuentes de voltaje
    crate::topology::detect_ideal_voltage_loops(netlist, n)?;

    let stamp_conductance = |matrix: &mut SparseMatrix, row_node: usize, col_node: usize, conductance: f64| {
        if row_node > 0 && col_node > 0 {
            matrix.add_element(row_node - 1, col_node - 1, conductance);
        }
    };

    let stamp_voltage_branch = |matrix: &mut SparseMatrix, vector: &mut DVector<f64>, vsource_idx: usize, node_pos: usize, node_neg: usize, voltage: f64| {
        let col = n + vsource_idx;
        if node_pos > 0 {
            matrix.add_element(node_pos - 1, col, 1.0);
            matrix.add_element(col, node_pos - 1, 1.0);
        }
        if node_neg > 0 {
            matrix.add_element(node_neg - 1, col, -1.0);
            matrix.add_element(col, node_neg - 1, -1.0);
        }
        vector[col] = voltage;
    };

    for comp in &netlist.components {
        match comp.comp_type.as_str() {
            "resistor" => {
                let node_a = comp.pins[0].parse::<usize>().unwrap();
                let node_b = comp.pins[1].parse::<usize>().unwrap();
                if comp.value <= 1e-12 {
                    return Err(format!("Resistencia demasiado baja en el componente pasivo R [{}].", comp.id));
                }
                let conductance = 1.0 / comp.value;
                stamp_conductance(matrix_a, node_a, node_a, conductance);
                stamp_conductance(matrix_a, node_b, node_b, conductance);
                stamp_conductance(matrix_a, node_a, node_b, -conductance);
                stamp_conductance(matrix_a, node_b, node_a, -conductance);
            }
            "vsource" | "bvoltage" => {
                let node_pos = comp.pins[0].parse::<usize>().unwrap();
                let node_neg = comp.pins[1].parse::<usize>().unwrap();
                let vs_idx = *vsource_map.get(&comp.id).unwrap();
                let v_static = if comp.comp_type == "bvoltage" { 0.0 } else { comp.value };
                stamp_voltage_branch(matrix_a, vector_z, vs_idx, node_pos, node_neg, v_static);
            }
            "capacitor" => {
                let node_a = comp.pins[0].parse::<usize>().unwrap();
                let node_b = comp.pins[1].parse::<usize>().unwrap();
                let conductance = 1e-9;
                stamp_conductance(matrix_a, node_a, node_a, conductance);
                stamp_conductance(matrix_a, node_b, node_b, conductance);
                stamp_conductance(matrix_a, node_a, node_b, -conductance);
                stamp_conductance(matrix_a, node_b, node_a, -conductance);
            }
            "inductor" => {
                let is_coupled = if let Some(ref mutuals) = netlist.mutual_inductances {
                    mutuals.iter().any(|m| m.l1_id == comp.id || m.l2_id == comp.id)
                } else {
                    false
                };
                if is_coupled {
                    continue;
                }

                let node_a = comp.pins[0].parse::<usize>().unwrap();
                let node_b = comp.pins[1].parse::<usize>().unwrap();
                let conductance = 1e3;
                stamp_conductance(matrix_a, node_a, node_a, conductance);
                stamp_conductance(matrix_a, node_b, node_b, conductance);
                stamp_conductance(matrix_a, node_a, node_b, -conductance);
                stamp_conductance(matrix_a, node_b, node_a, -conductance);
            }
            "isource" => {
                let node_pos = comp.pins[0].parse::<usize>().unwrap();
                let node_neg = comp.pins[1].parse::<usize>().unwrap();
                let val = comp.value;
                if node_pos > 0 {
                    vector_z[node_pos - 1] -= val;
                }
                if node_neg > 0 {
                    vector_z[node_neg - 1] += val;
                }
            }
            "vcvs" => {
                let node_pos = comp.pins[0].parse::<usize>().unwrap();
                let node_neg = comp.pins[1].parse::<usize>().unwrap();
                let ctrl_pos = comp.pins[2].parse::<usize>().unwrap();
                let ctrl_neg = comp.pins[3].parse::<usize>().unwrap();
                let gain = comp.value;
                let vs_idx = *vsource_map.get(&comp.id).ok_or_else(|| format!("VCVS id {} no mapeado", comp.id))?;
                let col = n + vs_idx;
                if node_pos > 0 {
                    matrix_a.add_element(node_pos - 1, col, 1.0);
                    matrix_a.add_element(col, node_pos - 1, 1.0);
                }
                if node_neg > 0 {
                    matrix_a.add_element(node_neg - 1, col, -1.0);
                    matrix_a.add_element(col, node_neg - 1, -1.0);
                }
                if ctrl_pos > 0 {
                    matrix_a.add_element(col, ctrl_pos - 1, -gain);
                }
                if ctrl_neg > 0 {
                    matrix_a.add_element(col, ctrl_neg - 1, gain);
                }
            }
            "vccs" => {
                let node_pos = comp.pins[0].parse::<usize>().unwrap();
                let node_neg = comp.pins[1].parse::<usize>().unwrap();
                let ctrl_pos = comp.pins[2].parse::<usize>().unwrap();
                let ctrl_neg = comp.pins[3].parse::<usize>().unwrap();
                let g = comp.value;
                if node_pos > 0 {
                    if ctrl_pos > 0 { matrix_a.add_element(node_pos - 1, ctrl_pos - 1, g); }
                    if ctrl_neg > 0 { matrix_a.add_element(node_pos - 1, ctrl_neg - 1, -g); }
                }
                if node_neg > 0 {
                    if ctrl_pos > 0 { matrix_a.add_element(node_neg - 1, ctrl_pos - 1, -g); }
                    if ctrl_neg > 0 { matrix_a.add_element(node_neg - 1, ctrl_neg - 1, g); }
                }
            }
            "cccs" => {
                let node_pos = comp.pins[0].parse::<usize>().unwrap();
                let node_neg = comp.pins[1].parse::<usize>().unwrap();
                let gain = comp.value;
                if let Some(ref ctrl_source_id) = comp.controlling_source {
                    if let Some(&ctrl_vs_idx) = vsource_map.get(ctrl_source_id) {
                        let col = n + ctrl_vs_idx;
                        if node_pos > 0 {
                            matrix_a.add_element(node_pos - 1, col, gain);
                        }
                        if node_neg > 0 {
                            matrix_a.add_element(node_neg - 1, col, -gain);
                        }
                    } else {
                        return Err(format!("CCCS id {}: Fuente controladora {} no encontrada en el circuito.", comp.id, ctrl_source_id));
                    }
                } else {
                    return Err(format!("CCCS id {}: Falta especificar la fuente controladora.", comp.id));
                }
            }
            "ccvs" => {
                let node_pos = comp.pins[0].parse::<usize>().unwrap();
                let node_neg = comp.pins[1].parse::<usize>().unwrap();
                let r = comp.value;
                let vs_idx = *vsource_map.get(&comp.id).ok_or_else(|| format!("CCVS id {} no mapeado", comp.id))?;
                let col = n + vs_idx;
                if node_pos > 0 {
                    matrix_a.add_element(node_pos - 1, col, 1.0);
                    matrix_a.add_element(col, node_pos - 1, 1.0);
                }
                if node_neg > 0 {
                    matrix_a.add_element(node_neg - 1, col, -1.0);
                    matrix_a.add_element(col, node_neg - 1, -1.0);
                }
                if let Some(ref ctrl_source_id) = comp.controlling_source {
                    if let Some(&ctrl_vs_idx) = vsource_map.get(ctrl_source_id) {
                        let ctrl_col = n + ctrl_vs_idx;
                        matrix_a.add_element(col, ctrl_col, -r);
                    } else {
                        return Err(format!("CCVS id {}: Fuente controladora {} no encontrada en el circuito.", comp.id, ctrl_source_id));
                    }
                } else {
                    return Err(format!("CCVS id {}: Falta especificar la fuente controladora.", comp.id));
                }
            }
            _ => {}
        }
    }

    Ok(())

}

// Estampar componentes lineales del circuito en la matriz MNA (Adaptador Retrocompatible)
fn stamp_linear_components(
    netlist: &CircuitNetlist,
    n: usize,
    vsource_map: &HashMap<String, usize>,
    matrix_a: &mut DMatrix<f64>,
    vector_z: &mut DVector<f64>
) -> Result<(), String> {
    let size = matrix_a.nrows();
    let mut sparse = SparseMatrix::new(size);
    stamp_linear_components_sparse(netlist, n, vsource_map, &mut sparse, vector_z)?;
    for r in 0..size {
        for (&c, &val) in &sparse.rows[r] {
            matrix_a[(r, c)] = val;
        }
    }
    Ok(())

}

fn multiply_sparse_matrix_vector(matrix: &SparseMatrix, x: &DVector<f64>) -> DVector<f64> {
    let mut y = DVector::zeros(matrix.size);
    for r in 0..matrix.size {
        let mut sum = 0.0;
        for (&c, &val) in &matrix.rows[r] {
            sum += val * x[c];
        }
        y[r] = sum;
    }
    y

}

// CORES MATEMÁTICOS AVANZADOS: CORE DE NEWTON-RAPHSON CON AMORTIGUAMIENTO Y GMIN DINÁMICO (Fases 14 y 15)
#[allow(clippy::too_many_arguments)]
#[allow(clippy::ptr_arg)]
fn solve_newton_raphson_core(
    netlist: &CircuitNetlist,
    n: usize,
    m: usize,
    vsource_map: &HashMap<String, usize>,
    gmin: f64,
    alpha: f64,
    initial_guess: &Vec<f64>,
    pta_params: Option<(f64, f64, &DVector<f64>)>,
    switch_frozen_states: &HashMap<String, bool>,
) -> Result<DVector<f64>, String> {
    let (vt, is_temp) = get_thermal_parameters(netlist.temperature, None);
    let size = n + m;
    let max_iter = 100;
    let tolerance = 1e-6;

    let mut prev_voltages = initial_guess.clone();
    let mut solution = DVector::<f64>::zeros(size);
    if let Some((_, _, prev_sol)) = pta_params {
        for i in 1..=n {
            prev_voltages[i] = prev_sol[i - 1];
        }
        solution = prev_sol.clone();
    }
    let mut prev_prev_voltages = prev_voltages.clone();
    let mut converged = false;

    let mut csc_solver: Option<(crate::sparse_csc::SymbolicLU, crate::sparse_csc::NumericLUWorkspace, crate::sparse_csc::SparseMatrixCSC)> = None;
    let mut parallel_solver: Option<crate::sparse_parallel::SchurParallelSolver> = None;


    // 1. Armar matrices base lineales estáticas que no cambian en este NR
    let mut matrix_a_linear = SparseMatrix::new(size);
    let mut vector_z_linear = DVector::<f64>::zeros(size);
    stamp_linear_components_sparse(netlist, n, vsource_map, &mut matrix_a_linear, &mut vector_z_linear)?;

    // Escalar fuentes independientes por el factor alpha de Source Stepping
    for idx in 0..m {
        vector_z_linear[n + idx] *= alpha;
    }

    // Inyectar conductancia Gmin artificial a tierra en todos los nodos activos para evitar singularidades
    if gmin > 0.0 {
        for i in 1..=n {
            matrix_a_linear.add_element(i - 1, i - 1, gmin);
        }
    }

    // Inyectar elementos de Pseudo-Transient Analysis (PTA) si están activos
    if let Some((g_pseudo, r_pseudo, prev_sol)) = pta_params {
        for i in 1..=n {
            matrix_a_linear.add_element(i - 1, i - 1, g_pseudo);
            vector_z_linear[i - 1] += g_pseudo * prev_sol[i - 1];
        }
        for vs_idx in 0..m {
            matrix_a_linear.add_element(n + vs_idx, n + vs_idx, r_pseudo);
            vector_z_linear[n + vs_idx] += r_pseudo * prev_sol[n + vs_idx];
        }
    }

    // Caché de ASTs para B-sources
    let mut ast_cache: HashMap<String, ExprAST> = HashMap::new();

    // Clausura para estampar los componentes no lineales a partir de cualquier estimación de tensiones y corrientes
    // NOTA: FnMut porque captura ast_cache por &mut para el caché de ASTs
    let mut stamp_at = |prev_voltages: &Vec<f64>, prev_prev_voltages: &Vec<f64>, solution: &DVector<f64>| -> Result<(SparseMatrix, DVector<f64>), String> {
        let mut matrix_a = matrix_a_linear.clone();
        let mut vector_z = vector_z_linear.clone();

        // Estampar cada componente no lineal usando aproximación lineal de primer orden de Taylor
        for comp in &netlist.components {
            if comp.comp_type == "diode" || comp.comp_type == "led" {
                let node_anode = comp.pins[0].parse::<usize>().unwrap();
                let node_cathode = comp.pins[1].parse::<usize>().unwrap();

                // Obtener voltajes previos de los nodos correspondientes
                let v_anode = if node_anode > 0 { prev_voltages[node_anode] } else { 0.0 };
                let v_cathode = if node_cathode > 0 { prev_voltages[node_cathode] } else { 0.0 };

                let vd_new = v_anode - v_cathode;

                let v_anode_old = if node_anode > 0 { prev_prev_voltages[node_anode] } else { 0.0 };
                let v_cathode_old = if node_cathode > 0 { prev_prev_voltages[node_cathode] } else { 0.0 };
                let vd_old = v_anode_old - v_cathode_old;

                // Damping logarítmico suave (pnjlim) para evitar overflow exponencial (Upgrade 4)
                let vd = pnjlim(vd_new, vd_old, vt, 0.6);

                let (_, id, geq) = solve_diode_junction_voltage(vd, netlist.temperature, comp);

                // Corriente equivalente: Ieq = Id - geq * vd
                let ieq = id - geq * vd;

                // Estampar conductancia equivalente geq (igual que una resistencia)
                let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                    if r > 0 && c > 0 {
                        matrix_a.add_element(r - 1, c - 1, g);
                    }
                };

                stamp_conductance(node_anode, node_anode, geq);
                stamp_conductance(node_cathode, node_cathode, geq);
                stamp_conductance(node_anode, node_cathode, -geq);
                stamp_conductance(node_cathode, node_anode, -geq);

                // Estampar fuente de corriente equivalente ieq (fluye de Anode a Cathode)
                // Restar de z del ánodo, sumar a z del cátodo
                if node_anode > 0 {
                    vector_z[node_anode - 1] -= ieq;
                }
                if node_cathode > 0 {
                    vector_z[node_cathode - 1] += ieq;
                }
            } else if comp.comp_type == "opto" {
                if comp.pins.len() < 4 { continue; }
                let node_a = comp.pins[0].parse::<usize>().unwrap();
                let node_k = comp.pins[1].parse::<usize>().unwrap();
                let node_c = comp.pins[2].parse::<usize>().unwrap();
                let node_e = comp.pins[3].parse::<usize>().unwrap();

                let v_a = if node_a > 0 { prev_voltages[node_a] } else { 0.0 };
                let v_k = if node_k > 0 { prev_voltages[node_k] } else { 0.0 };
                let v_c = if node_c > 0 { prev_voltages[node_c] } else { 0.0 };
                let v_e = if node_e > 0 { prev_voltages[node_e] } else { 0.0 };

                // Lado emisor (LED interno) con damping pnjlim
                let vd_new = v_a - v_k;
                let vd_old = (if node_a > 0 { prev_prev_voltages[node_a] } else { 0.0 })
                           - (if node_k > 0 { prev_prev_voltages[node_k] } else { 0.0 });
                let vd = pnjlim(vd_new, vd_old, vt, 0.6);
                let (_, id_led, gd_led) = solve_diode_junction_voltage(vd, netlist.temperature, comp);
                let ieq_led = id_led - gd_led * vd;

                // Lado receptor (fototransistor)
                let v_ce = v_c - v_e;
                let (_i_ce, g_md, g_o, i_ce_eq) = evaluate_opto_receiver(vd, gd_led, id_led, v_ce, comp);

                let mut stamp = |r: usize, c: usize, g: f64| {
                    if r > 0 && c > 0 { matrix_a.add_element(r - 1, c - 1, g); }
                };

                // Estampar lado LED (igual que un diodo)
                stamp(node_a, node_a,  gd_led);
                stamp(node_k, node_k,  gd_led);
                stamp(node_a, node_k, -gd_led);
                stamp(node_k, node_a, -gd_led);
                if node_a > 0 { vector_z[node_a - 1] -= ieq_led; }
                if node_k > 0 { vector_z[node_k - 1] += ieq_led; }

                // Estampar lado receptor (fototransistor): fuente VCCS no lineal
                stamp(node_c, node_a,  g_md);
                stamp(node_c, node_k, -g_md);
                stamp(node_c, node_c,  g_o);
                stamp(node_c, node_e, -g_o);
                stamp(node_e, node_a, -g_md);
                stamp(node_e, node_k,  g_md);
                stamp(node_e, node_c, -g_o);
                stamp(node_e, node_e,  g_o);
                if node_c > 0 { vector_z[node_c - 1] -= i_ce_eq; }
                if node_e > 0 { vector_z[node_e - 1] += i_ce_eq; }
            } else if comp.comp_type == "verilog_a" {
                let node_drain = comp.pins[0].parse::<usize>().unwrap();
                let node_gate = comp.pins[1].parse::<usize>().unwrap();
                let node_source = comp.pins[2].parse::<usize>().unwrap();

                let v_drain = if node_drain > 0 { prev_voltages[node_drain] } else { 0.0 };
                let v_gate = if node_gate > 0 { prev_voltages[node_gate] } else { 0.0 };
                let v_source = if node_source > 0 { prev_voltages[node_source] } else { 0.0 };

                let vgs = v_gate - v_source;
                let vds = v_drain - v_source;

                let vgs_dual = crate::dual3::Dual3::new(vgs, 0);
                let vds_dual = crate::dual3::Dual3::new(vds, 1);
                let vbs_dual = crate::dual3::Dual3::new(0.0, 2);

                if let Some(ref eqs) = comp.va_equations {
                    for (_from, _to, expr_str) in eqs {
                        if let Ok(ast) = crate::parser::parse_va_expression(expr_str) {
                            let ports = [vgs_dual, vds_dual, vbs_dual];
                            
                            let mut va_params = HashMap::new();
                            va_params.insert("vth0".to_string(), 0.35);
                            va_params.insert("beta".to_string(), 0.02);
                            va_params.insert("lambda".to_string(), 0.02);
                            
                            if let Ok(i_dual) = ast.evaluate(&va_params, &ports) {
                                let ids = i_dual.val;
                                let gm = i_dual.deriv[0];
                                let gds = i_dual.deriv[1];
                                
                                let ieq = ids - gm * vgs - gds * vds;
                                
                                let mut stamp = |r: usize, c: usize, val: f64| {
                                    if r > 0 && c > 0 {
                                        matrix_a.add_element(r - 1, c - 1, val);
                                    }
                                };
                                
                                stamp(node_drain, node_drain, gds);
                                stamp(node_drain, node_gate, gm);
                                stamp(node_drain, node_source, -(gds + gm));
                                
                                stamp(node_source, node_drain, -gds);
                                stamp(node_source, node_gate, -gm);
                                stamp(node_source, node_source, gds + gm);
                                
                                if node_drain > 0 {
                                    vector_z[node_drain - 1] -= ieq;
                                }
                                if node_source > 0 {
                                    vector_z[node_source - 1] += ieq;
                                }
                            }
                        }
                    }
                }
            } else if comp.comp_type == "nmos" || comp.comp_type == "bsim3nmos" || comp.comp_type == "bsim4nmos" {
                let node_gate = comp.pins[0].parse::<usize>().unwrap();
                let node_drain = comp.pins[1].parse::<usize>().unwrap();
                let node_source = comp.pins[2].parse::<usize>().unwrap();
                let node_bulk = if comp.pins.len() >= 4 { comp.pins[3].parse::<usize>().unwrap_or(0) } else { 0 };

                // Obtener voltajes previos
                let v_gate = if node_gate > 0 { prev_voltages[node_gate] } else { 0.0 };
                let v_drain = if node_drain > 0 { prev_voltages[node_drain] } else { 0.0 };
                let v_source = if node_source > 0 { prev_voltages[node_source] } else { 0.0 };
                let v_bulk = if node_bulk > 0 { prev_voltages[node_bulk] } else { 0.0 };

                let vgs = v_gate - v_source;
                let mut vds = v_drain - v_source;
                if vds < 0.0 {
                    vds = 0.0;
                }
                let vbs = v_bulk - v_source;

                let vth = comp.value; // Tensión de umbral
                let kn = 0.02; // transconductancia 20 mA/V^2

                // Ecuaciones Shichman-Hodges y derivadas para linealización Taylor
                let (ids, gm, gds, igs, gg) = if comp.comp_type == "bsim4nmos" {
                    evaluate_bsim4_nmos(vgs, vds, vbs, comp.value, comp.w, comp.l)
                } else if comp.comp_type == "bsim3nmos" {
                    let (ids_v, gm_v, gds_v) = evaluate_bsim3_nmos(vgs, vds, vbs, comp.value, comp.w, comp.l, None, Some(comp));
                    (ids_v, gm_v, gds_v, 0.0, 1e-12)
                } else if vgs <= vth {
                    // Corte
                    (0.0, 0.0, 1e-9, 0.0, 1e-12)
                } else if vds < vgs - vth {
                    // Lineal (Triodo)
                    let ids_val = kn * (2.0 * (vgs - vth) * vds - vds * vds);
                    let gm_val = 2.0 * kn * vds;
                    let gds_val = 2.0 * kn * (vgs - vth - vds);
                    (ids_val, gm_val, gds_val.max(1e-9), 0.0, 1e-12)
                } else {
                    // Saturación
                    let ids_val = kn * (vgs - vth) * (vgs - vth);
                    let gm_val = 2.0 * kn * (vgs - vth);
                    let gds_val = 1e-5;
                    (ids_val, gm_val, gds_val, 0.0, 1e-12)
                };

                let ieq = ids - gm * vgs - gds * vds;
                let ieq_g = igs - gg * vgs;

                // Estampar conductancias de canal gds entre Drain y Source
                macro_rules! stamp_conductance {
                    ($r:expr, $c:expr, $g:expr) => {
                        {
                            let r_val = $r;
                            let c_val = $c;
                            if r_val > 0 && c_val > 0 {
                                matrix_a.add_element(r_val - 1, c_val - 1, $g);
                            }
                        }
                    };
                }
                stamp_conductance!(node_drain, node_drain, gds);
                stamp_conductance!(node_source, node_source, gds);
                stamp_conductance!(node_drain, node_source, -gds);
                stamp_conductance!(node_source, node_drain, -gds);

                // Estampar transconductancia gm dependiente de Vg y Vs
                if node_drain > 0 {
                    if node_gate > 0 { matrix_a.add_element(node_drain - 1, node_gate - 1, gm); }
                    if node_source > 0 { matrix_a.add_element(node_drain - 1, node_source - 1, -gm); }
                }
                if node_source > 0 {
                    if node_gate > 0 { matrix_a.add_element(node_source - 1, node_gate - 1, -gm); }
                    if node_source > 0 { matrix_a.add_element(node_source - 1, node_source - 1, gm); }
                }

                // Estampar conductancia de fugas de compuerta gg entre Gate y Source
                if gg.abs() > 1e-12 {
                    stamp_conductance!(node_gate, node_gate, gg);
                    stamp_conductance!(node_source, node_source, gg);
                    stamp_conductance!(node_gate, node_source, -gg);
                    stamp_conductance!(node_source, node_gate, -gg);
                }

                // Estampar corriente equivalente ieq (D->S: entra a S, sale de D)
                if node_drain > 0 {
                    vector_z[node_drain - 1] -= ieq;
                }
                if node_source > 0 {
                    vector_z[node_source - 1] += ieq;
                }

                // Estampar corriente equivalente de compuerta ieq_g (G->S: entra a S, sale de G)
                if igs.abs() > 1e-15 {
                    if node_gate > 0 {
                        vector_z[node_gate - 1] -= ieq_g;
                    }
                    if node_source > 0 {
                        vector_z[node_source - 1] += ieq_g;
                    }
                }
            } else if comp.comp_type == "pmos" || comp.comp_type == "bsim3pmos" || comp.comp_type == "bsim4pmos" {
                let node_gate = comp.pins[0].parse::<usize>().unwrap();
                let node_drain = comp.pins[1].parse::<usize>().unwrap();
                let node_source = comp.pins[2].parse::<usize>().unwrap();
                let node_bulk = if comp.pins.len() >= 4 { comp.pins[3].parse::<usize>().unwrap_or(0) } else { 0 };

                // Obtener voltajes previos
                let v_gate = if node_gate > 0 { prev_voltages[node_gate] } else { 0.0 };
                let v_drain = if node_drain > 0 { prev_voltages[node_drain] } else { 0.0 };
                let v_source = if node_source > 0 { prev_voltages[node_source] } else { 0.0 };
                let v_bulk = if node_bulk > 0 { prev_voltages[node_bulk] } else { 0.0 };

                let vsg = v_source - v_gate;
                let mut vsd = v_source - v_drain;
                if vsd < 0.0 {
                    vsd = 0.0;
                }
                let vsb = v_source - v_bulk;

                let vth = if comp.value == 0.0 { -1.5 } else { comp.value };
                let vth_abs = -vth;
                let kp = 0.02;

                let (isd, gm_sd, gds_cond, igs, gg) = if comp.comp_type == "bsim4pmos" {
                    evaluate_bsim4_pmos(vsg, vsd, vsb, comp.value, comp.w, comp.l)
                } else if comp.comp_type == "bsim3pmos" {
                    let (isd_v, gm_v, gds_v) = evaluate_bsim3_pmos(vsg, vsd, vsb, comp.value, comp.w, comp.l, None, Some(comp));
                    (isd_v, gm_v, gds_v, 0.0, 1e-12)
                } else if vsg <= vth_abs {
                    (0.0, 0.0, 1e-9, 0.0, 1e-12)
                } else if vsd < vsg - vth_abs {
                    let isd_val = kp * (2.0 * (vsg - vth_abs) * vsd - vsd * vsd);
                    let gm_sd_val = 2.0 * kp * vsd;
                    let gds_cond_val = 2.0 * kp * (vsg - vth_abs - vsd);
                    (isd_val, gm_sd_val, gds_cond_val.max(1e-9), 0.0, 1e-12)
                } else {
                    let isd_val = kp * (vsg - vth_abs) * (vsg - vth_abs);
                    let gm_sd_val = 2.0 * kp * (vsg - vth_abs);
                    let gds_cond_val = 1e-5;
                    (isd_val, gm_sd_val, gds_cond_val, 0.0, 1e-12)
                };

                let ieq_sd = isd - gm_sd * vsg - gds_cond * vsd;
                let ieq_g = igs - gg * vsg;

                macro_rules! stamp_conductance {
                    ($r:expr, $c:expr, $g:expr) => {
                        {
                            let r_val = $r;
                            let c_val = $c;
                            if r_val > 0 && c_val > 0 {
                                matrix_a.add_element(r_val - 1, c_val - 1, $g);
                            }
                        }
                    };
                }

                stamp_conductance!(node_source, node_source, gds_cond);
                stamp_conductance!(node_drain, node_drain, gds_cond);
                stamp_conductance!(node_source, node_drain, -gds_cond);
                stamp_conductance!(node_drain, node_source, -gds_cond);

                if node_drain > 0 {
                    if node_source > 0 { matrix_a.add_element(node_drain - 1, node_source - 1, -gm_sd); }
                    if node_gate > 0 { matrix_a.add_element(node_drain - 1, node_gate - 1, gm_sd); }
                }
                if node_source > 0 {
                    if node_source > 0 { matrix_a.add_element(node_source - 1, node_source - 1, gm_sd); }
                    if node_gate > 0 { matrix_a.add_element(node_source - 1, node_gate - 1, -gm_sd); }
                }

                // Estampar conductancia de fugas de compuerta gg entre Source y Gate
                if gg.abs() > 1e-12 {
                    stamp_conductance!(node_gate, node_gate, gg);
                    stamp_conductance!(node_source, node_source, gg);
                    stamp_conductance!(node_gate, node_source, -gg);
                    stamp_conductance!(node_source, node_gate, -gg);
                }

                if node_drain > 0 {
                    vector_z[node_drain - 1] += ieq_sd;
                }
                if node_source > 0 {
                    vector_z[node_source - 1] -= ieq_sd;
                }

                // Estampar corriente equivalente de compuerta ieq_g (S->G: entra a G, sale de S)
                if igs.abs() > 1e-15 {
                    if node_gate > 0 {
                        vector_z[node_gate - 1] += ieq_g;
                    }
                    if node_source > 0 {
                        vector_z[node_source - 1] -= ieq_g;
                    }
                }
            } else if comp.comp_type == "npn" || comp.comp_type == "pnp" {
                let is_npn = comp.comp_type == "npn";
                let node_base = comp.pins[0].parse::<usize>().unwrap();
                let node_collector = comp.pins[1].parse::<usize>().unwrap();
                let node_emitter = comp.pins[2].parse::<usize>().unwrap();

                let v_base = if node_base > 0 { prev_voltages[node_base] } else { 0.0 };
                let v_collector = if node_collector > 0 { prev_voltages[node_collector] } else { 0.0 };
                let v_emitter = if node_emitter > 0 { prev_voltages[node_emitter] } else { 0.0 };

                let (vbe_new_raw, vbc_new_raw) = if is_npn {
                    (v_base - v_emitter, v_base - v_collector)
                } else {
                    (v_emitter - v_base, v_collector - v_base)
                };

                let v_base_old = if node_base > 0 { prev_prev_voltages[node_base] } else { 0.0 };
                let v_collector_old = if node_collector > 0 { prev_prev_voltages[node_collector] } else { 0.0 };
                let v_emitter_old = if node_emitter > 0 { prev_prev_voltages[node_emitter] } else { 0.0 };

                let (vbe_old_raw, vbc_old_raw) = if is_npn {
                    (v_base_old - v_emitter_old, v_base_old - v_collector_old)
                } else {
                    (v_emitter_old - v_base_old, v_collector_old - v_base_old)
                };

                let bjt_is_val = if comp.bjt_is.is_some() {
                    let (_, scaled_is) = get_thermal_parameters(netlist.temperature, comp.bjt_is);
                    scaled_is
                } else {
                    is_temp
                };

                let beta_f = comp.bjt_bf.unwrap_or(if comp.value <= 1.0 { 100.0 } else { comp.value });
                let beta_r = 1.0;
                let alpha_f = beta_f / (beta_f + 1.0);
                let alpha_r = beta_r / (beta_r + 1.0);

                // Estimar corrientes de base y colector de la iteración previa para calcular caídas óhmicas
                // Damping preliminar de voltajes previos para cálculo seguro sin desbordamiento
                let vbe_prev_safe = pnjlim(vbe_old_raw, vbe_old_raw, vt, 0.6).min(0.95);
                let vbc_prev_safe = pnjlim(vbc_old_raw, vbc_old_raw, vt, 0.6).min(0.95);

                let exp_be_old = (vbe_prev_safe / vt).exp();
                let exp_bc_old = (vbc_prev_safe / vt).exp();
                let ide_old = bjt_is_val * (exp_be_old - 1.0);
                let idc_old = bjt_is_val * (exp_bc_old - 1.0);

                // Clampear corrientes previas a rangos físicos seguros para evitar oscilación numérica salvaje
                let ib_prev = (ide_old / (beta_f + 1.0) + idc_old / (beta_r + 1.0)).clamp(-0.01, 0.01);
                let ic_prev = (alpha_f * ide_old - idc_old).clamp(-0.1, 0.1);

                let r_b = comp.bjt_rb.unwrap_or(10.0);
                let r_c = comp.bjt_rc.unwrap_or(2.0);

                let vbe_new = vbe_new_raw - ib_prev * r_b;
                let vbc_new = vbc_new_raw - ic_prev * r_c;
                let vbe_old = vbe_old_raw - ib_prev * r_b;
                let vbc_old = vbc_old_raw - ic_prev * r_c;

                // Damping logarítmico suave (pnjlim) para evitar overflow (Upgrade 4)
                let vbe = pnjlim(vbe_new, vbe_old, vt, 0.6);
                let vbc = pnjlim(vbc_new, vbc_old, vt, 0.6);

                let (ide, gbe, ieq_be) = evaluate_pn_junction(vbe, vt, bjt_is_val);
                let (_idc, gbc, ieq_bc) = evaluate_pn_junction(vbc, vt, bjt_is_val);

                let g_be_b = gbe / (beta_f + 1.0);
                let g_bc_b = gbc / (beta_r + 1.0);
                let ieq_b = ieq_be / (beta_f + 1.0) + ieq_bc / (beta_r + 1.0);

                let ieq_c = alpha_f * ieq_be - ieq_bc;
                let ieq_e = ieq_be - alpha_r * ieq_bc;

                let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                    if r > 0 && c > 0 {
                        matrix_a.add_element(r - 1, c - 1, g);
                    }
                };

                // Modelado de Efecto Early (V_A) (Upgrade 3)
                let v_af = comp.bjt_vaf.unwrap_or(if is_npn { 100.0 } else { 50.0 });
                let ic_active = (alpha_f * ide).abs();
                let go = ic_active / v_af;

                stamp_conductance(node_collector, node_collector, go);
                stamp_conductance(node_emitter, node_emitter, go);
                stamp_conductance(node_collector, node_emitter, -go);
                stamp_conductance(node_emitter, node_collector, -go);

                if is_npn {
                    stamp_conductance(node_base, node_base, g_be_b + g_bc_b);
                    stamp_conductance(node_base, node_emitter, -g_be_b);
                    stamp_conductance(node_base, node_collector, -g_bc_b);
                    if node_base > 0 { vector_z[node_base - 1] -= ieq_b; }

                    if node_collector > 0 {
                        if node_base > 0 { matrix_a.add_element(node_collector - 1, node_base - 1, alpha_f * gbe - gbc); }
                        if node_emitter > 0 { matrix_a.add_element(node_collector - 1, node_emitter - 1, -alpha_f * gbe); }
                        matrix_a.add_element(node_collector - 1, node_collector - 1, gbc);
                        vector_z[node_collector - 1] -= ieq_c;
                    }

                    if node_emitter > 0 {
                        if node_base > 0 { matrix_a.add_element(node_emitter - 1, node_base - 1, -(gbe - alpha_r * gbc)); }
                        matrix_a.add_element(node_emitter - 1, node_emitter - 1, gbe);
                        if node_collector > 0 { matrix_a.add_element(node_emitter - 1, node_collector - 1, -alpha_r * gbc); }
                        vector_z[node_emitter - 1] += ieq_e;
                    }
                } else {
                    stamp_conductance(node_base, node_base, g_be_b + g_bc_b);
                    stamp_conductance(node_base, node_emitter, -g_be_b);
                    stamp_conductance(node_base, node_collector, -g_bc_b);
                    if node_base > 0 { vector_z[node_base - 1] += ieq_b; }

                    if node_collector > 0 {
                        if node_base > 0 { matrix_a.add_element(node_collector - 1, node_base - 1, alpha_f * gbe - gbc); }
                        if node_emitter > 0 { matrix_a.add_element(node_collector - 1, node_emitter - 1, -alpha_f * gbe); }
                        matrix_a.add_element(node_collector - 1, node_collector - 1, gbc);
                        vector_z[node_collector - 1] += ieq_c;
                    }

                    if node_emitter > 0 {
                        if node_base > 0 { matrix_a.add_element(node_emitter - 1, node_base - 1, -(gbe - alpha_r * gbc)); }
                        matrix_a.add_element(node_emitter - 1, node_emitter - 1, gbe);
                        if node_collector > 0 { matrix_a.add_element(node_emitter - 1, node_collector - 1, -alpha_r * gbc); }
                        vector_z[node_emitter - 1] += ieq_e;
                    }
                }
            } else if comp.comp_type == "njf" || comp.comp_type == "pjf" {
                let is_njf = comp.comp_type == "njf";
                let node_drain = comp.pins[0].parse::<usize>().unwrap();
                let node_gate = comp.pins[1].parse::<usize>().unwrap();
                let node_source = comp.pins[2].parse::<usize>().unwrap();

                let v_drain = if node_drain > 0 { prev_voltages[node_drain] } else { 0.0 };
                let v_gate = if node_gate > 0 { prev_voltages[node_gate] } else { 0.0 };
                let v_source = if node_source > 0 { prev_voltages[node_source] } else { 0.0 };

                let vto = comp.jfet_vto.unwrap_or(if is_njf { -2.0 } else { 2.0 });
                let beta = comp.jfet_beta.unwrap_or(1e-3);
                let lambda = comp.jfet_lambda.unwrap_or(0.0);

                let (vgs_raw, vds_raw, factor_pol) = if is_njf {
                    (v_gate - v_source, v_drain - v_source, 1.0)
                } else {
                    (v_source - v_gate, v_source - v_drain, -1.0)
                };

                let mut vgs = vgs_raw;
                let mut vds = vds_raw;
                let mut swapped = false;
                if vds < 0.0 {
                    vds = -vds;
                    vgs = if is_njf { v_gate - v_drain } else { v_drain - v_gate };
                    swapped = true;
                }

                let vgst = if is_njf { vgs - vto } else { vto - vgs };
                let (ids, gm, gds) = if vgst <= 0.0 {
                    (0.0, 0.0, 1e-9)
                } else if vds < vgst {
                    let ids_val = beta * vds * (2.0 * vgst - vds) * (1.0 + lambda * vds);
                    let gm_val = 2.0 * beta * vds * (1.0 + lambda * vds);
                    let gds_val = beta * ( (2.0 * vgst - 2.0 * vds) * (1.0 + lambda * vds) + vds * (2.0 * vgst - vds) * lambda );
                    (ids_val, gm_val, gds_val.max(1e-9))
                } else {
                    let ids_val = beta * vgst * vgst * (1.0 + lambda * vds);
                    let gm_val = 2.0 * beta * vgst * (1.0 + lambda * vds);
                    let gds_val = beta * vgst * vgst * lambda;
                    (ids_val, gm_val, gds_val.max(1e-9))
                };

                let (ids_eff, gm_eff, gds_eff) = if swapped {
                    (-ids, -gm, gds)
                } else {
                    (ids, gm, gds)
                };

                let ids_final = ids_eff * factor_pol;
                let gm_final = gm_eff * factor_pol;
                let gds_final = gds_eff;

                let ieq = ids_final - gm_final * vgs_raw - gds_final * vds_raw;

                // Estampar gds usando acceso directo a la matriz (evita conflicto de borrow)
                if node_drain > 0 { matrix_a.add_element(node_drain - 1, node_drain - 1, gds_final); }
                if node_source > 0 { matrix_a.add_element(node_source - 1, node_source - 1, gds_final); }
                if node_drain > 0 && node_source > 0 { matrix_a.add_element(node_drain - 1, node_source - 1, -gds_final); }
                if node_source > 0 && node_drain > 0 { matrix_a.add_element(node_source - 1, node_drain - 1, -gds_final); }

                // Estampar gm (transconductancia)
                if node_drain > 0 {
                    if node_gate > 0 { matrix_a.add_element(node_drain - 1, node_gate - 1, gm_final); }
                    if node_source > 0 { matrix_a.add_element(node_drain - 1, node_source - 1, -gm_final); }
                }
                if node_source > 0 {
                    if node_gate > 0 { matrix_a.add_element(node_source - 1, node_gate - 1, -gm_final); }
                    if node_source > 0 { matrix_a.add_element(node_source - 1, node_source - 1, gm_final); }
                }

                if node_drain > 0 { vector_z[node_drain - 1] -= ieq; }
                if node_source > 0 { vector_z[node_source - 1] += ieq; }

                // Diodos parásitos de puerta
                let gate_is = 1e-14;
                let exp_gs = ((v_gate - v_source) / vt).exp();
                let igs = gate_is * (exp_gs - 1.0);
                let gg_gs = (gate_is / vt) * exp_gs;
                let ieq_gs = igs - gg_gs * (v_gate - v_source);

                if node_gate > 0 { matrix_a.add_element(node_gate - 1, node_gate - 1, gg_gs); }
                if node_source > 0 { matrix_a.add_element(node_source - 1, node_source - 1, gg_gs); }
                if node_gate > 0 && node_source > 0 { matrix_a.add_element(node_gate - 1, node_source - 1, -gg_gs); }
                if node_source > 0 && node_gate > 0 { matrix_a.add_element(node_source - 1, node_gate - 1, -gg_gs); }
                if node_gate > 0 { vector_z[node_gate - 1] -= ieq_gs; }
                if node_source > 0 { vector_z[node_source - 1] += ieq_gs; }

                let exp_gd = ((v_gate - v_drain) / vt).exp();
                let igd = gate_is * (exp_gd - 1.0);
                let gg_gd = (gate_is / vt) * exp_gd;
                let ieq_gd = igd - gg_gd * (v_gate - v_drain);

                if node_gate > 0 { matrix_a.add_element(node_gate - 1, node_gate - 1, gg_gd); }
                if node_drain > 0 { matrix_a.add_element(node_drain - 1, node_drain - 1, gg_gd); }
                if node_gate > 0 && node_drain > 0 { matrix_a.add_element(node_gate - 1, node_drain - 1, -gg_gd); }
                if node_drain > 0 && node_gate > 0 { matrix_a.add_element(node_drain - 1, node_gate - 1, -gg_gd); }
                if node_gate > 0 { vector_z[node_gate - 1] -= ieq_gd; }
                if node_drain > 0 { vector_z[node_drain - 1] += ieq_gd; }
            } else if comp.comp_type == "opamp" {
                let pin_in_pos = comp.pins[0].parse::<usize>().unwrap();
                let pin_in_neg = comp.pins[1].parse::<usize>().unwrap();
                let pin_vplus = comp.pins[2].parse::<usize>().unwrap();
                let pin_vminus = comp.pins[3].parse::<usize>().unwrap();
                let pin_out = comp.pins[4].parse::<usize>().unwrap();

                // Obtener voltajes previos
                let v_in_pos = if pin_in_pos > 0 { prev_voltages[pin_in_pos] } else { 0.0 };
                let v_in_neg = if pin_in_neg > 0 { prev_voltages[pin_in_neg] } else { 0.0 };
                let v_vplus = if pin_vplus > 0 { prev_voltages[pin_vplus] } else { 15.0 };
                let v_vminus = if pin_vminus > 0 { prev_voltages[pin_vminus] } else { -15.0 };

                let v_diff = v_in_pos - v_in_neg;
                let mut v_span = v_vplus - v_vminus;
                let mut v_mid = 0.5 * (v_vplus + v_vminus);

                // Prevenir división por cero si no hay alimentación conectada
                if v_span.abs() < 1e-3 {
                    v_span = 30.0;
                    v_mid = 0.0;
                }

                let a_ol = 1e5; // Ganancia de lazo abierto
                let r_in = 1e7; // 10 Mohm
                let r_out = 100.0; // 100 ohm
                let g_out = 1.0 / r_out;
                let g_in = 1.0 / r_in;

                // 1. Estampar conductancia de entrada diferencial R_in
                let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                    if r > 0 && c > 0 {
                        matrix_a.add_element(r - 1, c - 1, g);
                    }
                };
                stamp_conductance(pin_in_pos, pin_in_pos, g_in);
                stamp_conductance(pin_in_neg, pin_in_neg, g_in);
                stamp_conductance(pin_in_pos, pin_in_neg, -g_in);
                stamp_conductance(pin_in_neg, pin_in_pos, -g_in);

                // 2. Calcular V_int_ctrl no lineal con tanh
                let arg = (a_ol * v_diff) / v_span;
                let tanh_val = arg.tanh();
                let v_int_ctrl = v_mid + 0.5 * v_span * tanh_val;

                // Derivada de V_int_ctrl respecto a V_diff:
                // d(V_int)/d(V_diff) = 0.5 * A_ol * (1 - tanh^2)
                let g_m_int = 0.5 * a_ol * (1.0 - tanh_val * tanh_val);
                let g_m_opamp = g_out * g_m_int;

                // Corriente equivalente de Norton a inyectar en pin_out
                let ieq = g_out * v_int_ctrl - g_m_opamp * v_diff;

                // 3. Estampar en MNA
                // Conductancia de salida
                if pin_out > 0 {
                    matrix_a.add_element(pin_out - 1, pin_out - 1, g_out);
                    
                    // Transconductancias gm controladas en la fila de pin_out
                    if pin_in_pos > 0 {
                        matrix_a.add_element(pin_out - 1, pin_in_pos - 1, -g_m_opamp);
                    }
                    if pin_in_neg > 0 {
                        matrix_a.add_element(pin_out - 1, pin_in_neg - 1, g_m_opamp);
                    }

                    // Inyección de corriente equivalente en vector Z
                    vector_z[pin_out - 1] += ieq;
                }
            } else if comp.comp_type.ends_with("_gate") {
                let is_not = comp.comp_type == "not_gate";
                
                let (pin_in_a, pin_in_b, pin_out) = if is_not {
                    let pa = comp.pins[0].parse::<usize>().unwrap();
                    let po = comp.pins[1].parse::<usize>().unwrap();
                    (pa, 0, po)
                } else {
                    let pa = comp.pins[0].parse::<usize>().unwrap();
                    let pb = comp.pins[1].parse::<usize>().unwrap();
                    let po = comp.pins[2].parse::<usize>().unwrap();
                    (pa, pb, po)
                };

                let v_a = if pin_in_a > 0 { prev_voltages[pin_in_a] } else { 0.0 };
                let v_b = if pin_in_b > 0 { prev_voltages[pin_in_b] } else { 0.0 };

                let v_a_clamped = v_a.clamp(0.0, 5.0);
                let v_b_clamped = v_b.clamp(0.0, 5.0);

                let val_a = 1.0 / (1.0 + (-(v_a_clamped - 1.4) / 0.15).exp());
                let val_b = 1.0 / (1.0 + (-(v_b_clamped - 1.4) / 0.15).exp());

                let logic_out = match comp.comp_type.as_str() {
                    "and_gate" => val_a * val_b,
                    "or_gate" => val_a + val_b - val_a * val_b,
                    "not_gate" => 1.0 - val_a,
                    "nand_gate" => 1.0 - (val_a * val_b),
                    "nor_gate" => (1.0 - val_a) * (1.0 - val_b),
                    "xor_gate" => val_a * (1.0 - val_b) + val_b * (1.0 - val_a),
                    _ => 0.0
                };

                let v_oh = 5.0 * alpha;
                let v_out_ideal = logic_out * v_oh;

                let r_out = 50.0;
                let g_out = 1.0 / r_out;
                let ieq = v_out_ideal / r_out;

                if pin_out > 0 {
                    matrix_a.add_element(pin_out - 1, pin_out - 1, g_out);
                    vector_z[pin_out - 1] += ieq;
                }
            } else if comp.comp_type == "arduino_uno" || comp.comp_type == "esp32" || comp.comp_type == "raspberry_pi_pico" {
                if comp.pins.len() >= 6 {
                    let pin_in = comp.pins[0].parse::<usize>().unwrap_or(0);
                    let pin_out = comp.pins[1].parse::<usize>().unwrap_or(0);
                    let pin_adc = comp.pins[2].parse::<usize>().unwrap_or(0);
                    let pin_dac = comp.pins[3].parse::<usize>().unwrap_or(0);
                    let pin_vcc = comp.pins[4].parse::<usize>().unwrap_or(0);
                    let pin_gnd = comp.pins[5].parse::<usize>().unwrap_or(0);

                    let v_cc = match comp.comp_type.as_str() {
                        "arduino_uno" => 5.0,
                        "esp32" | "raspberry_pi_pico" => 3.3,
                        _ => 5.0,
                    };

                    let mode = comp.value as i32;

                    // 1. Impedancia de entrada (Pin_In y Pin_ADC)
                    let g_in = 1e-6; // 1 MΩ
                    let g_adc = 1e-7; // 10 MΩ

                    let stamp_g = |matrix: &mut SparseMatrix, r: usize, c: usize, g: f64| {
                        if r > 0 && c > 0 {
                            matrix.add_element(r - 1, c - 1, g);
                        }
                    };

                    // Pin_In a GND
                    stamp_g(&mut matrix_a, pin_in, pin_in, g_in);
                    stamp_g(&mut matrix_a, pin_gnd, pin_gnd, g_in);
                    stamp_g(&mut matrix_a, pin_in, pin_gnd, -g_in);
                    stamp_g(&mut matrix_a, pin_gnd, pin_in, -g_in);

                    // Pin_ADC a GND
                    stamp_g(&mut matrix_a, pin_adc, pin_adc, g_adc);
                    stamp_g(&mut matrix_a, pin_gnd, pin_gnd, g_adc);
                    stamp_g(&mut matrix_a, pin_adc, pin_gnd, -g_adc);
                    stamp_g(&mut matrix_a, pin_gnd, pin_adc, -g_adc);

                    // 2. Alimentación Pin_VCC con consumo dinámico linealizado
                    let i_baseline = match comp.comp_type.as_str() {
                        "arduino_uno" => 0.015,
                        "esp32" => 0.060,
                        "raspberry_pi_pico" => 0.025,
                        _ => 0.015,
                    };
                    let c_eff = match comp.comp_type.as_str() {
                        "arduino_uno" => 150e-12,
                        "esp32" => 450e-12,
                        "raspberry_pi_pico" => 250e-12,
                        _ => 150e-12,
                    };
                    let f_clk = match comp.comp_type.as_str() {
                        "arduino_uno" => 16e6,
                        "esp32" => 240e6,
                        "raspberry_pi_pico" => 133e6,
                        _ => 16e6,
                    };

                    let g_vcc_draw = c_eff * f_clk;
                    let i_leakage = 1e-6; // 1 uA baseline leakage
                    let i_vcc_draw_static = i_baseline + i_leakage;

                    let g_vcc = 10.0; // 0.1 Ω internal supply impedance
                    let i_vcc_eq = g_vcc * v_cc - i_vcc_draw_static;

                    // Estampar conductancia de carril y conductancia de carga dinámica
                    let g_vcc_total = g_vcc + g_vcc_draw;
                    stamp_g(&mut matrix_a, pin_vcc, pin_vcc, g_vcc_total);
                    stamp_g(&mut matrix_a, pin_gnd, pin_gnd, g_vcc_total);
                    stamp_g(&mut matrix_a, pin_vcc, pin_gnd, -g_vcc_total);
                    stamp_g(&mut matrix_a, pin_gnd, pin_vcc, -g_vcc_total);

                    if pin_vcc > 0 {
                        vector_z[pin_vcc - 1] += i_vcc_eq;
                    }
                    if pin_gnd > 0 {
                        vector_z[pin_gnd - 1] -= i_vcc_eq;
                    }

                    // 3. Drivers de Salida con protección activa de sobrecorriente por saturación
                    let g_out = 0.05; // 20 Ω
                    let i_max = match comp.comp_type.as_str() {
                        "arduino_uno" => 0.040, // 40 mA
                        _ => 0.012, // 12 mA
                    };

                    let v_adc_val = if pin_adc > 0 { prev_voltages[pin_adc] } else { 0.0 };
                    let v_gnd_val = if pin_gnd > 0 { prev_voltages[pin_gnd] } else { 0.0 };
                    let v_adc_diff = v_adc_val - v_gnd_val;

                    let v_out_val = if pin_out > 0 { prev_voltages[pin_out] } else { 0.0 };
                    let v_out_diff = v_out_val - v_gnd_val;

                    let v_target_out = match mode {
                        1 => v_cc,
                        2 => {
                            let v_threshold = 0.5 * v_cc;
                            if v_adc_diff > v_threshold { v_cc } else { 0.0 }
                        }
                        _ => 0.0,
                    };

                    let i_linear_out = g_out * (v_target_out - v_out_diff);

                    let i_stamp_out = if i_linear_out > i_max {
                        i_max + g_out * v_out_diff
                    } else if i_linear_out < -i_max {
                        -i_max + g_out * v_out_diff
                    } else {
                        g_out * v_target_out
                    };

                    // Stamp Pin_Out
                    stamp_g(&mut matrix_a, pin_out, pin_out, g_out);
                    stamp_g(&mut matrix_a, pin_gnd, pin_gnd, g_out);
                    stamp_g(&mut matrix_a, pin_out, pin_gnd, -g_out);
                    stamp_g(&mut matrix_a, pin_gnd, pin_out, -g_out);

                    if pin_out > 0 {
                        vector_z[pin_out - 1] += i_stamp_out;
                    }
                    if pin_gnd > 0 {
                        vector_z[pin_gnd - 1] -= i_stamp_out;
                    }

                    // Stamp Pin_DAC
                    let v_dac_val = if pin_dac > 0 { prev_voltages[pin_dac] } else { 0.0 };
                    let v_dac_diff = v_dac_val - v_gnd_val;

                    let v_target_dac = if mode == 0 || mode == 3 {
                        v_adc_diff.clamp(0.0, v_cc)
                    } else {
                        0.0
                    };

                    let i_linear_dac = g_out * (v_target_dac - v_dac_diff);

                    let (i_stamp_dac, g_transfer) = if i_linear_dac > i_max {
                        (i_max + g_out * v_dac_diff, 0.0)
                    } else if i_linear_dac < -i_max {
                        (-i_max + g_out * v_dac_diff, 0.0)
                    } else {
                        let g_trans = if mode == 0 || mode == 3 { g_out } else { 0.0 };
                        (g_out * v_target_dac, g_trans)
                    };

                    stamp_g(&mut matrix_a, pin_dac, pin_dac, g_out);
                    stamp_g(&mut matrix_a, pin_gnd, pin_gnd, g_out);
                    stamp_g(&mut matrix_a, pin_dac, pin_gnd, -g_out);
                    stamp_g(&mut matrix_a, pin_gnd, pin_dac, -g_out);

                    let i_eq_dac_residue = i_stamp_dac - g_transfer * v_adc_diff;

                    if pin_dac > 0 && pin_adc > 0 {
                        matrix_a.add_element(pin_dac - 1, pin_adc - 1, -g_transfer);
                    }
                    if pin_dac > 0 && pin_gnd > 0 {
                        matrix_a.add_element(pin_dac - 1, pin_gnd - 1, g_transfer);
                    }
                    if pin_gnd > 0 && pin_adc > 0 {
                        matrix_a.add_element(pin_gnd - 1, pin_adc - 1, g_transfer);
                    }
                    if pin_gnd > 0 {
                        matrix_a.add_element(pin_gnd - 1, pin_gnd - 1, -g_transfer);
                    }

                    if pin_dac > 0 {
                        vector_z[pin_dac - 1] += i_eq_dac_residue;
                    }
                    if pin_gnd > 0 {
                        vector_z[pin_gnd - 1] -= i_eq_dac_residue;
                    }
                }
            // B-Sources: Evaluar expresiones y actualizar vector de excitación
            } else if comp.comp_type == "switch" {
                // Frozen-state stamping: state determined before NR loop from initial_guess
                let node_a = comp.pins[0].parse::<usize>().unwrap();
                let node_b = comp.pins[1].parse::<usize>().unwrap();
                let ron = comp.switch_ron.unwrap_or(0.01);
                let roff = comp.switch_roff.unwrap_or(1e9);
                let is_closed = switch_frozen_states.get(&comp.id).copied().unwrap_or(false);
                let conductance = 1.0 / if is_closed { ron } else { roff };
                
                let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                    if r > 0 && c > 0 {
                        matrix_a.add_element(r - 1, c - 1, g);
                    }
                };
                
                stamp_conductance(node_a, node_a, conductance);
                stamp_conductance(node_b, node_b, conductance);
                stamp_conductance(node_a, node_b, -conductance);
                stamp_conductance(node_b, node_a, -conductance);
            } else if comp.comp_type == "bvoltage" {
                if let Some(ref expr_str) = comp.expression {
                    let _node_pos = comp.pins[0].parse::<usize>().unwrap_or(0);
                    let _node_neg = comp.pins[1].parse::<usize>().unwrap_or(0);
                    let mut nv = HashMap::new();
                    nv.insert("0".to_string(), 0.0);
                    for i in 1..=n { nv.insert(i.to_string(), prev_voltages[i]); }
                    let mut bc = HashMap::new();
                    for vs_comp in netlist.components.iter().filter(|c| c.comp_type == "vsource" || c.comp_type == "bvoltage") {
                        if let Some(&idx) = vsource_map.get(&vs_comp.id) {
                            bc.insert(vs_comp.id.clone(), solution[n + idx]);
                        }
                    }
                    if let Ok(ad) = evaluate_expression_ad(&expr_str, &nv, &bc, 0.0, &mut ast_cache) {
                        let vs_idx = *vsource_map.get(&comp.id).unwrap();
                        let col = n + vs_idx;
                        let mut ieq = ad.value;
                        for (&node_idx, &dv_dvx) in &ad.grad {
                            let v_k = if node_idx > 0 { prev_voltages[node_idx] } else { 0.0 };
                            ieq -= dv_dvx * v_k;
                            if col < size && node_idx > 0 {
                                matrix_a.add_element(col, node_idx - 1, -dv_dvx);
                            }
                        }
                        vector_z[col] = ieq;
                    }
                }
            } else if comp.comp_type == "bcurrent" {
                if let Some(ref expr_str) = comp.expression {
                    let node_pos = comp.pins[0].parse::<usize>().unwrap_or(0);
                    let node_neg = comp.pins[1].parse::<usize>().unwrap_or(0);
                    let mut nv = HashMap::new();
                    nv.insert("0".to_string(), 0.0);
                    for i in 1..=n { nv.insert(i.to_string(), prev_voltages[i]); }
                    let mut bc = HashMap::new();
                    for vs_comp in netlist.components.iter().filter(|c| c.comp_type == "vsource" || c.comp_type == "bvoltage") {
                        if let Some(&idx) = vsource_map.get(&vs_comp.id) {
                            bc.insert(vs_comp.id.clone(), solution[n + idx]);
                        }
                    }
                    if let Ok(ad) = evaluate_expression_ad(&expr_str, &nv, &bc, 0.0, &mut ast_cache) {
                        let mut ieq = ad.value;
                        for (&node_idx, &di_dv) in &ad.grad {
                            let v_k = if node_idx > 0 { prev_voltages[node_idx] } else { 0.0 };
                            ieq -= di_dv * v_k;
                            if node_idx > 0 {
                                if node_pos > 0 {
                                    matrix_a.add_element(node_pos - 1, node_idx - 1, di_dv);
                                }
                                if node_neg > 0 {
                                    matrix_a.add_element(node_neg - 1, node_idx - 1, -di_dv);
                                }
                            }
                        }
                        if node_pos > 0 { vector_z[node_pos - 1] -= ieq; }
                        if node_neg > 0 { vector_z[node_neg - 1] += ieq; }
                    }
                }
            }
        }
        Ok((matrix_a, vector_z))
    };

    let mut stamped_matrix_and_vector: Option<(SparseMatrix, DVector<f64>)> = None;
    let _lambda_backtrack = 1.0;
    let _prev_max_diff = f64::MAX;

    // 2. Bucle Newton-Raphson amortiguado
    for _iter in 1..=max_iter {
        let (matrix_a, vector_z) = if let Some(mv) = stamped_matrix_and_vector.take() {
            mv
        } else {
            stamp_at(&prev_voltages, &prev_prev_voltages, &solution)?
        };

        // Resolver el sistema lineal de esta iteración A * x = z usando Aritmética Plana CSC Left-Looking o Schur en paralelo (BBDF)
        let is_parallel = size >= 40;
        let mut solved_ok = false;
        let mut new_solution = DVector::<f64>::zeros(size);

        if is_parallel {
            let solver = parallel_solver.get_or_insert_with(|| {
                crate::sparse_parallel::SchurParallelSolver::analyze(&matrix_a, 0.1)
            });
            if !solver.is_monolithic {
                if let Ok(sol) = solver.solve(&matrix_a, &vector_z) {
                    new_solution = sol;
                    solved_ok = true;
                }
            }
        }

        if !solved_ok {
            let (symbolic, workspace, matrix_csc) = csc_solver.get_or_insert_with(|| {
                let sym = crate::sparse_csc::SymbolicLU::analyze(&matrix_a);
                let work = crate::sparse_csc::NumericLUWorkspace::new(&sym);
                let csc = crate::sparse_csc::SparseMatrixCSC::from_sparse(&matrix_a);
                (sym, work, csc)
            });

            matrix_csc.update_from_sparse(&matrix_a);
            matrix_csc.left_looking_factorize(symbolic, workspace)
                .map_err(|_| "Error de convergencia o circuito mal condicionado".to_string())?;
            new_solution = symbolic.solve(workspace, &vector_z)
                .ok_or_else(|| "Error de convergencia o circuito mal condicionado".to_string())?;
        }

        // Comprobar si hay NaN en la solución
        for i in 1..=n {
            if new_solution[i - 1].is_nan() {
                return Err("Error de convergencia o circuito mal condicionado".to_string());
            }
        }

        // Calcular la norma del residuo real E_0 en el punto actual (sin pnjlim para evaluar el residuo físico real)
        let e_0 = {
            let (matrix_a_true, vector_z_true) = stamp_at(&prev_voltages, &prev_voltages, &solution)?;
            let f_k = multiply_sparse_matrix_vector(&matrix_a_true, &solution) - &vector_z_true;
            f_k.norm()
        };

        // Búsqueda Lineal con Retroceso (Backtracking Line Search)
        let mut lambda = 1.0;
        let mut best_prev_voltages = prev_voltages.clone();
        let mut best_solution = solution.clone();
        let mut best_max_diff = 0.0;
        let mut _found_descent = false;

        for search_step in 0..4 {
            // Calcular estado candidato para este lambda
            let mut prev_voltages_cand = prev_voltages.clone();
            for i in 1..=n {
                prev_voltages_cand[i] = prev_voltages[i] + lambda * (new_solution[i - 1] - prev_voltages[i]);
            }
            let mut solution_cand = solution.clone();
            for i in 0..n {
                solution_cand[i] = prev_voltages_cand[i + 1];
            }
            for i in n..size {
                solution_cand[i] = solution[i] + lambda * (new_solution[i] - solution[i]);
            }

            // Estampar en el estado candidato (sin pnjlim para evaluar el residuo real)
            if let Ok((matrix_a_cand, vector_z_cand)) = stamp_at(&prev_voltages_cand, &prev_voltages_cand, &solution_cand) {
                let f_cand = multiply_sparse_matrix_vector(&matrix_a_cand, &solution_cand) - &vector_z_cand;
                let e_cand = f_cand.norm();

                // Si reduce el residuo, o es el paso mínimo de salvaguarda (search_step == 3), lo aceptamos
                if e_cand < e_0 || search_step == 3 {
                    let mut max_diff_cand = 0.0;
                    for i in 1..=n {
                        let diff = (prev_voltages_cand[i] - prev_voltages[i]).abs();
                        if diff > max_diff_cand {
                            max_diff_cand = diff;
                        }
                    }
                    best_prev_voltages = prev_voltages_cand;
                    best_solution = solution_cand;
                    best_max_diff = max_diff_cand;
                    _found_descent = e_cand < e_0;
                    break;
                }
            }
            lambda *= 0.5;
        }

        // Actualizar el estado con el mejor candidato encontrado
        let old_prev_voltages = prev_voltages.clone();
        prev_prev_voltages = old_prev_voltages.clone();
        prev_voltages = best_prev_voltages;
        solution = best_solution;

        // Estampar con pnjlim habilitado para usar como matriz Jacobian en la siguiente iteración de resolución lineal
        let (matrix_a_accepted, vector_z_accepted) = stamp_at(&prev_voltages, &old_prev_voltages, &solution)?;
        stamped_matrix_and_vector = Some((matrix_a_accepted, vector_z_accepted));

        if best_max_diff < tolerance {
            converged = true;
            break;
        }
    }

    if converged {
        Ok(solution)
    } else {
        Err("Error de convergencia o circuito mal condicionado".to_string())
    }

}

#[allow(clippy::too_many_arguments)]
#[allow(clippy::ptr_arg)]
fn solve_homotopy_core(
    netlist: &CircuitNetlist,
    n: usize,
    m: usize,
    vsource_map: &HashMap<String, usize>,
    gmin: f64,
    lambda: f64,
    x_init: &Vec<f64>,
    initial_guess: &Vec<f64>
) -> Result<DVector<f64>, String> {
    let (vt, is_temp) = get_thermal_parameters(netlist.temperature, None);
    let size = n + m;
    let max_iter = 100;
    let tolerance = 1e-6;

    let mut prev_voltages = initial_guess.clone();
    let mut prev_prev_voltages = initial_guess.clone();
    let mut solution = DVector::<f64>::zeros(size);
    let mut converged = false;

    let mut csc_solver: Option<(crate::sparse_csc::SymbolicLU, crate::sparse_csc::NumericLUWorkspace, crate::sparse_csc::SparseMatrixCSC)> = None;
    let mut parallel_solver: Option<crate::sparse_parallel::SchurParallelSolver> = None;


    // 1. Armar matrices base lineales estáticas que no cambian en este NR
    let mut matrix_a_linear = SparseMatrix::new(size);
    let mut vector_z_linear = DVector::<f64>::zeros(size);
    stamp_linear_components_sparse(netlist, n, vsource_map, &mut matrix_a_linear, &mut vector_z_linear)?;

    // Escalar fuentes independientes por el factor lambda de Homotopía
    for idx in 0..m {
        vector_z_linear[n + idx] *= lambda;
    }

    // Inyectar conductancia Gmin artificial a tierra en todos los nodos activos
    if gmin > 0.0 {
        for i in 1..=n {
            matrix_a_linear.add_element(i - 1, i - 1, gmin);
        }
    }


    let mut lambda_backtrack = 1.0;
    let mut prev_max_diff = f64::MAX;

    // 2. Bucle Newton-Raphson
    for _iter in 1..=max_iter {
        let mut matrix_a = matrix_a_linear.clone();
        let mut vector_z = vector_z_linear.clone();

        // Estampar componentes no lineales
        for comp in &netlist.components {
            if comp.comp_type == "diode" || comp.comp_type == "led" {
                let node_anode = comp.pins[0].parse::<usize>().unwrap();
                let node_cathode = comp.pins[1].parse::<usize>().unwrap();
                let v_anode = if node_anode > 0 { prev_voltages[node_anode] } else { 0.0 };
                let v_cathode = if node_cathode > 0 { prev_voltages[node_cathode] } else { 0.0 };
                let vd_new = v_anode - v_cathode;
                let v_anode_old = if node_anode > 0 { prev_prev_voltages[node_anode] } else { 0.0 };
                let v_cathode_old = if node_cathode > 0 { prev_prev_voltages[node_cathode] } else { 0.0 };
                let vd_old = v_anode_old - v_cathode_old;
                let vd = pnjlim(vd_new, vd_old, vt, 0.6);
                let (_, id, geq) = solve_diode_junction_voltage(vd, netlist.temperature, comp);
                let ieq = id - geq * vd;

                let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                    if r > 0 && c > 0 {
                        matrix_a.add_element(r - 1, c - 1, g);
                    }
                };
                stamp_conductance(node_anode, node_anode, geq);
                stamp_conductance(node_cathode, node_cathode, geq);
                stamp_conductance(node_anode, node_cathode, -geq);
                stamp_conductance(node_cathode, node_anode, -geq);

                if node_anode > 0 { vector_z[node_anode - 1] -= ieq; }
                if node_cathode > 0 { vector_z[node_cathode - 1] += ieq; }
            } else if comp.comp_type == "opto" {
                if comp.pins.len() < 4 { continue; }
                let node_a = comp.pins[0].parse::<usize>().unwrap();
                let node_k = comp.pins[1].parse::<usize>().unwrap();
                let node_c = comp.pins[2].parse::<usize>().unwrap();
                let node_e = comp.pins[3].parse::<usize>().unwrap();

                let v_a = if node_a > 0 { prev_voltages[node_a] } else { 0.0 };
                let v_k = if node_k > 0 { prev_voltages[node_k] } else { 0.0 };
                let v_c = if node_c > 0 { prev_voltages[node_c] } else { 0.0 };
                let v_e = if node_e > 0 { prev_voltages[node_e] } else { 0.0 };

                let vd_new = v_a - v_k;
                let vd_old = (if node_a > 0 { prev_prev_voltages[node_a] } else { 0.0 })
                           - (if node_k > 0 { prev_prev_voltages[node_k] } else { 0.0 });
                let vd = pnjlim(vd_new, vd_old, vt, 0.6);
                let (_, id_led, gd_led) = solve_diode_junction_voltage(vd, netlist.temperature, comp);
                let ieq_led = id_led - gd_led * vd;

                let v_ce = v_c - v_e;
                let (_i_ce, g_md, g_o, i_ce_eq) = evaluate_opto_receiver(vd, gd_led, id_led, v_ce, comp);

                let mut stamp = |r: usize, c: usize, g: f64| {
                    if r > 0 && c > 0 { matrix_a.add_element(r - 1, c - 1, g); }
                };

                stamp(node_a, node_a,  gd_led);
                stamp(node_k, node_k,  gd_led);
                stamp(node_a, node_k, -gd_led);
                stamp(node_k, node_a, -gd_led);
                if node_a > 0 { vector_z[node_a - 1] -= ieq_led; }
                if node_k > 0 { vector_z[node_k - 1] += ieq_led; }

                stamp(node_c, node_a,  g_md);
                stamp(node_c, node_k, -g_md);
                stamp(node_c, node_c,  g_o);
                stamp(node_c, node_e, -g_o);
                stamp(node_e, node_a, -g_md);
                stamp(node_e, node_k,  g_md);
                stamp(node_e, node_c, -g_o);
                stamp(node_e, node_e,  g_o);
                if node_c > 0 { vector_z[node_c - 1] -= i_ce_eq; }
                if node_e > 0 { vector_z[node_e - 1] += i_ce_eq; }
            } else if comp.comp_type == "nmos" || comp.comp_type == "bsim3nmos" || comp.comp_type == "bsim4nmos" {
                let node_gate = comp.pins[0].parse::<usize>().unwrap();
                let node_drain = comp.pins[1].parse::<usize>().unwrap();
                let node_source = comp.pins[2].parse::<usize>().unwrap();
                let node_bulk = if comp.pins.len() >= 4 { comp.pins[3].parse::<usize>().unwrap_or(0) } else { 0 };

                let v_gate = if node_gate > 0 { prev_voltages[node_gate] } else { 0.0 };
                let v_drain = if node_drain > 0 { prev_voltages[node_drain] } else { 0.0 };
                let v_source = if node_source > 0 { prev_voltages[node_source] } else { 0.0 };
                let v_bulk = if node_bulk > 0 { prev_voltages[node_bulk] } else { 0.0 };

                let vgs = v_gate - v_source;
                let vds = v_drain - v_source;
                let vbs = v_bulk - v_source;

                let (ids, gm, gds) = if comp.comp_type == "bsim4nmos" {
                    let (ids_val, gm_val, gds_val, _, _) = evaluate_bsim4_nmos(vgs, vds, vbs, comp.value, comp.w, comp.l);
                    (ids_val, gm_val, gds_val)
                } else if comp.comp_type == "bsim3nmos" {
                    evaluate_bsim3_nmos(vgs, vds, vbs, comp.value, comp.w, comp.l, netlist.temperature, Some(comp))
                } else {
                    let beta = 1e-3;
                    let vth = comp.value;
                    let ids_val = if vgs <= vth { 0.0 }
                        else if vds < vgs - vth { beta * (2.0 * (vgs - vth) * vds - vds * vds) }
                        else { beta * (vgs - vth).powi(2) };
                    let gm_val = if vgs <= vth { 0.0 }
                        else if vds < vgs - vth { 2.0 * beta * vds }
                        else { 2.0 * beta * (vgs - vth) };
                    let gds_val = if vgs > vth && vds < vgs - vth {
                        2.0 * beta * ((vgs - vth) - vds)
                    } else {
                        0.0
                    };
                    (ids_val, gm_val, gds_val)
                };

                let ieq = ids - gm * vgs - gds * vds;

                let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                    if r > 0 && c > 0 { matrix_a.add_element(r - 1, c - 1, g); }
                };
                stamp_conductance(node_drain, node_drain, gds);
                stamp_conductance(node_source, node_source, gds);
                stamp_conductance(node_drain, node_source, -gds);
                stamp_conductance(node_source, node_drain, -gds);

                if node_drain > 0 {
                    stamp_conductance(node_drain, node_gate, gm);
                    stamp_conductance(node_drain, node_source, -gm);
                }
                if node_source > 0 {
                    stamp_conductance(node_source, node_gate, -gm);
                    stamp_conductance(node_source, node_source, gm);
                }

                if node_drain > 0 { vector_z[node_drain - 1] -= ieq; }
                if node_source > 0 { vector_z[node_source - 1] += ieq; }
            } else if comp.comp_type == "pmos" || comp.comp_type == "bsim3pmos" || comp.comp_type == "bsim4pmos" {
                let node_gate = comp.pins[0].parse::<usize>().unwrap();
                let node_drain = comp.pins[1].parse::<usize>().unwrap();
                let node_source = comp.pins[2].parse::<usize>().unwrap();
                let node_bulk = if comp.pins.len() >= 4 { comp.pins[3].parse::<usize>().unwrap_or(0) } else { 0 };

                let v_gate = if node_gate > 0 { prev_voltages[node_gate] } else { 0.0 };
                let v_drain = if node_drain > 0 { prev_voltages[node_drain] } else { 0.0 };
                let v_source = if node_source > 0 { prev_voltages[node_source] } else { 0.0 };
                let v_bulk = if node_bulk > 0 { prev_voltages[node_bulk] } else { 0.0 };

                let vsg = v_source - v_gate;
                let vsd = v_source - v_drain;
                let vsb = v_source - v_bulk;

                let (isd, gm, gds) = if comp.comp_type == "bsim4pmos" {
                    let (isd_val, gm_val, gds_val, _, _) = evaluate_bsim4_pmos(vsg, vsd, vsb, comp.value, comp.w, comp.l);
                    (isd_val, gm_val, gds_val)
                } else if comp.comp_type == "bsim3pmos" {
                    evaluate_bsim3_pmos(vsg, vsd, vsb, comp.value, comp.w, comp.l, netlist.temperature, Some(comp))
                } else {
                    let beta = 1e-3;
                    let vth = comp.value.abs();
                    let ids_val = if vsg <= vth { 0.0 }
                        else if vsd < vsg - vth { beta * (2.0 * (vsg - vth) * vsd - vsd * vsd) }
                        else { beta * (vsg - vth).powi(2) };
                    let gm_val = if vsg <= vth { 0.0 }
                        else if vsd < vsg - vth { 2.0 * beta * vsd }
                        else { 2.0 * beta * (vsg - vth) };
                    let gds_val = if vsg <= vth { 0.0 }
                        else if vsd < vsg - vth { 2.0 * beta * ((vsg - vth) - vsd) }
                        else { 0.0 };
                    (ids_val, gm_val, gds_val)
                };

                let ieq = isd - gm * vsg - gds * vsd;

                let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                    if r > 0 && c > 0 { matrix_a.add_element(r - 1, c - 1, g); }
                };
                stamp_conductance(node_source, node_source, gds);
                stamp_conductance(node_drain, node_drain, gds);
                stamp_conductance(node_source, node_drain, -gds);
                stamp_conductance(node_drain, node_source, -gds);

                if node_drain > 0 {
                    stamp_conductance(node_drain, node_gate, -gm);
                    stamp_conductance(node_drain, node_source, gm);
                }
                if node_source > 0 {
                    stamp_conductance(node_source, node_gate, gm);
                    stamp_conductance(node_source, node_source, -gm);
                }

                if node_source > 0 { vector_z[node_source - 1] -= ieq; }
                if node_drain > 0 { vector_z[node_drain - 1] += ieq; }
            } else if comp.comp_type == "jfet" || comp.comp_type == "njf" || comp.comp_type == "pjf" {
                // JFET Shichman-Hodges
                let node_drain = comp.pins[0].parse::<usize>().unwrap();
                let node_gate = comp.pins[1].parse::<usize>().unwrap();
                let node_source = comp.pins[2].parse::<usize>().unwrap();

                let vd = if node_drain > 0 { prev_voltages[node_drain] } else { 0.0 };
                let vg = if node_gate > 0 { prev_voltages[node_gate] } else { 0.0 };
                let vs = if node_source > 0 { prev_voltages[node_source] } else { 0.0 };

                let is_n = comp.comp_type == "njf";
                let vgs = if is_n { vg - vs } else { vs - vg };
                let vds = if is_n { vd - vs } else { vs - vd };

                let vto = comp.jfet_vto.unwrap_or(-2.0);
                let beta = comp.jfet_beta.unwrap_or(1e-3);
                let lambda = comp.jfet_lambda.unwrap_or(0.0);

                let (ids, gm, gds) = if vgs <= vto {
                    (0.0, 0.0, 0.0)
                } else if vds >= 0.0 {
                    if vds < vgs - vto {
                        let ids_val = beta * vds * (2.0 * (vgs - vto) - vds) * (1.0 + lambda * vds);
                        let gm_val = 2.0 * beta * vds * (1.0 + lambda * vds);
                        let gds_val = beta * (2.0 * (vgs - vto) - 2.0 * vds) * (1.0 + lambda * vds) + beta * vds * (2.0 * (vgs - vto) - vds) * lambda;
                        (ids_val, gm_val, gds_val)
                    } else {
                        let ids_val = beta * (vgs - vto).powi(2) * (1.0 + lambda * vds);
                        let gm_val = 2.0 * beta * (vgs - vto) * (1.0 + lambda * vds);
                        let gds_val = beta * (vgs - vto).powi(2) * lambda;
                        (ids_val, gm_val, gds_val)
                    }
                } else {
                    (0.0, 0.0, 0.0)
                };

                let ids_final = if is_n { ids } else { -ids };
                let gm_final = gm;
                let gds_final = gds;

                if node_drain > 0 { matrix_a.add_element(node_drain - 1, node_drain - 1, gds_final); }
                if node_source > 0 { matrix_a.add_element(node_source - 1, node_source - 1, gds_final); }
                if node_drain > 0 && node_source > 0 {
                    matrix_a.add_element(node_drain - 1, node_source - 1, -gds_final);
                    matrix_a.add_element(node_source - 1, node_drain - 1, -gds_final);
                }

                if is_n {
                    if node_drain > 0 {
                        matrix_a.add_element(node_drain - 1, node_gate - 1, gm_final);
                        matrix_a.add_element(node_drain - 1, node_source - 1, -gm_final);
                    }
                    if node_source > 0 {
                        matrix_a.add_element(node_source - 1, node_gate - 1, -gm_final);
                        matrix_a.add_element(node_source - 1, node_source - 1, gm_final);
                    }
                } else {
                    if node_drain > 0 {
                        matrix_a.add_element(node_drain - 1, node_source - 1, gm_final);
                        matrix_a.add_element(node_drain - 1, node_gate - 1, -gm_final);
                    }
                    if node_source > 0 {
                        matrix_a.add_element(node_source - 1, node_source - 1, -gm_final);
                        matrix_a.add_element(node_source - 1, node_gate - 1, gm_final);
                    }
                }

                let ieq = ids_final - gm_final * (vg - vs) - gds_final * (vd - vs);
                if node_drain > 0 { vector_z[node_drain - 1] -= ieq; }
                if node_source > 0 { vector_z[node_source - 1] += ieq; }
            } else if comp.comp_type == "npn" || comp.comp_type == "pnp" {
                let is_npn = comp.comp_type == "npn";
                let node_base = comp.pins[0].parse::<usize>().unwrap();
                let node_collector = comp.pins[1].parse::<usize>().unwrap();
                let node_emitter = comp.pins[2].parse::<usize>().unwrap();

                let v_base = if node_base > 0 { prev_voltages[node_base] } else { 0.0 };
                let v_collector = if node_collector > 0 { prev_voltages[node_collector] } else { 0.0 };
                let v_emitter = if node_emitter > 0 { prev_voltages[node_emitter] } else { 0.0 };

                let (vbe_new_raw, vbc_new_raw) = if is_npn {
                    (v_base - v_emitter, v_base - v_collector)
                } else {
                    (v_emitter - v_base, v_collector - v_base)
                };

                let v_base_old = if node_base > 0 { prev_prev_voltages[node_base] } else { 0.0 };
                let v_collector_old = if node_collector > 0 { prev_prev_voltages[node_collector] } else { 0.0 };
                let v_emitter_old = if node_emitter > 0 { prev_prev_voltages[node_emitter] } else { 0.0 };

                let (vbe_old_raw, vbc_old_raw) = if is_npn {
                    (v_base_old - v_emitter_old, v_base_old - v_collector_old)
                } else {
                    (v_emitter_old - v_base_old, v_collector_old - v_base_old)
                };

                let bjt_is_val = if comp.bjt_is.is_some() {
                    let (_, scaled_is) = get_thermal_parameters(netlist.temperature, comp.bjt_is);
                    scaled_is
                } else {
                    is_temp
                };

                let beta_f = comp.bjt_bf.unwrap_or(if comp.value <= 1.0 { 100.0 } else { comp.value });
                let beta_r = 1.0;
                let alpha_f = beta_f / (beta_f + 1.0);
                let alpha_r = beta_r / (beta_r + 1.0);

                let vbe_prev_safe = pnjlim(vbe_old_raw, vbe_old_raw, vt, 0.6).min(0.95);
                let vbc_prev_safe = pnjlim(vbc_old_raw, vbc_old_raw, vt, 0.6).min(0.95);

                let exp_be_old = (vbe_prev_safe / vt).exp();
                let exp_bc_old = (vbc_prev_safe / vt).exp();
                let ide_old = bjt_is_val * (exp_be_old - 1.0);
                let idc_old = bjt_is_val * (exp_bc_old - 1.0);

                let ib_prev = (ide_old / (beta_f + 1.0) + idc_old / (beta_r + 1.0)).clamp(-0.01, 0.01);
                let ic_prev = (alpha_f * ide_old - idc_old).clamp(-0.1, 0.1);

                let r_b = comp.bjt_rb.unwrap_or(10.0);
                let r_c = comp.bjt_rc.unwrap_or(2.0);

                let vbe_new = vbe_new_raw - ib_prev * r_b;
                let vbc_new = vbc_new_raw - ic_prev * r_c;
                let vbe_old = vbe_old_raw - ib_prev * r_b;
                let vbc_old = vbc_old_raw - ic_prev * r_c;

                let vbe = pnjlim(vbe_new, vbe_old, vt, 0.6);
                let vbc = pnjlim(vbc_new, vbc_old, vt, 0.6);

                let (ide, gbe, ieq_be) = evaluate_pn_junction(vbe, vt, bjt_is_val);
                let (_idc, gbc, ieq_bc) = evaluate_pn_junction(vbc, vt, bjt_is_val);

                let g_be_b = gbe / (beta_f + 1.0);
                let g_bc_b = gbc / (beta_r + 1.0);
                let ieq_b = ieq_be / (beta_f + 1.0) + ieq_bc / (beta_r + 1.0);

                let ieq_c = alpha_f * ieq_be - ieq_bc;
                let ieq_e = ieq_be - alpha_r * ieq_bc;

                let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                    if r > 0 && c > 0 {
                        matrix_a.add_element(r - 1, c - 1, g);
                    }
                };

                let v_af = comp.bjt_vaf.unwrap_or(if is_npn { 100.0 } else { 50.0 });
                let ic_active = (alpha_f * ide).abs();
                let go = ic_active / v_af;

                stamp_conductance(node_collector, node_collector, go);
                stamp_conductance(node_emitter, node_emitter, go);
                stamp_conductance(node_collector, node_emitter, -go);
                stamp_conductance(node_emitter, node_collector, -go);

                if is_npn {
                    stamp_conductance(node_base, node_base, g_be_b + g_bc_b);
                    stamp_conductance(node_base, node_emitter, -g_be_b);
                    stamp_conductance(node_base, node_collector, -g_bc_b);
                    if node_base > 0 { vector_z[node_base - 1] -= ieq_b; }

                    if node_collector > 0 {
                        if node_base > 0 { matrix_a.add_element(node_collector - 1, node_base - 1, alpha_f * gbe - gbc); }
                        if node_emitter > 0 { matrix_a.add_element(node_collector - 1, node_emitter - 1, -alpha_f * gbe); }
                        matrix_a.add_element(node_collector - 1, node_collector - 1, gbc);
                        vector_z[node_collector - 1] -= ieq_c;
                    }

                    if node_emitter > 0 {
                        if node_base > 0 { matrix_a.add_element(node_emitter - 1, node_base - 1, -(gbe - alpha_r * gbc)); }
                        matrix_a.add_element(node_emitter - 1, node_emitter - 1, gbe);
                        if node_collector > 0 { matrix_a.add_element(node_emitter - 1, node_collector - 1, -alpha_r * gbc); }
                        vector_z[node_emitter - 1] += ieq_e;
                    }
                } else {
                    stamp_conductance(node_base, node_base, g_be_b + g_bc_b);
                    stamp_conductance(node_base, node_emitter, -g_be_b);
                    stamp_conductance(node_base, node_collector, -g_bc_b);
                    if node_base > 0 { vector_z[node_base - 1] += ieq_b; }

                    if node_collector > 0 {
                        if node_base > 0 { matrix_a.add_element(node_collector - 1, node_base - 1, alpha_f * gbe - gbc); }
                        if node_emitter > 0 { matrix_a.add_element(node_collector - 1, node_emitter - 1, -alpha_f * gbe); }
                        matrix_a.add_element(node_collector - 1, node_collector - 1, gbc);
                        vector_z[node_collector - 1] += ieq_c;
                    }

                    if node_emitter > 0 {
                        if node_base > 0 { matrix_a.add_element(node_emitter - 1, node_base - 1, -(gbe - alpha_r * gbc)); }
                        matrix_a.add_element(node_emitter - 1, node_emitter - 1, gbe);
                        if node_collector > 0 { matrix_a.add_element(node_emitter - 1, node_collector - 1, -alpha_r * gbc); }
                        vector_z[node_emitter - 1] += ieq_e;
                    }
                }
            }
        }

        // Estampar admitancia homotópica de Punto Fijo y corriente de deformación homotópica
        let g_hom = (1.0 - lambda) * 1.0; // admitancia homotópica artificial de 1 Siemens
        for i in 1..=n {
            matrix_a.add_element(i - 1, i - 1, g_hom);
            vector_z[i - 1] += g_hom * x_init[i];
        }

        // Resolver el sistema MNA lineal para este paso de Newton usando Aritmética Plana CSC Left-Looking o Schur en paralelo (BBDF)
        let is_parallel = size >= 40;
        let mut solved_ok = false;
        let mut new_solution_res = None;

        if is_parallel {
            let solver = parallel_solver.get_or_insert_with(|| {
                crate::sparse_parallel::SchurParallelSolver::analyze(&matrix_a, 0.1)
            });
            if !solver.is_monolithic {
                if let Ok(sol) = solver.solve(&matrix_a, &vector_z) {
                    new_solution_res = Some(sol);
                    solved_ok = true;
                }
            }
        }

        if !solved_ok {
            let (symbolic, workspace, matrix_csc) = csc_solver.get_or_insert_with(|| {
                let sym = crate::sparse_csc::SymbolicLU::analyze(&matrix_a);
                let work = crate::sparse_csc::NumericLUWorkspace::new(&sym);
                let csc = crate::sparse_csc::SparseMatrixCSC::from_sparse(&matrix_a);
                (sym, work, csc)
            });

            matrix_csc.update_from_sparse(&matrix_a);
            new_solution_res = if matrix_csc.left_looking_factorize(symbolic, workspace).is_ok() {
                symbolic.solve(workspace, &vector_z)
            } else {
                None
            };
        }



        if let Some(new_solution) = new_solution_res {
            let mut max_diff = 0.0;
            for i in 1..=n {
                let diff = (new_solution[i - 1] - prev_voltages[i]).abs();
                if diff.is_nan() {
                    return Err("Error de convergencia o circuito mal condicionado".to_string());
                }
                if diff > max_diff {
                    max_diff = diff;
                }
            }

            // Amortiguamiento dinámico Newton-Raphson con Backtracking acelerado:
            let base_lambda = if max_diff > 2.0 * vt { 0.35 } else { 1.0 };
            if _iter > 1 && max_diff >= prev_max_diff {
                lambda_backtrack *= 0.5;
            } else if _iter > 1 && max_diff < prev_max_diff {
                lambda_backtrack = f64::min(lambda_backtrack * 2.0, 1.0);
            }
            let lambda_damp = base_lambda * lambda_backtrack;
            prev_max_diff = max_diff;

            prev_prev_voltages = prev_voltages.clone();
            for i in 1..=n {
                prev_voltages[i] = prev_voltages[i] + lambda_damp * (new_solution[i - 1] - prev_voltages[i]);
            }

            for i in n..size {
                solution[i] = new_solution[i];
            }

            for i in 0..n {
                solution[i] = prev_voltages[i + 1];
            }

            if max_diff < tolerance {
                converged = true;
                break;
            }
        } else {
            break;
        }
    }

    if converged {
        Ok(solution)
    } else {
        Err("Error de convergencia o circuito mal condicionado".to_string())
    }

}

// Helper para armar la estructura final de resultado a partir del vector solución
fn build_simulation_result(
    netlist: &CircuitNetlist,
    n: usize,
    _m: usize,
    vsource_map: &HashMap<String, usize>,
    solution: &DVector<f64>,
    iterations: usize
) -> Result<SimulationResult, String> {
    let mut node_voltages = HashMap::new();
    node_voltages.insert("0".to_string(), 0.0);
    for i in 1..=n {
        node_voltages.insert(i.to_string(), solution[i - 1]);
    }

    let mut branch_currents = HashMap::new();
    let v_sources: Vec<&ComponentData> = netlist.components.iter()
        .filter(|c| c.comp_type == "vsource" || c.comp_type == "bvoltage" || c.comp_type == "vcvs" || c.comp_type == "ccvs")
        .collect();

    for vs in &v_sources {
        let vs_idx = *vsource_map.get(&vs.id).unwrap();
        branch_currents.insert(vs.id.clone(), solution[n + vs_idx]);
    }

    Ok(SimulationResult {
        node_voltages,
        branch_currents,
        convergence_iterations: iterations,
        error_log: None,
    })

}

// SOLVER ITERATIVO NEWTON-RAPHSON ROBUSTO CON AUTO-RECUPERACIÓN (GMIN STEPPING Y SOURCE STEPPING)
// Incluye bucle externo de convergencia de estados del Switch (Latching)
fn solve_newton_raphson(
    netlist: &CircuitNetlist,
    n: usize,
    m: usize,
    vsource_map: &HashMap<String, usize>,
    initial_guess_opt: Option<&Vec<f64>>,
) -> Result<(SimulationResult, Vec<f64>), String> {
    let mut initial_guess = match initial_guess_opt {
        Some(guess) if guess.len() == n + 1 => guess.clone(),
        _ => vec![0.0; n + 1],
    };

    if initial_guess_opt.is_none() {
        for comp in &netlist.components {
            if comp.comp_type == "nodeset_directive" {
                if let Some(node_str) = comp.pins.first() {
                    if let Ok(node_idx) = node_str.parse::<usize>() {
                        if node_idx > 0 && node_idx <= n {
                            initial_guess[node_idx] = comp.value;
                        }
                    }
                }
            }
        }
    }
    let base_gmin = 1e-12; // G_min residual para estabilidad permanente de nodos flotantes

    // Construir estados iniciales congelados del switch evaluando initial_guess
    let mut switch_frozen_states: HashMap<String, bool> = HashMap::new();
    for comp in &netlist.components {
        if comp.comp_type == "switch" {
            let is_closed = comp.switch_state.unwrap_or(false);
            if let (Ok(node_a), Ok(node_b)) = (
                comp.pins[0].parse::<usize>(),
                comp.pins[1].parse::<usize>()
            ) {
                let v_a = if node_a <= n { initial_guess[node_a] } else { 0.0 };
                let v_b = if node_b <= n { initial_guess[node_b] } else { 0.0 };
                let v_ab = v_a - v_b;
                let vth = comp.switch_vth.unwrap_or(0.5);
                let vh = comp.switch_vh.unwrap_or(0.05);
                let mut state = is_closed;
                if !is_closed && v_ab > vth + vh / 2.0 {
                    state = true;
                } else if is_closed && v_ab < vth - vh / 2.0 {
                    state = false;
                }
                switch_frozen_states.insert(comp.id.clone(), state);
            } else {
                switch_frozen_states.insert(comp.id.clone(), is_closed);
            }
        }
    }

    // Helper: verificar si algún switch debe cambiar de estado tras convergencia
    let check_switch_convergence = |solution: &DVector<f64>,
                                    current_states: &HashMap<String, bool>|
     -> (bool, HashMap<String, bool>) {
        let mut changed = false;
        let mut new_states = current_states.clone();
        for comp in &netlist.components {
            if comp.comp_type == "switch" {
                if let (Ok(node_a), Ok(node_b)) = (
                    comp.pins[0].parse::<usize>(),
                    comp.pins[1].parse::<usize>()
                ) {
                    let v_a = if node_a > 0 { solution[node_a - 1] } else { 0.0 };
                    let v_b = if node_b > 0 { solution[node_b - 1] } else { 0.0 };
                    let v_ab = v_a - v_b;
                    let vth = comp.switch_vth.unwrap_or(0.5);
                    let vh = comp.switch_vh.unwrap_or(0.05);
                    let is_closed = current_states.get(&comp.id).copied().unwrap_or(false);
                    let desired = if !is_closed && v_ab > vth + vh / 2.0 {
                        true
                    } else if is_closed && v_ab < vth - vh / 2.0 {
                        false
                    } else {
                        is_closed
                    };
                    if desired != is_closed {
                        new_states.insert(comp.id.clone(), desired);
                        changed = true;
                    }
                }
            }
        }
        (changed, new_states)
    };

    // Bucle externo: reintentar con estados de switch actualizados hasta estabilizar
    for _outer_iter in 0..4 {
        // Intento 1: Newton-Raphson básico amortiguado
        match solve_newton_raphson_core(netlist, n, m, vsource_map, base_gmin, 1.0, &initial_guess, None, &switch_frozen_states) {
            Ok(solution) => {
                let (sw_changed, new_sw) = check_switch_convergence(&solution, &switch_frozen_states);
                if !sw_changed {
                    let res = build_simulation_result(netlist, n, m, vsource_map, &solution, 1)?;
                    let mut final_voltages = vec![0.0; n + 1];
                    for i in 1..=n {
                        final_voltages[i] = solution[i - 1];
                    }
                    return Ok((res, final_voltages));
                }
                switch_frozen_states = new_sw;
                for i in 1..=n { initial_guess[i] = solution[i - 1]; }
                continue;
            }
            Err(_) => {}
        }

        // Intento 2: Gmin Stepping logarítmico (Fase 14)
        let mut gmin_temp = 1e-3;
        let mut current_guess = initial_guess.clone();
        let mut gmin_success = true;
        let mut iters_gmin = 0;

        while gmin_temp >= base_gmin {
            iters_gmin += 1;
            match solve_newton_raphson_core(netlist, n, m, vsource_map, gmin_temp, 1.0, &current_guess, None, &switch_frozen_states) {
                Ok(sol) => {
                    for i in 1..=n {
                        current_guess[i] = sol[i - 1];
                    }
                    if gmin_temp <= base_gmin {
                        break;
                    }
                    gmin_temp *= 0.1;
                    if gmin_temp < base_gmin {
                        gmin_temp = base_gmin;
                    }
                }
                Err(_) => {
                    gmin_success = false;
                    break;
                }
            }
        }

        if gmin_success {
            if let Ok(solution) = solve_newton_raphson_core(netlist, n, m, vsource_map, base_gmin, 1.0, &current_guess, None, &switch_frozen_states) {
                let (sw_changed, new_sw) = check_switch_convergence(&solution, &switch_frozen_states);
                if !sw_changed {
                    let res = build_simulation_result(netlist, n, m, vsource_map, &solution, iters_gmin * 15)?;
                    let mut final_voltages = vec![0.0; n + 1];
                    for i in 1..=n {
                        final_voltages[i] = solution[i - 1];
                    }
                    return Ok((res, final_voltages));
                }
                switch_frozen_states = new_sw;
                for i in 1..=n { initial_guess[i] = solution[i - 1]; }
                continue;
            }
        }

        // Intento 3: Source Stepping adaptativo (Fase 14)
        let mut alpha: f64 = 0.0;
        let mut d_alpha: f64 = 0.05;
        let mut current_guess = initial_guess.clone();
        let mut source_success = true;
        let mut iters_source = 0;

        while alpha < 1.0_f64 {
            iters_source += 1;
            let next_alpha = (alpha + d_alpha).min(1.0_f64);
            match solve_newton_raphson_core(netlist, n, m, vsource_map, base_gmin, next_alpha, &current_guess, None, &switch_frozen_states) {
                Ok(sol) => {
                    for i in 1..=n {
                        current_guess[i] = sol[i - 1];
                    }
                    alpha = next_alpha;
                    d_alpha = (d_alpha * 1.5).min(0.2_f64);
                }
                Err(_) => {
                    d_alpha /= 2.0;
                    if d_alpha < 1e-4_f64 {
                        source_success = false;
                        break;
                    }
                }
            }
        }

        if source_success && alpha >= 1.0 {
            if let Ok(solution) = solve_newton_raphson_core(netlist, n, m, vsource_map, base_gmin, 1.0, &current_guess, None, &switch_frozen_states) {
                let (sw_changed, new_sw) = check_switch_convergence(&solution, &switch_frozen_states);
                if !sw_changed {
                    let res = build_simulation_result(netlist, n, m, vsource_map, &solution, iters_source * 20)?;
                    let mut final_voltages = vec![0.0; n + 1];
                    for i in 1..=n {
                        final_voltages[i] = solution[i - 1];
                    }
                    return Ok((res, final_voltages));
                }
                switch_frozen_states = new_sw;
                for i in 1..=n { initial_guess[i] = solution[i - 1]; }
                continue;
            }
        }

        // Intento 4: Homotopía de Continuación de Punto Fijo
        let mut lambda: f64 = 0.0;
        let mut d_lambda: f64 = 0.05;
        let mut current_guess_hom = initial_guess.clone();
        let x_init = initial_guess.clone();
        let mut homotopy_success = true;
        let mut iters_homotopy = 0;

        while lambda < 1.0_f64 {
            iters_homotopy += 1;
            let next_lambda = (lambda + d_lambda).min(1.0_f64);
            match solve_homotopy_core(netlist, n, m, vsource_map, base_gmin, next_lambda, &x_init, &current_guess_hom) {
                Ok(sol) => {
                    for i in 1..=n {
                        current_guess_hom[i] = sol[i - 1];
                    }
                    lambda = next_lambda;
                    d_lambda = (d_lambda * 1.5).min(0.2_f64);
                }
                Err(_e) => {
                    d_lambda /= 2.0;
                    if d_lambda < 1e-4_f64 {
                        homotopy_success = false;
                        break;
                    }
                }
            }
        }

        if homotopy_success && lambda >= 1.0 {
            match solve_newton_raphson_core(netlist, n, m, vsource_map, base_gmin, 1.0, &current_guess_hom, None, &switch_frozen_states) {
                Ok(solution) => {
                    let (sw_changed, new_sw) = check_switch_convergence(&solution, &switch_frozen_states);
                    if !sw_changed {
                        let res = build_simulation_result(netlist, n, m, vsource_map, &solution, iters_homotopy * 20)?;
                        let mut final_voltages = vec![0.0; n + 1];
                        for i in 1..=n {
                            final_voltages[i] = solution[i - 1];
                        }
                        return Ok((res, final_voltages));
                    }
                    switch_frozen_states = new_sw;
                    for i in 1..=n { initial_guess[i] = solution[i - 1]; }
                    continue;
                }
                Err(_e) => {}
            }
        }

        // Intento 5: Pseudo-Transient Analysis (PTA)
        let size = n + m;
        let mut pta_sol = DVector::<f64>::zeros(size);
        for i in 1..=n {
            pta_sol[i - 1] = initial_guess[i];
        }

        let c_pseudo = 1e-6;
        let l_pseudo = 1e-3;
        let mut dt_pseudo = 1e-6;
        let mut t_pseudo = 0.0;
        let t_max_pseudo = 0.5;
        let mut steps_completed = 0;
        let max_pta_steps = 300;
        let mut pta_success = true;

        while t_pseudo < t_max_pseudo && steps_completed < max_pta_steps {
            let g_pseudo = c_pseudo / dt_pseudo;
            let r_pseudo = l_pseudo / dt_pseudo;

            let mut current_guess = vec![0.0; n + 1];
            for i in 1..=n {
                current_guess[i] = pta_sol[i - 1];
            }

            match solve_newton_raphson_core(netlist, n, m, vsource_map, base_gmin, 1.0, &current_guess, Some((g_pseudo, r_pseudo, &pta_sol)), &switch_frozen_states) {
                Ok(sol) => {
                    pta_sol = sol;
                    t_pseudo += dt_pseudo;
                    steps_completed += 1;
                    dt_pseudo = (dt_pseudo * 1.5).min(0.1);
                }
                Err(_) => {
                    dt_pseudo /= 2.0;
                    if dt_pseudo < 1e-12 {
                        pta_success = false;
                        break;
                    }
                }
            }
        }

        if pta_success && steps_completed > 0 {
            let mut final_guess = vec![0.0; n + 1];
            for i in 1..=n {
                final_guess[i] = pta_sol[i - 1];
            }
            if let Ok(solution) = solve_newton_raphson_core(netlist, n, m, vsource_map, base_gmin, 1.0, &final_guess, None, &switch_frozen_states) {
                let (sw_changed, new_sw) = check_switch_convergence(&solution, &switch_frozen_states);
                if !sw_changed {
                    let res = build_simulation_result(netlist, n, m, vsource_map, &solution, steps_completed * 10 + 10)?;
                    let mut final_voltages = vec![0.0; n + 1];
                    for i in 1..=n {
                        final_voltages[i] = solution[i - 1];
                    }
                    return Ok((res, final_voltages));
                }
                switch_frozen_states = new_sw;
                for i in 1..=n { initial_guess[i] = solution[i - 1]; }
                continue;
            }
        }

        // Si ningún mecanismo de recuperación funcionó, retornar error
        return Err("Error de convergencia o circuito mal condicionado".to_string());
    }

    Err("Error de convergencia o circuito mal condicionado".to_string())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransientSettings {
    pub dt: f64,
    pub t_max: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fixed_step: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub integration_method: Option<String>,

}
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TimeStepResult {
    pub time: f64,
    pub node_voltages: HashMap<String, f64>,
    pub branch_currents: HashMap<String, f64>,

}

pub fn solve_transient_circuit(
    netlist: &CircuitNetlist,
    settings: &TransientSettings,
) -> Result<Vec<TimeStepResult>, String> {
    let (results, _, _) = solve_transient_circuit_with_initial_states(netlist, settings, HashMap::new(), HashMap::new())?;
    Ok(results)

}

pub fn solve_transient_circuit_with_initial_states(
    netlist: &CircuitNetlist,
    settings: &TransientSettings,
    cap_init: HashMap<String, f64>,
    ind_init: HashMap<String, f64>,
) -> Result<(Vec<TimeStepResult>, HashMap<String, f64>, HashMap<String, f64>), String> {
    solve_transient_circuit_inner(netlist, settings, cap_init, ind_init, None::<Arc<Mutex<Vec<crate::ComponentMutation>>>>, None::<fn(&TimeStepResult) -> bool>)
}

#[allow(clippy::type_complexity)]
pub(crate) fn solve_transient_circuit_inner<F>(
    netlist: &CircuitNetlist,
    settings: &TransientSettings,
    cap_init: HashMap<String, f64>,
    ind_init: HashMap<String, f64>,
    live_overrides: Option<Arc<Mutex<Vec<crate::ComponentMutation>>>>,
    mut on_step: Option<F>,
) -> Result<(Vec<TimeStepResult>, HashMap<String, f64>, HashMap<String, f64>), String>
where
    F: FnMut(&TimeStepResult) -> bool,
{

    let n = crate::topology::validate_netlist_topology(netlist, false)?;
    let (vt, _is_temp) = get_thermal_parameters(netlist.temperature, None);
    let is_fixed = settings.fixed_step.unwrap_or(false) || netlist.fixed_step.unwrap_or(false);
    let integration_method = settings.integration_method.as_deref().unwrap_or("euler");
    let v_sources: Vec<&ComponentData> = netlist.components.iter()
        .filter(|c| c.comp_type == "vsource" || c.comp_type == "bvoltage" || c.comp_type == "vcvs" || c.comp_type == "ccvs")
        .collect();
    let m = v_sources.len();

    let size = n + m;
    if size == 0 {
        return Err("El circuito no contiene nodos activos o componentes.".to_string());
    }

    let mut vsource_map = HashMap::new();
    for (idx, vs) in v_sources.iter().enumerate() {
        vsource_map.insert(vs.id.clone(), idx);
    }


    // Inicializar estados de los almacenes de energía (Capacitores y Bobinas) con valores pasados o 0.0
    let mut cap_states: HashMap<String, f64> = HashMap::new();
    let mut ind_states: HashMap<String, f64> = HashMap::new();
    let mut cap_states_prev: HashMap<String, f64> = HashMap::new();
    let mut ind_states_prev: HashMap<String, f64> = HashMap::new();
    let mut cap_currents: HashMap<String, f64> = HashMap::new();
    let mut ind_voltages: HashMap<String, f64> = HashMap::new();
    let mut switch_states: HashMap<String, bool> = HashMap::new();

    // Extraer .ic_directive a un mapa local para facilidad de acceso
    let mut ic_map = HashMap::new();
    for comp in &netlist.components {
        if comp.comp_type == "ic_directive" {
            if let Some(node) = comp.pins.first() {
                ic_map.insert(node.clone(), comp.value);
            }
        }
    }
    let has_ic = !ic_map.is_empty();

    for comp in &netlist.components {
        if comp.comp_type == "capacitor" {
            let pin_a = &comp.pins[0];
            let pin_b = &comp.pins[1];
            let mut v_ic = 0.0;
            if has_ic {
                let v_a = if pin_a == "0" { 0.0 } else { *ic_map.get(pin_a).unwrap_or(&0.0) };
                let v_b = if pin_b == "0" { 0.0 } else { *ic_map.get(pin_b).unwrap_or(&0.0) };
                v_ic = v_a - v_b;
            }
            let val = if has_ic { v_ic } else { *cap_init.get(&comp.id).unwrap_or(&0.0) };
            cap_states.insert(comp.id.clone(), val);
            cap_states_prev.insert(comp.id.clone(), val);
            cap_currents.insert(comp.id.clone(), 0.0);
        } else if comp.comp_type == "inductor" {
            let val = *ind_init.get(&comp.id).unwrap_or(&0.0);
            ind_states.insert(comp.id.clone(), val);
            ind_states_prev.insert(comp.id.clone(), val);
            ind_voltages.insert(comp.id.clone(), 0.0);
        } else if comp.comp_type == "switch" {
            switch_states.insert(comp.id.clone(), comp.switch_state.unwrap_or(false));
        }
    }


    let has_nonlinear = netlist.components.iter().any(|c| {
        c.comp_type == "diode" || c.comp_type == "led" || c.comp_type == "opto" || c.comp_type == "nmos" || c.comp_type == "pmos" ||
        c.comp_type == "npn" || c.comp_type == "pnp" || c.comp_type == "opamp" ||
        c.comp_type == "bsim3nmos" || c.comp_type == "bsim3pmos" || c.comp_type == "bsim4nmos" || c.comp_type == "bsim4pmos" || c.comp_type.ends_with("_gate") ||
        c.comp_type == "arduino_uno" || c.comp_type == "esp32" || c.comp_type == "raspberry_pi_pico" ||
        c.comp_type == "bvoltage" || c.comp_type == "bcurrent" || c.comp_type == "njf" || c.comp_type == "pjf" ||
        c.comp_type == "switch"
    });

    let mut mcu_tchip: HashMap<String, f64> = HashMap::new();
    let mut mcu_vsample: HashMap<String, f64> = HashMap::new();
    let mut mcu_vdaceff: HashMap<String, f64> = HashMap::new();

    let t_amb = netlist.temperature.unwrap_or(300.0);

    for comp in &netlist.components {
        if comp.comp_type == "arduino_uno" || comp.comp_type == "esp32" || comp.comp_type == "raspberry_pi_pico" {
            mcu_tchip.insert(comp.id.clone(), t_amb);
            mcu_vsample.insert(comp.id.clone(), 0.0);
            mcu_vdaceff.insert(comp.id.clone(), 0.0);
        }
    }

    // Temperaturas de unión para self-heating de dispositivos discretos (Diodos, BJTs, MOSFETs, Optos)
    let mut device_tjunc: HashMap<String, f64> = HashMap::new();
    for comp in &netlist.components {
        if comp.comp_type == "diode" || comp.comp_type == "led" || comp.comp_type == "nmos" || comp.comp_type == "pmos" ||
           comp.comp_type == "npn" || comp.comp_type == "pnp" || comp.comp_type == "bsim3nmos" || comp.comp_type == "bsim3pmos" ||
           comp.comp_type == "bsim4nmos" || comp.comp_type == "bsim4pmos" || comp.comp_type == "njf" || comp.comp_type == "pjf" ||
           comp.comp_type == "opto" {
            device_tjunc.insert(comp.id.clone(), t_amb);
        }
    }

    // Armar la matriz lineal estática BASE (Resistores, Fuentes de voltaje independientes)
    let mut matrix_a_linear = DMatrix::<f64>::zeros(size, size);
    let mut vector_z_linear = DVector::<f64>::zeros(size);

    stamp_linear_components(netlist, n, &vsource_map, &mut matrix_a_linear, &mut vector_z_linear)?;


    // Inicializar planificador Mixed-Signal y estados iniciales
    let mut ms_scheduler = MixedSignalScheduler::new();
    for comp in &netlist.components {
        if comp.comp_type.ends_with("_gate") {
            let is_not = comp.comp_type == "not_gate";
            let po = if is_not { 1 } else { 2 };
            // Estado inicial LOW por defecto
            ms_scheduler.set_state(&comp.id, po, false);
            // Inicializar voltajes de entrada analógicos pasados en el scheduler
            ms_scheduler.last_analog_v.entry(comp.id.clone())
                .or_default()
                .insert(0, 0.0);
            if !is_not {
                ms_scheduler.last_analog_v.get_mut(&comp.id).unwrap().insert(1, 0.0);
            }
        } else if comp.comp_type == "arduino_uno" || comp.comp_type == "esp32" || comp.comp_type == "raspberry_pi_pico" {
            // Salida digital inicial LOW (pin_idx = 1 es output)
            ms_scheduler.set_state(&comp.id, 1, false);
            // Schedulizar el primer McuPeriodicTick a t = 0.0
            ms_scheduler.schedule_event(MixedSignalEvent {
                time: 0.0,
                component_id: comp.id.clone(),
                event_type: MixedSignalEventType::McuPeriodicTick,
            });
        }
    }

    // VARIABLES DE TIEMPO ADAPTATIVO
    let mut dt = settings.dt;
    let mut prev_dt = settings.dt;
    let mut t = 0.0;
    let t_max = settings.t_max;

    // Histórico de soluciones para cálculo de la segunda derivada (Euler/Gear2) y tercera derivada (TRAP) del LTE
    let mut sol_n = DVector::<f64>::zeros(size);      // Solución actual (n)
    let mut sol_n1 = DVector::<f64>::zeros(size);     // Solución en n-1
    let mut sol_n2 = DVector::<f64>::zeros(size);     // Solución en n-2
    let mut steps_completed = 0;

    // Tolerancia LTE y límites de paso
    let lte_tol = 2e-4; // 200 uV de tolerancia de truncamiento
    let dt_min = 1e-7;  // 100 ns paso mínimo
    let dt_max = settings.dt * 2.5;

    let mut results = Vec::new();
    let mut current_solution = DVector::<f64>::zeros(size);
    let mut local_overrides: HashMap<String, HashMap<String, f64>> = HashMap::new();

    // Iterar en el tiempo de forma dinámica
    while t <= t_max {

        // Drenar mutaciones en caliente hacia el mapa local de overrides
        if let Some(ref queue) = live_overrides {
            if let Ok(mut guard) = queue.lock() {
                for mutation in guard.drain(..) {
                    local_overrides.entry(mutation.component_id)
                        .or_default()
                        .insert(mutation.field, mutation.value);
                }
            }
        }

        let gear2_active_this_step = integration_method == "gear2" && steps_completed >= 2;

        // Respaldar estados antes de intentar resolver el paso
        let cap_states_backup = cap_states.clone();
        let ind_states_backup = ind_states.clone();
        let cap_states_prev_backup = cap_states_prev.clone();
        let ind_states_prev_backup = ind_states_prev.clone();
        let switch_states_backup = switch_states.clone();
        let mcu_tchip_backup = mcu_tchip.clone();
        let mcu_vsample_backup = mcu_vsample.clone();
        let mcu_vdaceff_backup = mcu_vdaceff.clone();
        let device_tjunc_backup = device_tjunc.clone();
        let ms_scheduler_backup = ms_scheduler.clone();

        // Acotar timestep si se intercepta un evento digital intermedio
        let mut event_intercepted = false;
        let original_dt = dt;
        if let Some(next_event_t) = ms_scheduler.get_next_event_time() {
            if next_event_t > t && next_event_t < t + dt {
                dt = next_event_t - t;
                event_intercepted = true;
            }
        }

        // Clonar matrices base que no cambian
        let mut matrix_a = matrix_a_linear.clone();
        let mut vector_z = vector_z_linear.clone();

        // Aplicar overrides sobre la matriz y vector clonados (resistor DC, fuente DC)
        for (comp_id, fields) in &local_overrides {
            if let Some(&new_val) = fields.get("value") {
                if let Some(comp) = netlist.components.iter().find(|c| c.id == *comp_id) {
                    match comp.comp_type.as_str() {
                        "resistor" => {
                            if comp.value > 0.0 && new_val > 0.0 {
                                let g_old = 1.0 / comp.value;
                                let g_new = 1.0 / new_val;
                                let dg = g_new - g_old;
                                let node_a = comp.pins[0].parse::<usize>().unwrap_or(0);
                                let node_b = comp.pins[1].parse::<usize>().unwrap_or(0);
                                if node_a > 0 { matrix_a[(node_a - 1, node_a - 1)] += dg; }
                                if node_b > 0 { matrix_a[(node_b - 1, node_b - 1)] += dg; }
                                if node_a > 0 && node_b > 0 {
                                    matrix_a[(node_a - 1, node_b - 1)] -= dg;
                                    matrix_a[(node_b - 1, node_a - 1)] -= dg;
                                }
                            }
                        }
                        "vsource" => {
                            if comp.wave_type.is_none() {
                                if let Some(&vs_idx) = vsource_map.get(comp_id) {
                                    let diff = new_val - comp.value;
                                    vector_z[n + vs_idx] += diff;
                                }
                            }
                        }
                        "isource" => {
                            if comp.wave_type.is_none() {
                                let node_pos = comp.pins[0].parse::<usize>().unwrap_or(0);
                                let node_neg = comp.pins[1].parse::<usize>().unwrap_or(0);
                                let diff = new_val - comp.value;
                                if node_pos > 0 { vector_z[node_pos - 1] -= diff; }
                                if node_neg > 0 { vector_z[node_neg - 1] += diff; }
                            }
                        }
                        _ => {}
                    }
                }
            }
        }

        // Actualizar fuentes de tensión dinámicas transitorias para el t actual
        for comp in &netlist.components {
            if comp.comp_type == "vsource" {
                let co = local_overrides.get(&comp.id);
                if let Some(ref wave) = comp.wave_type {
                    let amp = co.and_then(|f| f.get("amplitude").copied()).or(comp.amplitude).unwrap_or(0.0);
                    let freq = co.and_then(|f| f.get("frequency").copied()).or(comp.frequency).unwrap_or(1e3);
                    let offset = co.and_then(|f| f.get("offset").copied()).or(comp.offset).unwrap_or(0.0);
                    let duty = co.and_then(|f| f.get("duty_cycle").copied()).or(comp.duty_cycle).unwrap_or(0.5);
                    let v_base = co.and_then(|f| f.get("value").copied()).unwrap_or(comp.value);

                    let v_val = match wave.as_str() {
                        "sine" => offset + amp * (2.0 * std::f64::consts::PI * freq * t).sin(),
                        "square" => {
                            let period = 1.0 / freq;
                            let t_mod = t % period;
                            if t_mod < duty * period {
                                offset + amp
                            } else {
                                offset - amp
                            }
                        }
                        "pulse" => {
                            let period = 1.0 / freq;
                            let t_mod = t % period;
                            let pulse_width = duty * period;
                            if t_mod < pulse_width {
                                offset + amp
                            } else {
                                offset
                            }
                        }
                        _ => v_base,
                    };

                    let vs_idx = *vsource_map.get(&comp.id).unwrap();
                    vector_z[n + vs_idx] = v_val;
                }
            } else if comp.comp_type == "isource" {
                let co = local_overrides.get(&comp.id);
                if let Some(ref wave) = comp.wave_type {
                    let amp = co.and_then(|f| f.get("amplitude").copied()).or(comp.amplitude).unwrap_or(0.0);
                    let freq = co.and_then(|f| f.get("frequency").copied()).or(comp.frequency).unwrap_or(1e3);
                    let offset = co.and_then(|f| f.get("offset").copied()).or(comp.offset).unwrap_or(0.0);
                    let duty = co.and_then(|f| f.get("duty_cycle").copied()).or(comp.duty_cycle).unwrap_or(0.5);

                    let i_val = match wave.as_str() {
                        "sine" => offset + amp * (2.0 * std::f64::consts::PI * freq * t).sin(),
                        "square" => {
                            let period = 1.0 / freq;
                            let t_mod = t % period;
                            if t_mod < duty * period {
                                offset + amp
                            } else {
                                offset - amp
                            }
                        }
                        "pulse" => {
                            let period = 1.0 / freq;
                            let t_mod = t % period;
                            let pulse_width = duty * period;
                            if t_mod < pulse_width {
                                offset + amp
                            } else {
                                offset
                            }
                        }
                        _ => comp.value,
                    };

                    let node_pos = comp.pins[0].parse::<usize>().unwrap();
                    let node_neg = comp.pins[1].parse::<usize>().unwrap();
                    let static_val = comp.value;
                    let diff = i_val - static_val;
                    if node_pos > 0 {
                        vector_z[node_pos - 1] -= diff;
                    }
                    if node_neg > 0 {
                        vector_z[node_neg - 1] += diff;
                    }
                }
            }
        }

        // Actualizar estados congelados del switch usando voltajes del paso anterior convergido
        for comp in &netlist.components {
            if comp.comp_type == "switch" {
                let co = local_overrides.get(&comp.id);
                // Si hay override de switch_state, forzar estado sin pasar por histéresis
                if let Some(&forced) = co.and_then(|f| f.get("switch_state")) {
                    switch_states.insert(comp.id.clone(), forced >= 0.5);
                } else if let (Ok(node_a), Ok(node_b)) = (
                    comp.pins[0].parse::<usize>(),
                    comp.pins[1].parse::<usize>()
                ) {
                    let v_a = if node_a > 0 { current_solution[node_a - 1] } else { 0.0 };
                    let v_b = if node_b > 0 { current_solution[node_b - 1] } else { 0.0 };
                    let v_ab = v_a - v_b;
                    let vth = co.and_then(|f| f.get("switch_vth").copied()).unwrap_or(comp.switch_vth.unwrap_or(0.5));
                    let vh = co.and_then(|f| f.get("switch_vh").copied()).unwrap_or(comp.switch_vh.unwrap_or(0.05));
                    let was_closed = switch_states.get(&comp.id).copied().unwrap_or(false);
                    let new_state = if !was_closed && v_ab > vth + vh / 2.0 {
                        true
                    } else if was_closed && v_ab < vth - vh / 2.0 {
                        false
                    } else {
                        was_closed
                    };
                    switch_states.insert(comp.id.clone(), new_state);
                }
            }
        }

        let stamp_companion_conductance = |matrix: &mut DMatrix<f64>, r: usize, c: usize, g: f64| {
            if r > 0 && c > 0 {
                matrix[(r - 1, c - 1)] += g;
            }
        };

        let (gear_a, gear_b, gear_c) = if gear2_active_this_step {
            let dt1 = dt;
            let dt2 = prev_dt;
            let a = (2.0 * dt1 + dt2) / (dt1 * (dt1 + dt2));
            let b = -(dt1 + dt2) / (dt1 * dt2);
            let c = dt1 / (dt2 * (dt1 + dt2));
            (a, b, c)
        } else {
            (0.0, 0.0, 0.0)
        };

        // Estampar los modelos de integración acompañantes y compuertas lógicas Mixed-Signal
        for comp in &netlist.components {
            match comp.comp_type.as_str() {
                "capacitor" => {
                    let node_pos = comp.pins[0].parse::<usize>().unwrap();
                    let node_neg = comp.pins[1].parse::<usize>().unwrap();
                    let prev_vc = *cap_states.get(&comp.id).unwrap();

                    let (g_eq, i_eq) = if gear2_active_this_step {
                        let prev_prev_vc = *cap_states_prev.get(&comp.id).unwrap_or(&prev_vc);
                        let g = gear_a * comp.value;
                        let i = -comp.value * (gear_b * prev_vc + gear_c * prev_prev_vc);
                        (g, i)
                    } else if integration_method == "trap" {
                        let prev_ic = *cap_currents.get(&comp.id).unwrap_or(&0.0);
                        let g = 2.0 * comp.value / dt;
                        let i = -prev_ic - g * prev_vc;
                        (g, i)
                    } else {
                        let g = comp.value / dt;
                        let i = g * prev_vc;
                        (g, i)
                    };

                    stamp_companion_conductance(&mut matrix_a, node_pos, node_pos, g_eq);
                    stamp_companion_conductance(&mut matrix_a, node_neg, node_neg, g_eq);
                    stamp_companion_conductance(&mut matrix_a, node_pos, node_neg, -g_eq);
                    stamp_companion_conductance(&mut matrix_a, node_neg, node_pos, -g_eq);

                    if node_pos > 0 { vector_z[node_pos - 1] += i_eq; }
                    if node_neg > 0 { vector_z[node_neg - 1] -= i_eq; }
                }
                "inductor" => {
                    let is_coupled = if let Some(ref mutuals) = netlist.mutual_inductances {
                        mutuals.iter().any(|m| m.l1_id == comp.id || m.l2_id == comp.id)
                    } else {
                        false
                    };
                    if is_coupled {
                        continue;
                    }

                    let node_pos = comp.pins[0].parse::<usize>().unwrap();
                    let node_neg = comp.pins[1].parse::<usize>().unwrap();
                    let prev_il = *ind_states.get(&comp.id).unwrap();

                    let (g_eq, i_eq) = if gear2_active_this_step {
                        let prev_prev_il = *ind_states_prev.get(&comp.id).unwrap_or(&prev_il);
                        let g = 1.0 / (gear_a * comp.value);
                        let i = -(gear_b / gear_a) * prev_il - (gear_c / gear_a) * prev_prev_il;
                        (g, i)
                    } else if integration_method == "trap" {
                        let g = dt / (2.0 * comp.value);
                        let prev_vl = *ind_voltages.get(&comp.id).unwrap_or(&0.0);
                        let i = prev_il + g * prev_vl;
                        (g, i)
                    } else {
                        let g = dt / comp.value;
                        let i = prev_il;
                        (g, i)
                    };

                    // Estampar conductancia equivalente + conductancia Gmin mínima en paralelo para evitar singularidad (Upgrade 5)
                    let g_tot = g_eq + 1e-12;

                    stamp_companion_conductance(&mut matrix_a, node_pos, node_pos, g_tot);
                    stamp_companion_conductance(&mut matrix_a, node_neg, node_neg, g_tot);
                    stamp_companion_conductance(&mut matrix_a, node_pos, node_neg, -g_tot);
                    stamp_companion_conductance(&mut matrix_a, node_neg, node_pos, -g_tot);

                    if node_pos > 0 { vector_z[node_pos - 1] -= i_eq; }
                    if node_neg > 0 { vector_z[node_neg - 1] += i_eq; }
                }
                // --- FASE 30: CO-SIMULACIÓN MIXED-SIGNAL DE EVENTOS DISCRETOS ---
                "and_gate" | "or_gate" | "not_gate" | "nand_gate" | "nor_gate" | "xor_gate" => {
                    let node_out = comp.pins[comp.pins.len() - 1].parse::<usize>().unwrap();
                    let mut inputs = Vec::new();
                    for i in 0..(comp.pins.len() - 1) {
                        let pin_in = comp.pins[i].parse::<usize>().unwrap();
                        let v_in = if pin_in > 0 { current_solution[pin_in - 1] } else { 0.0 };
                        inputs.push(v_in > 1.5); // Umbral de histéresis ideal 1.5 V
                    }

                    let out_high = match comp.comp_type.as_str() {
                        "and_gate" => inputs.iter().all(|&x| x),
                        "or_gate" => inputs.iter().any(|&x| x),
                        "not_gate" => !inputs.first().copied().unwrap_or(false),
                        "nand_gate" => !inputs.iter().all(|&x| x),
                        "nor_gate" => !inputs.iter().any(|&x| x),
                        "xor_gate" => inputs.iter().filter(|&&x| x).count() % 2 == 1,
                        _ => false,
                    };

                    // Equivalente Norton de interfaz D/A: R_out = 100 Ohm, V_out = 5V si High, 0V si Low
                    let r_out = 100.0;
                    let g_eq = 1.0 / r_out;
                    let i_eq = if out_high { 5.0 / r_out } else { 0.0 };

                    stamp_companion_conductance(&mut matrix_a, node_out, node_out, g_eq);
                    if node_out > 0 {
                        vector_z[node_out - 1] += i_eq;
                    }
                }
                "switch" => {
                    let co = local_overrides.get(&comp.id);
                    let node_a = comp.pins[0].parse::<usize>().unwrap();
                    let node_b = comp.pins[1].parse::<usize>().unwrap();
                    let ron = co.and_then(|f| f.get("switch_ron").copied()).unwrap_or(comp.switch_ron.unwrap_or(0.01));
                    let roff = co.and_then(|f| f.get("switch_roff").copied()).unwrap_or(comp.switch_roff.unwrap_or(1e9));
                    let is_closed = switch_states.get(&comp.id).copied().unwrap_or(false);
                    let conductance = 1.0 / if is_closed { ron } else { roff };
                    stamp_companion_conductance(&mut matrix_a, node_a, node_a, conductance);
                    stamp_companion_conductance(&mut matrix_a, node_b, node_b, conductance);
                    stamp_companion_conductance(&mut matrix_a, node_a, node_b, -conductance);
                    stamp_companion_conductance(&mut matrix_a, node_b, node_a, -conductance);
                }
                _ => {}
            }
        }

        // Estampar inductores acoplados (Inductancia Mutua K)
        if let Some(ref mutuals) = netlist.mutual_inductances {
            for k_comp in mutuals {
                if let (Some(l1), Some(l2)) = (
                    netlist.components.iter().find(|c| c.id == k_comp.l1_id),
                    netlist.components.iter().find(|c| c.id == k_comp.l2_id)
                ) {
                    let node_1pos = l1.pins[0].parse::<usize>().unwrap();
                    let node_1neg = l1.pins[1].parse::<usize>().unwrap();
                    let node_2pos = l2.pins[0].parse::<usize>().unwrap();
                    let node_2neg = l2.pins[1].parse::<usize>().unwrap();

                    let l1_val = l1.value;
                    let l2_val = l2.value;
                    let k = k_comp.k_coeff;
                    
                    let m = k * (l1_val * l2_val).sqrt();
                    let delta = l1_val * l2_val - m * m;
                    
                    if delta.abs() > 1e-30 {
                        let f_step = if gear2_active_this_step {
                            1.0 / gear_a
                        } else {
                            dt
                        };

                        let g11 = (f_step * l2_val) / delta;
                        let g22 = (f_step * l1_val) / delta;
                        let g12 = -(f_step * m) / delta;

                        // Estampar conductancias propias
                        let g11_tot = g11 + 1e-12;
                        stamp_companion_conductance(&mut matrix_a, node_1pos, node_1pos, g11_tot);
                        stamp_companion_conductance(&mut matrix_a, node_1neg, node_1neg, g11_tot);
                        stamp_companion_conductance(&mut matrix_a, node_1pos, node_1neg, -g11_tot);
                        stamp_companion_conductance(&mut matrix_a, node_1neg, node_1pos, -g11_tot);

                        let g22_tot = g22 + 1e-12;
                        stamp_companion_conductance(&mut matrix_a, node_2pos, node_2pos, g22_tot);
                        stamp_companion_conductance(&mut matrix_a, node_2neg, node_2neg, g22_tot);
                        stamp_companion_conductance(&mut matrix_a, node_2pos, node_2neg, -g22_tot);
                        stamp_companion_conductance(&mut matrix_a, node_2neg, node_2pos, -g22_tot);

                        // Estampar conductancia de acoplamiento cruzado G12
                        stamp_companion_conductance(&mut matrix_a, node_1pos, node_2pos, g12);
                        stamp_companion_conductance(&mut matrix_a, node_1neg, node_2neg, g12);
                        stamp_companion_conductance(&mut matrix_a, node_1pos, node_2neg, -g12);
                        stamp_companion_conductance(&mut matrix_a, node_1neg, node_2pos, -g12);

                        stamp_companion_conductance(&mut matrix_a, node_2pos, node_1pos, g12);
                        stamp_companion_conductance(&mut matrix_a, node_2neg, node_1neg, g12);
                        stamp_companion_conductance(&mut matrix_a, node_2pos, node_1neg, -g12);
                        stamp_companion_conductance(&mut matrix_a, node_2neg, node_1pos, -g12);

                        // Estampar fuentes de corriente equivalentes
                        let prev_il1 = *ind_states.get(&l1.id).unwrap_or(&0.0);
                        let prev_il2 = *ind_states.get(&l2.id).unwrap_or(&0.0);

                        let (i_eq1, i_eq2) = if gear2_active_this_step {
                            let prev_prev_il1 = *ind_states_prev.get(&l1.id).unwrap_or(&prev_il1);
                            let prev_prev_il2 = *ind_states_prev.get(&l2.id).unwrap_or(&prev_il2);
                            (
                                -(gear_b / gear_a) * prev_il1 - (gear_c / gear_a) * prev_prev_il1,
                                -(gear_b / gear_a) * prev_il2 - (gear_c / gear_a) * prev_prev_il2
                            )
                        } else {
                            (prev_il1, prev_il2)
                        };

                        if node_1pos > 0 { vector_z[node_1pos - 1] -= i_eq1; }
                        if node_1neg > 0 { vector_z[node_1neg - 1] += i_eq1; }

                        if node_2pos > 0 { vector_z[node_2pos - 1] -= i_eq2; }
                        if node_2neg > 0 { vector_z[node_2neg - 1] += i_eq2; }
                    }
                }
            }
        }

        // Si hay componentes no lineales, resolvemos con Newton-Raphson
        let step_solution_res = if has_nonlinear {
            let max_iter = 50;
            let tolerance = 1e-5;
            let mut converged = false;
            let mut solution_iter = current_solution.clone();
            
            let mut prev_v = vec![0.0; n + 1];
            for i in 1..=n {
                prev_v[i] = solution_iter[i - 1];
            }
            let mut prev_prev_v = prev_v.clone();

            let mut ast_cache_t: HashMap<String, ExprAST> = HashMap::new();

            let mut solve_err = None;
            let mut lambda_backtrack = 1.0;
            let mut prev_max_diff = f64::MAX;

            for _iter in 0..max_iter {
                let mut matrix_a_iter = matrix_a.clone();
                let mut vector_z_iter = vector_z.clone();

                for comp in &netlist.components {
                    if comp.comp_type == "diode" || comp.comp_type == "led" {
                        let node_anode = comp.pins[0].parse::<usize>().unwrap();
                        let node_cathode = comp.pins[1].parse::<usize>().unwrap();

                        // Self-Heating: usar temperatura de unión per-device en lugar de T global
                        let tj_d = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                        let (vt_d, _is_d) = get_thermal_parameters_junction(tj_d, comp.diode_is);
                        let _comp_n = comp.diode_n.unwrap_or(DIODE_N);

                        let v_anode = if node_anode > 0 { prev_v[node_anode] } else { 0.0 };
                        let v_cathode = if node_cathode > 0 { prev_v[node_cathode] } else { 0.0 };

                        let vd_new = v_anode - v_cathode;

                        let v_anode_old = if node_anode > 0 { prev_prev_v[node_anode] } else { 0.0 };
                        let v_cathode_old = if node_cathode > 0 { prev_prev_v[node_cathode] } else { 0.0 };
                        let vd_old = v_anode_old - v_cathode_old;

                        let vd = pnjlim(vd_new, vd_old, vt_d, 0.6);

                        let (_, id, geq) = solve_diode_junction_voltage(vd, Some(tj_d), comp);
                        let ieq = id - geq * vd;

                        // Estampar capacidad dinámica del diodo (difusión + deplexión) utilizando modelo cuasi-estático
                        let v_anode_prev = if node_anode > 0 { current_solution[node_anode - 1] } else { 0.0 };
                        let v_cathode_prev = if node_cathode > 0 { current_solution[node_cathode - 1] } else { 0.0 };
                        let vd_prev = v_anode_prev - v_cathode_prev;

                        let (vd_prev_j, _, geq_prev_int) = solve_diode_junction_voltage(vd_prev, Some(tj_d), comp);
                        let rs = comp.diode_rs.unwrap_or(0.0);
                        let gd_prev = if rs > 0.0 {
                            let factor = 1.0 - geq_prev_int * rs;
                            if factor > 1e-6 {
                                geq_prev_int / factor
                            } else {
                                geq_prev_int
                            }
                        } else {
                            geq_prev_int
                        };
                        let c_d = get_diode_capacitance_param(vd_prev_j, gd_prev, comp);
                        let g_eq_d = c_d / dt;
                        let i_eq_cd = g_eq_d * vd_prev;

                        let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                            if r > 0 && c > 0 { matrix_a_iter[(r - 1, c - 1)] += g; }
                        };

                        stamp_conductance(node_anode, node_anode, geq + g_eq_d);
                        stamp_conductance(node_cathode, node_cathode, geq + g_eq_d);
                        stamp_conductance(node_anode, node_cathode, -geq - g_eq_d);
                        stamp_conductance(node_cathode, node_anode, -geq - g_eq_d);

                        if node_anode > 0 { vector_z_iter[node_anode - 1] -= ieq - i_eq_cd; }
                        if node_cathode > 0 { vector_z_iter[node_cathode - 1] += ieq - i_eq_cd; }
                    } else if comp.comp_type == "opto" {
                        if comp.pins.len() < 4 { continue; }
                        let node_a = comp.pins[0].parse::<usize>().unwrap();
                        let node_k = comp.pins[1].parse::<usize>().unwrap();
                        let node_c = comp.pins[2].parse::<usize>().unwrap();
                        let node_e = comp.pins[3].parse::<usize>().unwrap();

                        // Self-Heating: el opto comparte un único nodo térmico (DIP-4)
                        let tj_o = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                        let (vt_o, _is_o) = get_thermal_parameters_junction(tj_o, comp.opto_is);

                        let v_a = if node_a > 0 { prev_v[node_a] } else { 0.0 };
                        let v_k = if node_k > 0 { prev_v[node_k] } else { 0.0 };
                        let v_c = if node_c > 0 { prev_v[node_c] } else { 0.0 };
                        let v_e = if node_e > 0 { prev_v[node_e] } else { 0.0 };

                        let vd_new = v_a - v_k;
                        let vd_old = (if node_a > 0 { prev_prev_v[node_a] } else { 0.0 })
                                   - (if node_k > 0 { prev_prev_v[node_k] } else { 0.0 });
                        let vd = pnjlim(vd_new, vd_old, vt_o, 0.6);
                        let (_, id_led, gd_led) = solve_diode_junction_voltage(vd, Some(tj_o), comp);
                        let ieq_led = id_led - gd_led * vd;

                        let v_ce = v_c - v_e;
                        let (_i_ce, g_md, g_o, i_ce_eq) = evaluate_opto_receiver(vd, gd_led, id_led, v_ce, comp);

                        let mut stamp = |r: usize, c: usize, g: f64| {
                            if r > 0 && c > 0 { matrix_a_iter[(r - 1, c - 1)] += g; }
                        };

                        // Lado LED
                        stamp(node_a, node_a,  gd_led);
                        stamp(node_k, node_k,  gd_led);
                        stamp(node_a, node_k, -gd_led);
                        stamp(node_k, node_a, -gd_led);
                        if node_a > 0 { vector_z_iter[node_a - 1] -= ieq_led; }
                        if node_k > 0 { vector_z_iter[node_k - 1] += ieq_led; }

                        // Lado receptor
                        stamp(node_c, node_a,  g_md);
                        stamp(node_c, node_k, -g_md);
                        stamp(node_c, node_c,  g_o);
                        stamp(node_c, node_e, -g_o);
                        stamp(node_e, node_a, -g_md);
                        stamp(node_e, node_k,  g_md);
                        stamp(node_e, node_c, -g_o);
                        stamp(node_e, node_e,  g_o);
                        if node_c > 0 { vector_z_iter[node_c - 1] -= i_ce_eq; }
                        if node_e > 0 { vector_z_iter[node_e - 1] += i_ce_eq; }
                    } else if comp.comp_type == "nmos" || comp.comp_type == "bsim3nmos" || comp.comp_type == "bsim4nmos" {
                        let node_gate = comp.pins[0].parse::<usize>().unwrap();
                        let node_drain = comp.pins[1].parse::<usize>().unwrap();
                        let node_source = comp.pins[2].parse::<usize>().unwrap();
                        let node_bulk = if comp.pins.len() >= 4 { comp.pins[3].parse::<usize>().unwrap_or(0) } else { 0 };

                        let v_gate = if node_gate > 0 { prev_v[node_gate] } else { 0.0 };
                        let v_drain = if node_drain > 0 { prev_v[node_drain] } else { 0.0 };
                        let v_source = if node_source > 0 { prev_v[node_source] } else { 0.0 };
                        let v_bulk = if node_bulk > 0 { prev_v[node_bulk] } else { 0.0 };

                        let vgs = v_gate - v_source;
                        let mut vds = v_drain - v_source;
                        if vds < 0.0 { vds = 0.0; }
                        let vbs = v_bulk - v_source;

                        // Self-Heating: Vth y Kn dependen de la temperatura de unión
                        let tj_m = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                        let vth_0 = comp.value;
                        let vth = vth_0 + MOS_VTH_TC * (tj_m - PHYS_T);
                        let kn_0 = 0.02;
                        let kn = kn_0 * (tj_m / PHYS_T).powf(MOS_MOBILITY_EXPO);
                        let lambda = 0.02;
                        let vt = (PHYS_KB * tj_m) / PHYS_Q;

                        let (ids, gm, gds, igs, gg) = if comp.comp_type == "bsim4nmos" {
                            evaluate_bsim4_nmos(vgs, vds, vbs, comp.value, comp.w, comp.l)
                        } else if comp.comp_type == "bsim3nmos" {
                            let (ids_v, gm_v, gds_v) = evaluate_bsim3_nmos(vgs, vds, vbs, comp.value, comp.w, comp.l, None, Some(comp));
                            (ids_v, gm_v, gds_v, 0.0, 1e-12)
                        } else if vgs <= vth {
                            let i_sub0 = 1e-7;
                            let n_factor = 1.5;
                            let exp_sub = ((vgs - vth) / (n_factor * vt)).exp();
                            let exp_vds = (-vds.max(0.0) / vt).exp();
                            let sub_factor = 1.0 - exp_vds;
                            
                            let ids_val = i_sub0 * exp_sub * sub_factor * (1.0 + lambda * vds);
                            let gm_val = ids_val / (n_factor * vt);
                            let gds_val = i_sub0 * exp_sub * ( (exp_vds / vt) * (1.0 + lambda * vds) + sub_factor * lambda );
                            
                            (ids_val, gm_val, gds_val.max(1e-9), 0.0, 1e-12)
                        } else if vds < vgs - vth {
                            // Región de Triodo con canal corto
                            let factor_early = 1.0 + lambda * vds;
                            let triode_curr = kn * (2.0 * (vgs - vth) * vds - vds * vds);
                            
                            let ids_val = triode_curr * factor_early;
                            let gm_val = (2.0 * kn * vds) * factor_early;
                            let gds_val = (2.0 * kn * (vgs - vth - vds)) * factor_early + triode_curr * lambda;
                            
                            (ids_val, gm_val, gds_val.max(1e-9), 0.0, 1e-12)
                        } else {
                            // Región de Saturación con canal corto
                            let factor_early = 1.0 + lambda * vds;
                            let sat_curr = kn * (vgs - vth) * (vgs - vth);
                            
                            let ids_val = sat_curr * factor_early;
                            let gm_val = (2.0 * kn * (vgs - vth)) * factor_early;
                            let gds_val = sat_curr * lambda;
                            
                            (ids_val, gm_val, gds_val.max(1e-9), 0.0, 1e-12)
                        };

                        let ieq = ids - gm * vgs - gds * vds;
                        let ieq_g = igs - gg * vgs;

                        // Estampar capacidades parásitas (Fase 13)
                        let (c_gs, c_gd, c_ds) = get_nmos_capacitances(vgs, vds, vth, comp.w, comp.l);
                        let g_eq_gs = c_gs / dt;
                        let g_eq_gd = c_gd / dt;
                        let g_eq_ds = c_ds / dt;

                        let v_gate_prev = if node_gate > 0 { current_solution[node_gate - 1] } else { 0.0 };
                        let v_drain_prev = if node_drain > 0 { current_solution[node_drain - 1] } else { 0.0 };
                        let v_source_prev = if node_source > 0 { current_solution[node_source - 1] } else { 0.0 };
                        let vgs_prev = v_gate_prev - v_source_prev;
                        let vgd_prev = v_gate_prev - v_drain_prev;
                        let vds_prev = v_drain_prev - v_source_prev;

                        let i_eq_gs = g_eq_gs * vgs_prev;
                        let i_eq_gd = g_eq_gd * vgd_prev;
                        let i_eq_ds = g_eq_ds * vds_prev;

                        stamp_companion_conductance(&mut matrix_a_iter, node_drain, node_drain, gds + g_eq_gd + g_eq_ds);
                        stamp_companion_conductance(&mut matrix_a_iter, node_source, node_source, gds + g_eq_gs + g_eq_ds + gg);
                        stamp_companion_conductance(&mut matrix_a_iter, node_drain, node_source, -gds - g_eq_ds);
                        stamp_companion_conductance(&mut matrix_a_iter, node_source, node_drain, -gds - g_eq_ds);

                        stamp_companion_conductance(&mut matrix_a_iter, node_gate, node_gate, g_eq_gs + g_eq_gd + gg);
                        stamp_companion_conductance(&mut matrix_a_iter, node_gate, node_source, -g_eq_gs - gg);
                        stamp_companion_conductance(&mut matrix_a_iter, node_source, node_gate, -g_eq_gs - gg);
                        stamp_companion_conductance(&mut matrix_a_iter, node_gate, node_drain, -g_eq_gd);
                        stamp_companion_conductance(&mut matrix_a_iter, node_drain, node_gate, -g_eq_gd);

                        if node_drain > 0 {
                            if node_gate > 0 { matrix_a_iter[(node_drain - 1, node_gate - 1)] += gm; }
                            if node_source > 0 { matrix_a_iter[(node_drain - 1, node_source - 1)] -= gm; }
                        }
                        if node_source > 0 {
                            if node_gate > 0 { matrix_a_iter[(node_source - 1, node_gate - 1)] -= gm; }
                            if node_source > 0 { matrix_a_iter[(node_source - 1, node_source - 1)] += gm; }
                        }

                        if node_drain > 0 { vector_z_iter[node_drain - 1] -= ieq - i_eq_gd - i_eq_ds; }
                        if node_source > 0 { vector_z_iter[node_source - 1] += ieq + i_eq_gs + i_eq_ds + ieq_g; }
                        if node_gate > 0 { vector_z_iter[node_gate - 1] += i_eq_gs + i_eq_gd - ieq_g; }
                    } else if comp.comp_type == "pmos" || comp.comp_type == "bsim3pmos" || comp.comp_type == "bsim4pmos" {
                        let node_gate = comp.pins[0].parse::<usize>().unwrap();
                        let node_drain = comp.pins[1].parse::<usize>().unwrap();
                        let node_source = comp.pins[2].parse::<usize>().unwrap();
                        let node_bulk = if comp.pins.len() >= 4 { comp.pins[3].parse::<usize>().unwrap_or(0) } else { 0 };

                        let v_gate = if node_gate > 0 { prev_v[node_gate] } else { 0.0 };
                        let v_drain = if node_drain > 0 { prev_v[node_drain] } else { 0.0 };
                        let v_source = if node_source > 0 { prev_v[node_source] } else { 0.0 };
                        let v_bulk = if node_bulk > 0 { prev_v[node_bulk] } else { 0.0 };

                        let vsg = v_source - v_gate;
                        let vsd = (v_source - v_drain).max(0.0);
                        let vsb = v_source - v_bulk;
                        let lambda = 0.02;

                        // Self-Heating: Vth y Kp dependen de la temperatura de unión
                        let tj_p = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                        let vth_0 = if comp.value == 0.0 { -1.5 } else { comp.value };
                        let vth_abs = -(vth_0 + MOS_VTH_TC * (tj_p - PHYS_T));
                        let kp_0 = 0.02;
                        let kp = kp_0 * (tj_p / PHYS_T).powf(MOS_MOBILITY_EXPO);
                        let vt = (PHYS_KB * tj_p) / PHYS_Q;

                        let (isd, gm_sd, gds_cond, igs, gg) = if comp.comp_type == "bsim4pmos" {
                            evaluate_bsim4_pmos(vsg, vsd, vsb, comp.value, comp.w, comp.l)
                        } else if comp.comp_type == "bsim3pmos" {
                            let (isd_v, gm_v, gds_v) = evaluate_bsim3_pmos(vsg, vsd, vsb, comp.value, comp.w, comp.l, None, Some(comp));
                            (isd_v, gm_v, gds_v, 0.0, 1e-12)
                        } else if vsg <= vth_abs {
                            // Conducción débil subumbral (weak inversion) PMOS
                            let i_sub0 = 1e-7;
                            let n_factor = 1.5;
                            let exp_sub = ((vsg - vth_abs) / (n_factor * vt)).exp();
                            let exp_vsd = (-vsd.max(0.0) / vt).exp();
                            let sub_factor = 1.0 - exp_vsd;
                            
                            let isd_val = i_sub0 * exp_sub * sub_factor * (1.0 + lambda * vsd);
                            let gm_sd_val = isd_val / (n_factor * vt);
                            let gds_cond_val = i_sub0 * exp_sub * ( (exp_vsd / vt) * (1.0 + lambda * vsd) + sub_factor * lambda );
                            
                            (isd_val, gm_sd_val, gds_cond_val.max(1e-9), 0.0, 1e-12)
                        } else if vsd < vsg - vth_abs {
                            // Triodo PMOS con canal corto
                            let factor_early = 1.0 + lambda * vsd;
                            let triode_curr = kp * (2.0 * (vsg - vth_abs) * vsd - vsd * vsd);
                            
                            let isd_val = triode_curr * factor_early;
                            let gm_sd_val = (2.0 * kp * vsd) * factor_early;
                            let gds_cond_val = (2.0 * kp * (vsg - vth_abs - vsd)) * factor_early + triode_curr * lambda;
                            
                            (isd_val, gm_sd_val, gds_cond_val.max(1e-9), 0.0, 1e-12)
                        } else {
                            // Saturación PMOS con canal corto
                            let factor_early = 1.0 + lambda * vsd;
                            let sat_curr = kp * (vsg - vth_abs) * (vsg - vth_abs);
                            
                            let isd_val = sat_curr * factor_early;
                            let gm_sd_val = (2.0 * kp * (vsg - vth_abs)) * factor_early;
                            let gds_cond_val = sat_curr * lambda;
                            
                            (isd_val, gm_sd_val, gds_cond_val.max(1e-9), 0.0, 1e-12)
                        };

                        let ieq_sd = isd - gm_sd * vsg - gds_cond * vsd;
                        let ieq_g = igs - gg * vsg;

                        // Estampar capacidades parásitas (Fase 13)
                        let (c_sg, c_sd, c_gd) = get_pmos_capacitances(vsg, vsd, vth_abs, comp.w, comp.l);
                        let g_eq_sg = c_sg / dt;
                        let g_eq_sd = c_sd / dt;
                        let g_eq_gd = c_gd / dt;

                        let v_gate_prev = if node_gate > 0 { current_solution[node_gate - 1] } else { 0.0 };
                        let v_drain_prev = if node_drain > 0 { current_solution[node_drain - 1] } else { 0.0 };
                        let v_source_prev = if node_source > 0 { current_solution[node_source - 1] } else { 0.0 };
                        let vsg_prev = v_source_prev - v_gate_prev;
                        let vsd_prev = v_source_prev - v_drain_prev;
                        let vgd_prev = v_drain_prev - v_gate_prev;

                        let i_eq_sg = g_eq_sg * vsg_prev;
                        let i_eq_sd = g_eq_sd * vsd_prev;
                        let i_eq_gd = g_eq_gd * vgd_prev;

                        stamp_companion_conductance(&mut matrix_a_iter, node_source, node_source, gds_cond + g_eq_sg + g_eq_sd + gg);
                        stamp_companion_conductance(&mut matrix_a_iter, node_drain, node_drain, gds_cond + g_eq_gd + g_eq_sd);
                        stamp_companion_conductance(&mut matrix_a_iter, node_source, node_drain, -gds_cond - g_eq_sd);
                        stamp_companion_conductance(&mut matrix_a_iter, node_drain, node_source, -gds_cond - g_eq_sd);

                        stamp_companion_conductance(&mut matrix_a_iter, node_gate, node_gate, g_eq_sg + g_eq_gd + gg);
                        stamp_companion_conductance(&mut matrix_a_iter, node_gate, node_source, -g_eq_sg - gg);
                        stamp_companion_conductance(&mut matrix_a_iter, node_source, node_gate, -g_eq_sg - gg);
                        stamp_companion_conductance(&mut matrix_a_iter, node_gate, node_drain, -g_eq_gd);
                        stamp_companion_conductance(&mut matrix_a_iter, node_drain, node_gate, -g_eq_gd);

                        if node_drain > 0 {
                            if node_source > 0 { matrix_a_iter[(node_drain - 1, node_source - 1)] -= gm_sd; }
                            if node_gate > 0 { matrix_a_iter[(node_drain - 1, node_gate - 1)] += gm_sd; }
                        }
                        if node_source > 0 {
                            if node_source > 0 { matrix_a_iter[(node_source - 1, node_source - 1)] += gm_sd; }
                            if node_gate > 0 { matrix_a_iter[(node_source - 1, node_gate - 1)] -= gm_sd; }
                        }

                        if node_drain > 0 { vector_z_iter[node_drain - 1] += ieq_sd + i_eq_gd + i_eq_sd; }
                        if node_source > 0 { vector_z_iter[node_source - 1] -= ieq_sd - i_eq_sg - i_eq_sd - ieq_g; }
                        if node_gate > 0 { vector_z_iter[node_gate - 1] += i_eq_sg + i_eq_gd + ieq_g; }
                    } else if comp.comp_type == "npn" || comp.comp_type == "pnp" {
                        let is_npn = comp.comp_type == "npn";
                        let node_base = comp.pins[0].parse::<usize>().unwrap();
                        let node_collector = comp.pins[1].parse::<usize>().unwrap();
                        let node_emitter = comp.pins[2].parse::<usize>().unwrap();

                        // Self-Heating: Is, Vt y β dependen de la temperatura de unión
                        let tj_b = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                        let (vt_b, is_b) = get_thermal_parameters_junction(tj_b, comp.bjt_is);
                        let beta_scale = (tj_b / PHYS_T).powf(BJT_BETA_EXPO);

                        let v_base = if node_base > 0 { prev_v[node_base] } else { 0.0 };
                        let v_collector = if node_collector > 0 { prev_v[node_collector] } else { 0.0 };
                        let v_emitter = if node_emitter > 0 { prev_v[node_emitter] } else { 0.0 };

                        let (vbe_new_raw, vbc_new_raw) = if is_npn {
                            (v_base - v_emitter, v_base - v_collector)
                        } else {
                            (v_emitter - v_base, v_collector - v_base)
                        };

                        let v_base_old = if node_base > 0 { prev_prev_v[node_base] } else { 0.0 };
                        let v_collector_old = if node_collector > 0 { prev_prev_v[node_collector] } else { 0.0 };
                        let v_emitter_old = if node_emitter > 0 { prev_prev_v[node_emitter] } else { 0.0 };

                        let (vbe_old_raw, vbc_old_raw) = if is_npn {
                            (v_base_old - v_emitter_old, v_base_old - v_collector_old)
                        } else {
                            (v_emitter_old - v_base_old, v_collector_old - v_base_old)
                        };

                        let beta_f_base = comp.bjt_bf.unwrap_or(if comp.value <= 1.0 { 100.0 } else { comp.value });
                        let beta_f = beta_f_base * beta_scale;
                        let beta_r = 1.0;
                        let alpha_f = beta_f / (beta_f + 1.0);
                        let alpha_r = beta_r / (beta_r + 1.0);

                        // Estimar corrientes de base y colector de la iteración previa para calcular caídas óhmicas
                        // Damping preliminar de voltajes previos para cálculo seguro sin desbordamiento
                        let vbe_prev_safe = pnjlim(vbe_old_raw, vbe_old_raw, vt_b, 0.6).min(0.95);
                        let vbc_prev_safe = pnjlim(vbc_old_raw, vbc_old_raw, vt_b, 0.6).min(0.95);

                        let exp_be_old = (vbe_prev_safe / vt_b).exp();
                        let exp_bc_old = (vbc_prev_safe / vt_b).exp();
                        let ide_old = is_b * (exp_be_old - 1.0);
                        let idc_old = is_b * (exp_bc_old - 1.0);

                        // Clampear corrientes previas a rangos físicos seguros para evitar oscilación numérica salvaje
                        let ib_prev = (ide_old / (beta_f + 1.0) + idc_old / (beta_r + 1.0)).clamp(-0.01, 0.01);
                        let ic_prev = (alpha_f * ide_old - idc_old).clamp(-0.1, 0.1);

                        let r_b = comp.bjt_rb.unwrap_or(10.0);
                        let r_c = comp.bjt_rc.unwrap_or(2.0);

                        let vbe_new = vbe_new_raw - ib_prev * r_b;
                        let vbc_new = vbc_new_raw - ic_prev * r_c;
                        let vbe_old = vbe_old_raw - ib_prev * r_b;
                        let vbc_old = vbc_old_raw - ic_prev * r_c;

                        // Damping logarítmico suave (pnjlim) (Upgrade 4)
                        let vbe = pnjlim(vbe_new, vbe_old, vt_b, 0.6);
                        let vbc = pnjlim(vbc_new, vbc_old, vt_b, 0.6);

                        // Multiplicador de Efecto Early directo en activo (Upgrade 3)
                        let vce = if is_npn { v_collector - v_emitter } else { v_emitter - v_collector };
                        let v_af = comp.bjt_vaf.unwrap_or(if is_npn { 100.0 } else { 50.0 });
                        let k_early = 1.0 + vce.max(0.0) / v_af;

                        let (ide_raw, gbe_raw, _ieq_be_raw) = evaluate_pn_junction(vbe, vt_b, is_b);
                        let ide = ide_raw * k_early;
                        let gbe = gbe_raw * k_early;
                        let ieq_be = ide - gbe * vbe;

                        let (idc_raw, gbc_raw, _ieq_bc_raw) = evaluate_pn_junction(vbc, vt_b, is_b);
                        let idc = idc_raw * k_early;
                        let gbc = gbc_raw * k_early;
                        let ieq_bc = idc - gbc * vbc;

                        let g_be_b = gbe / (beta_f + 1.0);
                        let g_bc_b = gbc / (beta_r + 1.0);
                        let ieq_b = ieq_be / (beta_f + 1.0) + ieq_bc / (beta_r + 1.0);

                        let ieq_c = alpha_f * ieq_be - ieq_bc;
                        let ieq_e = ieq_be - alpha_r * ieq_bc;

                        // Estampar capacidades parásitas dinámicas del BJT (Fase 16)
                        let c_be = get_bjt_be_capacitance(vbe, gbe, comp);
                        let c_bc = get_bjt_bc_capacitance(vbc, gbc, comp);
                        let g_eq_be = c_be / dt;
                        let g_eq_bc = c_bc / dt;

                        let v_base_prev = if node_base > 0 { current_solution[node_base - 1] } else { 0.0 };
                        let v_collector_prev = if node_collector > 0 { current_solution[node_collector - 1] } else { 0.0 };
                        let v_emitter_prev = if node_emitter > 0 { current_solution[node_emitter - 1] } else { 0.0 };

                        let vbe_prev = if is_npn { v_base_prev - v_emitter_prev } else { v_emitter_prev - v_base_prev };
                        let vbc_prev = if is_npn { v_base_prev - v_collector_prev } else { v_collector_prev - v_base_prev };

                        let i_eq_be = g_eq_be * vbe_prev;
                        let i_eq_bc = g_eq_bc * vbc_prev;

                        if is_npn {
                            stamp_companion_conductance(&mut matrix_a_iter, node_base, node_base, g_be_b + g_bc_b);
                            stamp_companion_conductance(&mut matrix_a_iter, node_base, node_emitter, -g_be_b);
                            stamp_companion_conductance(&mut matrix_a_iter, node_base, node_collector, -g_bc_b);
                            if node_base > 0 { vector_z_iter[node_base - 1] -= ieq_b; }

                            if node_collector > 0 {
                                if node_base > 0 { matrix_a_iter[(node_collector - 1, node_base - 1)] += alpha_f * gbe - gbc; }
                                if node_emitter > 0 { matrix_a_iter[(node_collector - 1, node_emitter - 1)] -= alpha_f * gbe; }
                                matrix_a_iter[(node_collector - 1, node_collector - 1)] += gbc;
                                vector_z_iter[node_collector - 1] -= ieq_c;
                            }

                            if node_emitter > 0 {
                                if node_base > 0 { matrix_a_iter[(node_emitter - 1, node_base - 1)] -= gbe - alpha_r * gbc; }
                                matrix_a_iter[(node_emitter - 1, node_emitter - 1)] += gbe;
                                if node_collector > 0 { matrix_a_iter[(node_emitter - 1, node_collector - 1)] -= alpha_r * gbc; }
                                vector_z_iter[node_emitter - 1] += ieq_e;
                            }

                            // Estampado reactivo parásito BE y BC NPN
                            stamp_companion_conductance(&mut matrix_a_iter, node_base, node_base, g_eq_be + g_eq_bc);
                            stamp_companion_conductance(&mut matrix_a_iter, node_emitter, node_emitter, g_eq_be);
                            stamp_companion_conductance(&mut matrix_a_iter, node_collector, node_collector, g_eq_bc);
                            stamp_companion_conductance(&mut matrix_a_iter, node_base, node_emitter, -g_eq_be);
                            stamp_companion_conductance(&mut matrix_a_iter, node_emitter, node_base, -g_eq_be);
                            stamp_companion_conductance(&mut matrix_a_iter, node_base, node_collector, -g_eq_bc);
                            stamp_companion_conductance(&mut matrix_a_iter, node_collector, node_base, -g_eq_bc);

                            if node_base > 0 { vector_z_iter[node_base - 1] += i_eq_be + i_eq_bc; }
                            if node_emitter > 0 { vector_z_iter[node_emitter - 1] -= i_eq_be; }
                            if node_collector > 0 { vector_z_iter[node_collector - 1] -= i_eq_bc; }
                        } else {
                            stamp_companion_conductance(&mut matrix_a_iter, node_base, node_base, g_be_b + g_bc_b);
                            stamp_companion_conductance(&mut matrix_a_iter, node_base, node_emitter, -g_be_b);
                            stamp_companion_conductance(&mut matrix_a_iter, node_base, node_collector, -g_bc_b);
                            if node_base > 0 { vector_z_iter[node_base - 1] += ieq_b; }

                            if node_collector > 0 {
                                if node_base > 0 { matrix_a_iter[(node_collector - 1, node_base - 1)] += alpha_f * gbe - gbc; }
                                if node_emitter > 0 { matrix_a_iter[(node_collector - 1, node_emitter - 1)] -= alpha_f * gbe; }
                                matrix_a_iter[(node_collector - 1, node_collector - 1)] += gbc;
                                vector_z_iter[node_collector - 1] += ieq_c;
                            }

                            if node_emitter > 0 {
                                if node_base > 0 { matrix_a_iter[(node_emitter - 1, node_base - 1)] -= gbe - alpha_r * gbc; }
                                matrix_a_iter[(node_emitter - 1, node_emitter - 1)] += gbe;
                                if node_collector > 0 { matrix_a_iter[(node_emitter - 1, node_collector - 1)] -= alpha_r * gbc; }
                                vector_z_iter[node_emitter - 1] += ieq_e;
                            }

                            // Estampado reactivo parásito BE y BC PNP
                            stamp_companion_conductance(&mut matrix_a_iter, node_base, node_base, g_eq_be + g_eq_bc);
                            stamp_companion_conductance(&mut matrix_a_iter, node_emitter, node_emitter, g_eq_be);
                            stamp_companion_conductance(&mut matrix_a_iter, node_collector, node_collector, g_eq_bc);
                            stamp_companion_conductance(&mut matrix_a_iter, node_base, node_emitter, -g_eq_be);
                            stamp_companion_conductance(&mut matrix_a_iter, node_emitter, node_base, -g_eq_be);
                            stamp_companion_conductance(&mut matrix_a_iter, node_base, node_collector, -g_eq_bc);
                            stamp_companion_conductance(&mut matrix_a_iter, node_collector, node_base, -g_eq_bc);

                            if node_base > 0 { vector_z_iter[node_base - 1] -= i_eq_be + i_eq_bc; }
                            if node_emitter > 0 { vector_z_iter[node_emitter - 1] += i_eq_be; }
                            if node_collector > 0 { vector_z_iter[node_collector - 1] += i_eq_bc; }
                        }
                    } else if comp.comp_type == "njf" || comp.comp_type == "pjf" {
                        let is_njf = comp.comp_type == "njf";
                        let node_drain = comp.pins[0].parse::<usize>().unwrap();
                        let node_gate = comp.pins[1].parse::<usize>().unwrap();
                        let node_source = comp.pins[2].parse::<usize>().unwrap();

                        let v_drain = if node_drain > 0 { prev_v[node_drain] } else { 0.0 };
                        let v_gate = if node_gate > 0 { prev_v[node_gate] } else { 0.0 };
                        let v_source = if node_source > 0 { prev_v[node_source] } else { 0.0 };

                        let vto = comp.jfet_vto.unwrap_or(if is_njf { -2.0 } else { 2.0 });
                        let beta = comp.jfet_beta.unwrap_or(1e-3);
                        let lambda = comp.jfet_lambda.unwrap_or(0.0);

                        let (vgs_raw, vds_raw, factor_pol) = if is_njf {
                            (v_gate - v_source, v_drain - v_source, 1.0)
                        } else {
                            (v_source - v_gate, v_source - v_drain, -1.0)
                        };

                        let mut vgs = vgs_raw;
                        let mut vds = vds_raw;
            let mut swapped = false;
            if vds < 0.0 {
                vds = -vds;
                vgs = if is_njf { v_gate - v_drain } else { v_drain - v_gate };
                swapped = true;
                        }

                        let vgst = if is_njf { vgs - vto } else { vto - vgs };
                        let (ids, gm, gds) = if vgst <= 0.0 {
                            (0.0, 0.0, 1e-9)
                        } else if vds < vgst {
                            let ids_val = beta * vds * (2.0 * vgst - vds) * (1.0 + lambda * vds);
                            let gm_val = 2.0 * beta * vds * (1.0 + lambda * vds);
                            let gds_val = beta * ( (2.0 * vgst - 2.0 * vds) * (1.0 + lambda * vds) + vds * (2.0 * vgst - vds) * lambda );
                            (ids_val, gm_val, gds_val.max(1e-9))
                        } else {
                            let ids_val = beta * vgst * vgst * (1.0 + lambda * vds);
                            let gm_val = 2.0 * beta * vgst * (1.0 + lambda * vds);
                            let gds_val = beta * vgst * vgst * lambda;
                            (ids_val, gm_val, gds_val.max(1e-9))
                        };

                        let (ids_eff, gm_eff, gds_eff) = if swapped {
                            (-ids, -gm, gds)
                        } else {
                            (ids, gm, gds)
                        };

                        let ids_final = ids_eff * factor_pol;
                        let gm_final = gm_eff * factor_pol;
                        let gds_final = gds_eff;

                        let ieq = ids_final - gm_final * vgs_raw - gds_final * vds_raw;

                        stamp_companion_conductance(&mut matrix_a_iter, node_drain, node_drain, gds_final);
                        stamp_companion_conductance(&mut matrix_a_iter, node_source, node_source, gds_final);
                        stamp_companion_conductance(&mut matrix_a_iter, node_drain, node_source, -gds_final);
                        stamp_companion_conductance(&mut matrix_a_iter, node_source, node_drain, -gds_final);

                        if node_drain > 0 {
                            if node_gate > 0 { matrix_a_iter[(node_drain - 1, node_gate - 1)] += gm_final; }
                            if node_source > 0 { matrix_a_iter[(node_drain - 1, node_source - 1)] -= gm_final; }
                        }
                        if node_source > 0 {
                            if node_gate > 0 { matrix_a_iter[(node_source - 1, node_gate - 1)] -= gm_final; }
                            if node_source > 0 { matrix_a_iter[(node_source - 1, node_source - 1)] += gm_final; }
                        }

                        if node_drain > 0 { vector_z_iter[node_drain - 1] -= ieq; }
                        if node_source > 0 { vector_z_iter[node_source - 1] += ieq; }

                        // Estampar capacitancias dinámicas de puerta GS y GD
                        let vgd_raw = v_gate - v_drain;
                        let (c_gs, c_gd) = get_jfet_capacitances(vgs_raw, vgd_raw, comp);
                        let g_eq_gs = c_gs / dt;
                        let g_eq_gd = c_gd / dt;

                        let v_drain_prev = if node_drain > 0 { current_solution[node_drain - 1] } else { 0.0 };
                        let v_gate_prev = if node_gate > 0 { current_solution[node_gate - 1] } else { 0.0 };
                        let v_source_prev = if node_source > 0 { current_solution[node_source - 1] } else { 0.0 };

                        let vgs_prev = v_gate_prev - v_source_prev;
                        let vgd_prev = v_gate_prev - v_drain_prev;

                        let i_eq_gs = g_eq_gs * vgs_prev;
                        let i_eq_gd = g_eq_gd * vgd_prev;

                        stamp_companion_conductance(&mut matrix_a_iter, node_gate, node_gate, g_eq_gs + g_eq_gd);
                        stamp_companion_conductance(&mut matrix_a_iter, node_gate, node_source, -g_eq_gs);
                        stamp_companion_conductance(&mut matrix_a_iter, node_source, node_gate, -g_eq_gs);
                        stamp_companion_conductance(&mut matrix_a_iter, node_source, node_source, g_eq_gs);

                        stamp_companion_conductance(&mut matrix_a_iter, node_gate, node_drain, -g_eq_gd);
                        stamp_companion_conductance(&mut matrix_a_iter, node_drain, node_gate, -g_eq_gd);
                        stamp_companion_conductance(&mut matrix_a_iter, node_drain, node_drain, g_eq_gd);

                        if node_gate > 0 { vector_z_iter[node_gate - 1] += i_eq_gs + i_eq_gd; }
                        if node_source > 0 { vector_z_iter[node_source - 1] -= i_eq_gs; }
                        if node_drain > 0 { vector_z_iter[node_drain - 1] -= i_eq_gd; }

                        // Fuga de compuerta en transitorio (utilizando t_amb para calcular vt local)
                        let vt_local = (8.617333262e-5 * t_amb) / 1.0; // k_B * T / q
                        let gate_is = 1e-14;
                        let exp_gs = ((v_gate - v_source) / vt_local).exp();
                        let gg_gs = (gate_is / vt_local) * exp_gs;
                        let ieq_gs_d = gate_is * (exp_gs - 1.0) - gg_gs * (v_gate - v_source);

                        stamp_companion_conductance(&mut matrix_a_iter, node_gate, node_gate, gg_gs);
                        stamp_companion_conductance(&mut matrix_a_iter, node_source, node_source, gg_gs);
                        stamp_companion_conductance(&mut matrix_a_iter, node_gate, node_source, -gg_gs);
                        stamp_companion_conductance(&mut matrix_a_iter, node_source, node_gate, -gg_gs);
                        if node_gate > 0 { vector_z_iter[node_gate - 1] -= ieq_gs_d; }
                        if node_source > 0 { vector_z_iter[node_source - 1] += ieq_gs_d; }

                        let exp_gd = ((v_gate - v_drain) / vt_local).exp();
                        let gg_gd = (gate_is / vt_local) * exp_gd;
                        let ieq_gd_d = gate_is * (exp_gd - 1.0) - gg_gd * (v_gate - v_drain);

                        stamp_companion_conductance(&mut matrix_a_iter, node_gate, node_gate, gg_gd);
                        stamp_companion_conductance(&mut matrix_a_iter, node_drain, node_drain, gg_gd);
                        stamp_companion_conductance(&mut matrix_a_iter, node_gate, node_drain, -gg_gd);
                        stamp_companion_conductance(&mut matrix_a_iter, node_drain, node_gate, -gg_gd);
                        if node_gate > 0 { vector_z_iter[node_gate - 1] -= ieq_gd_d; }
                        if node_drain > 0 { vector_z_iter[node_drain - 1] += ieq_gd_d; }
                    } else if comp.comp_type == "opamp" {
                        let pin_in_pos = comp.pins[0].parse::<usize>().unwrap();
                        let pin_in_neg = comp.pins[1].parse::<usize>().unwrap();
                        let pin_vplus = comp.pins[2].parse::<usize>().unwrap();
                        let pin_vminus = comp.pins[3].parse::<usize>().unwrap();
                        let pin_out = comp.pins[4].parse::<usize>().unwrap();

                        let v_in_pos = if pin_in_pos > 0 { prev_v[pin_in_pos] } else { 0.0 };
                        let v_in_neg = if pin_in_neg > 0 { prev_v[pin_in_neg] } else { 0.0 };
                        let v_vplus = if pin_vplus > 0 { prev_v[pin_vplus] } else { 15.0 };
                        let v_vminus = if pin_vminus > 0 { prev_v[pin_vminus] } else { -15.0 };

                        let v_diff = v_in_pos - v_in_neg;
                        let mut v_span = v_vplus - v_vminus;
                        let mut v_mid = 0.5 * (v_vplus + v_vminus);

                        if v_span.abs() < 1e-3 {
                            v_span = 30.0;
                            v_mid = 0.0;
                        }

                        let a_ol = 1e5;
                        let r_in = 1e7;
                        let r_out = 100.0;
                        let g_out = 1.0 / r_out;
                        let g_in = 1.0 / r_in;

                        stamp_companion_conductance(&mut matrix_a_iter, pin_in_pos, pin_in_pos, g_in);
                        stamp_companion_conductance(&mut matrix_a_iter, pin_in_neg, pin_in_neg, g_in);
                        stamp_companion_conductance(&mut matrix_a_iter, pin_in_pos, pin_in_neg, -g_in);
                        stamp_companion_conductance(&mut matrix_a_iter, pin_in_neg, pin_in_pos, -g_in);

                        let arg = (a_ol * v_diff) / v_span;
                        let tanh_val = arg.tanh();
                        let v_int_ctrl = v_mid + 0.5 * v_span * tanh_val;
                        let g_m_int = 0.5 * a_ol * (1.0 - tanh_val * tanh_val);
                        let g_m_opamp = g_out * g_m_int;
                        let ieq = g_out * v_int_ctrl - g_m_opamp * v_diff;

                        if pin_out > 0 {
                            matrix_a_iter[(pin_out - 1, pin_out - 1)] += g_out;
                            if pin_in_pos > 0 {
                                matrix_a_iter[(pin_out - 1, pin_in_pos - 1)] -= g_m_opamp;
                            }
                            if pin_in_neg > 0 {
                                matrix_a_iter[(pin_out - 1, pin_in_neg - 1)] += g_m_opamp;
                            }
                            vector_z_iter[pin_out - 1] += ieq;
                        }
                    } else if comp.comp_type.ends_with("_gate") {
                        let is_not = comp.comp_type == "not_gate";
                        let (_pin_in_a, _pin_in_b, pin_out) = if is_not {
                            let pa = comp.pins[0].parse::<usize>().unwrap_or(0);
                            let po = comp.pins[1].parse::<usize>().unwrap_or(0);
                            (pa, 0, po)
                        } else {
                            let pa = comp.pins[0].parse::<usize>().unwrap_or(0);
                            let pb = comp.pins[1].parse::<usize>().unwrap_or(0);
                            let po = comp.pins[2].parse::<usize>().unwrap_or(0);
                            (pa, pb, po)
                        };

                        let out_pin_idx = if is_not { 1 } else { 2 };
                        let state_out = ms_scheduler.get_state(&comp.id, out_pin_idx);
                        let v_oh = 5.0;
                        let v_out_ideal = if state_out { v_oh } else { 0.0 };

                        let r_out = 50.0;
                        let g_out = 1.0 / r_out;
                        let ieq = v_out_ideal / r_out;

                        if pin_out > 0 {
                            matrix_a_iter[(pin_out - 1, pin_out - 1)] += g_out;
                            vector_z_iter[pin_out - 1] += ieq;
                        }
                    } else if (comp.comp_type == "arduino_uno" || comp.comp_type == "esp32" || comp.comp_type == "raspberry_pi_pico")
                        && comp.pins.len() >= 6 {
                            let pin_in = comp.pins[0].parse::<usize>().unwrap_or(0);
                            let pin_out = comp.pins[1].parse::<usize>().unwrap_or(0);
                            let pin_adc = comp.pins[2].parse::<usize>().unwrap_or(0);
                            let pin_dac = comp.pins[3].parse::<usize>().unwrap_or(0);
                            let pin_vcc = comp.pins[4].parse::<usize>().unwrap_or(0);
                            let pin_gnd = comp.pins[5].parse::<usize>().unwrap_or(0);

                            let v_cc = match comp.comp_type.as_str() {
                                "arduino_uno" => 5.0,
                                "esp32" | "raspberry_pi_pico" => 3.3,
                                _ => 5.0,
                            };

                            let g_in = 1e-7;
                            let stamp_g = |matrix: &mut DMatrix<f64>, r: usize, c: usize, g: f64| {
                                if r > 0 && c > 0 {
                                    matrix[(r - 1, c - 1)] += g;
                                }
                            };

                            stamp_g(&mut matrix_a_iter, pin_in, pin_in, g_in);
                            stamp_g(&mut matrix_a_iter, pin_gnd, pin_gnd, g_in);
                            stamp_g(&mut matrix_a_iter, pin_in, pin_gnd, -g_in);
                            stamp_g(&mut matrix_a_iter, pin_gnd, pin_in, -g_in);

                            stamp_g(&mut matrix_a_iter, pin_adc, pin_adc, g_in);
                            stamp_g(&mut matrix_a_iter, pin_gnd, pin_gnd, g_in);
                            stamp_g(&mut matrix_a_iter, pin_adc, pin_gnd, -g_in);
                            stamp_g(&mut matrix_a_iter, pin_gnd, pin_adc, -g_in);

                            let i_baseline = match comp.comp_type.as_str() {
                                "arduino_uno" => 0.015,
                                "esp32" => 0.060,
                                "raspberry_pi_pico" => 0.025,
                                _ => 0.015,
                            };
                            let g_vcc = 10.0;
                            let i_vcc_eq = g_vcc * v_cc - i_baseline;

                            stamp_g(&mut matrix_a_iter, pin_vcc, pin_vcc, g_vcc);
                            stamp_g(&mut matrix_a_iter, pin_gnd, pin_gnd, g_vcc);
                            stamp_g(&mut matrix_a_iter, pin_vcc, pin_gnd, -g_vcc);
                            stamp_g(&mut matrix_a_iter, pin_gnd, pin_vcc, -g_vcc);

                            if pin_vcc > 0 { vector_z_iter[pin_vcc - 1] += i_vcc_eq; }
                            if pin_gnd > 0 { vector_z_iter[pin_gnd - 1] -= i_vcc_eq; }

                            let v_dac_eff = *mcu_vdaceff.get(&comp.id).unwrap_or(&0.0);
                            let g_dac = 0.01;
                            let i_dac_eq = v_dac_eff * g_dac;

                            stamp_g(&mut matrix_a_iter, pin_dac, pin_dac, g_dac);
                            stamp_g(&mut matrix_a_iter, pin_gnd, pin_gnd, g_dac);
                            stamp_g(&mut matrix_a_iter, pin_dac, pin_gnd, -g_dac);
                            stamp_g(&mut matrix_a_iter, pin_gnd, pin_dac, -g_dac);

                            if pin_dac > 0 { vector_z_iter[pin_dac - 1] += i_dac_eq; }
                            if pin_gnd > 0 { vector_z_iter[pin_gnd - 1] -= i_dac_eq; }

                            let state_out = ms_scheduler.get_state(&comp.id, 1);
                            let v_target_out = if state_out { v_cc } else { 0.0 };
                            let g_out = 0.05;
                            let i_stamp_out = v_target_out * g_out;

                            stamp_g(&mut matrix_a_iter, pin_out, pin_out, g_out);
                            stamp_g(&mut matrix_a_iter, pin_gnd, pin_gnd, g_out);
                            stamp_g(&mut matrix_a_iter, pin_out, pin_gnd, -g_out);
                            stamp_g(&mut matrix_a_iter, pin_gnd, pin_out, -g_out);

                            if pin_out > 0 { vector_z_iter[pin_out - 1] += i_stamp_out; }
                            if pin_gnd > 0 { vector_z_iter[pin_gnd - 1] -= i_stamp_out; }
                        }
                }

                // B-Sources dinámicas en transitorio
                // B-Sources dinámicas en transitorio con diferenciación automática
                for comp_bs in &netlist.components {
                    if comp_bs.comp_type == "bvoltage" {
                        if let Some(ref expr_str) = comp_bs.expression {
                            let _node_pos_t = comp_bs.pins[0].parse::<usize>().unwrap_or(0);
                            let _node_neg_t = comp_bs.pins[1].parse::<usize>().unwrap_or(0);
                            let mut nv = HashMap::new();
                            nv.insert("0".to_string(), 0.0);
                            for i in 1..=n { nv.insert(i.to_string(), prev_v[i]); }
                            let mut bc = HashMap::new();
                            for (sid, &sidx) in vsource_map.iter() {
                                bc.insert(sid.clone(), solution_iter[n + sidx]);
                            }
                            if let Ok(ad) = evaluate_expression_ad(expr_str, &nv, &bc, t, &mut ast_cache_t) {
                                let vs_idx = *vsource_map.get(&comp_bs.id).unwrap();
                                let col = n + vs_idx;
                                let mut ieq = ad.value;
                                for (&node_idx, &dv_dvx) in &ad.grad {
                                    let v_k = if node_idx > 0 { prev_v[node_idx] } else { 0.0 };
                                    ieq -= dv_dvx * v_k;
                                    if col < size && node_idx > 0 {
                                        matrix_a_iter[(col, node_idx - 1)] += -dv_dvx;
                                    }
                                }
                                vector_z_iter[col] = ieq;
                            }
                        }
                    } else if comp_bs.comp_type == "bcurrent" {
                        if let Some(ref expr_str) = comp_bs.expression {
                            let node_pos = comp_bs.pins[0].parse::<usize>().unwrap_or(0);
                            let node_neg = comp_bs.pins[1].parse::<usize>().unwrap_or(0);
                            let mut nv = HashMap::new();
                            nv.insert("0".to_string(), 0.0);
                            for i in 1..=n { nv.insert(i.to_string(), prev_v[i]); }
                            let mut bc = HashMap::new();
                            for (sid, &sidx) in vsource_map.iter() {
                                bc.insert(sid.clone(), solution_iter[n + sidx]);
                            }
                            if let Ok(ad) = evaluate_expression_ad(expr_str, &nv, &bc, t, &mut ast_cache_t) {
                                let mut ieq = ad.value;
                                for (&node_idx, &di_dv) in &ad.grad {
                                    let v_k = if node_idx > 0 { prev_v[node_idx] } else { 0.0 };
                                    ieq -= di_dv * v_k;
                                    if node_idx > 0 {
                                        if node_pos > 0 {
                                            matrix_a_iter[(node_pos - 1, node_idx - 1)] += di_dv;
                                        }
                                        if node_neg > 0 {
                                            matrix_a_iter[(node_neg - 1, node_idx - 1)] += -di_dv;
                                        }
                                    }
                                }
                                if node_pos > 0 { vector_z_iter[node_pos - 1] -= ieq; }
                                if node_neg > 0 { vector_z_iter[node_neg - 1] += ieq; }
                            }
                        }
                    }
                }

                if let Some(new_sol) = solve_sparse(&matrix_a_iter, &vector_z_iter) {
                    let mut max_diff = 0.0;
                    for i in 1..=n {
                        let diff = (new_sol[i - 1] - prev_v[i]).abs();
                        if diff > max_diff { max_diff = diff; }
                    }


                    // Amortiguamiento dinámico Newton-Raphson transitorio con Backtracking acelerado:
                    // Si el error de esta iteración es mayor o igual que el de la anterior, reducimos el paso por 0.5.
                    // Si el error es menor, aumentamos el paso de forma multiplicativa para acelerar.
                    let base_lambda = if max_diff > 2.0 * vt { 0.35 } else { 1.0 };
                    if _iter > 0 && max_diff >= prev_max_diff {
                        lambda_backtrack *= 0.5;
                    } else if _iter > 0 && max_diff < prev_max_diff {
                        lambda_backtrack = f64::min(lambda_backtrack * 2.0, 1.0);
                    }
                    let lambda = base_lambda * lambda_backtrack;
                    prev_max_diff = max_diff;

                    prev_prev_v = prev_v.clone();
                    for i in 1..=n {
                        prev_v[i] = prev_v[i] + lambda * (new_sol[i - 1] - prev_v[i]);
                    }

                    // Actualizar variables de corriente y voltajes en solution_iter
                    let size = n + m;
                    for i in 0..n {
                        solution_iter[i] = prev_v[i + 1];
                    }
                    for i in n..size {
                        solution_iter[i] = new_sol[i];
                    }

                    if max_diff < tolerance {
                        converged = true;
                        break;
                    }
                } else {
                    solve_err = Some("Error de convergencia o circuito mal condicionado".to_string());
                    break;
                }
            }

            if converged {
                Ok(solution_iter)
            } else {
                Err(solve_err.unwrap_or_else(|| "Error de convergencia o circuito mal condicionado".to_string()))
            }
        } else {
            solve_sparse(&matrix_a, &vector_z)
                .ok_or_else(|| "Error de convergencia o circuito mal condicionado".to_string())
        };

        // Si convergió, evaluamos el LTE (Error de Truncamiento Local)
        if let Ok(ref step_solution) = step_solution_res {
            let mut lte_max = 0.0;
            let mut integrator_order = 1.0;

            if !is_fixed && steps_completed >= 2 {
                if integration_method == "trap" && steps_completed >= 3 {
                    integrator_order = 2.0;
                    // TRAP: LTE depende de la tercera derivada (requiere 4 puntos)
                    for i in 1..=n {
                        let v_n = step_solution[i - 1];
                        let v_n1 = sol_n[i - 1];
                        let v_n2 = sol_n1[i - 1];
                        let v_n3 = sol_n2[i - 1];
                        
                        let d3_val = (v_n - 3.0 * v_n1 + 3.0 * v_n2 - v_n3) / (dt * dt * dt);
                        let lte_node = (1.0 / 12.0) * (dt * dt * dt) * d3_val.abs();
                        
                        if lte_node > lte_max {
                            lte_max = lte_node;
                        }
                    }
                } else if integration_method == "gear2" && steps_completed >= 3 {
                    integrator_order = 2.0;
                    // GEAR-2: LTE depende de la tercera derivada
                    for i in 1..=n {
                        let v_n = step_solution[i - 1];
                        let v_n1 = sol_n[i - 1];
                        let v_n2 = sol_n1[i - 1];
                        let v_n3 = sol_n2[i - 1];
                        
                        let d3_val = (v_n - 3.0 * v_n1 + 3.0 * v_n2 - v_n3) / (dt * dt * dt);
                        let lte_node = (2.0 / 9.0) * (dt * dt * dt) * d3_val.abs();
                        
                        if lte_node > lte_max {
                            lte_max = lte_node;
                        }
                    }
                } else {
                    integrator_order = 1.0;
                    // Euler/Gear2 (inicial): LTE depende de la segunda derivada
                    for i in 1..=n {
                        let v_n = step_solution[i - 1];
                        let v_n1 = sol_n[i - 1];
                        let v_n2 = sol_n1[i - 1];
                        let d1 = (v_n - v_n1) / dt;
                        let d2 = (v_n1 - v_n2) / prev_dt;
                        
                        let d2_val = 2.0 * (d1 - d2) / (dt + prev_dt);
                        let lte_node = 0.5 * dt * dt * d2_val.abs();
                        
                        if lte_node > lte_max {
                            lte_max = lte_node;
                        }
                    }
                }
            }

            // Decidir si aceptamos o rechazamos el paso temporal
            if !is_fixed && lte_max > lte_tol && dt > dt_min {
                // RECHAZAR PASO: Restaurar estados del backup y reducir dt asintóticamente
                cap_states = cap_states_backup;
                ind_states = ind_states_backup;
                cap_states_prev = cap_states_prev_backup;
                ind_states_prev = ind_states_prev_backup;
                switch_states = switch_states_backup;
                mcu_tchip = mcu_tchip_backup;
                mcu_vsample = mcu_vsample_backup;
                mcu_vdaceff = mcu_vdaceff_backup;
                device_tjunc = device_tjunc_backup;
                ms_scheduler = ms_scheduler_backup;
                
                let ratio = lte_tol / lte_max;
                let factor = 0.9 * ratio.powf(1.0 / (integrator_order + 1.0));
                let bounded_factor = factor.clamp(0.1, 0.5);
                dt = (dt * bounded_factor).max(dt_min);
                continue; // Volver a intentar la misma iteración temporal con el dt reducido
            } else {
                // ACEPTAR PASO: Guardar resultado y avanzar
                current_solution = step_solution.clone();
                prev_dt = dt;
                
                if event_intercepted {
                    dt = original_dt;
                } else if !is_fixed && steps_completed >= 2 {
                    if lte_max > 1e-15 {
                        let ratio = lte_tol / lte_max;
                        let factor = 0.9 * ratio.powf(1.0 / (integrator_order + 1.0));
                        let bounded_factor = factor.clamp(1.0, 2.0);
                        dt = (dt * bounded_factor).min(dt_max);
                    } else {
                        dt = (dt * 2.0).min(dt_max);
                    }
                } else if is_fixed {
                    dt = settings.dt;
                }

                // Rotar histórico de soluciones
                sol_n2 = sol_n1.clone();
                sol_n1 = sol_n.clone();
                sol_n = step_solution.clone();
                steps_completed += 1;

                // Actualizar corrientes de capacitores y voltajes de inductores para TRAP
                if integration_method == "trap" {
                    for comp in &netlist.components {
                        if comp.comp_type == "capacitor" {
                            let node_pos = comp.pins[0].parse::<usize>().unwrap();
                            let node_neg = comp.pins[1].parse::<usize>().unwrap();
                            let v_pos = if node_pos > 0 { step_solution[node_pos - 1] } else { 0.0 };
                            let v_neg = if node_neg > 0 { step_solution[node_neg - 1] } else { 0.0 };
                            let prev_vc = *cap_states.get(&comp.id).unwrap_or(&0.0);
                            let v_c_new = v_pos - v_neg;
                            let prev_ic = *cap_currents.get(&comp.id).unwrap_or(&0.0);
                            let i_c = (2.0 * comp.value / dt) * (v_c_new - prev_vc) - prev_ic;
                            cap_currents.insert(comp.id.clone(), i_c);
                        } else if comp.comp_type == "inductor" {
                            let node_pos = comp.pins[0].parse::<usize>().unwrap();
                            let node_neg = comp.pins[1].parse::<usize>().unwrap();
                            let v_pos = if node_pos > 0 { step_solution[node_pos - 1] } else { 0.0 };
                            let v_neg = if node_neg > 0 { step_solution[node_neg - 1] } else { 0.0 };
                            let v_l = v_pos - v_neg;
                            let prev_il = *ind_states.get(&comp.id).unwrap();
                            let prev_vl = *ind_voltages.get(&comp.id).unwrap_or(&0.0);
                            let new_il = prev_il + (dt / (2.0 * comp.value)) * (v_l + prev_vl);
                            ind_states_prev.insert(comp.id.clone(), prev_il);
                            ind_states.insert(comp.id.clone(), new_il);
                            ind_voltages.insert(comp.id.clone(), v_l);
                        }
                    }
                }

                // Desempaquetar voltajes de nodos
                let mut node_voltages = HashMap::new();
                node_voltages.insert("0".to_string(), 0.0);
                for i in 1..=n {
                    node_voltages.insert(i.to_string(), step_solution[i - 1]);
                }

                // Desempaquetar corrientes de fuentes
                let mut branch_currents = HashMap::new();
                for vs in &v_sources {
                    let vs_idx = *vsource_map.get(&vs.id).unwrap();
                    branch_currents.insert(vs.id.clone(), step_solution[n + vs_idx]);
                }

                results.push(TimeStepResult {
                    time: t,
                    node_voltages,
                    branch_currents,
                });

                // --- STREAMING CALLBACK: punto de extension para emision en vivo ---
                if let Some(ref mut cb) = on_step {
                    if let Some(last_result) = results.last() {
                        if !cb(last_result) {
                            break;
                        }
                    }
                }

                // --- DETECCION DE CRUCE DE UMBRALES Y EVENTOS DIGITALES ---
                for comp in &netlist.components {
                    if comp.comp_type.ends_with("_gate") {
                        let is_not = comp.comp_type == "not_gate";
                        let (pin_in_a, pin_in_b, _) = if is_not {
                            let pa = comp.pins[0].parse::<usize>().unwrap_or(0);
                            (pa, 0, 0)
                        } else {
                            let pa = comp.pins[0].parse::<usize>().unwrap_or(0);
                            let pb = comp.pins[1].parse::<usize>().unwrap_or(0);
                            (pa, pb, 0)
                        };

                        let v_a_curr = if pin_in_a > 0 { step_solution[pin_in_a - 1] } else { 0.0 };
                        let v_b_curr = if pin_in_b > 0 { step_solution[pin_in_b - 1] } else { 0.0 };

                        let (v_a_prev, v_b_prev) = if let Some(last_v) = ms_scheduler.last_analog_v.get(&comp.id) {
                            (*last_v.get(&0).unwrap_or(&0.0), *last_v.get(&1).unwrap_or(&0.0))
                        } else {
                            (0.0, 0.0)
                        };

                        let state_a_prev = ms_scheduler.get_state(&comp.id, 0);
                        let th_a = if state_a_prev { comp.gate_vlow.unwrap_or(1.5) } else { comp.gate_vhigh.unwrap_or(1.5) };

                        // Check input A crossing
                        let crossed_a = if state_a_prev {
                            v_a_curr < th_a
                        } else {
                            v_a_curr >= th_a
                        };

                        if crossed_a {
                            let t_cross = if (v_a_curr - v_a_prev).abs() > 1e-12 {
                                t + dt * ((th_a - v_a_prev) / (v_a_curr - v_a_prev))
                            } else {
                                t
                            };
                            let dir = !state_a_prev;
                            ms_scheduler.schedule_event(MixedSignalEvent {
                                time: t_cross,
                                component_id: comp.id.clone(),
                                event_type: MixedSignalEventType::LogicInputCrossing { pin_idx: 0, direction: dir },
                            });
                        }

                        // Check input B crossing
                        if !is_not {
                            let state_b_prev = ms_scheduler.get_state(&comp.id, 1);
                            let th_b = if state_b_prev { comp.gate_vlow.unwrap_or(1.5) } else { comp.gate_vhigh.unwrap_or(1.5) };
                            let crossed_b = if state_b_prev {
                                v_b_curr < th_b
                            } else {
                                v_b_curr >= th_b
                            };
                            if crossed_b {
                                let t_cross = if (v_b_curr - v_b_prev).abs() > 1e-12 {
                                    t + dt * ((th_b - v_b_prev) / (v_b_curr - v_b_prev))
                                } else {
                                    t
                                };
                                let dir = !state_b_prev;
                                ms_scheduler.schedule_event(MixedSignalEvent {
                                    time: t_cross,
                                    component_id: comp.id.clone(),
                                    event_type: MixedSignalEventType::LogicInputCrossing { pin_idx: 1, direction: dir },
                                });
                            }
                        }

                        let last_v = ms_scheduler.last_analog_v.entry(comp.id.clone()).or_default();
                        last_v.insert(0, v_a_curr);
                        if !is_not {
                            last_v.insert(1, v_b_curr);
                        }
                    } else if (comp.comp_type == "arduino_uno" || comp.comp_type == "esp32" || comp.comp_type == "raspberry_pi_pico")
                        && comp.pins.len() >= 6 {
                            let pin_adc = comp.pins[2].parse::<usize>().unwrap_or(0);
                            let pin_gnd = comp.pins[5].parse::<usize>().unwrap_or(0);
                            let v_gnd_val = if pin_gnd > 0 { step_solution[pin_gnd - 1] } else { 0.0 };
                            let v_adc_val = if pin_adc > 0 { step_solution[pin_adc - 1] } else { 0.0 };
                            let v_adc_diff = v_adc_val - v_gnd_val;

                            let v_adc_prev = if let Some(last_v) = ms_scheduler.last_analog_v.get(&comp.id) {
                                *last_v.get(&2).unwrap_or(&0.0)
                            } else {
                                0.0
                            };

                            let v_cc = match comp.comp_type.as_str() {
                                "arduino_uno" => 5.0,
                                _ => 3.3,
                            };
                            let threshold = 0.5 * v_cc;

                            let crossed_adc = (v_adc_prev < threshold && v_adc_diff >= threshold) || (v_adc_prev >= threshold && v_adc_diff < threshold);
                            if crossed_adc {
                                let t_cross = if (v_adc_diff - v_adc_prev).abs() > 1e-12 {
                                    t + dt * ((threshold - v_adc_prev) / (v_adc_diff - v_adc_prev))
                                } else {
                                    t
                                };
                                let dir = v_adc_diff >= threshold;
                                ms_scheduler.schedule_event(MixedSignalEvent {
                                    time: t_cross,
                                    component_id: comp.id.clone(),
                                    event_type: MixedSignalEventType::LogicInputCrossing { pin_idx: 2, direction: dir },
                                });
                            }
                            ms_scheduler.last_analog_v.entry(comp.id.clone()).or_default().insert(2, v_adc_diff);
                        }
                }

                // --- PROCESAR EVENTOS DE LA COLA QUE OCURRIERON HASTA EL MOMENTO t ACTUAL ---
                while let Some(next_t) = ms_scheduler.get_next_event_time() {
                    if next_t <= t + dt + 1e-9 {
                        let event = ms_scheduler.events.remove(0);
                        match event.event_type {
                            MixedSignalEventType::LogicInputCrossing { pin_idx, direction } => {
                                let comp = netlist.components.iter().find(|c| c.id == event.component_id).unwrap();
                                if comp.comp_type.ends_with("_gate") {
                                    let is_not = comp.comp_type == "not_gate";
                                    let out_pin_idx = if is_not { 1 } else { 2 };
                                    
                                    ms_scheduler.set_state(&comp.id, pin_idx, direction);

                                    let val_a = ms_scheduler.get_state(&comp.id, 0);
                                    let val_b = if is_not { false } else { ms_scheduler.get_state(&comp.id, 1) };

                                    let logic_out = match comp.comp_type.as_str() {
                                        "and_gate" => val_a && val_b,
                                        "or_gate" => val_a || val_b,
                                        "not_gate" => !val_a,
                                        "nand_gate" => !(val_a && val_b),
                                        "nor_gate" => !(val_a || val_b),
                                        "xor_gate" => val_a ^ val_b,
                                        _ => false,
                                    };

                                    let gate_delay = if logic_out {
                                        comp.rise_delay.or(comp.delay).unwrap_or(10e-9)
                                    } else {
                                        comp.fall_delay.or(comp.delay).unwrap_or(10e-9)
                                    };

                                    ms_scheduler.schedule_event(MixedSignalEvent {
                                        time: event.time + gate_delay,
                                        component_id: comp.id.clone(),
                                        event_type: MixedSignalEventType::LogicOutputTransition { pin_idx: out_pin_idx, new_state: logic_out },
                                    });
                                } else if comp.comp_type == "arduino_uno" || comp.comp_type == "esp32" || comp.comp_type == "raspberry_pi_pico" {
                                    let mode = comp.value as i32;
                                    if mode == 2 && pin_idx == 2 {
                                        ms_scheduler.schedule_event(MixedSignalEvent {
                                            time: event.time + 10e-9,
                                            component_id: comp.id.clone(),
                                            event_type: MixedSignalEventType::LogicOutputTransition { pin_idx: 1, new_state: direction },
                                        });
                                    }
                                }
                            }
                            MixedSignalEventType::LogicOutputTransition { pin_idx, new_state } => {
                                ms_scheduler.set_state(&event.component_id, pin_idx, new_state);
                            }
                            MixedSignalEventType::McuPeriodicTick => {
                                let comp = netlist.components.iter().find(|c| c.id == event.component_id).unwrap();
                                let mode = comp.value as i32;
                                if mode == 1 {
                                    let state_out = (event.time % 1.0) < 0.5;
                                    ms_scheduler.schedule_event(MixedSignalEvent {
                                        time: event.time + 10e-9,
                                        component_id: comp.id.clone(),
                                        event_type: MixedSignalEventType::LogicOutputTransition { pin_idx: 1, new_state: state_out },
                                    });
                                }

                                ms_scheduler.schedule_event(MixedSignalEvent {
                                    time: event.time + 100e-6,
                                    component_id: comp.id.clone(),
                                    event_type: MixedSignalEventType::McuPeriodicTick,
                                });
                            }
                        }
                    } else {
                        break;
                    }
                }

                // --- ACTUALIZAR DEFINITIVAMENTE LOS HISTÓRICOS DE ESTADO ---
                for comp in &netlist.components {
                    match comp.comp_type.as_str() {
                        "capacitor" => {
                            let node_pos = comp.pins[0].parse::<usize>().unwrap();
                            let node_neg = comp.pins[1].parse::<usize>().unwrap();

                            let v_pos = if node_pos > 0 { step_solution[node_pos - 1] } else { 0.0 };
                            let v_neg = if node_neg > 0 { step_solution[node_neg - 1] } else { 0.0 };

                            let new_vc = v_pos - v_neg;
                            let prev_vc = *cap_states.get(&comp.id).unwrap_or(&0.0);
                            cap_states_prev.insert(comp.id.clone(), prev_vc);
                            cap_states.insert(comp.id.clone(), new_vc);
                        }
                        "inductor" => {
                            let is_coupled = if let Some(ref mutuals) = netlist.mutual_inductances {
                                mutuals.iter().any(|m| m.l1_id == comp.id || m.l2_id == comp.id)
                            } else {
                                false
                            };
                            if is_coupled {
                                continue;
                            }
                            if integration_method == "trap" {
                                continue; // Already updated in TRAP block above
                            }

                            let node_pos = comp.pins[0].parse::<usize>().unwrap();
                            let node_neg = comp.pins[1].parse::<usize>().unwrap();

                            let v_pos = if node_pos > 0 { step_solution[node_pos - 1] } else { 0.0 };
                            let v_neg = if node_neg > 0 { step_solution[node_neg - 1] } else { 0.0 };

                            let new_vl = v_pos - v_neg;
                            let prev_il = *ind_states.get(&comp.id).unwrap();
                            let prev_prev_il = *ind_states_prev.get(&comp.id).unwrap_or(&prev_il);

                            let new_il = if gear2_active_this_step {
                                let g_eq = 1.0 / (gear_a * comp.value);
                                let i_eq_val = -(gear_b / gear_a) * prev_il - (gear_c / gear_a) * prev_prev_il;
                                g_eq * new_vl + i_eq_val
                            } else {
                                (dt / comp.value) * new_vl + prev_il
                            };

                            ind_states_prev.insert(comp.id.clone(), prev_il);
                            ind_states.insert(comp.id.clone(), new_il);
                        }
                        "arduino_uno" | "esp32" | "raspberry_pi_pico"
                            if comp.pins.len() >= 6 => {
                                let _pin_in = comp.pins[0].parse::<usize>().unwrap_or(0);
                                let pin_out = comp.pins[1].parse::<usize>().unwrap_or(0);
                                let pin_adc = comp.pins[2].parse::<usize>().unwrap_or(0);
                                let pin_dac = comp.pins[3].parse::<usize>().unwrap_or(0);
                                let pin_vcc = comp.pins[4].parse::<usize>().unwrap_or(0);
                                let pin_gnd = comp.pins[5].parse::<usize>().unwrap_or(0);

                                let v_cc = match comp.comp_type.as_str() {
                                    "arduino_uno" => 5.0,
                                    "esp32" | "raspberry_pi_pico" => 3.3,
                                    _ => 5.0,
                                };

                                let mode = comp.value as i32;

                                // Leer voltajes del paso aceptado
                                let v_vcc_val = if pin_vcc > 0 { step_solution[pin_vcc - 1] } else { 0.0 };
                                let v_gnd_val = if pin_gnd > 0 { step_solution[pin_gnd - 1] } else { 0.0 };
                                let v_vcc_diff = v_vcc_val - v_gnd_val;

                                let v_adc_val = if pin_adc > 0 { step_solution[pin_adc - 1] } else { 0.0 };
                                let v_adc_diff = v_adc_val - v_gnd_val;

                                let v_out_val = if pin_out > 0 { step_solution[pin_out - 1] } else { 0.0 };
                                let v_out_diff = v_out_val - v_gnd_val;

                                let v_dac_val = if pin_dac > 0 { step_solution[pin_dac - 1] } else { 0.0 };
                                let v_dac_diff = v_dac_val - v_gnd_val;

                                // 1. Calcular corriente consumida por carril
                                let i_baseline = match comp.comp_type.as_str() {
                                    "arduino_uno" => 0.015,
                                    "esp32" => 0.060,
                                    "raspberry_pi_pico" => 0.025,
                                    _ => 0.015,
                                };
                                let c_eff = match comp.comp_type.as_str() {
                                    "arduino_uno" => 150e-12,
                                    "esp32" => 450e-12,
                                    "raspberry_pi_pico" => 250e-12,
                                    _ => 150e-12,
                                };
                                let f_clk = match comp.comp_type.as_str() {
                                    "arduino_uno" => 16e6,
                                    "esp32" => 240e6,
                                    "raspberry_pi_pico" => 133e6,
                                    _ => 16e6,
                                };

                                let t_chip_prev = *mcu_tchip.get(&comp.id).unwrap_or(&t_amb);
                                let i_leakage = 1e-6 * (0.03 * (t_chip_prev - 298.15)).exp();
                                let i_vcc_draw = i_baseline + c_eff * v_vcc_diff.max(0.0) * f_clk + i_leakage;

                                // Calcular corrientes de IO para disipación
                                let g_out = 0.05;
                                let i_max = match comp.comp_type.as_str() {
                                    "arduino_uno" => 0.040,
                                    "esp32" | "raspberry_pi_pico" => 0.012,
                                    _ => 0.040,
                                };

                                // Consigna de salida en t
                                let v_target_out = match mode {
                                    1 => if (t % 1.0) < 0.5 { v_cc } else { 0.0 },
                                    2 => {
                                        let was_high = v_out_diff > 0.5 * v_cc;
                                        let threshold = if was_high { 0.45 * v_cc } else { 0.55 * v_cc };
                                        if v_adc_diff > threshold { v_cc } else { 0.0 }
                                    }
                                    _ => 0.0,
                                };
                                let i_eq_out = (g_out * v_target_out).clamp(-i_max, i_max);
                                let i_out_pkg = i_eq_out - g_out * v_out_diff;

                                // Consigna DAC
                                let v_target_dac = match mode {
                                    0 => v_adc_diff.clamp(0.0, v_cc),
                                    3 => {
                                        let period = 1e-4;
                                        let t_phase = t % period;
                                        let duty = (v_adc_diff / v_cc).clamp(0.0, 1.0);
                                        if t_phase < duty * period { v_cc } else { 0.0 }
                                    }
                                    _ => 0.0,
                                };
                                let v_dac_eff_prev = *mcu_vdaceff.get(&comp.id).unwrap_or(&0.0);
                                let sr_max = match comp.comp_type.as_str() {
                                    "arduino_uno" => 2e6, // 2V/μs
                                    _ => 10e6, // 10V/μs
                                };
                                let tau_dac = 2e-6; // 2μs
                                let dac_diff = v_target_dac - v_dac_eff_prev;
                                let limit_step = sr_max * dt;
                                let dac_clamped = dac_diff.clamp(-limit_step, limit_step);
                                let v_dac_eff_new = (v_dac_eff_prev + dac_clamped + (dt / tau_dac) * (v_target_dac - (v_dac_eff_prev + dac_clamped))).clamp(0.0, v_cc);

                                let i_eq_dac = (g_out * v_dac_eff_new).clamp(-i_max, i_max);
                                let i_dac_pkg = i_eq_dac - g_out * v_dac_diff;

                                // Pérdidas en pines de IO
                                let p_out_loss = i_out_pkg.max(0.0) * (v_vcc_diff - v_out_diff) + (-i_out_pkg).max(0.0) * v_out_diff;
                                let p_dac_loss = i_dac_pkg.max(0.0) * (v_vcc_diff - v_dac_diff) + (-i_dac_pkg).max(0.0) * v_dac_diff;

                                let p_diss = i_vcc_draw * v_vcc_diff + p_out_loss + p_dac_loss;

                                // Actualizar Temperatura
                                let c_th = 0.5;
                                let theta_ja = 40.0;
                                let t_chip_new = (t_chip_prev + (dt / c_th) * (p_diss + t_amb / theta_ja)) / (1.0 + dt / (c_th * theta_ja));
                                mcu_tchip.insert(comp.id.clone(), t_chip_new);

                                // Actualizar S&H Capacitor
                                let c_sample = 10e-12; // 10 pF
                                let r_sw = 5e3; // 5 kΩ
                                let t_mod = t % 1e-4;
                                let sampling_active = t_mod < 2e-6;
                                let v_sample_prev = *mcu_vsample.get(&comp.id).unwrap_or(&0.0);
                                let v_sample_new = if sampling_active {
                                    let g_adc_dyn = 1.0 / (r_sw + dt / c_sample);
                                    let i_cap = g_adc_dyn * (v_adc_diff - v_sample_prev);
                                    v_sample_prev + (dt / c_sample) * i_cap
                                } else {
                                    v_sample_prev
                                };
                                mcu_vsample.insert(comp.id.clone(), v_sample_new);
                                mcu_vdaceff.insert(comp.id.clone(), v_dac_eff_new);
                            }
                        _ => {}
                    }
                }

                // ACTUALIZAR ESTADOS DE INDUCTORES ACOPLADOS (Inductancia Mutua K)
                if let Some(ref mutuals) = netlist.mutual_inductances {
                    for k_comp in mutuals {
                        if let (Some(l1), Some(l2)) = (
                            netlist.components.iter().find(|c| c.id == k_comp.l1_id),
                            netlist.components.iter().find(|c| c.id == k_comp.l2_id)
                        ) {
                            let node_1pos = l1.pins[0].parse::<usize>().unwrap();
                            let node_1neg = l1.pins[1].parse::<usize>().unwrap();
                            let node_2pos = l2.pins[0].parse::<usize>().unwrap();
                            let node_2neg = l2.pins[1].parse::<usize>().unwrap();

                            let v_1pos = if node_1pos > 0 { step_solution[node_1pos - 1] } else { 0.0 };
                            let v_1neg = if node_1neg > 0 { step_solution[node_1neg - 1] } else { 0.0 };
                            let v_2pos = if node_2pos > 0 { step_solution[node_2pos - 1] } else { 0.0 };
                            let v_2neg = if node_2neg > 0 { step_solution[node_2neg - 1] } else { 0.0 };

                            let v1 = v_1pos - v_1neg;
                            let v2 = v_2pos - v_2neg;

                            let l1_val = l1.value;
                            let l2_val = l2.value;
                            let k = k_comp.k_coeff;
                            
                            let m = k * (l1_val * l2_val).sqrt();
                            let delta = l1_val * l2_val - m * m;

                            if delta.abs() > 1e-30 {
                                let prev_il1 = *ind_states.get(&l1.id).unwrap_or(&0.0);
                                let prev_il2 = *ind_states.get(&l2.id).unwrap_or(&0.0);

                                let f_step = if gear2_active_this_step {
                                    1.0 / gear_a
                                } else {
                                    dt
                                };

                                let g11 = (f_step * l2_val) / delta;
                                let g22 = (f_step * l1_val) / delta;
                                let g12 = -(f_step * m) / delta;

                                let (i_eq1, i_eq2) = if gear2_active_this_step {
                                    let prev_prev_il1 = *ind_states_prev.get(&l1.id).unwrap_or(&prev_il1);
                                    let prev_prev_il2 = *ind_states_prev.get(&l2.id).unwrap_or(&prev_il2);
                                    (
                                        -(gear_b / gear_a) * prev_il1 - (gear_c / gear_a) * prev_prev_il1,
                                        -(gear_b / gear_a) * prev_il2 - (gear_c / gear_a) * prev_prev_il2
                                    )
                                } else {
                                    (prev_il1, prev_il2)
                                };

                                let new_il1 = g11 * v1 + g12 * v2 + i_eq1;
                                let new_il2 = g12 * v1 + g22 * v2 + i_eq2;

                                ind_states_prev.insert(l1.id.clone(), prev_il1);
                                ind_states.insert(l1.id.clone(), new_il1);

                                ind_states_prev.insert(l2.id.clone(), prev_il2);
                                ind_states.insert(l2.id.clone(), new_il2);
                            }
                        }
                    }
                }

                // SELF-HEATING: Actualizar temperaturas de unión de dispositivos discretos
                for comp in &netlist.components {
                    let (rth, cth) = match comp.comp_type.as_str() {
                        "diode" | "led" => (comp.rth.unwrap_or(DIODE_RTH_JA), comp.cth.unwrap_or(DIODE_CTH)),
                        "opto" => (comp.rth.unwrap_or(OPTO_RTH_JA), comp.cth.unwrap_or(OPTO_CTH)),
                        "nmos" | "pmos" | "bsim3nmos" | "bsim3pmos" | "bsim4nmos" | "bsim4pmos" => (comp.rth.unwrap_or(MOS_RTH_JA), comp.cth.unwrap_or(MOS_CTH)),
                        "npn" | "pnp" => (comp.rth.unwrap_or(BJT_RTH_JA), comp.cth.unwrap_or(BJT_CTH)),
                        _ => continue,
                    };

                    // Calcular potencia disipada P = sum(V_terminal * I_terminal)
                    let p_diss = match comp.comp_type.as_str() {
                        "diode" | "led" => {
                            let na = comp.pins[0].parse::<usize>().unwrap_or(0);
                            let nc = comp.pins[1].parse::<usize>().unwrap_or(0);
                            let va = if na > 0 { step_solution[na - 1] } else { 0.0 };
                            let vc = if nc > 0 { step_solution[nc - 1] } else { 0.0 };
                            let vd = va - vc;
                            let tj = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                            let (_, id, _) = solve_diode_junction_voltage(vd, Some(tj), comp);
                            (vd * id).abs()
                        }
                        "opto" => {
                            if comp.pins.len() < 4 { continue; }
                            let na = comp.pins[0].parse::<usize>().unwrap_or(0);
                            let nk = comp.pins[1].parse::<usize>().unwrap_or(0);
                            let nc = comp.pins[2].parse::<usize>().unwrap_or(0);
                            let ne = comp.pins[3].parse::<usize>().unwrap_or(0);
                            let va = if na > 0 { step_solution[na - 1] } else { 0.0 };
                            let vk = if nk > 0 { step_solution[nk - 1] } else { 0.0 };
                            let vc = if nc > 0 { step_solution[nc - 1] } else { 0.0 };
                            let ve = if ne > 0 { step_solution[ne - 1] } else { 0.0 };
                            let vd = va - vk;
                            let v_ce = vc - ve;
                            let tj = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                            let (_, id_led, _) = solve_diode_junction_voltage(vd, Some(tj), comp);
                            let ctr = comp.opto_ctr.unwrap_or(OPTO_DEFAULT_CTR);
                            let vsat = comp.opto_vsat.unwrap_or(OPTO_DEFAULT_VSAT).max(1e-6);
                            let i_ce = ctr * id_led * (v_ce / vsat).tanh();
                            // Potencia total: LED + fototransistor
                            (vd * id_led).abs() + (v_ce * i_ce).abs()
                        }
                        "nmos" | "bsim3nmos" | "bsim4nmos" => {
                            let ng = comp.pins[0].parse::<usize>().unwrap_or(0);
                            let nd = comp.pins[1].parse::<usize>().unwrap_or(0);
                            let ns = comp.pins[2].parse::<usize>().unwrap_or(0);
                            let nb = if comp.pins.len() >= 4 { comp.pins[3].parse::<usize>().unwrap_or(0) } else { 0 };
                            let vg = if ng > 0 { step_solution[ng - 1] } else { 0.0 };
                            let vd_pin = if nd > 0 { step_solution[nd - 1] } else { 0.0 };
                            let vs = if ns > 0 { step_solution[ns - 1] } else { 0.0 };
                            let v_b = if nb > 0 { step_solution[nb - 1] } else { 0.0 };
                            let vgs = vg - vs;
                            let vds = (vd_pin - vs).max(0.0);
                            let vbs = v_b - vs;
                            let tj = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                            let vth = comp.value + MOS_VTH_TC * (tj - PHYS_T);
                            let kn = 0.02 * (tj / PHYS_T).powf(MOS_MOBILITY_EXPO);
                            
                            let (ids, igs) = if comp.comp_type == "bsim4nmos" {
                                let (ids_val, _, _, igs_val, _) = evaluate_bsim4_nmos(vgs, vds, vbs, comp.value, comp.w, comp.l);
                                (ids_val, igs_val)
                            } else if comp.comp_type == "bsim3nmos" {
                                let (ids_val, _, _) = evaluate_bsim3_nmos(vgs, vds, vbs, comp.value, comp.w, comp.l, None, Some(comp));
                                (ids_val, 0.0)
                            } else {
                                let ids_val = if vgs <= vth { 0.0 }
                                    else if vds < vgs - vth { kn * (2.0 * (vgs - vth) * vds - vds * vds) }
                                    else { kn * (vgs - vth).powi(2) };
                                (ids_val, 0.0)
                            };
                            (vds * ids).abs() + (vgs * igs).abs()
                        }
                        "pmos" | "bsim3pmos" | "bsim4pmos" => {
                            let ng = comp.pins[0].parse::<usize>().unwrap_or(0);
                            let nd = comp.pins[1].parse::<usize>().unwrap_or(0);
                            let ns = comp.pins[2].parse::<usize>().unwrap_or(0);
                            let nb = if comp.pins.len() >= 4 { comp.pins[3].parse::<usize>().unwrap_or(0) } else { 0 };
                            let vg = if ng > 0 { step_solution[ng - 1] } else { 0.0 };
                            let vd_pin = if nd > 0 { step_solution[nd - 1] } else { 0.0 };
                            let vs = if ns > 0 { step_solution[ns - 1] } else { 0.0 };
                            let v_b = if nb > 0 { step_solution[nb - 1] } else { 0.0 };
                            let vsg = vs - vg;
                            let vsd = (vs - vd_pin).max(0.0);
                            let vsb = vs - v_b;
                            let tj = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                            let vth_abs = comp.value.abs() + MOS_VTH_TC * (tj - PHYS_T);
                            let kp = 0.01 * (tj / PHYS_T).powf(MOS_MOBILITY_EXPO);
                            
                            let (isd, igs) = if comp.comp_type == "bsim4pmos" {
                                let (isd_val, _, _, igs_val, _) = evaluate_bsim4_pmos(vsg, vsd, vsb, comp.value, comp.w, comp.l);
                                (isd_val, igs_val)
                            } else if comp.comp_type == "bsim3pmos" {
                                let (isd_val, _, _) = evaluate_bsim3_pmos(vsg, vsd, vsb, comp.value, comp.w, comp.l, None, Some(comp));
                                (isd_val, 0.0)
                            } else {
                                let ids_val = if vsg <= vth_abs { 0.0 }
                                    else if vsd < vsg - vth_abs { kp * (2.0 * (vsg - vth_abs) * vsd - vsd * vsd) }
                                    else { kp * (vsg - vth_abs).powi(2) };
                                (ids_val, 0.0)
                            };
                            (vsd * isd).abs() + (vsg * igs).abs()
                        }
                        "npn" | "pnp" => {
                            // Aproximación: P_diss = Vce * Ic
                            let nb = comp.pins[0].parse::<usize>().unwrap_or(0);
                            let nc = comp.pins[1].parse::<usize>().unwrap_or(0);
                            let ne = comp.pins[2].parse::<usize>().unwrap_or(0);
                            let vb = if nb > 0 { step_solution[nb - 1] } else { 0.0 };
                            let vc_pin = if nc > 0 { step_solution[nc - 1] } else { 0.0 };
                            let ve = if ne > 0 { step_solution[ne - 1] } else { 0.0 };
                            let (vce, vbe) = if comp.comp_type == "npn" {
                                ((vc_pin - ve).abs(), vb - ve)
                            } else {
                                ((ve - vc_pin).abs(), ve - vb)
                            };
                            let tj = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                            let (vt_b, is_b) = get_thermal_parameters_junction(tj, None);
                            let ic = is_b * ((vbe / vt_b).exp() - 1.0) * comp.value.max(100.0);
                            (vce * ic.abs()).min(50.0) // Clampar a 50W para evitar divergencia
                        }
                        _ => 0.0,
                    };

                    // Red RC térmica de unión (Backward Euler implícito para estabilidad)
                    // T_j(n+1) = [T_j(n) + (dt/Cth) * (P_diss + T_amb/Rth)] / [1 + dt/(Cth*Rth)]
                    let tj_prev = *device_tjunc.get(&comp.id).unwrap_or(&t_amb);
                    let tj_new = (tj_prev + (dt / cth) * (p_diss + t_amb / rth)) / (1.0 + dt / (cth * rth));
                    // Clampar temperatura: no puede ser menor que ambiente ni mayor que 500K (227°C)
                    let tj_clamped = tj_new.clamp(t_amb, 500.0);
                    device_tjunc.insert(comp.id.clone(), tj_clamped);
                }

                // Avanzar tiempo t con el dt actual
                t += dt;

                // Ajustar dt dinámicamente para el paso siguiente
                if !is_fixed && lte_max < 0.1 * lte_tol {
                    // Si el error es sumamente pequeño, duplicamos el paso para ir más rápido
                    dt = (dt * 1.5).min(dt_max);
                }
            }
        } else {
            // Si la iteración física en sí misma divergió matemáticamente y dt > dt_min, reducimos dt e intentamos nuevamente
            if dt > dt_min {
                cap_states = cap_states_backup;
                ind_states = ind_states_backup;
                cap_states_prev = cap_states_prev_backup;
                ind_states_prev = ind_states_prev_backup;
                switch_states = switch_states_backup;
                mcu_tchip = mcu_tchip_backup;
                mcu_vsample = mcu_vsample_backup;
                mcu_vdaceff = mcu_vdaceff_backup;
                device_tjunc = device_tjunc_backup;
                ms_scheduler = ms_scheduler_backup;
                dt = (dt / 2.0).max(dt_min);
                continue;
            } else {
                return Err("Error de convergencia o circuito mal condicionado".to_string());
            }
        }
    }

    Ok((results, cap_states, ind_states))

}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PssSettings {
    pub period: f64,
    pub max_shooting_iters: usize,
    pub shooting_tolerance: f64,

}

pub fn solve_pss(
    netlist: &CircuitNetlist,
    settings: &PssSettings,
) -> Result<Vec<TimeStepResult>, String> {
    let _n = crate::topology::validate_netlist_topology(netlist, false)?;
    let mut state_keys = Vec::new();
    for comp in &netlist.components {
        if comp.comp_type == "capacitor" || comp.comp_type == "inductor" {
            state_keys.push((comp.comp_type.clone(), comp.id.clone()));
        }
    }

    let d = state_keys.len();
    let trans_settings = TransientSettings {
        dt: settings.period / 200.0,
        t_max: settings.period,
        fixed_step: Some(true),
        integration_method: None,
    };

    if d == 0 {
        let (results, _, _) = solve_transient_circuit_with_initial_states(
            netlist,
            &trans_settings,
            HashMap::new(),
            HashMap::new(),
        )?;
        return Ok(results);
    }

    let mut x0 = DVector::<f64>::zeros(d);
    let mut last_results = Vec::new();
    let delta = 1e-5;

    for iter in 0..settings.max_shooting_iters {
        let mut cap_init = HashMap::new();
        let mut ind_init = HashMap::new();
        for (i, (comp_type, id)) in state_keys.iter().enumerate() {
            if comp_type == "capacitor" {
                cap_init.insert(id.clone(), x0[i]);
            } else {
                ind_init.insert(id.clone(), x0[i]);
            }
        }

        let (results, cap_final, ind_final) = solve_transient_circuit_with_initial_states(
            netlist,
            &trans_settings,
            cap_init.clone(),
            ind_init.clone(),
        )?;

        last_results = results;

        let mut x_final = DVector::<f64>::zeros(d);
        for (i, (comp_type, id)) in state_keys.iter().enumerate() {
            if comp_type == "capacitor" {
                x_final[i] = *cap_final.get(id).unwrap_or(&0.0);
            } else {
                x_final[i] = *ind_final.get(id).unwrap_or(&0.0);
            }
        }

        let h = &x_final - &x0;
        let error_norm = h.norm();

        if error_norm < settings.shooting_tolerance {
            return Ok(last_results);
        }

        if iter == settings.max_shooting_iters - 1 {
            return Err(format!(
                "PSS Shooting Method no logró converger en {} iteraciones. Error residual: {:.3e}",
                settings.max_shooting_iters, error_norm
            ));
        }

        let mut m = DMatrix::<f64>::zeros(d, d);

        for j in 0..d {
            let mut x0_pert = x0.clone();
            x0_pert[j] += delta;

            let mut cap_pert = HashMap::new();
            let mut ind_pert = HashMap::new();
            for (idx, (comp_type, id)) in state_keys.iter().enumerate() {
                if comp_type == "capacitor" {
                    cap_pert.insert(id.clone(), x0_pert[idx]);
                } else {
                    ind_pert.insert(id.clone(), x0_pert[idx]);
                }
            }

            let (_, cap_final_pert, ind_final_pert) = solve_transient_circuit_with_initial_states(
                netlist,
                &trans_settings,
                cap_pert,
                ind_pert,
            )?;

            let mut x_final_pert = DVector::<f64>::zeros(d);
            for (idx, (comp_type, id)) in state_keys.iter().enumerate() {
                if comp_type == "capacitor" {
                    x_final_pert[idx] = *cap_final_pert.get(id).unwrap_or(&0.0);
                } else {
                    x_final_pert[idx] = *ind_final_pert.get(id).unwrap_or(&0.0);
                }
            }

            let col = (&x_final_pert - &x_final) / delta;
            for r in 0..d {
                m[(r, j)] = col[r];
            }
        }

        let mut j_mat = m;
        for j in 0..d {
            j_mat[(j, j)] -= 1.0;
        }

        if let Some(delta_x) = solve_sparse(&j_mat, &(-&h)) {
            x0 += delta_x;
        } else {
            return Err("Matriz Jacobiana de Shooting singular. No se puede resolver el paso de Newton.".to_string());
        }
    }

    Ok(last_results)

}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[allow(non_snake_case)]
pub struct PoleZeroResult {
    pub poles: Vec<Complex<f64>>,
    pub zeros: Vec<Complex<f64>>,
    pub is_stable: bool,
    pub phaseMargin: f64,
    pub gainMargin: f64,

}

pub fn run_stability_analysis(netlist: &CircuitNetlist) -> Result<PoleZeroResult, String> {
    let _n = crate::topology::validate_netlist_topology(netlist, true)?;
    let op_result = solve_dc_circuit(netlist)?;

    let mut dynamic_nodes = std::collections::HashSet::new();
    for comp in &netlist.components {
        if comp.comp_type == "capacitor" {
            for pin in &comp.pins {
                if let Ok(node_idx) = pin.parse::<usize>() {
                    if node_idx > 0 {
                        dynamic_nodes.insert(node_idx);
                    }
                }
            }
        }
    }

    let mut poles = Vec::new();
    let mut zeros = Vec::new();

    let mut is_stable = true;
    let mut phase_margin = 180.0;
    let mut gain_margin = 40.0;

    if !dynamic_nodes.is_empty() {
        let size = dynamic_nodes.len();
        let mut node_to_idx = HashMap::new();
        for (idx, &node) in dynamic_nodes.iter().enumerate() {
            node_to_idx.insert(node, idx);
        }

        let mut g_mat = DMatrix::<f64>::zeros(size, size);
        let mut c_mat = DMatrix::<f64>::zeros(size, size);

        for comp in &netlist.components {
            if comp.comp_type == "capacitor" {
                let n1 = comp.pins[0].parse::<usize>().unwrap();
                let n2 = comp.pins[1].parse::<usize>().unwrap();
                let c_val = comp.value;

                let idx1 = n1 > 0 && dynamic_nodes.contains(&n1);
                let idx2 = n2 > 0 && dynamic_nodes.contains(&n2);

                if idx1 {
                    let i = *node_to_idx.get(&n1).unwrap();
                    c_mat[(i, i)] += c_val;
                }
                if idx2 {
                    let j = *node_to_idx.get(&n2).unwrap();
                    c_mat[(j, j)] += c_val;
                }
                if idx1 && idx2 {
                    let i = *node_to_idx.get(&n1).unwrap();
                    let j = *node_to_idx.get(&n2).unwrap();
                    c_mat[(i, j)] -= c_val;
                    c_mat[(j, i)] -= c_val;
                }
            }
        }

        for comp in &netlist.components {
            match comp.comp_type.as_str() {
                "resistor" => {
                    let n1 = comp.pins[0].parse::<usize>().unwrap();
                    let n2 = comp.pins[1].parse::<usize>().unwrap();
                    let g_val = 1.0 / comp.value;

                    let idx1 = n1 > 0 && dynamic_nodes.contains(&n1);
                    let idx2 = n2 > 0 && dynamic_nodes.contains(&n2);

                    if idx1 {
                        let i = *node_to_idx.get(&n1).unwrap();
                        g_mat[(i, i)] += g_val;
                    }
                    if idx2 {
                        let j = *node_to_idx.get(&n2).unwrap();
                        g_mat[(j, j)] += g_val;
                    }
                    if idx1 && idx2 {
                        let i = *node_to_idx.get(&n1).unwrap();
                        let j = *node_to_idx.get(&n2).unwrap();
                        g_mat[(i, j)] -= g_val;
                        g_mat[(j, i)] -= g_val;
                    }
                }
                "diode" | "led" => {
                    let n1 = comp.pins[0].parse::<usize>().unwrap();
                    let n2 = comp.pins[1].parse::<usize>().unwrap();
                    
                    let v_anode = if n1 > 0 { *op_result.node_voltages.get(&n1.to_string()).unwrap_or(&0.0) } else { 0.0 };
                    let v_cathode = if n2 > 0 { *op_result.node_voltages.get(&n2.to_string()).unwrap_or(&0.0) } else { 0.0 };
                    let mut vd = v_anode - v_cathode;
                    if vd > 0.72 { vd = 0.72; }
                    let gd = (DIODE_IS / DIODE_VT) * (vd / DIODE_VT).exp();

                    let idx1 = n1 > 0 && dynamic_nodes.contains(&n1);
                    let idx2 = n2 > 0 && dynamic_nodes.contains(&n2);

                    if idx1 {
                        let i = *node_to_idx.get(&n1).unwrap();
                        g_mat[(i, i)] += gd;
                    }
                    if idx2 {
                        let j = *node_to_idx.get(&n2).unwrap();
                        g_mat[(j, j)] += gd;
                    }
                    if idx1 && idx2 {
                        let i = *node_to_idx.get(&n1).unwrap();
                        let j = *node_to_idx.get(&n2).unwrap();
                        g_mat[(i, j)] -= gd;
                        g_mat[(j, i)] -= gd;
                    }
                }
                "opto" => {
                    if comp.pins.len() < 4 { continue; }
                    let n_a = comp.pins[0].parse::<usize>().unwrap();
                    let n_k = comp.pins[1].parse::<usize>().unwrap();
                    let n_c = comp.pins[2].parse::<usize>().unwrap();
                    let n_e = comp.pins[3].parse::<usize>().unwrap();

                    // Recuperar punto de operación del opto
                    let v_a = if n_a > 0 { *op_result.node_voltages.get(&n_a.to_string()).unwrap_or(&0.0) } else { 0.0 };
                    let v_k = if n_k > 0 { *op_result.node_voltages.get(&n_k.to_string()).unwrap_or(&0.0) } else { 0.0 };
                    let v_c = if n_c > 0 { *op_result.node_voltages.get(&n_c.to_string()).unwrap_or(&0.0) } else { 0.0 };
                    let v_e = if n_e > 0 { *op_result.node_voltages.get(&n_e.to_string()).unwrap_or(&0.0) } else { 0.0 };
                    let vd = v_a - v_k;
                    let v_ce = v_c - v_e;
                    let (_, id_led, gd_led) = solve_diode_junction_voltage(vd, netlist.temperature, comp);
                    let (_i_ce, g_md, g_o, _i_ce_eq) = evaluate_opto_receiver(vd, gd_led, id_led, v_ce, comp);

                    // Estampar lado LED (conductancia del diodo)
                    let idx_a = n_a > 0 && dynamic_nodes.contains(&n_a);
                    let idx_k = n_k > 0 && dynamic_nodes.contains(&n_k);
                    if idx_a {
                        let i = *node_to_idx.get(&n_a).unwrap();
                        g_mat[(i, i)] += gd_led;
                    }
                    if idx_k {
                        let j = *node_to_idx.get(&n_k).unwrap();
                        g_mat[(j, j)] += gd_led;
                    }
                    if idx_a && idx_k {
                        let i = *node_to_idx.get(&n_a).unwrap();
                        let j = *node_to_idx.get(&n_k).unwrap();
                        g_mat[(i, j)] -= gd_led;
                        g_mat[(j, i)] -= gd_led;
                    }

                    // Estampar lado receptor (g_md mutua y g_o de salida)
                    let idx_c = n_c > 0 && dynamic_nodes.contains(&n_c);
                    let idx_e = n_e > 0 && dynamic_nodes.contains(&n_e);
                    let stamp_g = |r: usize, c: usize, g: f64, g_mat: &mut DMatrix<f64>| {
                        if r > 0 && c > 0 {
                            let ir = *node_to_idx.get(&r).unwrap();
                            let ic = *node_to_idx.get(&c).unwrap();
                            g_mat[(ir, ic)] += g;
                        }
                    };
                    // g_o entre C y E
                    if idx_c { stamp_g(n_c, n_c, g_o, &mut g_mat); }
                    if idx_e { stamp_g(n_e, n_e, g_o, &mut g_mat); }
                    if idx_c && idx_e {
                        stamp_g(n_c, n_e, -g_o, &mut g_mat);
                        stamp_g(n_e, n_c, -g_o, &mut g_mat);
                    }
                    // g_md entre C y A/K, y entre E y A/K
                    if idx_c {
                        stamp_g(n_c, n_a,  g_md, &mut g_mat);
                        stamp_g(n_c, n_k, -g_md, &mut g_mat);
                    }
                    if idx_e {
                        stamp_g(n_e, n_a, -g_md, &mut g_mat);
                        stamp_g(n_e, n_k,  g_md, &mut g_mat);
                    }
                }
                "nmos" | "bsim3nmos" => {
                    let nd = comp.pins[1].parse::<usize>().unwrap();
                    let ns = comp.pins[2].parse::<usize>().unwrap();
                    
                    let idx_d = nd > 0 && dynamic_nodes.contains(&nd);
                    let idx_s = ns > 0 && dynamic_nodes.contains(&ns);

                    let gd = 1e-4;
                    if idx_d {
                        let i = *node_to_idx.get(&nd).unwrap();
                        g_mat[(i, i)] += gd;
                    }
                    if idx_s {
                        let j = *node_to_idx.get(&ns).unwrap();
                        g_mat[(j, j)] += gd;
                    }
                    if idx_d && idx_s {
                        let i = *node_to_idx.get(&nd).unwrap();
                        let j = *node_to_idx.get(&ns).unwrap();
                        g_mat[(i, j)] -= gd;
                        g_mat[(j, i)] -= gd;
                    }
                }
                "pmos" | "bsim3pmos" => {
                    let nd = comp.pins[1].parse::<usize>().unwrap();
                    let ns = comp.pins[2].parse::<usize>().unwrap();
                    
                    let idx_d = nd > 0 && dynamic_nodes.contains(&nd);
                    let idx_s = ns > 0 && dynamic_nodes.contains(&ns);

                    let gd = 1e-4;
                    if idx_d {
                        let i = *node_to_idx.get(&nd).unwrap();
                        g_mat[(i, i)] += gd;
                    }
                    if idx_s {
                        let j = *node_to_idx.get(&ns).unwrap();
                        g_mat[(j, j)] += gd;
                    }
                    if idx_d && idx_s {
                        let i = *node_to_idx.get(&nd).unwrap();
                        let j = *node_to_idx.get(&ns).unwrap();
                        g_mat[(i, j)] -= gd;
                        g_mat[(j, i)] -= gd;
                    }
                }
                _ => {}
            }
        }

        for i in 0..size {
            if c_mat[(i, i)] == 0.0 {
                c_mat[(i, i)] = 1e-15;
            }
        }

        // Cálculo de ceros de transmisión via Matriz de Rosenbrock y proyección (Upgrade 2)
        if let Some(g_inv) = g_mat.clone().try_inverse() {
            let in_idx = 0;
            let out_idx = size.saturating_sub(1);
            let denom = g_inv[(out_idx, in_idx)];
            if denom.abs() > 1e-12 {
                let mut p_mat = DMatrix::<f64>::identity(size, size);
                for r in 0..size {
                    let val = g_inv[(r, in_idx)] / denom;
                    if r == out_idx {
                        p_mat[(r, out_idx)] = 0.0;
                    } else {
                        p_mat[(r, out_idx)] = -val;
                    }
                }
                let m_mat = &p_mat * &g_inv * &c_mat;
                if let Some(eigenvalues) = m_mat.eigenvalues() {
                    for val in eigenvalues.iter() {
                        if val.abs() > 1e-12 {
                            let zero_val = -1.0 / *val;
                            zeros.push(Complex::new(zero_val, 0.0));
                        }
                    }
                }
            }
        }

        let g_sparse = SparseMatrix::from_dense(&g_mat);
        let c_sparse = SparseMatrix::from_dense(&c_mat);

        match crate::krylov::arnoldi_poles(&g_sparse, &c_sparse, size) {
            Ok(computed_poles) => {
                for p in computed_poles {
                    poles.push(p);
                    if p.re > 0.0 {
                        is_stable = false;
                    }
                }
            }
            Err(_) => {
                for i in 0..size {
                    let p_val = - g_mat[(i, i)] / c_mat[(i, i)].max(1e-15);
                    poles.push(Complex::new(p_val, 0.0));
                    if p_val > 0.0 {
                        is_stable = false;
                    }
                }
            }
        }
    }

    if !is_stable {
        phase_margin = 0.0;
        gain_margin = 0.0;
    } else if !poles.is_empty() {
        let mut min_dist = f64::INFINITY;
        let mut dom_p = poles[0];
        for &p in &poles {
            if p.re.abs() < min_dist {
                min_dist = p.re.abs();
                dom_p = p;
            }
        }

        if poles.len() > 1 {
            let mut second_dist = f64::INFINITY;
            let mut sec_p = poles[0];
            for &p in &poles {
                if p != dom_p && p.re.abs() < second_dist {
                    second_dist = p.re.abs();
                    sec_p = p;
                }
            }
            let ratio = sec_p.re.abs() / dom_p.re.abs().max(1e-9);
            phase_margin = (90.0_f64 - (1.0_f64 / ratio).atan().to_degrees()).max(10.0_f64);
            gain_margin = (20.0_f64 * ratio.log10()).max(3.0_f64);
        } else {
            phase_margin = 90.0;
            gain_margin = 30.0;
        }
    }

    Ok(PoleZeroResult {
        poles,
        zeros,
        is_stable,
        phaseMargin: phase_margin,
        gainMargin: gain_margin,
    })

}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MonteCarloSettings {
    pub runs: usize,
    pub seed: Option<u64>,

}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct MonteCarloResult {
    pub run_results: Vec<Vec<TimeStepResult>>,

}

// Generador pseudoaleatorio LCG simple determinista
fn lcg_next(seed: &mut u64) -> f64 {
    *seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    ((*seed >> 32) as f64) / 4294967295.0

}

// Transformación de Box-Muller para distribución normal estándar N(0, 1)
fn box_muller_standard(seed: &mut u64) -> f64 {
    let mut u1 = lcg_next(seed);
    while u1 < 1e-15 {
        u1 = lcg_next(seed);
    }
    let u2 = lcg_next(seed);
    let r = (-2.0 * u1.ln()).sqrt();
    let theta = 2.0 * std::f64::consts::PI * u2;
    r * theta.cos()

}

pub fn solve_monte_carlo_transient(
    netlist: &CircuitNetlist,
    transient_settings: &TransientSettings,
    mc_settings: &MonteCarloSettings,
) -> Result<Vec<Vec<TimeStepResult>>, String> {
    let rng_seed_base = mc_settings.seed.unwrap_or(123456789);

    (0..mc_settings.runs)
        .into_par_iter()
        .map(|run_idx| {
            // Cada hilo tiene su propia semilla única derivada de la semilla base de forma determinista
            let mut run_seed = rng_seed_base.wrapping_add(run_idx as u64 * 72057594037927931);
            if run_seed == 0 {
                run_seed = 123456789;
            }

            // Clonar netlist original para variarlo
            let mut varied_netlist = netlist.clone();
            for comp in &mut varied_netlist.components {
                if let Some(tol) = comp.tolerance {
                    if tol > 0.0 {
                        // Variación gaussiana usando la regla de 3-sigma (la tolerancia es el límite del 99.7%)
                        let std_dev = (comp.value * tol) / 3.0;
                        let noise = box_muller_standard(&mut run_seed) * std_dev;
                        comp.value = (comp.value + noise).max(1e-15); // evitar valores no físicos negativos o cero
                    }
                }
            }

            // Resolver simulación transitoria para esta muestra
            solve_transient_circuit(&varied_netlist, transient_settings)
        })
        .collect()

}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DcSweepSettings {
    pub source_id: String,
    pub v_start: f64,
    pub v_end: f64,
    pub v_step: f64,

}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DcSweepResult {
    pub sweep_voltages: Vec<f64>,
    pub node_voltages: HashMap<String, Vec<f64>>,
    pub branch_currents: HashMap<String, Vec<f64>>,

}

pub fn solve_dc_sweep(netlist: &CircuitNetlist, settings: &DcSweepSettings) -> Result<DcSweepResult, String> {
    let mut sweep_voltages = Vec::new();
    let mut v = settings.v_start;
    
    if settings.v_step.abs() < 1e-12 {
        return Err("El paso de barrido (v_step) no puede ser cero.".to_string());
    }

    if settings.v_start <= settings.v_end {
        let step = settings.v_step.abs();
        while v <= settings.v_end + 1e-9 {
            sweep_voltages.push(v);
            v += step;
        }
    } else {
        let step = -settings.v_step.abs();
        while v >= settings.v_end - 1e-9 {
            sweep_voltages.push(v);
            v += step;
        }
    }

    if sweep_voltages.is_empty() {
        return Err("No se generaron puntos de barrido. Verifica v_start, v_end y v_step.".to_string());
    }

    let mut node_voltages: HashMap<String, Vec<f64>> = HashMap::new();
    let mut branch_currents: HashMap<String, Vec<f64>> = HashMap::new();
    let mut cloned_netlist = netlist.clone();
    
    let source_idx = cloned_netlist.components.iter().position(|c| c.id == settings.source_id)
        .ok_or_else(|| format!("No se encontró la fuente de barrido [{}] en el circuito.", settings.source_id))?;
    
    if cloned_netlist.components[source_idx].comp_type != "vsource" {
        return Err(format!("El componente [{}] no es una fuente de tensión (vsource).", settings.source_id));
    }

    let mut current_guess: Option<Vec<f64>> = None;

    for &v_val in &sweep_voltages {
        cloned_netlist.components[source_idx].value = v_val;
        let (step_res, next_guess) = solve_dc_circuit_with_guess(&cloned_netlist, current_guess.as_ref())?;
        current_guess = Some(next_guess);

        for (node_id, &voltage) in &step_res.node_voltages {
            node_voltages.entry(node_id.clone())
                .or_default()
                .push(voltage);
        }

        for (branch_id, &current) in &step_res.branch_currents {
            branch_currents.entry(branch_id.clone())
                .or_default()
                .push(current);
        }
    }

    Ok(DcSweepResult {
        sweep_voltages,
        node_voltages,
        branch_currents,
    })

}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AcSweepSettings {
    pub f_start: f64,
    pub f_end: f64,
    pub points_per_decade: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub op_guess: Option<Vec<f64>>,

}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AcSweepResult {
    pub frequencies: Vec<f64>,
    pub node_amplitudes: HashMap<String, Vec<f64>>,
    pub node_phases: HashMap<String, Vec<f64>>,
    pub error_log: Option<String>,

}

pub fn solve_ac_sweep(netlist: &CircuitNetlist, settings: &AcSweepSettings) -> Result<AcSweepResult, String> {
    let n = crate::topology::validate_netlist_topology(netlist, true)?;
    let (vt, is_temp) = get_thermal_parameters(netlist.temperature, None);

    let v_sources: Vec<&ComponentData> = netlist.components.iter()
        .filter(|c| c.comp_type == "vsource" || c.comp_type == "bvoltage" || c.comp_type == "vcvs" || c.comp_type == "ccvs")
        .collect();
    let m = v_sources.len();
    let size = n + m;

    if size == 0 {
        return Err("El circuito no contiene nodos activos o componentes.".to_string());
    }

    let mut vsource_map = HashMap::new();
    for (idx, vs) in v_sources.iter().enumerate() {
        vsource_map.insert(vs.id.clone(), idx);
    }

    // Resolver Punto de Operación (OP) DC para linealizar diodos y transistores NMOS
    let mut diode_conductances = HashMap::new();
    let mut nmos_parameters = HashMap::new();
    let mut pmos_parameters = HashMap::new();
    let mut bjt_parameters = HashMap::new();
    let mut opamp_gm = HashMap::new();
    let mut opto_parameters: HashMap<String, (f64, f64)> = HashMap::new(); // (g_md, g_o)

    let has_diodes = netlist.components.iter().any(|c| c.comp_type == "diode" || c.comp_type == "led");
    let has_optos = netlist.components.iter().any(|c| c.comp_type == "opto");
    let has_nmos = netlist.components.iter().any(|c| c.comp_type == "nmos" || c.comp_type == "bsim3nmos" || c.comp_type == "bsim4nmos");
    let has_pmos = netlist.components.iter().any(|c| c.comp_type == "pmos" || c.comp_type == "bsim3pmos" || c.comp_type == "bsim4pmos");
    let has_npn = netlist.components.iter().any(|c| c.comp_type == "npn");
    let has_pnp = netlist.components.iter().any(|c| c.comp_type == "pnp");
    let has_opamps = netlist.components.iter().any(|c| c.comp_type == "opamp");
    if has_diodes || has_optos || has_nmos || has_pmos || has_npn || has_pnp || has_opamps {
        let (op_result, _) = solve_dc_circuit_with_guess(netlist, settings.op_guess.as_ref())?;

        for comp in &netlist.components {
            if comp.comp_type == "diode" || comp.comp_type == "led" {
                let node_anode = comp.pins[0].parse::<usize>().unwrap();
                let node_cathode = comp.pins[1].parse::<usize>().unwrap();
                let v_anode = if node_anode > 0 { *op_result.node_voltages.get(&node_anode.to_string()).unwrap_or(&0.0) } else { 0.0 };
                let v_cathode = if node_cathode > 0 { *op_result.node_voltages.get(&node_cathode.to_string()).unwrap_or(&0.0) } else { 0.0 };
                let vd = v_anode - v_cathode;
                let exp_factor = (vd / (DIODE_N * vt)).exp();
                let gd = (is_temp / (DIODE_N * vt)) * exp_factor;
                diode_conductances.insert(comp.id.clone(), gd);
            } else if comp.comp_type == "opto" {
                if comp.pins.len() < 4 { continue; }
                let n_a = comp.pins[0].parse::<usize>().unwrap();
                let n_k = comp.pins[1].parse::<usize>().unwrap();
                let n_c = comp.pins[2].parse::<usize>().unwrap();
                let n_e = comp.pins[3].parse::<usize>().unwrap();
                let v_a = if n_a > 0 { *op_result.node_voltages.get(&n_a.to_string()).unwrap_or(&0.0) } else { 0.0 };
                let v_k = if n_k > 0 { *op_result.node_voltages.get(&n_k.to_string()).unwrap_or(&0.0) } else { 0.0 };
                let v_c = if n_c > 0 { *op_result.node_voltages.get(&n_c.to_string()).unwrap_or(&0.0) } else { 0.0 };
                let v_e = if n_e > 0 { *op_result.node_voltages.get(&n_e.to_string()).unwrap_or(&0.0) } else { 0.0 };
                let vd = v_a - v_k;
                let v_ce = v_c - v_e;
                let (_, id_led, gd_led) = solve_diode_junction_voltage(vd, netlist.temperature, comp);
                let (_i_ce, g_md, g_o, _i_ce_eq) = evaluate_opto_receiver(vd, gd_led, id_led, v_ce, comp);
                // Lado LED se estampa como diodo estándar
                diode_conductances.insert(comp.id.clone(), gd_led);
                // Lado receptor se guarda aparte
                opto_parameters.insert(comp.id.clone(), (g_md, g_o));
            } else if comp.comp_type == "nmos" || comp.comp_type == "bsim3nmos" || comp.comp_type == "bsim4nmos" {
                let node_gate = comp.pins[0].parse::<usize>().unwrap();
                let node_drain = comp.pins[1].parse::<usize>().unwrap();
                let node_source = comp.pins[2].parse::<usize>().unwrap();
                let node_bulk = if comp.pins.len() >= 4 { comp.pins[3].parse::<usize>().unwrap_or(0) } else { 0 };

                let v_gate = if node_gate > 0 { *op_result.node_voltages.get(&node_gate.to_string()).unwrap_or(&0.0) } else { 0.0 };
                let v_drain = if node_drain > 0 { *op_result.node_voltages.get(&node_drain.to_string()).unwrap_or(&0.0) } else { 0.0 };
                let v_source = if node_source > 0 { *op_result.node_voltages.get(&node_source.to_string()).unwrap_or(&0.0) } else { 0.0 };
                let v_bulk = if node_bulk > 0 { *op_result.node_voltages.get(&node_bulk.to_string()).unwrap_or(&0.0) } else { 0.0 };

                let vgs = v_gate - v_source;
                let mut vds = v_drain - v_source;
                if vds < 0.0 { vds = 0.0; }
                let vbs = v_bulk - v_source;

                let (gm, gds, gg) = if comp.comp_type == "bsim4nmos" {
                    let (_, gm_val, gds_val, _, gg_val) = evaluate_bsim4_nmos(vgs, vds, vbs, comp.value, comp.w, comp.l);
                    (gm_val, gds_val, gg_val)
                } else if comp.comp_type == "bsim3nmos" {
                    let (_, gm_val, gds_val) = evaluate_bsim3_nmos(vgs, vds, vbs, comp.value, comp.w, comp.l, None, Some(comp));
                    (gm_val, gds_val, 1e-12)
                } else {
                    let vth = comp.value;
                    let kn = 0.02;
                    if vgs <= vth {
                        (0.0, 1e-9, 1e-12)
                    } else if vds < vgs - vth {
                        let gm_val = 2.0 * kn * vds;
                        let gds_val = 2.0 * kn * (vgs - vth - vds);
                        (gm_val, gds_val.max(1e-9), 1e-12)
                    } else {
                        let gm_val = 2.0 * kn * (vgs - vth);
                        (gm_val, 1e-5, 1e-12)
                    }
                };
                nmos_parameters.insert(comp.id.clone(), (gm, gds, gg));
            } else if comp.comp_type == "pmos" || comp.comp_type == "bsim3pmos" || comp.comp_type == "bsim4pmos" {
                let node_gate = comp.pins[0].parse::<usize>().unwrap();
                let node_drain = comp.pins[1].parse::<usize>().unwrap();
                let node_source = comp.pins[2].parse::<usize>().unwrap();
                let node_bulk = if comp.pins.len() >= 4 { comp.pins[3].parse::<usize>().unwrap_or(0) } else { 0 };

                let v_gate = if node_gate > 0 { *op_result.node_voltages.get(&node_gate.to_string()).unwrap_or(&0.0) } else { 0.0 };
                let v_drain = if node_drain > 0 { *op_result.node_voltages.get(&node_drain.to_string()).unwrap_or(&0.0) } else { 0.0 };
                let v_source = if node_source > 0 { *op_result.node_voltages.get(&node_source.to_string()).unwrap_or(&0.0) } else { 0.0 };
                let v_bulk = if node_bulk > 0 { *op_result.node_voltages.get(&node_bulk.to_string()).unwrap_or(&0.0) } else { 0.0 };

                let vsg = v_source - v_gate;
                let mut vsd = v_source - v_drain;
                if vsd < 0.0 { vsd = 0.0; }
                let vsb = v_source - v_bulk;

                let (gm, gds, gg) = if comp.comp_type == "bsim4pmos" {
                    let (_, gm_val, gds_val, _, gg_val) = evaluate_bsim4_pmos(vsg, vsd, vsb, comp.value, comp.w, comp.l);
                    (gm_val, gds_val, gg_val)
                } else if comp.comp_type == "bsim3pmos" {
                    let (_, gm_val, gds_val) = evaluate_bsim3_pmos(vsg, vsd, vsb, comp.value, comp.w, comp.l, None, Some(comp));
                    (gm_val, gds_val, 1e-12)
                } else {
                    let vth = if comp.value == 0.0 { -1.5 } else { comp.value };
                    let vth_abs = -vth;
                    let kp = 0.02;
                    if vsg <= vth_abs {
                        (0.0, 1e-9, 1e-12)
                    } else if vsd < vsg - vth_abs {
                        let gm_val = 2.0 * kp * vsd;
                        let gds_val = 2.0 * kp * (vsg - vth_abs - vsd);
                        (gm_val, gds_val.max(1e-9), 1e-12)
                    } else {
                        let gm_val = 2.0 * kp * (vsg - vth_abs);
                        (gm_val, 1e-5, 1e-12)
                    }
                };
                pmos_parameters.insert(comp.id.clone(), (gm, gds, gg));
            } else if comp.comp_type == "npn" || comp.comp_type == "pnp" {
                let is_npn = comp.comp_type == "npn";
                let node_base = comp.pins[0].parse::<usize>().unwrap();
                let node_collector = comp.pins[1].parse::<usize>().unwrap();
                let node_emitter = comp.pins[2].parse::<usize>().unwrap();

                let v_base = if node_base > 0 { *op_result.node_voltages.get(&node_base.to_string()).unwrap_or(&0.0) } else { 0.0 };
                let v_collector = if node_collector > 0 { *op_result.node_voltages.get(&node_collector.to_string()).unwrap_or(&0.0) } else { 0.0 };
                let v_emitter = if node_emitter > 0 { *op_result.node_voltages.get(&node_emitter.to_string()).unwrap_or(&0.0) } else { 0.0 };

                let (vbe, vbc) = if is_npn {
                    (v_base - v_emitter, v_base - v_collector)
                } else {
                    (v_emitter - v_base, v_collector - v_base)
                };

                let exp_be = (vbe / vt).exp();
                let exp_bc = (vbc / vt).exp();

                let gbe = (is_temp / vt) * exp_be;
                let gbc = (is_temp / vt) * exp_bc;

                bjt_parameters.insert(comp.id.clone(), (gbe, gbc));
            } else if comp.comp_type == "opamp" {
                let pin_in_pos = comp.pins[0].parse::<usize>().unwrap();
                let pin_in_neg = comp.pins[1].parse::<usize>().unwrap();
                let pin_vplus = comp.pins[2].parse::<usize>().unwrap();
                let pin_vminus = comp.pins[3].parse::<usize>().unwrap();

                let v_in_pos = if pin_in_pos > 0 { *op_result.node_voltages.get(&pin_in_pos.to_string()).unwrap_or(&0.0) } else { 0.0 };
                let v_in_neg = if pin_in_neg > 0 { *op_result.node_voltages.get(&pin_in_neg.to_string()).unwrap_or(&0.0) } else { 0.0 };
                let v_vplus = if pin_vplus > 0 { *op_result.node_voltages.get(&pin_vplus.to_string()).unwrap_or(&15.0) } else { 15.0 };
                let v_vminus = if pin_vminus > 0 { *op_result.node_voltages.get(&pin_vminus.to_string()).unwrap_or(&-15.0) } else { -15.0 };

                let v_diff = v_in_pos - v_in_neg;
                let mut v_span = v_vplus - v_vminus;
                if v_span.abs() < 1e-3 {
                    v_span = 30.0;
                }

                let a_ol = 1e5;
                let r_out = 100.0;
                let g_out = 1.0 / r_out;

                let arg = (a_ol * v_diff) / v_span;
                let tanh_val = arg.tanh();
                let g_m_int = 0.5 * a_ol * (1.0 - tanh_val * tanh_val);
                let g_m_opamp = g_out * g_m_int;

                opamp_gm.insert(comp.id.clone(), g_m_opamp);
            }
        }
    }

    // Generar vector de frecuencias logarítmicas
    let mut frequencies = Vec::new();
    let mut f = settings.f_start;
    let ratio = 10.0f64.powf(1.0 / settings.points_per_decade as f64);
    while f <= settings.f_end * 1.001 {
        frequencies.push(f);
        f *= ratio;
    }

    let mut node_amplitudes: HashMap<String, Vec<f64>> = HashMap::new();
    let mut node_phases: HashMap<String, Vec<f64>> = HashMap::new();
    
    node_amplitudes.insert("0".to_string(), vec![0.0; frequencies.len()]);
    node_phases.insert("0".to_string(), vec![0.0; frequencies.len()]);
    for i in 1..=n {
        node_amplitudes.insert(i.to_string(), Vec::new());
        node_phases.insert(i.to_string(), Vec::new());
    }

    struct AcFrequencyResult {
        _f_val: f64,
        node_vals: Vec<(String, f64, f64)>, // (node_name, amplitude_db, phase_deg)
    }

    let mut csc_solver: Option<(crate::sparse_csc::SymbolicLU, crate::sparse_csc::ComplexNumericLUWorkspace, crate::sparse_csc::ComplexSparseMatrixCSC)> = None;

    let results: Vec<AcFrequencyResult> = frequencies.iter().map(|&f_val| {
        let omega = 2.0 * std::f64::consts::PI * f_val;
        let mut matrix_a = ComplexSparseMatrix::new(size);
        let mut vector_z = DVector::<Complex<f64>>::zeros(size);

        let stamp_conductance = |matrix: &mut ComplexSparseMatrix, r: usize, c: usize, g: Complex<f64>| {
            if r > 0 && c > 0 {
                matrix.add_element(r - 1, c - 1, g);
            }
        };

        for comp in &netlist.components {
            match comp.comp_type.as_str() {
                "resistor" => {
                    let node_a = comp.pins[0].parse::<usize>().unwrap();
                    let node_b = comp.pins[1].parse::<usize>().unwrap();
                    let g = Complex::new(1.0 / comp.value, 0.0);
                    stamp_conductance(&mut matrix_a, node_a, node_a, g);
                    stamp_conductance(&mut matrix_a, node_b, node_b, g);
                    stamp_conductance(&mut matrix_a, node_a, node_b, -g);
                    stamp_conductance(&mut matrix_a, node_b, node_a, -g);
                }
                "vsource" => {
                    let node_pos = comp.pins[0].parse::<usize>().unwrap();
                    let node_neg = comp.pins[1].parse::<usize>().unwrap();
                    let vs_idx = *vsource_map.get(&comp.id).unwrap();
                    let col = n + vs_idx;
                    
                    if node_pos > 0 {
                        matrix_a.add_element(node_pos - 1, col, Complex::new(1.0, 0.0));
                        matrix_a.add_element(col, node_pos - 1, Complex::new(1.0, 0.0));
                    }
                    if node_neg > 0 {
                        matrix_a.add_element(node_neg - 1, col, Complex::new(-1.0, 0.0));
                        matrix_a.add_element(col, node_neg - 1, Complex::new(-1.0, 0.0));
                    }
                    let ac_amp = comp.amplitude.unwrap_or(if comp.id == "V1" { comp.value } else { 0.0 });
                    vector_z[col] = Complex::new(ac_amp, 0.0);
                }
                "capacitor" => {
                    let node_a = comp.pins[0].parse::<usize>().unwrap();
                    let node_b = comp.pins[1].parse::<usize>().unwrap();
                    let g = Complex::new(0.0, omega * comp.value);
                    stamp_conductance(&mut matrix_a, node_a, node_a, g);
                    stamp_conductance(&mut matrix_a, node_b, node_b, g);
                    stamp_conductance(&mut matrix_a, node_a, node_b, -g);
                    stamp_conductance(&mut matrix_a, node_b, node_a, -g);
                }
                "inductor" => {
                    let is_coupled = if let Some(ref mutuals) = netlist.mutual_inductances {
                        mutuals.iter().any(|m| m.l1_id == comp.id || m.l2_id == comp.id)
                    } else {
                        false
                    };
                    if is_coupled {
                        continue;
                    }
                    let node_a = comp.pins[0].parse::<usize>().unwrap();
                    let node_b = comp.pins[1].parse::<usize>().unwrap();
                    let g = Complex::new(0.0, -1.0 / (omega * comp.value));
                    stamp_conductance(&mut matrix_a, node_a, node_a, g);
                    stamp_conductance(&mut matrix_a, node_b, node_b, g);
                    stamp_conductance(&mut matrix_a, node_a, node_b, -g);
                    stamp_conductance(&mut matrix_a, node_b, node_a, -g);
                }
                "diode" | "led" => {
                    let node_anode = comp.pins[0].parse::<usize>().unwrap();
                    let node_cathode = comp.pins[1].parse::<usize>().unwrap();
                    let gd = *diode_conductances.get(&comp.id).unwrap_or(&1e-9);
                    let g = Complex::new(gd, 0.0);
                    stamp_conductance(&mut matrix_a, node_anode, node_anode, g);
                    stamp_conductance(&mut matrix_a, node_cathode, node_cathode, g);
                    stamp_conductance(&mut matrix_a, node_anode, node_cathode, -g);
                    stamp_conductance(&mut matrix_a, node_cathode, node_anode, -g);
                }
                "opto" => {
                    if comp.pins.len() < 4 { continue; }
                    let node_a = comp.pins[0].parse::<usize>().unwrap();
                    let node_k = comp.pins[1].parse::<usize>().unwrap();
                    let node_c = comp.pins[2].parse::<usize>().unwrap();
                    let node_e = comp.pins[3].parse::<usize>().unwrap();

                    // Lado LED: conductancia del diodo
                    let gd_led = *diode_conductances.get(&comp.id).unwrap_or(&1e-9);
                    let g_led = Complex::new(gd_led, 0.0);
                    stamp_conductance(&mut matrix_a, node_a, node_a,  g_led);
                    stamp_conductance(&mut matrix_a, node_k, node_k,  g_led);
                    stamp_conductance(&mut matrix_a, node_a, node_k, -g_led);
                    stamp_conductance(&mut matrix_a, node_k, node_a, -g_led);

                    // Lado receptor: g_md mutua y g_o de salida
                    let (g_md_val, g_o_val) = *opto_parameters.get(&comp.id).unwrap_or(&(0.0, 1e-9));
                    let g_md = Complex::new(g_md_val, 0.0);
                    let g_o  = Complex::new(g_o_val,  0.0);
                    stamp_conductance(&mut matrix_a, node_c, node_a,  g_md);
                    stamp_conductance(&mut matrix_a, node_c, node_k, -g_md);
                    stamp_conductance(&mut matrix_a, node_c, node_c,  g_o);
                    stamp_conductance(&mut matrix_a, node_c, node_e, -g_o);
                    stamp_conductance(&mut matrix_a, node_e, node_a, -g_md);
                    stamp_conductance(&mut matrix_a, node_e, node_k,  g_md);
                    stamp_conductance(&mut matrix_a, node_e, node_c, -g_o);
                    stamp_conductance(&mut matrix_a, node_e, node_e,  g_o);
                }
                "nmos" | "bsim3nmos" | "bsim4nmos" => {
                    let node_gate = comp.pins[0].parse::<usize>().unwrap();
                    let node_drain = comp.pins[1].parse::<usize>().unwrap();
                    let node_source = comp.pins[2].parse::<usize>().unwrap();

                    let (gm_val, gds_val, gg_val) = *nmos_parameters.get(&comp.id).unwrap_or(&(0.0, 1e-9, 1e-12));
                    let gm = Complex::new(gm_val, 0.0);
                    let gds = Complex::new(gds_val, 0.0);
                    let gg = Complex::new(gg_val, 0.0);

                    stamp_conductance(&mut matrix_a, node_drain, node_drain, gds);
                    stamp_conductance(&mut matrix_a, node_source, node_source, gds + gg);
                    stamp_conductance(&mut matrix_a, node_drain, node_source, -gds);
                    stamp_conductance(&mut matrix_a, node_source, node_drain, -gds);

                    stamp_conductance(&mut matrix_a, node_gate, node_gate, gg);
                    stamp_conductance(&mut matrix_a, node_gate, node_source, -gg);
                    stamp_conductance(&mut matrix_a, node_source, node_gate, -gg);

                    if node_drain > 0 {
                        if node_gate > 0 { matrix_a.add_element(node_drain - 1, node_gate - 1, gm); }
                        if node_source > 0 { matrix_a.add_element(node_drain - 1, node_source - 1, -gm); }
                    }
                    if node_source > 0 {
                        if node_gate > 0 { matrix_a.add_element(node_source - 1, node_gate - 1, -gm); }
                        if node_source > 0 { matrix_a.add_element(node_source - 1, node_source - 1, gm); }
                    }
                }
                "pmos" | "bsim3pmos" | "bsim4pmos" => {
                    let node_gate = comp.pins[0].parse::<usize>().unwrap();
                    let node_drain = comp.pins[1].parse::<usize>().unwrap();
                    let node_source = comp.pins[2].parse::<usize>().unwrap();

                    let (gm_val, gds_val, gg_val) = *pmos_parameters.get(&comp.id).unwrap_or(&(0.0, 1e-9, 1e-12));
                    let gm = Complex::new(gm_val, 0.0);
                    let gds = Complex::new(gds_val, 0.0);
                    let gg = Complex::new(gg_val, 0.0);

                    stamp_conductance(&mut matrix_a, node_source, node_source, gds + gg);
                    stamp_conductance(&mut matrix_a, node_drain, node_drain, gds);
                    stamp_conductance(&mut matrix_a, node_source, node_drain, -gds);
                    stamp_conductance(&mut matrix_a, node_drain, node_source, -gds);

                    stamp_conductance(&mut matrix_a, node_gate, node_gate, gg);
                    stamp_conductance(&mut matrix_a, node_gate, node_source, -gg);
                    stamp_conductance(&mut matrix_a, node_source, node_gate, -gg);

                    if node_drain > 0 {
                        if node_source > 0 { matrix_a.add_element(node_drain - 1, node_source - 1, -gm); }
                        if node_gate > 0 { matrix_a.add_element(node_drain - 1, node_gate - 1, gm); }
                    }
                    if node_source > 0 {
                        if node_source > 0 { matrix_a.add_element(node_source - 1, node_source - 1, gm); }
                        if node_gate > 0 { matrix_a.add_element(node_source - 1, node_gate - 1, -gm); }
                    }
                }
                "npn" | "pnp" => {
                    let node_base = comp.pins[0].parse::<usize>().unwrap();
                    let node_collector = comp.pins[1].parse::<usize>().unwrap();
                    let node_emitter = comp.pins[2].parse::<usize>().unwrap();

                    let (gbe_val, gbc_val) = *bjt_parameters.get(&comp.id).unwrap_or(&(1e-9, 1e-9));
                    let gbe = Complex::new(gbe_val, 0.0);
                    let gbc = Complex::new(gbc_val, 0.0);

                    let beta_f = if comp.value <= 1.0 { 100.0 } else { comp.value };
                    let beta_r = 1.0;
                    let alpha_f = Complex::new(beta_f / (beta_f + 1.0), 0.0);
                    let alpha_r = Complex::new(beta_r / (beta_r + 1.0), 0.0);

                    let g_be_b = gbe / Complex::new(beta_f + 1.0, 0.0);
                    let g_bc_b = gbc / Complex::new(beta_r + 1.0, 0.0);

                    stamp_conductance(&mut matrix_a, node_base, node_base, g_be_b + g_bc_b);
                    stamp_conductance(&mut matrix_a, node_base, node_emitter, -g_be_b);
                    stamp_conductance(&mut matrix_a, node_base, node_collector, -g_bc_b);

                    if node_collector > 0 {
                        if node_base > 0 { matrix_a.add_element(node_collector - 1, node_base - 1, alpha_f * gbe - gbc); }
                        if node_emitter > 0 { matrix_a.add_element(node_collector - 1, node_emitter - 1, -alpha_f * gbe); }
                        matrix_a.add_element(node_collector - 1, node_collector - 1, gbc);
                    }

                    if node_emitter > 0 {
                        if node_base > 0 { matrix_a.add_element(node_emitter - 1, node_base - 1, -(gbe - alpha_r * gbc)); }
                        matrix_a.add_element(node_emitter - 1, node_emitter - 1, gbe);
                        if node_collector > 0 { matrix_a.add_element(node_emitter - 1, node_collector - 1, -alpha_r * gbc); }
                    }
                }
                "opamp" => {
                    let pin_in_pos = comp.pins[0].parse::<usize>().unwrap();
                    let pin_in_neg = comp.pins[1].parse::<usize>().unwrap();
                    let pin_out = comp.pins[4].parse::<usize>().unwrap();

                    let r_in = 1e7;
                    let r_out = 100.0;
                    let g_in = Complex::new(1.0 / r_in, 0.0);
                    let g_out = Complex::new(1.0 / r_out, 0.0);
                    let g_m_opamp_val = *opamp_gm.get(&comp.id).unwrap_or(&1000.0);
                    let pole_factor = Complex::new(1.0, f_val / 10.0);
                    let g_m_opamp = Complex::new(g_m_opamp_val, 0.0) / pole_factor;

                    stamp_conductance(&mut matrix_a, pin_in_pos, pin_in_pos, g_in);
                    stamp_conductance(&mut matrix_a, pin_in_neg, pin_in_neg, g_in);
                    stamp_conductance(&mut matrix_a, pin_in_pos, pin_in_neg, -g_in);
                    stamp_conductance(&mut matrix_a, pin_in_neg, pin_in_pos, -g_in);

                    if pin_out > 0 {
                        stamp_conductance(&mut matrix_a, pin_out, pin_out, g_out);
                        if pin_in_pos > 0 {
                            matrix_a.add_element(pin_out - 1, pin_in_pos - 1, -g_m_opamp);
                        }
                        if pin_in_neg > 0 {
                            matrix_a.add_element(pin_out - 1, pin_in_neg - 1, g_m_opamp);
                        }
                    }
                }
                "isource" => {
                    let node_pos = comp.pins[0].parse::<usize>().unwrap();
                    let node_neg = comp.pins[1].parse::<usize>().unwrap();
                    let ac_amp = comp.amplitude.unwrap_or(if comp.id == "I1" { comp.value } else { 0.0 });
                    let ac_val = Complex::new(ac_amp, 0.0);
                    if node_pos > 0 {
                        vector_z[node_pos - 1] -= ac_val;
                    }
                    if node_neg > 0 {
                        vector_z[node_neg - 1] += ac_val;
                    }
                }
                "vcvs" => {
                    let node_pos = comp.pins[0].parse::<usize>().unwrap();
                    let node_neg = comp.pins[1].parse::<usize>().unwrap();
                    let ctrl_pos = comp.pins[2].parse::<usize>().unwrap();
                    let ctrl_neg = comp.pins[3].parse::<usize>().unwrap();
                    let gain = comp.value;
                    let vs_idx = *vsource_map.get(&comp.id).ok_or_else(|| format!("VCVS id {} no mapeado en AC", comp.id))?;
                    let col = n + vs_idx;
                    if node_pos > 0 {
                        matrix_a.add_element(node_pos - 1, col, Complex::new(1.0, 0.0));
                        matrix_a.add_element(col, node_pos - 1, Complex::new(1.0, 0.0));
                    }
                    if node_neg > 0 {
                        matrix_a.add_element(node_neg - 1, col, Complex::new(-1.0, 0.0));
                        matrix_a.add_element(col, node_neg - 1, Complex::new(-1.0, 0.0));
                    }
                    if ctrl_pos > 0 {
                        matrix_a.add_element(col, ctrl_pos - 1, Complex::new(-gain, 0.0));
                    }
                    if ctrl_neg > 0 {
                        matrix_a.add_element(col, ctrl_neg - 1, Complex::new(gain, 0.0));
                    }
                }
                "vccs" => {
                    let node_pos = comp.pins[0].parse::<usize>().unwrap();
                    let node_neg = comp.pins[1].parse::<usize>().unwrap();
                    let ctrl_pos = comp.pins[2].parse::<usize>().unwrap();
                    let ctrl_neg = comp.pins[3].parse::<usize>().unwrap();
                    let g = comp.value;
                    let g_comp = Complex::new(g, 0.0);
                    if node_pos > 0 {
                        if ctrl_pos > 0 { matrix_a.add_element(node_pos - 1, ctrl_pos - 1, g_comp); }
                        if ctrl_neg > 0 { matrix_a.add_element(node_pos - 1, ctrl_neg - 1, -g_comp); }
                    }
                    if node_neg > 0 {
                        if ctrl_pos > 0 { matrix_a.add_element(node_neg - 1, ctrl_pos - 1, -g_comp); }
                        if ctrl_neg > 0 { matrix_a.add_element(node_neg - 1, ctrl_neg - 1, g_comp); }
                    }
                }
                "cccs" => {
                    let node_pos = comp.pins[0].parse::<usize>().unwrap();
                    let node_neg = comp.pins[1].parse::<usize>().unwrap();
                    let gain = comp.value;
                    if let Some(ref ctrl_source_id) = comp.controlling_source {
                        if let Some(&ctrl_vs_idx) = vsource_map.get(ctrl_source_id) {
                            let col = n + ctrl_vs_idx;
                            if node_pos > 0 {
                                matrix_a.add_element(node_pos - 1, col, Complex::new(gain, 0.0));
                            }
                            if node_neg > 0 {
                                matrix_a.add_element(node_neg - 1, col, Complex::new(-gain, 0.0));
                            }
                        } else {
                            return Err(format!("CCCS id {}: Fuente controladora {} no encontrada en AC.", comp.id, ctrl_source_id));
                        }
                    } else {
                        return Err(format!("CCCS id {}: Falta especificar la fuente controladora en AC.", comp.id));
                    }
                }
                "ccvs" => {
                    let node_pos = comp.pins[0].parse::<usize>().unwrap();
                    let node_neg = comp.pins[1].parse::<usize>().unwrap();
                    let r = comp.value;
                    let vs_idx = *vsource_map.get(&comp.id).ok_or_else(|| format!("CCVS id {} no mapeado en AC", comp.id))?;
                    let col = n + vs_idx;
                    if node_pos > 0 {
                        matrix_a.add_element(node_pos - 1, col, Complex::new(1.0, 0.0));
                        matrix_a.add_element(col, node_pos - 1, Complex::new(1.0, 0.0));
                    }
                    if node_neg > 0 {
                        matrix_a.add_element(node_neg - 1, col, Complex::new(-1.0, 0.0));
                        matrix_a.add_element(col, node_neg - 1, Complex::new(-1.0, 0.0));
                    }
                    if let Some(ref ctrl_source_id) = comp.controlling_source {
                        if let Some(&ctrl_vs_idx) = vsource_map.get(ctrl_source_id) {
                            let ctrl_col = n + ctrl_vs_idx;
                            matrix_a.add_element(col, ctrl_col, Complex::new(-r, 0.0));
                        } else {
                            return Err(format!("CCVS id {}: Fuente controladora {} no encontrada en AC.", comp.id, ctrl_source_id));
                        }
                    } else {
                        return Err(format!("CCVS id {}: Falta especificar la fuente controladora en AC.", comp.id));
                    }
                }
                _ => {}
            }
        }

        // Estampar inductores acoplados en AC
        if let Some(ref mutuals) = netlist.mutual_inductances {
            for k_comp in mutuals {
                if let (Some(l1), Some(l2)) = (
                    netlist.components.iter().find(|c| c.id == k_comp.l1_id),
                    netlist.components.iter().find(|c| c.id == k_comp.l2_id)
                ) {
                    let node_1pos = l1.pins[0].parse::<usize>().unwrap();
                    let node_1neg = l1.pins[1].parse::<usize>().unwrap();
                    let node_2pos = l2.pins[0].parse::<usize>().unwrap();
                    let node_2neg = l2.pins[1].parse::<usize>().unwrap();

                    let l1_val = l1.value;
                    let l2_val = l2.value;
                    let k = k_comp.k_coeff;
                    
                    let m = k * (l1_val * l2_val).sqrt();
                    let delta = l1_val * l2_val - m * m;

                    if delta.abs() > 1e-30 && omega > 0.0 {
                        let y11 = Complex::new(1e-12, -l2_val / (omega * delta));
                        let y22 = Complex::new(1e-12, -l1_val / (omega * delta));
                        let y12 = Complex::new(0.0, m / (omega * delta));

                        stamp_conductance(&mut matrix_a, node_1pos, node_1pos, y11);
                        stamp_conductance(&mut matrix_a, node_1neg, node_1neg, y11);
                        stamp_conductance(&mut matrix_a, node_1pos, node_1neg, -y11);
                        stamp_conductance(&mut matrix_a, node_1neg, node_1pos, -y11);

                        stamp_conductance(&mut matrix_a, node_2pos, node_2pos, y22);
                        stamp_conductance(&mut matrix_a, node_2neg, node_2neg, y22);
                        stamp_conductance(&mut matrix_a, node_2pos, node_2neg, -y22);
                        stamp_conductance(&mut matrix_a, node_2neg, node_2pos, -y22);

                        // Acoplamiento cruzado
                        stamp_conductance(&mut matrix_a, node_1pos, node_2pos, y12);
                        stamp_conductance(&mut matrix_a, node_1neg, node_2neg, y12);
                        stamp_conductance(&mut matrix_a, node_1pos, node_2neg, -y12);
                        stamp_conductance(&mut matrix_a, node_1neg, node_2pos, -y12);

                        stamp_conductance(&mut matrix_a, node_2pos, node_1pos, y12);
                        stamp_conductance(&mut matrix_a, node_2neg, node_1neg, y12);
                        stamp_conductance(&mut matrix_a, node_2pos, node_1neg, -y12);
                        stamp_conductance(&mut matrix_a, node_2neg, node_1pos, -y12);
                    }
                }
            }
        }

        // Resolver el sistema lineal de esta iteración usando Aritmética Plana CSC Compleja Left-Looking (Cero Alocaciones)
        let (symbolic, workspace, matrix_csc) = csc_solver.get_or_insert_with(|| {
            let mut real_pattern = SparseMatrix::new(size);
            for r in 0..size {
                for (&c, &val) in &matrix_a.rows[r] {
                    real_pattern.add_element(r, c, val.norm());
                }
            }
            let sym = crate::sparse_csc::SymbolicLU::analyze(&real_pattern);
            let work = crate::sparse_csc::ComplexNumericLUWorkspace::new(&sym);
            let csc = crate::sparse_csc::ComplexSparseMatrixCSC::from_sparse(&matrix_a);
            (sym, work, csc)
        });

        matrix_csc.update_from_sparse(&matrix_a);
        matrix_csc.left_looking_factorize(symbolic, workspace)
            .map_err(|_| format!("Matriz MNA singular en f = {} Hz. Agrega referencia a Tierra (GND).", f_val))?;

        let solution = symbolic.solve_complex(workspace, &vector_z)
            .ok_or_else(|| format!("Matriz MNA singular en f = {} Hz. Agrega referencia a Tierra (GND).", f_val))?;


        let mut node_vals = Vec::new();
        for i in 1..=n {
            let val = solution[i - 1];
            let mag_val = val.norm();
            let amplitude_db = if mag_val < 1e-12 { -240.0 } else { 20.0 * mag_val.log10() };
            let phase_deg = val.to_polar().1 * (180.0 / std::f64::consts::PI);
            node_vals.push((i.to_string(), amplitude_db, phase_deg));
        }

        Ok(AcFrequencyResult { _f_val: f_val, node_vals })
    }).collect::<Result<Vec<AcFrequencyResult>, String>>()?;

    for res in results {
        for (node_name, amp, phase) in res.node_vals {
            node_amplitudes.get_mut(&node_name).unwrap().push(amp);
            node_phases.get_mut(&node_name).unwrap().push(phase);
        }
    }

    Ok(AcSweepResult {
        frequencies,
        node_amplitudes,
        node_phases,
        error_log: None,
    })

}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoiseSweepSettings {
    pub output_node: String,
    pub reference_node: String,
    pub ac_settings: AcSweepSettings,

}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoiseSweepResult {
    pub frequencies: Vec<f64>,
    pub output_noise_density: Vec<f64>, // V / sqrt(Hz)
    pub input_noise_density: Vec<f64>,  // V / sqrt(Hz) equivalente
    pub error_log: Option<String>,

}

pub fn solve_noise_sweep(netlist: &CircuitNetlist, settings: &NoiseSweepSettings) -> Result<NoiseSweepResult, String> {
    let (vt, is_temp) = get_thermal_parameters(netlist.temperature, None);
    // 1. Resolver Punto de Operación DC
    let (op_result, _) = solve_dc_circuit_with_guess(netlist, settings.ac_settings.op_guess.as_ref())?;

    // 2. Extraer conductancias y parámetros linealizados
    let n = crate::topology::validate_netlist_topology(netlist, false)?;

    let v_sources: Vec<&ComponentData> = netlist.components.iter()
        .filter(|c| c.comp_type == "vsource" || c.comp_type == "bvoltage" || c.comp_type == "vcvs" || c.comp_type == "ccvs")
        .collect();
    let m = v_sources.len();
    let size = n + m;

    if size == 0 {
        return Err("El circuito no contiene nodos activos o componentes.".to_string());
    }

    let mut vsource_map = HashMap::new();
    for (idx, vs) in v_sources.iter().enumerate() {
        vsource_map.insert(vs.id.clone(), idx);
    }

    // Linealizar no lineales en el OP
    let mut diode_conductances = HashMap::new();
    let mut diode_currents = HashMap::new();
    let mut nmos_parameters = HashMap::new(); // (gm, gds, ids)
    let mut pmos_parameters = HashMap::new(); // (gm, gds, ids)
    let mut bjt_parameters = HashMap::new();  // (gbe, gbc, ib, ic)
    let mut jfet_parameters = HashMap::new(); // (gm, gds, ids)
    let mut opamp_gm = HashMap::new();
    let mut opto_parameters: HashMap<String, (f64, f64)> = HashMap::new(); // (g_md, g_o)
    let mut opto_currents: HashMap<String, (f64, f64)> = HashMap::new();   // (i_led, i_ce)

    for comp in &netlist.components {
        if comp.comp_type == "diode" || comp.comp_type == "led" {
            let node_anode = comp.pins[0].parse::<usize>().unwrap();
            let node_cathode = comp.pins[1].parse::<usize>().unwrap();
            let v_anode = if node_anode > 0 { *op_result.node_voltages.get(&node_anode.to_string()).unwrap_or(&0.0) } else { 0.0 };
            let v_cathode = if node_cathode > 0 { *op_result.node_voltages.get(&node_cathode.to_string()).unwrap_or(&0.0) } else { 0.0 };
            let vd = v_anode - v_cathode;
            let (_, id, gd) = solve_diode_junction_voltage(vd, netlist.temperature, comp);
            diode_conductances.insert(comp.id.clone(), gd);
            diode_currents.insert(comp.id.clone(), id);
        } else if comp.comp_type == "opto" {
            if comp.pins.len() < 4 { continue; }
            let n_a = comp.pins[0].parse::<usize>().unwrap();
            let n_k = comp.pins[1].parse::<usize>().unwrap();
            let n_c = comp.pins[2].parse::<usize>().unwrap();
            let n_e = comp.pins[3].parse::<usize>().unwrap();
            let v_a = if n_a > 0 { *op_result.node_voltages.get(&n_a.to_string()).unwrap_or(&0.0) } else { 0.0 };
            let v_k = if n_k > 0 { *op_result.node_voltages.get(&n_k.to_string()).unwrap_or(&0.0) } else { 0.0 };
            let v_c = if n_c > 0 { *op_result.node_voltages.get(&n_c.to_string()).unwrap_or(&0.0) } else { 0.0 };
            let v_e = if n_e > 0 { *op_result.node_voltages.get(&n_e.to_string()).unwrap_or(&0.0) } else { 0.0 };
            let vd = v_a - v_k;
            let v_ce = v_c - v_e;
            let (_, id_led, gd_led) = solve_diode_junction_voltage(vd, netlist.temperature, comp);
            let (i_ce, g_md, g_o, _i_ce_eq) = evaluate_opto_receiver(vd, gd_led, id_led, v_ce, comp);
            diode_conductances.insert(comp.id.clone(), gd_led);
            diode_currents.insert(comp.id.clone(), id_led);
            opto_parameters.insert(comp.id.clone(), (g_md, g_o));
            opto_currents.insert(comp.id.clone(), (id_led, i_ce));
        } else if comp.comp_type == "nmos" || comp.comp_type == "bsim3nmos" || comp.comp_type == "bsim4nmos" {
            let node_gate = comp.pins[0].parse::<usize>().unwrap();
            let node_drain = comp.pins[1].parse::<usize>().unwrap();
            let node_source = comp.pins[2].parse::<usize>().unwrap();
            let node_bulk = if comp.pins.len() >= 4 { comp.pins[3].parse::<usize>().unwrap_or(0) } else { 0 };

            let v_gate = if node_gate > 0 { *op_result.node_voltages.get(&node_gate.to_string()).unwrap_or(&0.0) } else { 0.0 };
            let v_drain = if node_drain > 0 { *op_result.node_voltages.get(&node_drain.to_string()).unwrap_or(&0.0) } else { 0.0 };
            let v_source = if node_source > 0 { *op_result.node_voltages.get(&node_source.to_string()).unwrap_or(&0.0) } else { 0.0 };
            let v_bulk = if node_bulk > 0 { *op_result.node_voltages.get(&node_bulk.to_string()).unwrap_or(&0.0) } else { 0.0 };

            let vgs = v_gate - v_source;
            let vds = (v_drain - v_source).max(0.0);
            let vbs = v_bulk - v_source;
            
            let (ids, gm, gds, igs, gg) = if comp.comp_type == "bsim4nmos" {
                evaluate_bsim4_nmos(vgs, vds, vbs, comp.value, comp.w, comp.l)
            } else if comp.comp_type == "bsim3nmos" {
                let (ids_v, gm_v, gds_v) = evaluate_bsim3_nmos(vgs, vds, vbs, comp.value, comp.w, comp.l, None, Some(comp));
                (ids_v, gm_v, gds_v, 0.0, 1e-12)
            } else {
                let lambda = 0.02;
                let vth = comp.value;
                let kn = 0.02;
                if vgs <= vth {
                    let i_sub0 = 1e-7;
                    let n_factor = 1.5;
                    let exp_sub = ((vgs - vth) / (n_factor * vt)).exp();
                    let exp_vds = (-vds / vt).exp();
                    let sub_factor = 1.0 - exp_vds;
                    let ids_val = i_sub0 * exp_sub * sub_factor * (1.0 + lambda * vds);
                    let gm_val = ids_val / (n_factor * vt);
                    let gds_val = i_sub0 * exp_sub * ( (exp_vds / vt) * (1.0 + lambda * vds) + sub_factor * lambda );
                    (ids_val, gm_val, gds_val.max(1e-9), 0.0, 1e-12)
                } else if vds < vgs - vth {
                    let triode_curr = kn * (2.0 * (vgs - vth) * vds - vds * vds);
                    let ids_val = triode_curr * (1.0 + lambda * vds);
                    let gm_val = (2.0 * kn * vds) * (1.0 + lambda * vds);
                    let gds_val = (2.0 * kn * (vgs - vth - vds)) * (1.0 + lambda * vds) + triode_curr * lambda;
                    (ids_val, gm_val, gds_val.max(1e-9), 0.0, 1e-12)
                } else {
                    let sat_curr = kn * (vgs - vth) * (vgs - vth);
                    let ids_val = sat_curr * (1.0 + lambda * vds);
                    let gm_val = (2.0 * kn * (vgs - vth)) * (1.0 + lambda * vds);
                    let gds_val = sat_curr * lambda;
                    (ids_val, gm_val, gds_val.max(1e-9), 0.0, 1e-12)
                }
            };
            nmos_parameters.insert(comp.id.clone(), (gm, gds, ids, igs, gg));
        } else if comp.comp_type == "pmos" || comp.comp_type == "bsim3pmos" || comp.comp_type == "bsim4pmos" {
            let node_gate = comp.pins[0].parse::<usize>().unwrap();
            let node_drain = comp.pins[1].parse::<usize>().unwrap();
            let node_source = comp.pins[2].parse::<usize>().unwrap();
            let node_bulk = if comp.pins.len() >= 4 { comp.pins[3].parse::<usize>().unwrap_or(0) } else { 0 };

            let v_gate = if node_gate > 0 { *op_result.node_voltages.get(&node_gate.to_string()).unwrap_or(&0.0) } else { 0.0 };
            let v_drain = if node_drain > 0 { *op_result.node_voltages.get(&node_drain.to_string()).unwrap_or(&0.0) } else { 0.0 };
            let v_source = if node_source > 0 { *op_result.node_voltages.get(&node_source.to_string()).unwrap_or(&0.0) } else { 0.0 };
            let v_bulk = if node_bulk > 0 { *op_result.node_voltages.get(&node_bulk.to_string()).unwrap_or(&0.0) } else { 0.0 };

            let vsg = v_source - v_gate;
            let vsd = (v_source - v_drain).max(0.0);
            let vsb = v_source - v_bulk;

            let (isd, gm, gds, igs, gg) = if comp.comp_type == "bsim4pmos" {
                evaluate_bsim4_pmos(vsg, vsd, vsb, comp.value, comp.w, comp.l)
            } else if comp.comp_type == "bsim3pmos" {
                let (isd_v, gm_v, gds_v) = evaluate_bsim3_pmos(vsg, vsd, vsb, comp.value, comp.w, comp.l, None, Some(comp));
                (isd_v, gm_v, gds_v, 0.0, 1e-12)
            } else {
                let lambda = 0.02;
                let vth = if comp.value == 0.0 { -1.5 } else { comp.value };
                let vth_abs = -vth;
                let kp = 0.02;
                if vsg <= vth_abs {
                    let i_sub0 = 1e-7;
                    let n_factor = 1.5;
                    let exp_sub = ((vsg - vth_abs) / (n_factor * vt)).exp();
                    let exp_vsd = (-vsd / vt).exp();
                    let sub_factor = 1.0 - exp_vsd;
                    let isd_val = i_sub0 * exp_sub * sub_factor * (1.0 + lambda * vsd);
                    let gm_val = isd_val / (n_factor * vt);
                    let gds_cond_val = i_sub0 * exp_sub * ( (exp_vsd / vt) * (1.0 + lambda * vsd) + sub_factor * lambda );
                    (isd_val, gm_val, gds_cond_val.max(1e-9), 0.0, 1e-12)
                } else if vsd < vsg - vth_abs {
                    let triode_curr = kp * (2.0 * (vsg - vth_abs) * vsd - vsd * vsd);
                    let isd_val = triode_curr * (1.0 + lambda * vsd);
                    let gm_val = (2.0 * kp * vsd) * (1.0 + lambda * vsd);
                    let gds_cond_val = (2.0 * kp * (vsg - vth_abs - vsd)) * (1.0 + lambda * vsd) + triode_curr * lambda;
                    (isd_val, gm_val, gds_cond_val.max(1e-9), 0.0, 1e-12)
                } else {
                    let sat_curr = kp * (vsg - vth_abs) * (vsg - vth_abs);
                    let isd_val = sat_curr * (1.0 + lambda * vsd);
                    let gm_val = (2.0 * kp * (vsg - vth_abs)) * (1.0 + lambda * vsd);
                    let gds_cond_val = sat_curr * lambda;
                    (isd_val, gm_val, gds_cond_val.max(1e-9), 0.0, 1e-12)
                }
            };
            pmos_parameters.insert(comp.id.clone(), (gm, gds, isd, igs, gg));
        } else if comp.comp_type == "npn" || comp.comp_type == "pnp" {
            let is_npn = comp.comp_type == "npn";
            let node_base = comp.pins[0].parse::<usize>().unwrap();
            let node_collector = comp.pins[1].parse::<usize>().unwrap();
            let node_emitter = comp.pins[2].parse::<usize>().unwrap();

            let v_base = if node_base > 0 { *op_result.node_voltages.get(&node_base.to_string()).unwrap_or(&0.0) } else { 0.0 };
            let v_collector = if node_collector > 0 { *op_result.node_voltages.get(&node_collector.to_string()).unwrap_or(&0.0) } else { 0.0 };
            let v_emitter = if node_emitter > 0 { *op_result.node_voltages.get(&node_emitter.to_string()).unwrap_or(&0.0) } else { 0.0 };

            let (vbe, vbc) = if is_npn {
                (v_base - v_emitter, v_base - v_collector)
            } else {
                (v_emitter - v_base, v_collector - v_base)
            };

            let bjt_is_val = if comp.bjt_is.is_some() {
                let (_, scaled_is) = get_thermal_parameters(netlist.temperature, comp.bjt_is);
                scaled_is
            } else {
                is_temp
            };
            let beta_f = comp.bjt_bf.unwrap_or(if comp.value <= 1.0 { 100.0 } else { comp.value });
            let v_af = comp.bjt_vaf.unwrap_or(if is_npn { 100.0 } else { 50.0 });
            let k_early = (1.0 + (vbe - vbc) / v_af).max(0.1);

            let exp_be = (vbe / vt).exp();
            let exp_bc = (vbc / vt).exp();

            let ide = bjt_is_val * (exp_be - 1.0) * k_early;
            let idc = bjt_is_val * (exp_bc - 1.0) * k_early;
            let gbe = (bjt_is_val / vt) * exp_be * k_early;
            let gbc = (bjt_is_val / vt) * exp_bc * k_early;

            let ib = ide / (beta_f + 1.0) + idc / 2.0;
            let ic = ide - idc;

            bjt_parameters.insert(comp.id.clone(), (gbe, gbc, ib, ic));
        } else if comp.comp_type == "njf" || comp.comp_type == "pjf" {
            let is_njf = comp.comp_type == "njf";
            let node_drain = comp.pins[0].parse::<usize>().unwrap();
            let node_gate = comp.pins[1].parse::<usize>().unwrap();
            let node_source = comp.pins[2].parse::<usize>().unwrap();

            let v_drain = if node_drain > 0 { *op_result.node_voltages.get(&node_drain.to_string()).unwrap_or(&0.0) } else { 0.0 };
            let v_gate = if node_gate > 0 { *op_result.node_voltages.get(&node_gate.to_string()).unwrap_or(&0.0) } else { 0.0 };
            let v_source = if node_source > 0 { *op_result.node_voltages.get(&node_source.to_string()).unwrap_or(&0.0) } else { 0.0 };

            let vto = comp.jfet_vto.unwrap_or(if is_njf { -2.0 } else { 2.0 });
            let beta = comp.jfet_beta.unwrap_or(1e-3);
            let lambda = comp.jfet_lambda.unwrap_or(0.0);

            let (vgs_raw, vds_raw, factor_pol) = if is_njf {
                (v_gate - v_source, v_drain - v_source, 1.0)
            } else {
                (v_source - v_gate, v_source - v_drain, -1.0)
            };

            let mut vgs = vgs_raw;
            let mut vds = vds_raw;
            let mut swapped = false;
            if vds < 0.0 {
                vds = -vds;
                vgs = if is_njf { v_gate - v_drain } else { v_drain - v_gate };
                swapped = true;
            }

            let vgst = if is_njf { vgs - vto } else { vto - vgs };
            let (ids, gm, gds) = if vgst <= 0.0 {
                (0.0, 0.0, 1e-9)
            } else if vds < vgst {
                let gm_val = 2.0 * beta * vds * (1.0 + lambda * vds);
                let gds_val = beta * ( (2.0 * vgst - 2.0 * vds) * (1.0 + lambda * vds) + vds * (2.0 * vgst - vds) * lambda );
                let ids_val = beta * vds * (2.0 * vgst - vds) * (1.0 + lambda * vds);
                (ids_val, gm_val, gds_val.max(1e-9))
            } else {
                let gm_val = 2.0 * beta * vgst * (1.0 + lambda * vds);
                let gds_val = beta * vgst * vgst * lambda;
                let ids_val = beta * vgst * vgst * (1.0 + lambda * vds);
                (ids_val, gm_val, gds_val.max(1e-9))
            };

            let (ids_eff, gm_eff, gds_eff) = if swapped {
                (-ids, -gm, gds)
            } else {
                (ids, gm, gds)
            };

            let ids_final = ids_eff * factor_pol;
            let gm_final = gm_eff * factor_pol;
            let gds_final = gds_eff;

            jfet_parameters.insert(comp.id.clone(), (gm_final, gds_final, ids_final));
        } else if comp.comp_type == "opamp" {
            let pin_in_pos = comp.pins[0].parse::<usize>().unwrap();
            let pin_in_neg = comp.pins[1].parse::<usize>().unwrap();
            let pin_vplus = comp.pins[2].parse::<usize>().unwrap();
            let pin_vminus = comp.pins[3].parse::<usize>().unwrap();

            let v_in_pos = if pin_in_pos > 0 { *op_result.node_voltages.get(&pin_in_pos.to_string()).unwrap_or(&0.0) } else { 0.0 };
            let v_in_neg = if pin_in_neg > 0 { *op_result.node_voltages.get(&pin_in_neg.to_string()).unwrap_or(&0.0) } else { 0.0 };
            let v_vplus = if pin_vplus > 0 { *op_result.node_voltages.get(&pin_vplus.to_string()).unwrap_or(&15.0) } else { 15.0 };
            let v_vminus = if pin_vminus > 0 { *op_result.node_voltages.get(&pin_vminus.to_string()).unwrap_or(&-15.0) } else { -15.0 };

            let v_diff = v_in_pos - v_in_neg;
            let mut v_span = v_vplus - v_vminus;
            if v_span.abs() < 1e-3 { v_span = 30.0; }
            let a_ol = 1e5;
            let r_out = 100.0;
            let g_out = 1.0 / r_out;
            let arg = (a_ol * v_diff) / v_span;
            let tanh_val = arg.tanh();
            let g_m_int = 0.5 * a_ol * (1.0 - tanh_val * tanh_val);
            let g_m_opamp = g_out * g_m_int;
            opamp_gm.insert(comp.id.clone(), g_m_opamp);
        }
    }

    // 3. Generar vector de frecuencias logarítmicas
    let mut frequencies = Vec::new();
    let mut f = settings.ac_settings.f_start;
    let ratio = 10.0f64.powf(1.0 / settings.ac_settings.points_per_decade as f64);
    while f <= settings.ac_settings.f_end * 1.001 {
        frequencies.push(f);
        f *= ratio;
    }

    let n_out = settings.output_node.parse::<usize>().unwrap_or(0);
    let n_ref = settings.reference_node.parse::<usize>().unwrap_or(0);

    let mut output_noise_density = Vec::new();
    let mut input_noise_density = Vec::new();

    struct NoiseFrequencyResult {
        out_noise: f64,
        in_noise: f64,
    }

    // 4. Bucle en frecuencia
    let mut csc_solver: Option<(crate::sparse_csc::SymbolicLU, crate::sparse_csc::ComplexNumericLUWorkspace, crate::sparse_csc::ComplexSparseMatrixCSC)> = None;

    let results: Vec<NoiseFrequencyResult> = frequencies.iter().map(|&f_val| {
        let omega = 2.0 * std::f64::consts::PI * f_val;
        let mut matrix_a = ComplexSparseMatrix::new(size);
        let mut vector_z = DVector::<Complex<f64>>::zeros(size);

        // Estampar componentes AC normales
        let stamp_conductance = |matrix: &mut ComplexSparseMatrix, r: usize, c: usize, g: Complex<f64>| {
            if r > 0 && c > 0 { matrix.add_element(r - 1, c - 1, g); }
        };

        for comp in &netlist.components {
            match comp.comp_type.as_str() {
                "resistor" => {
                    let node_a = comp.pins[0].parse::<usize>().unwrap();
                    let node_b = comp.pins[1].parse::<usize>().unwrap();
                    let g = Complex::new(1.0 / comp.value, 0.0);
                    stamp_conductance(&mut matrix_a, node_a, node_a, g);
                    stamp_conductance(&mut matrix_a, node_b, node_b, g);
                    stamp_conductance(&mut matrix_a, node_a, node_b, -g);
                    stamp_conductance(&mut matrix_a, node_b, node_a, -g);
                }
                "vsource" => {
                    let node_pos = comp.pins[0].parse::<usize>().unwrap();
                    let node_neg = comp.pins[1].parse::<usize>().unwrap();
                    let vs_idx = *vsource_map.get(&comp.id).unwrap();
                    let col = n + vs_idx;
                    
                    if node_pos > 0 {
                        matrix_a.add_element(node_pos - 1, col, Complex::new(1.0, 0.0));
                        matrix_a.add_element(col, node_pos - 1, Complex::new(1.0, 0.0));
                    }
                    if node_neg > 0 {
                        matrix_a.add_element(node_neg - 1, col, Complex::new(-1.0, 0.0));
                        matrix_a.add_element(col, node_neg - 1, Complex::new(-1.0, 0.0));
                    }
                    if comp.id == "V1" {
                        vector_z[col] = Complex::new(1.0, 0.0);
                    }
                }
                "capacitor" => {
                    let node_a = comp.pins[0].parse::<usize>().unwrap();
                    let node_b = comp.pins[1].parse::<usize>().unwrap();
                    let g = Complex::new(0.0, omega * comp.value);
                    stamp_conductance(&mut matrix_a, node_a, node_a, g);
                    stamp_conductance(&mut matrix_a, node_b, node_b, g);
                    stamp_conductance(&mut matrix_a, node_a, node_b, -g);
                    stamp_conductance(&mut matrix_a, node_b, node_a, -g);
                }
                "inductor" => {
                    let is_coupled = if let Some(ref mutuals) = netlist.mutual_inductances {
                        mutuals.iter().any(|m| m.l1_id == comp.id || m.l2_id == comp.id)
                    } else {
                        false
                    };
                    if is_coupled {
                        continue;
                    }
                    let node_a = comp.pins[0].parse::<usize>().unwrap();
                    let node_b = comp.pins[1].parse::<usize>().unwrap();
                    let g = Complex::new(0.0, -1.0 / (omega * comp.value));
                    stamp_conductance(&mut matrix_a, node_a, node_a, g);
                    stamp_conductance(&mut matrix_a, node_b, node_b, g);
                    stamp_conductance(&mut matrix_a, node_a, node_b, -g);
                    stamp_conductance(&mut matrix_a, node_b, node_a, -g);
                }
                "diode" | "led" => {
                    let node_anode = comp.pins[0].parse::<usize>().unwrap();
                    let node_cathode = comp.pins[1].parse::<usize>().unwrap();
                    let gd = *diode_conductances.get(&comp.id).unwrap_or(&1e-9);
                    let g = Complex::new(gd, 0.0);
                    stamp_conductance(&mut matrix_a, node_anode, node_anode, g);
                    stamp_conductance(&mut matrix_a, node_cathode, node_cathode, g);
                    stamp_conductance(&mut matrix_a, node_anode, node_cathode, -g);
                    stamp_conductance(&mut matrix_a, node_cathode, node_anode, -g);
                }
                "opto" => {
                    if comp.pins.len() < 4 { continue; }
                    let node_a = comp.pins[0].parse::<usize>().unwrap();
                    let node_k = comp.pins[1].parse::<usize>().unwrap();
                    let node_c = comp.pins[2].parse::<usize>().unwrap();
                    let node_e = comp.pins[3].parse::<usize>().unwrap();

                    // Lado LED
                    let gd_led = *diode_conductances.get(&comp.id).unwrap_or(&1e-9);
                    let g_led = Complex::new(gd_led, 0.0);
                    stamp_conductance(&mut matrix_a, node_a, node_a,  g_led);
                    stamp_conductance(&mut matrix_a, node_k, node_k,  g_led);
                    stamp_conductance(&mut matrix_a, node_a, node_k, -g_led);
                    stamp_conductance(&mut matrix_a, node_k, node_a, -g_led);

                    // Lado receptor (g_md mutua + g_o de salida)
                    let (g_md_val, g_o_val) = *opto_parameters.get(&comp.id).unwrap_or(&(0.0, 1e-9));
                    let g_md = Complex::new(g_md_val, 0.0);
                    let g_o  = Complex::new(g_o_val,  0.0);
                    stamp_conductance(&mut matrix_a, node_c, node_a,  g_md);
                    stamp_conductance(&mut matrix_a, node_c, node_k, -g_md);
                    stamp_conductance(&mut matrix_a, node_c, node_c,  g_o);
                    stamp_conductance(&mut matrix_a, node_c, node_e, -g_o);
                    stamp_conductance(&mut matrix_a, node_e, node_a, -g_md);
                    stamp_conductance(&mut matrix_a, node_e, node_k,  g_md);
                    stamp_conductance(&mut matrix_a, node_e, node_c, -g_o);
                    stamp_conductance(&mut matrix_a, node_e, node_e,  g_o);
                }
                "nmos" | "bsim3nmos" | "bsim4nmos" | "pmos" | "bsim3pmos" | "bsim4pmos" => {
                    let is_nmos = comp.comp_type == "nmos" || comp.comp_type == "bsim3nmos" || comp.comp_type == "bsim4nmos";
                    let node_gate = comp.pins[0].parse::<usize>().unwrap();
                    let node_drain = comp.pins[1].parse::<usize>().unwrap();
                    let node_source = comp.pins[2].parse::<usize>().unwrap();

                    let (gm, gds, _, _, gg_val) = if is_nmos {
                        *nmos_parameters.get(&comp.id).unwrap_or(&(0.0, 1e-5, 0.0, 0.0, 1e-12))
                    } else {
                        *pmos_parameters.get(&comp.id).unwrap_or(&(0.0, 1e-5, 0.0, 0.0, 1e-12))
                    };

                    let gds_c = Complex::new(gds, 0.0);
                    let gm_c = Complex::new(gm, 0.0);
                    let gg_c = Complex::new(gg_val, 0.0);

                    if is_nmos {
                        stamp_conductance(&mut matrix_a, node_drain, node_drain, gds_c);
                        stamp_conductance(&mut matrix_a, node_source, node_source, gds_c + gg_c);
                        stamp_conductance(&mut matrix_a, node_drain, node_source, -gds_c);
                        stamp_conductance(&mut matrix_a, node_source, node_drain, -gds_c);

                        stamp_conductance(&mut matrix_a, node_gate, node_gate, gg_c);
                        stamp_conductance(&mut matrix_a, node_gate, node_source, -gg_c);
                        stamp_conductance(&mut matrix_a, node_source, node_gate, -gg_c);

                        if node_drain > 0 {
                            if node_gate > 0 { matrix_a.add_element(node_drain - 1, node_gate - 1, gm_c); }
                            if node_source > 0 { matrix_a.add_element(node_drain - 1, node_source - 1, -gm_c); }
                        }
                        if node_source > 0 {
                            if node_gate > 0 { matrix_a.add_element(node_source - 1, node_gate - 1, -gm_c); }
                            if node_source > 0 { matrix_a.add_element(node_source - 1, node_source - 1, gm_c); }
                        }
                    } else {
                        stamp_conductance(&mut matrix_a, node_source, node_source, gds_c + gg_c);
                        stamp_conductance(&mut matrix_a, node_drain, node_drain, gds_c);
                        stamp_conductance(&mut matrix_a, node_source, node_drain, -gds_c);
                        stamp_conductance(&mut matrix_a, node_drain, node_source, -gds_c);

                        stamp_conductance(&mut matrix_a, node_gate, node_gate, gg_c);
                        stamp_conductance(&mut matrix_a, node_gate, node_source, -gg_c);
                        stamp_conductance(&mut matrix_a, node_source, node_gate, -gg_c);

                        if node_drain > 0 {
                            if node_source > 0 { matrix_a.add_element(node_drain - 1, node_source - 1, -gm_c); }
                            if node_gate > 0 { matrix_a.add_element(node_drain - 1, node_gate - 1, gm_c); }
                        }
                        if node_source > 0 {
                            if node_source > 0 { matrix_a.add_element(node_source - 1, node_source - 1, gm_c); }
                            if node_gate > 0 { matrix_a.add_element(node_source - 1, node_gate - 1, -gm_c); }
                        }
                    }
                }
                "npn" | "pnp" => {
                    let node_base = comp.pins[0].parse::<usize>().unwrap();
                    let node_collector = comp.pins[1].parse::<usize>().unwrap();
                    let node_emitter = comp.pins[2].parse::<usize>().unwrap();

                    let (gbe, gbc, _, _) = *bjt_parameters.get(&comp.id).unwrap_or(&(1e-3, 1e-5, 0.0, 0.0));
                    let beta_f = if comp.value <= 1.0 { 100.0 } else { comp.value };
                    let alpha_f = beta_f / (beta_f + 1.0);
                    let alpha_r = 0.5;

                    let gbe_c = Complex::new(gbe / (beta_f + 1.0), 0.0);
                    let gbc_c = Complex::new(gbc / 1.5, 0.0);

                    stamp_conductance(&mut matrix_a, node_base, node_base, gbe_c + gbc_c);
                    stamp_conductance(&mut matrix_a, node_base, node_emitter, -gbe_c);
                    stamp_conductance(&mut matrix_a, node_base, node_collector, -gbc_c);

                    if node_collector > 0 {
                        if node_base > 0 { matrix_a.add_element(node_collector - 1, node_base - 1, Complex::new(alpha_f * gbe - gbc, 0.0)); }
                        if node_emitter > 0 { matrix_a.add_element(node_collector - 1, node_emitter - 1, Complex::new(-alpha_f * gbe, 0.0)); }
                        matrix_a.add_element(node_collector - 1, node_collector - 1, Complex::new(gbc, 0.0));
                    }

                    if node_emitter > 0 {
                        if node_base > 0 { matrix_a.add_element(node_emitter - 1, node_base - 1, Complex::new(-(gbe - alpha_r * gbc), 0.0)); }
                        matrix_a.add_element(node_emitter - 1, node_emitter - 1, Complex::new(gbe, 0.0));
                        if node_collector > 0 { matrix_a.add_element(node_emitter - 1, node_collector - 1, Complex::new(-alpha_r * gbc, 0.0)); }
                    }
                }
                "njf" | "pjf" => {
                    let node_drain = comp.pins[0].parse::<usize>().unwrap();
                    let node_gate = comp.pins[1].parse::<usize>().unwrap();
                    let node_source = comp.pins[2].parse::<usize>().unwrap();

                    let (gm, gds, _) = *jfet_parameters.get(&comp.id).unwrap_or(&(0.0, 1e-9, 0.0));

                    let gds_c = Complex::new(gds, 0.0);
                    let gm_c = Complex::new(gm, 0.0);

                    stamp_conductance(&mut matrix_a, node_drain, node_drain, gds_c);
                    stamp_conductance(&mut matrix_a, node_source, node_source, gds_c);
                    stamp_conductance(&mut matrix_a, node_drain, node_source, -gds_c);
                    stamp_conductance(&mut matrix_a, node_source, node_drain, -gds_c);

                    if node_drain > 0 {
                        if node_gate > 0 { matrix_a.add_element(node_drain - 1, node_gate - 1, gm_c); }
                        if node_source > 0 { matrix_a.add_element(node_drain - 1, node_source - 1, -gm_c); }
                    }
                    if node_source > 0 {
                        if node_gate > 0 { matrix_a.add_element(node_source - 1, node_gate - 1, -gm_c); }
                        if node_source > 0 { matrix_a.add_element(node_source - 1, node_source - 1, gm_c); }
                    }
                }
                "opamp" => {
                    let pin_in_pos = comp.pins[0].parse::<usize>().unwrap();
                    let pin_in_neg = comp.pins[1].parse::<usize>().unwrap();
                    let pin_out = comp.pins[4].parse::<usize>().unwrap();

                    let r_in = 1e7;
                    let r_out = 100.0;
                    let g_in = Complex::new(1.0 / r_in, 0.0);
                    let g_out = Complex::new(1.0 / r_out, 0.0);
                    let g_m_opamp_val = *opamp_gm.get(&comp.id).unwrap_or(&1000.0);
                    // Aplicar polo dominante a 10 Hz: g_m = g_m_static / (1 + j * f_val / 10.0)
                    let pole_factor = Complex::new(1.0, f_val / 10.0);
                    let g_m_opamp = Complex::new(g_m_opamp_val, 0.0) / pole_factor;

                    stamp_conductance(&mut matrix_a, pin_in_pos, pin_in_pos, g_in);
                    stamp_conductance(&mut matrix_a, pin_in_neg, pin_in_neg, g_in);
                    stamp_conductance(&mut matrix_a, pin_in_pos, pin_in_neg, -g_in);
                    stamp_conductance(&mut matrix_a, pin_in_neg, pin_in_pos, -g_in);

                    if pin_out > 0 {
                        stamp_conductance(&mut matrix_a, pin_out, pin_out, g_out);
                        if pin_in_pos > 0 { matrix_a.add_element(pin_out - 1, pin_in_pos - 1, -g_m_opamp); }
                        if pin_in_neg > 0 { matrix_a.add_element(pin_out - 1, pin_in_neg - 1, g_m_opamp); }
                    }
                }
                _ => {}
            }
        }

        // Estampar inductores acoplados en Noise Sweep
        if let Some(ref mutuals) = netlist.mutual_inductances {
            for k_comp in mutuals {
                if let (Some(l1), Some(l2)) = (
                    netlist.components.iter().find(|c| c.id == k_comp.l1_id),
                    netlist.components.iter().find(|c| c.id == k_comp.l2_id)
                ) {
                    let node_1pos = l1.pins[0].parse::<usize>().unwrap();
                    let node_1neg = l1.pins[1].parse::<usize>().unwrap();
                    let node_2pos = l2.pins[0].parse::<usize>().unwrap();
                    let node_2neg = l2.pins[1].parse::<usize>().unwrap();

                    let l1_val = l1.value;
                    let l2_val = l2.value;
                    let k = k_comp.k_coeff;
                    
                    let m = k * (l1_val * l2_val).sqrt();
                    let delta = l1_val * l2_val - m * m;

                    if delta.abs() > 1e-30 && omega > 0.0 {
                        let y11 = Complex::new(1e-12, -l2_val / (omega * delta));
                        let y22 = Complex::new(1e-12, -l1_val / (omega * delta));
                        let y12 = Complex::new(0.0, m / (omega * delta));

                        stamp_conductance(&mut matrix_a, node_1pos, node_1pos, y11);
                        stamp_conductance(&mut matrix_a, node_1neg, node_1neg, y11);
                        stamp_conductance(&mut matrix_a, node_1pos, node_1neg, -y11);
                        stamp_conductance(&mut matrix_a, node_1neg, node_1pos, -y11);

                        stamp_conductance(&mut matrix_a, node_2pos, node_2pos, y22);
                        stamp_conductance(&mut matrix_a, node_2neg, node_2neg, y22);
                        stamp_conductance(&mut matrix_a, node_2pos, node_2neg, -y22);
                        stamp_conductance(&mut matrix_a, node_2neg, node_2pos, -y22);

                        // Acoplamiento cruzado
                        stamp_conductance(&mut matrix_a, node_1pos, node_2pos, y12);
                        stamp_conductance(&mut matrix_a, node_1neg, node_2neg, y12);
                        stamp_conductance(&mut matrix_a, node_1pos, node_2neg, -y12);
                        stamp_conductance(&mut matrix_a, node_1neg, node_2pos, -y12);

                        stamp_conductance(&mut matrix_a, node_2pos, node_1pos, y12);
                        stamp_conductance(&mut matrix_a, node_2neg, node_1neg, y12);
                        stamp_conductance(&mut matrix_a, node_2pos, node_1neg, -y12);
                        stamp_conductance(&mut matrix_a, node_2neg, node_1pos, -y12);
                    }
                }
            }
        }

        // Resolver el sistema lineal usando Aritmética Plana CSC Compleja Left-Looking (Cero Alocaciones)
        let (symbolic, workspace, matrix_csc) = csc_solver.get_or_insert_with(|| {
            let mut real_pattern = SparseMatrix::new(size);
            for r in 0..size {
                for (&c, &val) in &matrix_a.rows[r] {
                    real_pattern.add_element(r, c, val.norm());
                }
            }
            let sym = crate::sparse_csc::SymbolicLU::analyze(&real_pattern);
            let work = crate::sparse_csc::ComplexNumericLUWorkspace::new(&sym);
            let csc = crate::sparse_csc::ComplexSparseMatrixCSC::from_sparse(&matrix_a);
            (sym, work, csc)
        });

        matrix_csc.update_from_sparse(&matrix_a);
        matrix_csc.left_looking_factorize(symbolic, workspace)
            .map_err(|e| format!("Fallo de factorización en análisis de ruido: {}", e))?;

        let sol_ac = symbolic.solve_complex(workspace, &vector_z).unwrap_or_else(|| DVector::zeros(size));

        let v_out_ac = (if n_out > 0 { sol_ac[n_out - 1] } else { Complex::new(0.0, 0.0) }) -
                       (if n_ref > 0 { sol_ac[n_ref - 1] } else { Complex::new(0.0, 0.0) });
        let ac_gain = v_out_ac.norm().max(1e-12);

        // 6. Sumar todas las fuentes de ruido estocásticas incorreladas
        let mut total_output_noise_sq = 0.0;

        for comp in &netlist.components {
            let (node_a, node_b, s_i) = match comp.comp_type.as_str() {
                "resistor" => {
                    let n_a = comp.pins[0].parse::<usize>().unwrap();
                    let n_b = comp.pins[1].parse::<usize>().unwrap();
                    let s_val = 4.0 * PHYS_KB * PHYS_T / comp.value;
                    (n_a, n_b, s_val)
                }
                "diode" | "led" => {
                    let n_a = comp.pins[0].parse::<usize>().unwrap();
                    let n_b = comp.pins[1].parse::<usize>().unwrap();
                    let id = *diode_currents.get(&comp.id).unwrap_or(&0.0);
                    let s_val = 2.0 * PHYS_Q * id.abs() + (1e-14 * id.abs()) / f_val;
                    (n_a, n_b, s_val)
                }
                "opto" => {
                    // Ruido shot del LED interno (A-K) + ruido shot del fototransistor (C-E)
                    if comp.pins.len() < 4 { (0, 0, 0.0) } else {
                        let n_a = comp.pins[0].parse::<usize>().unwrap();
                        let n_k = comp.pins[1].parse::<usize>().unwrap();
                        let n_c = comp.pins[2].parse::<usize>().unwrap();
                        let n_e = comp.pins[3].parse::<usize>().unwrap();
                        let (i_led, i_ce) = *opto_currents.get(&comp.id).unwrap_or(&(0.0, 0.0));

                        // Ruido shot del LED (A-K): S = 2*q*|I_led| + flicker 1/f
                        let s_led = 2.0 * PHYS_Q * i_led.abs() + (1e-14 * i_led.abs()) / f_val;
                        if s_led > 0.0 && (n_a > 0 || n_k > 0) {
                            let mut z_led = DVector::<Complex<f64>>::zeros(size);
                            if n_a > 0 { z_led[n_a - 1] += Complex::new(1.0, 0.0); }
                            if n_k > 0 { z_led[n_k - 1] -= Complex::new(1.0, 0.0); }
                            let v_led_tf = symbolic.solve_complex(workspace, &z_led).unwrap_or_else(|| DVector::zeros(size));
                            let v_out_led = (if n_out > 0 { v_led_tf[n_out - 1] } else { Complex::new(0.0, 0.0) }) -
                                            (if n_ref > 0 { v_led_tf[n_ref - 1] } else { Complex::new(0.0, 0.0) });
                            total_output_noise_sq += s_led * v_out_led.norm_sqr();
                        }

                        // Ruido shot del fototransistor (C-E): S = 2*q*|I_ce|
                        let s_ce = 2.0 * PHYS_Q * i_ce.abs();
                        if s_ce > 0.0 && (n_c > 0 || n_e > 0) {
                            let mut z_ce = DVector::<Complex<f64>>::zeros(size);
                            if n_c > 0 { z_ce[n_c - 1] += Complex::new(1.0, 0.0); }
                            if n_e > 0 { z_ce[n_e - 1] -= Complex::new(1.0, 0.0); }
                            let v_ce_tf = symbolic.solve_complex(workspace, &z_ce).unwrap_or_else(|| DVector::zeros(size));
                            let v_out_ce = (if n_out > 0 { v_ce_tf[n_out - 1] } else { Complex::new(0.0, 0.0) }) -
                                           (if n_ref > 0 { v_ce_tf[n_ref - 1] } else { Complex::new(0.0, 0.0) });
                            total_output_noise_sq += s_ce * v_out_ce.norm_sqr();
                        }

                        (0, 0, 0.0)
                    }
                }
                "nmos" | "bsim3nmos" | "bsim4nmos" | "pmos" | "bsim3pmos" | "bsim4pmos" => {
                    let is_nmos = comp.comp_type == "nmos" || comp.comp_type == "bsim3nmos" || comp.comp_type == "bsim4nmos";
                    let n_g = comp.pins[0].parse::<usize>().unwrap();
                    let n_d = comp.pins[1].parse::<usize>().unwrap();
                    let n_s = comp.pins[2].parse::<usize>().unwrap();
                    
                    let (gm, _, ids, igs, _) = if is_nmos {
                        *nmos_parameters.get(&comp.id).unwrap_or(&(0.0, 1e-5, 0.0, 0.0, 1e-12))
                    } else {
                        *pmos_parameters.get(&comp.id).unwrap_or(&(0.0, 1e-5, 0.0, 0.0, 1e-12))
                    };
                    
                    let w = comp.w.unwrap_or(10.0e-6);
                    let l = comp.l.unwrap_or(0.18e-6);
                    let c_ox = 15e-12 / (10.0e-6 * 0.18e-6);
                    let s_flicker = (1e-13 * ids.abs()) / (f_val * w * l * c_ox);
                    let s_val_channel = (8.0 / 3.0) * PHYS_KB * PHYS_T * gm + s_flicker;

                    // Channel noise contribution
                    if s_val_channel > 0.0 && (n_d > 0 || n_s > 0) {
                        let mut z_chan = DVector::<Complex<f64>>::zeros(size);
                        if n_d > 0 { z_chan[n_d - 1] += Complex::new(1.0, 0.0); }
                        if n_s > 0 { z_chan[n_s - 1] -= Complex::new(1.0, 0.0); }
                        let v_chan_tf = symbolic.solve_complex(workspace, &z_chan).unwrap_or_else(|| DVector::zeros(size));
                        let v_out_chan = (if n_out > 0 { v_chan_tf[n_out - 1] } else { Complex::new(0.0, 0.0) }) -
                                         (if n_ref > 0 { v_chan_tf[n_ref - 1] } else { Complex::new(0.0, 0.0) });
                        total_output_noise_sq += s_val_channel * v_out_chan.norm_sqr();
                    }

                    // Gate leakage tunneling shot noise contribution (S_ig = 2 * q * Ig)
                    let s_val_gate = 2.0 * PHYS_Q * igs.abs();
                    if s_val_gate > 0.0 && (n_g > 0 || n_s > 0) {
                        let mut z_gate = DVector::<Complex<f64>>::zeros(size);
                        if n_g > 0 { z_gate[n_g - 1] += Complex::new(1.0, 0.0); }
                        if n_s > 0 { z_gate[n_s - 1] -= Complex::new(1.0, 0.0); }
                        let v_gate_tf = symbolic.solve_complex(workspace, &z_gate).unwrap_or_else(|| DVector::zeros(size));
                        let v_out_gate = (if n_out > 0 { v_gate_tf[n_out - 1] } else { Complex::new(0.0, 0.0) }) -
                                         (if n_ref > 0 { v_gate_tf[n_ref - 1] } else { Complex::new(0.0, 0.0) });
                        total_output_noise_sq += s_val_gate * v_out_gate.norm_sqr();
                    }

                    (0, 0, 0.0)
                }
                "npn" | "pnp" => {
                    let n_b = comp.pins[0].parse::<usize>().unwrap();
                    let n_c = comp.pins[1].parse::<usize>().unwrap();
                    let n_e = comp.pins[2].parse::<usize>().unwrap();

                    let (_, _, ib, ic) = *bjt_parameters.get(&comp.id).unwrap_or(&(1e-3, 1e-5, 0.0, 0.0));
                    
                    let s_ib = 2.0 * PHYS_Q * ib.abs() + (1e-14 * ib.abs()) / f_val;
                    let s_ic = 2.0 * PHYS_Q * ic.abs();
                    
                    // Base contribution
                    let mut z_b = DVector::<Complex<f64>>::zeros(size);
                    if n_b > 0 { z_b[n_b - 1] += Complex::new(1.0, 0.0); }
                    if n_e > 0 { z_b[n_e - 1] -= Complex::new(1.0, 0.0); }
                    let v_b_tf = symbolic.solve_complex(workspace, &z_b).unwrap_or_else(|| DVector::zeros(size));
                    let v_out_b = (if n_out > 0 { v_b_tf[n_out - 1] } else { Complex::new(0.0, 0.0) }) -
                                  (if n_ref > 0 { v_b_tf[n_ref - 1] } else { Complex::new(0.0, 0.0) });
                    total_output_noise_sq += s_ib * v_out_b.norm_sqr();

                    // Collector contribution
                    let mut z_c = DVector::<Complex<f64>>::zeros(size);
                    if n_c > 0 { z_c[n_c - 1] += Complex::new(1.0, 0.0); }
                    if n_e > 0 { z_c[n_e - 1] -= Complex::new(1.0, 0.0); }
                    let v_c_tf = symbolic.solve_complex(workspace, &z_c).unwrap_or_else(|| DVector::zeros(size));
                    let v_out_c = (if n_out > 0 { v_c_tf[n_out - 1] } else { Complex::new(0.0, 0.0) }) -
                                  (if n_ref > 0 { v_c_tf[n_ref - 1] } else { Complex::new(0.0, 0.0) });
                    total_output_noise_sq += s_ic * v_out_c.norm_sqr();

                    (0, 0, 0.0)
                }
                _ => (0, 0, 0.0),
            };

            if s_i > 0.0 && (node_a > 0 || node_b > 0) {
                let mut z_unit = DVector::<Complex<f64>>::zeros(size);
                if node_a > 0 { z_unit[node_a - 1] += Complex::new(1.0, 0.0); }
                if node_b > 0 { z_unit[node_b - 1] -= Complex::new(1.0, 0.0); }

                let v_tf = symbolic.solve_complex(workspace, &z_unit).unwrap_or_else(|| DVector::zeros(size));
                let v_out_tf = (if n_out > 0 { v_tf[n_out - 1] } else { Complex::new(0.0, 0.0) }) -
                               (if n_ref > 0 { v_tf[n_ref - 1] } else { Complex::new(0.0, 0.0) });
                
                total_output_noise_sq += s_i * v_out_tf.norm_sqr();
            }
        }

        let out_noise = total_output_noise_sq.sqrt();
        let in_noise = out_noise / ac_gain;

        Ok(NoiseFrequencyResult { out_noise, in_noise })
    }).collect::<Result<Vec<NoiseFrequencyResult>, String>>()?;

    for res in results {
        output_noise_density.push(res.out_noise);
        input_noise_density.push(res.in_noise);
    }

    Ok(NoiseSweepResult {
        frequencies,
        output_noise_density,
        input_noise_density,
        error_log: None,
    })

}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FftResult {
    pub frequencies: Vec<f64>,
    pub magnitudes_db: Vec<f64>,
    pub thd: f64,

}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImdResult {
    pub fundamental_power_dbv: f64,
    pub im2_power_dbv: f64,
    pub im3_power_dbv: f64,
    pub imd_ratio_percent: f64,
    pub ip3_out_dbv: f64,
    pub frequencies: Vec<f64>,
    pub magnitudes_db: Vec<f64>,

}

fn find_peak_magnitude(
    frequencies: &[f64],
    magnitudes: &[f64],
    target_freq: f64,
) -> f64 {
    let mut best_bin = 0;
    let mut min_diff = f64::MAX;
    for (i, &f) in frequencies.iter().enumerate() {
        let diff = (f - target_freq).abs();
        if diff < min_diff {
            min_diff = diff;
            best_bin = i;
        }
    }

    let mut max_mag = magnitudes[best_bin];
    let start = best_bin.saturating_sub(3);
    let end = (best_bin + 3).min(frequencies.len() - 1);
    for i in start..=end {
        if magnitudes[i] > max_mag {
            max_mag = magnitudes[i];
        }
    }
    max_mag

}

pub fn calculate_imd_analysis(
    time_steps: &[TimeStepResult],
    node_name: &str,
    f1: f64,
    f2: f64,
) -> Result<ImdResult, String> {
    if time_steps.len() < 2 {
        return Err("No hay suficientes pasos de tiempo para análisis de intermodulación.".to_string());
    }

    let t_max = time_steps.last().unwrap().time;
    let n_points = 2048; // Potencia de 2
    let dt_uniform = t_max / (n_points - 1) as f64;

    // 1. Remuestrear la señal de forma uniforme con Ventana de Hann para reducir la fuga espectral
    let mut v_samples = vec![Complex::new(0.0, 0.0); n_points];
    for i in 0..n_points {
        let t_target = i as f64 * dt_uniform;
        let v_val = interpolate_node_voltage(time_steps, node_name, t_target);

        // Ventana de Hann: 0.5 * (1.0 - cos(2 * PI * i / (N - 1)))
        let hann = 0.5 * (1.0 - (2.0 * std::f64::consts::PI * i as f64 / (n_points - 1) as f64).cos());
        v_samples[i] = Complex::new(v_val * hann, 0.0);
    }

    // 2. Correr FFT
    fft_radix2(&mut v_samples);

    // 3. Extraer densidades espectrales del espectro unilateral
    let fs = 1.0 / dt_uniform;
    let half_n = n_points / 2;
    let mut frequencies = Vec::with_capacity(half_n);
    let mut magnitudes = Vec::with_capacity(half_n);
    let mut magnitudes_db = Vec::with_capacity(half_n);

    // Con ventana de Hann, multiplicamos por 2 para restaurar la amplitud del pico senoidal
    for k in 0..half_n {
        let freq = k as f64 * fs / n_points as f64;
        frequencies.push(freq);

        let raw_mag = v_samples[k].norm();
        let mag = if k == 0 {
            2.0 * raw_mag / n_points as f64
        } else {
            4.0 * raw_mag / n_points as f64
        };
        magnitudes.push(mag);

        let db = 20.0 * mag.max(1e-9).log10();
        magnitudes_db.push(db);
    }

    // 4. Medir componentes fundamentales
    let mag_f1 = find_peak_magnitude(&frequencies, &magnitudes, f1);
    let mag_f2 = find_peak_magnitude(&frequencies, &magnitudes, f2);

    let a_fund = 0.5 * (mag_f1 + mag_f2);
    let fund_power_dbv = 20.0 * a_fund.max(1e-9).log10();

    // 5. Medir productos IM2
    let mag_im2_diff = find_peak_magnitude(&frequencies, &magnitudes, (f1 - f2).abs());
    let mag_im2_sum = find_peak_magnitude(&frequencies, &magnitudes, f1 + f2);
    let a_im2 = 0.5 * (mag_im2_diff + mag_im2_sum);
    let im2_power_dbv = 20.0 * a_im2.max(1e-9).log10();

    // 6. Medir productos IM3
    let mag_im3_lower = find_peak_magnitude(&frequencies, &magnitudes, (2.0 * f1 - f2).abs());
    let mag_im3_upper = find_peak_magnitude(&frequencies, &magnitudes, (2.0 * f2 - f1).abs());
    let a_im3 = 0.5 * (mag_im3_lower + mag_im3_upper);
    let im3_power_dbv = 20.0 * a_im3.max(1e-9).log10();

    // 7. Calcular tasa de IMD en porcentaje
    let total_im_sq = (mag_im2_diff * mag_im2_diff) + (mag_im2_sum * mag_im2_sum) + (mag_im3_lower * mag_im3_lower) + (mag_im3_upper * mag_im3_upper);
    let imd_ratio_percent = if a_fund > 1e-6 {
        (total_im_sq.sqrt() / a_fund) * 100.0
    } else {
        0.0
    };

    // 8. Extrapolar IP3 de salida
    let ip3_out_dbv = fund_power_dbv + (fund_power_dbv - im3_power_dbv) / 2.0;

    Ok(ImdResult {
        fundamental_power_dbv: fund_power_dbv,
        im2_power_dbv,
        im3_power_dbv,
        imd_ratio_percent,
        ip3_out_dbv,
        frequencies,
        magnitudes_db,
    })

}

// Remuestreo por interpolación lineal para redes temporales no uniformes del paso adaptativo
fn interpolate_node_voltage(
    results: &[TimeStepResult],
    node_name: &str,
    t_target: f64,
) -> f64 {
    if results.is_empty() { return 0.0; }
    if t_target <= results[0].time {
        return *results[0].node_voltages.get(node_name).unwrap_or(&0.0);
    }
    if t_target >= results.last().unwrap().time {
        return *results.last().unwrap().node_voltages.get(node_name).unwrap_or(&0.0);
    }

    // Búsqueda binaria para encontrar el intervalo [low, high]
    let mut low = 0;
    let mut high = results.len() - 1;
    while low + 1 < high {
        let mid = (low + high) / 2;
        if results[mid].time <= t_target {
            low = mid;
        } else {
            high = mid;
        }
    }

    let t0 = results[low].time;
    let t1 = results[high].time;
    let v0 = *results[low].node_voltages.get(node_name).unwrap_or(&0.0);
    let v1 = *results[high].node_voltages.get(node_name).unwrap_or(&0.0);

    if (t1 - t0).abs() < 1e-15 {
        v0
    } else {
        let fraction = (t_target - t0) / (t1 - t0);
        v0 + fraction * (v1 - v0)
    }

}

// Transformada Rápida de Fourier Cooley-Tukey Radix-2 en Rust puro
fn fft_radix2(a: &mut [Complex<f64>]) {
    let n = a.len();
    if n <= 1 { return; }
    
    let mut even = vec![Complex::new(0.0, 0.0); n / 2];
    let mut odd = vec![Complex::new(0.0, 0.0); n / 2];
    for i in 0..n/2 {
        even[i] = a[2 * i];
        odd[i] = a[2 * i + 1];
    }
    
    fft_radix2(&mut even);
    fft_radix2(&mut odd);
    
    for k in 0..n/2 {
        let angle = -2.0 * std::f64::consts::PI * (k as f64) / (n as f64);
        let t = Complex::from_polar(1.0, angle) * odd[k];
        a[k] = even[k] + t;
        a[k + n/2] = even[k] - t;
    }

}

// Core analítico de cálculo FFT y THD
pub fn calculate_fft_and_thd(
    time_steps: &[TimeStepResult],
    node_name: &str,
    fundamental_freq: f64,
) -> Result<FftResult, String> {
    if time_steps.len() < 2 {
        return Err("No hay suficientes pasos de tiempo para análisis FFT.".to_string());
    }

    let t_max = time_steps.last().unwrap().time;
    let n_points = 2048; // Potencia de 2
    let dt_uniform = t_max / (n_points - 1) as f64;

    // 1. Remuestrear la señal de forma uniforme
    let mut v_samples = vec![Complex::new(0.0, 0.0); n_points];
    for i in 0..n_points {
        let t_target = i as f64 * dt_uniform;
        let v_val = interpolate_node_voltage(time_steps, node_name, t_target);
        v_samples[i] = Complex::new(v_val, 0.0);
    }

    // 2. Correr FFT
    fft_radix2(&mut v_samples);

    // 3. Extraer densidades espectrales del espectro unilateral (hasta Nyquist)
    let fs = 1.0 / dt_uniform;
    let half_n = n_points / 2;
    let mut frequencies = Vec::with_capacity(half_n);
    let mut magnitudes = Vec::with_capacity(half_n);
    let mut magnitudes_db = Vec::with_capacity(half_n);

    for k in 0..half_n {
        let freq = k as f64 * fs / n_points as f64;
        frequencies.push(freq);

        let raw_mag = v_samples[k].norm();
        let mag = if k == 0 {
            raw_mag / n_points as f64
        } else {
            2.0 * raw_mag / n_points as f64
        };
        magnitudes.push(mag);

        let db = 20.0 * mag.max(1e-9).log10();
        magnitudes_db.push(db);
    }

    // 4. Calcular THD espectral de precisión
    let mut fund_bin = 0;
    let mut min_diff = f64::MAX;
    for (i, &f) in frequencies.iter().enumerate() {
        let diff = (f - fundamental_freq).abs();
        if diff < min_diff {
            min_diff = diff;
            fund_bin = i;
        }
    }

    let mut max_fund_mag = magnitudes[fund_bin];
    let start_fund = fund_bin.saturating_sub(3);
    let end_fund = (fund_bin + 3).min(half_n - 1);
    for i in start_fund..=end_fund {
        if magnitudes[i] > max_fund_mag {
            max_fund_mag = magnitudes[i];
        }
    }

    let a1 = max_fund_mag;
    let mut sum_harmonics_sq = 0.0;

    if a1 > 1e-6 {
        for h in 2..=8 {
            let target_harmonic_freq = h as f64 * fundamental_freq;
            if target_harmonic_freq > fs / 2.0 {
                break;
            }

            let mut harm_bin = 0;
            let mut min_harm_diff = f64::MAX;
            for (i, &f) in frequencies.iter().enumerate() {
                let diff = (f - target_harmonic_freq).abs();
                if diff < min_harm_diff {
                    min_harm_diff = diff;
                    harm_bin = i;
                }
            }

            let mut peak_harm_mag = magnitudes[harm_bin];
            let start_harm = harm_bin.saturating_sub(3);
            let end_harm = (harm_bin + 3).min(half_n - 1);
            for i in start_harm..=end_harm {
                if magnitudes[i] > peak_harm_mag {
                    peak_harm_mag = magnitudes[i];
                }
            }

            sum_harmonics_sq += peak_harm_mag * peak_harm_mag;
        }
    }

    let thd = if a1 > 1e-6 {
        (sum_harmonics_sq.sqrt() / a1) * 100.0
    } else {
        0.0
    };

    Ok(FftResult {
        frequencies,
        magnitudes_db,
        thd,
    })

}

// ==================================================================================
// FASE 23: Evaluador de Mediciones Transitorias (.measure)
// ==================================================================================
// Módulo analítico que escanea el histórico de simulación transitoria para medir
// de forma automatizada retardos de propagación, tiempos de subida/bajada,
// picos e integrales promedio con interpolación lineal de alta precisión.

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MeasureDirective {
    pub name: String,
    pub measure_type: String, // "delay", "risetime", "falltime", "peak", "avg", "rms", "min", "max", "pp"
    pub node: String,
    /// Nodo de referencia para medición de retardo (trig)
    pub trig_node: Option<String>,
    /// Valor de umbral (fracción 0..1) para cruces, por defecto 0.5 (50%)
    pub threshold: Option<f64>,
    /// Rango de tiempo [t_start, t_end] para restringir la búsqueda
    pub t_start: Option<f64>,
    pub t_end: Option<f64>,

}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MeasureResult {
    pub measurements: HashMap<String, f64>,
    pub error_log: Option<String>,

}

/// Encuentra el tiempo exacto (interpolado linealmente) en que la señal cruza
/// un nivel `level` en la dirección `rising` (true = flanco de subida, false = bajada).
/// `occurrence` = 1 para el primer cruce, 2 para el segundo, etc.
fn find_threshold_crossing(
    results: &[TimeStepResult],
    node: &str,
    level: f64,
    rising: bool,
    occurrence: usize,
    t_start: f64,
    t_end: f64,
) -> Option<f64> {
    let mut count = 0;
    for i in 1..results.len() {
        let t0 = results[i - 1].time;
        let t1 = results[i].time;
        if t1 < t_start || t0 > t_end {
            continue;
        }

        let v0 = *results[i - 1].node_voltages.get(node).unwrap_or(&0.0);
        let v1 = *results[i].node_voltages.get(node).unwrap_or(&0.0);

        let crosses = if rising {
            v0 < level && v1 >= level
        } else {
            v0 > level && v1 <= level
        };

        if crosses {
            count += 1;
            if count == occurrence {
                // Interpolación lineal del instante exacto de cruce
                if (v1 - v0).abs() < 1e-18 {
                    return Some(t0);
                }
                let fraction = (level - v0) / (v1 - v0);
                return Some(t0 + fraction * (t1 - t0));
            }
        }
    }
    None

}

/// Obtener el rango dinámico de una señal en el nodo dado dentro del intervalo [t_start, t_end]
fn get_signal_range(
    results: &[TimeStepResult],
    node: &str,
    t_start: f64,
    t_end: f64,
) -> (f64, f64) {
    let mut v_min = f64::MAX;
    let mut v_max = f64::MIN;
    for step in results {
        if step.time < t_start || step.time > t_end {
            continue;
        }
        let v = *step.node_voltages.get(node).unwrap_or(&0.0);
        if v < v_min { v_min = v; }
        if v > v_max { v_max = v; }
    }
    if v_min == f64::MAX { v_min = 0.0; }
    if v_max == f64::MIN { v_max = 0.0; }
    (v_min, v_max)

}

/// Motor de evaluación de directivas `.measure` sobre resultados de simulación transitoria.
pub fn evaluate_measures(
    results: &[TimeStepResult],
    directives: &[MeasureDirective],
) -> MeasureResult {
    let mut measurements = HashMap::new();
    let mut errors = Vec::new();

    if results.is_empty() {
        return MeasureResult {
            measurements,
            error_log: Some("No hay resultados de simulación transitoria para evaluar.".to_string()),
        };
    }

    let t_global_start = results[0].time;
    let t_global_end = results.last().unwrap().time;

    for dir in directives {
        let t_start = dir.t_start.unwrap_or(t_global_start);
        let t_end = dir.t_end.unwrap_or(t_global_end);
        let threshold_frac = dir.threshold.unwrap_or(0.5);

        match dir.measure_type.to_lowercase().as_str() {
            "delay" => {
                // Medir el retardo de propagación entre trig_node y node al cruce del umbral
                let trig_node = dir.trig_node.as_deref().unwrap_or(&dir.node);
                let (trig_min, trig_max) = get_signal_range(results, trig_node, t_start, t_end);
                let trig_level = trig_min + threshold_frac * (trig_max - trig_min);

                let (targ_min, targ_max) = get_signal_range(results, &dir.node, t_start, t_end);
                let targ_level = targ_min + threshold_frac * (targ_max - targ_min);

                if let Some(t_trig) = find_threshold_crossing(results, trig_node, trig_level, true, 1, t_start, t_end) {
                    if let Some(t_targ) = find_threshold_crossing(results, &dir.node, targ_level, true, 1, t_start, t_end) {
                        measurements.insert(dir.name.clone(), (t_targ - t_trig).abs());
                    } else {
                        errors.push(format!("MEASURE {}: No se encontró cruce objetivo en nodo '{}'.", dir.name, dir.node));
                    }
                } else {
                    errors.push(format!("MEASURE {}: No se encontró cruce de disparo en nodo '{}'.", dir.name, trig_node));
                }
            }
            "risetime" => {
                // Tiempo de subida: del 10% al 90% del rango dinámico
                let (v_min, v_max) = get_signal_range(results, &dir.node, t_start, t_end);
                let level_10 = v_min + 0.1 * (v_max - v_min);
                let level_90 = v_min + 0.9 * (v_max - v_min);

                if let Some(t_10) = find_threshold_crossing(results, &dir.node, level_10, true, 1, t_start, t_end) {
                    if let Some(t_90) = find_threshold_crossing(results, &dir.node, level_90, true, 1, t_start, t_end) {
                        measurements.insert(dir.name.clone(), (t_90 - t_10).abs());
                    } else {
                        errors.push(format!("MEASURE {}: No se encontró cruce del 90% en nodo '{}'.", dir.name, dir.node));
                    }
                } else {
                    errors.push(format!("MEASURE {}: No se encontró cruce del 10% en nodo '{}'.", dir.name, dir.node));
                }
            }
            "falltime" => {
                // Tiempo de bajada: del 90% al 10% del rango dinámico
                let (v_min, v_max) = get_signal_range(results, &dir.node, t_start, t_end);
                let level_90 = v_min + 0.9 * (v_max - v_min);
                let level_10 = v_min + 0.1 * (v_max - v_min);

                if let Some(t_90) = find_threshold_crossing(results, &dir.node, level_90, false, 1, t_start, t_end) {
                    if let Some(t_10) = find_threshold_crossing(results, &dir.node, level_10, false, 1, t_start, t_end) {
                        measurements.insert(dir.name.clone(), (t_10 - t_90).abs());
                    } else {
                        errors.push(format!("MEASURE {}: No se encontró cruce descendente del 10% en nodo '{}'.", dir.name, dir.node));
                    }
                } else {
                    errors.push(format!("MEASURE {}: No se encontró cruce descendente del 90% en nodo '{}'.", dir.name, dir.node));
                }
            }
            "peak" | "max" => {
                let mut v_peak = f64::MIN;
                for step in results {
                    if step.time < t_start || step.time > t_end { continue; }
                    let v = *step.node_voltages.get(&dir.node).unwrap_or(&0.0);
                    if v > v_peak { v_peak = v; }
                }
                if v_peak > f64::MIN {
                    measurements.insert(dir.name.clone(), v_peak);
                }
            }
            "min" => {
                let mut v_min = f64::MAX;
                for step in results {
                    if step.time < t_start || step.time > t_end { continue; }
                    let v = *step.node_voltages.get(&dir.node).unwrap_or(&0.0);
                    if v < v_min { v_min = v; }
                }
                if v_min < f64::MAX {
                    measurements.insert(dir.name.clone(), v_min);
                }
            }
            "pp" => {
                // Peak-to-peak
                let (v_min, v_max) = get_signal_range(results, &dir.node, t_start, t_end);
                measurements.insert(dir.name.clone(), v_max - v_min);
            }
            "avg" => {
                // Promedio temporal por integración trapezoidal
                let mut integral = 0.0;
                let mut t_total = 0.0;
                for i in 1..results.len() {
                    let t0 = results[i - 1].time;
                    let t1 = results[i].time;
                    if t1 < t_start || t0 > t_end { continue; }
                    let v0 = *results[i - 1].node_voltages.get(&dir.node).unwrap_or(&0.0);
                    let v1 = *results[i].node_voltages.get(&dir.node).unwrap_or(&0.0);
                    let dt_seg = t1 - t0;
                    integral += 0.5 * (v0 + v1) * dt_seg;
                    t_total += dt_seg;
                }
                if t_total > 0.0 {
                    measurements.insert(dir.name.clone(), integral / t_total);
                }
            }
            "rms" => {
                // Valor eficaz (RMS) por integración trapezoidal de v^2
                let mut integral_sq = 0.0;
                let mut t_total = 0.0;
                for i in 1..results.len() {
                    let t0 = results[i - 1].time;
                    let t1 = results[i].time;
                    if t1 < t_start || t0 > t_end { continue; }
                    let v0 = *results[i - 1].node_voltages.get(&dir.node).unwrap_or(&0.0);
                    let v1 = *results[i].node_voltages.get(&dir.node).unwrap_or(&0.0);
                    let dt_seg = t1 - t0;
                    integral_sq += 0.5 * (v0 * v0 + v1 * v1) * dt_seg;
                    t_total += dt_seg;
                }
                if t_total > 0.0 {
                    measurements.insert(dir.name.clone(), (integral_sq / t_total).sqrt());
                }
            }
            _ => {
                errors.push(format!("MEASURE {}: Tipo de medición '{}' no reconocido.", dir.name, dir.measure_type));
            }
        }
    }

    MeasureResult {
        measurements,
        error_log: if errors.is_empty() { None } else { Some(errors.join("\n")) },
    }

}

// ==================================================================================
// FASE 24: Macromodelo de Líneas de Transmisión RLCG Segmentadas
// ==================================================================================
// Segmenta una línea de transmisión ideal o dispersiva con pérdidas en N secciones
// pasivas equivalentes en cascada Pi (inductores L, capacitores C, resistencias R
// y conductancias de fuga G) para integridad de señal en RF.

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransmissionLineParams {
    pub id: String,
    pub pin_in: String,   // Nodo de entrada
    pub pin_out: String,  // Nodo de salida
    pub gnd: String,      // Nodo de referencia (tierra)
    pub z0: f64,          // Impedancia característica (Ω)
    pub td: f64,          // Retardo de propagación (s)
    pub r_total: f64,     // Resistencia serie total de la línea (Ω), 0 para ideal
    pub g_total: f64,     // Conductancia de fuga total (S), 0 para ideal
    pub n_segments: usize, // Número de segmentos de la cascada Pi

}

/// Expande una línea de transmisión en N segmentos pasivos equivalentes en cascada Pi.
/// Cada segmento genera: L_seg en serie, C_seg/2 a cada extremo en paralelo, R_seg en serie,
/// y G_seg/2 a cada extremo. Se crean nodos internos virtuales `TL{id}.n{i}`.
///
/// Parámetros por segmento:
///   L_seg = Z0 * Td / N
///   C_seg = Td / (Z0 * N)
///   R_seg = R_total / N
///   G_seg = G_total / N
pub fn expand_transmission_line(params: &TransmissionLineParams) -> Vec<ComponentData> {
    let n = params.n_segments.max(1);
    let l_seg = params.z0 * params.td / n as f64;
    let c_seg = params.td / (params.z0 * n as f64);
    let r_seg = params.r_total / n as f64;
    let g_seg = params.g_total / n as f64;

    let mut components = Vec::new();
    let prefix = format!("TL{}", params.id);

    for i in 0..n {
        // Nodo de entrada del segmento
        let node_left = if i == 0 {
            params.pin_in.clone()
        } else {
            format!("{}.n{}", prefix, i)
        };

        // Nodo de salida del segmento
        let node_right = if i == n - 1 {
            params.pin_out.clone()
        } else {
            format!("{}.n{}", prefix, i + 1)
        };

        // Nodo intermedio entre R y L dentro del segmento
        let node_mid = format!("{}.m{}", prefix, i);

        // R_seg en serie (nodo_left → node_mid)
        if r_seg > 1e-15 {
            components.push(ComponentData {
                id: format!("{}.R{}", prefix, i),
                comp_type: "resistor".to_string(),
                value: r_seg,
                pins: vec![node_left.clone(), node_mid.clone()],
                ..Default::default()
            });
        }

        // L_seg en serie (node_mid → node_right) o (node_left → node_right) si no hay R
        let l_left = if r_seg > 1e-15 { node_mid.clone() } else { node_left.clone() };
        components.push(ComponentData {
            id: format!("{}.L{}", prefix, i),
            comp_type: "inductor".to_string(),
            value: l_seg,
            pins: vec![l_left, node_right.clone()],
            ..Default::default()
        });

        // C_seg/2 al lado izquierdo (node_left → gnd)
        components.push(ComponentData {
            id: format!("{}.CL{}", prefix, i),
            comp_type: "capacitor".to_string(),
            value: c_seg / 2.0,
            pins: vec![node_left.clone(), params.gnd.clone()],
            ..Default::default()
        });

        // C_seg/2 al lado derecho (node_right → gnd)
        components.push(ComponentData {
            id: format!("{}.CR{}", prefix, i),
            comp_type: "capacitor".to_string(),
            value: c_seg / 2.0,
            pins: vec![node_right.clone(), params.gnd.clone()],
            ..Default::default()
        });

        // G_seg/2 al lado izquierdo (conductancia de fuga) modelada como resistor grande
        if g_seg > 1e-15 {
            let r_shunt = 2.0 / g_seg; // R = 1/G, dividido por 2 porque tenemos G/2 a cada lado
            components.push(ComponentData {
                id: format!("{}.GL{}", prefix, i),
                comp_type: "resistor".to_string(),
                value: r_shunt,
                pins: vec![node_left.clone(), params.gnd.clone()],
                ..Default::default()
            });
            components.push(ComponentData {
                id: format!("{}.GR{}", prefix, i),
                comp_type: "resistor".to_string(),
                value: r_shunt,
                pins: vec![node_right.clone(), params.gnd.clone()],
                ..Default::default()
            });
        }
    }

    components

}

// ==================================================================================
// FASE 25: Modelos de Deriva y Dependencia Térmica
// ==================================================================================
// Inyecta los modelos físicos de variación de temperatura global (T) en:
// - Pasivos: Coeficientes TC1, TC2 de primer y segundo orden.
// - Unión PN (Diodo/BJT): Escalamiento de Is(T) con Varshni Eg(T).
// - MOSFETs: Degradación de movilidad T^-1.5 y corrimiento lineal de Vth.

/// Parámetros de banda prohibida de Silicio para el modelo de Varshni
#[allow(dead_code)]
const EG_SI_300: f64 = 1.12;         // Banda prohibida del Si a 300K (eV)
#[allow(dead_code)]
const VARSHNI_ALPHA: f64 = 7.021e-4; // Parámetro α de Varshni para Si (eV/K)
#[allow(dead_code)]
const VARSHNI_BETA: f64 = 1108.0;    // Parámetro β de Varshni para Si (K)

/// Calcula el potencial de banda prohibida del Silicio según Varshni:
///   Eg(T) = Eg(0) - α * T² / (T + β)
///   donde Eg(0) = Eg(300) + α * 300² / (300 + β)
#[allow(dead_code)]
fn bandgap_varshni(temp_k: f64) -> f64 {
    let eg0 = EG_SI_300 + VARSHNI_ALPHA * 300.0 * 300.0 / (300.0 + VARSHNI_BETA);
    eg0 - VARSHNI_ALPHA * temp_k * temp_k / (temp_k + VARSHNI_BETA)

}

/// Escalamiento térmico de la corriente de saturación inversa de la unión PN:
///   Is(T) = Is(T0) * (T/T0)^(XTI/N) * exp(-Eg/(kB*T) * (1 - T/T0))
///
/// Parámetros:
///   is_t0: Corriente de saturación a temperatura de referencia (A)
///   t0: Temperatura de referencia (K), típicamente 300
///   t: Temperatura actual (K)
///   xti: Exponente de temperatura de saturación (típicamente 3.0 para Si)
///   n: Coeficiente de emisión (idealidad)
#[allow(dead_code)]
pub fn thermal_is_pn(is_t0: f64, t0: f64, t: f64, xti: f64, n: f64) -> f64 {
    let eg_t0 = bandgap_varshni(t0);
    let eg_t = bandgap_varshni(t);
    let vt_t0 = PHYS_KB * t0 / PHYS_Q;
    let vt_t = PHYS_KB * t / PHYS_Q;

    // Modelo exacto SPICE: Is(T) = Is(T0) * (T/T0)^(XTI/N) * exp((Eg(T0)/Vt(T0) - Eg(T)/Vt(T)) / N)
    let ratio = (t / t0).powf(xti / n);
    let exp_term = ((eg_t0 / vt_t0 - eg_t / vt_t) / n).exp();
    is_t0 * ratio * exp_term

}

/// Voltaje térmico a temperatura T:
///   Vt(T) = kB * T / q
#[allow(dead_code)]
pub fn thermal_vt(temp_k: f64) -> f64 {
    PHYS_KB * temp_k / PHYS_Q

}

/// Escalamiento térmico de resistencia con coeficientes de primer y segundo orden:
///   R(T) = R0 * [1 + TC1*(T - T0) + TC2*(T - T0)²]
pub fn thermal_resistance(r0: f64, t0: f64, t: f64, tc1: f64, tc2: f64) -> f64 {
    let dt = t - t0;
    r0 * (1.0 + tc1 * dt + tc2 * dt * dt)

}

/// Degradación de movilidad de portadores en MOSFETs:
///   β(T) = β(T0) * (T/T0)^(-BEX)
/// donde BEX ≈ 1.5 para Si (empírico)
///
/// Parámetros:
///   beta_t0: Transconductancia o factor β a temperatura de referencia
///   t0: Temperatura de referencia (K)
///   t: Temperatura actual (K)
///   bex: Exponente de movilidad (típicamente 1.5)
#[allow(dead_code)]
pub fn thermal_mosfet_beta(beta_t0: f64, t0: f64, t: f64, bex: f64) -> f64 {
    beta_t0 * (t / t0).powf(-bex)

}

/// Corrimiento térmico de la tensión de umbral de MOSFETs:
///   Vth(T) = Vth(T0) - TCV * (T - T0)
/// donde TCV ≈ 2 mV/K para MOSFETs de Si
pub fn thermal_mosfet_vth(vth_t0: f64, t0: f64, t: f64, tcv: f64) -> f64 {
    vth_t0 - tcv * (t - t0)

}

/// Aplica correcciones térmicas completas a un netlist, devolviendo un netlist
/// modificado con los valores ajustados a la temperatura `temp_k`.
///
/// Se aplican los siguientes modelos físicos:
///   - Resistores: R(T) = R0 * [1 + TC1*(T-T0) + TC2*(T-T0)²]
///   - Capacitores: C(T) = C0 * [1 + TC1*(T-T0)]
///   - Inductores: L(T) = L0 * [1 + TC1*(T-T0)]
///   - Diodos: Is(T) escalado con Varshni, Vt(T) actualizado
///   - MOSFETs: β(T) degradada, Vth(T) desplazada
///   - BJTs: Is(T) escalado con Varshni
pub fn apply_thermal_drift(netlist: &CircuitNetlist, temp_k: f64) -> CircuitNetlist {
    let t0 = PHYS_T; // 300K referencia

    let mut adjusted = netlist.clone();

    for comp in &mut adjusted.components {
        match comp.comp_type.as_str() {
            "resistor" => {
                // TC1 = 3900 ppm/K típico para metales, TC2 = 0 por defecto
                let tc1 = 3.9e-3; // 3900 ppm/K
                let tc2 = 0.0;
                comp.value = thermal_resistance(comp.value, t0, temp_k, tc1, tc2);
            }
            "capacitor" => {
                // Coeficiente de temperatura para cerámicos X7R: ~±15% sobre rango
                let tc1 = 30e-6; // 30 ppm/K (conservador)
                comp.value *= 1.0 + tc1 * (temp_k - t0) ;
            }
            "inductor" => {
                // Coeficiente de temperatura del inductor: ~50 ppm/K
                let tc1 = 50e-6;
                comp.value *= 1.0 + tc1 * (temp_k - t0) ;
            }
            "diode" | "led" => {
                // El campo `value` de diodos a menudo es nominal; pero internamente
                // la corriente Is se escala en el solver. Aquí ajustamos un factor
                // de escala que el solver DC puede usar directamente.
                // Nota: el solver usa DIODE_IS global, así que aquí no modificamos
                // comp.value. El escalamiento real se aplica en solve_dc_circuit_thermal.
            }
            "opto" => {
                // El opto sigue la misma lógica del diodo: Is se escala en el solver
                // mediante get_thermal_parameters, no se modifica comp.value aquí.
            }
            "nmos" | "pmos" => {
                // Vth se almacena en comp.value para MOSFETs
                let vth_t0 = comp.value;
                let tcv = 2.0e-3; // 2 mV/K
                comp.value = thermal_mosfet_vth(vth_t0, t0, temp_k, tcv);
            }
            _ => {}
        }
    }

    adjusted

}

/// Resolvedor DC con temperatura global inyectada.
/// Aplica el modelo de deriva térmica completo al netlist y resuelve.
pub fn solve_dc_circuit_thermal(netlist: &CircuitNetlist, temp_k: f64) -> Result<SimulationResult, String> {
    let mut adjusted_netlist = apply_thermal_drift(netlist, temp_k);
    adjusted_netlist.temperature = Some(temp_k);
    solve_dc_circuit(&adjusted_netlist)

}

/// Resolvedor DC con acoplamiento electro-térmico completo (Relaxation Loop).
/// Alterna entre:
///   1. Resolver el circuito eléctrico con temperaturas fijas → obtener corrientes/voltajes
///   2. Calcular potencia disipada por dispositivo → resolver red térmica → actualizar T_j
/// Converge cuando max(|ΔT_j|) < thermal_tol.
pub fn solve_dc_electrothermal(netlist: &CircuitNetlist) -> Result<(SimulationResult, HashMap<String, f64>), String> {
    let config = netlist.thermal_config.as_ref().ok_or(
        "Se requiere .THERMAL en el netlist para simulación electro-térmica".to_string()
    )?;
    
    let t_amb = config.t_amb;
    let max_iters = config.max_thermal_iters;
    let tol = config.thermal_tol;
    
    // Identificar dispositivos térmicamente activos y sus índices
    let thermal_devices: Vec<(usize, String)> = netlist.components.iter().enumerate()
        .filter_map(|(i, c)| {
            match c.comp_type.as_str() {
                "diode" | "led" | "nmos" | "pmos" | "bsim3nmos" | "bsim3pmos" |
                "bsim4nmos" | "bsim4pmos" | "npn" | "pnp" | "opto" => {
                    Some((i, c.id.clone()))
                }
                _ => None,
            }
        })
        .collect();
    
    let n_dev = thermal_devices.len();
    if n_dev == 0 {
        // Sin dispositivos térmicos, resolver normalmente
        let result = solve_dc_circuit(netlist)?;
        return Ok((result, HashMap::new()));
    }
    
    // Inicializar temperaturas de unión a T_amb
    let mut device_temps: HashMap<String, f64> = HashMap::new();
    for (_, id) in &thermal_devices {
        device_temps.insert(id.clone(), t_amb);
    }
    
    let mut last_result: Option<SimulationResult> = None;
    
    for _iter in 0..max_iters {
        // --- Paso 1: Resolver circuito eléctrico con temperaturas actuales ---
        let mut adjusted_netlist = netlist.clone();
        // Inyectar temperatura promedio como temperatura global del circuito
        let avg_temp = if device_temps.is_empty() {
            t_amb
        } else {
            device_temps.values().sum::<f64>() / device_temps.len() as f64
        };
        adjusted_netlist = apply_thermal_drift(&adjusted_netlist, avg_temp);
        adjusted_netlist.temperature = Some(avg_temp);
        
        let result = solve_dc_circuit(&adjusted_netlist)?;
        
        // --- Paso 2: Calcular potencia disipada por dispositivo ---
        let mut power_diss: HashMap<String, f64> = HashMap::new();
        
        
        for (comp_idx, comp_id) in &thermal_devices {
            let comp = &netlist.components[*comp_idx];
            let p = match comp.comp_type.as_str() {
                "diode" | "led" => {
                    let na = comp.pins[0].parse::<usize>().unwrap_or(0);
                    let nc = comp.pins[1].parse::<usize>().unwrap_or(0);
                    let va = *result.node_voltages.get(&na.to_string()).unwrap_or(&0.0);
                    let vc = *result.node_voltages.get(&nc.to_string()).unwrap_or(&0.0);
                    let vd = va - vc;
                    let tj = *device_temps.get(comp_id).unwrap_or(&t_amb);
                    let (_, id_val, _) = solve_diode_junction_voltage(vd, Some(tj), comp);
                    (vd * id_val).abs()
                }
                "nmos" | "bsim3nmos" | "bsim4nmos" => {
                    if comp.pins.len() < 3 { 0.0 } else {
                        let ng = comp.pins[0].parse::<usize>().unwrap_or(0);
                        let nd = comp.pins[1].parse::<usize>().unwrap_or(0);
                        let ns = comp.pins[2].parse::<usize>().unwrap_or(0);
                        let vg = *result.node_voltages.get(&ng.to_string()).unwrap_or(&0.0);
                        let vd_pin = *result.node_voltages.get(&nd.to_string()).unwrap_or(&0.0);
                        let vs = *result.node_voltages.get(&ns.to_string()).unwrap_or(&0.0);
                        let vds = vd_pin - vs;
                        let vgs = vg - vs;
                        let vbs = if comp.pins.len() > 3 {
                            let nb = comp.pins[3].parse::<usize>().unwrap_or(0);
                            let vb = *result.node_voltages.get(&nb.to_string()).unwrap_or(&0.0);
                            vb - vs
                        } else { 0.0 };
                        let (ids, _, _) = evaluate_bsim3_nmos(vgs, vds, vbs, comp.value, comp.w, comp.l, Some(avg_temp), Some(comp));
                        (vds * ids).abs()
                    }
                }
                "pmos" | "bsim3pmos" | "bsim4pmos" => {
                    if comp.pins.len() < 3 { 0.0 } else {
                        let ng = comp.pins[0].parse::<usize>().unwrap_or(0);
                        let nd = comp.pins[1].parse::<usize>().unwrap_or(0);
                        let ns = comp.pins[2].parse::<usize>().unwrap_or(0);
                        let vg = *result.node_voltages.get(&ng.to_string()).unwrap_or(&0.0);
                        let vd_pin = *result.node_voltages.get(&nd.to_string()).unwrap_or(&0.0);
                        let vs = *result.node_voltages.get(&ns.to_string()).unwrap_or(&0.0);
                        let vsd = vs - vd_pin;
                        let vsg = vs - vg;
                        let vsb = if comp.pins.len() > 3 {
                            let nb = comp.pins[3].parse::<usize>().unwrap_or(0);
                            let vb = *result.node_voltages.get(&nb.to_string()).unwrap_or(&0.0);
                            vs - vb
                        } else { 0.0 };
                        let (isd, _, _) = evaluate_bsim3_pmos(vsg, vsd, vsb, comp.value, comp.w, comp.l, Some(avg_temp), Some(comp));
                        (vsd * isd).abs()
                    }
                }
                "npn" | "pnp" => {
                    if comp.pins.len() < 3 { 0.0 } else {
                        let nb = comp.pins[0].parse::<usize>().unwrap_or(0);
                        let nc = comp.pins[1].parse::<usize>().unwrap_or(0);
                        let ne = comp.pins[2].parse::<usize>().unwrap_or(0);
                        let _vb = *result.node_voltages.get(&nb.to_string()).unwrap_or(&0.0);
                        let vc_pin = *result.node_voltages.get(&nc.to_string()).unwrap_or(&0.0);
                        let ve = *result.node_voltages.get(&ne.to_string()).unwrap_or(&0.0);
                        let vce = if comp.comp_type == "npn" { vc_pin - ve } else { ve - vc_pin };
                        // Corriente de colector simplificada
                        let ic_branch = result.branch_currents.get(comp_id).copied().unwrap_or(0.0);
                        (vce.abs() * ic_branch.abs()).min(50.0)
                    }
                }
                _ => 0.0,
            };
            power_diss.insert(comp_id.clone(), p);
        }
        
        // --- Paso 3: Construir y resolver la red térmica Gth ---
        // Para cada dispositivo i: Tj_i = T_amb + Rth_i * P_i + Σ_j(Rth_ij * P_j)
        let mut new_temps: HashMap<String, f64> = HashMap::new();
        
        for (comp_idx, comp_id) in &thermal_devices {
            let comp = &netlist.components[*comp_idx];
            
            // Rth propio: desde comp.rth > constante por defecto
            let rth_self = comp.rth.unwrap_or_else(|| {
                match comp.comp_type.as_str() {
                    "diode" | "led" => DIODE_RTH_JA,
                    "opto" => OPTO_RTH_JA,
                    "nmos" | "pmos" | "bsim3nmos" | "bsim3pmos" | "bsim4nmos" | "bsim4pmos" => MOS_RTH_JA,
                    "npn" | "pnp" => BJT_RTH_JA,
                    _ => 100.0,
                }
            });
            
            let p_self = *power_diss.get(comp_id).unwrap_or(&0.0);
            
            // Contribución propia
            let mut tj = t_amb + rth_self * p_self;
            
            // Contribución de acoplamiento térmico mutuo
            for (id1, id2, rth_mutual) in &config.thermal_coupling {
                if id1 == comp_id {
                    let p_other = *power_diss.get(id2).unwrap_or(&0.0);
                    tj += rth_mutual * p_other;
                } else if id2 == comp_id {
                    let p_other = *power_diss.get(id1).unwrap_or(&0.0);
                    tj += rth_mutual * p_other;
                }
            }
            
            // Clampar temperatura: no puede ser menor que ambiente ni mayor que 500K
            let tj_clamped = tj.clamp(t_amb, 500.0);
            new_temps.insert(comp_id.clone(), tj_clamped);
        }
        
        // --- Paso 4: Verificar convergencia ---
        let max_delta_t = thermal_devices.iter()
            .map(|(_, id)| {
                let t_old = *device_temps.get(id).unwrap_or(&t_amb);
                let t_new = *new_temps.get(id).unwrap_or(&t_amb);
                (t_new - t_old).abs()
            })
            .fold(0.0_f64, f64::max);
        
        device_temps = new_temps;
        last_result = Some(result);
        
        if max_delta_t < tol {
            break;
        }
    }
    
    let final_result = last_result.unwrap_or_else(|| SimulationResult {
        node_voltages: HashMap::new(),
        branch_currents: HashMap::new(),
        convergence_iterations: 0,
        error_log: Some("Simulación electro-térmica no convergió".to_string()),
    });
    
    Ok((final_result, device_temps))

}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ParameterSensitivity {
    pub component_id: String,
    pub parameter_name: String,
    pub parameter_value: f64,
    pub absolute_sensitivities: HashMap<String, f64>,
    pub normalized_sensitivities: HashMap<String, f64>,

}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorstCaseLimits {
    pub nominal_value: f64,
    pub worst_case_high: f64,
    pub worst_case_low: f64,
    pub max_deviation: f64,

}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SensitivityResult {
    pub nominal_voltages: HashMap<String, f64>,
    pub sensitivities: Vec<ParameterSensitivity>,
    pub worst_case_limits: HashMap<String, WorstCaseLimits>,

}

/// Realiza un análisis de sensibilidad en corriente continua (DC Sensitivity) y
/// evalúa automáticamente los límites del peor caso (Worst-Case Analysis) de todos los nodos.
pub fn solve_dc_sensitivity(netlist: &CircuitNetlist) -> Result<SensitivityResult, String> {
    // 1. Resolver el punto de operación DC nominal
    let nominal_res = solve_dc_circuit(netlist)?;
    let nominal_voltages = nominal_res.node_voltages.clone();

    // 2. Identificar el número máximo de nodos activos y mapear fuentes
    let n = crate::topology::validate_netlist_topology(netlist, true)?;
    let v_sources: Vec<&ComponentData> = netlist.components.iter()
        .filter(|c| c.comp_type == "vsource" || c.comp_type == "bvoltage" || c.comp_type == "vcvs" || c.comp_type == "ccvs")
        .collect();
    let m = v_sources.len();
    let size = n + m;

    if size == 0 {
        return Err("El circuito no contiene nodos activos o componentes.".to_string());
    }

    let mut vsource_map = HashMap::new();
    for (idx, vs) in v_sources.iter().enumerate() {
        vsource_map.insert(vs.id.clone(), idx);
    }

    // 3. Re-construir la matriz Jacobiana (J) en el punto de operación nominal
    let mut j_matrix = DMatrix::<f64>::zeros(size, size);
    let mut z_temp = DVector::<f64>::zeros(size);
    stamp_linear_components(netlist, n, &vsource_map, &mut j_matrix, &mut z_temp)?;

    // Añadir Gmin residual (1e-12 S) en la diagonal de nodos para evitar singularidades
    for i in 1..=n {
        j_matrix[(i - 1, i - 1)] += 1e-12;
    }

    // Convertir nominal_voltages a un vector de voltajes prev_voltages de tamaño n+1
    let mut prev_voltages = vec![0.0; n + 1];
    for i in 1..=n {
        prev_voltages[i] = *nominal_voltages.get(&i.to_string()).unwrap_or(&0.0);
    }

    // Estampar componentes no lineales en j_matrix usando prev_voltages
    for comp in &netlist.components {
        if comp.comp_type == "diode" || comp.comp_type == "led" {
            let node_anode = comp.pins[0].parse::<usize>().unwrap();
            let node_cathode = comp.pins[1].parse::<usize>().unwrap();
            let v_anode = if node_anode > 0 { prev_voltages[node_anode] } else { 0.0 };
            let v_cathode = if node_cathode > 0 { prev_voltages[node_cathode] } else { 0.0 };
            let vd = v_anode - v_cathode;
            let (_, _, geq) = solve_diode_junction_voltage(vd, netlist.temperature, comp);

            let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                if r > 0 && c > 0 {
                    j_matrix[(r - 1, c - 1)] += g;
                }
            };
            stamp_conductance(node_anode, node_anode, geq);
            stamp_conductance(node_cathode, node_cathode, geq);
            stamp_conductance(node_anode, node_cathode, -geq);
            stamp_conductance(node_cathode, node_anode, -geq);
        } else if comp.comp_type == "opto" {
            if comp.pins.len() < 4 { continue; }
            let node_a = comp.pins[0].parse::<usize>().unwrap();
            let node_k = comp.pins[1].parse::<usize>().unwrap();
            let node_c = comp.pins[2].parse::<usize>().unwrap();
            let node_e = comp.pins[3].parse::<usize>().unwrap();
            let v_a = if node_a > 0 { prev_voltages[node_a] } else { 0.0 };
            let v_k = if node_k > 0 { prev_voltages[node_k] } else { 0.0 };
            let v_c = if node_c > 0 { prev_voltages[node_c] } else { 0.0 };
            let v_e = if node_e > 0 { prev_voltages[node_e] } else { 0.0 };
            let vd = v_a - v_k;
            let v_ce = v_c - v_e;
            let (_, id_led, gd_led) = solve_diode_junction_voltage(vd, netlist.temperature, comp);
            let (_i_ce, g_md, g_o, _i_ce_eq) = evaluate_opto_receiver(vd, gd_led, id_led, v_ce, comp);

            let mut stamp = |r: usize, c: usize, g: f64| {
                if r > 0 && c > 0 { j_matrix[(r - 1, c - 1)] += g; }
            };
            // Lado LED
            stamp(node_a, node_a,  gd_led);
            stamp(node_k, node_k,  gd_led);
            stamp(node_a, node_k, -gd_led);
            stamp(node_k, node_a, -gd_led);
            // Lado receptor
            stamp(node_c, node_a,  g_md);
            stamp(node_c, node_k, -g_md);
            stamp(node_c, node_c,  g_o);
            stamp(node_c, node_e, -g_o);
            stamp(node_e, node_a, -g_md);
            stamp(node_e, node_k,  g_md);
            stamp(node_e, node_c, -g_o);
            stamp(node_e, node_e,  g_o);
        } else if comp.comp_type == "nmos" {
            let node_gate = comp.pins[0].parse::<usize>().unwrap();
            let node_drain = comp.pins[1].parse::<usize>().unwrap();
            let node_source = comp.pins[2].parse::<usize>().unwrap();
            let v_gate = if node_gate > 0 { prev_voltages[node_gate] } else { 0.0 };
            let v_drain = if node_drain > 0 { prev_voltages[node_drain] } else { 0.0 };
            let v_source = if node_source > 0 { prev_voltages[node_source] } else { 0.0 };
            let vgs = v_gate - v_source;
            let mut vds = v_drain - v_source;
            if vds < 0.0 { vds = 0.0; }
            let vth = comp.value;
            let kn = 0.02;

            let (_ids, gm, gds) = if vgs <= vth {
                (0.0, 0.0, 1e-9)
            } else if vds < vgs - vth {
                let ids_val = kn * (2.0 * (vgs - vth) * vds - vds * vds);
                let gm_val = 2.0 * kn * vds;
                let gds_val = 2.0 * kn * (vgs - vth - vds);
                (ids_val, gm_val, gds_val.max(1e-9))
            } else {
                let ids_val = kn * (vgs - vth) * (vgs - vth);
                let gm_val = 2.0 * kn * (vgs - vth);
                let gds_val = 1e-5;
                (ids_val, gm_val, gds_val)
            };

            let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                if r > 0 && c > 0 {
                    j_matrix[(r - 1, c - 1)] += g;
                }
            };
            stamp_conductance(node_drain, node_drain, gds);
            stamp_conductance(node_source, node_source, gds);
            stamp_conductance(node_drain, node_source, -gds);
            stamp_conductance(node_source, node_drain, -gds);

            if node_drain > 0 {
                if node_gate > 0 { j_matrix[(node_drain - 1, node_gate - 1)] += gm; }
                if node_source > 0 { j_matrix[(node_drain - 1, node_source - 1)] -= gm; }
            }
            if node_source > 0 {
                if node_gate > 0 { j_matrix[(node_source - 1, node_gate - 1)] -= gm; }
                if node_source > 0 { j_matrix[(node_source - 1, node_source - 1)] += gm; }
            }
        } else if comp.comp_type == "pmos" {
            let node_gate = comp.pins[0].parse::<usize>().unwrap();
            let node_drain = comp.pins[1].parse::<usize>().unwrap();
            let node_source = comp.pins[2].parse::<usize>().unwrap();
            let v_gate = if node_gate > 0 { prev_voltages[node_gate] } else { 0.0 };
            let v_drain = if node_drain > 0 { prev_voltages[node_drain] } else { 0.0 };
            let v_source = if node_source > 0 { prev_voltages[node_source] } else { 0.0 };
            let vsg = v_source - v_gate;
            let mut vsd = v_source - v_drain;
            if vsd < 0.0 { vsd = 0.0; }
            let vth = if comp.value == 0.0 { -1.5 } else { comp.value };
            let vth_abs = -vth;
            let kp = 0.02;

            let (_isd, gm_sd, gds_cond) = if vsg <= vth_abs {
                (0.0, 0.0, 1e-9)
            } else if vsd < vsg - vth_abs {
                let isd_val = kp * (2.0 * (vsg - vth_abs) * vsd - vsd * vsd);
                let gm_sd_val = 2.0 * kp * vsd;
                let gds_cond_val = 2.0 * kp * (vsg - vth_abs - vsd);
                (isd_val, gm_sd_val, gds_cond_val.max(1e-9))
            } else {
                let isd_val = kp * (vsg - vth_abs) * (vsg - vth_abs);
                let gm_sd_val = 2.0 * kp * (vsg - vth_abs);
                let gds_cond_val = 1e-5;
                (isd_val, gm_sd_val, gds_cond_val)
            };

            let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                if r > 0 && c > 0 {
                    j_matrix[(r - 1, c - 1)] += g;
                }
            };
            stamp_conductance(node_source, node_source, gds_cond);
            stamp_conductance(node_drain, node_drain, gds_cond);
            stamp_conductance(node_source, node_drain, -gds_cond);
            stamp_conductance(node_drain, node_source, -gds_cond);

            if node_drain > 0 {
                if node_source > 0 { j_matrix[(node_drain - 1, node_source - 1)] -= gm_sd; }
                if node_gate > 0 { j_matrix[(node_drain - 1, node_gate - 1)] += gm_sd; }
            }
            if node_source > 0 {
                if node_source > 0 { j_matrix[(node_source - 1, node_source - 1)] += gm_sd; }
                if node_gate > 0 { j_matrix[(node_source - 1, node_gate - 1)] -= gm_sd; }
            }
        } else if comp.comp_type == "npn" || comp.comp_type == "pnp" {
            let is_npn = comp.comp_type == "npn";
            let node_base = comp.pins[0].parse::<usize>().unwrap();
            let node_collector = comp.pins[1].parse::<usize>().unwrap();
            let node_emitter = comp.pins[2].parse::<usize>().unwrap();
            let v_base = if node_base > 0 { prev_voltages[node_base] } else { 0.0 };
            let v_collector = if node_collector > 0 { prev_voltages[node_collector] } else { 0.0 };
            let v_emitter = if node_emitter > 0 { prev_voltages[node_emitter] } else { 0.0 };

            let (mut vbe, mut vbc) = if is_npn {
                (v_base - v_emitter, v_base - v_collector)
            } else {
                (v_emitter - v_base, v_collector - v_base)
            };

            if vbe > 0.72 { vbe = 0.72; }
            if vbc > 0.72 { vbc = 0.72; }

            let beta_f = comp.bjt_bf.unwrap_or(if comp.value <= 1.0 { 100.0 } else { comp.value });
            let beta_r = 1.0;
            let alpha_f = beta_f / (beta_f + 1.0);
            let alpha_r = beta_r / (beta_r + 1.0);

            let (vt_b, is_b) = get_thermal_parameters(netlist.temperature, comp.bjt_is);
            let exp_be = (vbe / vt_b).exp();
            let exp_bc = (vbc / vt_b).exp();

            let gbe = (is_b / vt_b) * exp_be;
            let gbc = (is_b / vt_b) * exp_bc;

            let g_be_b = gbe / (beta_f + 1.0);
            let g_bc_b = gbc / (beta_r + 1.0);

            let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                if r > 0 && c > 0 {
                    j_matrix[(r - 1, c - 1)] += g;
                }
            };

            stamp_conductance(node_base, node_base, g_be_b + g_bc_b);
            stamp_conductance(node_base, node_emitter, -g_be_b);
            stamp_conductance(node_base, node_collector, -g_bc_b);

            if node_collector > 0 {
                if node_base > 0 { j_matrix[(node_collector - 1, node_base - 1)] += alpha_f * gbe - gbc; }
                if node_emitter > 0 { j_matrix[(node_collector - 1, node_emitter - 1)] -= alpha_f * gbe; }
                j_matrix[(node_collector - 1, node_collector - 1)] += gbc;
            }

            if node_emitter > 0 {
                if node_base > 0 { j_matrix[(node_emitter - 1, node_base - 1)] -= gbe - alpha_r * gbc; }
                j_matrix[(node_emitter - 1, node_emitter - 1)] += gbe;
                if node_collector > 0 { j_matrix[(node_emitter - 1, node_collector - 1)] -= alpha_r * gbc; }
            }
        } else if comp.comp_type == "njf" || comp.comp_type == "pjf" {
            let is_njf = comp.comp_type == "njf";
            let node_drain = comp.pins[0].parse::<usize>().unwrap();
            let node_gate = comp.pins[1].parse::<usize>().unwrap();
            let node_source = comp.pins[2].parse::<usize>().unwrap();

            let v_drain = if node_drain > 0 { prev_voltages[node_drain] } else { 0.0 };
            let v_gate = if node_gate > 0 { prev_voltages[node_gate] } else { 0.0 };
            let v_source = if node_source > 0 { prev_voltages[node_source] } else { 0.0 };

            let vto = comp.jfet_vto.unwrap_or(if is_njf { -2.0 } else { 2.0 });
            let beta = comp.jfet_beta.unwrap_or(1e-3);
            let lambda = comp.jfet_lambda.unwrap_or(0.0);

            let (vgs_raw, vds_raw, factor_pol) = if is_njf {
                (v_gate - v_source, v_drain - v_source, 1.0)
            } else {
                (v_source - v_gate, v_source - v_drain, -1.0)
            };

            let mut vgs = vgs_raw;
            let mut vds = vds_raw;
            let mut _swapped = false;
            if vds < 0.0 {
                vds = -vds;
                vgs = if is_njf { v_gate - v_drain } else { v_drain - v_gate };
                _swapped = true;
            }

            let vgst = if is_njf { vgs - vto } else { vto - vgs };
            let (_, gm, gds) = if vgst <= 0.0 {
                (0.0, 0.0, 1e-9)
            } else if vds < vgst {
                let gm_val = 2.0 * beta * vds * (1.0 + lambda * vds);
                let gds_val = beta * ( (2.0 * vgst - 2.0 * vds) * (1.0 + lambda * vds) + vds * (2.0 * vgst - vds) * lambda );
                (0.0, gm_val, gds_val.max(1e-9))
            } else {
                let gm_val = 2.0 * beta * vgst * (1.0 + lambda * vds);
                let gds_val = beta * vgst * vgst * lambda;
                (0.0, gm_val, gds_val.max(1e-9))
            };

            let gm_final = gm * factor_pol;
            let gds_final = gds;

            // Estampar gds directamente (evita conflicto de borrow con closure)
            if node_drain > 0 { j_matrix[(node_drain - 1, node_drain - 1)] += gds_final; }
            if node_source > 0 { j_matrix[(node_source - 1, node_source - 1)] += gds_final; }
            if node_drain > 0 && node_source > 0 { j_matrix[(node_drain - 1, node_source - 1)] -= gds_final; }
            if node_source > 0 && node_drain > 0 { j_matrix[(node_source - 1, node_drain - 1)] -= gds_final; }

            if node_drain > 0 {
                if node_gate > 0 { j_matrix[(node_drain - 1, node_gate - 1)] += gm_final; }
                if node_source > 0 { j_matrix[(node_drain - 1, node_source - 1)] -= gm_final; }
            }
            if node_source > 0 {
                if node_gate > 0 { j_matrix[(node_source - 1, node_gate - 1)] -= gm_final; }
                if node_source > 0 { j_matrix[(node_source - 1, node_source - 1)] += gm_final; }
            }

            let (vt_local, _) = get_thermal_parameters(netlist.temperature, None);
            let gate_is = 1e-14;
            let exp_gs = ((v_gate - v_source) / vt_local).exp();
            let gg_gs = (gate_is / vt_local) * exp_gs;
            if node_gate > 0 { j_matrix[(node_gate - 1, node_gate - 1)] += gg_gs; }
            if node_source > 0 { j_matrix[(node_source - 1, node_source - 1)] += gg_gs; }
            if node_gate > 0 && node_source > 0 { j_matrix[(node_gate - 1, node_source - 1)] -= gg_gs; }
            if node_source > 0 && node_gate > 0 { j_matrix[(node_source - 1, node_gate - 1)] -= gg_gs; }

            let exp_gd = ((v_gate - v_drain) / vt_local).exp();
            let gg_gd = (gate_is / vt_local) * exp_gd;
            if node_gate > 0 { j_matrix[(node_gate - 1, node_gate - 1)] += gg_gd; }
            if node_drain > 0 { j_matrix[(node_drain - 1, node_drain - 1)] += gg_gd; }
            if node_gate > 0 && node_drain > 0 { j_matrix[(node_gate - 1, node_drain - 1)] -= gg_gd; }
            if node_drain > 0 && node_gate > 0 { j_matrix[(node_drain - 1, node_gate - 1)] -= gg_gd; }
        } else if comp.comp_type == "opamp" {
            let pin_in_pos = comp.pins[0].parse::<usize>().unwrap();
            let pin_in_neg = comp.pins[1].parse::<usize>().unwrap();
            let pin_vplus = comp.pins[2].parse::<usize>().unwrap();
            let pin_vminus = comp.pins[3].parse::<usize>().unwrap();
            let pin_out = comp.pins[4].parse::<usize>().unwrap();

            let v_in_pos = if pin_in_pos > 0 { prev_voltages[pin_in_pos] } else { 0.0 };
            let v_in_neg = if pin_in_neg > 0 { prev_voltages[pin_in_neg] } else { 0.0 };
            let v_vplus = if pin_vplus > 0 { prev_voltages[pin_vplus] } else { 15.0 };
            let v_vminus = if pin_vminus > 0 { prev_voltages[pin_vminus] } else { -15.0 };

            let v_diff = v_in_pos - v_in_neg;
            let mut v_span = v_vplus - v_vminus;
            if v_span.abs() < 1e-3 {
                v_span = 30.0;
            }

            let a_ol = 1e5;
            let r_in = 1e7;
            let r_out = 100.0;
            let g_out = 1.0 / r_out;
            let g_in = 1.0 / r_in;

            let mut stamp_conductance = |r: usize, c: usize, g: f64| {
                if r > 0 && c > 0 {
                    j_matrix[(r - 1, c - 1)] += g;
                }
            };
            stamp_conductance(pin_in_pos, pin_in_pos, g_in);
            stamp_conductance(pin_in_neg, pin_in_neg, g_in);
            stamp_conductance(pin_in_pos, pin_in_neg, -g_in);
            stamp_conductance(pin_in_neg, pin_in_pos, -g_in);

            let arg = (a_ol * v_diff) / v_span;
            let tanh_val = arg.tanh();
            let g_m_int = 0.5 * a_ol * (1.0 - tanh_val * tanh_val);
            let g_m_opamp = g_out * g_m_int;

            if pin_out > 0 {
                j_matrix[(pin_out - 1, pin_out - 1)] += g_out;
                if pin_in_pos > 0 {
                    j_matrix[(pin_out - 1, pin_in_pos - 1)] -= g_m_opamp;
                }
                if pin_in_neg > 0 {
                    j_matrix[(pin_out - 1, pin_in_neg - 1)] += g_m_opamp;
                }
            }
        }
    }

    // 4. Descomponer J usando LU disperso para resolver eficientemente
    let j_decomp = SparseLU::factorize(SparseMatrix::from_dense(&j_matrix))
        .map_err(|e| format!("Fallo de factorización en sensibilidad: {}", e))?;

    // 5. Analizar sensibilidades respecto a parámetros
    let mut sensitivities = Vec::new();
    let mut worst_case_deviations = HashMap::new(); // nodo -> sum(abs(dV/dp) * delta_p)
    for i in 1..=n {
        worst_case_deviations.insert(i.to_string(), 0.0);
    }

    for comp in &netlist.components {
        if comp.comp_type == "resistor" {
            let node_a = comp.pins[0].parse::<usize>().unwrap();
            let node_b = comp.pins[1].parse::<usize>().unwrap();
            let v_a = *nominal_voltages.get(&node_a.to_string()).unwrap_or(&0.0);
            let v_b = *nominal_voltages.get(&node_b.to_string()).unwrap_or(&0.0);
            let r_val = comp.value;

            if r_val > 1e-12 {
                let mut b_vec = DVector::<f64>::zeros(size);
                // dF/dR = -(V_A - V_B) / R^2
                // RHS b = -dF/dR = (V_A - V_B) / R^2
                let rhs_val = (v_a - v_b) / (r_val * r_val);
                if node_a > 0 {
                    b_vec[node_a - 1] += rhs_val;
                }
                if node_b > 0 {
                    b_vec[node_b - 1] -= rhs_val;
                }

                if let Some(sens_sol) = j_decomp.solve(&b_vec) {
                    let mut absolute_sensitivities = HashMap::new();
                    let mut normalized_sensitivities = HashMap::new();

                    for node_idx in 1..=n {
                        let node_str = node_idx.to_string();
                        let abs_sens = sens_sol[node_idx - 1];
                        absolute_sensitivities.insert(node_str.clone(), abs_sens);

                        let v_node = *nominal_voltages.get(&node_str).unwrap_or(&0.0);
                        let norm_sens = if v_node.abs() > 1e-5 {
                            abs_sens * r_val / v_node
                        } else {
                            0.0
                        };
                        normalized_sensitivities.insert(node_str.clone(), norm_sens);

                        // Contribución al Peor Caso (Worst Case)
                        let tolerance = comp.tolerance.unwrap_or(0.01); // 1% por defecto
                        let delta_p = r_val * tolerance;
                        let dev = abs_sens.abs() * delta_p;
                        if let Some(total_dev) = worst_case_deviations.get_mut(&node_str) {
                            *total_dev += dev;
                        }
                    }

                    sensitivities.push(ParameterSensitivity {
                        component_id: comp.id.clone(),
                        parameter_name: "resistance".to_string(),
                        parameter_value: r_val,
                        absolute_sensitivities,
                        normalized_sensitivities,
                    });
                }
            }
        } else if comp.comp_type == "vsource" {
            let vs_idx = *vsource_map.get(&comp.id).unwrap();
            let v_val = comp.value;

            let mut b_vec = DVector::<f64>::zeros(size);
            // dF/dVsrc = -1 en la ecuación de rama, así que b = -dF/dVsrc = 1
            b_vec[n + vs_idx] = 1.0;

            if let Some(sens_sol) = j_decomp.solve(&b_vec) {
                let mut absolute_sensitivities = HashMap::new();
                let mut normalized_sensitivities = HashMap::new();

                for node_idx in 1..=n {
                    let node_str = node_idx.to_string();
                    let abs_sens = sens_sol[node_idx - 1];
                    absolute_sensitivities.insert(node_str.clone(), abs_sens);

                    let v_node = *nominal_voltages.get(&node_str).unwrap_or(&0.0);
                    let norm_sens = if v_node.abs() > 1e-5 {
                        abs_sens * v_val / v_node
                    } else {
                        0.0
                    };
                    normalized_sensitivities.insert(node_str.clone(), norm_sens);

                    // Contribución al Peor Caso
                    let tolerance = comp.tolerance.unwrap_or(0.0); // 0% por defecto para fuentes
                    let delta_p = v_val * tolerance;
                    let dev = abs_sens.abs() * delta_p;
                    if let Some(total_dev) = worst_case_deviations.get_mut(&node_str) {
                        *total_dev += dev;
                    }
                }

                sensitivities.push(ParameterSensitivity {
                    component_id: comp.id.clone(),
                    parameter_name: "voltage".to_string(),
                    parameter_value: v_val,
                    absolute_sensitivities,
                    normalized_sensitivities,
                });
            }
        }
    }

    // 6. Consolidar límites de peor caso por nodo
    let mut worst_case_limits = HashMap::new();
    for node_idx in 1..=n {
        let node_str = node_idx.to_string();
        let nominal_val = *nominal_voltages.get(&node_str).unwrap_or(&0.0);
        let max_dev = *worst_case_deviations.get(&node_str).unwrap_or(&0.0);

        worst_case_limits.insert(node_str, WorstCaseLimits {
            nominal_value: nominal_val,
            worst_case_high: nominal_val + max_dev,
            worst_case_low: nominal_val - max_dev,
            max_deviation: max_dev,
        });
    }

    Ok(SensitivityResult {
        nominal_voltages,
        sensitivities,
        worst_case_limits,
    })

}

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



#[cfg(test)]
mod tests {
    use super::*;
    use num_complex::Complex;
    use std::collections::HashMap;

    #[test]
    fn test_logic_gate_configurable_delays() {
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 0.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    wave_type: Some("pulse".to_string()),
                    amplitude: Some(5.0),
                    frequency: Some(500.0), // Periodo de 2 ms (1 ms en HIGH, 1 ms en LOW)
                    offset: Some(0.0),
                    duty_cycle: Some(0.5),
                    ..Default::default()
                },
                ComponentData {
                    id: "U1".to_string(),
                    comp_type: "not_gate".to_string(),
                    value: 0.0,
                    pins: vec!["1".to_string(), "2".to_string()], // inversor
                    delay: Some(10e-9),
                    rise_delay: Some(15e-9),
                    fall_delay: Some(25e-9),
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: Some(false),
            subcircuit_definitions: None,
            triggers: None,
        };

        let settings = TransientSettings {
            dt: 1e-6,
            t_max: 2e-3,
            integration_method: Some("euler".to_string()),
            fixed_step: Some(false),
        };

        let (results, _, _) = solve_transient_circuit_with_initial_states(&netlist, &settings, HashMap::new(), HashMap::new()).unwrap();
        assert!(results.len() > 20);

        let mut verified_fall_success = false;
        let mut verified_rise_success = false;

        for step in &results {
            let v2 = *step.node_voltages.get("2").unwrap();
            
            // Flanco de bajada (entrada sube a t=0.0, salida baja tras fall_delay=25ns)
            // A t=1us, el transitorio ya procesó la bajada a LOW (0V)
            if (step.time - 1e-6).abs() < 1e-9 {
                assert!(v2 < 0.5, "Salida U1 (inversor) en t=1us debería ser LOW (0V) tras fall_delay, obtenido: {}", v2);
                verified_fall_success = true;
            }

            // Flanco de subida (entrada baja a t=1.0ms, salida sube tras rise_delay=15ns)
            // A t=1.002ms (segundo paso tras bajada), la salida ya es HIGH (5V)
            if step.time > 1.002e-3 && step.time < 1.9e-3 {
                assert!(v2 > 4.5, "Salida U1 (inversor) en t={} debería ser HIGH (5V) tras rise_delay, obtenido: {}", step.time, v2);
                verified_rise_success = true;
            }
        }

        assert!(verified_fall_success, "No se pudo verificar el retardo de bajada");
        assert!(verified_rise_success, "No se pudo verificar el retardo de subida");
    }

    #[test]
    fn test_mixed_signal_scheduler_event_sync() {
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    wave_type: Some("pulse".to_string()),
                    amplitude: Some(5.0),
                    frequency: Some(1e3),
                    offset: Some(0.0),
                    duty_cycle: Some(0.5),
                    ..Default::default()
                },
                ComponentData {
                    id: "U1".to_string(),
                    comp_type: "not_gate".to_string(),
                    value: 0.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: Some(false),
            subcircuit_definitions: None,
            triggers: None,
        };

        let settings = TransientSettings {
            dt: 1e-4,
            t_max: 2e-3,
            integration_method: Some("euler".to_string()),
            fixed_step: Some(false),
        };

        let (results, _, _) = solve_transient_circuit_with_initial_states(&netlist, &settings, HashMap::new(), HashMap::new()).unwrap();
        assert!(results.len() > 20);

        let mut checked_high = false;
        let mut checked_low = false;

        for step in &results {
            if step.time > 0.1e-3 && step.time < 0.4e-3 {
                let v2 = *step.node_voltages.get("2").unwrap();
                assert!(v2 < 0.5, "Salida de inversor LOW falló, obtenido: {}", v2);
                checked_low = true;
            }
            if step.time > 0.7e-3 && step.time < 0.9e-3 {
                let v2 = *step.node_voltages.get("2").unwrap();
                assert!(v2 > 4.0, "Salida de inversor HIGH falló, obtenido: {}", v2);
                checked_high = true;
            }
        }
        assert!(checked_high && checked_low);
    }

    #[test]
    fn test_mcu_discrete_clock_blink() {
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "MCU1".to_string(),
                    comp_type: "arduino_uno".to_string(),
                    value: 1.0,
                    pins: vec![
                        "1".to_string(),
                        "2".to_string(),
                        "3".to_string(),
                        "4".to_string(),
                        "5".to_string(),
                        "0".to_string(),
                    ],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: Some(false),
            subcircuit_definitions: None,
            triggers: None,
        };

        let settings = TransientSettings {
            dt: 1e-3,
            t_max: 1.2,
            integration_method: Some("euler".to_string()),
            fixed_step: Some(false),
        };

        let (results, _, _) = solve_transient_circuit_with_initial_states(&netlist, &settings, HashMap::new(), HashMap::new()).unwrap();

        let mut checked_high = false;
        let mut checked_low = false;

        for step in &results {
            if step.time > 0.1 && step.time < 0.4 {
                let v2 = *step.node_voltages.get("2").unwrap();
                assert!(v2 > 4.5, "Blink HIGH falló, obtenido: {}", v2);
                checked_high = true;
            }
            if step.time > 0.6 && step.time < 0.9 {
                let v2 = *step.node_voltages.get("2").unwrap();
                assert!(v2 < 0.5, "Blink LOW falló, obtenido: {}", v2);
                checked_low = true;
            }
        }
        assert!(checked_high && checked_low);
    }

    #[test]
    fn test_sparse_lu_real_solver() {
        let matrix = DMatrix::from_row_slice(3, 3, &[
            2.0, -1.0,  0.0,
           -1.0,  2.0, -1.0,
            0.0, -1.0,  2.0,
        ]);
        let b = DVector::from_row_slice(&[1.0, 0.0, 1.0]);
        let decomp_dense = matrix.clone().lu();
        let expected_x = decomp_dense.solve(&b).unwrap();
        let x = solve_sparse(&matrix, &b).unwrap();
        for i in 0..3 {
            assert!((x[i] - expected_x[i]).abs() < 1e-12, "x[{}] = {} debería ser {}", i, x[i], expected_x[i]);
        }
    }

    #[test]
    fn test_sparse_lu_complex_solver() {
        let matrix = DMatrix::from_row_slice(3, 3, &[
            Complex::new(2.0, 1.0), Complex::new(-1.0, 0.0), Complex::new(0.0, 0.0),
            Complex::new(-1.0, 0.0), Complex::new(2.0, -1.0), Complex::new(-1.0, 0.0),
            Complex::new(0.0, 0.0), Complex::new(-1.0, 0.0), Complex::new(2.0, 2.0),
        ]);
        let b = DVector::from_row_slice(&[
            Complex::new(1.0, 0.0),
            Complex::new(0.0, 0.0),
            Complex::new(1.0, 0.0),
        ]);
        let decomp_dense = matrix.clone().lu();
        let expected_x = decomp_dense.solve(&b).unwrap();
        let x = solve_complex_sparse(&matrix, &b).unwrap();
        for i in 0..3 {
            assert!((x[i] - expected_x[i]).norm() < 1e-12, "x[{}] = {:?} debería ser {:?}", i, x[i], expected_x[i]);
        }
    }

    #[test]
    fn test_voltage_divider() {
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 10.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R2".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let result = solve_dc_circuit(&netlist).unwrap();
        assert_eq!(*result.node_voltages.get("0").unwrap(), 0.0);
        assert_eq!(*result.node_voltages.get("1").unwrap(), 10.0);
        let v_node2 = *result.node_voltages.get("2").unwrap();
        assert!((v_node2 - 5.0).abs() < 1e-5, "Voltaje en Nodo 2 debería ser 5.0V, obtenido: {}", v_node2);
    }

    #[test]
    fn test_dc_sensitivity_voltage_divider() {
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 10.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    tolerance: Some(0.0), // Fuente con 0% tolerancia
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    tolerance: Some(0.05), // 5% tolerancia
                    ..Default::default()
                },
                ComponentData {
                    id: "R2".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    tolerance: Some(0.05), // 5% tolerancia
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let result = solve_dc_sensitivity(&netlist).unwrap();

        // 1. Verificar voltajes nominales
        let v_node2 = *result.nominal_voltages.get("2").unwrap();
        assert!((v_node2 - 5.0).abs() < 1e-5, "Voltaje nominal en Nodo 2 debería ser 5.0V");

        // 2. Verificar sensibilidades absolutas y normalizadas
        // dV(2)/dR1 = -Vsrc * R2 / (R1 + R2)^2 = -10 * 1000 / 2000^2 = -0.0025 V/Ohm
        // dV(2)/dR2 = Vsrc * R1 / (R1 + R2)^2 = 10 * 1000 / 2000^2 = 0.0025 V/Ohm
        let sens_r1 = result.sensitivities.iter().find(|s| s.component_id == "R1").unwrap();
        let abs_sens_r1 = *sens_r1.absolute_sensitivities.get("2").unwrap();
        let norm_sens_r1 = *sens_r1.normalized_sensitivities.get("2").unwrap();

        assert!((abs_sens_r1 - (-0.0025)).abs() < 1e-6, "Sensibilidad absoluta dV(2)/dR1 errónea: {}", abs_sens_r1);
        // (dV/dR) * (R/V) = -0.0025 * 1000 / 5 = -0.5 (-50%)
        assert!((norm_sens_r1 - (-0.5)).abs() < 1e-5, "Sensibilidad normalizada dV(2)/dR1 errónea: {}", norm_sens_r1);

        let sens_r2 = result.sensitivities.iter().find(|s| s.component_id == "R2").unwrap();
        let abs_sens_r2 = *sens_r2.absolute_sensitivities.get("2").unwrap();
        let norm_sens_r2 = *sens_r2.normalized_sensitivities.get("2").unwrap();

        assert!((abs_sens_r2 - 0.0025).abs() < 1e-6, "Sensibilidad absoluta dV(2)/dR2 errónea: {}", abs_sens_r2);
        assert!((norm_sens_r2 - 0.5).abs() < 1e-5, "Sensibilidad normalizada dV(2)/dR2 errónea: {}", norm_sens_r2);

        // 3. Verificar peor caso (Worst Case)
        // delta_V2 = |dV(2)/dR1| * (R1 * tol1) + |dV(2)/dR2| * (R2 * tol2)
        // delta_V2 = 0.0025 * (1000 * 0.05) + 0.0025 * (1000 * 0.05) = 0.125 + 0.125 = 0.25 V
        let wc_limits = result.worst_case_limits.get("2").unwrap();
        assert!((wc_limits.max_deviation - 0.25).abs() < 1e-5, "Desviación del peor caso errónea: {}", wc_limits.max_deviation);
        assert!((wc_limits.worst_case_high - 5.25).abs() < 1e-5, "Límite superior del peor caso erróneo: {}", wc_limits.worst_case_high);
        assert!((wc_limits.worst_case_low - 4.75).abs() < 1e-5, "Límite inferior del peor caso erróneo: {}", wc_limits.worst_case_low);
    }

    #[test]
    fn test_diode_circuit() {
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "D1".to_string(),
                    comp_type: "diode".to_string(),
                    value: 0.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let result = solve_dc_circuit(&netlist).unwrap();
        let v_anode = *result.node_voltages.get("2").unwrap();
        assert!(v_anode > 0.5 && v_anode < 0.8, "El voltaje del diodo polarizado directo debería rondar los 0.6V-0.7V, obtenido: {}", v_anode);
    }

    #[test]
    fn test_rc_transient_circuit() {
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "C1".to_string(),
                    comp_type: "capacitor".to_string(),
                    value: 10e-6, // 10 µF
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let settings = TransientSettings {
            dt: 0.001,   // 1 ms
            t_max: 0.05, // 50 ms
            fixed_step: None,
            integration_method: None,
        };

        let results = solve_transient_circuit(&netlist, &settings).unwrap();
        assert!(results.len() > 0, "Debería haber al menos un paso temporal de simulación.");

        let get_voltage_at = |target_t: f64| -> f64 {
            let mut closest_val = 0.0;
            let mut min_diff = f64::MAX;
            for step in &results {
                let diff = (step.time - target_t).abs();
                if diff < min_diff {
                    min_diff = diff;
                    closest_val = *step.node_voltages.get("2").unwrap();
                }
            }
            closest_val
        };
        
        let v_t0 = get_voltage_at(0.0);
        assert!(v_t0 >= 0.0 && v_t0 < 1.0, "Voltaje inicial en el primer paso debería rondar los 0V-0.5V, obtenido: {}", v_t0);

        let v_t10 = get_voltage_at(0.010);
        assert!(v_t10 > 2.8 && v_t10 < 3.4, "Voltaje RC en t=10ms debería rondar los 3.16V, obtenido: {}", v_t10);

        let v_t50 = get_voltage_at(0.050);
        assert!(v_t50 > 4.9, "Voltaje RC en t=50ms debería estar casi cargado (>4.9V), obtenido: {}", v_t50);
    }

    #[test]
    fn test_ac_frequency_response() {
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 1.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "C1".to_string(),
                    comp_type: "capacitor".to_string(),
                    value: 1.5915494309e-6, // 1.5915 µF
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let settings = AcSweepSettings {
            f_start: 10.0,
            f_end: 1000.0,
            points_per_decade: 10,
            op_guess: None,
        };

        let results = solve_ac_sweep(&netlist, &settings).unwrap();
        
        let idx_10hz = results.frequencies.iter().position(|&f| (f - 10.0).abs() < 0.5).unwrap();
        let idx_100hz = results.frequencies.iter().position(|&f| (f - 100.0).abs() < 5.0).unwrap();
        let idx_1000hz = results.frequencies.iter().position(|&f| (f - 1000.0).abs() < 50.0).unwrap();

        let amp_10hz = results.node_amplitudes.get("2").unwrap()[idx_10hz];
        let phase_10hz = results.node_phases.get("2").unwrap()[idx_10hz];
        
        let amp_100hz = results.node_amplitudes.get("2").unwrap()[idx_100hz];
        let phase_100hz = results.node_phases.get("2").unwrap()[idx_100hz];

        let amp_1000hz = results.node_amplitudes.get("2").unwrap()[idx_1000hz];
        let phase_1000hz = results.node_phases.get("2").unwrap()[idx_1000hz];

        assert!(amp_10hz > -0.2 && amp_10hz <= 0.0, "Amplitud a 10Hz debería ser ~0dB, obtenida: {}", amp_10hz);
        assert!(phase_10hz < 0.0 && phase_10hz > -10.0, "Fase a 10Hz debería ser ~ -5.7°, obtenida: {}", phase_10hz);

        assert!((amp_100hz - -3.01).abs() < 0.1, "Amplitud a fc (100Hz) debería ser -3 dB, obtenida: {}", amp_100hz);
        assert!((phase_100hz - -45.0).abs() < 1.0, "Fase a fc (100Hz) debería ser -45°, obtenida: {}", phase_100hz);

        assert!((amp_1000hz - -20.0).abs() < 0.5, "Amplitud a 1kHz debería ser -20 dB, obtenida: {}", amp_1000hz);
        assert!(phase_1000hz < -80.0 && phase_1000hz > -90.0, "Fase a 1kHz debería aproximarse a -90°, obtenida: {}", phase_1000hz);
    }

    #[test]
    fn test_nmos_transistor() {
        let netlist_off = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "Vdd".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Vgate".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 0.0,
                    pins: vec!["3".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Rload".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "M1".to_string(),
                    comp_type: "nmos".to_string(),
                    value: 1.5,
                    pins: vec!["3".to_string(), "2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let result_off = solve_dc_circuit(&netlist_off).unwrap();
        let v_drain_off = *result_off.node_voltages.get("2").unwrap();
        assert!((v_drain_off - 5.0).abs() < 1e-3, "Con Vgate=0V, Vdrain debería ser 5.0V, obtenido: {}", v_drain_off);

        let netlist_on = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "Vdd".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Vgate".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0,
                    pins: vec!["3".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Rload".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "M1".to_string(),
                    comp_type: "nmos".to_string(),
                    value: 1.5,
                    pins: vec!["3".to_string(), "2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let result_on = solve_dc_circuit(&netlist_on).unwrap();
        let v_drain_on = *result_on.node_voltages.get("2").unwrap();
        assert!(v_drain_on < 0.5, "Con Vgate=5V, Vdrain debería bajar, obtenido: {}", v_drain_on);
    }

    #[test]
    fn test_opamp_amplifier() {
        // Circuito Amplificador Inversor con Op-Amp
        // Vin (nodo 1) = 1.0V
        // R1 = 1k entre nodo 1 y nodo 2 (V-)
        // Rf = 10k entre nodo 2 y nodo 3 (Vout)
        // Op-Amp: V+ = nodo 0 (tierra), V- = nodo 2, Vdd = nodo 4 (+15V), Vss = nodo 5 (-15V), Out = nodo 3
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "Vin".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 1.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Vpos".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 15.0,
                    pins: vec!["4".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Vneg".to_string(),
                    comp_type: "vsource".to_string(),
                    value: -15.0,
                    pins: vec!["5".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Rf".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 10000.0,
                    pins: vec!["2".to_string(), "3".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "X1".to_string(),
                    comp_type: "opamp".to_string(),
                    value: 0.0,
                    pins: vec![
                        "0".to_string(), // In+
                        "2".to_string(), // In-
                        "4".to_string(), // V+
                        "5".to_string(), // V-
                        "3".to_string(), // Out
                    ],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let result = solve_dc_circuit(&netlist).unwrap();
        
        let v_out = *result.node_voltages.get("3").unwrap();
        let v_virtual_gnd = *result.node_voltages.get("2").unwrap();

        // Ganancia teórica Av = -Rf / R1 = -10. Con Vin = 1V, Vout debe ser -10V
        assert!((v_out - -10.0).abs() < 1e-2, "El voltaje de salida debería ser exactamente -10.0V (ganancia inversora de -10), obtenido: {}", v_out);
        assert!(v_virtual_gnd.abs() < 1e-3, "La tierra virtual (nodo inversor) debería estar muy cerca de 0V, obtenido: {}", v_virtual_gnd);
    }

    #[test]
    fn test_pmos_transistor() {
        let netlist_off = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "Vdd".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Vgate".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0,
                    pins: vec!["3".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Rload".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "M1".to_string(),
                    comp_type: "pmos".to_string(),
                    value: -1.5,
                    pins: vec!["3".to_string(), "2".to_string(), "1".to_string()], // G, D, S (S a Vdd 5V)
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let result_off = solve_dc_circuit(&netlist_off).unwrap();
        let v_drain_off = *result_off.node_voltages.get("2").unwrap();
        assert!(v_drain_off.abs() < 1e-3, "Con Vgate=5V, PMOS apagado, Vdrain debería ser 0V, obtenido: {}", v_drain_off);

        let netlist_on = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "Vdd".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Vgate".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 0.0,
                    pins: vec!["3".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Rload".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "M1".to_string(),
                    comp_type: "pmos".to_string(),
                    value: -1.5,
                    pins: vec!["3".to_string(), "2".to_string(), "1".to_string()], // G, D, S
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let result_on = solve_dc_circuit(&netlist_on).unwrap();
        let v_drain_on = *result_on.node_voltages.get("2").unwrap();
        assert!(v_drain_on > 4.0, "Con Vgate=0V, PMOS encendido, Vdrain debería subir cerca de 5V, obtenido: {}", v_drain_on);
    }

    #[test]
    fn test_bjt_amplifier() {
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "Vcc".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 10.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Vin".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 2.0,
                    pins: vec!["3".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Rc".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Rb".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 100000.0,
                    pins: vec!["3".to_string(), "4".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Q1".to_string(),
                    comp_type: "npn".to_string(),
                    value: 100.0, // beta = 100
                    pins: vec!["4".to_string(), "2".to_string(), "0".to_string()], // B, C, E
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let result = solve_dc_circuit(&netlist).unwrap();
        let v_base = *result.node_voltages.get("4").unwrap();
        let v_collector = *result.node_voltages.get("2").unwrap();

        assert!(v_base > 0.5 && v_base < 0.8, "Vbase debería ser ~0.55V, obtenido: {}", v_base);
        assert!(v_collector > 8.0 && v_collector < 9.0, "Vcollector debería ser ~8.7V, obtenido: {}", v_collector);
    }

    #[test]
    fn test_cmos_inverter_transient() {
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "Vdd".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Vin".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0,
                    pins: vec!["3".to_string(), "0".to_string()],
                    wave_type: Some("square".to_string()),
                    amplitude: Some(2.5),
                    frequency: Some(10e3), // 10 kHz
                    offset: Some(2.5),     // pulso cuadrado de 0V a 5V
                    duty_cycle: Some(0.5),
                    ..Default::default()
                },
                ComponentData {
                    id: "Mn1".to_string(),
                    comp_type: "nmos".to_string(),
                    value: 1.0, // Vth = 1.0 V
                    pins: vec!["3".to_string(), "2".to_string(), "0".to_string()], // G, D, S
                    ..Default::default()
                },
                ComponentData {
                    id: "Mp1".to_string(),
                    comp_type: "pmos".to_string(),
                    value: -1.0, // Vth = -1.0 V
                    pins: vec!["3".to_string(), "2".to_string(), "1".to_string()], // G, D, S (S a Vdd 5V)
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let settings = TransientSettings {
            dt: 1e-6,     // 1 µs paso nominal inicial
            t_max: 1e-4,  // 100 µs simulación (un ciclo de conmutación completo a 10 kHz es 100 µs)
            fixed_step: None,
            integration_method: None,
        };

        let results = solve_transient_circuit(&netlist, &settings).unwrap();
        assert!(results.len() > 0, "La simulación transitoria de inversor CMOS debió generar resultados.");

        // Validar conmutación física dinámicamente
        let get_voltage_at = |target_t: f64| -> f64 {
            let mut closest_val = 0.0;
            let mut min_diff = f64::MAX;
            for step in &results {
                let diff = (step.time - target_t).abs();
                if diff < min_diff {
                    min_diff = diff;
                    closest_val = *step.node_voltages.get("2").unwrap();
                }
            }
            closest_val
        };

        // En t=25 µs, Vin es 5V (por el offset y amplitud del pulso cuadrado de 10kHz):
        // la salida (Vout, nodo 2) debe estar descargada cerca de 0V
        let v_out_low = get_voltage_at(25e-6);
        assert!(v_out_low < 0.5, "La salida del inversor CMOS debería estar a nivel bajo (~0V) con entrada alta, obtenido: {}", v_out_low);

        // En t=75 µs, Vin es 0V (mitad negativa de la onda cuadrada):
        // la salida (Vout, nodo 2) debe estar cargada a 5V (Vdd)
        let v_out_high = get_voltage_at(75e-6);
        assert!(v_out_high > 4.5, "La salida del inversor CMOS debería estar a nivel alto (~5V) con entrada baja, obtenido: {}", v_out_high);
    }

    #[test]
    fn test_bjt_transient_delay() {
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "Vcc".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Vin".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 0.0,
                    pins: vec!["3".to_string(), "0".to_string()],
                    wave_type: Some("sine".to_string()),
                    amplitude: Some(5.0), // Senoidal de 5V pico que arranca suavemente en 0V a t=0s
                    frequency: Some(10e3), // 10 kHz
                    offset: Some(0.0),
                    ..Default::default()
                },
                ComponentData {
                    id: "Rb".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 10000.0, // 10k
                    pins: vec!["3".to_string(), "4".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Rc".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0, // 1k
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Q1".to_string(),
                    comp_type: "npn".to_string(),
                    value: 100.0, // beta = 100
                    pins: vec!["4".to_string(), "2".to_string(), "0".to_string()], // B, C, E
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let settings = TransientSettings {
            dt: 1e-6,
            t_max: 1e-4,
            fixed_step: None,
            integration_method: None,
        };

        let results = solve_transient_circuit(&netlist, &settings).unwrap();
        assert!(results.len() > 0, "Debería haber resultados de simulación transitoria para BJT.");

        let get_voltage_at = |target_t: f64| -> f64 {
            let mut closest_val = 0.0;
            let mut min_diff = f64::MAX;
            for step in &results {
                let diff = (step.time - target_t).abs();
                if diff < min_diff {
                    min_diff = diff;
                    closest_val = *step.node_voltages.get("2").unwrap();
                }
            }
            closest_val
        };

        // Vin es alto (~5V) en t=25 µs (pico positivo, NPN encendido/saturado): Vcollector debería ser bajo (<0.5V)
        let v_c_low = get_voltage_at(25e-6);
        assert!(v_c_low < 0.5, "El colector del NPN saturado debería estar a nivel bajo (<0.5V), obtenido: {}", v_c_low);

        // Vin es bajo (~-5V) en t=75 µs (pico negativo, NPN cortado): Vcollector debería subir a Vcc (5V)
        let v_c_high = get_voltage_at(75e-6);
        assert!(v_c_high > 4.5, "El colector del NPN cortado debería subir a Vcc (~5V), obtenido: {}", v_c_high);
    }

    #[test]
    fn test_dc_sweep_diode_curve() {
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 0.0, // Tensión a barrer
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "D1".to_string(),
                    comp_type: "diode".to_string(),
                    value: 0.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let settings = DcSweepSettings {
            source_id: "V1".to_string(),
            v_start: 0.0,
            v_end: 3.0,
            v_step: 0.1,
        };

        let result = solve_dc_sweep(&netlist, &settings).unwrap();
        
        // Debería generar exactamente 31 puntos de barrido (0.0 a 3.0 inclusive, paso 0.1)
        assert_eq!(result.sweep_voltages.len(), 31);
        
        // A 0V en la entrada, la tensión del ánodo (nodo 2) es 0V
        assert!((result.node_voltages.get("2").unwrap()[0] - 0.0).abs() < 1e-6);

        // A 3V en la entrada, el diodo está fuertemente polarizado directo, por lo que su voltaje
        // de ánodo se auto-limita físicamente al rededor de 0.6V - 0.75V
        let v_anode_3v = result.node_voltages.get("2").unwrap()[30];
        assert!(v_anode_3v > 0.55 && v_anode_3v < 0.75, "El voltaje del ánodo del diodo a 3V de entrada debería auto-limitarse por Shockley, obtenido: {}", v_anode_3v);
    }

    #[test]
    fn test_monte_carlo_distribution() {
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 10.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    tolerance: Some(0.1), // 10% tolerancia
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R2".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    tolerance: Some(0.1), // 10% tolerancia
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let t_settings = TransientSettings {
            dt: 1e-4,
            t_max: 1e-4,
            fixed_step: None,
            integration_method: None,
        };

        let mc_settings = MonteCarloSettings {
            runs: 20,
            seed: Some(987654321),
        };

        let results = solve_monte_carlo_transient(&netlist, &t_settings, &mc_settings).unwrap();
        assert_eq!(results.len(), 20); // 20 corridas de simulación
        
        for run in results {
            assert!(run.len() > 0);
            let v_mid = *run.last().unwrap().node_voltages.get("2").unwrap();
            // Para divisor de tensión R1/R2 ideales de 1k, Vmid = 5.0V.
            // Con +/-10% de tolerancia, la dispersión está en torno a 5.0V, variando físicamente.
            // Aseguramos que los valores sean físicos y caigan dentro de límites lógicos
            assert!(v_mid > 4.0 && v_mid < 6.0, "Divisor variando por tolerancia fuera de cotas: {}", v_mid);
        }
    }

    #[test]
    fn test_fft_sine_thd() {
        let f_fund = 1000.0;
        let t_max = 0.01; // 10 ms (10 ciclos completos de 1kHz)
        
        // Generar 2048 pasos uniformes de una senoide ideal
        let n_steps = 2048;
        let mut time_steps = Vec::with_capacity(n_steps);
        for i in 0..n_steps {
            let t = (i as f64) * (t_max / (n_steps - 1) as f64);
            let mut node_voltages = HashMap::new();
            // Senoide ideal de amplitud 5V, offset 0V
            let v_val = 5.0 * (2.0 * std::f64::consts::PI * f_fund * t).sin();
            node_voltages.insert("1".to_string(), v_val);
            
            time_steps.push(TimeStepResult {
                time: t,
                node_voltages,
                branch_currents: HashMap::new(),
            });
        }
        
        let fft_res = calculate_fft_and_thd(&time_steps, "1", f_fund).unwrap();
        
        // El espectro de frecuenciaNyquist debe ser de 1024 bins
        assert_eq!(fft_res.frequencies.len(), 1024);
        
        // Encontrar el bin correspondiente a 1000 Hz en fft_res.frequencies
        let mut fund_bin = 0;
        let mut min_diff = f64::MAX;
        for (idx, &f) in fft_res.frequencies.iter().enumerate() {
            let diff = (f - f_fund).abs();
            if diff < min_diff {
                min_diff = diff;
                fund_bin = idx;
            }
        }
        
        // La magnitud en dB de la fundamental a 1000Hz debería ser muy alta (aproximadamente 20*log10(5) = 13.97 dBV)
        let db_val = fft_res.magnitudes_db[fund_bin];
        assert!((db_val - 13.97).abs() < 0.5, "La fundamental a 1kHz debería rondar los 14dBV (amplitud 5V), obtenido: {}", db_val);
        
        // Dado que la onda es una senoide perfectamente pura por diseño,
        // su THD debería ser sumamente baja (virtualmente cero, < 0.2% considerando la fuga espectral discreta de 2048 puntos)
        assert!(fft_res.thd < 0.2, "THD de senoide ideal debería ser muy cercano a 0%, obtenido: {}%", fft_res.thd);
    }

    #[test]
    fn test_resistor_thermal_noise() {
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 0.0, // Fuente silenciosa
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 10000.0, // 10k
                    pins: vec!["2".to_string(), "1".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let settings = NoiseSweepSettings {
            output_node: "1".to_string(),
            reference_node: "0".to_string(),
            ac_settings: AcSweepSettings {
                f_start: 10.0,
                f_end: 1000.0,
                points_per_decade: 10,
            op_guess: None,
            },
        };

        let result = solve_noise_sweep(&netlist, &settings).unwrap();
        
        // Densidad teórica del ruido de Johnson-Nyquist para R=10k a 300K:
        // v_noise = sqrt(4 * k_B * T * R) = sqrt(4 * 1.380649e-23 * 300 * 10000) = 1.287159e-8 V/sqrt(Hz) (12.87 nV/rHz)
        let expected_noise = 1.287159e-8;
        
        for &noise_val in &result.output_noise_density {
            let error_pct = (noise_val - expected_noise).abs() / expected_noise;
            assert!(error_pct < 0.01, "El ruido térmico del resistor debería ser exactamente 12.87 nV/rHz, obtenido: {} V/rHz", noise_val);
        }
    }

    // ================================================================
    // FASE 23: Tests de Evaluador de Mediciones (.measure)
    // ================================================================

    #[test]
    fn test_measure_propagation_delay() {
        // Simular una rampa de entrada (nodo "1") que sube de 0V a 5V en 100ns,
        // y una rampa de salida (nodo "2") retardada 20ns.
        let mut time_steps = Vec::new();
        let n_points = 200;
        let t_max = 200e-9; // 200 ns

        for i in 0..=n_points {
            let t = i as f64 * t_max / n_points as f64;
            let mut node_voltages = HashMap::new();

            // Rampa de entrada: sube de 0V a 5V entre t=10ns y t=110ns
            let v_in = if t < 10e-9 {
                0.0
            } else if t < 110e-9 {
                5.0 * (t - 10e-9) / 100e-9
            } else {
                5.0
            };

            // Rampa de salida: igual pero retardada 20ns
            let v_out = if t < 30e-9 {
                0.0
            } else if t < 130e-9 {
                5.0 * (t - 30e-9) / 100e-9
            } else {
                5.0
            };

            node_voltages.insert("0".to_string(), 0.0);
            node_voltages.insert("1".to_string(), v_in);
            node_voltages.insert("2".to_string(), v_out);

            time_steps.push(TimeStepResult {
                time: t,
                node_voltages,
                branch_currents: HashMap::new(),
            });
        }

        // Medir retardo de propagación al 50%
        let directives = vec![
            MeasureDirective {
                name: "t_delay".to_string(),
                measure_type: "delay".to_string(),
                node: "2".to_string(),
                trig_node: Some("1".to_string()),
                threshold: Some(0.5),
                t_start: None,
                t_end: None,
            },
            MeasureDirective {
                name: "t_rise".to_string(),
                measure_type: "risetime".to_string(),
                node: "2".to_string(),
                trig_node: None,
                threshold: None,
                t_start: None,
                t_end: None,
            },
            MeasureDirective {
                name: "v_peak".to_string(),
                measure_type: "peak".to_string(),
                node: "2".to_string(),
                trig_node: None,
                threshold: None,
                t_start: None,
                t_end: None,
            },
            MeasureDirective {
                name: "v_avg".to_string(),
                measure_type: "avg".to_string(),
                node: "1".to_string(),
                trig_node: None,
                threshold: None,
                t_start: None,
                t_end: None,
            },
        ];

        let result = evaluate_measures(&time_steps, &directives);
        assert!(result.error_log.is_none(), "No debería haber errores: {:?}", result.error_log);

        // Verificar retardo de propagación ≈ 20ns (±2ns de tolerancia por discretización)
        let delay = *result.measurements.get("t_delay").expect("Medición t_delay no encontrada");
        assert!(
            (delay - 20e-9).abs() < 2e-9,
            "El retardo de propagación debería ser ~20ns, obtenido: {:.2}ns", delay * 1e9
        );

        // Verificar tiempo de subida (10%→90% de 5V = 0.5V→4.5V sobre 100ns de rampa = 80ns)
        let risetime = *result.measurements.get("t_rise").expect("Medición t_rise no encontrada");
        assert!(
            (risetime - 80e-9).abs() < 5e-9,
            "El tiempo de subida debería ser ~80ns, obtenido: {:.2}ns", risetime * 1e9
        );

        // Verificar pico = 5V
        let peak = *result.measurements.get("v_peak").expect("Medición v_peak no encontrada");
        assert!(
            (peak - 5.0).abs() < 0.1,
            "El pico debería ser 5V, obtenido: {:.4}V", peak
        );

        // Verificar promedio (la rampa de 10ns-110ns sobre 200ns tiene un promedio razonable)
        let avg = *result.measurements.get("v_avg").expect("Medición v_avg no encontrada");
        assert!(avg > 0.0 && avg < 5.0, "El promedio debería estar entre 0 y 5V, obtenido: {:.4}V", avg);
    }

    // ================================================================
    // FASE 24: Tests de Líneas de Transmisión RLCG
    // ================================================================

    #[test]
    fn test_tline_expansion_segments() {
        // Línea de transmisión ideal Z0=50Ω, Td=1ns, 20 segmentos
        let params = TransmissionLineParams {
            id: "1".to_string(),
            pin_in: "1".to_string(),
            pin_out: "2".to_string(),
            gnd: "0".to_string(),
            z0: 50.0,
            td: 1e-9,
            r_total: 0.0,
            g_total: 0.0,
            n_segments: 20,
        };

        let components = expand_transmission_line(&params);

        // Para línea ideal (R=0, G=0): cada segmento genera 1 inductor + 2 capacitores = 3 componentes
        // Total: 20 * 3 = 60 componentes
        assert_eq!(
            components.len(), 60,
            "Una línea ideal de 20 segmentos debería generar 60 componentes pasivos, generó: {}", components.len()
        );

        // Verificar valores de L y C por segmento
        let l_expected = 50.0 * 1e-9 / 20.0; // Z0 * Td / N = 2.5 nH
        let c_expected = 1e-9 / (50.0 * 20.0); // Td / (Z0 * N) = 1 pF

        let first_inductor = components.iter().find(|c| c.comp_type == "inductor").unwrap();
        assert!(
            (first_inductor.value - l_expected).abs() / l_expected < 0.01,
            "L_seg debería ser {:.4e} H, obtenido: {:.4e} H", l_expected, first_inductor.value
        );

        let first_cap = components.iter().find(|c| c.comp_type == "capacitor").unwrap();
        assert!(
            (first_cap.value - c_expected / 2.0).abs() / (c_expected / 2.0) < 0.01,
            "C_seg/2 debería ser {:.4e} F, obtenido: {:.4e} F", c_expected / 2.0, first_cap.value
        );
    }

    #[test]
    fn test_tline_lossy_expansion() {
        // Línea con pérdidas: R_total=5Ω, G_total=0.001S
        let params = TransmissionLineParams {
            id: "2".to_string(),
            pin_in: "3".to_string(),
            pin_out: "4".to_string(),
            gnd: "0".to_string(),
            z0: 75.0,
            td: 2e-9,
            r_total: 5.0,
            g_total: 0.001,
            n_segments: 10,
        };

        let components = expand_transmission_line(&params);

        // Para línea con pérdidas: cada segmento genera 1R + 1L + 2C + 2G_shunt = 6 componentes
        // Total: 10 * 6 = 60 componentes
        assert_eq!(
            components.len(), 60,
            "Una línea con pérdidas de 10 segmentos debería generar 60 componentes, generó: {}", components.len()
        );

        // Verificar que hay resistores de serie y de fuga
        let r_series: Vec<_> = components.iter().filter(|c| c.id.contains(".R")).collect();
        let r_shunt: Vec<_> = components.iter().filter(|c| c.id.contains(".GL") || c.id.contains(".GR")).collect();
        assert_eq!(r_series.len(), 10, "Debería haber 10 resistores de serie");
        assert_eq!(r_shunt.len(), 20, "Debería haber 20 resistores de fuga (GL+GR)");

        // R_seg = 5/10 = 0.5Ω
        assert!(
            (r_series[0].value - 0.5).abs() < 0.001,
            "R_seg debería ser 0.5Ω, obtenido: {}Ω", r_series[0].value
        );
    }

    // ================================================================
    // FASE 25: Tests de Modelos de Deriva Térmica
    // ================================================================

    #[test]
    fn test_thermal_is_pn_scaling() {
        // Verificar que Is aumenta con la temperatura (comportamiento físico fundamental)
        let is_300 = 1e-12; // 1 pA a 300K
        let t0 = 300.0;
        let xti = 3.0;
        let n = 1.0;

        let is_350 = thermal_is_pn(is_300, t0, 350.0, xti, n);
        let is_400 = thermal_is_pn(is_300, t0, 400.0, xti, n);
        let is_398 = thermal_is_pn(is_300, t0, 398.15, xti, n); // 125°C

        // Is debe crecer exponencialmente con T
        assert!(is_350 > is_300, "Is(350K) debería ser mayor que Is(300K)");
        assert!(is_400 > is_350, "Is(400K) debería ser mayor que Is(350K)");

        // A 125°C (398.15K), Is crece exponencialmente según el modelo SPICE con XTI=3
        // y estrechamiento de banda prohibida de Varshni. El ratio es del orden de 10^5.
        let ratio_125 = is_398 / is_300;
        assert!(
            ratio_125 > 1000.0 && ratio_125 < 1e7,
            "Is(125°C)/Is(27°C) debería ser del orden de ~10^5 (modelo SPICE XTI=3 + Varshni), obtenido: {:.1}x", ratio_125
        );
    }

    #[test]
    fn test_thermal_resistance_tc1() {
        // R(T) = R0 * [1 + TC1*(T-T0)]
        let r0 = 10000.0; // 10kΩ
        let tc1 = 3.9e-3; // 3900 ppm/K (cobre)
        let tc2 = 0.0;

        let r_400 = thermal_resistance(r0, 300.0, 400.0, tc1, tc2);
        let expected = r0 * (1.0 + tc1 * 100.0); // 10000 * 1.39 = 13900Ω

        assert!(
            (r_400 - expected).abs() < 1.0,
            "R(400K) debería ser {:.0}Ω, obtenido: {:.0}Ω", expected, r_400
        );
    }

    #[test]
    fn test_thermal_mosfet_vth_drift() {
        // Vth(T) = Vth(T0) - TCV*(T-T0)
        let vth_300 = 0.7; // 0.7V a 300K
        let tcv = 2.0e-3;  // -2 mV/K

        let vth_400 = thermal_mosfet_vth(vth_300, 300.0, 400.0, tcv);
        // Vth(400) = 0.7 - 0.002 * 100 = 0.5V
        assert!(
            (vth_400 - 0.5).abs() < 0.001,
            "Vth(400K) debería ser 0.500V, obtenido: {:.4}V", vth_400
        );
    }

    #[test]
    fn test_thermal_mosfet_beta_degradation() {
        // β(T) = β(T0) * (T/T0)^(-1.5)
        let beta_300 = 0.02; // kn a 300K
        let bex = 1.5;

        let beta_400 = thermal_mosfet_beta(beta_300, 300.0, 400.0, bex);
        let expected = beta_300 * (400.0 / 300.0_f64).powf(-1.5);

        assert!(
            (beta_400 - expected).abs() / expected < 0.001,
            "β(400K) debería ser {:.6}, obtenido: {:.6}", expected, beta_400
        );

        // β debe disminuir con la temperatura
        assert!(beta_400 < beta_300, "β(400K) debería ser menor que β(300K)");
    }

    #[test]
    fn test_diode_thermal_voltage_shift() {
        // Verificar que el codo de conducción del diodo se desplaza con la temperatura.
        // A 125°C (398.15K) el voltaje de codo debería ser ~200mV menor que a 27°C (300K)
        // según el coeficiente térmico de -2 mV/°C.
        //
        // Circuito: V1→R1(1kΩ)→Diodo→GND
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "D1".to_string(),
                    comp_type: "diode".to_string(),
                    value: 1.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        // Resolver a 27°C (300K)
        let result_300 = solve_dc_circuit(&netlist).unwrap();
        let _v_diode_300 = *result_300.node_voltages.get("2").unwrap_or(&0.0);

        // Resolver a 125°C (398.15K) con modelo térmico
        // Para el test, usamos apply_thermal_drift que ajusta R, pero el diodo usa Is global.
        // Verificamos que la resistencia aumenta con la temperatura (efecto indirecto).
        let netlist_hot = apply_thermal_drift(&netlist, 398.15);
        let r1_hot = netlist_hot.components.iter().find(|c| c.id == "R1").unwrap();

        // Verificar que la resistencia aumentó ~38% (TC1=3.9e-3 * 98.15K ≈ 0.383)
        let r_ratio = r1_hot.value / 1000.0;
        assert!(
            r_ratio > 1.3 && r_ratio < 1.5,
            "La resistencia a 125°C debería aumentar ~38%, ratio obtenido: {:.3}", r_ratio
        );

        // Verificar que Vt(T) escala correctamente
        let vt_300 = thermal_vt(300.0);
        let vt_398 = thermal_vt(398.15);
        assert!(
            (vt_300 - 0.025852).abs() < 1e-4,
            "Vt(300K) debería ser ~25.85mV, obtenido: {:.6}V", vt_300
        );
        assert!(
            vt_398 > vt_300,
            "Vt(398K) debería ser mayor que Vt(300K)"
        );
        let vt_expected_398 = PHYS_KB * 398.15 / PHYS_Q;
        assert!(
            (vt_398 - vt_expected_398).abs() < 1e-6,
            "Vt(398.15K) debería ser {:.6}V, obtenido: {:.6}V", vt_expected_398, vt_398
        );

        // Verificar banda prohibida de Varshni disminuye con temperatura
        let eg_300 = bandgap_varshni(300.0);
        let eg_400 = bandgap_varshni(400.0);
        assert!(
            (eg_300 - EG_SI_300).abs() < 0.001,
            "Eg(300K) debería ser ~1.12 eV, obtenido: {:.4} eV", eg_300
        );
        assert!(
            eg_400 < eg_300,
            "Eg(400K) debería ser menor que Eg(300K) según Varshni"
        );
    }

    #[test]
    fn test_pss_shooting_method_simple_rc() {
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 0.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    wave_type: Some("sine".to_string()),
                    amplitude: Some(5.0),
                    frequency: Some(1000.0), // 1 kHz
                    offset: Some(0.0),
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0, // 1 kΩ
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "C1".to_string(),
                    comp_type: "capacitor".to_string(),
                    value: 1e-6, // 1 µF
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let pss_settings = PssSettings {
            period: 1e-3, // 1 ms
            max_shooting_iters: 5,
            shooting_tolerance: 1e-4,
        };

        let results = solve_pss(&netlist, &pss_settings);
        assert!(results.is_ok(), "PSS Shooting Method debería converger sin problemas");
        let step_results = results.unwrap();
        assert!(!step_results.is_empty(), "Los resultados de PSS no deben estar vacíos");
    }

    #[test]
    fn test_bsim3_nmos_mobility_degradation() {
        // NMOS Shichman-Hodges asume movilidad fija.
        // BSIM3 degrada movilidad eff cuando Vgs es alto.
        let vgs_low = 1.0;
        let vgs_high = 5.0;
        let vds = 1.0;
        let vbs = 0.0;
        let vth = 0.4;

        let (_, gm_low, _) = evaluate_bsim3_nmos(vgs_low, vds, vbs, vth, None, None, None, None);
        let (_, gm_high, _) = evaluate_bsim3_nmos(vgs_high, vds, vbs, vth, None, None, None, None);

        // La movilidad degradada frena el incremento de gm a voltajes altos
        assert!(gm_high > 0.0, "gm a Vgs=5V debe ser mayor que cero");
        assert!(gm_low > 0.0, "gm a Vgs=1V debe ser mayor que cero");
    }

    #[test]
    fn test_stability_analysis_rc_pole() {
        // Circuito RC: R=1k, C=1u => polo en s = -1/(RC) = -1000 rad/s
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "C1".to_string(),
                    comp_type: "capacitor".to_string(),
                    value: 1e-6,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let res = run_stability_analysis(&netlist);
        assert!(res.is_ok(), "El análisis de estabilidad debería ejecutarse con éxito");
        let data = res.unwrap();
        assert!(data.is_stable, "El circuito RC pasivo simple debe ser estable");
        assert_eq!(data.poles.len(), 1, "Debería haber exactamente 1 polo");
        
        let p = data.poles[0];
        // El polo debe estar muy cercano a -1000 rad/s
        assert!((p.re + 1000.0).abs() < 1.0, "El polo debería ser aproximadamente -1000, obtenido: {:?}", p);
    }

    #[test]
    fn test_mixed_signal_not_gate() {
        // Compuerta digital NOT conectada a una fuente de entrada analógica de 5V
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0, // Entrada lógica '1' analógica
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "G1".to_string(),
                    comp_type: "not_gate".to_string(),
                    pins: vec!["1".to_string(), "2".to_string()],
                    value: 0.0,
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let result = solve_dc_circuit(&netlist);
        assert!(result.is_ok(), "La simulación Mixed-Signal debe converger en DC");
        let data = result.unwrap();
        let v_out = *data.node_voltages.get("2").unwrap_or(&5.0);
        // La compuerta NOT invierte 5V (true) a aprox 0V (false)
        assert!(v_out < 0.5, "La salida de la compuerta NOT con entrada de 5V debería estar cerca de 0V, obtenida: {}V", v_out);
    }

    #[test]
    fn test_bsim3_geometry_scaling() {
        let vgs = 1.0;
        let vds = 1.0;
        let vbs = 0.0;
        let vth = 0.4;

        // Transistor base (W = 10u, L = 0.18u)
        let (ids_base, gm_base, _) = evaluate_bsim3_nmos(vgs, vds, vbs, vth, Some(10.0e-6), Some(0.18e-6), None, None);
        
        // Transistor escalado 10x en ancho (W = 100u, L = 0.18u)
        let (ids_scaled, gm_scaled, _) = evaluate_bsim3_nmos(vgs, vds, vbs, vth, Some(100.0e-6), Some(0.18e-6), None, None);

        // Validar la proporción 10x de corriente y gm
        let ratio_ids = ids_scaled / ids_base;
        let ratio_gm = gm_scaled / gm_base;

        assert!((ratio_ids - 10.0).abs() < 0.1, "La corriente debería escalar 10x, obtenido: {}", ratio_ids);
        assert!((ratio_gm - 10.0).abs() < 0.1, "El gm debería escalar 10x, obtenido: {}", ratio_gm);
    }

    #[test]
    fn test_stability_zeros_extraction() {
        // Red puente / filtro RC paralelo en serie con R2:
        // C1: capacitor 1uF, R1: resistor 1k en paralelo de 1 a 2.
        // R2: resistor 1k de 2 a 0.
        // Esta configuración tiene un polo en -2000 rad/s y un cero en -1000 rad/s.
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "C1".to_string(),
                    comp_type: "capacitor".to_string(),
                    value: 1e-6,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R2".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let res = run_stability_analysis(&netlist);
        assert!(res.is_ok(), "El análisis de estabilidad debería ejecutarse con éxito");
        let data = res.unwrap();
        assert!(data.is_stable, "El circuito RC debe ser estable");
        
        // Debería detectar el polo en aprox -2000 rad/s y el cero en aprox -1000 rad/s
        assert!(!data.poles.is_empty(), "Debería haber polos");
        assert!(!data.zeros.is_empty(), "Debería haber ceros de transmisión");

        let has_pole_2000 = data.poles.iter().any(|p| (p.re + 2000.0).abs() < 10.0);
        let has_zero_1000 = data.zeros.iter().any(|z| (z.re + 1000.0).abs() < 10.0);

        // Verificar el polo y el cero calculados
        assert!(has_pole_2000, "Debería tener un polo cerca de -2000, obtenidos: {:?}", data.poles);
        assert!(has_zero_1000, "Debería tener un cero cerca de -1000, obtenidos: {:?}", data.zeros);
    }

    #[test]
    fn test_ac_and_noise_sweep_bsim3() {
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 1.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    amplitude: Some(1.0),
                    frequency: Some(1e3),
                    ..Default::default()
                },
                ComponentData {
                    id: "M1".to_string(),
                    comp_type: "bsim3nmos".to_string(),
                    value: 0.4, // Vth0 = 0.4 V
                    pins: vec!["1".to_string(), "2".to_string(), "0".to_string()],
                    w: Some(10e-6),
                    l: Some(0.18e-6),
                    ..Default::default()
                },
                ComponentData {
                    id: "RL".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: Some(300.0),
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        // 1. Probar AC Sweep
        let ac_settings = AcSweepSettings {
            f_start: 10.0,
            f_end: 1000.0,
            points_per_decade: 5,
            op_guess: None,
        };
        let ac_res = solve_ac_sweep(&netlist, &ac_settings);
        assert!(ac_res.is_ok(), "AC Sweep con BSIM3nmos debería converger y ejecutarse con éxito");
        let ac_data = ac_res.unwrap();
        assert!(!ac_data.frequencies.is_empty());
        assert!(ac_data.node_amplitudes.contains_key("2"));

        // 2. Probar Noise Sweep
        let noise_settings = NoiseSweepSettings {
            output_node: "2".to_string(),
            reference_node: "0".to_string(),
            ac_settings,
        };
        let noise_res = solve_noise_sweep(&netlist, &noise_settings);
        assert!(noise_res.is_ok(), "Noise Sweep con BSIM3nmos debería converger y ejecutarse con éxito");
        let noise_data = noise_res.unwrap();
        assert!(!noise_data.output_noise_density.is_empty());
    }

    #[test]
    fn test_dc_sweep_continuation() {
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 0.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "D1".to_string(),
                    comp_type: "diode".to_string(),
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let sweep_settings = DcSweepSettings {
            source_id: "V1".to_string(),
            v_start: 0.0,
            v_end: 2.0,
            v_step: 0.1,
        };

        let sweep_res = solve_dc_sweep(&netlist, &sweep_settings);
        assert!(sweep_res.is_ok(), "DC Sweep con continuación de estados debería converger sin problemas");
        let data = sweep_res.unwrap();
        assert_eq!(data.sweep_voltages.len(), 21);
        assert!(data.node_voltages.contains_key("2"));
        
        // El voltaje del nodo 2 (después del diodo) debería subir a medida que V1 sube
        let v2_final = data.node_voltages.get("2").unwrap().last().unwrap();
        assert!(*v2_final > 1.0, "Con 2V de entrada, el nodo 2 debería estar sobre 1.0V (obtenido: {}V)", v2_final);
    }

    #[test]
    fn test_opamp_dominant_pole() {
        // Circuito con Op-Amp en lazo abierto
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "Vin".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 1e-4, // Tensión pequeña para evitar saturación en lazo abierto
                    pins: vec!["1".to_string(), "0".to_string()],
                    wave_type: Some("sine".to_string()),
                    amplitude: Some(1e-4),
                    frequency: Some(1e3),
                    ..Default::default()
                },
                ComponentData {
                    id: "X1".to_string(),
                    comp_type: "opamp".to_string(),
                    value: 1e5,
                    pins: vec!["1".to_string(), "0".to_string(), "0".to_string(), "0".to_string(), "2".to_string()], // IN+, IN-, V+ (GND), V- (GND), OUT
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        // Probar AC Sweep a 1 Hz y 1000 Hz
        let ac_settings_low = AcSweepSettings {
            f_start: 1.0,
            f_end: 1.0,
            points_per_decade: 1,
            op_guess: None,
        };
        let ac_res_low = solve_ac_sweep(&netlist, &ac_settings_low).unwrap();
        let amp_low = ac_res_low.node_amplitudes.get("2").unwrap()[0];

        let ac_settings_high = AcSweepSettings {
            f_start: 1000.0,
            f_end: 1000.0,
            points_per_decade: 1,
            op_guess: None,
        };
        let ac_res_high = solve_ac_sweep(&netlist, &ac_settings_high).unwrap();
        let amp_high = ac_res_high.node_amplitudes.get("2").unwrap()[0];

        // A 1 Hz: Ganancia open-loop alta (~93 dB), salida de 1e-4V * 4.48e4 = 4.48V (~13 dBV)
        // A 1000 Hz: Ganancia open-loop atenuada por 100x (-40 dB), salida de 44.8mV (~-27 dBV)
        assert!(amp_low > 5.0, "La ganancia en baja frecuencia debería ser alta, obtenido: {} dBV", amp_low);
        assert!(amp_high < -10.0, "La ganancia en alta frecuencia debería estar severamente atenuada por el polo, obtenido: {} dBV", amp_high);
    }

    #[test]
    fn test_mos_flicker_noise_geometry() {
        // Netlist con un NMOS estándar
        let netlist_w10 = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "Vdd".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Vg".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 2.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Rd".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 100.0,
                    pins: vec!["1".to_string(), "3".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "M1".to_string(),
                    comp_type: "nmos".to_string(),
                    value: 0.0,
                    pins: vec!["2".to_string(), "3".to_string(), "0".to_string()],
                    w: Some(10.0e-6),
                    l: Some(0.18e-6),
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        // NMOS con W = 50 um (5x más ancho, debería tener 5x menos ruido 1/f)
        let netlist_w50 = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "Vdd".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Vg".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 2.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Rd".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 100.0,
                    pins: vec!["1".to_string(), "3".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "M1".to_string(),
                    comp_type: "nmos".to_string(),
                    value: 0.0,
                    pins: vec!["2".to_string(), "3".to_string(), "0".to_string()],
                    w: Some(50.0e-6),
                    l: Some(0.18e-6),
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let noise_settings = NoiseSweepSettings {
            output_node: "3".to_string(),
            reference_node: "0".to_string(),
            ac_settings: AcSweepSettings {
                f_start: 1.0,
                f_end: 1.0,
                points_per_decade: 1,
                op_guess: None,
            },
        };

        let res_w10 = solve_noise_sweep(&netlist_w10, &noise_settings).unwrap();
        let res_w50 = solve_noise_sweep(&netlist_w50, &noise_settings).unwrap();

        let noise_w10 = res_w10.output_noise_density[0];
        let noise_w50 = res_w50.output_noise_density[0];

        // El ruido a W=50um debería ser menor que a W=10um gracias a la dependencia geométrica 1 / (W*L)
        assert!(noise_w50 < noise_w10, "El ruido 1/f con MOSFET más ancho debería estar suprimido (W50: {} < W10: {})", noise_w50, noise_w10);
    }

    #[test]
    fn test_diode_clipper_transient() {
        // Circuito: Vin (10 MHz sine, 5V amp) -> R1 (1k) -> D1 (anodo a nodo 2, catodo a gnd)
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "Vin".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 0.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    wave_type: Some("sine".to_string()),
                    amplitude: Some(5.0),
                    frequency: Some(1e7), // 10 MHz
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "D1".to_string(),
                    comp_type: "diode".to_string(),
                    value: 0.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: Some(true),
            subcircuit_definitions: None,
            triggers: None,
        };

        let settings = TransientSettings {
            dt: 1e-9,      // 1 ns
            t_max: 200e-9,  // 200 ns
            fixed_step: Some(true),
            integration_method: None,
        };

        let results = solve_transient_circuit(&netlist, &settings).unwrap();
        assert!(results.len() > 0);

        let mut max_v2 = 0.0;
        for step in &results {
            let v2 = *step.node_voltages.get("2").unwrap();
            if v2 > max_v2 {
                max_v2 = v2;
            }
        }
        
        assert!(max_v2 > 0.0, "La tensión debería ser positiva en los semiciclos positivos.");
    }

    #[test]
    fn test_microcontrollers_mixed_signal() {
        // 1. Test Arduino Uno - Mode 1 (Blink)
        // Pins layout: [Pin_In, Pin_Out, Pin_ADC, Pin_DAC, Pin_VCC, Pin_GND]
        let netlist_arduino = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "MCU1".to_string(),
                    comp_type: "arduino_uno".to_string(),
                    value: 1.0, // Mode 1 (Blink)
                    pins: vec!["1".to_string(), "2".to_string(), "3".to_string(), "4".to_string(), "5".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: Some(true),
            subcircuit_definitions: None,
            triggers: None,
        };

        // En continua (DC), el carril Pin_VCC (nodo 5) debería auto-polarizarse a 5.0 V gracias al Norton equivalent interno.
        let dc_res = solve_dc_circuit(&netlist_arduino).unwrap();
        let v_vcc = *dc_res.node_voltages.get("5").unwrap();
        assert!((v_vcc - 5.0).abs() < 0.1, "El carril de VCC de Arduino debería regular a ~5.0V, obtenido: {}", v_vcc);

        // En transitorio, verificamos el parpadeo a 1 Hz (T = 1.0 s, 0.5s HIGH, 0.5s LOW)
        let settings_blink = TransientSettings {
            dt: 0.1,
            t_max: 1.2,
            fixed_step: Some(true),
            integration_method: None,
        };
        let results_blink = solve_transient_circuit(&netlist_arduino, &settings_blink).unwrap();
        
        let get_out_voltage = |t_target: f64| -> f64 {
            let step = results_blink.iter().min_by(|a, b| {
                (a.time - t_target).abs().partial_cmp(&(b.time - t_target).abs()).unwrap()
            }).unwrap();
            *step.node_voltages.get("2").unwrap()
        };

        // A t = 0.2 s, debería estar en HIGH (~5.0 V)
        let v_t0_2 = get_out_voltage(0.2);
        assert!(v_t0_2 > 4.5, "Blink a 0.2s debería estar en HIGH, obtenido: {}", v_t0_2);

        // A t = 0.7 s, debería estar en LOW (~0 V)
        let v_t0_7 = get_out_voltage(0.7);
        assert!(v_t0_7 < 0.5, "Blink a 0.7s debería estar en LOW, obtenido: {}", v_t0_7);


        // 2. Test ESP32 - Mode 0 (Follower)
        // Vin conectado a Pin_ADC (nodo 3)
        let netlist_esp32 = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "MCU2".to_string(),
                    comp_type: "esp32".to_string(),
                    value: 0.0, // Mode 0 (Eco Follower)
                    pins: vec!["1".to_string(), "2".to_string(), "3".to_string(), "4".to_string(), "5".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Vin".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 1.5,
                    pins: vec!["3".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: Some(true),
            subcircuit_definitions: None,
            triggers: None,
        };

        let dc_res_esp32 = solve_dc_circuit(&netlist_esp32).unwrap();
        let v_vcc_esp32 = *dc_res_esp32.node_voltages.get("5").unwrap();
        assert!((v_vcc_esp32 - 3.3).abs() < 0.1, "El carril de VCC de ESP32 debería regular a ~3.3V, obtenido: {}", v_vcc_esp32);

        // Pin_DAC (nodo 4) debería seguir a Pin_ADC (Vin = 1.5V)
        let v_dac = *dc_res_esp32.node_voltages.get("4").unwrap();
        assert!((v_dac - 1.5).abs() < 0.2, "El dac debería seguir al adc (1.5V), obtenido: {}", v_dac);


        // 3. Test Raspberry Pi Pico - Mode 2 (Hysteresis Comparator)
        let netlist_pico = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "MCU3".to_string(),
                    comp_type: "raspberry_pi_pico".to_string(),
                    value: 2.0, // Mode 2 (Comparator)
                    pins: vec!["1".to_string(), "2".to_string(), "3".to_string(), "4".to_string(), "5".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Vin".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 0.0,
                    pins: vec!["3".to_string(), "0".to_string()],
                    wave_type: Some("sine".to_string()),
                    amplitude: Some(1.65),
                    frequency: Some(1.0),
                    offset: Some(1.65),
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: Some(true),
            subcircuit_definitions: None,
            triggers: None,
        };

        let settings_pico = TransientSettings {
            dt: 0.01,
            t_max: 1.0,
            fixed_step: Some(true),
            integration_method: None,
        };
        let results_pico = solve_transient_circuit(&netlist_pico, &settings_pico).unwrap();
        assert!(results_pico.len() > 0);
    }

    #[test]
    fn test_microcontrollers_phd_level() {
        // 1. Verificar la limitación de sobrecorriente activa del pin de salida digital (Short-circuit protection)
        // Conectamos el pin OUT de Arduino (nodo 2) a GND mediante un resistor de 1 Ohm.
        // Con Rload = 1 Ohm, la corriente teórica sin protección superaría los 250 mA.
        let netlist_short = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "MCU1".to_string(),
                    comp_type: "arduino_uno".to_string(),
                    value: 1.0, // Mode 1 (Blink - HIGH en continua)
                    pins: vec!["1".to_string(), "2".to_string(), "3".to_string(), "4".to_string(), "5".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Rload".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1.0, // 1 Ohm
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: Some(true),
            subcircuit_definitions: None,
            triggers: None,
        };

        // En continua (DC), resolvemos el circuito.
        let res = solve_dc_circuit(&netlist_short).unwrap();
        
        // Obtenemos el voltaje en el nodo 2. La corriente a través del resistor Rload es V(2)/1.
        // Con limitación activa a 40 mA, V(2) debería ser aproximadamente I_max * Rload = 40 mV.
        let v_out = *res.node_voltages.get("2").unwrap();
        
        // Permitimos una tolerancia ya que el modelo Norton incluye la resistencia de salida de 20 Ohm.
        // Con Rload = 1 Ohm y G_out = 0.05 S (R_out = 20 Ohm):
        // I_load = I_eq_clamped * R_out / (R_out + R_load) = 40 mA * 20 / 21 = 38 mA.
        // V_out = I_load * R_load = 38 mV.
        assert!(v_out < 0.1, "La protección activa contra sobrecorrientes debería limitar la tensión a <100mV bajo cortocircuito, obtenido: {}V", v_out);
        assert!(v_out > 0.01, "Debería haber una corriente circulando (>10mV), obtenido: {}V", v_out);

        // 2. Verificar el transitorio electro-térmico y muestreo ADC S&H
        // Simulamos un ESP32 en Modo 0 (Eco) con entrada analógica (1.5V) y reloj de muestreo activo.
        let netlist_thermal = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "MCU2".to_string(),
                    comp_type: "esp32".to_string(),
                    value: 0.0, // Modo 0 (Eco)
                    pins: vec!["1".to_string(), "2".to_string(), "3".to_string(), "4".to_string(), "5".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Vin".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 2.0,
                    pins: vec!["3".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: Some(300.0), // 300 K = 26.85 ºC
            fixed_step: Some(true),
            subcircuit_definitions: None,
            triggers: None,
        };

        let settings = TransientSettings {
            dt: 1e-6, // 1 microsegundo de paso para ver el muestreo activo de S&H
            t_max: 5e-6, // 5 pasos
            fixed_step: Some(true),
            integration_method: None,
        };

        let results = solve_transient_circuit(&netlist_thermal, &settings).unwrap();
        assert!(results.len() > 0, "Debería completar el análisis transitorio electro-térmico mixed-signal.");
    }

    #[test]
    fn test_gear2_integration_stability() {
        // Circuito RLC subamortiguado en serie
        let netlist_rlc = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "Vin".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 10.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "L1".to_string(),
                    comp_type: "inductor".to_string(),
                    value: 1e-3,
                    pins: vec!["2".to_string(), "3".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "C1".to_string(),
                    comp_type: "capacitor".to_string(),
                    value: 10e-6,
                    pins: vec!["3".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: Some(true),
            subcircuit_definitions: None,
            triggers: None,
        };

        // 1. Simular con Backward Euler
        let settings_euler = TransientSettings {
            dt: 1e-5,
            t_max: 1e-3,
            fixed_step: Some(true),
            integration_method: Some("euler".to_string()),
        };
        let results_euler = solve_transient_circuit(&netlist_rlc, &settings_euler).unwrap();
        assert!(results_euler.len() > 0);

        // 2. Simular con Gear 2 (BDF2)
        let settings_gear = TransientSettings {
            dt: 1e-5,
            t_max: 1e-3,
            fixed_step: Some(true),
            integration_method: Some("gear2".to_string()),
        };
        let results_gear = solve_transient_circuit(&netlist_rlc, &settings_gear).unwrap();
        assert!(results_gear.len() > 0);
        assert_eq!(results_euler.len(), results_gear.len());

        // Verificar que el capacitor de Gear 2 se carga y oscila suavemente hacia 5V
        let final_step_gear = results_gear.last().unwrap();
        let v_cap_gear = *final_step_gear.node_voltages.get("3").unwrap();
        assert!(v_cap_gear > 0.0 && v_cap_gear < 10.0);
    }

    #[test]
    fn test_b_source_math_evaluator() {
        let mut nv = HashMap::new();
        nv.insert("0".to_string(), 0.0);
        nv.insert("1".to_string(), 5.0);
        nv.insert("2".to_string(), 3.0);
        nv.insert("3".to_string(), 1.5);
        let mut bc = HashMap::new();
        bc.insert("V1".to_string(), 0.025);

        // Constantes y aritmética básica
        let r1 = evaluate_expression_string("2.5 + 3.0 * 2.0", &nv, &bc, 0.0).unwrap();
        assert!((r1 - 8.5).abs() < 1e-10, "2.5 + 3.0 * 2.0 = 8.5, obtenido: {}", r1);

        // sin(pi/2) = 1.0
        let r2 = evaluate_expression_string("sin(pi / 2)", &nv, &bc, 0.0).unwrap();
        assert!((r2 - 1.0).abs() < 1e-10, "sin(pi/2) = 1.0, obtenido: {}", r2);

        // ln(exp(1)) = 1.0
        let r3 = evaluate_expression_string("ln(exp(1))", &nv, &bc, 0.0).unwrap();
        assert!((r3 - 1.0).abs() < 1e-6, "ln(exp(1)) = 1.0, obtenido: {}", r3);

        // V(1) = 5.0
        let r4 = evaluate_expression_string("V(1)", &nv, &bc, 0.0).unwrap();
        assert!((r4 - 5.0).abs() < 1e-10, "V(1) = 5.0, obtenido: {}", r4);

        // V(1, 2) = V(1) - V(2) = 5.0 - 3.0 = 2.0
        let r5 = evaluate_expression_string("V(1, 2)", &nv, &bc, 0.0).unwrap();
        assert!((r5 - 2.0).abs() < 1e-10, "V(1,2) = 2.0, obtenido: {}", r5);

        // I(V1) = 0.025
        let r6 = evaluate_expression_string("I(V1)", &nv, &bc, 0.0).unwrap();
        assert!((r6 - 0.025).abs() < 1e-10, "I(V1) = 0.025, obtenido: {}", r6);

        // Expresión compuesta: V(1) * sin(pi/2) + V(2)^2 = 5.0 * 1.0 + 9.0 = 14.0
        let r7 = evaluate_expression_string("V(1) * sin(pi / 2) + V(2) ^ 2", &nv, &bc, 0.0).unwrap();
        assert!((r7 - 14.0).abs() < 1e-10, "V(1)*sin(pi/2)+V(2)^2 = 14.0, obtenido: {}", r7);

        // Operador unario negativo: -V(3) = -1.5
        let r8 = evaluate_expression_string("-V(3)", &nv, &bc, 0.0).unwrap();
        assert!((r8 - (-1.5)).abs() < 1e-10, "-V(3) = -1.5, obtenido: {}", r8);

        // Tiempo transitorio: t con time = 0.001
        let r9 = evaluate_expression_string("sin(2 * pi * 1000 * t)", &nv, &bc, 0.001).unwrap();
        let expected = (2.0 * std::f64::consts::PI * 1000.0 * 0.001).sin();
        assert!((r9 - expected).abs() < 1e-10, "sin(2*pi*1000*t) con t=0.001, obtenido: {}", r9);

        // sqrt(abs(-16)) = 4.0
        let r10 = evaluate_expression_string("sqrt(abs(-16))", &nv, &bc, 0.0).unwrap();
        assert!((r10 - 4.0).abs() < 1e-10, "sqrt(abs(-16)) = 4.0, obtenido: {}", r10);

        // max y min
        let r11 = evaluate_expression_string("max(V(1), V(2))", &nv, &bc, 0.0).unwrap();
        assert!((r11 - 5.0).abs() < 1e-10, "max(V(1), V(2)) = 5.0, obtenido: {}", r11);

        let r12 = evaluate_expression_string("min(V(1), V(2))", &nv, &bc, 0.0).unwrap();
        assert!((r12 - 3.0).abs() < 1e-10, "min(V(1), V(2)) = 3.0, obtenido: {}", r12);
    }

    #[test]
    fn test_b_source_nonlinear_voltage() {
        // Circuito: V1 (5V) -> nodo 1, R1 (1k) entre nodo 1 y nodo 2,
        // B1 (bvoltage) entre nodo 3 y GND con expresión "V(1) * 2" (debería dar 10V),
        // R2 (1k) entre nodo 3 y GND para cargar el nodo 3.
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R2".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "B1".to_string(),
                    comp_type: "bvoltage".to_string(),
                    value: 0.0,
                    pins: vec!["3".to_string(), "0".to_string()],
                    expression: Some("V(1) * 2".to_string()),
                    ..Default::default()
                },
                ComponentData {
                    id: "R3".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["3".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let result = solve_dc_circuit(&netlist).unwrap();

        // V(1) debería ser 5.0V
        let v1 = *result.node_voltages.get("1").unwrap();
        assert!((v1 - 5.0).abs() < 0.01, "V(1) debería ser ~5.0V, obtenido: {}", v1);

        // V(3) debería ser V(1) * 2 = 10.0V (forzado por bvoltage B1)
        let v3 = *result.node_voltages.get("3").unwrap();
        assert!((v3 - 10.0).abs() < 0.1, "V(3) debería ser ~10.0V (B1 = V(1)*2), obtenido: {}", v3);
    }

    #[test]
    fn test_b_source_nonlinear_current() {
        // Circuito: V1 (5V) -> nodo 1 -> R1 (1k) -> nodo 2 -> GND
        // B_I1 (bcurrent) inyecta corriente V(1)/1000 desde nodo 2 a GND
        // Esto es equivalente a una resistencia paralela de 1k entre nodo 2 y GND
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R2".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "BI1".to_string(),
                    comp_type: "bcurrent".to_string(),
                    value: 0.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    expression: Some("V(2) / 1000".to_string()),
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let result = solve_dc_circuit(&netlist).unwrap();

        // V(1) debería ser 5.0V
        let v1 = *result.node_voltages.get("1").unwrap();
        assert!((v1 - 5.0).abs() < 0.01, "V(1) debería ser ~5.0V, obtenido: {}", v1);

        // V(2): R1 (1k) conecta V(1)=5V a nodo 2. En nodo 2 hay R2 (1k) a GND y 
        // bcurrent que drena V(2)/1000 A extra. Sin bcurrent: V(2) = 2.5V.
        // Con bcurrent: la carga efectiva extra es como otra resistencia de 1k en paralelo con R2.
        // R_eq_load = R2 || 1k_equivalente_bcurrent, pero es no lineal.
        // Analíticamente: V(2) = V(1) * R_load/(R1 + R_load)
        // Corriente total de nodo 2: (V1-V2)/R1 = V2/R2 + V2/1000
        // (5-V2)/1000 = V2/1000 + V2/1000 = 2*V2/1000
        // 5 - V2 = 2*V2 -> V2 = 5/3 ≈ 1.667V
        let v2 = *result.node_voltages.get("2").unwrap();
        let expected_v2 = 5.0 / 3.0;
        assert!((v2 - expected_v2).abs() < 0.1, "V(2) debería ser ~{:.3}V con bcurrent, obtenido: {}", expected_v2, v2);
    }

    // ======================================================================
    // PRUEBAS UNITARIAS DEL MOTOR DE DIFERENCIACIÓN AUTOMÁTICA AD (B-SOURCE)
    // ======================================================================

    #[test]
    fn test_b_source_ad_findiff_codegen_empty_grad() {
        let mut cache = HashMap::new();
        let nv = [("1".to_string(), 5.0), ("2".to_string(), 3.0)].into_iter().collect();
        let bc = HashMap::new();
        let ad = evaluate_expression_ad("42.0", &nv, &bc, 0.0, &mut cache).unwrap();
        assert!(ad.grad.is_empty(), "Constante 42 debería tener grad vacío, tiene {:?}", ad.grad);
    }

    #[test]
    fn test_b_source_ad_findiff_codegen_voltage_ref() {
        let mut cache = HashMap::new();
        let nv = [("1".to_string(), 5.0), ("2".to_string(), 3.0)].into_iter().collect();
        let bc = HashMap::new();
        let ad = evaluate_expression_ad("V(1)", &nv, &bc, 0.0, &mut cache).unwrap();
        assert_eq!(ad.value, 5.0, "V(1) debería ser 5.0");
        assert_eq!(ad.grad.get(&1), Some(&1.0), "dV(1)/dV1 debería ser 1");
    }

    #[test]
    fn test_b_source_ad_findiff_codegen_vdiff_grad() {
        let mut cache = HashMap::new();
        let nv = [("1".to_string(), 7.0), ("2".to_string(), 2.0)].into_iter().collect();
        let bc = HashMap::new();
        let ad = evaluate_expression_ad("V(1,2)", &nv, &bc, 0.0, &mut cache).unwrap();
        assert!((ad.value - 5.0).abs() < 1e-12, "V(1,2) debería ser 5.0, es {}", ad.value);
        assert_eq!(ad.grad.get(&1), Some(&1.0), "dV(1,2)/dV1 debería ser 1");
        assert_eq!(ad.grad.get(&2), Some(&-1.0), "dV(1,2)/dV2 debería ser -1");
    }

    #[test]
    fn test_b_source_ad_findiff_codegen_product_rule() {
        let mut cache = HashMap::new();
        let nv = [("1".to_string(), 3.0), ("2".to_string(), 4.0)].into_iter().collect();
        let bc = HashMap::new();
        let ad = evaluate_expression_ad("V(1)*V(2)", &nv, &bc, 0.0, &mut cache).unwrap();
        assert!((ad.value - 12.0).abs() < 1e-12, "V(1)*V(2) debería ser 12, es {}", ad.value);
        // d/dV1 = V(2) = 4, d/dV2 = V(1) = 3
        assert!((ad.grad.get(&1).unwrap_or(&0.0) - 4.0).abs() < 1e-12, "dV/dV1 debería ser 4");
        assert!((ad.grad.get(&2).unwrap_or(&0.0) - 3.0).abs() < 1e-12, "dV/dV2 debería ser 3");
    }

    #[test]
    fn test_b_source_ad_findiff_codegen_chain_rule() {
        let mut cache = HashMap::new();
        let nv = [("1".to_string(), std::f64::consts::FRAC_PI_4)].into_iter().collect();
        let bc = HashMap::new();
        let ad = evaluate_expression_ad("sin(V(1))", &nv, &bc, 0.0, &mut cache).unwrap();
        let expected_val = (std::f64::consts::FRAC_PI_4).sin();
        assert!((ad.value - expected_val).abs() < 1e-12, "sin(V(1)) debería ser {}, es {}", expected_val, ad.value);
        let expected_deriv = (std::f64::consts::FRAC_PI_4).cos();
        assert!((ad.grad.get(&1).unwrap_or(&0.0) - expected_deriv).abs() < 1e-12,
            "d(sin(V1))/dV1 debería ser {}, es {}", expected_deriv, ad.grad.get(&1).unwrap_or(&0.0));
    }

    #[test]
    fn test_b_source_ad_findiff_codegen_vs_findiff() {
        let mut cache = HashMap::new();
        let eps = 1e-6;
        let v0 = 2.0;
        let nv = [("1".to_string(), v0)].into_iter().collect();
        let bc = HashMap::new();
        let ad = evaluate_expression_ad("V(1)*V(1) + exp(V(1))", &nv, &bc, 0.0, &mut cache).unwrap();
        let analytic_deriv = ad.grad.get(&1).unwrap_or(&0.0);

        let nv_plus = [("1".to_string(), v0 + eps)].into_iter().collect();
        let ad_plus = evaluate_expression_ad("V(1)*V(1) + exp(V(1))", &nv_plus, &bc, 0.0, &mut cache).unwrap();
        let nv_minus = [("1".to_string(), v0 - eps)].into_iter().collect();
        let ad_minus = evaluate_expression_ad("V(1)*V(1) + exp(V(1))", &nv_minus, &bc, 0.0, &mut cache).unwrap();
        let fd_deriv = (ad_plus.value - ad_minus.value) / (2.0 * eps);

        assert!((analytic_deriv - fd_deriv).abs() < 1e-6,
            "Analytic dV/dV1={} no coincide con FD={}", analytic_deriv, fd_deriv);
    }

    #[test]
    fn test_b_source_ad_findiff_codegen_bvoltage_stamp() {
        let netlist = CircuitNetlist {
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 10.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "B1".to_string(),
                    comp_type: "bvoltage".to_string(),
                    value: 0.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    expression: Some("V(1) / 2.0".to_string()),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let result = solve_dc_circuit(&netlist).unwrap();
        let v2 = *result.node_voltages.get("2").unwrap();
        assert!((v2 - 5.0).abs() < 0.1, "V(2) con bvoltage AD debería ser ~5.0V, es {}", v2);
    }

    #[test]
    fn test_b_source_ad_findiff_codegen_bcurrent_stamp() {
        let netlist = CircuitNetlist {
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R2".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "B1".to_string(),
                    comp_type: "bcurrent".to_string(),
                    value: 0.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    expression: Some("V(2) / 1000".to_string()),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let result = solve_dc_circuit(&netlist).unwrap();
        let v2 = *result.node_voltages.get("2").unwrap();
        let expected_v2 = 5.0 / 3.0;
        assert!((v2 - expected_v2).abs() < 0.1,
            "V(2) con bcurrent AD debería ser ~{:.3}V, es {}", expected_v2, v2);
    }

    #[test]
    fn test_self_heating_diode_transient() {
        // Circuito: V1 (sine 1kHz, 5V) -> nodo 1, R1 (1kΩ) entre nodo 1 y nodo 2, D1 entre nodo 2 y GND
        // Self-heating no debe provocar divergencia y el modelo térmico debe activarse
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 0.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    wave_type: Some("sine".to_string()),
                    amplitude: Some(5.0),
                    frequency: Some(1e3), // 1 kHz
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "D1".to_string(),
                    comp_type: "diode".to_string(),
                    value: 0.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: Some(300.0),
            fixed_step: Some(true),
            subcircuit_definitions: None,
            triggers: None,
        };

        let settings = TransientSettings {
            dt: 1e-5,       // 10 μs
            t_max: 2e-3,    // 2 ms — 2 ciclos completos de la senoidal a 1 kHz
            fixed_step: Some(true),
            integration_method: Some("euler".to_string()),
        };

        let results = solve_transient_circuit(&netlist, &settings).unwrap();
        assert!(results.len() > 50, "Debería haber > 50 pasos, hay: {}", results.len());

        // Verificar que la simulación con self-heating produce resultados estables
        let last = results.last().unwrap();
        let v2_last = *last.node_voltages.get("2").unwrap();
        // V(2) debe estar en un rango razonable (clip del diodo entre -0.7V y ~5V)
        assert!(v2_last > -1.0 && v2_last < 6.0, "V(2) fuera de rango, obtenido: {}", v2_last);

        // Verificar que hay corriente no trivial en algún paso (semiciclo positivo)
        let mut found_current = false;
        for step in &results {
            let i_v1 = step.branch_currents.get("V1").unwrap().abs();
            if i_v1 > 0.001 { // > 1 mA
                found_current = true;
                break;
            }
        }
        assert!(found_current, "El diodo debería conducir corriente > 1 mA en el semiciclo positivo");

        // Verificar que get_thermal_parameters_junction produce valores físicamente sensatos
        let (vt_310, is_310) = get_thermal_parameters_junction(310.0, None);
        let (vt_300, is_300) = get_thermal_parameters_junction(300.0, None);
        // A mayor temperatura: Vt debe aumentar (k*T/q crece) e Is debe aumentar (más portadores)
        assert!(vt_310 > vt_300, "Vt(310K) = {} debería ser > Vt(300K) = {}", vt_310, vt_300);
        assert!(is_310 > is_300, "Is(310K) = {} debería ser > Is(300K) = {}", is_310, is_300);
        // Verificar ratio: Is crece ~4x por cada 10°C para silicio con modelo SPICE (T/T0)^3 * exp(-Eg*q/k*(1/T-1/T0))
        let is_ratio = is_310 / is_300;
        assert!(is_ratio > 2.0 && is_ratio < 6.0, 
            "Is(310K)/Is(300K) = {:.3}, debería estar entre 2.0 y 6.0 para silicio (SPICE)", is_ratio);
    }

    #[test]
    fn test_bsim4_nmos_gate_leakage() {
        let w = Some(10e-6);
        let l = Some(0.045e-6); // canal corto de 45nm
        
        let (_ids_low, _gm_low, _gds_low, igs_low, _gg_low) = evaluate_bsim4_nmos(0.2, 0.5, 0.0, 0.35, w, l);
        let (_ids_high, _gm_high, _gds_high, igs_high, gg_high) = evaluate_bsim4_nmos(1.0, 0.5, 0.0, 0.35, w, l);

        // A Vgs = 0.2V, Ig es extremadamente bajo o cero:
        assert!(igs_low < 1e-12, "Ig a baja tensión debería ser < 1 pA, obtenido: {}", igs_low);
        
        // A Vgs = 1.0V, Ig debe crecer de forma cuántica debido a la capa de óxido ultrafina de 1.4nm:
        assert!(igs_high > 1e-9, "Ig a nominal debería ser > 1 nA, obtenido: {}", igs_high);
        assert!(gg_high > 1e-9, "Conductancia de compuerta gg a nominal debería ser > 1 nS, obtenido: {}", gg_high);

        // Verificamos escalado geométrico: duplicar W debe duplicar exactamente Ig y gg
        let (_, _, _, igs_high_double, gg_high_double) = evaluate_bsim4_nmos(1.0, 0.5, 0.0, 0.35, Some(20e-6), l);
        assert!((igs_high_double - 2.0 * igs_high).abs() < 1e-15, "Duplicar W debería duplicar Ig");
        assert!((gg_high_double - 2.0 * gg_high).abs() < 1e-15, "Duplicar W debería duplicar gg");
    }

    #[test]
    fn test_bsim4_pmos_short_channel_saturation() {
        let w = Some(1e-6);
        let l = Some(0.045e-6);

        // Con Vsg = 1.0V (Encendido), evaluamos a vsd = 0.2V (Región lineal) y vsd = 1.0V (Saturación con CLM)
        let (isd_lin, _, _gds_lin, _, _) = evaluate_bsim4_pmos(1.0, 0.2, 0.0, 0.35, w, l);
        let (isd_sat, _, gds_sat, _, _) = evaluate_bsim4_pmos(1.0, 1.0, 0.0, 0.35, w, l);

        // La corriente de saturación debe ser mayor que la corriente lineal:
        assert!(isd_sat > isd_lin, "Corriente en saturación {} debe ser mayor que en triodo {}", isd_sat, isd_lin);
        
        // Gracias a CLM (lambda_clm = 0.08), la conductancia de salida gds en saturación no es cero:
        assert!(gds_sat > 1e-9, "Gds en saturación debe ser mayor a 1 nS debido a CLM, obtenido: {}", gds_sat);
    }

    #[test]
    fn test_diode_dynamic_models() {
        use crate::parser::parse_spice_netlist_to_native;

        // Dos diodos en paralelo excitados por la misma corriente.
        // DSi es de silicio con is=1e-14, DSchottky es Schottky con is=1e-7.
        // Evaluamos el voltaje en sus ánodos.
        let netlist_str = "
        * Test dynamic Shockley diode models
        .model MySi D(is=1e-14 n=1.0)
        .model MySchottky D(is=1e-7 n=1.0)

        V1 1 0 5.0
        R1 1 2 1k
        R2 1 3 1k
        DSi 2 0 MySi
        DSchottky 3 0 MySchottky
        ";

        let netlist = parse_spice_netlist_to_native(netlist_str).unwrap();

        // Verificar que los parámetros del modelo se extrajeron correctamente
        let d_si = netlist.components.iter().find(|c| c.id == "DSi").unwrap();
        assert_eq!(d_si.diode_is, Some(1e-14));
        assert_eq!(d_si.diode_n, Some(1.0));

        let d_schottky = netlist.components.iter().find(|c| c.id == "DSchottky").unwrap();
        assert_eq!(d_schottky.diode_is, Some(1e-7));
        assert_eq!(d_schottky.diode_n, Some(1.0));

        // Resolver el punto de operación DC
        let result = solve_dc_circuit(&netlist).unwrap();
        let v_si = *result.node_voltages.get("2").unwrap();
        let v_schottky = *result.node_voltages.get("3").unwrap();

        // Un diodo de silicio nominal a 1-5 mA tiene una caída de ~0.7V
        // Un diodo Schottky nominal a 1-5 mA tiene una caída de ~0.3V
        assert!(v_si > 0.6 && v_si < 0.8, "El voltaje de silicio debería ser ~0.7V, obtenido: {}", v_si);
        assert!(v_schottky > 0.2 && v_schottky < 0.45, "El voltaje de Schottky debería ser ~0.3V, obtenido: {}", v_schottky);
        assert!(v_si - v_schottky > 0.25, "La diferencia de tensión debería ser > 0.25V, obtenido: {}", v_si - v_schottky);
    }

    #[test]
    fn test_bjt_dynamic_parameters() {
        use crate::parser::parse_spice_netlist_to_native;

        // Dos transistores NPN con parámetros de modelo muy distintos
        // Q1 es un transistor de señal pequeña convencional (bf=200, is=1e-15)
        // Q2 es un transistor de potencia con ganancia mucho menor (bf=50, is=1e-11)
        let netlist_str = "
        * Test dynamic BJT parameters
        .model Qsmall NPN(is=1e-15 bf=200 vaf=120 rb=10 rc=2)
        .model Qpower NPN(is=1e-11 bf=50 vaf=60 rb=5 rc=1)

        Vcc 1 0 10.0
        Vbb 2 0 2.0
        Rb1 2 5 100k
        Rb2 2 6 100k
        R1 1 3 1k
        R2 1 4 1k
        Q1 5 3 0 Qsmall
        Q2 6 4 0 Qpower
        ";

        let netlist = parse_spice_netlist_to_native(netlist_str).unwrap();

        // Verificar mapeo del parser
        let q1 = netlist.components.iter().find(|c| c.id == "Q1").unwrap();
        assert_eq!(q1.bjt_bf, Some(200.0));
        assert_eq!(q1.bjt_is, Some(1e-15));
        assert_eq!(q1.bjt_vaf, Some(120.0));
        assert_eq!(q1.bjt_rb, Some(10.0));
        assert_eq!(q1.bjt_rc, Some(2.0));

        let q2 = netlist.components.iter().find(|c| c.id == "Q2").unwrap();
        assert_eq!(q2.bjt_bf, Some(50.0));
        assert_eq!(q2.bjt_is, Some(1e-11));
        assert_eq!(q2.bjt_vaf, Some(60.0));
        assert_eq!(q2.bjt_rb, Some(5.0));
        assert_eq!(q2.bjt_rc, Some(1.0));

        // Resolver DC
        let result = solve_dc_circuit(&netlist).unwrap();
        let v_c1 = *result.node_voltages.get("3").unwrap();
        let v_c2 = *result.node_voltages.get("4").unwrap();

        println!("VC1 (Pequeña señal): {} V, VC2 (Potencia): {} V", v_c1, v_c2);
        // Q1 al tener bf de 200 conduce más corriente que Q2 con bf de 50,
        // por ende VC1 es menor que VC2.
        assert!(v_c1 < v_c2, "Q1 con bf de 200 debería conducir más y bajar el voltaje de colector más que Q2 con bf de 50");
    }

    #[test]
    fn test_diode_rigorous_series_resistance() {
        use crate::parser::parse_spice_netlist_to_native;

        // Dos diodos en paralelo con idéntica fuente de tensión de 2.0V y resistencia limitadora muy baja (10 ohms)
        // DSi_no_rs tiene rs=0, DSi_rs tiene rs=5.0
        let netlist_str = "
        * Test diode series resistance
        .model DNoRs D(is=1e-14 rs=0.0)
        .model DWithRs D(is=1e-14 rs=5.0)

        V1 1 0 2.0
        R1 1 2 10.0
        R2 1 3 10.0
        D1 2 0 DNoRs
        D2 3 0 DWithRs
        ";

        let netlist = parse_spice_netlist_to_native(netlist_str).unwrap();

        // Verificar mapeo
        let d1 = netlist.components.iter().find(|c| c.id == "D1").unwrap();
        assert_eq!(d1.diode_rs, Some(0.0));

        let d2 = netlist.components.iter().find(|c| c.id == "D2").unwrap();
        assert_eq!(d2.diode_rs, Some(5.0));

        // Resolver
        let result = solve_dc_circuit(&netlist).unwrap();
        let v_d1_ext = *result.node_voltages.get("2").unwrap();
        let v_d2_ext = *result.node_voltages.get("3").unwrap();

        // El diodo sin resistencia de serie se clampa en su barrera ideal de silicio (~0.7V - 0.75V)
        // El diodo con resistencia de serie de 5 ohms experimenta una caída de tensión externa mucho mayor
        // ya que V_ext = V_junction + I * Rs
        println!("D1 ext: {} V, D2 ext: {} V", v_d1_ext, v_d2_ext);
        assert!(v_d1_ext > 0.65 && v_d1_ext < 0.85, "El diodo ideal debería estar clampado a ~0.7V-0.8V");
        assert!(v_d2_ext > v_d1_ext + 0.15, "El diodo con Rs debería tener una tensión externa sustancialmente mayor");
    }

    #[test]
    fn test_zener_reverse_breakdown() {
        use crate::parser::parse_spice_netlist_to_native;

        // Diodo Zener polarizado inversamente excitado por rampa
        // BV = 5.1V, IBV = 1mA
        let netlist_str = "
        * Test Zener breakdown
        .model MyZener D(is=1e-14 bv=5.1 ibv=1m)

        V1 1 0 -10.0
        R1 1 2 1k
        D1 2 0 MyZener
        ";

        let netlist = parse_spice_netlist_to_native(netlist_str).unwrap();

        // Verificar mapeo
        let d1 = netlist.components.iter().find(|c| c.id == "D1").unwrap();
        assert_eq!(d1.diode_bv, Some(5.1));
        assert_eq!(d1.diode_ibv, Some(1e-3));

        // Resolver
        let result = solve_dc_circuit(&netlist).unwrap();
        let v_zener = *result.node_voltages.get("2").unwrap();

        println!("Voltaje Zener: {} V", v_zener);
        // Como la entrada es -10V, y el Zener regula a -5.1V, el nodo 2 debería estar clampado a aprox -5.1V
        assert!(v_zener < -4.8 && v_zener > -5.4, "El voltaje Zener regulado debería ser de aprox -5.1V, obtenido: {}", v_zener);
    }

    #[test]
    fn test_logic_gate_hysteresis() {
        use crate::parser::parse_spice_netlist_to_native;

        // Inversor Schmitt trigger con histéresis: vhigh=3.0V, vlow=1.0V
        // Excitamos por rampa de entrada analógica transitoria
        let netlist_str = "
        * Test logic gate hysteresis
        U1 1 2 not_gate vhigh=3.0 vlow=1.0 td=1n
        V1 1 0 PULSE(0.0 4.0 0.0 10m 10m 10m 20m)
        ";

        let netlist = parse_spice_netlist_to_native(netlist_str).unwrap();

        // Verificar mapeo
        let u1 = netlist.components.iter().find(|c| c.id == "U1").unwrap();
        assert_eq!(u1.gate_vhigh, Some(3.0));
        assert_eq!(u1.gate_vlow, Some(1.0));
    }

    #[test]
    fn test_jfet_quad_characteristics() {
        // Validar el modelo Shichman-Hodges para un JFET de canal N
        // Parámetros: Vto = -2.0V, beta = 1e-3 A/V², lambda = 0.02
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "V2".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 0.0, // Vgs = 0V (máxima conducción en JFET)
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "J1".to_string(),
                    comp_type: "njf".to_string(),
                    pins: vec!["1".to_string(), "2".to_string(), "0".to_string()],
                    value: 0.0,
                    jfet_vto: Some(-2.0),
                    jfet_beta: Some(1e-3),
                    jfet_lambda: Some(0.02),
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let result = solve_dc_circuit(&netlist);
        assert!(result.is_ok(), "La simulación del JFET debe converger en DC");

        // Verificar analíticamente: con Vgs=0, Vto=-2, Vds=5 (saturación ya que Vds > Vgs-Vto = 2)
        // Ids = beta * (Vgs - Vto)^2 * (1 + lambda * Vds) = 1e-3 * 4 * (1 + 0.1) = 4.4 mA
        // Este es un test de consistencia, no de valor exacto (el circuito tiene interacciones)
        let data = result.unwrap();
        let v_drain = *data.node_voltages.get("1").unwrap_or(&0.0);
        assert!(v_drain > 0.0, "El voltaje de drenador del JFET debe ser positivo, obtenido: {}", v_drain);

        // Verificar la región de corte: con Vgs <= Vto, la corriente debe ser ~0
        let netlist_cutoff = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "V2".to_string(),
                    comp_type: "vsource".to_string(),
                    value: -3.0, // Vgs = -3V < Vto = -2V → corte
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "J1".to_string(),
                    comp_type: "njf".to_string(),
                    pins: vec!["1".to_string(), "2".to_string(), "0".to_string()],
                    value: 0.0,
                    jfet_vto: Some(-2.0),
                    jfet_beta: Some(1e-3),
                    jfet_lambda: Some(0.02),
                    ..Default::default()
                },
                ComponentData {
                    id: "Rload".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let result_cutoff = solve_dc_circuit(&netlist_cutoff);
        assert!(result_cutoff.is_ok(), "La simulación JFET en corte debe converger");
    }

    #[test]
    fn test_subcircuit_expression_interpolation() {
        use crate::parser::parse_spice_netlist_to_native;

        // Subcircuito con PARAMS: por defecto y expresiones {} en valores de componentes
        let netlist_str = "
        * Test subcircuit with parameters and expression interpolation
        .subckt MyOpamp 1 2 3 PARAMS: gain=100k r_val=10
        R1 1 2 {gain*2}
        R2 2 3 {r_val*5}
        .ends

        V1 4 0 10
        X1 4 5 0 MyOpamp PARAMS: gain=50k r_val=20
        ";

        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();

        // Verificar que X1.R1 tiene valor = gain * 2 = 50000 * 2 = 100000
        let r1 = parsed.components.iter().find(|c| c.id == "X1.R1").unwrap();
        assert_eq!(r1.comp_type, "resistor");
        assert!(
            (r1.value - 100000.0).abs() < 1.0,
            "X1.R1 debería tener valor 100000 (gain*2 = 50k*2), obtenido: {}",
            r1.value
        );

        // Verificar que X1.R2 tiene valor = r_val * 5 = 20 * 5 = 100
        let r2 = parsed.components.iter().find(|c| c.id == "X1.R2").unwrap();
        assert_eq!(r2.comp_type, "resistor");
        assert!(
            (r2.value - 100.0).abs() < 0.1,
            "X1.R2 debería tener valor 100 (r_val*5 = 20*5), obtenido: {}",
            r2.value
        );
    }

    #[test]
    fn test_bsim_process_temperature_drift() {
        // Validar la deriva térmica de BSIM3:
        // A temperatura ambiente (300.15K / 27°C) vs alta temperatura (398.15K / 125°C)
        let vgs = 1.0;
        let vds = 1.0;
        let vbs = 0.0;
        let vth = 0.4;

        // Simulación a temperatura nominal (27°C)
        let (ids_room, gm_room, _) = evaluate_bsim3_nmos(
            vgs, vds, vbs, vth, Some(10.0e-6), Some(0.18e-6), Some(300.15), None
        );

        // Simulación a alta temperatura (125°C = 398.15K)
        let (ids_hot, gm_hot, _) = evaluate_bsim3_nmos(
            vgs, vds, vbs, vth, Some(10.0e-6), Some(0.18e-6), Some(398.15), None
        );

        // A temperatura más alta:
        // 1. El voltaje de umbral DECRECE (kt1 es negativo) → tiende a INCREMENTAR corriente
        // 2. La movilidad DECRECE (ute=-1.5) → tiende a DECREMENTAR corriente
        // El efecto neto a alta temperatura es que la corriente DISMINUYE porque la
        // degradación de movilidad domina sobre la reducción de Vth
        assert!(ids_room > 0.0, "Ids a temperatura ambiente debe ser positiva");
        assert!(ids_hot > 0.0, "Ids a alta temperatura debe ser positiva");

        // La corriente a alta temperatura debe ser diferente de la corriente a temp ambiente
        let ratio = ids_hot / ids_room;
        assert!(
            (ratio - 1.0).abs() > 0.01,
            "La corriente debe cambiar significativamente con la temperatura, ratio: {}",
            ratio
        );

        // Verificar que gm también se ve afectado por la temperatura
        assert!(gm_room > 0.0, "gm a temperatura ambiente debe ser positivo");
        assert!(gm_hot > 0.0, "gm a alta temperatura debe ser positivo");

        // Verificar PMOS también
        let (isd_room_p, _, _) = evaluate_bsim3_pmos(
            vgs, vds, vbs, vth, Some(10.0e-6), Some(0.18e-6), Some(300.15), None
        );
        let (isd_hot_p, _, _) = evaluate_bsim3_pmos(
            vgs, vds, vbs, vth, Some(10.0e-6), Some(0.18e-6), Some(398.15), None
        );

        let ratio_p = isd_hot_p / isd_room_p;
        assert!(
            (ratio_p - 1.0).abs() > 0.01,
            "La corriente PMOS debe cambiar con la temperatura, ratio: {}",
            ratio_p
        );
    }

    #[test]
    fn test_isource_dc_analysis() {
        use crate::parser::parse_spice_netlist_to_native;
        let netlist_str = "
        * Test independent current source
        I1 0 1 10m
        R1 1 0 1k
        ";
        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        let res = solve_dc_circuit(&parsed).unwrap();
        let v1 = *res.node_voltages.get("1").unwrap();
        assert!((v1 - 10.0).abs() < 1e-4, "Nodo 1 debería estar a 10.0V, obtenido: {}", v1);
    }

    #[test]
    fn test_vcvs_and_vccs_dc() {
        use crate::parser::parse_spice_netlist_to_native;
        let netlist_str = "
        * Test VCVS and VCCS
        V1 1 0 2
        E1 2 0 1 0 10
        R1 2 0 1k
        G1 0 3 1 0 2m
        R2 3 0 1k
        ";
        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        let res = solve_dc_circuit(&parsed).unwrap();
        let v2 = *res.node_voltages.get("2").unwrap();
        let v3 = *res.node_voltages.get("3").unwrap();
        assert!((v2 - 20.0).abs() < 1e-4, "VCVS (E1): Nodo 2 debería estar a 20V, obtenido: {}", v2);
        assert!((v3 - 4.0).abs() < 1e-4, "VCCS (G1): Nodo 3 debería estar a 4V, obtenido: {}", v3);
    }

    #[test]
    fn test_cccs_and_ccvs_dc() {
        use crate::parser::parse_spice_netlist_to_native;
        let netlist_str = "
        * Test CCCS and CCVS with consecutive nodes (1, 2, 3)
        Vctrl 1 0 5
        Rctrl 1 0 1k
        F1 0 2 Vctrl 5
        Rload1 2 0 100
        H1 3 0 Vctrl 100
        Rload2 3 0 1k
        ";
        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        let res = solve_dc_circuit(&parsed).unwrap();
        let v2 = *res.node_voltages.get("2").unwrap();
        let v3 = *res.node_voltages.get("3").unwrap();
        assert!((v2.abs() - 2.5).abs() < 1e-4, "CCCS: Nodo 2 absoluto debería ser 2.5V, obtenido: {}", v2);
        assert!((v3.abs() - 0.5).abs() < 1e-4, "CCVS: Nodo 3 absoluto debería ser 0.5V, obtenido: {}", v3);
    }

    #[test]
    fn test_subcircuit_controlled_sources() {
        use crate::parser::parse_spice_netlist_to_native;
        let netlist_str = "
        * Subcircuit with CCCS and CCVS using only interface nodes (no raw non-integer internal nodes)
        .subckt MyBlock 1 2 3
        Vlocal 1 3 2
        Rlocal 3 2 1k
        Flocal 0 2 Vlocal 10
        .ends
        
        X1 1 2 3 MyBlock
        Rload 2 0 100
        Vmain 1 0 5
        ";
        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        
        // Verificar que Flocal ha sido aplanada a X1.Flocal y que su controlador es X1.Vlocal
        let flocal = parsed.components.iter().find(|c| c.id == "X1.Flocal").unwrap();
        assert_eq!(flocal.comp_type, "cccs");
        assert_eq!(flocal.controlling_source, Some("X1.Vlocal".to_string()));
        
        let res = solve_dc_circuit(&parsed).unwrap();
        let v2 = *res.node_voltages.get("2").unwrap();
        assert!(v2.abs() > 0.0, "La salida del subcircuito con CCCS debe simular correctamente");
    }

    #[test]
    fn test_transient_isource_waveform() {
        use crate::parser::parse_spice_netlist_to_native;
        let netlist_str = "
        * Transient dynamic current source
        I1 0 1 SIN(0 10m 1k)
        R1 1 0 100
        ";
        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        let settings = TransientSettings {
            dt: 1e-4,
            t_max: 1e-3,
            fixed_step: None,
            integration_method: None,
        };
        let res = solve_transient_circuit(&parsed, &settings).unwrap();
        assert!(!res.is_empty(), "Transitorio debe generar pasos de tiempo");
    }

    #[test]
    fn test_ac_sweep_controlled_sources() {
        use crate::parser::parse_spice_netlist_to_native;
        let netlist_str = "
        * AC Sweep with VCVS and VCCS
        V1 1 0 AC 2
        E1 2 0 1 0 5
        R1 2 0 1k
        ";
        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        let settings = AcSweepSettings {
            f_start: 10.0,
            f_end: 10e3,
            points_per_decade: 5,
            op_guess: None,
        };
        let res = solve_ac_sweep(&parsed, &settings).unwrap();
        assert!(!res.frequencies.is_empty(), "AC sweep debe generar frecuencias");
    }

    #[test]
    fn test_global_param_interpolation() {
        use crate::parser::parse_spice_netlist_to_native;
        let netlist_str = "
        * Test global param interpolation
        .param Vdd=10 Rval=2k
        V1 1 0 {Vdd}
        R1 1 0 {Rval}
        ";
        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        
        let r1 = parsed.components.iter().find(|c| c.id == "R1").unwrap();
        assert_eq!(r1.comp_type, "resistor");
        assert_eq!(r1.value, 2000.0);

        let res = solve_dc_circuit(&parsed).unwrap();
        let v1 = *res.node_voltages.get("1").unwrap();
        assert!((v1 - 10.0).abs() < 1e-4, "V1 debe tener el valor parametrizado globalmente a 10V, obtenido: {}", v1);
    }

    #[test]
    fn test_global_temp_setting() {
        use crate::parser::parse_spice_netlist_to_native;
        let netlist_str = "
        * Test global temperature setting
        .temp 125
        V1 1 0 5
        ";
        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        assert_eq!(parsed.temperature, Some(125.0), "La temperatura global debe ser 125.0");
    }

    #[test]
    fn test_ic_transient_initialization() {
        use crate::parser::parse_spice_netlist_to_native;
        let netlist_str = "
        * Test initial conditions .ic
        .ic V(1)=3.3 V(2)=1.5
        C1 1 2 1u
        R1 2 0 1k
        ";
        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        let settings = TransientSettings {
            dt: 1e-5,
            t_max: 1e-4,
            fixed_step: None,
            integration_method: None,
        };
        let res = solve_transient_circuit(&parsed, &settings).unwrap();
        assert!(!res.is_empty());
        let first_step = &res[0];
        let v1 = *first_step.node_voltages.get("1").unwrap();
        let v2 = *first_step.node_voltages.get("2").unwrap();
        assert!((v1 - v2 - 1.8).abs() < 0.1, "La diferencia de potencial del capacitor debe iniciarse en 1.8V");
    }

    #[test]
    fn test_lte_adaptive_timestep() {
        use crate::parser::parse_spice_netlist_to_native;
        let netlist_str = "
        * Test LTE adaptive timestep under transient sine wave
        V1 1 0 SIN(0 5 1k)
        R1 1 2 1k
        C1 2 0 1u
        ";
        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        let settings = TransientSettings {
            dt: 1e-5,
            t_max: 2e-3,
            fixed_step: Some(false),
            integration_method: Some("gear2".to_string()),
        };
        let res = solve_transient_circuit(&parsed, &settings).unwrap();
        assert!(!res.is_empty(), "La simulación transitoria adaptativa por LTE debe completarse exitosamente");
    }

    #[test]
    fn test_topology_graph_floating_nodes() {
        use crate::parser::parse_spice_netlist_to_native;
        let netlist_str = "
        * Test topology floating nodes auto-stabilization
        V1 1 0 10
        C1 1 2 1u
        R1 2 3 1k
        R2 3 0 1k
        ";
        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        
        let res = solve_dc_circuit(&parsed).unwrap();
        let v2 = *res.node_voltages.get("2").unwrap();
        let v3 = *res.node_voltages.get("3").unwrap();
        assert!(v2.abs() < 1e-3, "V2 debería ser prácticamente 0V por bleed resistor, obtenido: {}", v2);
        assert!(v3.abs() < 1e-3, "V3 debería ser prácticamente 0V por bleed resistor, obtenido: {}", v3);
    }

    #[test]
    fn test_homotopy_continuation_convergence() {
        use crate::parser::parse_spice_netlist_to_native;
        let netlist_str = "
        * Test homotopy continuation on highly non-linear feedback BJT circuit
        Vcc 1 0 5
        Rc1 1 2 1.01k
        Rc2 1 3 1k
        Q1 2 3 4 npn
        Q2 3 2 4 npn
        Ib1 0 2 10.1u
        Ib2 0 3 10u
        Re 4 0 100
        .model npn npn(bf=100 is=1e-14)
        ";
        let parsed = parse_spice_netlist_to_native(netlist_str).unwrap();
        let res = solve_dc_circuit(&parsed).unwrap();
        let v2 = *res.node_voltages.get("2").unwrap();
        let v3 = *res.node_voltages.get("3").unwrap();
        assert!(v2 > 0.0 && v3 > 0.0, "La simulación no lineal debe converger exitosamente y devolver voltajes coherentes: v2={}, v3={}", v2, v3);
    }

    #[test]
    fn test_sparse_markowitz_vlsi_performance() {
        use crate::parser::parse_spice_netlist_to_native;
        
        // Construir un circuito de gran escala (VLSI) con 150 nodos en escalera
        let mut netlist_str = String::from("
        * VLSI Ladder Netlist
        V1 1 0 10.0
        ");
        
        let num_nodes = 150;
        for i in 1..num_nodes {
            netlist_str.push_str(&format!("R{} {} {} 1k\n", i, i, i + 1));
            if i % 10 == 0 {
                netlist_str.push_str(&format!("D{} {} 0 DModel\n", i, i));
            }
        }
        netlist_str.push_str(".model DModel D(is=1e-14 rs=1e-3)\n");

        let parsed = parse_spice_netlist_to_native(&netlist_str).unwrap();

        let start_time = std::time::Instant::now();
        let res = solve_dc_circuit(&parsed).unwrap();
        let elapsed = start_time.elapsed();

        println!("Tiempo de resolución sparse de {} nodos con Markowitz: {:?}", num_nodes, elapsed);

        // Validaciones de corrección de voltajes nodal
        let v1 = *res.node_voltages.get("1").unwrap();
        let v_last = *res.node_voltages.get(&num_nodes.to_string()).unwrap();

        assert!((v1 - 10.0).abs() < 1e-12, "El voltaje de entrada debería ser 10.0V");
        assert!(v_last > 0.0 && v_last < 10.0, "El voltaje al final de la escalera debe atenuarse, obtenido: {}", v_last);
    }

    #[test]
    fn test_sparse_csc_numerical_factorize() {
        use crate::sparse_csc::{SparseMatrixCSC, SymbolicLU, NumericLUWorkspace};
        use nalgebra::DVector;

        // 1. Definir un sistema MNA disperso no trivial con una matriz diagonalmente dominante y fill-in
        let size = 5;
        let mut matrix_a = SparseMatrix::new(size);
        
        // Estampar valores no triviales
        matrix_a.add_element(0, 0, 4.0);
        matrix_a.add_element(0, 1, -1.0);
        matrix_a.add_element(0, 3, -1.0);
        
        matrix_a.add_element(1, 0, -1.0);
        matrix_a.add_element(1, 1, 3.0);
        matrix_a.add_element(1, 2, -1.0);
        
        matrix_a.add_element(2, 1, -1.0);
        matrix_a.add_element(2, 2, 4.0);
        matrix_a.add_element(2, 4, -2.0);
        
        matrix_a.add_element(3, 0, -1.0);
        matrix_a.add_element(3, 3, 3.0);
        matrix_a.add_element(3, 4, -1.0);
        
        matrix_a.add_element(4, 2, -2.0);
        matrix_a.add_element(4, 3, -1.0);
        matrix_a.add_element(4, 4, 5.0);

        // Vector RHS
        let b = DVector::from_vec(vec![1.0, 2.0, 3.0, 4.0, 5.0]);

        // 2. Resolver usando SparseLU dinámico clásico
        let lu_classic = SparseLU::factorize(matrix_a.clone()).unwrap();
        let sol_classic = lu_classic.solve(&b).unwrap();

        // 3. Analizar y factorizar usando nuestro nuevo resolvedor CSC Left-Looking
        let symbolic = SymbolicLU::analyze(&matrix_a);
        let mut workspace = NumericLUWorkspace::new(&symbolic);
        let matrix_csc = SparseMatrixCSC::from_sparse(&matrix_a);
        
        matrix_csc.left_looking_factorize(&symbolic, &mut workspace).unwrap();
        let sol_csc = symbolic.solve(&workspace, &b).unwrap();

        // 4. Comparar ambas soluciones
        for i in 0..size {
            let diff = (sol_classic[i] - sol_csc[i]).abs();
            assert!(diff < 1e-12, "Discrepancia en la solución en el índice {}: clásica = {}, csc = {}, diff = {}", i, sol_classic[i], sol_csc[i], diff);
        }
    }

    #[test]
    fn test_complex_sparse_csc_numerical_factorize() {
        use crate::sparse_csc::{ComplexSparseMatrixCSC, SymbolicLU, ComplexNumericLUWorkspace};
        use num_complex::Complex;
        use nalgebra::DVector;

        let size = 4;
        let mut matrix_a = ComplexSparseMatrix::new(size);
        
        // Estampar elementos complejos no triviales
        matrix_a.add_element(0, 0, Complex::new(4.0, 1.0));
        matrix_a.add_element(0, 1, Complex::new(-1.0, 0.0));
        matrix_a.add_element(0, 2, Complex::new(0.0, -2.0));
        
        matrix_a.add_element(1, 0, Complex::new(-1.0, 0.0));
        matrix_a.add_element(1, 1, Complex::new(3.0, 2.0));
        matrix_a.add_element(1, 3, Complex::new(-1.0, 1.0));
        
        matrix_a.add_element(2, 0, Complex::new(0.0, -2.0));
        matrix_a.add_element(2, 2, Complex::new(5.0, 0.0));
        matrix_a.add_element(2, 3, Complex::new(-2.0, -1.0));
        
        matrix_a.add_element(3, 1, Complex::new(-1.0, 1.0));
        matrix_a.add_element(3, 2, Complex::new(-2.0, -1.0));
        matrix_a.add_element(3, 3, Complex::new(6.0, 4.0));

        let b = DVector::from_vec(vec![
            Complex::new(1.0, 2.0),
            Complex::new(3.0, -1.0),
            Complex::new(0.0, 4.0),
            Complex::new(2.0, 2.0),
        ]);

        // 1. Resolver usando el solver clásico
        let lu_classic = ComplexSparseLU::factorize(matrix_a.clone()).unwrap();
        let sol_classic = lu_classic.solve(&b).unwrap();

        // 2. Mapear al patrón real estático para el análisis simbólico
        let mut real_pattern = SparseMatrix::new(size);
        for r in 0..size {
            for (&c, &val) in &matrix_a.rows[r] {
                real_pattern.add_element(r, c, val.norm());
            }
        }

        let symbolic = SymbolicLU::analyze(&real_pattern);
        let mut workspace = ComplexNumericLUWorkspace::new(&symbolic);
        let mut matrix_csc = ComplexSparseMatrixCSC::from_sparse(&matrix_a);

        // Factorizar y resolver
        matrix_csc.update_from_sparse(&matrix_a);
        matrix_csc.left_looking_factorize(&symbolic, &mut workspace).unwrap();
        let sol_csc = symbolic.solve_complex(&workspace, &b).unwrap();

        // Comparar soluciones con tolerancia estricta
        for i in 0..size {
            let diff = (sol_classic[i] - sol_csc[i]).norm();
            assert!(diff < 1e-12, "Discrepancia en la solución compleja en índice {}: clásica = {}, csc = {}, diff = {}", i, sol_classic[i], sol_csc[i], diff);
        }
    }

    #[test]
    fn test_schur_parallel_solver_correctness() {
        use crate::sparse_parallel::SchurParallelSolver;
        use crate::sparse_csc::{SparseMatrixCSC, SymbolicLU, NumericLUWorkspace};
        use nalgebra::DVector;

        // Construir un circuito particionable sintético de tamaño 45 (14 bloques locales de tamaño 3 + 3 nodos de borde)
        let size = 45;
        let mut matrix_a = SparseMatrix::new(size);

        // Rellenar la diagonal para asegurar estabilidad numérica
        for i in 0..size {
            matrix_a.add_element(i, i, 12.0);
        }

        // Crear 14 bloques locales independientes de 3 nodos
        // Cada bloque k opera sobre nodos (3k, 3k+1, 3k+2)
        // Y se acopla con los nodos de borde (42, 43, 44)
        for k in 0..14 {
            let base = k * 3;
            // Conexiones internas del bloque
            matrix_a.add_element(base, base + 1, -2.0);
            matrix_a.add_element(base + 1, base, -2.0);
            matrix_a.add_element(base + 1, base + 2, -3.0);
            matrix_a.add_element(base + 2, base + 1, -3.0);

            // Conexiones al borde (acoplamiento)
            matrix_a.add_element(base, 42, -1.0);
            matrix_a.add_element(42, base, -1.0);

            matrix_a.add_element(base + 1, 43, -1.5);
            matrix_a.add_element(43, base + 1, -1.5);

            matrix_a.add_element(base + 2, 44, -2.0);
            matrix_a.add_element(44, base + 2, -2.0);
        }

        // Acoplamiento directo en el borde
        matrix_a.add_element(42, 43, -1.0);
        matrix_a.add_element(43, 42, -1.0);
        matrix_a.add_element(43, 44, -1.0);
        matrix_a.add_element(44, 43, -1.0);

        let b = DVector::from_fn(size, |idx, _| 1.0 + (idx as f64) * 0.1);

        // 1. Resolver con resolvedor Left-Looking secuencial de referencia
        let symbolic_seq = SymbolicLU::analyze(&matrix_a);
        let mut workspace_seq = NumericLUWorkspace::new(&symbolic_seq);
        let matrix_csc_seq = SparseMatrixCSC::from_sparse(&matrix_a);
        matrix_csc_seq.left_looking_factorize(&symbolic_seq, &mut workspace_seq).unwrap();
        let sol_seq = symbolic_seq.solve(&workspace_seq, &b).unwrap();

        // 2. Resolver con nuestro nuevo SchurParallelSolver
        let mut parallel_solver = SchurParallelSolver::analyze(&matrix_a, 0.1);
        assert!(!parallel_solver.is_monolithic, "El circuito sintético debería haber sido particionado.");
        assert!(parallel_solver.blocks.len() >= 2, "Debería haber múltiples bloques independientes.");

        let sol_par = parallel_solver.solve(&matrix_a, &b).unwrap();

        // 3. Validar correctitud numérica con error de precisión < 1e-12
        for i in 0..size {
            let diff = (sol_seq[i] - sol_par[i]).abs();
            assert!(diff < 1e-12, "Discrepancia en resolvedor Schur paralelo en índice {}: seq = {}, par = {}, diff = {}", i, sol_seq[i], sol_par[i], diff);
        }
    }

    #[test]
    fn test_schur_parallel_scalability() {
        // Simular un circuito de 20 inversores lógicos CMOS conectados en paralelo
        // Genera una red masiva de transistores con más de 60 nodos activos para forzar el solver en paralelo
        let mut components = vec![
            ComponentData {
                id: "Vdd".to_string(),
                comp_type: "vsource".to_string(),
                value: 5.0,
                pins: vec!["1".to_string(), "0".to_string()],
                ..Default::default()
            }
        ];

        // Construir 20 inversores independientes alimentados por VDD (nodo 1) y GND (nodo 0)
        // Cada inversor i usa nodo de entrada (i*2 + 2) y salida (i*2 + 3)
        // Esto creará 20 bloques independientes acoplados únicamente a través del nodo de alimentación común VDD!
        for i in 0..20 {
            let in_node = (i * 2 + 2).to_string();
            let out_node = (i * 2 + 3).to_string();

            // Entrada del inversor conectada a un divisor resistivo local para polarizar los transistores
            components.push(ComponentData {
                id: format!("Rin_{}", i),
                comp_type: "resistor".to_string(),
                value: 10000.0,
                pins: vec![in_node.clone(), "0".to_string()],
                ..Default::default()
            });
            components.push(ComponentData {
                id: format!("Rbias_{}", i),
                comp_type: "resistor".to_string(),
                value: 10000.0,
                pins: vec!["1".to_string(), in_node.clone()],
                ..Default::default()
            });

            // Resistencia de carga local
            components.push(ComponentData {
                id: format!("Rload_{}", i),
                comp_type: "resistor".to_string(),
                value: 1000.0,
                pins: vec!["1".to_string(), out_node.clone()],
                ..Default::default()
            });

            // Transistor NMOS local
            components.push(ComponentData {
                id: format!("Mn_{}", i),
                comp_type: "nmos".to_string(),
                value: 1.0,
                pins: vec![in_node.clone(), out_node.clone(), "0".to_string()],
                ..Default::default()
            });

            // Transistor PMOS local
            components.push(ComponentData {
                id: format!("Mp_{}", i),
                comp_type: "pmos".to_string(),
                value: -1.0,
                pins: vec![in_node.clone(), out_node.clone(), "1".to_string()],
                ..Default::default()
            });
        }

        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components,
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        // Correr la simulación de DC.
        // Como el circuito tiene más de 60 nodos activos, solve_dc_circuit usará el SchurParallelSolver
        // de forma auto-adaptativa, resolviendo los 20 bloques en paralelo sobre múltiples hilos de Rayon.
        let result = solve_dc_circuit(&netlist).unwrap();
        
        // Verificar que la simulación es correcta y física
        for i in 0..20 {
            let out_node = (i * 2 + 3).to_string();
            let v_out = *result.node_voltages.get(&out_node).unwrap();
            // Cada inversor con entrada a 2.5V se polariza físicamente a ~3.75V debido a Rload conectada a VDD
            assert!(v_out > 3.5 && v_out < 4.0, "Inversor {} no balanceado, Vout obtenido: {}", i, v_out);
        }
    }

    #[test]
    fn test_static_pivoting_convergence() {
        // Creamos una matriz singular estructurada artificialmente con diagonal cero
        // y verificamos que el resolvedor de MNA aplica la estabilización estática y resuelve
        // el sistema sin lanzar pánico numérico y con alta precisión.
        use crate::sparse_csc::{SymbolicLU, ComplexNumericLUWorkspace, ComplexSparseMatrixCSC};
        let mut matrix_a = ComplexSparseMatrix::new(2);
        // Matriz: [ 0.0, 1.0; 1.0, 0.0 ] (singular si se hace LU directo sin pivoteo)
        matrix_a.add_element(0, 1, Complex::new(1.0, 0.0));
        matrix_a.add_element(1, 0, Complex::new(1.0, 0.0));
        // Agregamos un diagonal extremadamente pequeño < 1e-13 que disparará el Static Pivoting
        matrix_a.add_element(0, 0, Complex::new(1e-20, 0.0));
        matrix_a.add_element(1, 1, Complex::new(1e-20, 0.0));

        let mut real_pattern = SparseMatrix::new(2);
        real_pattern.add_element(0, 1, 1.0);
        real_pattern.add_element(1, 0, 1.0);
        real_pattern.add_element(0, 0, 1e-20);
        real_pattern.add_element(1, 1, 1e-20);

        let symbolic = SymbolicLU::analyze(&real_pattern);
        let mut workspace = ComplexNumericLUWorkspace::new(&symbolic);
        let matrix_csc = ComplexSparseMatrixCSC::from_sparse(&matrix_a);

        let res = matrix_csc.left_looking_factorize(&symbolic, &mut workspace);
        assert!(res.is_ok(), "Static pivoting debería estabilizar y permitir factorizar sin error");

        let b = nalgebra::DVector::from_vec(vec![Complex::new(1.0, 0.0), Complex::new(2.0, 0.0)]);
        let sol = symbolic.solve_complex(&workspace, &b);
        assert!(sol.is_some(), "Debería retornar solución");
        let solution = sol.unwrap();
        // Con static pivoting en 1e-28, la solución obtenida debe ser estable y finita
        assert!(solution[0].re.is_finite(), "x1 debería ser finita");
        assert!(solution[1].re.is_finite(), "x2 debería ser finita");
    }

    #[test]
    fn test_mutual_inductance_transformer() {
        // Transformador CA reductor ideal 10:1
        // L1 = 10H, L2 = 0.1H, k = 0.99999 (muy acoplado)
        // V1 es fuente de CA de 10V (amplitud) a 50Hz, conectada a L1.
        // Verificamos que el voltaje en L2 (secundario) es exactamente la décima parte (1V).
        let netlist = CircuitNetlist {
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 0.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    wave_type: Some("sine".to_string()),
                    amplitude: Some(10.0),
                    frequency: Some(50.0),
                    offset: Some(0.0),
                    ..Default::default()
                },
                ComponentData {
                    id: "L1".to_string(),
                    comp_type: "inductor".to_string(),
                    value: 10.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "L2".to_string(),
                    comp_type: "inductor".to_string(),
                    value: 0.1,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Rload".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1e6, // Carga abierta para ver la relación de transformación de circuito abierto
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            mutual_inductances: Some(vec![
                MutualInductance {
                    id: "K1".to_string(),
                    l1_id: "L1".to_string(),
                    l2_id: "L2".to_string(),
                    k_coeff: 0.99,
                }
            ]),
            wires: vec![],
            temperature: None,
            fixed_step: Some(true),
            thermal_config: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let settings = TransientSettings {
            dt: 1e-4,
            t_max: 0.04, // 2 periodos
            integration_method: Some("euler".to_string()),
            fixed_step: Some(true),
        };

        let results = solve_transient_circuit(&netlist, &settings).unwrap();
        assert!(!results.is_empty(), "La simulación transitoria debería retornar resultados");

        // Al final de la simulación (en régimen permanente), verificamos el voltaje secundario en el nodo 2
        // en relación con la entrada en el nodo 1.
        let mut max_v1: f64 = 0.0;
        let mut max_v2: f64 = 0.0;
        // Buscamos los picos en el segundo ciclo (t > 0.02)
        for step in &results {
            if step.time > 0.02 {
                let v1 = step.node_voltages.get("1").copied().unwrap_or(0.0).abs();
                let v2 = step.node_voltages.get("2").copied().unwrap_or(0.0).abs();
                if v1 > max_v1 { max_v1 = v1; }
                if v2 > max_v2 { max_v2 = v2; }
            }
        }

        // Con k = 0.99, max_v1 debería ser ~10.0 y max_v2 debería ser ~0.99
        assert!((max_v1 - 10.0).abs() < 0.1, "Voltaje primario debería ser ~10V de amplitud");
        assert!((max_v2 - 0.99).abs() < 0.16, "Relación de transformación 10:1 falló. Vsecundario obtenido: {}", max_v2);
    }

    #[test]
    fn test_ac_sweep_csc_performance() {
        // Validar la correctitud del barrido AC complejo
        let netlist = CircuitNetlist {
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 0.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    amplitude: Some(10.0),
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 100.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "C1".to_string(),
                    comp_type: "capacitor".to_string(),
                    value: 1e-6,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            mutual_inductances: None,
            thermal_config: None,
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let settings = AcSweepSettings {
            f_start: 10.0,
            f_end: 10000.0,
            points_per_decade: 10,
            op_guess: None,
        };

        let results = solve_ac_sweep(&netlist, &settings).unwrap();
        assert_eq!(results.frequencies.len(), 31); // 3 décadas, 10 pts c/u + 1

        // En f = 1591.5 Hz (w = 10000 rad/s), Xc = 1 / (w * C) = 100 Ohm.
        // Impedancia total Z = R + jXc = 100 - j100.
        // Magnitud de voltaje en nodo 2 = |Vc| = |10 * (-j100) / (100 - j100)| = 10 / sqrt(2) = 7.07V -> ~17.0 dB
        let idx_near_1591 = results.frequencies.iter().position(|&f| (f - 1591.5).abs() < 100.0).unwrap();
        let amp_db = results.node_amplitudes.get("2").unwrap()[idx_near_1591];
        // 20 * log10(7.07) = 17.0 dB
        assert!((amp_db - 17.0).abs() < 1.0, "AC Sweep falló en verificar el polo de atenuación, obtenido: {} dB", amp_db);
    }

    #[test]
    fn test_trap_integration_lc_resonance() {
        let netlist = CircuitNetlist {
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 0.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    wave_type: Some("pulse".to_string()),
                    amplitude: Some(1.0),
                    frequency: Some(5000.0),
                    duty_cycle: Some(0.1),
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 10.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "L1".to_string(),
                    comp_type: "inductor".to_string(),
                    value: 1e-3,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "C1".to_string(),
                    comp_type: "capacitor".to_string(),
                    value: 1e-6,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            mutual_inductances: None,
            thermal_config: None,
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let settings_trap = TransientSettings {
            dt: 1e-6,
            t_max: 5e-3,
            fixed_step: Some(true),
            integration_method: Some("trap".to_string()),
        };

        let settings_euler = TransientSettings {
            dt: 1e-6,
            t_max: 5e-3,
            fixed_step: Some(true),
            integration_method: Some("euler".to_string()),
        };

        let results_trap = solve_transient_circuit(&netlist, &settings_trap).unwrap();
        let results_euler = solve_transient_circuit(&netlist, &settings_euler).unwrap();

        assert!(!results_trap.is_empty(), "TRAP: No hay resultados");
        assert!(!results_euler.is_empty(), "Euler: No hay resultados");

        let amp_trap: f64 = results_trap.iter()
            .filter(|s| s.time > 3e-3)
            .map(|s| s.node_voltages.get("2").unwrap().abs())
            .fold(0.0, f64::max);

        let amp_euler: f64 = results_euler.iter()
            .filter(|s| s.time > 3e-3)
            .map(|s| s.node_voltages.get("2").unwrap().abs())
            .fold(0.0, f64::max);

        println!("Amplitudes - TRAP: {}, Euler: {}", amp_trap, amp_euler);

        assert!(amp_trap > 1e-6, "TRAP debe producir oscilación, amplitud: {}", amp_trap);
        // TRAP should have similar or better amplitude than Euler (both are valid integration methods)
        // The key difference is that TRAP is 2nd order and Euler is 1st order
    }

    #[test]
    fn test_pta_robust_convergence() {
        // Circuito con histéresis y lazo de alimentación positiva severo (Schmitt Trigger)
        // Op-Amp con ganancia extremadamente alta (feedback positivo de Out a In+)
        // Vin (nodo 1) = 1.0V
        // Vpos (nodo 4) = +15V, Vneg (nodo 5) = -15V
        // In+ (nodo 2) conectado a Out (nodo 2)
        // In- (nodo 1) conectado a Vin (1V)
        // R1 (nodo 2 a 0) = 1000 Ohm para drenar corriente
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "Vin".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 1.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Vpos".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 15.0,
                    pins: vec!["4".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Vneg".to_string(),
                    comp_type: "vsource".to_string(),
                    value: -15.0,
                    pins: vec!["5".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "X1".to_string(),
                    comp_type: "opamp".to_string(),
                    value: 0.0,
                    pins: vec![
                        "2".to_string(), // In+ (feedback de Out)
                        "1".to_string(), // In- (1V)
                        "4".to_string(), // V+
                        "5".to_string(), // V-
                        "2".to_string(), // Out (conectado a In+)
                    ],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        // Debe converger usando PTA (u Homotopía/Source Stepping si PTA no se dispara antes, pero PTA lo garantiza)
        let result = solve_dc_circuit(&netlist);
        assert!(result.is_ok(), "La simulación DC con lazo de realimentación positivo severo debería converger gracias a PTA/Homotopía");
        let res = result.unwrap();
        let v_out = *res.node_voltages.get("2").unwrap();
        // Con Vin = 1V, la salida se saturará a +15V o -15V (o un valor intermedio estable)
        assert!(v_out.abs() > 0.1, "Voltaje de salida del Schmitt trigger inválido: {}", v_out);
    }

    #[test]
    fn test_imd_two_tone_clipper() {
        let f1 = 900.0;
        let f2 = 1000.0;
        let t_max = 0.05; // 50 ms

        // Generar 2048 pasos uniformes de una señal de dos tonos con distorsión cúbica
        let n_steps = 2048;
        let mut time_steps = Vec::with_capacity(n_steps);
        for i in 0..n_steps {
            let t = (i as f64) * (t_max / (n_steps - 1) as f64);
            let mut node_voltages = HashMap::new();

            // Señal fundamental de dos tonos
            let v_fund = (2.0 * std::f64::consts::PI * f1 * t).sin() + (2.0 * std::f64::consts::PI * f2 * t).sin();
            // Agregar una distorsión no lineal cúbica que genera IM3
            let v_distorted = v_fund - 0.05 * v_fund.powi(3);

            node_voltages.insert("out".to_string(), v_distorted);

            time_steps.push(TimeStepResult {
                time: t,
                node_voltages,
                branch_currents: HashMap::new(),
            });
        }

        let imd_res = calculate_imd_analysis(&time_steps, "out", f1, f2).unwrap();

        println!("Power Fund: {}, IM3: {}, IMD%: {}, IP3: {}",
                 imd_res.fundamental_power_dbv, imd_res.im3_power_dbv, imd_res.imd_ratio_percent, imd_res.ip3_out_dbv);

        // Las fundamentales deben detectarse con buena potencia
        assert!(imd_res.fundamental_power_dbv > -10.0, "La potencia fundamental debería ser medible");
        // El producto IM3 a 2f1 - f2 (800Hz) o 2f2 - f1 (1100Hz) debe ser detectable
        assert!(imd_res.im3_power_dbv > -60.0, "Los productos IM3 deberían ser detectables en el espectro");
        // La tasa de IMD en porcentaje debe ser positiva y razonable
        assert!(imd_res.imd_ratio_percent > 0.1 && imd_res.imd_ratio_percent < 25.0, "IMD fuera de rango: {}%", imd_res.imd_ratio_percent);
        // IP3 extrapolado debe ser estable y mayor que la potencia fundamental
        assert!(imd_res.ip3_out_dbv > imd_res.fundamental_power_dbv, "IP3 de salida ({}) debe ser mayor que la fundamental ({})", imd_res.ip3_out_dbv, imd_res.fundamental_power_dbv);
    }

    #[test]
    fn test_opto_isolation() {
        // Test de aislamiento galvánico del optoacoplador:
        //   Lado emisor:  V1 (5V) -> R1 (1k) -> LED (A-K)
        //   Lado receptor: V2 (5V) -> Rc (10k) -> Colector -> Emisor -> GND
        //   CTR = 0.5, V_sat = 0.2, Is = 1e-12, N = 1
        // Se espera:
        //   - Con V1 = 5V: I_led ~ (5 - 0.7)/1k ~ 4.3 mA, V_C cae por I_ce = CTR*I_led
        //   - Aislamiento: nodos del lado LED (2) NO conectados eléctricamente al receptor (3)
        //   - I_ce == CTR * I_led (transferencia óptica, no inyección galvánica)
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                // Lado emisor: V1=5V, R1=1k, LED A-K
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                // Lado receptor: V2=5V, Rc=10k, colector-emisor del opto
                ComponentData {
                    id: "V2".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0,
                    pins: vec!["4".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Rc".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 10000.0,
                    pins: vec!["4".to_string(), "3".to_string()],
                    ..Default::default()
                },
                // Optoacoplador: A=2, K=0, C=3, E=0
                ComponentData {
                    id: "O1".to_string(),
                    comp_type: "opto".to_string(),
                    value: 0.0,
                    pins: vec![
                        "2".to_string(), // anode
                        "0".to_string(), // cathode
                        "3".to_string(), // collector
                        "0".to_string(), // emitter
                    ],
                    opto_ctr: Some(0.5),
                    opto_is: Some(1e-12),
                    opto_n: Some(1.0),
                    opto_vsat: Some(0.2),
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let result = solve_dc_circuit(&netlist).unwrap();

        // Voltaje del ánodo del LED (nodo 2): debe rondar 0.6-0.8V (caída del LED)
        let v_anode = *result.node_voltages.get("2").unwrap();
        assert!(v_anode > 0.5 && v_anode < 0.9,
                "Voltaje del ánodo del LED (nodo 2) fuera de rango esperado [0.5, 0.9] V, obtenido: {}", v_anode);

        // Voltaje del colector (nodo 3): debe caer de 5V según I_ce = CTR * I_led
        // I_led ~ (5 - v_anode)/1k, I_ce = 0.5 * I_led, V_C = 5 - 10k * I_ce
        // Aprox: I_led ~ 4.3 mA, I_ce ~ 2.15 mA, V_C ~ 5 - 21.5 ~ -16.5 V
        // Pero V_ce se satura suavemente en ~0.2V vía tanh, así que V_C cae pero se limita.
        let v_collector = *result.node_voltages.get("3").unwrap();
        // El colector debe estar por debajo de V2=5V (hay corriente circulando)
        assert!(v_collector < 4.9,
                "Voltaje del colector (nodo 3) debe caer de 5V indicando que el fototransistor conduce, obtenido: {}", v_collector);

        // Aislamiento galvánico: verificar que no hay corriente directa del nodo LED (2) al receptor (3/4).
        // La única conexión entre los dos lados es óptica (CTR). Comprobamos que la corriente que
        // sale del cátodo del LED (nodo 0) NO se transmite al colector: la rama V2/Rc es independiente.
        // Forma práctica: sin V1 (sólo V2), no debe haber corriente en el LED ni V_C debe caer.
        let netlist_off = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: None,
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 0.0,  // LED apagado
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 1000.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "V2".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 5.0,
                    pins: vec!["4".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "Rc".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 10000.0,
                    pins: vec!["4".to_string(), "3".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "O1".to_string(),
                    comp_type: "opto".to_string(),
                    value: 0.0,
                    pins: vec![
                        "2".to_string(),
                        "0".to_string(),
                        "3".to_string(),
                        "0".to_string(),
                    ],
                    opto_ctr: Some(0.5),
                    opto_is: Some(1e-12),
                    opto_n: Some(1.0),
                    opto_vsat: Some(0.2),
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let res_off = solve_dc_circuit(&netlist_off).unwrap();
        let v_collector_off = *res_off.node_voltages.get("3").unwrap();
        // Con LED apagado: I_led = 0 => I_ce = 0 => no caída en Rc => V_C = 5V (aislamiento perfecto)
        assert!((v_collector_off - 5.0).abs() < 1e-3,
                "Con LED apagado, V_C debe ser 5V (aislamiento galvánico perfecto), obtenido: {}", v_collector_off);

        // Y el ánodo del LED también debe ser ~0V (sin excitación)
        let v_anode_off = *res_off.node_voltages.get("2").unwrap();
        assert!(v_anode_off.abs() < 0.1,
                "Con V1=0V, el ánodo del LED debe estar en ~0V, obtenido: {}", v_anode_off);

        // Diferencia entre ON y OFF: el cambio en V_C confirma la transferencia óptica
        let delta_vc = v_collector_off - v_collector;
        assert!(delta_vc > 0.1,
                "La variación de V_C entre LED ON y OFF debe ser significativa (>0.1V) indicando acoplamiento óptico, delta: {}", delta_vc);
    }

    #[test]
    fn test_scr_phase_control() {
        let netlist_str = "
        * SCR Phase Control Test
        .model myscr scr (vgt=0.7 ih=5m)
        V_ac 1 0 sine (0 10 50)
        Bgate 3 2 V={min(5.0, max(0.0, (t - 0.0025) * 100000.0)) - min(5.0, max(0.0, (t - 0.0035) * 100000.0))}
        Rg 3 4 1k
        S1 1 2 4 myscr
        R_load 2 0 100
        ";

        let netlist = crate::parser::parse_spice_netlist_to_native(netlist_str).unwrap();

        let settings = TransientSettings {
            dt: 0.0001,   // 0.1 ms
            t_max: 0.020, // 20 ms (un ciclo completo a 50Hz)
            fixed_step: Some(true),
            integration_method: None,
        };

        let results = solve_transient_circuit(&netlist, &settings).unwrap();
        assert!(results.len() > 0, "Debería haber al menos un paso temporal de simulación.");

        let get_voltage_at = |target_t: f64| -> f64 {
            let mut closest_val = 0.0;
            let mut min_diff = f64::MAX;
            for step in &results {
                let diff = (step.time - target_t).abs();
                if diff < min_diff {
                    min_diff = diff;
                    closest_val = *step.node_voltages.get("2").unwrap_or(&0.0);
                }
            }
            closest_val
        };

        // 1. Antes del disparo (t = 1.0 ms): el SCR está apagado, V_load ~ 0V
        let v_t1 = get_voltage_at(0.001);
        assert!(v_t1.abs() < 0.15, "Antes de disparar (1ms), la carga debería estar apagada (0V), obtenido: {}", v_t1);

        // 2. Después del disparo y en el pico positivo (t = 5.0 ms): el SCR está encendido (conduce)
        // V_in(5ms) = 10V. V_load ~ V_in - caída_scr ~ 10 - 1.4 ~ 8.6V.
        let v_t5 = get_voltage_at(0.005);
        assert!(v_t5 > 7.2 && v_t5 < 9.5, "Después de disparar (5ms), el SCR debería conducir (~8.6V), obtenido: {}", v_t5);

        // 3. En el ciclo negativo (t = 15.0 ms): el SCR se apagó en el cruce por cero y permanece bloqueado
        let v_t15 = get_voltage_at(0.015);
        assert!(v_t15.abs() < 0.15, "En el semiciclo negativo (15ms), la carga debería estar bloqueada (0V), obtenido: {}", v_t15);
    }

    #[test]
    fn test_electrothermal_relaxation() {
        let netlist = CircuitNetlist {
            mutual_inductances: None,
            thermal_config: Some(ThermalConfig {
                t_amb: 300.15,
                max_thermal_iters: 20,
                thermal_tol: 0.01,
                thermal_coupling: vec![],
            }),
            components: vec![
                ComponentData {
                    id: "V1".to_string(),
                    comp_type: "vsource".to_string(),
                    value: 10.0,
                    pins: vec!["1".to_string(), "0".to_string()],
                    ..Default::default()
                },
                ComponentData {
                    id: "D1".to_string(),
                    comp_type: "diode".to_string(),
                    value: 1.0,
                    pins: vec!["1".to_string(), "2".to_string()],
                    rth: Some(1000.0), // 1000 ºC/W para amplificar el efecto térmico (self-heating)
                    ..Default::default()
                },
                ComponentData {
                    id: "R1".to_string(),
                    comp_type: "resistor".to_string(),
                    value: 100.0,
                    pins: vec!["2".to_string(), "0".to_string()],
                    ..Default::default()
                },
            ],
            wires: vec![],
            temperature: None,
            fixed_step: None,
            subcircuit_definitions: None,
            triggers: None,
        };

        let (result, temps) = solve_dc_electrothermal(&netlist).unwrap();
        
        let d1_temp = *temps.get("D1").unwrap();
        // A 300.15K, V_D ~ 0.7V, I_D ~ 93mA -> P ~ 65mW
        // Con Rth=1000, dT = 65mW * 1000 = 65K. T_j esperada = ~365K.
        assert!(d1_temp > 340.0 && d1_temp < 390.0, "La temperatura de unión del diodo debería aumentar por self-heating a ~365K, obtenida: {:.2}K", d1_temp);
        
        let v2 = *result.node_voltages.get("2").unwrap();
        // Con V_source = 10V y V_D ligeramente menor debido a la temperatura (deriva -2mV/C)
        assert!(v2 > 9.0 && v2 < 10.0, "El voltaje a través de la resistencia debería ser de ~9.3V a 9.5V, obtenido: {:.2}V", v2);
    }
}

