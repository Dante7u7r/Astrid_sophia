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
                "exp" => Ok(AdValue::exp(&evaled[0])),
                "ln" => Ok(AdValue::ln(&evaled[0])),
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
                "max" => {
                    if args.len() < 2 {
                        return Err("max() requiere 2 argumentos".to_string());
                    }
                    Ok(evaled[0].max(evaled[1]))
                }
                "min" => {
                    if args.len() < 2 {
                        return Err("min() requiere 2 argumentos".to_string());
                    }
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
        ExprAST::CurrentRef(src_id) => Ok(*ctx.branch_currents.get(src_id).unwrap_or(&0.0)),
    }
}
