use crate::ad_value::AdValue;
use std::collections::HashMap;

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
            ' ' | '\t' | '\n' | '\r' => {
                i += 1;
            }
            '+' => {
                tokens.push(Token::Plus);
                i += 1;
            }
            '-' => {
                tokens.push(Token::Minus);
                i += 1;
            }
            '*' => {
                tokens.push(Token::Star);
                i += 1;
            }
            '/' => {
                tokens.push(Token::Slash);
                i += 1;
            }
            '^' => {
                tokens.push(Token::Caret);
                i += 1;
            }
            '(' => {
                tokens.push(Token::LParen);
                i += 1;
            }
            ')' => {
                tokens.push(Token::RParen);
                i += 1;
            }
            ',' => {
                tokens.push(Token::Comma);
                i += 1;
            }
            '0'..='9' | '.' => {
                let start = i;
                while i < len
                    && (chars[i].is_ascii_digit()
                        || chars[i] == '.'
                        || chars[i] == 'e'
                        || chars[i] == 'E'
                        || ((chars[i] == '+' || chars[i] == '-')
                            && i > start
                            && (chars[i - 1] == 'e' || chars[i - 1] == 'E')))
                {
                    i += 1;
                }
                let num_str: String = chars[start..i].iter().collect();
                let val = num_str
                    .parse::<f64>()
                    .map_err(|_| format!("Número inválido en expresión B-Source: '{}'", num_str))?;
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
                return Err(format!(
                    "Carácter inesperado '{}' en expresión B-Source",
                    ch
                ));
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
    BinOp {
        op: char,
        left: Box<ExprAST>,
        right: Box<ExprAST>,
    },
    FuncCall {
        name: String,
        args: Vec<ExprAST>,
    },
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
            other => Err(format!(
                "Se esperaba ')' en expresión B-Source, encontrado: {:?}",
                other
            )),
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
                    left = ExprAST::BinOp {
                        op: '+',
                        left: Box::new(left),
                        right: Box::new(right),
                    };
                }
                Some(Token::Minus) => {
                    self.next_token();
                    let right = self.parse_multiplicative()?;
                    left = ExprAST::BinOp {
                        op: '-',
                        left: Box::new(left),
                        right: Box::new(right),
                    };
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
                    left = ExprAST::BinOp {
                        op: '*',
                        left: Box::new(left),
                        right: Box::new(right),
                    };
                }
                Some(Token::Slash) => {
                    self.next_token();
                    let right = self.parse_power()?;
                    left = ExprAST::BinOp {
                        op: '/',
                        left: Box::new(left),
                        right: Box::new(right),
                    };
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
            Ok(ExprAST::BinOp {
                op: '^',
                left: Box::new(base),
                right: Box::new(exp),
            })
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
                            other => {
                                return Err(format!(
                                    "Se esperaba un nodo en V(), encontrado: {:?}",
                                    other
                                ))
                            }
                        };
                        if let Some(Token::Comma) = self.peek() {
                            self.next_token(); // consume ','
                            let node2 = match self.next_token() {
                                Some(Token::Ident(s)) => s,
                                Some(Token::Number(n)) => format!("{}", n as i64),
                                other => {
                                    return Err(format!(
                                        "Se esperaba segundo nodo en V(n1,n2), encontrado: {:?}",
                                        other
                                    ))
                                }
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
                            other => {
                                return Err(format!(
                                    "Se esperaba un ID de fuente en I(), encontrado: {:?}",
                                    other
                                ))
                            }
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
                    return Ok(ExprAST::FuncCall {
                        name: name_lower,
                        args,
                    });
                }

                // Variable genérica
                Ok(ExprAST::Var(name))
            }
            other => Err(format!(
                "Token inesperado en expresión B-Source: {:?}",
                other
            )),
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
    let ctx = EvalContext {
        node_voltages,
        branch_currents,
        time,
    };
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
                return Err(format!(
                    "La función '{}' requiere al menos un argumento",
                    name
                ));
            }
            let evaled: Vec<AdValue> = args
                .iter()
                .map(|a| evaluate_ast_ad(a, ctx))
                .collect::<Result<Vec<_>, _>>()?;
            match name.as_str() {
                "sin" => Ok(AdValue::sin(&evaled[0])),
                "cos" => Ok(AdValue::cos(&evaled[0])),
                "tan" => Ok(AdValue::tan(&evaled[0])),
                "sinh" => Ok(AdValue::sinh(&evaled[0])),
                "cosh" => Ok(AdValue::cosh(&evaled[0])),
                "tanh" => Ok(AdValue::tanh(&evaled[0])),
                "asin" => Ok(AdValue::asin(&evaled[0])),
                "acos" => Ok(AdValue::acos(&evaled[0])),
                "atan" => Ok(AdValue::atan(&evaled[0])),
                "atan2" => {
                    if evaled.len() < 2 {
                        return Err("atan2() requiere 2 argumentos (y, x)".to_string());
                    }
                    Ok(AdValue::atan2(&evaled[0], &evaled[1]))
                }
                "exp" => Ok(AdValue::exp(&evaled[0])),
                "ln" => Ok(AdValue::ln(&evaled[0])),
                "log" => {
                    let ln_val = AdValue::ln(&evaled[0]);
                    let ln10 = AdValue::constant(std::f64::consts::LN_10);
                    Ok(AdValue::div(&ln_val, &ln10))
                }
                "sqrt" => Ok(AdValue::sqrt(&evaled[0])),
                "abs" => Ok(AdValue::abs(&evaled[0])),
                "sign" | "sgn" => Ok(AdValue::sign(&evaled[0])),
                "stp" | "u" => Ok(AdValue::stp(&evaled[0])),
                "hypot" => {
                    if evaled.len() < 2 {
                        return Err("hypot() requiere 2 argumentos".to_string());
                    }
                    Ok(AdValue::hypot(&evaled[0], &evaled[1]))
                }
                "pwr" => {
                    if evaled.len() < 2 {
                        return Err("pwr() requiere 2 argumentos".to_string());
                    }
                    Ok(AdValue::pwr(&evaled[0], evaled[1].value))
                }
                "pwrs" => {
                    if evaled.len() < 2 {
                        return Err("pwrs() requiere 2 argumentos".to_string());
                    }
                    Ok(AdValue::pwrs(&evaled[0], evaled[1].value))
                }
                "max" => {
                    if evaled.len() < 2 {
                        return Err("max() requiere 2 argumentos".to_string());
                    }
                    Ok(AdValue::max(&evaled[0], &evaled[1]))
                }
                "min" => {
                    if evaled.len() < 2 {
                        return Err("min() requiere 2 argumentos".to_string());
                    }
                    Ok(AdValue::min(&evaled[0], &evaled[1]))
                }
                "smooth_max" => {
                    if evaled.len() < 2 {
                        return Err("smooth_max() requiere al menos 2 argumentos".to_string());
                    }
                    let k = if evaled.len() >= 3 {
                        evaled[2].value
                    } else {
                        0.05
                    };
                    Ok(AdValue::smooth_max(&evaled[0], &evaled[1], k))
                }
                "smooth_min" => {
                    if evaled.len() < 2 {
                        return Err("smooth_min() requiere al menos 2 argumentos".to_string());
                    }
                    let k = if evaled.len() >= 3 {
                        evaled[2].value
                    } else {
                        0.05
                    };
                    Ok(AdValue::smooth_min(&evaled[0], &evaled[1], k))
                }
                "limit" | "clamp" => {
                    if evaled.len() < 3 {
                        return Err("limit(x, min, max) requiere 3 argumentos".to_string());
                    }
                    Ok(AdValue::limit(&evaled[0], evaled[1].value, evaled[2].value))
                }
                "table" => evaluate_table_ad(&evaled),
                "if" => {
                    if evaled.len() < 3 {
                        return Err(
                            "if(cond, true_val, false_val) requiere 3 argumentos".to_string()
                        );
                    }
                    if evaled[0].value > 0.0 {
                        Ok(evaled[1].clone())
                    } else {
                        Ok(evaled[2].clone())
                    }
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

fn evaluate_table_ad(evaled: &[AdValue]) -> Result<AdValue, String> {
    if evaled.len() < 3 || !(evaled.len() - 1).is_multiple_of(2) {
        return Err(format!(
            "table() requiere un valor de entrada y al menos un par (x, y); argumentos recibidos: {}",
            evaled.len()
        ));
    }
    let x = &evaled[0];
    let num_pairs = (evaled.len() - 1) / 2;
    let mut points: Vec<(f64, f64)> = Vec::with_capacity(num_pairs);
    for i in 0..num_pairs {
        points.push((evaled[1 + 2 * i].value, evaled[2 + 2 * i].value));
    }

    if x.value <= points[0].0 {
        return Ok(AdValue::constant(points[0].1));
    }
    if x.value >= points[num_pairs - 1].0 {
        return Ok(AdValue::constant(points[num_pairs - 1].1));
    }

    for i in 0..(num_pairs - 1) {
        let (x0, y0) = points[i];
        let (x1, y1) = points[i + 1];
        if x.value >= x0 && x.value <= x1 {
            let dx = x1 - x0;
            let slope = if dx.abs() > 1e-30 {
                (y1 - y0) / dx
            } else {
                0.0
            };
            let val = y0 + slope * (x.value - x0);
            let mut grad = HashMap::new();
            if !x.grad.is_empty() {
                for (&k, &v) in &x.grad {
                    grad.insert(k, slope * v);
                }
            }
            return Ok(AdValue { value: val, grad });
        }
    }
    Ok(AdValue::constant(points[num_pairs - 1].1))
}

fn evaluate_table_scalar(evaled: &[f64]) -> Result<f64, String> {
    if evaled.len() < 3 || !(evaled.len() - 1).is_multiple_of(2) {
        return Err(format!(
            "table() requiere un valor de entrada y al menos un par (x, y); argumentos recibidos: {}",
            evaled.len()
        ));
    }
    let x = evaled[0];
    let num_pairs = (evaled.len() - 1) / 2;
    let mut points: Vec<(f64, f64)> = Vec::with_capacity(num_pairs);
    for i in 0..num_pairs {
        points.push((evaled[1 + 2 * i], evaled[2 + 2 * i]));
    }

    if x <= points[0].0 {
        return Ok(points[0].1);
    }
    if x >= points[num_pairs - 1].0 {
        return Ok(points[num_pairs - 1].1);
    }

    for i in 0..(num_pairs - 1) {
        let (x0, y0) = points[i];
        let (x1, y1) = points[i + 1];
        if x >= x0 && x <= x1 {
            let dx = x1 - x0;
            let slope = if dx.abs() > 1e-30 {
                (y1 - y0) / dx
            } else {
                0.0
            };
            return Ok(y0 + slope * (x - x0));
        }
    }
    Ok(points[num_pairs - 1].1)
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
            ast_cache.insert(expr_str.to_string(), parsed_ast);
            ast_cache.get(expr_str).unwrap()
        }
    };
    let ctx = EvalContext {
        node_voltages,
        branch_currents,
        time,
    };
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
                return Err(format!(
                    "La función '{}' requiere al menos un argumento",
                    name
                ));
            }
            let evaled: Vec<f64> = args
                .iter()
                .map(|a| evaluate_ast(a, ctx))
                .collect::<Result<Vec<_>, _>>()?;
            match name.as_str() {
                "sin" => Ok(evaled[0].sin()),
                "cos" => Ok(evaled[0].cos()),
                "tan" => Ok(evaled[0].tan()),
                "sinh" => Ok(evaled[0].sinh()),
                "cosh" => Ok(evaled[0].cosh()),
                "tanh" => Ok(evaled[0].tanh()),
                "asin" => Ok(evaled[0].clamp(-1.0, 1.0).asin()),
                "acos" => Ok(evaled[0].clamp(-1.0, 1.0).acos()),
                "atan" => Ok(evaled[0].atan()),
                "atan2" => {
                    if evaled.len() < 2 {
                        return Err("atan2() requiere 2 argumentos (y, x)".to_string());
                    }
                    Ok(evaled[0].atan2(evaled[1]))
                }
                "exp" => Ok(evaled[0].exp()),
                "ln" => {
                    if evaled[0] <= 0.0 {
                        Err("ln(x) requiere x > 0".to_string())
                    } else {
                        Ok(evaled[0].ln())
                    }
                }
                "log" => {
                    if evaled[0] <= 0.0 {
                        Err("log(x) requiere x > 0".to_string())
                    } else {
                        Ok(evaled[0].log10())
                    }
                }
                "sqrt" => {
                    if evaled[0] < 0.0 {
                        Err("sqrt(x) requiere x >= 0".to_string())
                    } else {
                        Ok(evaled[0].sqrt())
                    }
                }
                "abs" => Ok(evaled[0].abs()),
                "sign" | "sgn" => {
                    if evaled[0] > 0.0 {
                        Ok(1.0)
                    } else if evaled[0] < 0.0 {
                        Ok(-1.0)
                    } else {
                        Ok(0.0)
                    }
                }
                "stp" | "u" => {
                    let s = 1.0 / (1.0 + (-20.0 * evaled[0]).clamp(-60.0, 60.0).exp());
                    Ok(s)
                }
                "hypot" => {
                    if evaled.len() < 2 {
                        return Err("hypot() requiere 2 argumentos".to_string());
                    }
                    Ok(evaled[0].hypot(evaled[1]))
                }
                "pwr" => {
                    if evaled.len() < 2 {
                        return Err("pwr() requiere 2 argumentos".to_string());
                    }
                    Ok(evaled[0].abs().powf(evaled[1]))
                }
                "pwrs" => {
                    if evaled.len() < 2 {
                        return Err("pwrs() requiere 2 argumentos".to_string());
                    }
                    let sgn = if evaled[0] >= 0.0 { 1.0 } else { -1.0 };
                    Ok(evaled[0].abs().powf(evaled[1]) * sgn)
                }
                "max" => {
                    if evaled.len() < 2 {
                        return Err("max() requiere 2 argumentos".to_string());
                    }
                    Ok(evaled[0].max(evaled[1]))
                }
                "min" => {
                    if evaled.len() < 2 {
                        return Err("min() requiere 2 argumentos".to_string());
                    }
                    Ok(evaled[0].min(evaled[1]))
                }
                "smooth_max" => {
                    if evaled.len() < 2 {
                        return Err("smooth_max() requiere 2 argumentos".to_string());
                    }
                    let k = if evaled.len() >= 3 { evaled[2] } else { 0.05 };
                    let diff = evaled[0] - evaled[1];
                    Ok(0.5 * (evaled[0] + evaled[1] + (diff * diff + k * k).sqrt()))
                }
                "smooth_min" => {
                    if evaled.len() < 2 {
                        return Err("smooth_min() requiere 2 argumentos".to_string());
                    }
                    let k = if evaled.len() >= 3 { evaled[2] } else { 0.05 };
                    let diff = evaled[0] - evaled[1];
                    Ok(0.5 * (evaled[0] + evaled[1] - (diff * diff + k * k).sqrt()))
                }
                "limit" | "clamp" => {
                    if evaled.len() < 3 {
                        return Err("limit(x, min, max) requiere 3 argumentos".to_string());
                    }
                    Ok(evaled[0].clamp(evaled[1], evaled[2]))
                }
                "table" => evaluate_table_scalar(&evaled),
                "if" => {
                    if evaled.len() < 3 {
                        return Err(
                            "if(cond, true_val, false_val) requiere 3 argumentos".to_string()
                        );
                    }
                    if evaled[0] > 0.0 {
                        Ok(evaled[1])
                    } else {
                        Ok(evaled[2])
                    }
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
        ExprAST::CurrentRef(src_id) => Ok(*ctx.branch_currents.get(src_id).unwrap_or(&0.0)),
    }
}

// ============================================================================
// COMPILADOR DE BYTECODE Y VM PLANA PARA FUENTES B (ZERO ALLOCATIONS)
// ============================================================================

#[derive(Debug, Clone, PartialEq)]
pub enum BytecodeOp {
    PushNum(f64),
    PushTime,
    PushConstPi,
    PushConstE,
    PushNodeVoltage(String),
    PushNodeVoltageDiff(String, String),
    PushBranchCurrent(String),
    Neg,
    Add,
    Sub,
    Mul,
    Div,
    Pow,
    Sin,
    Cos,
    Tan,
    Sinh,
    Cosh,
    Tanh,
    Asin,
    Acos,
    Atan,
    Atan2,
    Exp,
    Ln,
    Log10,
    Sqrt,
    Abs,
    Sign,
    Stp,
    Hypot,
    Pwr,
    Pwrs,
    Max,
    Min,
    SmoothMax(f64),
    SmoothMin(f64),
    Clamp,
    Table(Vec<(f64, f64)>),
    If,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CompiledBehavioralExpr {
    pub ops: Vec<BytecodeOp>,
}

impl CompiledBehavioralExpr {
    pub fn compile(ast: &ExprAST) -> Result<Self, String> {
        let mut ops = Vec::new();
        compile_ast_recursive(ast, &mut ops)?;
        Ok(Self { ops })
    }

    pub fn execute_scalar(
        &self,
        node_voltages: &HashMap<String, f64>,
        branch_currents: &HashMap<String, f64>,
        time: f64,
    ) -> Result<f64, String> {
        let mut stack = Vec::with_capacity(16);
        for op in &self.ops {
            match op {
                BytecodeOp::PushNum(val) => stack.push(*val),
                BytecodeOp::PushTime => stack.push(time),
                BytecodeOp::PushConstPi => stack.push(std::f64::consts::PI),
                BytecodeOp::PushConstE => stack.push(std::f64::consts::E),
                BytecodeOp::PushNodeVoltage(node) => {
                    let v = *node_voltages.get(node).unwrap_or(&0.0);
                    stack.push(v);
                }
                BytecodeOp::PushNodeVoltageDiff(node_a, node_b) => {
                    let va = *node_voltages.get(node_a).unwrap_or(&0.0);
                    let vb = *node_voltages.get(node_b).unwrap_or(&0.0);
                    stack.push(va - vb);
                }
                BytecodeOp::PushBranchCurrent(src) => {
                    let i = *branch_currents.get(src).unwrap_or(&0.0);
                    stack.push(i);
                }
                BytecodeOp::Neg => {
                    let top = stack.last_mut().ok_or("Pila vacía en Neg")?;
                    *top = -*top;
                }
                BytecodeOp::Add => {
                    let b = stack.pop().ok_or("Pila vacía en Add")?;
                    let a = stack.last_mut().ok_or("Pila vacía en Add")?;
                    *a += b;
                }
                BytecodeOp::Sub => {
                    let b = stack.pop().ok_or("Pila vacía en Sub")?;
                    let a = stack.last_mut().ok_or("Pila vacía en Sub")?;
                    *a -= b;
                }
                BytecodeOp::Mul => {
                    let b = stack.pop().ok_or("Pila vacía en Mul")?;
                    let a = stack.last_mut().ok_or("Pila vacía en Mul")?;
                    *a *= b;
                }
                BytecodeOp::Div => {
                    let b = stack.pop().ok_or("Pila vacía en Div")?;
                    if b.abs() < 1e-15 {
                        return Err("División por cero en expresión B-Source".to_string());
                    }
                    let a = stack.last_mut().ok_or("Pila vacía en Div")?;
                    *a /= b;
                }
                BytecodeOp::Pow => {
                    let b = stack.pop().ok_or("Pila vacía en Pow")?;
                    let a = stack.last_mut().ok_or("Pila vacía en Pow")?;
                    *a = a.powf(b);
                }
                BytecodeOp::Sin => {
                    let a = stack.last_mut().ok_or("Pila vacía en Sin")?;
                    *a = a.sin();
                }
                BytecodeOp::Cos => {
                    let a = stack.last_mut().ok_or("Pila vacía en Cos")?;
                    *a = a.cos();
                }
                BytecodeOp::Tan => {
                    let a = stack.last_mut().ok_or("Pila vacía en Tan")?;
                    *a = a.tan();
                }
                BytecodeOp::Sinh => {
                    let a = stack.last_mut().ok_or("Pila vacía en Sinh")?;
                    *a = a.sinh();
                }
                BytecodeOp::Cosh => {
                    let a = stack.last_mut().ok_or("Pila vacía en Cosh")?;
                    *a = a.cosh();
                }
                BytecodeOp::Tanh => {
                    let a = stack.last_mut().ok_or("Pila vacía en Tanh")?;
                    *a = a.tanh();
                }
                BytecodeOp::Asin => {
                    let a = stack.last_mut().ok_or("Pila vacía en Asin")?;
                    *a = a.clamp(-1.0, 1.0).asin();
                }
                BytecodeOp::Acos => {
                    let a = stack.last_mut().ok_or("Pila vacía en Acos")?;
                    *a = a.clamp(-1.0, 1.0).acos();
                }
                BytecodeOp::Atan => {
                    let a = stack.last_mut().ok_or("Pila vacía en Atan")?;
                    *a = a.atan();
                }
                BytecodeOp::Atan2 => {
                    let x = stack.pop().ok_or("Pila vacía en Atan2")?;
                    let y = stack.last_mut().ok_or("Pila vacía en Atan2")?;
                    *y = y.atan2(x);
                }
                BytecodeOp::Exp => {
                    let a = stack.last_mut().ok_or("Pila vacía en Exp")?;
                    *a = a.exp();
                }
                BytecodeOp::Ln => {
                    let a = stack.last_mut().ok_or("Pila vacía en Ln")?;
                    if *a <= 0.0 {
                        return Err("ln(x) requiere x > 0".to_string());
                    }
                    *a = a.ln();
                }
                BytecodeOp::Log10 => {
                    let a = stack.last_mut().ok_or("Pila vacía en Log10")?;
                    if *a <= 0.0 {
                        return Err("log(x) requiere x > 0".to_string());
                    }
                    *a = a.log10();
                }
                BytecodeOp::Sqrt => {
                    let a = stack.last_mut().ok_or("Pila vacía en Sqrt")?;
                    if *a < 0.0 {
                        return Err("sqrt(x) requiere x >= 0".to_string());
                    }
                    *a = a.sqrt();
                }
                BytecodeOp::Abs => {
                    let a = stack.last_mut().ok_or("Pila vacía en Abs")?;
                    *a = a.abs();
                }
                BytecodeOp::Sign => {
                    let a = stack.last_mut().ok_or("Pila vacía en Sign")?;
                    *a = if *a > 0.0 {
                        1.0
                    } else if *a < 0.0 {
                        -1.0
                    } else {
                        0.0
                    };
                }
                BytecodeOp::Stp => {
                    let a = stack.last_mut().ok_or("Pila vacía en Stp")?;
                    *a = 1.0 / (1.0 + (-20.0 * *a).clamp(-60.0, 60.0).exp());
                }
                BytecodeOp::Hypot => {
                    let b = stack.pop().ok_or("Pila vacía en Hypot")?;
                    let a = stack.last_mut().ok_or("Pila vacía en Hypot")?;
                    *a = a.hypot(b);
                }
                BytecodeOp::Pwr => {
                    let exp = stack.pop().ok_or("Pila vacía en Pwr")?;
                    let base = stack.last_mut().ok_or("Pila vacía en Pwr")?;
                    *base = base.abs().powf(exp);
                }
                BytecodeOp::Pwrs => {
                    let exp = stack.pop().ok_or("Pila vacía en Pwrs")?;
                    let base = stack.last_mut().ok_or("Pila vacía en Pwrs")?;
                    let sgn = if *base >= 0.0 { 1.0 } else { -1.0 };
                    *base = base.abs().powf(exp) * sgn;
                }
                BytecodeOp::Max => {
                    let b = stack.pop().ok_or("Pila vacía en Max")?;
                    let a = stack.last_mut().ok_or("Pila vacía en Max")?;
                    *a = a.max(b);
                }
                BytecodeOp::Min => {
                    let b = stack.pop().ok_or("Pila vacía en Min")?;
                    let a = stack.last_mut().ok_or("Pila vacía en Min")?;
                    *a = a.min(b);
                }
                BytecodeOp::SmoothMax(k) => {
                    let b = stack.pop().ok_or("Pila vacía en SmoothMax")?;
                    let a = stack.last_mut().ok_or("Pila vacía en SmoothMax")?;
                    let diff = *a - b;
                    *a = 0.5 * (*a + b + (diff * diff + k * k).sqrt());
                }
                BytecodeOp::SmoothMin(k) => {
                    let b = stack.pop().ok_or("Pila vacía en SmoothMin")?;
                    let a = stack.last_mut().ok_or("Pila vacía en SmoothMin")?;
                    let diff = *a - b;
                    *a = 0.5 * (*a + b - (diff * diff + k * k).sqrt());
                }
                BytecodeOp::Clamp => {
                    let max = stack.pop().ok_or("Pila vacía en Clamp")?;
                    let min = stack.pop().ok_or("Pila vacía en Clamp")?;
                    let x = stack.last_mut().ok_or("Pila vacía en Clamp")?;
                    *x = x.clamp(min, max);
                }
                BytecodeOp::Table(points) => {
                    let x = stack.last_mut().ok_or("Pila vacía en Table")?;
                    *x = evaluate_table_points_scalar(*x, points);
                }
                BytecodeOp::If => {
                    let val_false = stack.pop().ok_or("Pila vacía en If")?;
                    let val_true = stack.pop().ok_or("Pila vacía en If")?;
                    let cond = stack.last_mut().ok_or("Pila vacía en If")?;
                    *cond = if *cond > 0.0 { val_true } else { val_false };
                }
            }
        }
        stack
            .pop()
            .ok_or_else(|| "La expresión no produjo ningún resultado".to_string())
    }

    pub fn execute_ad(
        &self,
        node_voltages: &HashMap<String, f64>,
        branch_currents: &HashMap<String, f64>,
        time: f64,
    ) -> Result<AdValue, String> {
        let mut stack: Vec<AdValue> = Vec::with_capacity(16);
        for op in &self.ops {
            match op {
                BytecodeOp::PushNum(val) => stack.push(AdValue::constant(*val)),
                BytecodeOp::PushTime => stack.push(AdValue::constant(time)),
                BytecodeOp::PushConstPi => stack.push(AdValue::constant(std::f64::consts::PI)),
                BytecodeOp::PushConstE => stack.push(AdValue::constant(std::f64::consts::E)),
                BytecodeOp::PushNodeVoltage(node) => {
                    let v = *node_voltages.get(node).unwrap_or(&0.0);
                    let mut result = AdValue::constant(v);
                    if let Ok(idx) = node.parse::<usize>() {
                        if idx > 0 {
                            result.grad.insert(idx, 1.0);
                        }
                    }
                    stack.push(result);
                }
                BytecodeOp::PushNodeVoltageDiff(node_a, node_b) => {
                    let va = *node_voltages.get(node_a).unwrap_or(&0.0);
                    let vb = *node_voltages.get(node_b).unwrap_or(&0.0);
                    let mut result = AdValue::constant(va - vb);
                    if let Ok(ia) = node_a.parse::<usize>() {
                        if ia > 0 {
                            result.grad.insert(ia, 1.0);
                        }
                    }
                    if let Ok(ib) = node_b.parse::<usize>() {
                        if ib > 0 {
                            result.grad.insert(ib, -1.0);
                        }
                    }
                    stack.push(result);
                }
                BytecodeOp::PushBranchCurrent(src) => {
                    let i = *branch_currents.get(src).unwrap_or(&0.0);
                    stack.push(AdValue::constant(i));
                }
                BytecodeOp::Neg => {
                    let a = stack.pop().ok_or("Pila vacía en Neg")?;
                    stack.push(AdValue::neg(&a));
                }
                BytecodeOp::Add => {
                    let b = stack.pop().ok_or("Pila vacía en Add")?;
                    let a = stack.pop().ok_or("Pila vacía en Add")?;
                    stack.push(AdValue::add(&a, &b));
                }
                BytecodeOp::Sub => {
                    let b = stack.pop().ok_or("Pila vacía en Sub")?;
                    let a = stack.pop().ok_or("Pila vacía en Sub")?;
                    stack.push(AdValue::sub(&a, &b));
                }
                BytecodeOp::Mul => {
                    let b = stack.pop().ok_or("Pila vacía en Mul")?;
                    let a = stack.pop().ok_or("Pila vacía en Mul")?;
                    stack.push(AdValue::mul(&a, &b));
                }
                BytecodeOp::Div => {
                    let b = stack.pop().ok_or("Pila vacía en Div")?;
                    let a = stack.pop().ok_or("Pila vacía en Div")?;
                    stack.push(AdValue::div(&a, &b));
                }
                BytecodeOp::Pow => {
                    let b = stack.pop().ok_or("Pila vacía en Pow")?;
                    let a = stack.pop().ok_or("Pila vacía en Pow")?;
                    stack.push(AdValue::pow(&a, b.value));
                }
                BytecodeOp::Sin => {
                    let a = stack.pop().ok_or("Pila vacía en Sin")?;
                    stack.push(AdValue::sin(&a));
                }
                BytecodeOp::Cos => {
                    let a = stack.pop().ok_or("Pila vacía en Cos")?;
                    stack.push(AdValue::cos(&a));
                }
                BytecodeOp::Tan => {
                    let a = stack.pop().ok_or("Pila vacía en Tan")?;
                    stack.push(AdValue::tan(&a));
                }
                BytecodeOp::Sinh => {
                    let a = stack.pop().ok_or("Pila vacía en Sinh")?;
                    stack.push(AdValue::sinh(&a));
                }
                BytecodeOp::Cosh => {
                    let a = stack.pop().ok_or("Pila vacía en Cosh")?;
                    stack.push(AdValue::cosh(&a));
                }
                BytecodeOp::Tanh => {
                    let a = stack.pop().ok_or("Pila vacía en Tanh")?;
                    stack.push(AdValue::tanh(&a));
                }
                BytecodeOp::Asin => {
                    let a = stack.pop().ok_or("Pila vacía en Asin")?;
                    stack.push(AdValue::asin(&a));
                }
                BytecodeOp::Acos => {
                    let a = stack.pop().ok_or("Pila vacía en Acos")?;
                    stack.push(AdValue::acos(&a));
                }
                BytecodeOp::Atan => {
                    let a = stack.pop().ok_or("Pila vacía en Atan")?;
                    stack.push(AdValue::atan(&a));
                }
                BytecodeOp::Atan2 => {
                    let x = stack.pop().ok_or("Pila vacía en Atan2")?;
                    let y = stack.pop().ok_or("Pila vacía en Atan2")?;
                    stack.push(AdValue::atan2(&y, &x));
                }
                BytecodeOp::Exp => {
                    let a = stack.pop().ok_or("Pila vacía en Exp")?;
                    stack.push(AdValue::exp(&a));
                }
                BytecodeOp::Ln => {
                    let a = stack.pop().ok_or("Pila vacía en Ln")?;
                    stack.push(AdValue::ln(&a));
                }
                BytecodeOp::Log10 => {
                    let a = stack.pop().ok_or("Pila vacía en Log10")?;
                    let ln_val = AdValue::ln(&a);
                    let ln10 = AdValue::constant(std::f64::consts::LN_10);
                    stack.push(AdValue::div(&ln_val, &ln10));
                }
                BytecodeOp::Sqrt => {
                    let a = stack.pop().ok_or("Pila vacía en Sqrt")?;
                    stack.push(AdValue::sqrt(&a));
                }
                BytecodeOp::Abs => {
                    let a = stack.pop().ok_or("Pila vacía en Abs")?;
                    stack.push(AdValue::abs(&a));
                }
                BytecodeOp::Sign => {
                    let a = stack.pop().ok_or("Pila vacía en Sign")?;
                    stack.push(AdValue::sign(&a));
                }
                BytecodeOp::Stp => {
                    let a = stack.pop().ok_or("Pila vacía en Stp")?;
                    stack.push(AdValue::stp(&a));
                }
                BytecodeOp::Hypot => {
                    let b = stack.pop().ok_or("Pila vacía en Hypot")?;
                    let a = stack.pop().ok_or("Pila vacía en Hypot")?;
                    stack.push(AdValue::hypot(&a, &b));
                }
                BytecodeOp::Pwr => {
                    let exp = stack.pop().ok_or("Pila vacía en Pwr")?;
                    let base = stack.pop().ok_or("Pila vacía en Pwr")?;
                    stack.push(AdValue::pwr(&base, exp.value));
                }
                BytecodeOp::Pwrs => {
                    let exp = stack.pop().ok_or("Pila vacía en Pwrs")?;
                    let base = stack.pop().ok_or("Pila vacía en Pwrs")?;
                    stack.push(AdValue::pwrs(&base, exp.value));
                }
                BytecodeOp::Max => {
                    let b = stack.pop().ok_or("Pila vacía en Max")?;
                    let a = stack.pop().ok_or("Pila vacía en Max")?;
                    stack.push(AdValue::max(&a, &b));
                }
                BytecodeOp::Min => {
                    let b = stack.pop().ok_or("Pila vacía en Min")?;
                    let a = stack.pop().ok_or("Pila vacía en Min")?;
                    stack.push(AdValue::min(&a, &b));
                }
                BytecodeOp::SmoothMax(k) => {
                    let b = stack.pop().ok_or("Pila vacía en SmoothMax")?;
                    let a = stack.pop().ok_or("Pila vacía en SmoothMax")?;
                    stack.push(AdValue::smooth_max(&a, &b, *k));
                }
                BytecodeOp::SmoothMin(k) => {
                    let b = stack.pop().ok_or("Pila vacía en SmoothMin")?;
                    let a = stack.pop().ok_or("Pila vacía en SmoothMin")?;
                    stack.push(AdValue::smooth_min(&a, &b, *k));
                }
                BytecodeOp::Clamp => {
                    let max = stack.pop().ok_or("Pila vacía en Clamp")?;
                    let min = stack.pop().ok_or("Pila vacía en Clamp")?;
                    let x = stack.pop().ok_or("Pila vacía en Clamp")?;
                    stack.push(AdValue::limit(&x, min.value, max.value));
                }
                BytecodeOp::Table(points) => {
                    let x = stack.pop().ok_or("Pila vacía en Table")?;
                    stack.push(evaluate_table_points_ad(&x, points)?);
                }
                BytecodeOp::If => {
                    let val_false = stack.pop().ok_or("Pila vacía en If")?;
                    let val_true = stack.pop().ok_or("Pila vacía en If")?;
                    let cond = stack.pop().ok_or("Pila vacía en If")?;
                    if cond.value > 0.0 {
                        stack.push(val_true);
                    } else {
                        stack.push(val_false);
                    }
                }
            }
        }
        stack
            .pop()
            .ok_or_else(|| "La expresión no produjo ningún resultado".to_string())
    }
}

pub fn compile_expression_string(expr_str: &str) -> Result<CompiledBehavioralExpr, String> {
    let tokens = tokenize_expression(expr_str)?;
    let mut parser = ExprParser::new(tokens);
    let ast = parser.parse_expression()?;
    CompiledBehavioralExpr::compile(&ast)
}

fn compile_ast_recursive(ast: &ExprAST, ops: &mut Vec<BytecodeOp>) -> Result<(), String> {
    match ast {
        ExprAST::Num(v) => {
            ops.push(BytecodeOp::PushNum(*v));
            Ok(())
        }
        ExprAST::Var(name) => {
            if name == "t" {
                ops.push(BytecodeOp::PushTime);
            } else if name == "pi" {
                ops.push(BytecodeOp::PushConstPi);
            } else if name == "e" {
                ops.push(BytecodeOp::PushConstE);
            } else {
                ops.push(BytecodeOp::PushNodeVoltage(name.clone()));
            }
            Ok(())
        }
        ExprAST::VoltageRef(na, nb_opt) => {
            match nb_opt {
                Some(nb) => {
                    if nb == "0" {
                        ops.push(BytecodeOp::PushNodeVoltage(na.clone()));
                    } else if na == "0" {
                        ops.push(BytecodeOp::PushNodeVoltage(nb.clone()));
                        ops.push(BytecodeOp::Neg);
                    } else {
                        ops.push(BytecodeOp::PushNodeVoltageDiff(na.clone(), nb.clone()));
                    }
                }
                None => {
                    ops.push(BytecodeOp::PushNodeVoltage(na.clone()));
                }
            }
            Ok(())
        }
        ExprAST::CurrentRef(src) => {
            ops.push(BytecodeOp::PushBranchCurrent(src.clone()));
            Ok(())
        }
        ExprAST::UnaryMinus(inner) => {
            compile_ast_recursive(inner, ops)?;
            ops.push(BytecodeOp::Neg);
            Ok(())
        }
        ExprAST::BinOp { op, left, right } => {
            compile_ast_recursive(left, ops)?;
            compile_ast_recursive(right, ops)?;
            match op {
                '+' => ops.push(BytecodeOp::Add),
                '-' => ops.push(BytecodeOp::Sub),
                '*' => ops.push(BytecodeOp::Mul),
                '/' => ops.push(BytecodeOp::Div),
                '^' => ops.push(BytecodeOp::Pow),
                _ => return Err(format!("Operador desconocido: '{}'", op)),
            }
            Ok(())
        }
        ExprAST::FuncCall { name, args } => {
            if args.is_empty() {
                return Err(format!("La función '{}' requiere argumentos", name));
            }
            match name.as_str() {
                "sin" => {
                    compile_ast_recursive(&args[0], ops)?;
                    ops.push(BytecodeOp::Sin);
                }
                "cos" => {
                    compile_ast_recursive(&args[0], ops)?;
                    ops.push(BytecodeOp::Cos);
                }
                "tan" => {
                    compile_ast_recursive(&args[0], ops)?;
                    ops.push(BytecodeOp::Tan);
                }
                "sinh" => {
                    compile_ast_recursive(&args[0], ops)?;
                    ops.push(BytecodeOp::Sinh);
                }
                "cosh" => {
                    compile_ast_recursive(&args[0], ops)?;
                    ops.push(BytecodeOp::Cosh);
                }
                "tanh" => {
                    compile_ast_recursive(&args[0], ops)?;
                    ops.push(BytecodeOp::Tanh);
                }
                "asin" => {
                    compile_ast_recursive(&args[0], ops)?;
                    ops.push(BytecodeOp::Asin);
                }
                "acos" => {
                    compile_ast_recursive(&args[0], ops)?;
                    ops.push(BytecodeOp::Acos);
                }
                "atan" => {
                    compile_ast_recursive(&args[0], ops)?;
                    ops.push(BytecodeOp::Atan);
                }
                "atan2" => {
                    if args.len() < 2 {
                        return Err("atan2() requiere 2 argumentos".to_string());
                    }
                    compile_ast_recursive(&args[0], ops)?;
                    compile_ast_recursive(&args[1], ops)?;
                    ops.push(BytecodeOp::Atan2);
                }
                "exp" => {
                    compile_ast_recursive(&args[0], ops)?;
                    ops.push(BytecodeOp::Exp);
                }
                "ln" => {
                    compile_ast_recursive(&args[0], ops)?;
                    ops.push(BytecodeOp::Ln);
                }
                "log" => {
                    compile_ast_recursive(&args[0], ops)?;
                    ops.push(BytecodeOp::Log10);
                }
                "sqrt" => {
                    compile_ast_recursive(&args[0], ops)?;
                    ops.push(BytecodeOp::Sqrt);
                }
                "abs" => {
                    compile_ast_recursive(&args[0], ops)?;
                    ops.push(BytecodeOp::Abs);
                }
                "sign" | "sgn" => {
                    compile_ast_recursive(&args[0], ops)?;
                    ops.push(BytecodeOp::Sign);
                }
                "stp" | "u" => {
                    compile_ast_recursive(&args[0], ops)?;
                    ops.push(BytecodeOp::Stp);
                }
                "hypot" => {
                    if args.len() < 2 {
                        return Err("hypot() requiere 2 argumentos".to_string());
                    }
                    compile_ast_recursive(&args[0], ops)?;
                    compile_ast_recursive(&args[1], ops)?;
                    ops.push(BytecodeOp::Hypot);
                }
                "pwr" => {
                    if args.len() < 2 {
                        return Err("pwr() requiere 2 argumentos".to_string());
                    }
                    compile_ast_recursive(&args[0], ops)?;
                    compile_ast_recursive(&args[1], ops)?;
                    ops.push(BytecodeOp::Pwr);
                }
                "pwrs" => {
                    if args.len() < 2 {
                        return Err("pwrs() requiere 2 argumentos".to_string());
                    }
                    compile_ast_recursive(&args[0], ops)?;
                    compile_ast_recursive(&args[1], ops)?;
                    ops.push(BytecodeOp::Pwrs);
                }
                "max" => {
                    if args.len() < 2 {
                        return Err("max() requiere 2 argumentos".to_string());
                    }
                    compile_ast_recursive(&args[0], ops)?;
                    compile_ast_recursive(&args[1], ops)?;
                    ops.push(BytecodeOp::Max);
                }
                "min" => {
                    if args.len() < 2 {
                        return Err("min() requiere 2 argumentos".to_string());
                    }
                    compile_ast_recursive(&args[0], ops)?;
                    compile_ast_recursive(&args[1], ops)?;
                    ops.push(BytecodeOp::Min);
                }
                "smooth_max" => {
                    if args.len() < 2 {
                        return Err("smooth_max() requiere al menos 2 argumentos".to_string());
                    }
                    let k = if args.len() >= 3 {
                        match &args[2] {
                            ExprAST::Num(v) => *v,
                            _ => 0.05,
                        }
                    } else {
                        0.05
                    };
                    compile_ast_recursive(&args[0], ops)?;
                    compile_ast_recursive(&args[1], ops)?;
                    ops.push(BytecodeOp::SmoothMax(k));
                }
                "smooth_min" => {
                    if args.len() < 2 {
                        return Err("smooth_min() requiere al menos 2 argumentos".to_string());
                    }
                    let k = if args.len() >= 3 {
                        match &args[2] {
                            ExprAST::Num(v) => *v,
                            _ => 0.05,
                        }
                    } else {
                        0.05
                    };
                    compile_ast_recursive(&args[0], ops)?;
                    compile_ast_recursive(&args[1], ops)?;
                    ops.push(BytecodeOp::SmoothMin(k));
                }
                "limit" | "clamp" => {
                    if args.len() < 3 {
                        return Err("limit() requiere 3 argumentos (x, min, max)".to_string());
                    }
                    compile_ast_recursive(&args[0], ops)?;
                    compile_ast_recursive(&args[1], ops)?;
                    compile_ast_recursive(&args[2], ops)?;
                    ops.push(BytecodeOp::Clamp);
                }
                "table" => {
                    if args.len() < 3 || !(args.len() - 1).is_multiple_of(2) {
                        return Err("table() requiere valor y pares (x, y)".to_string());
                    }
                    let num_pairs = (args.len() - 1) / 2;
                    let mut points = Vec::with_capacity(num_pairs);
                    for i in 0..num_pairs {
                        let x_val = match &args[1 + 2 * i] {
                            ExprAST::Num(v) => *v,
                            ExprAST::UnaryMinus(inner) => match &**inner {
                                ExprAST::Num(v) => -*v,
                                _ => 0.0,
                            },
                            _ => 0.0,
                        };
                        let y_val = match &args[2 + 2 * i] {
                            ExprAST::Num(v) => *v,
                            ExprAST::UnaryMinus(inner) => match &**inner {
                                ExprAST::Num(v) => -*v,
                                _ => 0.0,
                            },
                            _ => 0.0,
                        };
                        points.push((x_val, y_val));
                    }
                    compile_ast_recursive(&args[0], ops)?;
                    ops.push(BytecodeOp::Table(points));
                }
                "if" => {
                    if args.len() < 3 {
                        return Err("if() requiere 3 argumentos (cond, true, false)".to_string());
                    }
                    compile_ast_recursive(&args[0], ops)?;
                    compile_ast_recursive(&args[1], ops)?;
                    compile_ast_recursive(&args[2], ops)?;
                    ops.push(BytecodeOp::If);
                }
                _ => return Err(format!("Función no soportada para compilación: '{}'", name)),
            }
            Ok(())
        }
    }
}

fn evaluate_table_points_scalar(x: f64, points: &[(f64, f64)]) -> f64 {
    if points.is_empty() {
        return 0.0;
    }
    if x <= points[0].0 {
        return points[0].1;
    }
    let n = points.len();
    if x >= points[n - 1].0 {
        return points[n - 1].1;
    }
    for i in 0..(n - 1) {
        let (x0, y0) = points[i];
        let (x1, y1) = points[i + 1];
        if x >= x0 && x <= x1 {
            let dx = x1 - x0;
            let slope = if dx.abs() > 1e-30 {
                (y1 - y0) / dx
            } else {
                0.0
            };
            return y0 + slope * (x - x0);
        }
    }
    points[n - 1].1
}

fn evaluate_table_points_ad(x: &AdValue, points: &[(f64, f64)]) -> Result<AdValue, String> {
    if points.is_empty() {
        return Ok(AdValue::constant(0.0));
    }
    if x.value <= points[0].0 {
        return Ok(AdValue::constant(points[0].1));
    }
    let n = points.len();
    if x.value >= points[n - 1].0 {
        return Ok(AdValue::constant(points[n - 1].1));
    }
    for i in 0..(n - 1) {
        let (x0, y0) = points[i];
        let (x1, y1) = points[i + 1];
        if x.value >= x0 && x.value <= x1 {
            let dx = x1 - x0;
            let slope = if dx.abs() > 1e-30 {
                (y1 - y0) / dx
            } else {
                0.0
            };
            let val = y0 + slope * (x.value - x0);
            let mut grad = HashMap::new();
            if !x.grad.is_empty() {
                for (&k, &v) in &x.grad {
                    grad.insert(k, slope * v);
                }
            }
            return Ok(AdValue { value: val, grad });
        }
    }
    Ok(AdValue::constant(points[n - 1].1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compiled_behavioral_bytecode_math_equivalence() {
        let expr_str =
            "sin(V(1)) * cos(V(2)) + tanh(V(1) - V(2)) + exp(-V(1)) + smooth_max(V(1), V(2), 0.05)";
        let compiled = compile_expression_string(expr_str).expect("Compilación fallida");

        let mut node_voltages = HashMap::new();
        node_voltages.insert("1".to_string(), 1.25);
        node_voltages.insert("2".to_string(), 0.75);
        let branch_currents = HashMap::new();

        let ctx = EvalContext {
            node_voltages: &node_voltages,
            branch_currents: &branch_currents,
            time: 0.001,
        };
        let tokens = tokenize_expression(expr_str).unwrap();
        let mut parser = ExprParser::new(tokens);
        let ast = parser.parse_expression().unwrap();

        let ast_val = evaluate_ast(&ast, &ctx).unwrap();
        let bc_val = compiled
            .execute_scalar(&node_voltages, &branch_currents, 0.001)
            .unwrap();
        assert!(
            (ast_val - bc_val).abs() < 1e-12,
            "Valor escalar difiere: ast={}, bc={}",
            ast_val,
            bc_val
        );

        let ast_ad = evaluate_ast_ad(&ast, &ctx).unwrap();
        let bc_ad = compiled
            .execute_ad(&node_voltages, &branch_currents, 0.001)
            .unwrap();
        assert!(
            (ast_ad.value - bc_ad.value).abs() < 1e-12,
            "Valor AD difiere: ast={}, bc={}",
            ast_ad.value,
            bc_ad.value
        );

        for (&node_idx, &grad_ast) in &ast_ad.grad {
            let grad_bc = bc_ad.grad.get(&node_idx).copied().unwrap_or(0.0);
            assert!(
                (grad_ast - grad_bc).abs() < 1e-12,
                "Gradiente para nodo {} difiere: ast={}, bc={}",
                node_idx,
                grad_ast,
                grad_bc
            );
        }
    }

    #[test]
    fn test_compiled_behavioral_bytecode_table_and_if() {
        let expr_table = "table(V(1), -10, -5, 0, 0, 10, 5)";
        let compiled_table = compile_expression_string(expr_table).unwrap();

        let mut node_voltages = HashMap::new();
        node_voltages.insert("1".to_string(), 5.0);
        let branch_currents = HashMap::new();

        let val_table = compiled_table
            .execute_scalar(&node_voltages, &branch_currents, 0.0)
            .unwrap();
        assert!((val_table - 2.5).abs() < 1e-12, "Table(5.0) debe ser 2.5");

        let expr_if = "if(V(1) - 2.5, 5.0, 0.0)";
        let compiled_if = compile_expression_string(expr_if).unwrap();
        let val_if = compiled_if
            .execute_scalar(&node_voltages, &branch_currents, 0.0)
            .unwrap();
        assert_eq!(
            val_if, 5.0,
            "if() con cond > 0 debe devolver valor verdadero"
        );
    }

    #[test]
    fn test_compiled_behavioral_bytecode_multinodal_voltage_diff() {
        let expr_str = "V(1, 2) * 3.0 + V(3)";
        let compiled = compile_expression_string(expr_str).unwrap();

        let mut node_voltages = HashMap::new();
        node_voltages.insert("1".to_string(), 5.0);
        node_voltages.insert("2".to_string(), 2.0);
        node_voltages.insert("3".to_string(), 1.5);
        let branch_currents = HashMap::new();

        let ad = compiled
            .execute_ad(&node_voltages, &branch_currents, 0.0)
            .unwrap();
        assert!((ad.value - (3.0 * 3.0 + 1.5)).abs() < 1e-12);
        assert_eq!(ad.grad.get(&1), Some(&3.0));
        assert_eq!(ad.grad.get(&2), Some(&-3.0));
        assert_eq!(ad.grad.get(&3), Some(&1.0));
    }
}
